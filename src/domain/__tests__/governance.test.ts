/**
 * Governance: configuration resolution, DoA, separation of duties, the agent
 * hard limits, savings, journey patterns and the envelope seal.
 *
 * Several of these assert that something is *impossible* rather than merely
 * discouraged, which is the whole point of putting them in the domain layer.
 */
import { describe, expect, it } from 'vitest';
import { TENANT_DEFAULTS, resolve } from '../config';
import { buildApprovalSteps, separationOfDutiesBreach, simulate, slaStatuses } from '../doa';
import { checkSeparation } from '../permissions';
import {
  AGENT_HARD_LIMITS, AgentLimitError, ALL_AGENTS, assertAgentMayNot,
  checkMandate, DEFAULT_MANDATE, effectiveAutonomy,
} from '../agents';
import { computeSavingsLine, detectBaselineAnomalies, totalSavings } from '../savings';
import {
  JOURNEY_PATTERNS, buildStageRail, evaluateTransition, patternsForSide,
  vendorTaskLabel, workspaceTabs,
} from '../journeyPatterns';
import { canTransitionEvent, nextEventStatuses } from '../statusMachine';
import {
  SealedEnvelopeError, isReadableCommercial, projectCommercial, projectTechnical,
  unlockCommercial, type ViewerContext,
} from '../../server/envelopeGuard';
import type {
  ApprovalStep, ConfigSetting, DoARule, Envelope, Question, Response, SavingsLine,
} from '../types';

// ---------------------------------------------------------------------------
// Configuration scopes
// ---------------------------------------------------------------------------

