/**
 * RFX Home — that the screen is a reading of the records and never more.
 *
 * The tests that matter here are the ones about absence: a trend with no
 * timestamps in range, a metric with no history, an assistant with the kill
 * switch engaged. A dashboard is the easiest place in a product to state
 * something nobody checked, so what it declines to draw is pinned as firmly
 * as what it draws.
 */
import { describe, expect, it } from 'vitest';
import {
  TREND_WEEKS, WEEK, actionQueue, answerHomeQuestion, assistantOffers, comingUp,
  coverageByEvent, coverageOf, demandFunnel, eventKindOf, homeAlerts, homeHeadline,
  homeMetrics, homePerformance, journeyProgress, journeysOf,
  pipelineColumns, spendByCategory, weeklyCounts, weeklyTotals,
  type HomeInput,
} from '../rfxHome';
import type {
  Clarification, EventBidder, EventStatus, PurchaseRequestLine, SourcingEvent, Stage,
} from '../types';

const NOW = Date.parse('2026-06-15T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function event(over: Partial<SourcingEvent> & { id: string }): SourcingEvent {
  return {
    tenantId: 't', eventNumber: `EV-${over.id}`, title: 'An event', description: '',
    side: 'BUY', templateId: null, journeyPattern: 'JP-05', businessUnit: 'BU',
    category: 'Indirect', project: null, costCentre: null, currency: 'INR',
    estimatedValue: 100_000, ownerId: 'user-ar', status: 'OPEN', createdFrom: 'MANUAL',
    sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFQ', 'AWARD', 'APPROVAL'] as Stage[],
    currentStage: 'RFQ', envelopeMode: 'SINGLE', vendorInputPoints: ['RFQ'],
    publishedAt: NOW - 3 * DAY, closesAt: NOW + 2 * DAY, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
    ...over,
  };
}

function line(over: Partial<PurchaseRequestLine> & { id: string }): PurchaseRequestLine {
  return {
    requestId: 'pr-1', lineNumber: 1, itemCode: 'X', description: 'Thing', specification: '',
    quantity: 1, uom: 'each', needBy: '', deliveryLocation: '', indicativePrice: 10,
    currency: 'INR', sourcingState: 'UNSOURCED', eventNumber: null,
    hasVendorQuote: false, isCatalogItem: false,
    ...over,
  };
}

function question(over: Partial<Clarification> & { id: string }): Clarification {
  return {
    eventId: 'e1', askedByBidderId: 'b1', subject: 'Delivery window',
    question: 'When?', askedAt: NOW - DAY, answer: null, answeredAt: null, answeredBy: null,
    visibility: 'BROADCAST', agentDrafted: false, revealAsker: false,
    ...over,
  };
}

function bidder(over: Partial<EventBidder> & { id: string }): EventBidder {
  return {
    eventId: 'e1', counterpartyId: 'cp-1', isProvisional: false, invitedAt: NOW - 5 * DAY,
    invitationStatus: 'ACCEPTED', declineReason: null, ndaAcceptedAt: null,
    participationStatus: 'SUBMITTED', qualificationStatus: 'QUALIFIED', awardStatus: 'NONE',
    qualificationSnapshot: 80, performanceRatingSnapshot: 70, bidOnBehalfAllowed: false,
    categories: [], maskedLabel: 'Bidder A', disqualified: false, disqualificationReason: null,
    ...over,
  };
}

function input(over: Partial<HomeInput> = {}): HomeInput {
  return {
    now: NOW, userId: 'user-ar', currency: 'INR',
    events: [], bidders: [], responses: [], clarifications: [], nfas: [],
    purchaseRequests: [], purchaseRequestLines: [], requisitions: [], rateContracts: [],
    agentsPaused: false,
    ...over,
  };
}

describe('trailing series', () => {
  it('buckets by week, oldest first', () => {
    const series = weeklyCounts([NOW - 1 * WEEK, NOW - 1 * WEEK, NOW], NOW);
    expect(series).toHaveLength(TREND_WEEKS);
    expect(series[TREND_WEEKS - 1]).toBe(1);
    expect(series[TREND_WEEKS - 2]).toBe(2);
  });

  it('draws nothing when nothing is dated', () => {
    expect(weeklyCounts([null, null], NOW)).toEqual([]);
  });

  it('draws nothing when everything dated falls outside the window', () => {
    // Eight zeroes would read as eight quiet weeks. There is no record at all.
    expect(weeklyCounts([NOW - 40 * WEEK], NOW)).toEqual([]);
  });

  it('sums a value rather than counting rows when asked to', () => {
    const series = weeklyTotals([{ at: NOW, value: 500 }, { at: NOW, value: 250 }], NOW);
    expect(series[TREND_WEEKS - 1]).toBe(750);
  });
});

