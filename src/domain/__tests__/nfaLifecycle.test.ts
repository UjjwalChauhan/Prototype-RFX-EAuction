/**
 * Pack 28 — the rules that make the NFA's second run defensible.
 *
 * The claims worth testing here are the ones a screen cannot be trusted to
 * enforce on its own: that materiality is decided in exactly one place, that
 * the amendment banner and the reducer agree, that a decided revision does not
 * change when the DoA matrix does, that superseded approvals survive, and that
 * no route ever produces an award line with no bid behind it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPEN_DECISIONS, OPEN_DECISIONS, addErratum, applyDecision, applyRecall,
  assessQuantityAdjustment, buildChainHistory, chainConsequence, chainDrift,
  chainSignature, classifyChange, currentRevision, diffRevisions, errataEligibility,
  escalateStep, isPostAward, raiseSuccessor, recallAvailability, rejectionAftermath,
  scopeChangeRouting, snapshotChain, submitRevision,
  type OpenDecisionSettings,
} from '../nfaLifecycle';
import type { SimulationResult } from '../doa';
import type {
  ApprovalStep, Nfa, NfaAllocationLine, NfaChainSnapshot, NfaDocument, RateContract,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEVELS: NfaChainSnapshot['levels'] = [
  { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
  { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
  { level: 3, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
];

function allocation(over: Partial<NfaAllocationLine> = {}): NfaAllocationLine {
  return {
    lineId: 'al-1', lotId: 'lot-1', lotName: 'Lot 1',
    bidderId: 'cp-abc', bidderName: 'ABC Supplies Co.',
    sharePct: 100, quantity: 1_000, value: 100_000, bidId: 'bid-118',
    ...over,
  };
}

function doc(over: Partial<NfaDocument> = {}): NfaDocument {
  const allocations = over.allocations ?? [allocation()];
  return {
    scenarioId: 'RECOMMENDED',
    currency: 'USD',
    allocations,
    totalValue: allocations.reduce((a, x) => a + x.value, 0),
    comparisonSheetVersion: 3,
    rankOverride: false,
    overrideReason: null,
    deviations: [],
    chainSignature: chainSignature(LEVELS),
    recommendation: 'Recommend award to ABC.',
    riskStatement: 'No blocker.',
    processSummary: 'Full ladder.',
    competitionSummary: '4 invited, 3 bid.',
    costCentre: 'CC-4400',
    requiredByDate: '2026-04-01',
    paymentTerms: 'Net 45',
    ...over,
  };
}

function snapshot(levels = LEVELS): NfaChainSnapshot {
  return {
    ruleId: 'doa-2', ruleName: 'Indirect 50k–250k', chainMode: 'SEQUENTIAL',
    capturedAt: 1_000, totalSlaHours: levels.reduce((a, l) => a + l.slaHours, 0),
    upliftApplied: false, levels,
  };
}

function emptyNfa(over: Partial<Nfa> = {}): Nfa {
  const draft = over.draft ?? doc();
  return {
    id: 'nfa-1', eventId: 'evt-1', scenarioId: 'RECOMMENDED',
    comparisonSheetVersion: 3, recommendation: draft.recommendation, recommendedBy: 'user-ar',
    deviations: [], riskStatement: draft.riskStatement, doaUpliftApplied: false,
    overrideReason: null, steps: [], createdAt: 0,
    status: 'IN_APPROVAL', revisions: [], draft,
    rejectionReason: null, recallReason: null,
    supersededByNfaId: null, predecessorNfaId: null,
    ...over,
  };
}

/** A note with revision 1 submitted, level 1 approved, level 2 holding. */
function noteWithFirstRevision(document = doc()): Nfa {
  const { nfa } = submitRevision({
    nfa: emptyNfa({ draft: document }),
    document,
    chain: snapshot(),
    actorId: 'user-ar', actorName: 'A. Rahman', at: 1_000,
  });
  return applyDecision({
    nfa, level: 1, decision: 'APPROVED', comment: 'Agreed.',
    actorName: 'A. Rahman', at: 2_000,
  });
}

function settings(over: Partial<OpenDecisionSettings> = {}): OpenDecisionSettings {
  return { ...DEFAULT_OPEN_DECISIONS, ...over };
}

// ---------------------------------------------------------------------------

