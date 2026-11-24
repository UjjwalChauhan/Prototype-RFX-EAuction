/**
 * The Employee Portal's rules: an event held for approval is released only by
 * the last level, every evaluator gets the asks they were named to, and the
 * technical view never carries a price.
 */
import { describe, expect, it } from 'vitest';
import {
  agentProposal, approvalItems, awaiting, bidderCommercialEnvelope, bidderTechnicalEnvelope, commercialEnvelope, decideEventApproval, divergences, evaluationTasks,
  eventApprovalSteps, redact, releaseHeldEvent, revealingTokens, ruleProposal, technicalOutcome,
  technicalEnvelope, technicalProjection, unlockPreconditions,
  type EventApprovalRequest, type StageAssignment,
} from '../employeePortal';
import type { EventBidder, Question, Response, Score, SourcingEvent } from '../types';

function event(overrides: Partial<SourcingEvent> = {}): SourcingEvent {
  return {
    id: 'evt-1', tenantId: 't', eventNumber: 'SE-2026-0001', title: 'Office supplies', description: '',
    side: 'BUY', templateId: null, journeyPattern: 'JP-05', businessUnit: 'CS', category: 'Indirect',
    project: null, costCentre: null, currency: 'INR', estimatedValue: 120_000, ownerId: 'user-ar',
    status: 'PENDING_APPROVAL', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['RFP'], currentStage: 'RFP', envelopeMode: 'TWO_ENVELOPE', vendorInputPoints: [],
    publishedAt: null, closesAt: null, awardedAt: null, parentEventId: null, version: 1,
    configSnapshotAtPublish: null,
    ...overrides,
  };
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1', questionnaireId: 'qn', sectionId: null, sequence: 1, code: 'Q1', type: 'long_text',
    title: 'Method', helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 10,
    scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false, allowAttachment: false,
    askedPer: 'VENDOR',
    ...overrides,
  };
}

function score(bidderId: string, questionId: string, evaluatorId: string, value: number, at = 1): Score {
  return {
    id: `${bidderId}-${questionId}-${evaluatorId}-${at}`, eventId: 'rfp', bidderId, questionId, evaluatorId, value,
    comment: '', method: 'MANUAL', agentConfidence: null, citedEvidence: null, overridesScoreId: null,
    overrideReason: null, createdAt: at,
  };
}

