/**
 * Pack 28 demo scenarios.
 *
 * The lifecycle screens only mean something against a note that has *history*,
 * and a prototype cannot wait a week for one to accumulate. These builders
 * produce the four notes the pack asks to be rendered — one revision, three
 * revisions with a return and a recall, a rejection with its successor, and an
 * approved note awaiting a correction — each with its chain snapshot frozen at
 * the moment its revision was submitted.
 *
 * The DoA snapshots here are deliberately *not* the live matrix. `DRIFTED_DOA_RULES`
 * is what the matrix looks like today; revision 1 of the three-revision note was
 * decided under the old chain and still renders it. That is the defensibility
 * claim the pack makes, made visible.
 */
import type {
  ApprovalStep, DoARule, Nfa, NfaAllocationLine, NfaChainSnapshot, NfaDocument,
  NfaRevision, RateContract,
} from '../domain/types';
import { chainSignature } from '../domain/nfaLifecycle';
import { PRIMARY_EVENT_ID, SEED_NOW } from './seed';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// The rate contract the award established — the only non-event destination
// ---------------------------------------------------------------------------

export const RATE_CONTRACTS: RateContract[] = [
  {
    id: 'ctr-1', contractNumber: 'RC-2026-0088', eventId: PRIMARY_EVENT_ID,
    supplierId: 'cp-abc', supplierName: 'ABC Supplies Co.',
    categoryScope: ['Indirect', 'Facilities'],
    currency: 'INR', ceilingValue: 220_000, committedValue: 141_500,
    startsAt: SEED_NOW - 5 * DAY, expiresAt: SEED_NOW + 330 * DAY,
  },
];

/**
 * An item nobody quoted. It exists so the blocked-action panel has a real
 * subject: the honest answer to "can I add this?" is that there is no bid for
 * it, and an award line with no bid behind it is the one thing no screen offers.
 */
export const UNQUOTED_ITEM = {
  itemCode: 'TNR-HP-26X',
  description: 'Toner cartridge, HP 26X, high yield',
  category: 'Indirect',
  quantity: 400,
  uom: 'unit',
  estimatedUnitPrice: 121.5,
  get estimatedValue() { return this.quantity * this.estimatedUnitPrice; },
};

/** An item outside every contract's category scope, so option 2 is absent. */
export const OUT_OF_SCOPE_ITEM = {
  itemCode: 'SRV-LEGAL-01',
  description: 'External legal counsel, retained hours',
  category: 'Professional Services',
  quantity: 120,
  uom: 'hour',
  estimatedUnitPrice: 340,
  get estimatedValue() { return this.quantity * this.estimatedUnitPrice; },
};

// ---------------------------------------------------------------------------
// The matrix as it stands today — revision 1 was decided under the old one
// ---------------------------------------------------------------------------

/**
 * A quarter after the note was decided, Finance was inserted below the CFO and
 * the Head of Procurement's SLA was cut. A revision decided before that must
 * still render the chain it was decided under.
 */
