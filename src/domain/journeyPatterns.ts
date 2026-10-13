/**
 * Journey patterns — the named, pre-configured stage graphs.
 *
 * A client's process is a stage graph declared in a template, not a hard-coded
 * sequence. Every screen must render correctly when the stages before it did
 * not happen: JP-01 (three stages) and JP-05 (eight) are the boundary cases.
 */
import type { JourneyPattern, JourneyPatternId, Stage, VendorInputPoint } from './types';

export const WIZARD_BASICS = 'Basics';
export const WIZARD_ITEMS = 'Items & Lots';
export const WIZARD_BIDDERS = 'Bidders';
export const WIZARD_QUESTIONNAIRE = 'Questionnaire';
export const WIZARD_TERMS = 'Terms';
export const WIZARD_EVALUATION = 'Evaluation';
export const WIZARD_AUCTION = 'Auction';
export const WIZARD_TIMELINE = 'Timeline';
export const WIZARD_REVIEW = 'Review';

/**
 * Every pattern that asks a supplier for anything carries a Terms step.
 *
 * Publishing is blocked when an ask goes out with no terms attached, so a
 * pattern with vendor input points and no step to attach them at cannot be
 * published at all. `journeyPatterns.test.ts` holds that invariant.
 */
export const JOURNEY_PATTERNS: Record<JourneyPatternId, JourneyPattern> = {
  'JP-01': {
    id: 'JP-01', name: 'Direct Auction from PR',
    description: 'PR straight to a live reverse auction. The indicative PR price becomes the auction start price.',
    stages: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['INTAKE', 'AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_TERMS, WIZARD_AUCTION, WIZARD_REVIEW],
    typicalDuration: '10 min', serves: 'Speed',
  },
  'JP-02': {
    id: 'JP-02', name: 'Simple RFQ',
    description: 'Quote, compare, award. The volume workhorse.',
    stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFQ'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '3 days', serves: 'The volume workhorse',
  },
  'JP-03': {
    id: 'JP-03', name: 'RFQ then Auction',
    description: 'RFQ sets the field; the auction compresses price.',
    stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFQ', 'AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_AUCTION, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '5 days', serves: 'RFQ sets the field; auction compresses price',
  },
  'JP-04': {
    id: 'JP-04', name: 'RFQ → Negotiate → conditional Auction',
    description: 'The most common enterprise pattern. The auction runs only if the condition gate is met.',
    stages: ['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFQ', 'NEGOTIATION', 'AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_EVALUATION, WIZARD_AUCTION, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '2 weeks', serves: 'Most common enterprise pattern',
  },
  'JP-05': {
    id: 'JP-05', name: 'Full Ladder',
    description: 'RFI → RFP → RFQ → auction. High-value strategic tender.',
    stages: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_EVALUATION, WIZARD_AUCTION, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '3 weeks', serves: 'High-value strategic tender',
  },
  'JP-06': {
    id: 'JP-06', name: 'Two-Envelope Tender',
    description: 'Sealed commercial until the technical evaluation completes. Public-sector style.',
    stages: ['INTAKE', 'RFP', 'EVALUATION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFP'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_EVALUATION, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '4 weeks', serves: 'Public-sector style',
  },
  'JP-07': {
    id: 'JP-07', name: 'PR with Vendor Quote',
    description: 'Requisitioners already hold quotes. No solicitation stage runs.',
    stages: ['INTAKE', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['INTAKE'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_TERMS, WIZARD_REVIEW],
    typicalDuration: '1 day', serves: 'Requisitioners already hold quotes',
  },
  'JP-08': {
    id: 'JP-08', name: 'Rate Contract Call-off',
    description: 'No competition. Call off against an existing rate contract.',
    stages: ['INTAKE', 'AWARD', 'APPROVAL'],
    vendorInputPoints: [],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_REVIEW],
    typicalDuration: '1 hour', serves: 'No competition',
  },
  'JP-09': {
    id: 'JP-09', name: 'Re-auction on Balance Quantity',
    description: 'Triggered by a short-closed PO. Links to the parent event.',
    stages: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_TERMS, WIZARD_AUCTION, WIZARD_REVIEW],
    typicalDuration: '2 days', serves: 'Short-closed PO balance',
  },
  'JP-10': {
    id: 'JP-10', name: 'Rate Refresh / Expiry-triggered',
    description: 'Auto-intake on contract expiry or index drift.',
    stages: ['INTAKE', 'RFQ', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFQ', 'AUCTION'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_TERMS, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '1 week', serves: 'Contract expiry or index drift',
  },
  'JP-11': {
    id: 'JP-11', name: 'Spot Buy',
    description: 'Tail spend with heavy agent assistance.',
    stages: ['INTAKE', 'RFQ', 'AWARD'],
    vendorInputPoints: ['RFQ'],
    side: 'BUY',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_TERMS, WIZARD_REVIEW],
    typicalDuration: '4 hours', serves: 'Tail spend',
  },
  'JP-12': {
    id: 'JP-12', name: 'Forward Auction (Disposal)',
    description: 'Sell-side. Scrap and surplus — highest bid wins.',
    stages: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['AUCTION'],
    side: 'SELL',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_TERMS, WIZARD_AUCTION, WIZARD_REVIEW],
    typicalDuration: '1 week', serves: 'Scrap and surplus',
  },
  'JP-13': {
    id: 'JP-13', name: 'Forward RFQ + Auction (Sales)',
    description: 'Sell-side structured sales process.',
    stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    vendorInputPoints: ['RFQ', 'AUCTION'],
    side: 'SELL',
    wizardSteps: [WIZARD_BASICS, WIZARD_ITEMS, WIZARD_BIDDERS, WIZARD_QUESTIONNAIRE, WIZARD_TERMS, WIZARD_AUCTION, WIZARD_TIMELINE, WIZARD_REVIEW],
    typicalDuration: '2 weeks', serves: 'Structured sales process',
  },
};

export const ALL_PATTERNS = Object.values(JOURNEY_PATTERNS);

export function patternsForSide(side: 'BUY' | 'SELL'): JourneyPattern[] {
  return ALL_PATTERNS.filter((p) => p.side === side || p.side === 'ANY');
}

/** Stage order for the rail. Stages not in the pattern render as skipped. */
export const STAGE_ORDER: Stage[] = [
  'INTAKE', 'RFI', 'RFP', 'RFQ', 'CLARIFICATION',
  'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL',
];

export const STAGE_LABELS: Record<Stage, string> = {
  INTAKE: 'Intake',
  RFI: 'RFI',
  RFP: 'RFP',
  RFQ: 'RFQ',
  CLARIFICATION: 'Clarifications',
  EVALUATION: 'Evaluation',
  NEGOTIATION: 'Negotiation',
  AUCTION: 'Auction',
  AWARD: 'Award',
  APPROVAL: 'Approval',
};

export type StageRailState = 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED' | 'CONDITIONAL';

export interface StageRailItem {
  stage: Stage;
  label: string;
  state: StageRailState;
  /** Why a stage was skipped — carried into NFA section 3. */
  note: string | null;
}

/**
 * The stage rail. Skipped stages are shown, not hidden — the NFA must record
 * every stage that did not happen along with its reason.
 */
export function buildStageRail(
  stagesEnabled: Stage[],
  currentStage: Stage,
  conditionalStages: Stage[] = [],
  skipReasons: Partial<Record<Stage, string>> = {},
): StageRailItem[] {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  return STAGE_ORDER.filter(
    (stage) => stagesEnabled.includes(stage) || skipReasons[stage] !== undefined,
  ).map((stage) => {
    const index = STAGE_ORDER.indexOf(stage);
    let state: StageRailState;
    if (!stagesEnabled.includes(stage)) state = 'SKIPPED';
    else if (conditionalStages.includes(stage) && index > currentIndex) state = 'CONDITIONAL';
    else if (index < currentIndex) state = 'DONE';
    else if (index === currentIndex) state = 'CURRENT';
    else state = 'PENDING';
    return {
      stage,
      label: STAGE_LABELS[stage],
      state,
      note: skipReasons[stage] ?? null,
    };
  });
}

/** Tabs the event workspace shows, derived from the pattern rather than fixed. */
export function workspaceTabs(stagesEnabled: Stage[]): string[] {
  const tabs = ['Overview', 'Items & Lots'];
  if (stagesEnabled.some((s) => s === 'RFI' || s === 'RFP' || s === 'RFQ')) {
    tabs.push('Questionnaire');
  }
  if (stagesEnabled.some((s) => s !== 'INTAKE' && s !== 'AWARD' && s !== 'APPROVAL')) {
    // Comparison sits next to Responses because that is the order the work
    // happens in: read what came in, then put it side by side. Timeline sits
    // first of these, because every one of them has a deadline.
    tabs.push('Timeline', 'Bidders', 'Terms', 'Clarifications', 'Responses', 'Comparison');
  }
  if (stagesEnabled.includes('EVALUATION')) tabs.push('Evaluation');
  if (stagesEnabled.includes('NEGOTIATION')) tabs.push('Negotiation');
  if (stagesEnabled.includes('AUCTION')) tabs.push('Auction');
  tabs.push('Award');
  if (stagesEnabled.includes('APPROVAL')) tabs.push('Approvals');
  tabs.push('Activity');
  return tabs;
}

export type TransitionCondition =
  | { kind: 'MANUAL' }
  | { kind: 'QUALIFIED_BIDDER_COUNT'; operator: '>=' | '<'; value: number }
  | { kind: 'ESTIMATED_VALUE'; operator: '>' | '<'; value: number }
  | { kind: 'BEST_BID_VS_TARGET'; multiplier: number }
  | { kind: 'TECHNICAL_QUALIFIED_COUNT'; operator: '==' | '>='; value: number };

export interface TransitionFacts {
  qualifiedBidderCount: number;
  estimatedValue: number;
  bestBid: number | null;
  targetPrice: number | null;
  technicalQualifiedCount: number;
}

export function evaluateTransition(
  condition: TransitionCondition,
  facts: TransitionFacts,
): { met: boolean; explanation: string } {
  switch (condition.kind) {
    case 'MANUAL':
      return { met: true, explanation: 'Manual transition — a buyer decides.' };
    case 'QUALIFIED_BIDDER_COUNT': {
      const met = condition.operator === '>='
        ? facts.qualifiedBidderCount >= condition.value
        : facts.qualifiedBidderCount < condition.value;
      return {
        met,
        explanation: `qualified_bidder_count (${facts.qualifiedBidderCount}) ${condition.operator} ${condition.value}`,
      };
    }
    case 'ESTIMATED_VALUE': {
      const met = condition.operator === '>'
        ? facts.estimatedValue > condition.value
        : facts.estimatedValue < condition.value;
      return {
        met,
        explanation: `estimated_value (${facts.estimatedValue}) ${condition.operator} ${condition.value}`,
      };
    }
    case 'BEST_BID_VS_TARGET': {
      if (facts.bestBid === null || facts.targetPrice === null) {
        return { met: false, explanation: 'best_bid or target_price is not yet known.' };
      }
      const threshold = facts.targetPrice * condition.multiplier;
      return {
        met: facts.bestBid > threshold,
        explanation: `best_bid (${facts.bestBid}) > target_price x ${condition.multiplier} (${threshold.toFixed(0)})`,
      };
    }
    case 'TECHNICAL_QUALIFIED_COUNT': {
      const met = condition.operator === '=='
        ? facts.technicalQualifiedCount === condition.value
        : facts.technicalQualifiedCount >= condition.value;
      return {
        met,
        explanation: `technical_qualified_count (${facts.technicalQualifiedCount}) ${condition.operator} ${condition.value}`,
      };
    }
  }
}

export function vendorTaskLabel(point: VendorInputPoint): string {
  // The supplier's task rail is named by what the supplier does, never by
  // buyer stage names.
  switch (point) {
    case 'INTAKE': return 'Send us an indicative price';
    case 'RFI': return 'Tell us about your company';
    case 'RFP': return 'Submit your proposal';
    case 'RFQ': return 'Submit your prices';
    case 'AUCTION': return 'Bid live';
    case 'NEGOTIATION': return 'Respond to our offer';
  }
}
