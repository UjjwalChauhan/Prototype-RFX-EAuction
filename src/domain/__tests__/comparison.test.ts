/**
 * The comparison sheets.
 *
 * The assertions worth having here are the ones about money and silence: that
 * a line total is quantity × price × tax and is computed once, that a supplier
 * who did not quote is absent from the ranking rather than cheapest, that a
 * partial quotation is not ranked against a complete one, and that a technical
 * gate mid-scoring says "not yet" rather than "no".
 */
import { describe, expect, it } from 'vitest';
import {
  commercialComparison, commercialCsv, formatAnswer, latestSubmission, taxRateFor,
  technicalComparison, technicalCsv, vendorColumns,
} from '../comparison';
import type {
  CostComponent, EventBidder, LineItem, Lot, Question, Questionnaire, Response, Score,
  SourcingEvent, Stage,
} from '../types';

const NAMES = { 'cp-a': 'Alpha Supplies', 'cp-b': 'Bravo Trading', 'cp-c': 'Charlie Ltd' };

function event(over: Partial<SourcingEvent> = {}): SourcingEvent {
  return {
    id: 'evt-1', tenantId: 't1', eventNumber: 'SRC-2026-0001', title: 'A basket',
    description: '', side: 'BUY', templateId: null, journeyPattern: 'JP-02',
    businessUnit: 'BU', category: 'Cat', project: null, costCentre: null, currency: 'USD',
    estimatedValue: 0, ownerId: 'u1', status: 'PUBLISHED', createdFrom: 'MANUAL',
    sourceReference: null, stagesEnabled: ['RFQ'], currentStage: 'RFQ', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ'], publishedAt: 1, closesAt: 2, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
    ...over,
  };
}

function bidder(id: string, counterpartyId: string, over: Partial<EventBidder> = {}): EventBidder {
  return {
    id, eventId: 'evt-1', counterpartyId, isProvisional: false, invitedAt: 1,
    invitationStatus: 'SENT', declineReason: null, ndaAcceptedAt: null,
    participationStatus: 'SUBMITTED', qualificationStatus: 'PENDING', awardStatus: 'NONE',
    qualificationSnapshot: 0, performanceRatingSnapshot: 0, bidOnBehalfAllowed: false,
    maskedLabel: `Bidder ${id.slice(-1).toUpperCase()}`, disqualified: false,
    disqualificationReason: null,
    ...over,
  };
}

function lot(id: string, name: string): Lot {
  return {
    id, eventId: 'evt-1', lotNumber: 1, name, description: '', sequence: 1,
    biddingOpenAt: null, biddingCloseAt: null, awardMode: 'SINGLE', minSuppliers: 1,
    maxSuppliers: null, reservePrice: null, targetPrice: null, ceilingPrice: null,
    floorPrice: null, status: 'LOT_PENDING',
  };
}

function line(id: string, over: Partial<LineItem> = {}): LineItem {
  return {
    id, lotId: 'lot-1', lineNumber: 1, itemCode: 'X-1', description: 'A thing',
    specification: '', quantity: 10, uom: 'each', deliveryLocation: '', deliveryDate: null,
    incoterm: null, taxClass: 'STANDARD', baselinePrice: 100, baselineSource: 'BUDGET',
    currency: 'USD', isOptional: false, allowAlternate: false, sourcePrLineId: null,
    ...over,
  };
}

function question(id: string, over: Partial<Question> = {}): Question {
  return {
    id, questionnaireId: 'qn-1', sectionId: null, sequence: 1, code: `C-${id}`,
    type: 'short_text', title: `Question ${id}`, helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10, rubric: null,
    isKnockout: false, allowAttachment: false, config: {},
    ...over,
  };
}

function questionnaire(
  id: string, eventId: string, stage: Stage, questions: Question[],
): Questionnaire {
  return { id, eventId, stage, name: `${stage} questionnaire`, questions };
}

function response(
  bidderId: string,
  prices: Record<string, number>,
  answers: Record<string, string | number | boolean | null> = {},
  over: Partial<Response> = {},
): Response {
  return {
    id: `resp-${bidderId}`, eventId: 'evt-1', bidderId, version: 1, submittedAt: 1_000,
    answers: Object.entries(answers).map(([questionId, value]) => ({
      questionId, value, attachmentName: null,
    })),
    priceLines: Object.entries(prices).map(([lineItemId, unitPrice]) => ({
      lineItemId, unitPrice, currency: 'USD', leadTimeDays: null, notes: null,
    })),
    ...over,
  };
}