describe('journeys and the asks under them', () => {
  const ask = event({
    id: 'a1', parentEventId: 'e1', stagesEnabled: ['RFQ'], currentStage: 'RFQ',
  });
  const journey = event({ id: 'e1' });

  it('counts an event once, not once per ask it produced', () => {
    expect(journeysOf([journey, ask]).map((e) => e.id)).toEqual(['e1']);
  });

  it('reports how far through its own stages an event is', () => {
    expect(journeyProgress(journey)).toEqual({ step: 2, total: 4, label: 'RFQ' });
  });
});

describe('the metric strip', () => {
  const state = input({
    events: [
      event({ id: 'e1', status: 'OPEN' }),
      event({ id: 'e2', status: 'UNDER_EVALUATION' }),
      event({ id: 'e3', status: 'PENDING_AWARD_APPROVAL' }),
      event({ id: 'e4', status: 'AWARDED', awardedAt: NOW - 2 * DAY, estimatedValue: 50_000 }),
    ],
    purchaseRequestLines: [line({ id: 'l1' }), line({ id: 'l2', sourcingState: 'IN_EVENT' })],
  });

  it('counts what is open, what is being judged and what is with an approver', () => {
    const byKey = Object.fromEntries(homeMetrics(state).map((m) => [m.key, m.value]));
    expect(byKey.demand).toBe(1);
    expect(byKey.live).toBe(1);
    expect(byKey.evaluating).toBe(1);
    expect(byKey.approving).toBe(1);
  });

  it('leaves out value that has already been awarded or closed', () => {
    const inFlight = homeMetrics(state).find((m) => m.key === 'in-flight')!;
    expect(inFlight.value).toBe(300_000);
  });

  it('shows no trend for a metric the records carry no history for', () => {
    const evaluating = homeMetrics(state).find((m) => m.key === 'evaluating')!;
    expect(evaluating.series).toEqual([]);
  });
});

describe('what needs the buyer today', () => {
  const state = input({
    events: [
      event({ id: 'e1', eventNumber: 'RFQ-1', status: 'OPEN' }),
      event({ id: 'e2', eventNumber: 'RFQ-2', status: 'UNDER_EVALUATION', closesAt: NOW + 5 * DAY }),
      event({ id: 'e3', eventNumber: 'AUC-3', status: 'AUCTION_LIVE' }),
    ],
    clarifications: [question({ id: 'q1', eventId: 'e1' }), question({ id: 'q2', eventId: 'e1' })],
    requisitions: [{
      id: 'prd-1', prdNumber: 'PRD-1', tenantId: 't', lineIds: ['l1', 'l2'],
      requestNumbers: ['RQ-1'], category: 'IT Hardware', superCategory: null,
      businessUnits: ['BU'], currency: 'INR', createdBy: 'user-ar', createdAt: NOW - DAY,
      eventId: null,
    }],
  });

  it('leads with the auction that is already running', () => {
    expect(actionQueue(state)[0].reference).toBe('AUC-3');
  });

  it('counts the unanswered questions on an event into one row', () => {
    const row = actionQueue(state).find((a) => a.reference === 'RFQ-1')!;
    expect(row.title).toBe('Answer 2 supplier questions');
    expect(row.cta).toBe('Answer questions');
  });

  it('gives one row per event, not one per condition it meets', () => {
    const references = actionQueue(state).map((a) => a.reference);
    expect(new Set(references).size).toBe(references.length);
  });

  it('chases consolidated demand that never became an event', () => {
    const row = actionQueue(state).find((a) => a.reference === 'PRD-1')!;
    expect(row.title).toContain('Raise an RFX');
    expect(row.target).toEqual({ kind: 'create', prdId: 'prd-1' });
  });

  it('says nothing at all when nothing is waiting', () => {
    expect(actionQueue(input())).toEqual([]);
  });
});

