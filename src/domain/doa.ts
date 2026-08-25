/**
 * Delegation of Authority.
 *
 * You verify a matrix by simulating it, so `simulate` is the primary export
 * and the rules table is secondary.
 */
import type { ApprovalStep, DoARule, Id, ServerMillis } from './types';

export interface DoAFacts {
  value: number;
  category: string;
  businessUnit: string;
}

export interface SimulationResult {
  matchedRule: DoARule | null;
  /** Every rule considered and why it did or did not match. */
  trace: { rule: DoARule; matched: boolean; reason: string }[];
  chain: { level: number; role: string; holderName: string; slaHours: number }[];
  upliftApplied: boolean;
  totalSlaHours: number;
}

export function simulate(
  rules: DoARule[],
  facts: DoAFacts,
  options: { rankOverride?: boolean; upliftLevels?: number } = {},
): SimulationResult {
  const trace: SimulationResult['trace'] = [];
  let matched: DoARule | null = null;

  for (const rule of rules) {
    const inValue = facts.value >= rule.minValue && (rule.maxValue === null || facts.value <= rule.maxValue);
    const inCategory = rule.category === null || rule.category === facts.category;
    const inBu = rule.businessUnit === null || rule.businessUnit === facts.businessUnit;
    const isMatch = inValue && inCategory && inBu;

    const reasons: string[] = [];
    if (!inValue) reasons.push(`value ${facts.value.toLocaleString()} outside ${rule.minValue.toLocaleString()}–${rule.maxValue?.toLocaleString() ?? '∞'}`);
    if (!inCategory) reasons.push(`category is ${facts.category}, rule wants ${rule.category}`);
    if (!inBu) reasons.push(`BU is ${facts.businessUnit}, rule wants ${rule.businessUnit}`);

    trace.push({
      rule,
      matched: isMatch,
      reason: isMatch ? 'All dimensions match.' : reasons.join('; '),
    });
    if (isMatch && matched === null) matched = rule;
  }

  let chain = matched ? [...matched.levels] : [];

  // Awarding other than the top-ranked bidder applies the uplift automatically.
  const uplift = options.rankOverride ? (options.upliftLevels ?? 1) : 0;
  if (uplift > 0 && chain.length > 0) {
    const top = chain[chain.length - 1];
    for (let i = 1; i <= uplift; i += 1) {
      chain.push({
        level: top.level + i,
        role: `${top.role} (uplift)`,
        holderName: 'Escalated approver',
        slaHours: top.slaHours,
      });
    }
  }

  return {
    matchedRule: matched,
    trace,
    chain,
    upliftApplied: uplift > 0,
    totalSlaHours: chain.reduce((a, l) => a + l.slaHours, 0),
  };
}

export function buildApprovalSteps(
  nfaId: Id,
  chain: SimulationResult['chain'],
): ApprovalStep[] {
  return chain.map((level, i) => ({
    id: `${nfaId}-step-${i + 1}`,
    nfaId,
    level: level.level,
    holderId: `user-${level.holderName.replace(/\s+/g, '-').toLowerCase()}`,
    holderName: level.holderName,
    role: level.role,
    slaHours: level.slaHours,
    decision: 'PENDING',
    comment: null,
    decidedAt: null,
  }));
}

/**
 * Hard rule: no user may hold both `recommend_award` and the final
 * `approve_at_level_n` on the same event.
 */
export function separationOfDutiesBreach(
  recommendedBy: Id,
  steps: ApprovalStep[],
): { breach: boolean; message: string | null } {
  const finalStep = steps[steps.length - 1];
  if (finalStep && finalStep.holderId === recommendedBy) {
    return {
      breach: true,
      message: 'The user who recommended this award also holds the final approval. Separation of duties requires a different approver.',
    };
  }
  return { breach: false, message: null };
}

export interface SlaStatus {
  level: number;
  state: 'COMPLETE' | 'CURRENT' | 'PENDING';
  hoursElapsed: number | null;
  overdue: boolean;
}

export function slaStatuses(steps: ApprovalStep[], now: ServerMillis): SlaStatus[] {
  let reachedCurrent = false;
  return steps.map((step) => {
    if (step.decision === 'APPROVED') {
      return { level: step.level, state: 'COMPLETE' as const, hoursElapsed: null, overdue: false };
    }
    if (!reachedCurrent) {
      reachedCurrent = true;
      const since = step.decidedAt ?? now - 1000 * 60 * 60 * 30;
      const hours = (now - since) / (1000 * 60 * 60);
      return {
        level: step.level,
        state: 'CURRENT' as const,
        hoursElapsed: hours,
        overdue: hours > step.slaHours,
      };
    }
    return { level: step.level, state: 'PENDING' as const, hoursElapsed: null, overdue: false };
  });
}