function score(bidderId: string, questionId: string, value: number, over: Partial<Score> = {}): Score {
  return {
    id: `s-${bidderId}-${questionId}`, eventId: 'evt-1', bidderId, questionId,
    evaluatorId: 'u1', value, comment: '', method: 'MANUAL', agentConfidence: null,
    citedEvidence: null, overridesScoreId: null, overrideReason: null, createdAt: 1,
    ...over,
  };
}

describe('tax', () => {
  it('reads the rate off the class', () => {
    expect(taxRateFor('STANDARD')).toBe(12);
    expect(taxRateFor('SERVICES')).toBe(5);
    expect(taxRateFor('ZERO')).toBe(0);
  });

  it('taxes nothing when no class is set, rather than guessing a rate', () => {
    expect(taxRateFor(null)).toBe(0);
    expect(taxRateFor(undefined)).toBe(0);
    expect(taxRateFor('SOMETHING_ELSE')).toBe(0);
  });
});

describe('the supplier columns', () => {
  const bidders = [bidder('eb-b', 'cp-b'), bidder('eb-a', 'cp-a')];
  const responses = [response('eb-a', {}), response('eb-b', {}, {}, { submittedAt: null })];

  it('names suppliers when nothing is masked', () => {
    const columns = vendorColumns({ bidders, responses, names: NAMES });
    expect(columns.map((c) => c.name)).toEqual(['Alpha Supplies', 'Bravo Trading']);
  });

  it('reads the masked label under blind evaluation, and keeps the real name off the column', () => {
    const columns = vendorColumns({ bidders, responses, names: NAMES, masked: true });
    expect(columns.map((c) => c.name)).toEqual(['Bidder A', 'Bidder B']);
    expect(columns.every((c) => c.masked)).toBe(true);
  });

  it('reports who has actually submitted', () => {
    const columns = vendorColumns({ bidders, responses, names: NAMES });
    expect(columns.find((c) => c.bidderId === 'eb-a')?.submittedAt).toBe(1_000);
    expect(columns.find((c) => c.bidderId === 'eb-b')?.submittedAt).toBeNull();
  });

  it('reads the latest submitted version, never a draft', () => {
    const responses2 = [
      response('eb-a', { 'li-1': 10 }),
      { ...response('eb-a', { 'li-1': 9 }), id: 'r2', version: 2 },
      { ...response('eb-a', { 'li-1': 1 }), id: 'r3', version: 3, submittedAt: null },
    ];
    expect(latestSubmission(responses2, 'eb-a')?.version).toBe(2);
  });
});

describe('rendering an answer', () => {
  it('says Yes and No rather than true and false', () => {
    expect(formatAnswer(question('q', { type: 'yes_no' }), true)).toBe('Yes');
    expect(formatAnswer(question('q', { type: 'yes_no' }), false)).toBe('No');
  });

  it('gives a lead time its unit', () => {
    expect(formatAnswer(question('q', { type: 'lead_time' }), 9)).toBe('9 days');
  });

  it('resolves a choice back to the label the supplier saw', () => {
    const q = question('q', {
      type: 'single_choice',
      config: { options: [{ id: 'o1', label: 'Net 30', score: 6, isDisqualifying: false, requiresDetail: false }] },
    });
    expect(formatAnswer(q, 'o1')).toBe('Net 30');
    expect(formatAnswer(q, ['o1'])).toBe('Net 30');
  });

  it('renders a missing answer as empty, never as zero', () => {
    expect(formatAnswer(question('q'), null)).toBe('');
  });
});