describe('materiality — the one definition in the product', () => {
  it('calls a re-worded recommendation non-material', () => {
    const result = classifyChange(doc(), doc({ recommendation: 'Recommend award to ABC. Restated.' }));
    expect(result.changeClass).toBe('NON_MATERIAL');
    expect(result.materialChanges).toHaveLength(0);
  });

  it('calls an allocation share change material', () => {
    const before = doc({ allocations: [allocation({ sharePct: 100 })] });
    const after = doc({ allocations: [allocation({ sharePct: 70, value: 70_000 })] });
    const result = classifyChange(before, after);
    expect(result.changeClass).toBe('MATERIAL');
    expect(result.materialChanges.some((c) => c.label.includes('Allocation'))).toBe(true);
  });

  it('calls a change of the awardee set material', () => {
    const after = doc({
      allocations: [allocation({ bidderId: 'cp-global', bidderName: 'Global Office Solutions' })],
    });
    const result = classifyChange(doc(), after);
    expect(result.materialChanges.some((c) => c.field === 'awardees')).toBe(true);
  });

  it('calls an added award line material, and a removed one too', () => {
    const two = doc({
      allocations: [
        allocation({ sharePct: 70, value: 70_000 }),
        allocation({ lineId: 'al-2', bidderId: 'cp-global', bidderName: 'Global', sharePct: 30, value: 30_000 }),
      ],
    });
    expect(classifyChange(doc(), two).materialChanges.some((c) => c.label.includes('added'))).toBe(true);
    expect(classifyChange(two, doc()).materialChanges.some((c) => c.label.includes('removed'))).toBe(true);
  });

  it('calls a new deviation and a removed deviation material', () => {
    const withDeviation = doc({ deviations: ['Single-bid award.'] });
    expect(classifyChange(doc(), withDeviation).changeClass).toBe('MATERIAL');
    expect(classifyChange(withDeviation, doc()).changeClass).toBe('MATERIAL');
  });

  it('calls a changed comparison-sheet version material — it is the evidence', () => {
    const result = classifyChange(doc(), doc({ comparisonSheetVersion: 4 }));
    expect(result.materialChanges.some((c) => c.field === 'comparisonSheetVersion')).toBe(true);
  });

  it('calls a changed resolved chain material by definition', () => {
    const result = classifyChange(doc(), doc({ chainSignature: 'L1 CFO (R. Khoury)' }));
    expect(result.materialChanges.some((c) => c.field === 'chainSignature')).toBe(true);
  });

  it('leaves an administrative correction — cost centre, date — non-material', () => {
    const result = classifyChange(doc(), doc({ costCentre: 'CC-4500', requiredByDate: '2026-05-01' }));
    expect(result.changeClass).toBe('NON_MATERIAL');
    expect(result.changes).toHaveLength(2);
  });

  it('reports no change when nothing moved', () => {
    expect(classifyChange(doc(), doc()).changeClass).toBe('NONE');
  });
});

describe('OD-01 — the value delta that makes a price movement material', () => {
  // A 4% movement: material under ABSOLUTE, not under either percentage.
  const before = doc();
  const after = doc({ allocations: [allocation({ value: 104_000 })] });

  it('is non-material at 4% against a 5% threshold', () => {
    const result = classifyChange(before, after, settings({ od01ValueDelta: 'PCT_5' }));
    expect(result.changes.find((c) => c.field === 'totalValue')?.material).toBe(false);
  });

  it('is material at 4% when any movement counts', () => {
    const result = classifyChange(before, after, settings({ od01ValueDelta: 'ABSOLUTE' }));
    expect(result.changes.find((c) => c.field === 'totalValue')?.material).toBe(true);
    expect(result.changeClass).toBe('MATERIAL');
  });

  it('is material at 12% against a 10% threshold', () => {
    const twelve = doc({ allocations: [allocation({ value: 112_000 })] });
    const result = classifyChange(before, twelve, settings({ od01ValueDelta: 'PCT_10' }));
    expect(result.changes.find((c) => c.field === 'totalValue')?.material).toBe(true);
  });
});

