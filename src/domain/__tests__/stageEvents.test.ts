/**
 * One publish, and the family it creates.
 *
 * The behaviour worth pinning down is not that records come out — it is which
 * ones, in what state, and what they share: the ladder produces four asks, only
 * the first is issued, they run back to back, and all four answer against one
 * basket held on the event that raised them.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidEventInput, createSourcingEvent, createStageEvent, isStageEvent, issueStageEvent,
  nextEventNumber, solicitationStagesOf, stageWindows, validateSourcingEventInput,
  type SourcingEventInput,
} from '../stageEvents';
import { JOURNEY_PATTERNS } from '../journeyPatterns';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);
const HOUR = 3_600_000;

function input(over: Partial<SourcingEventInput> = {}): SourcingEventInput {
  return {
    journeyPattern: 'JP-05',
    title: 'Facilities Management 2026',
    category: 'Facilities',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    lines: [
      { description: 'HVAC planned maintenance', quantity: 96, uom: 'visit', baselinePrice: 2_400, lotName: 'Lot 1 · Hard services' },
      { description: 'Cleaning operative', quantity: 42, uom: 'FTE-year', baselinePrice: 11_400, lotName: 'Lot 2 · Soft services' },
    ],
    bidders: [{ counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-global' }],
    timeline: { closesInHours: 72 },
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof createSourcingEvent>[1]> = {}) => ({
  now: NOW, idPrefix: 'evt-test', takenNumbers: [], ...over,
});

describe('which stages become asks', () => {
  it('reads the asks off the journey, in the order it runs them', () => {
    expect(solicitationStagesOf('JP-05')).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(solicitationStagesOf('JP-02')).toEqual(['RFQ']);
    expect(solicitationStagesOf('JP-03')).toEqual(['RFQ', 'AUCTION']);
  });

  it('produces nothing for a journey that solicits nobody', () => {
    expect(solicitationStagesOf('JP-08')).toEqual([]);
    expect(JOURNEY_PATTERNS['JP-08'].vendorInputPoints).toEqual([]);
  });
});

describe('numbering', () => {
  it('continues the series rather than restarting it', () => {
    expect(nextEventNumber(['RFQ-2026-0142'], 'RFQ', 2026)).toBe('RFQ-2026-0143');
  });

  it('starts a series that does not exist yet', () => {
    expect(nextEventNumber([], 'RFI', 2026)).toBe('RFI-2026-0001');
  });

  it('ignores other prefixes and other years', () => {
    const taken = ['RFI-2025-0900', 'RFP-2026-0700', 'nonsense'];
    expect(nextEventNumber(taken, 'RFI', 2026)).toBe('RFI-2026-0001');
  });

  it('gives every member of one family its own number', () => {
    const { event, stageEvents } = createSourcingEvent(input(), ctx());
    const numbers = [event.eventNumber, ...stageEvents.map((s) => s.eventNumber)];
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(event.eventNumber).toBe('SRC-2026-0001');
    expect(stageEvents.map((s) => s.eventNumber)).toEqual([
      'RFI-2026-0001', 'RFP-2026-0001', 'RFQ-2026-0001', 'AUC-2026-0001',
    ]);
  });
});

describe('the schedule', () => {
  it('runs the asks back to back', () => {
    const windows = stageWindows(['RFI', 'RFP'], { closesInHours: 24 }, NOW);
    expect(windows[0]).toMatchObject({ stage: 'RFI', opensAt: NOW, closesAt: NOW + 24 * HOUR });
    expect(windows[1].opensAt).toBe(windows[0].closesAt);
  });

  it('lets one stage have a window of its own', () => {
    const windows = stageWindows(['RFI', 'AUCTION'], { closesInHours: 48, stageHours: { AUCTION: 2 } }, NOW);
    expect(windows[1].closesAt - windows[1].opensAt).toBe(2 * HOUR);
  });

  it('closes the sourcing event when its last ask closes', () => {
    const { event, stageEvents } = createSourcingEvent(input(), ctx());
    expect(event.closesAt).toBe(stageEvents[stageEvents.length - 1].closesAt);
  });
});

describe('the family a full ladder creates', () => {
  const family = createSourcingEvent(input(), ctx());

  it('creates the umbrella plus one ask per solicitation stage', () => {
    expect(family.event.parentEventId).toBeNull();
    expect(family.stageEvents.map((s) => s.currentStage)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    for (const ask of family.stageEvents) {
      expect(ask.parentEventId).toBe(family.event.id);
      expect(isStageEvent(ask)).toBe(true);
    }
  });

  it('issues the first ask and plans the rest', () => {
    expect(family.stageEvents.map((s) => s.status))
      .toEqual(['PUBLISHED', 'DRAFT', 'DRAFT', 'DRAFT']);
    expect(family.stageEvents[0].publishedAt).toBe(NOW);
    expect(family.stageEvents.slice(1).every((s) => s.publishedAt === null)).toBe(true);
  });

  it('gives each ask one stage, so it lands in exactly one section', () => {
    for (const ask of family.stageEvents) {
      expect(ask.stagesEnabled).toEqual([ask.currentStage]);
      expect(ask.vendorInputPoints).toEqual([ask.currentStage]);
    }
  });

  it('keeps one basket, on the event that raised it', () => {
    expect(family.lots).toHaveLength(2);
    expect(family.lineItems).toHaveLength(2);
    for (const lot of family.lots) expect(lot.eventId).toBe(family.event.id);
  });

  it('asks nothing of a supplier through the umbrella itself', () => {
    // Otherwise the portal shows the same event once per stage as well as the
    // asks — the supplier sees eight envelopes where four were sent.
    expect(family.event.vendorInputPoints).toEqual([]);
    expect(family.bidders.every((b) => b.eventId !== family.event.id)).toBe(true);
  });

  it('invites the shortlist to every ask, not to the umbrella', () => {
    for (const ask of family.stageEvents) {
      const invited = family.bidders.filter((b) => b.eventId === ask.id);
      expect(invited.map((b) => b.counterpartyId)).toEqual(['cp-abc', 'cp-global']);
    }
  });

  it('records an invitation time only on the ask that has gone out', () => {
    const [issued, planned] = family.stageEvents;
    expect(family.bidders.filter((b) => b.eventId === issued.id)[0].invitedAt).toBe(NOW);
    expect(family.bidders.filter((b) => b.eventId === planned.id)[0].invitedAt).toBeNull();
  });

  it('values the event from its basket', () => {
    expect(family.event.estimatedValue).toBe(96 * 2_400 + 42 * 11_400);
    for (const ask of family.stageEvents) {
      expect(ask.estimatedValue).toBe(family.event.estimatedValue);
    }
  });

  it('attaches each questionnaire to the ask that asks it', () => {
    const withQuestions = createSourcingEvent(
      input({
        questionnaires: [
          { point: 'RFI', name: 'Capability', questions: [question(1)] },
          { point: 'RFQ', name: 'Pricing', questions: [question(1), question(2)] },
        ],
      }),
      ctx(),
    );
    expect(withQuestions.questionnaires.map((q) => q.stage)).toEqual(['RFI', 'RFQ']);
    const rfi = withQuestions.stageEvents.find((s) => s.currentStage === 'RFI')!;
    expect(withQuestions.questionnaires[0].eventId).toBe(rfi.id);
    expect(withQuestions.questionnaires[0].questions[0].questionnaireId)
      .toBe(withQuestions.questionnaires[0].id);
  });

  it('carries the requisition lines it takes out of the pool', () => {
    const sourced = createSourcingEvent(
      input({
        lines: [{ description: 'A thing', quantity: 1, uom: 'each', lotName: 'Lot 1', sourcePrLineId: 'pr-1' }],
      }),
      ctx(),
    );
    expect(sourced.sourcedLineIds).toEqual(['pr-1']);
    expect(sourced.lineItems[0].sourcePrLineId).toBe('pr-1');
    expect(sourced.lineItems[0].baselineSource).toBeNull();
  });
});

describe('journeys that create fewer asks', () => {
  it('creates one ask for a simple RFQ', () => {
    const family = createSourcingEvent(input({ journeyPattern: 'JP-02' }), ctx());
    expect(family.stageEvents.map((s) => s.currentStage)).toEqual(['RFQ']);
    expect(family.stageEvents[0].status).toBe('PUBLISHED');
  });

  it('keeps the suppliers on the umbrella when a journey solicits nothing', () => {
    const family = createSourcingEvent(
      input({ journeyPattern: 'JP-08', bidders: [{ counterpartyId: 'cp-abc' }] }),
      ctx(),
    );
    expect(family.stageEvents).toEqual([]);
    expect(family.bidders.map((b) => b.eventId)).toEqual([family.event.id]);
    expect(family.event.vendorInputPoints).toEqual(JOURNEY_PATTERNS['JP-08'].vendorInputPoints);
  });

  it('creates nothing that a supplier can see when publish is false', () => {
    const family = createSourcingEvent(input({ publish: false }), ctx());
    expect(family.event.status).toBe('DRAFT');
    expect(family.stageEvents.every((s) => s.status === 'DRAFT')).toBe(true);
    expect(family.event.configSnapshotAtPublish).toBeNull();
  });
});

describe('validation', () => {
  it('accepts what the wizard would let through', () => {
    expect(validateSourcingEventInput(input())).toEqual([]);
  });

  it('names the field that is wrong, not just that something is', () => {
    const errors = validateSourcingEventInput(
      input({ title: '  ', lines: [{ description: '', quantity: 0, uom: '', lotName: '' }] }),
    );
    expect(errors.map((e) => e.field)).toEqual([
      'title',
      'lines[0].description', 'lines[0].uom', 'lines[0].lotName', 'lines[0].quantity',
    ]);
  });

  it('refuses an event with no lines', () => {
    expect(validateSourcingEventInput(input({ lines: [] })).map((e) => e.field)).toContain('lines');
  });

  it('refuses a journey that asks suppliers for something with nobody to ask', () => {
    expect(validateSourcingEventInput(input({ bidders: [] })).map((e) => e.field)).toContain('bidders');
  });

  it('refuses a questionnaire at a point the journey never reaches', () => {
    const errors = validateSourcingEventInput(
      input({ journeyPattern: 'JP-02', questionnaires: [{ point: 'RFI', questions: [question(1)] }] }),
    );
    expect(errors[0].field).toBe('questionnaires[0].point');
  });

  it('refuses a sell-side journey run as a buy', () => {
    const errors = validateSourcingEventInput(input({ journeyPattern: 'JP-12', side: 'BUY' }));
    expect(errors.map((e) => e.field)).toContain('side');
  });

  it('refuses the same supplier twice in one category', () => {
    const errors = validateSourcingEventInput(
      input({ bidders: [{ counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-abc' }] }),
    );
    expect(errors[0].message).toContain('twice');
  });

  it('throws rather than half-creating when a caller skipped validation', () => {
    expect(() => createSourcingEvent(input({ title: '' }), ctx())).toThrow(InvalidEventInput);
  });
});

describe('one ask on its own', () => {
  const parent = createSourcingEvent(input({ journeyPattern: 'JP-02' }), ctx()).event;

  it('inherits the umbrella and adds no second basket', () => {
    // Only the timeline and the shortlist are stated; everything identifying
    // the ask comes from the event it hangs off.
    const added = createStageEvent(
      {
        stage: 'AUCTION',
        input: { bidders: [{ counterpartyId: 'cp-abc' }], timeline: { closesInHours: 2 } },
        parent,
      },
      { now: NOW, takenNumbers: ['AUC-2026-0004'] },
    );
    expect(added.event.parentEventId).toBe(parent.id);
    expect(added.event.eventNumber).toBe('AUC-2026-0005');
    expect(added.event.currentStage).toBe('AUCTION');
    expect(added.lots).toEqual([]);
    expect(added.lineItems).toEqual([]);
    expect(added.event.ownerId).toBe(parent.ownerId);
    expect(added.event.closesAt).toBe(NOW + 2 * HOUR);
  });

  it('raises its own umbrella when it has no parent to hang off', () => {
    const standalone = createStageEvent({ stage: 'RFQ', input: input({ journeyPattern: undefined }) }, ctx());
    expect(standalone.event.parentEventId).toBeNull();
    expect(standalone.event.journeyPattern).toBe('JP-02');
    expect(standalone.stageEvents.map((s) => s.currentStage)).toEqual(['RFQ']);
    expect(standalone.lots.length).toBeGreaterThan(0);
  });

  it('never seals an auction against a technical envelope', () => {
    const added = createStageEvent(
      {
        stage: 'AUCTION',
        input: {
          bidders: [{ counterpartyId: 'cp-abc' }],
          evaluation: { envelopeMode: 'TWO_ENVELOPE' },
        },
        parent,
      },
      { now: NOW },
    );
    expect(added.event.envelopeMode).toBe('SINGLE');
  });
});

describe('issuing a planned ask', () => {
  const family = createSourcingEvent(input(), ctx());
  const planned = family.stageEvents[1];

  it('publishes it and records when', () => {
    const issued = issueStageEvent(planned, NOW + HOUR);
    expect(issued.status).toBe('PUBLISHED');
    expect(issued.publishedAt).toBe(NOW + HOUR);
  });

  it('leaves an ask that has already gone out exactly as it was', () => {
    const first = family.stageEvents[0];
    expect(issueStageEvent(first, NOW + HOUR)).toBe(first);
  });
});

describe('telling an ask from a re-auction', () => {
  it('counts a single-stage child as an ask', () => {
    const family = createSourcingEvent(input(), ctx());
    expect(isStageEvent(family.stageEvents[0])).toBe(true);
    expect(isStageEvent(family.event)).toBe(false);
  });

  it('does not count a re-auction, which is a whole event with a parent', () => {
    const reauction = {
      ...createSourcingEvent(input({ journeyPattern: 'JP-09' }), ctx()).event,
      parentEventId: 'evt-0142',
    };
    expect(isStageEvent(reauction)).toBe(false);
  });
});

function question(sequence: number) {
  return {
    sectionId: null,
    sequence,
    code: `Q-${sequence}`,
    type: 'long_text' as const,
    title: `Question ${sequence}`,
    helpText: '',
    isRequired: true,
    envelope: 'TECHNICAL' as const,
    weight: 0,
    scoringMethod: 'NONE' as const,
    maxScore: 0,
    rubric: null,
    isKnockout: false,
    allowAttachment: false,
    config: {},
  };
}