describe('the commercial sheet', () => {
  const lots = [lot('lot-1', 'Lot 1 · Paper')];
  const lineItems = [line('li-1', { quantity: 60, description: 'Apron' })];
  const bidders = [bidder('eb-a', 'cp-a'), bidder('eb-b', 'cp-b'), bidder('eb-c', 'cp-c')];

  const sheet = (over: Partial<Parameters<typeof commercialComparison>[0]> = {}) =>
    commercialComparison({
      event: event(),
      lots,
      lineItems,
      questionnaires: [],
      responses: [
        response('eb-a', { 'li-1': 100 }),
        response('eb-b', { 'li-1': 500 }),
        // Charlie holds an invitation and quoted nothing.
        response('eb-c', {}),
      ],
      bidders,
      scores: [],
      names: NAMES,
      ...over,
    });

  it('computes base, tax and total once, from quantity and price', () => {
    const [only] = sheet().lines;
    const alpha = only.cells.find((c) => c.bidderId === 'eb-a')!;
    expect(alpha.base).toBe(6_000);
    expect(alpha.tax).toBe(720);
    expect(alpha.total).toBe(6_720);
    expect(alpha.taxRate).toBe(12);
  });

  it('leaves a supplier who did not quote blank, and out of the ranking', () => {
    const [only] = sheet().lines;
    const charlie = only.cells.find((c) => c.bidderId === 'eb-c')!;
    expect(charlie.unitPrice).toBeNull();
    expect(charlie.total).toBeNull();
    expect(charlie.rank).toBeNull();
    expect(charlie.isL1).toBe(false);
  });

  it('ranks lowest first on a BUY, and names the L1 supplier and quantity', () => {
    const [only] = sheet().lines;
    expect(only.cells.find((c) => c.bidderId === 'eb-a')?.rank).toBe(1);
    expect(only.cells.find((c) => c.bidderId === 'eb-b')?.rank).toBe(2);
    expect(only.l1).toEqual({
      bidderId: 'eb-a', name: 'Alpha Supplies', total: 6_720, quantity: 60,
    });
  });

  it('inverts on a SELL, because nothing here hard-codes lowest wins', () => {
    const [only] = sheet({ event: event({ side: 'SELL' }) }).lines;
    expect(only.cells.find((c) => c.bidderId === 'eb-b')?.rank).toBe(1);
    expect(only.l1?.bidderId).toBe('eb-b');
  });

  it('marks a tie as a tie rather than picking by array order', () => {
    const [only] = sheet({
      responses: [response('eb-a', { 'li-1': 100 }), response('eb-b', { 'li-1': 100 })],
    }).lines;
    expect(only.cells.filter((c) => c.isL1)).toHaveLength(2);
    expect(only.tied).toBe(true);
  });

  it('sums base and tax across the lines a supplier quoted', () => {
    const twoLines = sheet({
      lineItems: [line('li-1', { quantity: 60 }), line('li-2', { quantity: 10, taxClass: 'SERVICES' })],
      responses: [response('eb-a', { 'li-1': 100, 'li-2': 200 })],
      bidders: [bidder('eb-a', 'cp-a')],
    });
    const alpha = twoLines.totals[0];
    expect(alpha.base).toBe(6_000 + 2_000);
    expect(alpha.tax).toBe(720 + 100);
    expect(alpha.total).toBe(8_820);
    expect(alpha.complete).toBe(true);
  });

  it('resolves other charges on all four bases, as the auction does', () => {
    const component = (
      id: string, name: string, basis: CostComponent['basis'], value: number,
    ): CostComponent => ({
      id, eventId: 'evt-1', name, basis, valueByBidder: { 'eb-a': value },
      source: 'quoted', agentProposed: false,
    });
    const totals = sheet({
      costComponents: [
        component('c1', 'Freight', 'LUMP_SUM', 250),
        component('c2', 'Duty', 'PERCENTAGE', 5),
        component('c3', 'Handling', 'PER_UNIT', 2),
        component('c4', 'Docs', 'PER_LINE', 40),
      ],
    }).totals;
    const alpha = totals.find((t) => t.bidderId === 'eb-a')!;
    // 250 lump sum + 5% of 6,000 + 2 × 60 units + 40 × 1 line.
    expect(alpha.otherCharges).toBe(250 + 300 + 120 + 40);
    expect(alpha.total).toBe(6_000 + 720 + 710);
    // Nothing was loaded against Bravo, so Bravo carries no charges.
    expect(totals.find((t) => t.bidderId === 'eb-b')?.otherCharges).toBe(0);
  });

  it('does not rank a partial quotation against a complete one', () => {
    const partial = sheet({
      lineItems: [line('li-1', { quantity: 60 }), line('li-2', { quantity: 10 })],
      responses: [
        response('eb-a', { 'li-1': 100, 'li-2': 100 }),
        // Bravo priced only the first line, and would otherwise total lowest.
        response('eb-b', { 'li-1': 1 }),
      ],
      bidders: [bidder('eb-a', 'cp-a'), bidder('eb-b', 'cp-b')],
    });
    const bravo = partial.totals.find((t) => t.bidderId === 'eb-b')!;
    expect(bravo.complete).toBe(false);
    expect(bravo.rank).toBeNull();
    expect(partial.l1?.bidderId).toBe('eb-a');
  });

  it('names the lines nobody quoted', () => {
    const holes = sheet({
      lineItems: [line('li-1'), line('li-9', { description: 'Nobody wanted this' })],
    });
    expect(holes.unquotedLines.map((l) => l.description)).toEqual(['Nobody wanted this']);
  });

  it('carries the commercial questions but never the price schedule itself', () => {
    const withTerms = sheet({
      questionnaires: [questionnaire('qn-1', 'evt-1', 'RFQ', [
        question('q-price', { envelope: 'COMMERCIAL', type: 'price_schedule', scoringMethod: 'NONE', maxScore: 0 }),
        question('q-pay', { envelope: 'COMMERCIAL', title: 'Payment terms' }),
        question('q-tech', { envelope: 'TECHNICAL' }),
      ])],
      responses: [response('eb-a', { 'li-1': 100 }, { 'q-pay': 'Net 60' })],
      bidders: [bidder('eb-a', 'cp-a')],
    });
    expect(withTerms.questionRows.map((r) => r.question.id)).toEqual(['q-pay']);
    expect(withTerms.questionRows[0].cells[0].display).toBe('Net 60');
  });
});