describe('the amendment banner — the chain consequence, before submitting', () => {
  const returnedSteps: ApprovalStep[] = [
    { id: 's1', nfaId: 'n1', level: 1, holderId: 'u1', holderName: 'A. Rahman', role: 'Category Manager', slaHours: 24, decision: 'APPROVED', comment: null, decidedAt: 10 },
    { id: 's2', nfaId: 'n1', level: 2, holderId: 'u2', holderName: 'M. Prasad', role: 'Head of Procurement', slaHours: 24, decision: 'RETURNED', comment: 'Restate the baseline.', decidedAt: 20 },
    { id: 's3', nfaId: 'n1', level: 3, holderId: 'u3', holderName: 'S. Iyer', role: 'Finance Director', slaHours: 48, decision: 'PENDING', comment: null, decidedAt: null },
  ];

  it('resumes at the returning level for a non-material edit, discarding nothing', () => {
    const assessment = classifyChange(doc(), doc({ recommendation: 'Restated.' }));
    const consequence = chainConsequence(assessment, returnedSteps);
    expect(consequence.restart).toBe(false);
    expect(consequence.resumeAtLevel).toBe(2);
    expect(consequence.supersededApprovals).toHaveLength(0);
    expect(consequence.sentence).toContain('resume at level 2');
  });

  it('restarts from level 1 for a material edit and names whose approval it costs', () => {
    const assessment = classifyChange(doc(), doc({ allocations: [allocation({ sharePct: 70, value: 70_000 })] }));
    const consequence = chainConsequence(assessment, returnedSteps);
    expect(consequence.restart).toBe(true);
    expect(consequence.resumeAtLevel).toBe(1);
    expect(consequence.supersededApprovals.map((a) => a.holderName)).toEqual(['A. Rahman']);
    expect(consequence.sentence).toContain('A. Rahman');
    expect(consequence.sentence).toContain('restart the chain from level 1');
  });

  it('restarts even a typo under OD-02 RESTART, and says so', () => {
    const assessment = classifyChange(doc(), doc({ costCentre: 'CC-4500' }));
    const consequence = chainConsequence(assessment, returnedSteps, settings({ od02NonMaterialReentry: 'RESTART' }));
    expect(consequence.restart).toBe(true);
    expect(consequence.supersededApprovals).toHaveLength(1);
  });

  it('promises nothing when nothing has changed', () => {
    const consequence = chainConsequence(classifyChange(doc(), doc()), returnedSteps);
    expect(consequence.changeClass).toBe('NONE');
    expect(consequence.restart).toBe(false);
  });
});

describe('revisions — snapshot, submit, supersede', () => {
  it('numbers revisions from one and marks the first submission', () => {
    const nfa = noteWithFirstRevision();
    expect(nfa.revisions).toHaveLength(1);
    expect(nfa.revisions[0].number).toBe(1);
    expect(nfa.revisions[0].changeSummary).toContain('First submission');
  });

  it('carries earlier approvals forward on a non-material re-submission', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Restate the baseline.', actorName: 'M. Prasad', at: 3_000,
    });
    const { nfa: next, consequence } = submitRevision({
      nfa: returned,
      document: doc({ recommendation: 'Restated against the current rate.' }),
      chain: snapshot(), actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    expect(consequence.restart).toBe(false);
    const live = currentRevision(next)!;
    expect(live.number).toBe(2);
    expect(live.steps[0].decision).toBe('APPROVED');
    expect(live.steps[0].carriedForward).toBe(true);
    // The earlier revision keeps its approval unstruck: nothing invalidated it.
    expect(next.revisions[0].steps[0].superseded).toBe(false);
  });

  it('strikes earlier approvals on a material re-submission, and never deletes them', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Split it.', actorName: 'M. Prasad', at: 3_000,
    });
    const { nfa: next, consequence } = submitRevision({
      nfa: returned,
      document: doc({ allocations: [allocation({ sharePct: 70, value: 70_000 })] }),
      chain: snapshot(), actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    expect(consequence.restart).toBe(true);
    expect(next.revisions[0].steps[0].superseded).toBe(true);
    expect(next.revisions[0].steps[0].supersededReason).toContain('revision 2');
    // Struck, not removed.
    expect(next.revisions[0].steps).toHaveLength(3);
    expect(currentRevision(next)!.steps.every((s) => s.decision === 'PENDING')).toBe(true);
    expect(currentRevision(next)!.supersededApprovals).toHaveLength(1);
  });

  it('gives the same answer the banner gave — one function decides both', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Split it.', actorName: 'M. Prasad', at: 3_000,
    });
    const amended = doc({ allocations: [allocation({ sharePct: 70, value: 70_000 })] });
    const live = currentRevision(returned)!;
    const banner = chainConsequence(classifyChange(live.document, amended), live.steps);
    const { consequence } = submitRevision({
      nfa: returned, document: amended, chain: snapshot(),
      actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    expect(consequence.sentence).toBe(banner.sentence);
    expect(consequence.restart).toBe(banner.restart);
  });

  it('closes the previous revision as superseded when a new one is submitted', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Fix it.', actorName: 'M. Prasad', at: 3_000,
    });
    const { nfa: next } = submitRevision({
      nfa: returned, document: doc({ costCentre: 'CC-9000' }), chain: snapshot(),
      actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    // It closed as RETURNED — its real outcome, not overwritten by the successor.
    expect(next.revisions[0].outcome).toBe('RETURNED');
    expect(next.revisions[0].closedAt).not.toBeNull();
  });
});