export const DRIFTED_DOA_RULES: DoARule[] = [
  {
    id: 'doa-3', name: 'Any category above 250k (revised Q2)', minValue: 250_000, maxValue: null,
    category: null, businessUnit: null, chainMode: 'SEQUENTIAL',
    levels: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 12 },
      { level: 3, role: 'Financial Controller', holderName: 'D. Okafor', slaHours: 24 },
      { level: 4, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
      { level: 5, role: 'CFO', holderName: 'R. Khoury', slaHours: 72 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const ALLOCATION_SINGLE: NfaAllocationLine[] = [
  {
    lineId: 'al-1', lotId: 'lot-1', lotName: 'Lot 1 · Paper',
    bidderId: 'cp-abc', bidderName: 'ABC Supplies Co.',
    sharePct: 100, quantity: 13_400, value: 141_500, bidId: 'bid-118',
  },
];

const ALLOCATION_SPLIT: NfaAllocationLine[] = [
  {
    lineId: 'al-1', lotId: 'lot-1', lotName: 'Lot 1 · Paper',
    bidderId: 'cp-abc', bidderName: 'ABC Supplies Co.',
    sharePct: 70, quantity: 9_380, value: 99_050, bidId: 'bid-118',
  },
  {
    lineId: 'al-2', lotId: 'lot-1', lotName: 'Lot 1 · Paper',
    bidderId: 'cp-global', bidderName: 'Global Office Solutions',
    sharePct: 30, quantity: 4_020, value: 43_800, bidId: 'bid-121',
  },
];

const THREE_LEVEL: NfaChainSnapshot['levels'] = [
  { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
  { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
  { level: 3, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
];

const FOUR_LEVEL: NfaChainSnapshot['levels'] = [
  ...THREE_LEVEL,
  { level: 4, role: 'CFO', holderName: 'R. Khoury', slaHours: 72 },
];

function snapshot(
  levels: NfaChainSnapshot['levels'],
  capturedAt: number,
  over: Partial<NfaChainSnapshot> = {},
): NfaChainSnapshot {
  return {
    ruleId: 'doa-3',
    ruleName: 'Any category above 250k',
    chainMode: 'SEQUENTIAL',
    capturedAt,
    totalSlaHours: levels.reduce((a, l) => a + l.slaHours, 0),
    upliftApplied: false,
    levels,
    ...over,
  };
}

function document(over: Partial<NfaDocument> = {}): NfaDocument {
  const allocations = over.allocations ?? ALLOCATION_SINGLE;
  return {
    scenarioId: 'RECOMMENDED',
    currency: 'INR',
    allocations,
    totalValue: allocations.reduce((a, x) => a + x.value, 0),
    comparisonSheetVersion: 3,
    rankOverride: false,
    overrideReason: null,
    deviations: ['Below-minimum competition — 4 bidders invited against a minimum of 3 is met, but only 3 bid.'],
    chainSignature: chainSignature(THREE_LEVEL),
    recommendation:
      'Recommend award to ABC Supplies Co. at ₹1,41,500. Lowest transformed landed value across all three '
      + 'lots, highest performance rating in the field, and the only bidder holding stock in both delivery locations.',
    riskStatement:
      'AG-08 records no statutory or compliance blocker. Supply-continuity risk is rated low given two qualified alternates.',
    processSummary: 'JP-05 · Full ladder. Stages executed: INTAKE → RFI → RFP → RFQ → EVALUATION → AUCTION → AWARD → APPROVAL.',
    competitionSummary: '4 invited · 4 accepted · 3 placed a valid bid · 1 disqualified.',
    costCentre: 'CC-4400',
    requiredByDate: '2026-04-01',
    paymentTerms: 'Net 45',
    ...over,
  };
}

function steps(
  nfaId: string,
  revisionNumber: number,
  levels: NfaChainSnapshot['levels'],
  decisions: Partial<Record<number, Partial<ApprovalStep>>> = {},
): ApprovalStep[] {
  return levels.map((level, i) => ({
    id: `${nfaId}-r${revisionNumber}-step-${i + 1}`,
    nfaId,
    level: level.level,
    holderId: `user-${level.holderName.replace(/\s+/g, '-').toLowerCase()}`,
    holderName: level.holderName,
    role: level.role,
    slaHours: level.slaHours,
    decision: 'PENDING' as const,
    comment: null,
    decidedAt: null,
    revisionNumber,
    kind: 'NORMAL' as const,
    superseded: false,
    supersededReason: null,
    carriedForward: false,
    ...decisions[level.level],
  }));
}

function revision(over: Partial<NfaRevision> & Pick<NfaRevision, 'nfaId' | 'number'>): NfaRevision {
  return {
    id: `${over.nfaId}-rev-${over.number}`,
    document: document(),
    chainSnapshot: snapshot(THREE_LEVEL, SEED_NOW - 10 * DAY),
    steps: [],
    outcome: 'IN_FLIGHT',
    outcomeDetail: null,
    changeClass: 'NONE',
    changeSummary: 'First submission of the note.',
    submittedBy: 'user-ar',
    submittedByName: 'A. Rahman',
    submittedAt: SEED_NOW - 10 * DAY,
    closedAt: null,
    supersededApprovals: [],
    errata: [],
    ...over,
  };
}

function baseNfa(id: string, over: Partial<Nfa> = {}): Nfa {
  const draft = over.draft ?? document();
  return {
    id,
    eventId: PRIMARY_EVENT_ID,
    scenarioId: 'RECOMMENDED',
    comparisonSheetVersion: draft.comparisonSheetVersion,
    recommendation: draft.recommendation,
    recommendedBy: 'user-ar',
    deviations: draft.deviations,
    riskStatement: draft.riskStatement,
    doaUpliftApplied: false,
    overrideReason: draft.overrideReason,
    steps: [],
    createdAt: SEED_NOW - 10 * DAY,
    status: 'IN_APPROVAL',
    revisions: [],
    draft,
    rejectionReason: null,
    recallReason: null,
    supersededByNfaId: null,
    predecessorNfaId: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The four scenarios
// ---------------------------------------------------------------------------

export type NfaScenarioId =
  | 'SINGLE_REVISION'
  | 'THREE_REVISIONS'
  | 'REJECTED_WITH_SUCCESSOR'
  | 'APPROVED_AWAITING_CORRECTION';

export const NFA_SCENARIO_LABELS: Record<NfaScenarioId, string> = {
  SINGLE_REVISION: 'One revision',
  THREE_REVISIONS: 'Three revisions',
  REJECTED_WITH_SUCCESSOR: 'Rejected',
  APPROVED_AWAITING_CORRECTION: 'Approved',
};

export const NFA_SCENARIO_HINTS: Record<NfaScenarioId, string> = {
  SINGLE_REVISION: 'The common case: submitted once, sitting at level 2 with level 1 approved.',
  THREE_REVISIONS: 'A return at level 2, a recall after that, and a live third revision — with a delegation and an escalation in the history, and a chain snapshot the live DoA matrix no longer matches.',
  REJECTED_WITH_SUCCESSOR: 'Rejected at level 3 with a mandatory reason. What happens next is OD-04.',
  APPROVED_AWAITING_CORRECTION: 'Fully approved, not yet executed, and the cost centre is wrong. That is OD-07.',
};

/** The common case — one revision, level 1 approved, level 2 holding. */
function singleRevision(): Nfa {
  const id = 'nfa-demo-1';
  const live = revision({
    nfaId: id, number: 1,
    steps: steps(id, 1, THREE_LEVEL, {
      1: { decision: 'APPROVED', comment: 'Category position agreed.', decidedAt: SEED_NOW - 9 * DAY },
    }),
    submittedAt: SEED_NOW - 10 * DAY,
  });
  return baseNfa(id, { revisions: [live], steps: live.steps, status: 'IN_APPROVAL' });
}

/**
 * Three revisions: a return at level 2, a recall after the first approval, and
 * a live third. Revision 1 carries the pre-Q2 chain snapshot, so opening it
 * proves the note still renders the chain it was decided under.
 */
function threeRevisions(): Nfa {
  const id = 'nfa-demo-3';

  const r1 = revision({
    nfaId: id, number: 1,
    submittedAt: SEED_NOW - 14 * DAY,
    closedAt: SEED_NOW - 12 * DAY,
    outcome: 'RETURNED',
    outcomeDetail: 'Returned by level 2 — M. Prasad',
    chainSnapshot: snapshot(THREE_LEVEL, SEED_NOW - 14 * DAY),
    steps: steps(id, 1, THREE_LEVEL, {
      1: {
        decision: 'APPROVED', comment: 'Agreed on category grounds.',
        decidedAt: SEED_NOW - 13 * DAY,
      },
      2: {
        decision: 'RETURNED',
        comment: 'The savings statement cites an LPP baseline that is 14 months old. Restate it against the current contract rate before I can sign.',
        decidedAt: SEED_NOW - 12 * DAY,
      },
    }),
  });

  // Revision 2 was non-material — the narrative was restated, nothing moved —
  // so level 1's approval carried forward rather than being struck.
  const r2Document = document({
    processSummary: r1.document.processSummary,
    recommendation:
      'Recommend award to ABC Supplies Co. at ₹1,41,500. Lowest transformed landed value across all three '
      + 'lots, highest performance rating in the field, and the only bidder holding stock in both delivery locations. '
      + 'Baseline restated against the current contract rate at the request of level 2.',
  });
  const r2 = revision({
    nfaId: id, number: 2,
    document: r2Document,
    submittedAt: SEED_NOW - 11 * DAY,
    closedAt: SEED_NOW - 9 * DAY,
    outcome: 'RECALLED',
    outcomeDetail: 'Recalled by the buyer — the auction result was superseded by a late clarification on delivery terms.',
    changeClass: 'NON_MATERIAL',
    changeSummary: 'Non-material — recommendation (section 8) restated against the current contract rate.',
    chainSnapshot: snapshot(THREE_LEVEL, SEED_NOW - 11 * DAY),
    steps: steps(id, 2, THREE_LEVEL, {
      1: {
        decision: 'APPROVED', comment: 'Agreed on category grounds.',
        decidedAt: SEED_NOW - 13 * DAY, carriedForward: true,
        superseded: true,
        supersededReason: 'Discarded by recall — the auction result was superseded by a late clarification on delivery terms.',
      },
      2: {
        decision: 'APPROVED',
        comment: 'Baseline now stands up. Approved.',
        decidedAt: SEED_NOW - 10 * DAY,
        // Level 2 was away; the step was delegated and the delegate decided.
        kind: 'DELEGATED',
        delegatedToId: 'user-l-fernandes',
        delegatedToName: 'L. Fernandes',
        holderName: 'L. Fernandes',
        superseded: true,
        supersededReason: 'Discarded by recall — the auction result was superseded by a late clarification on delivery terms.',
      },
    }),
  });

  // Revision 3 is material: the allocation split in two.
  const r3Document = document({
    scenarioId: 'DUAL_SOURCE',
    allocations: ALLOCATION_SPLIT,
    recommendation: r2Document.recommendation
      + ' Split 70/30 to hold a second qualified source through the contract year.',
    deviations: [
      ...r2Document.deviations,
      'Dual source applied — a 70/30 split costs roughly 1.4% against a single award.',
    ],
  });
  const r3 = revision({
    nfaId: id, number: 3,
    document: r3Document,
    submittedAt: SEED_NOW - 3 * DAY,
    outcome: 'IN_FLIGHT',
    changeClass: 'MATERIAL',
    changeSummary: 'Material — allocation split 70/30 across two suppliers.',
    chainSnapshot: snapshot(FOUR_LEVEL, SEED_NOW - 3 * DAY, {
      ruleName: 'Any category above 250k',
      upliftApplied: false,
    }),
    supersededApprovals: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman' },
      { level: 2, role: 'Head of Procurement', holderName: 'L. Fernandes' },
    ],
    steps: steps(id, 3, FOUR_LEVEL, {
      1: { decision: 'APPROVED', comment: 'Split agreed.', decidedAt: SEED_NOW - 2 * DAY },
      2: {
        decision: 'PENDING',
        // SLA breached at level 2, so the step escalated and is still waiting.
        kind: 'ESCALATED',
        escalatedFromName: 'M. Prasad',
        holderName: 'V. Chandra',
      },
    }),
  });

  return baseNfa(id, {
    revisions: [r1, r2, r3],
    steps: r3.steps,
    draft: r3Document,
    status: 'IN_APPROVAL',
    recallReason: 'The auction result was superseded by a late clarification on delivery terms.',
  });
}

/** Rejected at level 3, with the reason the buyer has to be shown. */
function rejectedWithSuccessor(): Nfa {
  const id = 'nfa-demo-rej';
  const rejectionComment =
    'The dual-source split adds 1.4% for a continuity benefit this category does not need — Lot 1 has two '
    + 'qualified alternates already under contract. Award single-source or bring me the continuity case.';
  const r1 = revision({
    nfaId: id, number: 1,
    document: document({ scenarioId: 'DUAL_SOURCE', allocations: ALLOCATION_SPLIT }),
    submittedAt: SEED_NOW - 6 * DAY,
    closedAt: SEED_NOW - 4 * DAY,
    outcome: 'REJECTED',
    outcomeDetail: 'Rejected by level 3 — S. Iyer',
    chainSnapshot: snapshot(THREE_LEVEL, SEED_NOW - 6 * DAY),
    steps: steps(id, 1, THREE_LEVEL, {
      1: { decision: 'APPROVED', comment: 'Agreed.', decidedAt: SEED_NOW - 6 * DAY + 4 * HOUR },
      2: { decision: 'APPROVED', comment: 'Agreed.', decidedAt: SEED_NOW - 5 * DAY },
      3: { decision: 'REJECTED', comment: rejectionComment, decidedAt: SEED_NOW - 4 * DAY },
    }),
  });
  return baseNfa(id, {
    revisions: [r1], steps: r1.steps, status: 'REJECTED',
    rejectionReason: rejectionComment,
    draft: r1.document,
  });
}

/** Approved, not executed, and the cost centre is wrong. The commonest case. */
function approvedAwaitingCorrection(): Nfa {
  const id = 'nfa-demo-appr';
  const r1 = revision({
    nfaId: id, number: 1,
    submittedAt: SEED_NOW - 8 * DAY,
    closedAt: SEED_NOW - 5 * DAY,
    outcome: 'APPROVED',
    outcomeDetail: 'Approved by every level',
    chainSnapshot: snapshot(THREE_LEVEL, SEED_NOW - 8 * DAY),
    steps: steps(id, 1, THREE_LEVEL, {
      1: { decision: 'APPROVED', comment: 'Agreed.', decidedAt: SEED_NOW - 8 * DAY + 6 * HOUR },
      2: { decision: 'APPROVED', comment: 'Agreed.', decidedAt: SEED_NOW - 7 * DAY },
      3: { decision: 'APPROVED', comment: 'Approved. Issue the LoA.', decidedAt: SEED_NOW - 5 * DAY },
    }),
  });
  return baseNfa(id, { revisions: [r1], steps: r1.steps, status: 'APPROVED', draft: r1.document });
}

export function buildScenarioNfa(scenario: NfaScenarioId, eventId: string): Nfa {
  const built =
    scenario === 'SINGLE_REVISION' ? singleRevision()
    : scenario === 'THREE_REVISIONS' ? threeRevisions()
    : scenario === 'REJECTED_WITH_SUCCESSOR' ? rejectedWithSuccessor()
    : approvedAwaitingCorrection();
  return { ...built, eventId };
}

/** Configured tolerance for an award-quantity adjustment, as a percentage. */
export const AWARD_QUANTITY_TOLERANCE_PCT = 10;