describe('the technical sheet', () => {
  const rfi = questionnaire('qn-rfi', 'evt-rfi', 'RFI', [
    question('q-cap', { title: 'Capability', weight: 30 }),
    question('q-price', { envelope: 'COMMERCIAL', title: 'Price schedule' }),
  ]);
  const rfp = questionnaire('qn-rfp', 'evt-rfp', 'RFP', [
    question('q-iso', { title: 'ISO 9001', isKnockout: true, weight: 20, sequence: 1 }),
    question('q-ref', { title: 'References', weight: 0, scoringMethod: 'NONE', sequence: 2 }),
  ]);
  const events = [
    event({ id: 'evt-rfp', eventNumber: 'RFP-2026-0002', currentStage: 'RFP' }),
    event({ id: 'evt-rfi', eventNumber: 'RFI-2026-0001', currentStage: 'RFI' }),
  ];
  const bidders = [bidder('eb-a', 'cp-a'), bidder('eb-b', 'cp-b')];
  const responses = [
    response('eb-a', {}, { 'q-cap': 'Nationwide', 'q-iso': 'Valid', 'q-ref': 'Three' }),
    response('eb-b', {}, { 'q-cap': 'Regional', 'q-iso': 'Expired' }),
  ];

  const sheet = (over: Partial<Parameters<typeof technicalComparison>[0]> = {}) =>
    technicalComparison({
      events,
      questionnaires: [rfi, rfp],
      responses,
      bidders,
      scores: [
        score('eb-a', 'q-cap', 8), score('eb-a', 'q-iso', 10),
        score('eb-b', 'q-cap', 6), score('eb-b', 'q-iso', 0),
      ],
      names: NAMES,
      gate: 'MIN_SCORE',
      minScore: 60,
      ...over,
    });

  it('groups the rows by the ask that asked them, in journey order', () => {
    const sections = sheet().sections;
    expect(sections.map((s) => s.stage)).toEqual(['RFI', 'RFP']);
    expect(sections.map((s) => s.eventNumber)).toEqual(['RFI-2026-0001', 'RFP-2026-0002']);
  });

  it('carries only the technical envelope', () => {
    const rows = sheet().sections.flatMap((s) => s.rows);
    expect(rows.map((r) => r.question.id)).toEqual(['q-cap', 'q-iso', 'q-ref']);
  });

  it('shows each answer against the question that produced it', () => {
    const capability = sheet().sections[0].rows[0];
    expect(capability.cells.map((c) => c.display)).toEqual(['Nationwide', 'Regional']);
    expect(capability.bestScore).toBe(8);
  });

  it('flags an unanswered question rather than showing a blank as an answer', () => {
    const references = sheet().sections[1].rows[1];
    const bravo = references.cells.find((c) => c.bidderId === 'eb-b')!;
    expect(bravo.answered).toBe(false);
    expect(bravo.display).toBe('');
  });

  it('marks a knockout scored zero, and fails that supplier on it', () => {
    const iso = sheet().sections[1].rows[0];
    expect(iso.cells.find((c) => c.bidderId === 'eb-b')?.knockedOut).toBe(true);
    const bravo = sheet().totals.find((t) => t.bidderId === 'eb-b')!;
    expect(bravo.verdict).toBe('DOES_NOT_QUALIFY');
    expect(bravo.knockedOutOn).toEqual(['ISO 9001']);
  });

  it('weights the score by the question weight, over the achievable total', () => {
    const alpha = sheet().totals.find((t) => t.bidderId === 'eb-a')!;
    // 80% at weight 30 and 100% at weight 20 → (80*30 + 100*20) / 50.
    expect(alpha.score).toBeCloseTo((80 * 30 + 100 * 20) / 50, 5);
    expect(alpha.verdict).toBe('QUALIFIES');
    expect(alpha.scored).toBe(2);
    expect(alpha.scoredOf).toBe(2);
  });

  it('says scoring is incomplete rather than failing a supplier nobody has scored', () => {
    const unscored = sheet({ scores: [] }).totals;
    expect(unscored.map((t) => t.verdict)).toEqual(['PENDING', 'PENDING']);
    expect(unscored.every((t) => t.passesGate)).toBe(true);
  });

  it('still fails a knockout while the rest is unscored', () => {
    const partial = sheet({ scores: [score('eb-b', 'q-iso', 0)] }).totals;
    expect(partial.find((t) => t.bidderId === 'eb-b')?.verdict).toBe('DOES_NOT_QUALIFY');
    expect(partial.find((t) => t.bidderId === 'eb-a')?.verdict).toBe('PENDING');
  });

  it('ranks the highest technical score first, whichever side the event is', () => {
    for (const side of ['BUY', 'SELL'] as const) {
      const totals = sheet({ events: events.map((e) => ({ ...e, side })) }).totals;
      expect(totals.find((t) => t.bidderId === 'eb-a')?.rank).toBe(1);
      expect(totals.find((t) => t.bidderId === 'eb-b')?.rank).toBe(2);
    }
  });

  it('counts what was asked and what carries a weight', () => {
    const comparison = sheet();
    expect(comparison.asked).toBe(3);
    expect(comparison.scored).toBe(2);
  });

  it('ignores a questionnaire belonging to an event outside the family', () => {
    const outside = questionnaire('qn-x', 'evt-other', 'RFQ', [question('q-x')]);
    expect(sheet({ questionnaires: [rfi, rfp, outside] }).asked).toBe(3);
  });
});