describe('the chain snapshot — a decided revision does not move when the matrix does', () => {
  const liveAfterEdit: SimulationResult = {
    matchedRule: null,
    trace: [],
    chain: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 12 },
      { level: 3, role: 'Financial Controller', holderName: 'D. Okafor', slaHours: 24 },
      { level: 4, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
    ],
    upliftApplied: false,
    totalSlaHours: 108,
  };

  it('reports drift without changing what the revision shows', () => {
    const nfa = noteWithFirstRevision();
    const revision = currentRevision(nfa)!;
    const drift = chainDrift(revision.chainSnapshot, liveAfterEdit);
    expect(drift.drifted).toBe(true);
    expect(drift.snapshotSignature).toContain('S. Iyer');
    expect(drift.liveSignature).toContain('D. Okafor');
    // The revision's own levels are untouched by the matrix edit.
    expect(revision.chainSnapshot.levels).toHaveLength(3);
    expect(revision.steps.map((s) => s.holderName)).toEqual(['A. Rahman', 'M. Prasad', 'S. Iyer']);
  });

  it('reports no drift when the matrix has not moved', () => {
    const nfa = noteWithFirstRevision();
    const same: SimulationResult = {
      matchedRule: null, trace: [], chain: [...LEVELS], upliftApplied: false, totalSlaHours: 96,
    };
    expect(chainDrift(currentRevision(nfa)!.chainSnapshot, same).drifted).toBe(false);
  });

  it('snapshots the rule, the mode and the uplift, not just the levels', () => {
    const captured = snapshotChain(
      { matchedRule: { id: 'doa-3', name: 'Above 250k', minValue: 250_000, maxValue: null, category: null, businessUnit: null, levels: LEVELS, chainMode: 'PARALLEL' }, trace: [], chain: LEVELS, upliftApplied: true, totalSlaHours: 96 },
      9_999,
    );
    expect(captured.ruleId).toBe('doa-3');
    expect(captured.chainMode).toBe('PARALLEL');
    expect(captured.upliftApplied).toBe(true);
    expect(captured.capturedAt).toBe(9_999);
  });
});

describe('the diff', () => {
  it('separates material from non-material and groups by section', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Split it.', actorName: 'M. Prasad', at: 3_000,
    });
    const { nfa } = submitRevision({
      nfa: returned,
      document: doc({
        allocations: [allocation({ sharePct: 70, value: 70_000 })],
        recommendation: 'Restated.',
      }),
      chain: snapshot(), actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    const diff = diffRevisions(nfa.revisions, 1, 2)!;
    expect(diff.assessment.materialChanges.length).toBeGreaterThan(0);
    expect(diff.assessment.nonMaterialChanges.length).toBeGreaterThan(0);
    // Section 1 holds the allocation, section 8 the recommendation.
    expect(diff.sections.map((s) => s.section)).toContain(1);
    expect(diff.sections.map((s) => s.section)).toContain(8);
  });

  it('spans more than two revisions when asked to', () => {
    let nfa = noteWithFirstRevision();
    for (const [i, patch] of [{ costCentre: 'CC-1' }, { costCentre: 'CC-2' }].entries()) {
      nfa = applyDecision({
        nfa, level: 2, decision: 'RETURNED', comment: 'Again.',
        actorName: 'M. Prasad', at: 3_000 + i,
      });
      nfa = submitRevision({
        nfa, document: doc(patch), chain: snapshot(),
        actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000 + i,
      }).nfa;
    }
    const diff = diffRevisions(nfa.revisions, 1, 3)!;
    expect(diff.spansRevisions).toEqual([1, 2, 3]);
  });

  it('returns null rather than guessing when a revision does not exist', () => {
    expect(diffRevisions(noteWithFirstRevision().revisions, 1, 9)).toBeNull();
  });
});