describe('where everything is', () => {
  const statuses: EventStatus[] = [
    'DRAFT', 'PUBLISHED', 'OPEN', 'UNDER_EVALUATION', 'PENDING_AWARD_APPROVAL', 'AWARDED',
  ];
  const state = input({
    events: statuses.map((status, index) => event({ id: `e${index}`, status })),
  });

  it('puts every journey in exactly one column', () => {
    const total = pipelineColumns(state).reduce((a, c) => a + c.count, 0);
    expect(total).toBe(statuses.length);
  });

  it('counts requisition lines, not requisitions, through the funnel', () => {
    const funnel = demandFunnel(input({
      purchaseRequestLines: [
        line({ id: 'a' }), line({ id: 'b' }),
        line({ id: 'c', sourcingState: 'AWARDED' }),
        line({ id: 'd', sourcingState: 'ON_CONTRACT' }),
      ],
    }));
    expect(funnel.map((s) => s.count)).toEqual([2, 0, 1, 1]);
  });
});

describe('open value by category', () => {
  it('leaves out what has already been awarded', () => {
    const slices = spendByCategory(input({
      events: [
        event({ id: 'e1', category: 'IT Hardware', estimatedValue: 100 }),
        event({ id: 'e2', category: 'IT Hardware', status: 'AWARDED', estimatedValue: 900 }),
      ],
    }));
    expect(slices).toEqual([{ label: 'IT Hardware', value: 100 }]);
  });

  it('rolls everything past the top few into one slice', () => {
    const events = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((category, index) =>
      event({ id: category, category, estimatedValue: 100 - index }));
    const slices = spendByCategory(input({ events }), 5);
    expect(slices).toHaveLength(6);
    expect(slices[5].label).toBe('Other');
    expect(slices[5].value).toBe(95 + 94);
  });
});

describe('performance, read off the events themselves', () => {
  it('reports the median publish-to-award and the sample behind it', () => {
    const performance = homePerformance(input({
      events: [
        event({ id: 'e1', status: 'AWARDED', publishedAt: NOW - 20 * DAY, awardedAt: NOW - 10 * DAY }),
        event({ id: 'e2', status: 'AWARDED', publishedAt: NOW - 30 * DAY, awardedAt: NOW - 10 * DAY }),
        event({ id: 'e3', status: 'AWARDED', publishedAt: NOW - 36 * DAY, awardedAt: NOW - 6 * DAY }),
      ],
    }));
    expect(performance.cycleDays).toBe(20);
    expect(performance.cycleSample).toBe(3);
  });

  it('says nothing rather than zero when nothing has been awarded', () => {
    const performance = homePerformance(input({ events: [event({ id: 'e1' })] }));
    expect(performance.cycleDays).toBeNull();
    expect(performance.cycleSample).toBe(0);
  });
});

describe('coming up, and alerts', () => {
  it('lists the next deadlines in time order and skips what is finished', () => {
    const agenda = comingUp(input({
      events: [
        event({ id: 'e1', closesAt: NOW + 5 * DAY }),
        event({ id: 'e2', closesAt: NOW + 1 * DAY }),
        event({ id: 'e3', status: 'AWARDED', closesAt: NOW + 2 * DAY }),
      ],
    }));
    expect(agenda.map((a) => a.id)).toEqual(['close-e2', 'close-e1']);
  });

  it('flags an event that passed its deadline and did not move', () => {
    const alerts = homeAlerts(input({
      events: [event({ id: 'e1', eventNumber: 'RFQ-1', closesAt: NOW - DAY })],
    }));
    expect(alerts.some((a) => a.title === 'Closed to suppliers, still open here')).toBe(true);
  });

  it('flags a provisional supplier inside a decision, where it would block the award', () => {
    const alerts = homeAlerts(input({
      events: [event({ id: 'e1', status: 'UNDER_EVALUATION' })],
      bidders: [bidder({ id: 'b1', eventId: 'e1', isProvisional: true })],
    }));
    expect(alerts.some((a) => a.title === 'Provisional supplier in a decision')).toBe(true);
  });

  it('does not flag a provisional supplier on an event still taking bids', () => {
    const alerts = homeAlerts(input({
      events: [event({ id: 'e1', status: 'OPEN' })],
      bidders: [bidder({ id: 'b1', eventId: 'e1', isProvisional: true })],
    }));
    expect(alerts.some((a) => a.title === 'Provisional supplier in a decision')).toBe(false);
  });
});