describe('the exported file', () => {
  const lineItems = [line('li-1', { quantity: 60, description: 'Apron, cotton', uom: 'piece' })];
  const bidders = [bidder('eb-a', 'cp-a'), bidder('eb-b', 'cp-b')];
  const commercial = commercialComparison({
    event: event(),
    lots: [lot('lot-1', 'Lot 1')],
    lineItems,
    questionnaires: [],
    responses: [response('eb-a', { 'li-1': 100 }), response('eb-b', { 'li-1': 500 })],
    bidders,
    scores: [],
    names: NAMES,
  });

  it('leads with an empty label column, then the suppliers, then the L1 columns', () => {
    const [header] = commercialCsv(commercial).split('\n');
    expect(header).toBe(',Alpha Supplies,Bravo Trading,L1 VENDOR,L1 QUANTITY');
  });

  it('lays the rows out as the sheet does', () => {
    // The item row's label is a quoted field and is checked in the next test.
    const labels = commercialCsv(commercial)
      .split('\n')
      .slice(2)
      .map((row) => row.split(',')[0]);
    expect(labels).toEqual([
      'Price', 'Qtty', 'Tax', 'Total',
      'Other Charges', 'Base Amount', 'Tax Amount', 'Total landed value', 'Commercial rank',
    ]);
  });

  it('quotes a value containing a comma rather than breaking the row', () => {
    const rows = commercialCsv(commercial).split('\n');
    expect(rows[1]).toContain('"Apron, cotton (piece units required)"');
    expect(rows[1]).toContain('Rank 1');
    expect(rows[1].endsWith('Alpha Supplies,60')).toBe(true);
  });

  it('writes the totals a reader would check by hand', () => {
    const rows = commercialCsv(commercial).split('\n');
    expect(rows.find((r) => r.startsWith('Base Amount'))).toBe('Base Amount,6000,30000,,');
    expect(rows.find((r) => r.startsWith('Tax Amount'))).toBe('Tax Amount,720,3600,,');
    expect(rows.find((r) => r.startsWith('Total landed value')))
      .toBe('Total landed value,6720,33600,Alpha Supplies,6720');
  });

  it('exports the technical sheet with its verdict rows', () => {
    const technical = technicalComparison({
      events: [event({ id: 'evt-1', eventNumber: 'RFQ-1', currentStage: 'RFQ' })],
      questionnaires: [questionnaire('qn-1', 'evt-1', 'RFQ', [question('q-1', { title: 'Capability' })])],
      responses: [response('eb-a', {}, { 'q-1': 'Nationwide' })],
      bidders: [bidder('eb-a', 'cp-a')],
      scores: [score('eb-a', 'q-1', 9)],
      names: NAMES,
      gate: 'MIN_SCORE',
      minScore: 60,
    });
    const rows = technicalCsv(technical).split('\n');
    expect(rows[0]).toBe(',Alpha Supplies,BEST SCORE');
    expect(rows[1]).toBe('RFQ-1 · RFQ · RFQ questionnaire,,');
    expect(rows[2]).toBe('Capability,Nationwide (9/10),9');
    expect(rows.find((r) => r.startsWith('Technical gate'))).toBe('Technical gate,Qualifies,');
  });
});