const CHAIN = [
  { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
  { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
];

function request(): EventApprovalRequest {
  return {
    id: 'apr-1', eventId: 'evt-1', raisedById: 'user-ar', raisedByName: 'A. Rahman', raisedAt: 10,
    amount: 120_000, currency: 'INR', steps: eventApprovalSteps(CHAIN), status: 'PENDING',
  };
}

describe('event approval', () => {
  it('moves level by level and is released only by the last', () => {
    const first = decideEventApproval(request(), 1, 'APPROVED', '', 20);
    expect(first.status).toBe('PENDING');
    const items = approvalItems({ events: [event()], nfas: [], requests: [first], notes: [], nameOf: (id) => id });
    expect(awaiting(items[0], 'M. Prasad')).toBe(true);
    expect(awaiting(items[0], 'A. Rahman')).toBe(false);
    expect(decideEventApproval(first, 2, 'APPROVED', '', 30).status).toBe('APPROVED');
  });

  it('ends the chain on a decline', () => {
    expect(decideEventApproval(request(), 1, 'DECLINED', 'Budget', 20).status).toBe('DECLINED');
  });

  it('reads a hold from the notes, and its release', () => {
    const hold = { id: 'n1', key: 'event:apr-1', kind: 'HOLD' as const, byName: 'A. Rahman', at: 11, text: 'Wait' };
    const held = approvalItems({ events: [event()], nfas: [], requests: [request()], notes: [hold], nameOf: (id) => id });
    expect(held[0].status).toBe('ON_HOLD');
    const released = approvalItems({
      events: [event()], nfas: [], requests: [request()],
      notes: [hold, { ...hold, id: 'n2', kind: 'UNHOLD', at: 12 }], nameOf: (id) => id,
    });
    expect(released[0].status).toBe('PENDING');
  });

  it('publishes the umbrella and the first ask, and invites that ask now', () => {
    const umbrella = event();
    const rfp = event({ id: 'evt-1-rfp', parentEventId: 'evt-1', status: 'DRAFT', configSnapshotAtPublish: { stage: 'RFP', opensAt: 1, closesAt: 2, technicalGate: 'MIN_SCORE' } });
    const rfq = event({ id: 'evt-1-rfq', parentEventId: 'evt-1', status: 'DRAFT' });
    const bidder = { id: 'b1', eventId: 'evt-1-rfp', invitedAt: null } as EventBidder;
    const later = { id: 'b2', eventId: 'evt-1-rfq', invitedAt: null } as EventBidder;
    const out = releaseHeldEvent([umbrella, rfp, rfq], [bidder, later], 'evt-1', 99);
    expect(out.events.map((e) => e.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'DRAFT']);
    expect(out.events[0].configSnapshotAtPublish).toMatchObject({ technicalGate: 'MIN_SCORE', journeyPattern: 'JP-05' });
    expect(out.events[0].configSnapshotAtPublish).not.toHaveProperty('stage');
    expect(out.bidders.map((b) => b.invitedAt)).toEqual([99, null]);
  });
});

describe('evaluation tasks', () => {
  const assignment: StageAssignment = {
    stage: 'RFP', gate: 'MIN_SCORE', minScore: 70, rubricId: 'BANDS_4',
    technicalEvaluatorIds: ['user-js', 'ev-pn'], commercialEvaluatorIds: ['ev-rm'],
  };
  const rfp = event({ id: 'rfp', status: 'PUBLISHED', configSnapshotAtPublish: { stage: 'RFP', evaluationStages: [assignment], blindTechnical: true } });

  it('gives each evaluator the envelope they were named to, and nothing on a held event', () => {
    expect(evaluationTasks([rfp], 'user-js').map((t) => t.role)).toEqual(['TECHNICAL']);
    expect(evaluationTasks([rfp], 'ev-rm').map((t) => t.role)).toEqual(['COMMERCIAL']);
    expect(evaluationTasks([rfp], 'user-mp')).toEqual([]);
    expect(evaluationTasks([{ ...rfp, status: 'DRAFT' }], 'user-js')).toEqual([]);
  });

  it('hands a technical evaluator no price — not a price line, not a commercial answer', () => {
    const questions = [question(), question({ id: 'q-price', type: 'price_schedule' }), question({ id: 'q-terms', envelope: 'COMMERCIAL' })];
    const response: Response = {
      id: 'r1', eventId: 'rfp', bidderId: 'b1', version: 1, submittedAt: 1,
      answers: [
        { questionId: 'q1', value: 'We deliver weekly', attachmentName: null },
        { questionId: 'q-price', value: 1200, attachmentName: null },
        { questionId: 'q-terms', value: '45 days credit', attachmentName: null },
      ],
      priceLines: [{ lineItemId: 'l1', unitPrice: 9.5, currency: 'INR', leadTimeDays: 5, notes: null }],
    };
    const view = technicalProjection(response, questions);
    expect(view.answers.map((a) => a.questionId)).toEqual(['q1']);
    expect(view).not.toHaveProperty('priceLines');
  });

  it('flags and redacts a file name that names the bidder', () => {
    const names = ['Acme Office Supplies Private Limited'];
    expect(revealingTokens('ACME_ISO9001.pdf', names)).toEqual(['acme']);
    expect(redact('ACME_ISO9001.pdf', names)).toBe('▇▇▇_ISO9001.pdf');
    expect(revealingTokens('Supplies_list.pdf', names)).toEqual([]);
  });
});

describe('scoring', () => {
  it('states the rule that fired', () => {
    expect(ruleProposal(question({ type: 'number', config: { min: 3 } }), { questionId: 'q1', value: 5, attachmentName: null }))
      .toMatchObject({ value: 10 });
    expect(ruleProposal(question({ type: 'yes_no' }), { questionId: 'q1', value: false, attachmentName: null }))
      .toEqual({ value: 0, rule: 'Yes scores 10, No scores 0' });
  });

  it('proposes with the passage it relied on, and is unsure of a thin answer', () => {
    const thin = agentProposal(question(), { questionId: 'q1', value: 'Yes.', attachmentName: null });
    expect(thin.confidence).toBeLessThan(0.7);
    expect(thin.evidence).toBe('"Yes."');
  });

  it('averages the panel unless a moderator agreed a score, and applies the gate', () => {
    const qs = [question({ id: 'a', weight: 50 }), question({ id: 'b', weight: 50 })];
    const scores = [score('b1', 'a', 'e1', 10), score('b1', 'a', 'e2', 2), score('b1', 'b', 'e1', 6), score('b1', 'b', 'e2', 6)];
    const gate: StageAssignment = { stage: 'RFP', gate: 'MIN_SCORE', minScore: 70, rubricId: 'BANDS_4', technicalEvaluatorIds: ['e1', 'e2'], commercialEvaluatorIds: [] };
    expect(technicalOutcome('b1', qs, scores, ['e1', 'e2'], gate)).toMatchObject({ score: 60, qualified: false });
    const moderated = [...scores, score('b1', 'a', 'consensus:e1', 9, 5)];
    expect(technicalOutcome('b1', qs, moderated, ['e1', 'e2'], gate)).toMatchObject({ score: 75, qualified: true });
  });

  it('puts divergent scores first', () => {
    const qs = [question({ id: 'a' }), question({ id: 'b' })];
    const scores = [score('b1', 'a', 'e1', 5), score('b1', 'a', 'e2', 5), score('b1', 'b', 'e1', 9), score('b1', 'b', 'e2', 3)];
    const rows = divergences(qs, ['b1'], scores, ['e1', 'e2'], 20);
    expect(rows[0]).toMatchObject({ questionId: 'b', spread: 60, divergent: true });
    expect(rows[1].divergent).toBe(false);
  });
});

describe('commercial unlock', () => {
  it('waits for every technical score and the published result', () => {
    const assignment: StageAssignment = { stage: 'RFP', gate: 'MIN_SCORE', minScore: 70, rubricId: 'BANDS_4', technicalEvaluatorIds: ['e1', 'e2'], commercialEvaluatorIds: ['c1'] };
    const sources = [{ event: event({ id: 'rfp' }), assignment }];
    const half = unlockPreconditions(sources, [{ eventId: 'rfp', evaluatorId: 'e1', envelope: 'TECHNICAL', submittedAt: 1 }], []);
    expect(half.every((p) => p.met)).toBe(false);
    const done = unlockPreconditions(
      sources,
      ['e1', 'e2'].map((id) => ({ eventId: 'rfp', evaluatorId: id, envelope: 'TECHNICAL' as const, submittedAt: 1 })),
      [{ eventId: 'rfp', publishedBy: 'e1', publishedAt: 2, minScore: 70, qualified: [], disqualified: [], notify: 'AT_AWARD' }],
    );
    expect(done.every((p) => p.met)).toBe(true);
  });
});

describe('banded rules', () => {
  it('finds the band a number falls in', async () => {
    const { bandFor } = await import('../employeePortal');
    expect(bandFor('0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10', 12)).toMatchObject({ points: 10 });
    expect(bandFor('0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10', 4)).toMatchObject({ points: 6 });
    expect(bandFor('≤5 days = 10 · 6–10 = 7 · 11–20 = 4 · >20 = 1', 3)).toMatchObject({ points: 10 });
    expect(bandFor('≤5 days = 10 · 6–10 = 7 · 11–20 = 4 · >20 = 1', 30)).toMatchObject({ points: 1 });
    expect(bandFor('Longer credit scores higher', 30)).toBeNull();
  });
});

describe('envelopes', () => {
  const assignment: StageAssignment = { stage: 'RFP', gate: 'MIN_SCORE', minScore: 70, rubricId: 'BANDS_4', technicalEvaluatorIds: ['e1', 'e2'], commercialEvaluatorIds: ['c1'] };
  const qs = [question(), question({ id: 'q-price', type: 'price_schedule' }), question({ id: 'q-terms', envelope: 'COMMERCIAL' })];
  const nameOf = (id: string) => id;
  const tech = (over: Partial<Parameters<typeof technicalEnvelope>[0]> = {}) => technicalEnvelope({
    eventId: 'rfp', assignment, questions: qs, responses: 2, openings: [], scores: [], submissions: [], result: undefined, nameOf, ...over,
  });

  it('keeps the technical envelope sealed until the panel opens it, and holds only technical questions', () => {
    expect(tech({ responses: 0 }).stage).toBe('AWAITING');
    const sealed = tech();
    expect(sealed.stage).toBe('SEALED');
    expect(sealed.questions.map((q) => q.id)).toEqual(['q1']);
    expect(tech({ openings: [{ eventId: 'rfp', envelope: 'TECHNICAL', openedBy: 'e1', openedAt: 5 }] }).stage).toBe('OPEN');
    expect(tech({ scores: [score('b1', 'q1', 'e2', 5)] }).stage).toBe('OPEN');
    expect(tech({ result: { eventId: 'rfp', publishedBy: 'e1', publishedAt: 9, minScore: 70, qualified: ['x'], disqualified: [], notify: 'AT_AWARD' } }).stage).toBe('EVALUATED');
  });

  it('locks the commercial envelope behind the technical result, and opens it only through the unlock', () => {
    const comm = (over: Partial<Parameters<typeof commercialEnvelope>[0]> = {}) => commercialEnvelope({
      assignment, questions: qs, priceLines: 3, responses: 2, preconditions: [{ label: 'Technical result published', met: false }],
      unlock: undefined, submitted: false, nameOf, ...over,
    });
    expect(comm()).toMatchObject({ stage: 'LOCKED', priceLines: 3 });
    expect(comm().questions.map((q) => q.id)).toEqual(['q-price', 'q-terms']);
    expect(comm({ preconditions: [{ label: 'x', met: true }] }).stage).toBe('SEALED');
    expect(comm({ unlock: { eventId: 'rfp', requestedBy: 'c1', requestedAt: 1, witnessedBy: null, unlockedAt: null } }).stage).toBe('WITNESS');
    expect(comm({ unlock: { eventId: 'rfp', requestedBy: 'c1', requestedAt: 1, witnessedBy: 'w', unlockedAt: 2 } }).stage).toBe('OPEN');
  });
});

describe('envelopes per bidder', () => {
  const assignment: StageAssignment = { stage: 'RFI', gate: 'MIN_SCORE', minScore: 60, rubricId: 'BANDS_4', technicalEvaluatorIds: ['e1'], commercialEvaluatorIds: [] };
  const bidder = { id: 'b1', eventId: 'rfi', counterpartyId: 'cp-1' } as EventBidder;
  const nameOf = (id: string) => id;

  it('gives a sourcing event no task of its own — its RFI carries the work', () => {
    const umbrella = event({ id: 'src', status: 'OPEN', configSnapshotAtPublish: { evaluationStages: [assignment] }, currentStage: 'RFI' });
    const rfi = event({ id: 'rfi', parentEventId: 'src', status: 'OPEN', currentStage: 'RFI', configSnapshotAtPublish: { stage: 'RFI', evaluationStages: [assignment] } });
    expect(evaluationTasks([umbrella, rfi], 'e1').map((t) => t.event.id)).toEqual(['rfi']);
  });

  it('keeps each bidder’s technical envelope sealed until it is opened for that bidder', () => {
    const base = { eventId: 'rfi', bidder, panel: ['e1'], questions: [question()], scores: [] as Score[], result: undefined, viewerId: 'e1', nameOf };
    expect(bidderTechnicalEnvelope({ ...base, openings: [] }).stage).toBe('SEALED');
    expect(bidderTechnicalEnvelope({ ...base, openings: [{ eventId: 'rfi', envelope: 'TECHNICAL', openedBy: 'e1', openedAt: 1, bidderId: 'b2' }] }).stage).toBe('SEALED');
    const opened = bidderTechnicalEnvelope({ ...base, openings: [{ eventId: 'rfi', envelope: 'TECHNICAL', openedBy: 'e1', openedAt: 1, bidderId: 'b1' }] });
    expect(opened).toMatchObject({ stage: 'OPEN', detail: expect.stringContaining('0 of 1') });
    const scored = bidderTechnicalEnvelope({ ...base, openings: [], scores: [{ ...score('b1', 'q1', 'e1', 7), eventId: 'rfi' }] });
    expect(scored.stage).toBe('SCORED');
  });

  it('never opens the price of a bidder the technical gate turned away', () => {
    const result = { eventId: 'rfp', publishedBy: 'e1', publishedAt: 2, minScore: 60, qualified: ['cp-2'], disqualified: [{ counterpartyId: 'cp-1', reason: 'Scored 41' }], notify: 'AT_AWARD' as const };
    const base = { bidder, panel: ['c1'], preconditions: [{ label: 'x', met: true }], unlock: undefined, submitted: false, nameOf };
    expect(bidderCommercialEnvelope({ ...base, result }).stage).toBe('WITHHELD');
    expect(bidderCommercialEnvelope({ ...base, result: undefined, preconditions: [{ label: 'Technical result published', met: false }] }).stage).toBe('LOCKED');
    expect(bidderCommercialEnvelope({ ...base, panel: [], result: undefined }).stage).toBe('NONE');
  });
});

describe('technical score on a completed envelope', () => {
  const assignment: StageAssignment = { stage: 'RFI', gate: 'PASS_FAIL', minScore: 60, rubricId: 'BANDS_4', technicalEvaluatorIds: ['e1'], commercialEvaluatorIds: [] };
  const qs = [question({ id: 'ko', title: 'ISO 9001', isKnockout: true, weight: 0 }), question({ id: 'w', weight: 100 })];
  const at = (b: string, q: string, v: number) => ({ ...score(b, q, 'e1', v), eventId: 'rfi' });
  const result = { eventId: 'rfi', publishedBy: 'e1', publishedAt: 2, minScore: 60, qualified: ['cp-1'], disqualified: [{ counterpartyId: 'cp-2', reason: 'Failed knockout' }], notify: 'AT_AWARD' as const };
  const env = (id: string, cp: string) => bidderTechnicalEnvelope({
    eventId: 'rfi', bidder: { id, eventId: 'rfi', counterpartyId: cp } as EventBidder, panel: ['e1'], assignment,
    questions: qs, openings: [], scores: [at('b1', 'ko', 10), at('b1', 'w', 7), at('b2', 'ko', 0), at('b2', 'w', 9)],
    result, viewerId: 'e1', nameOf: (x) => x,
  });

  it('shows the score of a bidder who passed every knockout', () => {
    expect(env('b1', 'cp-1')).toMatchObject({ stage: 'QUALIFIED', score: 70, detail: 'Passed every knockout' });
  });

  it('names the failed knockout instead of a score', () => {
    expect(env('b2', 'cp-2')).toMatchObject({ stage: 'DISQUALIFIED', score: null, detail: 'Failed knockout: ISO 9001' });
  });
});