describe('chain history across revisions', () => {
  it('keeps every decision from every revision, superseded ones included', () => {
    const returned = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'RETURNED',
      comment: 'Split it.', actorName: 'M. Prasad', at: 3_000,
    });
    const { nfa } = submitRevision({
      nfa: returned, document: doc({ allocations: [allocation({ sharePct: 70, value: 70_000 })] }),
      chain: snapshot(), actorId: 'user-ar', actorName: 'A. Rahman', at: 4_000,
    });
    const history = buildChainHistory(nfa);
    expect(history).toHaveLength(6);
    expect(history.filter((h) => h.superseded)).toHaveLength(1);
    expect(history.filter((h) => h.revisionNumber === 1)).toHaveLength(3);
  });

  it('records a delegation as a pass, not a decision', () => {
    const delegated = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'DELEGATED',
      comment: 'On leave.', delegateToName: 'L. Fernandes',
      actorName: 'M. Prasad', at: 3_000,
    });
    const entry = buildChainHistory(delegated).find((h) => h.level === 2)!;
    expect(entry.kind).toBe('DELEGATED');
    expect(entry.delegatedToName).toBe('L. Fernandes');
    // Still awaiting a decision: delegating is not approving.
    expect(entry.decision).toBe('PENDING');
    expect(delegated.status).toBe('IN_APPROVAL');
  });

  it('records an escalation and keeps the original holder visible', () => {
    const escalated = escalateStep(noteWithFirstRevision(), 2, 'V. Chandra');
    const entry = buildChainHistory(escalated).find((h) => h.level === 2)!;
    expect(entry.kind).toBe('ESCALATED');
    expect(entry.escalatedFromName).toBe('M. Prasad');
    expect(entry.holderName).toBe('V. Chandra');
    expect(entry.decision).toBe('PENDING');
  });
});

describe('recall — OD-03', () => {
  it('is available before any level has decided, with a mandatory reason', () => {
    const { nfa } = submitRevision({
      nfa: emptyNfa(), document: doc(), chain: snapshot(),
      actorId: 'user-ar', actorName: 'A. Rahman', at: 1_000,
    });
    const availability = recallAvailability(nfa);
    expect(availability.available).toBe(true);
    expect(availability.requiresReason).toBe(true);
    expect(availability.pendingHolder?.holderName).toBe('A. Rahman');
  });

  it('is blocked after the first approval under OD-03a, and says which one closed it', () => {
    const availability = recallAvailability(noteWithFirstRevision());
    expect(availability.available).toBe(false);
    expect(availability.explanation).toContain('A. Rahman');
    expect(availability.explanation).toContain('level 1');
  });

  it('is permitted under OD-03b, naming every approval it discards', () => {
    const availability = recallAvailability(
      noteWithFirstRevision(),
      settings({ od03RecallAfterApproval: 'PERMITTED_WITH_REASON' }),
    );
    expect(availability.available).toBe(true);
    expect(availability.invalidates.map((a) => a.holderName)).toEqual(['A. Rahman']);
    expect(availability.explanation).toContain('A. Rahman');
  });

  it('is closed on an approved or rejected note, whichever option is set', () => {
    const approved = { ...noteWithFirstRevision(), status: 'APPROVED' as const };
    for (const option of ['BLOCKED_AFTER_FIRST_APPROVAL', 'PERMITTED_WITH_REASON'] as const) {
      expect(recallAvailability(approved, settings({ od03RecallAfterApproval: option })).available).toBe(false);
    }
  });

  it('strikes discarded approvals and freezes the revision when recalled', () => {
    const recalled = applyRecall(noteWithFirstRevision(), 'Late clarification changed the terms.', 5_000);
    expect(recalled.status).toBe('RECALLED');
    expect(recalled.recallReason).toContain('Late clarification');
    expect(currentRevision(recalled)!.outcome).toBe('RECALLED');
    expect(currentRevision(recalled)!.steps[0].superseded).toBe(true);
    expect(currentRevision(recalled)!.closedAt).toBe(5_000);
  });
});