describe('config resolve', () => {
  const lineage = { tenantId: 't1', categoryId: 'Indirect', templateId: 'tpl1', eventId: 'evt1' };

  function setting(overrides: Partial<ConfigSetting>): ConfigSetting {
    return {
      key: 'auction.feedback_policy', scopeType: 'TENANT', scopeId: 't1',
      value: 'BEST_PRICE', isLocked: false, setBy: 'u1', setAt: 0,
      ...overrides,
    };
  }

  it('lets the narrowest scope that defines a value win', () => {
    const settings = [
      setting({ scopeType: 'TENANT', scopeId: 't1', value: 'BEST_PRICE' }),
      setting({ scopeType: 'CATEGORY', scopeId: 'Indirect', value: 'RANK_ONLY' }),
      setting({ scopeType: 'EVENT', scopeId: 'evt1', value: 'RANK_GAP' }),
    ];
    const resolved = resolve('auction.feedback_policy', settings, lineage, 'BLIND');
    expect(resolved.value).toBe('RANK_GAP');
    expect(resolved.resolvedFrom).toBe('EVENT');
  });

  it('lets a lock at a broader scope beat every narrower setting', () => {
    const settings = [
      setting({ scopeType: 'TENANT', scopeId: 't1', value: 'BLIND', isLocked: true }),
      setting({ scopeType: 'EVENT', scopeId: 'evt1', value: 'FULL_PRICE' }),
    ];
    const resolved = resolve('auction.feedback_policy', settings, lineage, 'BEST_PRICE');
    expect(resolved.value).toBe('BLIND');
    expect(resolved.isLocked).toBe(true);
    expect(resolved.lockedBy).toBe('TENANT');
  });

  it('falls back to the supplied default when nothing is set', () => {
    const resolved = resolve('auction.feedback_policy', [], lineage, 'BEST_PRICE');
    expect(resolved.value).toBe('BEST_PRICE');
  });

  it('always returns the full chain, so a screen can show provenance', () => {
    const resolved = resolve('auction.feedback_policy', [
      setting({ scopeType: 'CATEGORY', scopeId: 'Indirect', value: 'RANK_ONLY' }),
    ], lineage, 'BEST_PRICE');
    expect(resolved.chain.map((link) => link.scopeType)).toEqual([
      'TENANT', 'CATEGORY', 'TEMPLATE', 'EVENT',
    ]);
    expect(resolved.chain.find((l) => l.scopeType === 'CATEGORY')?.value).toBe('RANK_ONLY');
    expect(resolved.chain.find((l) => l.scopeType === 'EVENT')?.value).toBeUndefined();
  });

  it('ignores a setting scoped to a different id', () => {
    const resolved = resolve('auction.feedback_policy', [
      setting({ scopeType: 'CATEGORY', scopeId: 'IT', value: 'FULL_PRICE' }),
    ], lineage, 'BEST_PRICE');
    expect(resolved.value).toBe('BEST_PRICE');
  });

  it('ships safe tenant defaults', () => {
    expect(TENANT_DEFAULTS['auction.disclose_target']).toBe(false);
    expect(TENANT_DEFAULTS['evaluation.blind_technical']).toBe(true);
    expect(TENANT_DEFAULTS['evaluation.envelope_mode']).toBe('TWO_ENVELOPE');
    expect(TENANT_DEFAULTS['counterparty.provisional_award_allowed']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DoA
// ---------------------------------------------------------------------------

describe('DoA simulate', () => {
  const rules: DoARule[] = [
    {
      id: 'r1', name: 'Indirect to 50k', minValue: 0, maxValue: 50_000,
      category: 'Indirect', businessUnit: null, chainMode: 'SEQUENTIAL',
      levels: [{ level: 1, role: 'Category Manager', holderName: 'A', slaHours: 24 }],
    },
    {
      id: 'r2', name: 'Indirect 50k-250k', minValue: 50_000, maxValue: 250_000,
      category: 'Indirect', businessUnit: null, chainMode: 'SEQUENTIAL',
      levels: [
        { level: 1, role: 'Category Manager', holderName: 'A', slaHours: 24 },
        { level: 2, role: 'Head of Procurement', holderName: 'B', slaHours: 24 },
      ],
    },
  ];

  it('matches on value and category, and reports the chain', () => {
    const result = simulate(rules, { value: 150_000, category: 'Indirect', businessUnit: 'CS' });
    expect(result.matchedRule?.id).toBe('r2');
    expect(result.chain).toHaveLength(2);
    expect(result.totalSlaHours).toBe(48);
  });

  it('explains why each rule did not match', () => {
    const result = simulate(rules, { value: 150_000, category: 'Indirect', businessUnit: 'CS' });
    const missed = result.trace.find((t) => t.rule.id === 'r1');
    expect(missed?.matched).toBe(false);
    expect(missed?.reason).toContain('outside');
  });

  it('matches nothing when no rule covers the facts', () => {
    const result = simulate(rules, { value: 900_000, category: 'IT', businessUnit: 'Tech' });
    expect(result.matchedRule).toBeNull();
    expect(result.chain).toHaveLength(0);
  });

  it('adds an uplift level when awarding other than rank 1', () => {
    const plain = simulate(rules, { value: 150_000, category: 'Indirect', businessUnit: 'CS' });
    const uplifted = simulate(
      rules, { value: 150_000, category: 'Indirect', businessUnit: 'CS' },
      { rankOverride: true, upliftLevels: 1 },
    );
    expect(uplifted.chain).toHaveLength(plain.chain.length + 1);
    expect(uplifted.upliftApplied).toBe(true);
    expect(uplifted.chain[uplifted.chain.length - 1].role).toContain('uplift');
  });

  it('does not uplift a normal award', () => {
    const result = simulate(rules, { value: 150_000, category: 'Indirect', businessUnit: 'CS' });
    expect(result.upliftApplied).toBe(false);
  });

  it('includes the boundary value in the band', () => {
    expect(simulate(rules, { value: 50_000, category: 'Indirect', businessUnit: 'CS' }).matchedRule?.id)
      .toBe('r1');
  });
});

describe('separation of duties', () => {
  it('blocks the recommender from holding the final approval', () => {
    const steps = buildApprovalSteps('nfa1', [
      { level: 1, role: 'Category Manager', holderName: 'A Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M Prasad', slaHours: 24 },
    ]);
    const finalHolder = steps[steps.length - 1].holderId;
    expect(separationOfDutiesBreach(finalHolder, steps).breach).toBe(true);
    expect(separationOfDutiesBreach('user-someone-else', steps).breach).toBe(false);
  });

  it('forbids score_technical and view_commercial together under two envelopes', () => {
    const breaches = checkSeparation(['score_technical', 'view_commercial'], 'TWO_ENVELOPE');
    expect(breaches.some((b) => b.rule === 'envelope_separation')).toBe(true);
  });

  it('permits the same pair under a single envelope', () => {
    const breaches = checkSeparation(['score_technical', 'view_commercial'], 'SINGLE');
    expect(breaches.some((b) => b.rule === 'envelope_separation')).toBe(false);
  });

  it('forbids recommend_award and approve_at_level together on any mode', () => {
    for (const mode of ['SINGLE', 'TWO_ENVELOPE'] as const) {
      const breaches = checkSeparation(['recommend_award', 'approve_at_level'], mode);
      expect(breaches.some((b) => b.rule === 'award_separation')).toBe(true);
    }
  });
});

describe('slaStatuses', () => {
  const now = 1_700_000_000_000;

  function step(overrides: Partial<ApprovalStep>): ApprovalStep {
    return {
      id: 's1', nfaId: 'n1', level: 1, holderId: 'u1', holderName: 'A', role: 'CM',
      slaHours: 24, decision: 'PENDING', comment: null, decidedAt: null,
      ...overrides,
    };
  }

  it('marks approved levels complete and the first pending level current', () => {
    const statuses = slaStatuses([
      step({ level: 1, decision: 'APPROVED' }),
      step({ level: 2 }),
      step({ level: 3 }),
    ], now);
    expect(statuses.map((s) => s.state)).toEqual(['COMPLETE', 'CURRENT', 'PENDING']);
  });

  it('flags the current level as overdue past its SLA', () => {
    const statuses = slaStatuses([step({ slaHours: 24, decidedAt: now - 30 * 3_600_000 })], now);
    expect(statuses[0].overdue).toBe(true);
  });

  it('does not flag a level inside its SLA', () => {
    const statuses = slaStatuses([step({ slaHours: 48, decidedAt: now - 2 * 3_600_000 })], now);
    expect(statuses[0].overdue).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

describe('agent hard limits', () => {
  it('throws for every forbidden action — there is no flag that permits them', () => {
    const actions = [
      'APPROVE_DOA_STEP', 'FINAL_AWARD', 'MUTATE_BID', 'DISQUALIFY_COUNTERPARTY',
      'RELEASE_PO', 'OVERRIDE_STATUTORY', 'CONTROL_AUCTION_UNCONFIRMED',
      'CHANGE_PRICE_CONTROL_UNCONFIRMED',
    ] as const;
    for (const action of actions) {
      expect(() => assertAgentMayNot(action)).toThrow(AgentLimitError);
    }
  });

  it('documents exactly eight hard limits', () => {
    expect(AGENT_HARD_LIMITS).toHaveLength(8);
  });

  it('caps the auction and award agents at Suggest', () => {
    expect(ALL_AGENTS.find((a) => a.code === 'AG-10')?.maxAutonomy).toBe('SUGGEST');
    expect(ALL_AGENTS.find((a) => a.code === 'AG-11')?.maxAutonomy).toBe('SUGGEST');
  });

  it('defines sixteen agents, each with a mandate and stated limits', () => {
    expect(ALL_AGENTS).toHaveLength(16);
    for (const agent of ALL_AGENTS) {
      expect(agent.mandate.length).toBeGreaterThan(10);
      expect(agent.cannot.length).toBeGreaterThan(0);
    }
  });
});

describe('effectiveAutonomy', () => {
  const auctionAgent = ALL_AGENTS.find((a) => a.code === 'AG-10')!;
  const clarificationAgent = ALL_AGENTS.find((a) => a.code === 'AG-05')!;

  it('caps a request above the agent maximum', () => {
    expect(effectiveAutonomy('AUTONOMOUS', auctionAgent, null, 0.75)).toBe('SUGGEST');
    expect(effectiveAutonomy('AUTONOMOUS', clarificationAgent, null, 0.75)).toBe('DRAFT');
  });

  it('degrades an acting agent below its confidence threshold', () => {
    const evaluation = ALL_AGENTS.find((a) => a.code === 'AG-06')!;
    expect(effectiveAutonomy('ACT_WITH_APPROVAL', evaluation, 0.4, 0.75)).toBe('SUGGEST');
    expect(effectiveAutonomy('ACT_WITH_APPROVAL', evaluation, 0.9, 0.75)).toBe('ACT_WITH_APPROVAL');
  });

  it('leaves Off alone', () => {
    expect(effectiveAutonomy('OFF', auctionAgent, 0.99, 0.75)).toBe('OFF');
  });
});

describe('checkMandate', () => {
  it('passes a within-mandate action', () => {
    const result = checkMandate(DEFAULT_MANDATE, {
      value: 100_000, category: 'Indirect', roundNumber: 1, confidence: 0.9, proposedPrice: null,
    });
    expect(result.withinMandate).toBe(true);
  });

  it('breaches on value, category, rounds and confidence, and says which', () => {
    const result = checkMandate(DEFAULT_MANDATE, {
      value: 900_000, category: 'Aerospace', roundNumber: 9, confidence: 0.2, proposedPrice: null,
    });
    expect(result.withinMandate).toBe(false);
    expect(result.breaches).toHaveLength(4);
  });

  it('breaches when a proposal is below the mandate floor', () => {
    const result = checkMandate(
      { ...DEFAULT_MANDATE, priceFloor: 100_000 },
      { value: 10_000, category: 'Indirect', roundNumber: 1, confidence: 0.9, proposedPrice: 90_000 },
    );
    expect(result.breaches.some((b) => b.includes('floor'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

describe('savings', () => {
  function line(overrides: Partial<SavingsLine> = {}): SavingsLine {
    return computeSavingsLine({
      lineItemId: 'li1', lotName: 'Lot 1', description: 'Paper',
      quantity: 1_000, awardedUnitPrice: 8, baselineUnitPrice: 10, baselineSource: 'LPP',
      ...overrides,
    });
  }

  it('computes negotiated savings at line level against the baseline', () => {
    expect(line().negotiatedSavings).toBe(2_000);
  });

  it('leaves realised savings null until a post-GRN price is known', () => {
    expect(line().realisedSavings).toBeNull();
    const realised = computeSavingsLine({
      lineItemId: 'li1', lotName: 'Lot 1', description: 'Paper',
      quantity: 1_000, awardedUnitPrice: 8, baselineUnitPrice: 10, baselineSource: 'LPP',
    }, 8.5);
    expect(realised.realisedSavings).toBe(1_500);
  });

  it('reports a negative saving rather than clamping it to zero', () => {
    const overspend = line({ awardedUnitPrice: 12 });
    expect(overspend.negotiatedSavings).toBe(-2_000);
    const totals = totalSavings([overspend]);
    expect(totals.negativeLines).toHaveLength(1);
    expect(totals.negotiatedSavings).toBeLessThan(0);
  });

  it('treats a missing baseline as no claimable saving', () => {
    expect(line({ baselineUnitPrice: null, baselineSource: null }).negotiatedSavings).toBe(0);
  });

  it('keeps realised savings pending until every line has a figure', () => {
    const totals = totalSavings([line(), line({ lineItemId: 'li2' })]);
    expect(totals.realisedPending).toBe(true);
    expect(totals.realisedSavings).toBeNull();
  });

  it('flags a missing baseline and a baseline far above market', () => {
    const anomalies = detectBaselineAnomalies(
      [line({ baselineUnitPrice: 30 }), line({ lineItemId: 'li2', baselineUnitPrice: null, baselineSource: null })],
      { li1: 10, li2: 10 },
    );
    expect(anomalies).toHaveLength(2);
    expect(anomalies.some((a) => a.detail.includes('no baseline'))).toBe(true);
    expect(anomalies.some((a) => a.detail.includes('above market median'))).toBe(true);
  });

  it('does not flag a baseline inside tolerance', () => {
    expect(detectBaselineAnomalies([line({ baselineUnitPrice: 11 })], { li1: 10 })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Journey patterns and the stage rail
// ---------------------------------------------------------------------------

describe('journey patterns', () => {
  it('defines all thirteen', () => {
    expect(Object.keys(JOURNEY_PATTERNS)).toHaveLength(13);
  });

  it('has the boundary cases the layouts must survive', () => {
    // JP-01 is the minimal path; JP-05 is the maximal one.
    expect(JOURNEY_PATTERNS['JP-01'].stages.length).toBeLessThanOrEqual(4);
    expect(JOURNEY_PATTERNS['JP-05'].stages.length).toBeGreaterThanOrEqual(8);
  });

  it('offers sell-side patterns only on the sell side', () => {
    const sell = patternsForSide('SELL');
    expect(sell.map((p) => p.id).sort()).toEqual(['JP-12', 'JP-13']);
    expect(patternsForSide('BUY').every((p) => p.side === 'BUY')).toBe(true);
  });

  it('reshapes the wizard between four and nine steps', () => {
    expect(JOURNEY_PATTERNS['JP-08'].wizardSteps.length).toBeLessThanOrEqual(4);
    expect(JOURNEY_PATTERNS['JP-05'].wizardSteps.length).toBe(9);
  });

  it('names supplier tasks by what the supplier does', () => {
    expect(vendorTaskLabel('RFQ')).toBe('Submit your prices');
    expect(vendorTaskLabel('AUCTION')).toBe('Bid live');
    // No buyer stage name leaks into the label.
    expect(vendorTaskLabel('RFP')).not.toContain('RFP');
  });

  it('has a pattern with no supplier input at all', () => {
    expect(JOURNEY_PATTERNS['JP-08'].vendorInputPoints).toHaveLength(0);
  });
});

describe('buildStageRail', () => {
  it('marks stages done, current and pending in order', () => {
    const rail = buildStageRail(['INTAKE', 'RFQ', 'EVALUATION', 'AWARD'], 'EVALUATION');
    expect(rail.map((i) => i.state)).toEqual(['DONE', 'DONE', 'CURRENT', 'PENDING']);
  });

  it('shows a skipped stage rather than hiding it, with its reason', () => {
    const rail = buildStageRail(
      ['INTAKE', 'AUCTION', 'AWARD'], 'AUCTION',
      [], { RFQ: 'Not part of Direct Auction from PR' },
    );
    const skipped = rail.find((i) => i.stage === 'RFQ');
    expect(skipped?.state).toBe('SKIPPED');
    expect(skipped?.note).toContain('Not part of');
  });

  it('marks a future conditional stage as conditional, not pending', () => {
    const rail = buildStageRail(
      ['INTAKE', 'RFQ', 'NEGOTIATION', 'AUCTION', 'AWARD'], 'NEGOTIATION', ['AUCTION'],
    );
    expect(rail.find((i) => i.stage === 'AUCTION')?.state).toBe('CONDITIONAL');
  });
});

describe('workspaceTabs', () => {
  it('drops the tabs a minimal pattern has no use for', () => {
    const tabs = workspaceTabs(JOURNEY_PATTERNS['JP-01'].stages);
    expect(tabs).toContain('Auction');
    expect(tabs).not.toContain('Questionnaire');
    expect(tabs).not.toContain('Negotiation');
  });

  it('includes the full set for the full ladder', () => {
    const tabs = workspaceTabs(JOURNEY_PATTERNS['JP-05'].stages);
    for (const expected of ['Questionnaire', 'Bidders', 'Responses', 'Evaluation', 'Auction', 'Award']) {
      expect(tabs).toContain(expected);
    }
  });

  it('always ends with Activity, so the audit trail is never unreachable', () => {
    for (const pattern of Object.values(JOURNEY_PATTERNS)) {
      expect(workspaceTabs(pattern.stages).at(-1)).toBe('Activity');
    }
  });
});

describe('evaluateTransition', () => {
  const facts = {
    qualifiedBidderCount: 4, estimatedValue: 150_000,
    bestBid: 145_000, targetPrice: 138_000, technicalQualifiedCount: 3,
  };

  it('resolves a bidder-count gate', () => {
    expect(evaluateTransition({ kind: 'QUALIFIED_BIDDER_COUNT', operator: '>=', value: 3 }, facts).met).toBe(true);
    expect(evaluateTransition({ kind: 'QUALIFIED_BIDDER_COUNT', operator: '>=', value: 5 }, facts).met).toBe(false);
  });

  it('resolves a best-bid-versus-target gate', () => {
    // 145,000 > 138,000 x 1.05 (144,900), so an auction is warranted.
    expect(evaluateTransition({ kind: 'BEST_BID_VS_TARGET', multiplier: 1.05 }, facts).met).toBe(true);
    expect(evaluateTransition({ kind: 'BEST_BID_VS_TARGET', multiplier: 1.2 }, facts).met).toBe(false);
  });

  it('cannot resolve a price gate before the facts exist', () => {
    const result = evaluateTransition(
      { kind: 'BEST_BID_VS_TARGET', multiplier: 1.05 },
      { ...facts, bestBid: null },
    );
    expect(result.met).toBe(false);
    expect(result.explanation).toContain('not yet known');
  });

  it('always explains itself', () => {
    const result = evaluateTransition({ kind: 'ESTIMATED_VALUE', operator: '>', value: 100_000 }, facts);
    expect(result.met).toBe(true);
    expect(result.explanation).toContain('estimated_value');
  });
});

// ---------------------------------------------------------------------------
// Event status machine
// ---------------------------------------------------------------------------

describe('event status machine', () => {
  it('permits the ordinary forward path', () => {
    expect(canTransitionEvent('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransitionEvent('OPEN', 'RESPONSES_CLOSED')).toBe(true);
    expect(canTransitionEvent('UNDER_EVALUATION', 'AUCTION_SCHEDULED')).toBe(true);
    expect(canTransitionEvent('AWARD_RECOMMENDED', 'PENDING_AWARD_APPROVAL')).toBe(true);
  });

  it('refuses to skip the governed steps', () => {
    expect(canTransitionEvent('DRAFT', 'AWARDED')).toBe(false);
    expect(canTransitionEvent('AUCTION_LIVE', 'AWARDED')).toBe(false);
    // An auction result is a recommendation; award is separate.
    expect(canTransitionEvent('AUCTION_CLOSED', 'AWARDED')).toBe(false);
  });

  it('allows ON_HOLD from a live state and back out again', () => {
    expect(canTransitionEvent('OPEN', 'ON_HOLD')).toBe(true);
    expect(canTransitionEvent('ON_HOLD', 'OPEN')).toBe(true);
  });

  it('treats CLOSED and CANCELLED as terminal', () => {
    expect(canTransitionEvent('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionEvent('CANCELLED', 'DRAFT')).toBe(false);
    expect(canTransitionEvent('CLOSED', 'ON_HOLD')).toBe(false);
  });

  it('offers ON_HOLD alongside the forward options from a live state', () => {
    expect(nextEventStatuses('OPEN')).toContain('ON_HOLD');
    expect(nextEventStatuses('CLOSED')).not.toContain('ON_HOLD');
  });

  it('routes negotiation back to itself, because rounds repeat', () => {
    expect(canTransitionEvent('IN_NEGOTIATION', 'IN_NEGOTIATION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Envelope seal
// ---------------------------------------------------------------------------

describe('envelope guard', () => {
  const questions: Question[] = [
    {
      id: 'q1', questionnaireId: 'qn1', sectionId: null, sequence: 1, code: 'TECH',
      type: 'short_text', title: 'Capability', helpText: '', isRequired: true,
      envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
      rubric: null, isKnockout: false, allowAttachment: true,
    },
    {
      id: 'q2', questionnaireId: 'qn1', sectionId: null, sequence: 2, code: 'COMM',
      type: 'number', title: 'Payment terms', helpText: '', isRequired: true,
      envelope: 'COMMERCIAL', weight: 10, scoringMethod: 'RULE', maxScore: 10,
      rubric: null, isKnockout: false, allowAttachment: false,
    },
  ];

  const response: Response = {
    id: 'r1', eventId: 'evt1', bidderId: 'b1', version: 1, submittedAt: 0,
    answers: [
      { questionId: 'q1', value: 'We operate three plants', attachmentName: 'ABC-Supplies-capability.pdf' },
      { questionId: 'q2', value: 60, attachmentName: null },
    ],
    priceLines: [{ lineItemId: 'li1', unitPrice: 8.2, currency: 'USD', leadTimeDays: 4, notes: null }],
  };

  function envelope(overrides: Partial<Envelope> = {}): Envelope {
    return {
      id: 'env1', eventId: 'evt1', bidderId: 'b1', kind: 'COMMERCIAL',
      status: 'SEALED', sealed: true, submittedAt: 0,
      unlockedAt: null, unlockedBy: null, witnesses: [],
      ...overrides,
    };
  }

  const evaluator: ViewerContext = {
    userId: 'u-eval', permissions: ['score_technical'],
    envelopeMode: 'TWO_ENVELOPE', blindTechnical: true,
  };
  const commercial: ViewerContext = {
    userId: 'u-comm', permissions: ['view_commercial', 'unlock_commercial'],
    envelopeMode: 'TWO_ENVELOPE', blindTechnical: false,
  };

  it('never puts a commercial answer or a price in the technical projection', () => {
    const projection = projectTechnical(response, questions, 'ABC Supplies Co.', 'Bidder A', evaluator);
    expect(projection.answers.map((a) => a.questionId)).toEqual(['q1']);
    expect(JSON.stringify(projection)).not.toContain('60');
    expect(JSON.stringify(projection)).not.toContain('8.2');
  });

  it('masks the bidder name under blind technical', () => {
    const blind = projectTechnical(response, questions, 'ABC Supplies Co.', 'Bidder A', evaluator);
    expect(blind.displayLabel).toBe('Bidder A');
    const named = projectTechnical(response, questions, 'ABC Supplies Co.', 'Bidder A', {
      ...evaluator, blindTechnical: false,
    });
    expect(named.displayLabel).toBe('ABC Supplies Co.');
  });

  it('warns when an attachment filename would break blind evaluation', () => {
    const projection = projectTechnical(response, questions, 'ABC Supplies Co.', 'Bidder A', evaluator);
    expect(projection.attachmentIdentityWarnings).toHaveLength(1);
    expect(projection.attachmentIdentityWarnings[0]).toContain('ABC-Supplies-capability.pdf');
  });

  it('refuses a sealed commercial read for any viewer, including a privileged one', () => {
    expect(() => projectCommercial(response, questions, envelope(), 'ABC', commercial))
      .toThrow(SealedEnvelopeError);
    // A platform administrator has no back door either.
    expect(() => projectCommercial(response, questions, envelope(), 'ABC', {
      ...commercial, permissions: ['view_commercial', 'unlock_commercial', 'configure_tenant'],
    })).toThrow(SealedEnvelopeError);
  });

  it('refuses a read from a viewer without view_commercial even once unlocked', () => {
    expect(() => projectCommercial(
      response, questions, envelope({ sealed: false, status: 'UNLOCKED' }), 'ABC', evaluator,
    )).toThrow(SealedEnvelopeError);
  });

  it('returns prices once unlocked to a permitted viewer', () => {
    const projection = projectCommercial(
      response, questions, envelope({ sealed: false, status: 'UNLOCKED' }), 'ABC', commercial,
    );
    expect(projection.priceLines).toHaveLength(1);
    expect(projection.answers.map((a) => a.questionId)).toEqual(['q2']);
  });

  it('reports readability without throwing, for rendering the sealed state', () => {
    expect(isReadableCommercial(envelope(), commercial)).toBe(false);
    expect(isReadableCommercial(envelope({ sealed: false }), commercial)).toBe(true);
    expect(isReadableCommercial(envelope({ sealed: false }), evaluator)).toBe(false);
  });

  it('unlocks irreversibly and records the witnesses', () => {
    const result = unlockCommercial({
      envelope: envelope(), mode: 'MANUAL_WITH_WITNESS', actorId: 'u-comm',
      witnessIds: ['u-mp'], permissions: commercial.permissions, eventId: 'evt1',
    });
    expect(result.envelope.sealed).toBe(false);
    expect(result.envelope.status).toBe('UNLOCKED');
    expect(result.envelope.unlockedBy).toBe('u-comm');
    expect(result.envelope.witnesses).toEqual(['u-mp']);
  });

  it('refuses a witnessed unlock with no witness', () => {
    expect(() => unlockCommercial({
      envelope: envelope(), mode: 'MANUAL_WITH_WITNESS', actorId: 'u-comm',
      witnessIds: [], permissions: commercial.permissions, eventId: 'evt1',
    })).toThrow(/witness/i);
  });

  it('refuses an unlock without the unlock permission', () => {
    expect(() => unlockCommercial({
      envelope: envelope(), mode: 'MANUAL', actorId: 'u-eval',
      witnessIds: [], permissions: ['score_technical'], eventId: 'evt1',
    })).toThrow(/unlock_commercial/);
  });

  it('reads commercial content freely under a single envelope', () => {
    const single: ViewerContext = { ...commercial, envelopeMode: 'SINGLE' };
    const projection = projectCommercial(response, questions, envelope(), 'ABC', single);
    expect(projection.priceLines).toHaveLength(1);
  });
});
