/**
 * From the wizard's payload to what each screen then shows.
 *
 * The chain the whole feature rests on, tested as one thing rather than as
 * parts that each pass alone: publish through the API, put what comes back
 * into the store, and check that the RFI turns up in the RFI section, that it
 * answers against the basket held on the event that raised it, and that the
 * supplier is sent one ask rather than four.
 */
import { describe, expect, it } from 'vitest';
import { localApi } from '../client';
import {
  biddersForEvent, initialState, lineItemsForEvent, lotsForEvent, reducer, stageEventsOf,
} from '../../store/store';
import { isStageEvent } from '../../domain/stageEvents';
import { vendorSections } from '../../domain/vendorPortal';
import type { CreatedEvents, SourcingEventInput } from '../../domain/stageEvents';
import type { AppState } from '../../store/store';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

const LADDER: SourcingEventInput = {
  journeyPattern: 'JP-05',
  title: 'Facilities Management 2026',
  category: 'Facilities',
  businessUnit: 'Corporate Services',
  ownerId: 'user-ar',
  lines: [
    { description: 'HVAC maintenance', quantity: 96, uom: 'visit', baselinePrice: 2_400, lotName: 'Lot 1 · Hard services' },
    { description: 'Cleaning operative', quantity: 42, uom: 'FTE-year', baselinePrice: 11_400, lotName: 'Lot 2 · Soft services' },
  ],
  bidders: [{ counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-global' }],
  timeline: { closesInHours: 72 },
};

/** Exactly what the Create Event wizard does with what the API hands back. */
async function publish(input = LADDER): Promise<{ state: AppState; family: CreatedEvents }> {
  const before = initialState();
  const family = await localApi({ events: before.events }, { now: () => NOW })
    .createSourcingEvent(input);
  const state = reducer(before, {
    type: 'CREATE_EVENT',
    event: family.event,
    stageEvents: family.stageEvents,
    lots: family.lots,
    lineItems: family.lineItems,
    questionnaires: family.questionnaires,
    bidders: family.bidders,
    sourcedLineIds: family.sourcedLineIds,
  });
  return { state, family };
}

describe('what the store holds afterwards', () => {
  it('holds the sourcing event and its four asks', async () => {
    const { state, family } = await publish();
    for (const event of [family.event, ...family.stageEvents]) {
      expect(state.events.find((e) => e.id === event.id)).toBeDefined();
    }
    expect(stageEventsOf(state, family.event.id).map((e) => e.currentStage))
      .toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
  });

  it('numbers around the events already seeded', async () => {
    const { family } = await publish();
    const before = initialState();
    const taken = new Set(before.events.map((e) => e.eventNumber));
    for (const event of [family.event, ...family.stageEvents]) {
      expect(taken.has(event.eventNumber)).toBe(false);
    }
  });
});

describe('what each section lists', () => {
  it('puts one ask in each of the RFI, RFP, RFQ and auction sections', async () => {
    const { state, family } = await publish();
    for (const stage of ['RFI', 'RFP', 'RFQ', 'AUCTION'] as const) {
      // The stage lists filter on exactly this.
      const listed = state.events.filter((e) => e.currentStage === stage);
      expect(listed.map((e) => e.id)).toContain(
        family.stageEvents.find((s) => s.currentStage === stage)!.id,
      );
    }
  });

  it('leaves the board showing one row, not five', async () => {
    const { state, family } = await publish();
    const board = state.events.filter((e) => !isStageEvent(e));
    expect(board.filter((e) => e.id === family.event.id)).toHaveLength(1);
    for (const ask of family.stageEvents) {
      expect(board.some((e) => e.id === ask.id)).toBe(false);
    }
  });
});

describe('one basket, several asks', () => {
  it('resolves an ask to the basket held on the event that raised it', async () => {
    const { state, family } = await publish();
    const parentLots = lotsForEvent(state, family.event.id);
    expect(parentLots).toHaveLength(2);
    for (const ask of family.stageEvents) {
      expect(lotsForEvent(state, ask.id)).toEqual(parentLots);
      expect(lineItemsForEvent(state, ask.id)).toEqual(lineItemsForEvent(state, family.event.id));
    }
  });

  it('never gives an ask a second copy of the lines', async () => {
    const { state, family } = await publish();
    const lines = state.lineItems.filter(
      (line) => lotsForEvent(state, family.event.id).some((lot) => lot.id === line.lotId),
    );
    expect(lines).toHaveLength(2);
  });
});

describe('who is invited to what', () => {
  it('invites the shortlist to each ask', async () => {
    const { state, family } = await publish();
    for (const ask of family.stageEvents) {
      expect(biddersForEvent(state, ask.id).map((b) => b.counterpartyId))
        .toEqual(['cp-abc', 'cp-global']);
    }
  });

  it('answers "who is on this event" from the board with each supplier once', async () => {
    const { state, family } = await publish();
    const onEvent = biddersForEvent(state, family.event.id);
    expect(onEvent.map((b) => b.counterpartyId)).toEqual(['cp-abc', 'cp-global']);
  });
});

describe('what the supplier is sent', () => {
  it('sends the first ask and holds the rest back', async () => {
    const { state } = await publish();
    const sections = vendorSections({
      events: state.events,
      bidders: state.bidders,
      responses: state.responses,
      counterpartyId: 'cp-abc',
      now: NOW,
    });
    const active = (point: string) =>
      sections.find((s) => s.point === point)!.active.filter((i) => i.event.parentEventId !== null);

    expect(active('RFI')).toHaveLength(1);
    // The RFP, RFQ and auction are prepared but not issued, so nothing about
    // them reaches the supplier yet.
    expect(active('RFP')).toHaveLength(0);
    expect(active('RFQ')).toHaveLength(0);
    expect(active('AUCTION')).toHaveLength(0);
  });

  it('sends the next ask when it is issued, and no earlier', async () => {
    const { state, family } = await publish();
    const rfp = family.stageEvents.find((s) => s.currentStage === 'RFP')!;
    const issued = reducer(state, {
      type: 'UPDATE_EVENT',
      eventId: rfp.id,
      patch: { status: 'PUBLISHED', publishedAt: NOW },
    });
    const sections = vendorSections({
      events: issued.events,
      bidders: issued.bidders,
      responses: issued.responses,
      counterpartyId: 'cp-abc',
      now: NOW,
    });
    expect(sections.find((s) => s.point === 'RFP')!.active.map((i) => i.event.id)).toEqual([rfp.id]);
  });

  it('gives each ask its own deadline', async () => {
    const { family } = await publish();
    const closes = family.stageEvents.map((s) => s.closesAt);
    expect(new Set(closes).size).toBe(closes.length);
    expect(closes).toEqual([...closes].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe('a journey with one ask', () => {
  it('creates one, and it is the one the section shows', async () => {
    const { state, family } = await publish({ ...LADDER, journeyPattern: 'JP-02' });
    expect(family.stageEvents).toHaveLength(1);
    expect(family.stageEvents[0].currentStage).toBe('RFQ');
    expect(family.stageEvents[0].status).toBe('PUBLISHED');
    expect(stageEventsOf(state, family.event.id)).toHaveLength(1);
  });
});