describe('rejection and its aftermath — OD-04', () => {
  it('freezes the revision, records the reason and notifies, under either option', () => {
    const rejected = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'REJECTED',
      comment: 'The split costs 1.4% for no continuity benefit.',
      actorName: 'M. Prasad', at: 6_000,
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toContain('1.4%');
    expect(currentRevision(rejected)!.outcome).toBe('REJECTED');
    expect(currentRevision(rejected)!.closedAt).toBe(6_000);
    for (const option of ['TERMINAL', 'RETURN_TO_AWARD'] as const) {
      expect(rejectionAftermath(settings({ od04Rejection: option })).invariants).toHaveLength(3);
    }
  });

  it('cancels the event and offers no successor under OD-04a', () => {
    const aftermath = rejectionAftermath(settings({ od04Rejection: 'TERMINAL' }));
    expect(aftermath.eventStatus).toBe('CANCELLED');
    expect(aftermath.successorAllowed).toBe(false);
  });

  it('returns to award and permits a linked successor under OD-04b', () => {
    const aftermath = rejectionAftermath(settings({ od04Rejection: 'RETURN_TO_AWARD' }));
    expect(aftermath.eventStatus).toBe('AWARD_RECOMMENDED');
    expect(aftermath.successorAllowed).toBe(true);
  });

  it('links a successor note both ways and carries the rejected content forward', () => {
    const rejected = applyDecision({
      nfa: noteWithFirstRevision(), level: 2, decision: 'REJECTED',
      comment: 'No.', actorName: 'M. Prasad', at: 6_000,
    });
    const { predecessor, successor } = raiseSuccessor(rejected, 'nfa-2', 7_000);
    expect(predecessor.supersededByNfaId).toBe('nfa-2');
    expect(successor.predecessorNfaId).toBe('nfa-1');
    expect(successor.revisions).toHaveLength(0);
    expect(successor.draft.totalValue).toBe(currentRevision(rejected)!.document.totalValue);
    // The rejected note keeps its own reason; the successor starts clean.
    expect(predecessor.rejectionReason).toBe('No.');
    expect(successor.rejectionReason).toBeNull();
  });
});

describe('post-NFA scope change — §B14.7 and OD-06', () => {
  const contract: RateContract = {
    id: 'ctr-1', contractNumber: 'RC-2026-0088', eventId: 'evt-1',
    supplierId: 'cp-abc', supplierName: 'ABC Supplies Co.',
    categoryScope: ['Indirect'], currency: 'USD',
    ceilingValue: 220_000, committedValue: 141_500,
    startsAt: 0, expiresAt: Date.now() + 86_400_000,
  };

  const base = {
    kind: 'ADD_LINE' as const,
    eventStatus: 'AWARDED' as const,
    origin: 'ITEMS_AND_LOTS' as const,
    itemDescription: 'Toner cartridge, HP 26X',
    itemCategory: 'Indirect',
    itemValue: 48_600,
    currency: 'USD',
    contract,
  };

  it('explains why the line cannot join, in terms of the bid that does not exist', () => {
    const routing = scopeChangeRouting(base);
    expect(routing.blockedDetail).toContain('never quoted');
    expect(routing.blockedDetail).toContain('trace to a bid');
  });

  it('always offers at least one legitimate destination', () => {
    for (const status of ['AWARD_RECOMMENDED', 'PENDING_AWARD_APPROVAL', 'AWARDED', 'CLOSED'] as const) {
      const routing = scopeChangeRouting({ ...base, eventStatus: status, contract: null });
      expect(routing.destinations.length).toBeGreaterThan(0);
      expect(routing.destinations.some((d) => d.id === 'NEW_EVENT')).toBe(true);
    }
  });

  it('omits the call-off entirely when no contract covers the category', () => {
    const routing = scopeChangeRouting({ ...base, itemCategory: 'Professional Services' });
    expect(routing.destinations.some((d) => d.id === 'CALL_OFF')).toBe(false);
  });

  it('shows the call-off with its remaining ceiling headroom when it absorbs the line', () => {
    const routing = scopeChangeRouting(base);
    const callOff = routing.destinations.find((d) => d.id === 'CALL_OFF')!;
    expect(callOff.headroom).toEqual({ ceiling: 220_000, committed: 141_500, remaining: 78_500 });
    expect(callOff.recommended).toBe(true);
  });

  it('recommends a new event when the call-off would breach the ceiling', () => {
    const routing = scopeChangeRouting({ ...base, itemValue: 120_000 });
    const callOff = routing.destinations.find((d) => d.id === 'CALL_OFF')!;
    expect(callOff.consequence).toContain('breach');
    expect(routing.destinations.find((d) => d.id === 'NEW_EVENT')!.recommended).toBe(true);
  });

  it('offers the corrigendum only while the event is still taking responses', () => {
    const open = scopeChangeRouting({ ...base, eventStatus: 'OPEN' });
    expect(open.destinations.some((d) => d.id === 'CORRIGENDUM')).toBe(true);
    expect(scopeChangeRouting(base).destinations.some((d) => d.id === 'CORRIGENDUM')).toBe(false);
  });

  it('renders all three OD-06 modes distinctly', () => {
    const manual = scopeChangeRouting(base, settings({ od06Routing: 'MANUAL' }));
    expect(manual.destinations.every((d) => !d.recommended)).toBe(true);
    expect(manual.preselected).toBeNull();

    const guided = scopeChangeRouting(base, settings({ od06Routing: 'GUIDED' }));
    expect(guided.destinations.filter((d) => d.recommended)).toHaveLength(1);
    expect(guided.preselected).toBeNull();

    const automatic = scopeChangeRouting(base, settings({ od06Routing: 'AUTOMATIC' }));
    expect(automatic.preselected).toBe('CALL_OFF');
  });

  it('knows which statuses close the award to new lines', () => {
    expect(isPostAward('AWARD_RECOMMENDED')).toBe(true);
    expect(isPostAward('AWARDED')).toBe(true);
    expect(isPostAward('OPEN')).toBe(false);
    expect(isPostAward('UNDER_EVALUATION')).toBe(false);
  });
});

