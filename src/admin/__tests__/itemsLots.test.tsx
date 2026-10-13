/**
 * Items & Lots — that an event shows the basket it was published with.
 *
 * The regression this pins down: the tab used to read one fixed list of lines
 * out of the seed, so every event except the one that list described opened
 * onto an empty table — including an event created minutes earlier in the
 * wizard with a full basket on screen.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ItemsLotsTab } from '../tabs/ItemsLotsTab';
import {
  StoreProvider, initialState, lineItemsForEvent, lotsForEvent, reducer,
} from '../../store/store';
import { EVENTS, LINE_ITEMS, LOTS, PRIMARY_EVENT_ID } from '../../data/seed';
import type { LineItem, Lot, SourcingEvent } from '../../domain/types';

function paint(eventId: string): string {
  return renderToString(
    <StoreProvider>
      <ItemsLotsTab eventId={eventId} />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
}

describe('every seeded event carries a basket', () => {
  const state = initialState();

  it.each(EVENTS.map((e) => [e.eventNumber, e.id]))(
    '%s has at least one lot, and every lot holds lines',
    (_number, eventId) => {
      const lots = lotsForEvent(state, eventId);
      const lines = lineItemsForEvent(state, eventId);
      expect(lots.length).toBeGreaterThan(0);
      expect(lines.length).toBeGreaterThan(0);
      for (const lot of lots) {
        expect(lines.filter((l) => l.lotId === lot.id).length).toBeGreaterThan(0);
      }
    },
  );

  it("keeps the primary event's own lots and lines intact", () => {
    expect(lotsForEvent(state, PRIMARY_EVENT_ID).map((l) => l.id))
      .toEqual(LOTS.map((l) => l.id));
    expect(lineItemsForEvent(state, PRIMARY_EVENT_ID).map((l) => l.id))
      .toEqual(LINE_ITEMS.map((l) => l.id));
  });

  it('never lends one event a line belonging to another', () => {
    for (const event of EVENTS) {
      const lotIds = new Set(lotsForEvent(state, event.id).map((l) => l.id));
      for (const line of lineItemsForEvent(state, event.id)) {
        expect(lotIds.has(line.lotId)).toBe(true);
      }
    }
  });
});

describe('the tab paints what the event actually holds', () => {
  it('lists the lots and lines of the published RFI', () => {
    const html = paint('evt-rfi-005');
    expect(html).toContain('Lot 1 · Hard services');
    expect(html).toContain('Lot 3 · Helpdesk & CAFM');
    expect(html).toContain('HVAC planned maintenance, per site visit');
    expect(html).toContain('Cleaning operative, day shift');
  });

  it("shows every lot's lines until a lot is chosen", () => {
    const state = initialState();
    const html = paint('evt-rfi-005');
    const count = lineItemsForEvent(state, 'evt-rfi-005').length;
    expect(html).toContain(`${count} line(s)`);
  });

  it("does not show another event's lines", () => {
    const html = paint('evt-rfi-005');
    expect(html).not.toContain('A4 copier paper, 80gsm, ream of 500');
  });
});

describe('an event created in the wizard brings its lines with it', () => {
  const eventId = 'evt-new';
  const event = { ...EVENTS[0], id: eventId, eventNumber: 'RFQ-2026-9999' } as SourcingEvent;
  const lot: Lot = {
    id: `${eventId}-lot-1`, eventId, lotNumber: 1, name: 'Lot 1 · Widgets',
    description: '', sequence: 1, biddingOpenAt: null, biddingCloseAt: null,
    awardMode: 'SINGLE', minSuppliers: 1, maxSuppliers: null,
    reservePrice: null, targetPrice: null, ceilingPrice: null, floorPrice: null,
    status: 'LOT_PENDING',
  };
  const line: LineItem = {
    id: `${eventId}-li-1`, lotId: lot.id, lineNumber: 1, itemCode: 'WID-1',
    description: 'A widget', specification: '', quantity: 4, uom: 'each',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: null, taxClass: null,
    baselinePrice: 10, baselineSource: 'BUDGET', currency: 'USD',
    isOptional: false, allowAlternate: false, sourcePrLineId: null,
  };

  it('holds the published lines against the new event', () => {
    const next = reducer(initialState(), {
      type: 'CREATE_EVENT', event, lots: [lot], lineItems: [line],
    });
    expect(lineItemsForEvent(next, eventId)).toEqual([line]);
  });

  it("leaves every other event's basket alone", () => {
    const before = initialState();
    const next = reducer(before, {
      type: 'CREATE_EVENT', event, lots: [lot], lineItems: [line],
    });
    expect(lineItemsForEvent(next, PRIMARY_EVENT_ID))
      .toEqual(lineItemsForEvent(before, PRIMARY_EVENT_ID));
  });

  it('creates an event with no lines without inventing any', () => {
    const next = reducer(initialState(), { type: 'CREATE_EVENT', event, lots: [] });
    expect(lineItemsForEvent(next, eventId)).toEqual([]);
  });
});