describe('the assistant', () => {
  const state = input({
    events: [event({ id: 'e1', status: 'UNDER_EVALUATION' })],
    clarifications: [question({ id: 'q1', eventId: 'e1' })],
  });

  it('names the agent behind each offer and the first thing it cannot do', () => {
    const offer = assistantOffers(state).find((o) => o.agent === 'AG-05')!;
    expect(offer.agentName).toBe('Clarification');
    expect(offer.limit).toBe('Publish an answer');
  });

  it('offers nothing at all while the tenant kill switch is engaged', () => {
    expect(assistantOffers({ ...state, agentsPaused: true })).toEqual([]);
  });
});

describe('the ask box answers from records', () => {
  const state = input({
    events: [
      event({ id: 'e1', eventNumber: 'RFQ-1', status: 'PENDING_AWARD_APPROVAL' }),
      event({ id: 'e2', eventNumber: 'AUC-2', status: 'AUCTION_LIVE' }),
    ],
    clarifications: [question({ id: 'q1', eventId: 'e1' })],
  });

  it('answers an approvals question with the events actually sitting with an approver', () => {
    const answer = answerHomeQuestion(state, 'what is waiting for approval?');
    expect(answer.answer).toContain('RFQ-1');
    expect(answer.target).toEqual({ kind: 'approvals' });
  });

  it('answers a question about supplier questions, and says where it read it', () => {
    const answer = answerHomeQuestion(state, 'any clarifications open?');
    expect(answer.answer).toContain('1 supplier question is unanswered');
    expect(answer.basis).toBe('Clarifications');
  });

  it('refuses rather than improvises when nothing matches', () => {
    const answer = answerHomeQuestion(state, 'who should we award to');
    expect(answer.basis).toBe('No matching record');
    expect(answer.target).toEqual({ kind: 'agents' });
  });
});

describe('the headline', () => {
  it('names a journey by the ask it is running, and a bare auction as an e-Auction', () => {
    expect(eventKindOf(event({ id: 'a', currentStage: 'RFP', stagesEnabled: ['RFP', 'RFQ'] as Stage[] }))).toBe('RFP');
    expect(eventKindOf(event({ id: 'b', currentStage: 'AWARD', stagesEnabled: ['RFQ', 'AWARD'] as Stage[] }))).toBe('RFQ');
    expect(eventKindOf(event({ id: 'c', currentStage: 'AUCTION', stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD'] as Stage[] }))).toBe('e-Auction');
  });

  it('counts a supplier once across a journey and its asks, responded if they submitted anywhere', () => {
    const data = input({
      events: [event({ id: 'e1' }), event({ id: 'ask', parentEventId: 'e1' })],
      bidders: [
        bidder({ id: 'b1', eventId: 'e1', counterpartyId: 'cp-1' }),
        bidder({ id: 'b1x', eventId: 'ask', counterpartyId: 'cp-1' }),
        bidder({ id: 'b2', eventId: 'e1', counterpartyId: 'cp-2' }),
      ],
      responses: [
        { id: 'r1', eventId: 'ask', bidderId: 'b1x', version: 1, submittedAt: NOW - DAY, answers: [], priceLines: [] },
        { id: 'r2', eventId: 'e1', bidderId: 'b2', version: 1, submittedAt: null, answers: [], priceLines: [] },
      ],
    });
    expect(coverageOf(data, 'e1')).toEqual({ invited: 2, responded: 1 });
  });

  it('lists the thinnest-covered open events first and skips those with no invitees', () => {
    const data = input({
      events: [event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })],
      bidders: [
        bidder({ id: 'b1', eventId: 'e1', counterpartyId: 'cp-1' }),
        bidder({ id: 'b2', eventId: 'e2', counterpartyId: 'cp-2' }),
      ],
      responses: [{ id: 'r', eventId: 'e1', bidderId: 'b1', version: 1, submittedAt: NOW, answers: [], priceLines: [] }],
    });
    expect(coverageByEvent(data).map((c) => c.event.id)).toEqual(['e2', 'e1']);
  });

  it('puts only deadlines inside 48 hours under due-soon, and says nothing about coverage with no invitees', () => {
    const data = input({
      events: [
        event({ id: 'soon', closesAt: NOW + DAY }),
        event({ id: 'week', closesAt: NOW + 4 * DAY }),
        event({ id: 'later', closesAt: NOW + 20 * DAY }),
      ],
    });
    const headline = homeHeadline(data);
    expect(headline.dueSoon.map((d) => d.id)).toEqual(['close-soon']);
    expect(headline.dueThisWeek).toBe(1);
    expect(headline.liveCount).toBe(3);
    expect(headline.coverage).toBeNull();
  });
});