describe('award-quantity adjustment — OD-05', () => {
  const base = {
    awardedQuantity: 1_000, proposedQuantity: 1_000, tolerancePct: 10,
    lineTotalQuantity: 1_200, prQuantity: 1_100, restrictToPrQuantity: true,
    unitPrice: 8.67,
  };

  it('computes the delta both ways and the bound the input is checked against', () => {
    const result = assessQuantityAdjustment({ ...base, proposedQuantity: 1_050 });
    expect(result.deltaAbsolute).toBe(50);
    expect(result.deltaPct).toBeCloseTo(5, 5);
    expect(result.bound).toEqual({ lower: 900, upper: 1_100 });
    // Not 1,101: 1,000 x 1.1 is 1,100.0000000000002 before it is rounded.
    expect(assessQuantityAdjustment({ ...base, awardedQuantity: 12_000, proposedQuantity: 12_000, lineTotalQuantity: 20_000, prQuantity: 20_000 }).bound)
      .toEqual({ lower: 10_800, upper: 13_200 });
    expect(result.valueDelta).toBeCloseTo(433.5, 2);
  });

  it('logs an in-tolerance change with no re-approval under OD-05a', () => {
    const result = assessQuantityAdjustment({ ...base, proposedQuantity: 1_050 });
    expect(result.withinTolerance).toBe(true);
    expect(result.approvalPath).toBe('LOGGED_NO_APPROVAL');
    expect(result.blocked).toBe(false);
  });

  it('takes one level under OD-05b and the whole chain under OD-05c', () => {
    expect(assessQuantityAdjustment({ ...base, proposedQuantity: 1_050 }, settings({ od05ToleranceApproval: 'SINGLE_LEVEL' })).approvalPath).toBe('SINGLE_LEVEL');
    expect(assessQuantityAdjustment({ ...base, proposedQuantity: 1_050 }, settings({ od05ToleranceApproval: 'FULL_CHAIN' })).approvalPath).toBe('FULL_CHAIN');
  });

  it('blocks and routes anything outside the tolerance, whatever OD-05 says', () => {
    for (const option of ['LOG_ONLY', 'SINGLE_LEVEL', 'FULL_CHAIN'] as const) {
      const result = assessQuantityAdjustment(
        { ...base, proposedQuantity: 1_180, lineTotalQuantity: 2_000, prQuantity: 2_000 },
        settings({ od05ToleranceApproval: option }),
      );
      expect(result.withinTolerance).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.approvalPath).toBe('BLOCKED_ROUTED');
      expect(result.sentence).toContain('scope change');
    }
  });

  it('refuses to allocate more than the line asked for', () => {
    const result = assessQuantityAdjustment({ ...base, proposedQuantity: 1_400, tolerancePct: 100 });
    expect(result.breaches.some((b) => b.includes("line's total quantity"))).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('reconciles against the source PR only when Restrict RFQ PO Quantity is on', () => {
    const restricted = assessQuantityAdjustment({ ...base, proposedQuantity: 1_150, tolerancePct: 100 });
    expect(restricted.breaches.some((b) => b.includes('requisition'))).toBe(true);

    const unrestricted = assessQuantityAdjustment({
      ...base, proposedQuantity: 1_150, tolerancePct: 100, restrictToPrQuantity: false,
    });
    expect(unrestricted.breaches.some((b) => b.includes('requisition'))).toBe(false);
  });

  it('treats an unchanged quantity as in tolerance and uneventful', () => {
    const result = assessQuantityAdjustment(base);
    expect(result.deltaAbsolute).toBe(0);
    expect(result.withinTolerance).toBe(true);
    expect(result.blocked).toBe(false);
  });
});

describe('correction after final approval — OD-07', () => {
  const nonMaterial = classifyChange(doc(), doc({ costCentre: 'CC-9000' }));
  const material = classifyChange(doc(), doc({ comparisonSheetVersion: 4 }));

  it('allows an errata note for a non-material correction', () => {
    const eligibility = errataEligibility(nonMaterial);
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.requiresNewRevision).toBe(false);
  });

  it('refuses an errata for a material change and says which field caught it', () => {
    const eligibility = errataEligibility(material);
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.requiresNewRevision).toBe(true);
    expect(eligibility.blockingChanges.map((c) => c.field)).toContain('comparisonSheetVersion');
    expect(eligibility.explanation).toContain('material list');
  });

  it('raises a revision for everything under OD-07b', () => {
    const eligibility = errataEligibility(nonMaterial, settings({ od07PostApproval: 'ALWAYS_NEW_REVISION' }));
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.requiresNewRevision).toBe(true);
  });

  it('under errata-only, refuses a material change without offering a revision', () => {
    const eligibility = errataEligibility(material, settings({ od07PostApproval: 'ERRATA_ONLY' }));
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.requiresNewRevision).toBe(false);
    expect(eligibility.explanation).toContain('new event');
  });

  it('has nothing to record when nothing changed', () => {
    const eligibility = errataEligibility(classifyChange(doc(), doc()));
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.requiresNewRevision).toBe(false);
  });

  it('attaches an erratum to its revision without touching the document', () => {
    const nfa = noteWithFirstRevision();
    const next = addErratum(nfa, {
      id: 'err-1', revisionNumber: 1, field: 'costCentre', label: 'Cost centre',
      from: 'CC-4400', to: 'CC-9000', reason: 'Charged to the wrong centre at intake.',
      authoredBy: 'user-ar', authoredByName: 'A. Rahman', authoredAt: 8_000,
    });
    expect(next.revisions[0].errata).toHaveLength(1);
    expect(next.revisions[0].document.costCentre).toBe('CC-4400');
  });
});

describe('the open-decision register', () => {
  it('carries all nine, each with a default that is one of its options', () => {
    expect(OPEN_DECISIONS).toHaveLength(9);
    for (const decision of OPEN_DECISIONS) {
      const current = DEFAULT_OPEN_DECISIONS[decision.settingKey] as string;
      expect(decision.options.map((o) => o.value)).toContain(current);
    }
  });

  it('names, for every option, what the screen looks like under it', () => {
    for (const decision of OPEN_DECISIONS) {
      expect(decision.options.length).toBeGreaterThanOrEqual(2);
      for (const option of decision.options) {
        expect(option.screenEffect.length).toBeGreaterThan(30);
      }
    }
  });

  it('marks the ones that change a screen — the five this pack renders both sides of', () => {
    const changing = OPEN_DECISIONS.filter((d) => d.changesTheScreen).map((d) => d.id);
    expect(changing).toEqual(['OD-01', 'OD-02', 'OD-03', 'OD-04', 'OD-05', 'OD-06', 'OD-07']);
  });
});
