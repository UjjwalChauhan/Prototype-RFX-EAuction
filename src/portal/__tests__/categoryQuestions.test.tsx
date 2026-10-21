/**
 * What a supplier sees when one ask asks in more than one category.
 *
 * The seeded Warehouse Consumables RFQ buys cartons under Indirect and pallets
 * under Logistics, so it carries two questionnaires. Three things have to hold
 * on the supplier's screen, and all three are failure modes rather than
 * decoration:
 *
 * 1. A supplier shortlisted for both sees both sets, each under its own
 *    heading. Merging them into one list would ask about pallet treatment
 *    halfway through a stationery price schedule.
 * 2. A supplier shortlisted for one sees only theirs. Being handed somebody
 *    else's questions is how a supplier concludes the buyer does not know what
 *    they sell.
 * 3. The numbering runs across the whole submission. "Question 1" appearing
 *    twice is how an answer goes to the wrong place when it is discussed on
 *    the phone.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, type AppState } from '../../store/store';
import { RequestDetail } from '../PortalRequests';
import { vendorSections } from '../../domain/vendorPortal';
import * as seed from '../../data/seed';
import type { VendorItem } from '../../domain/vendorPortal';

const EVENT_ID = 'evt-rfq-061';
const NOW = Date.now();

const STATE: Partial<AppState> = {
  events: seed.EVENTS,
  bidders: [...seed.EVENT_BIDDERS, ...seed.REQUEST_BIDDERS],
  questionnaires: seed.REQUEST_QUESTIONNAIRES(),
  responses: [],
  lots: [...seed.LOTS, ...seed.OTHER_EVENT_LOTS],
  lineItems: [...seed.LINE_ITEMS, ...seed.OTHER_EVENT_LINE_ITEMS],
};

/** The RFQ as one supplier meets it, taken from the portal's own derivation. */
function askFor(counterpartyId: string): VendorItem {
  const sections = vendorSections({
    events: seed.EVENTS,
    bidders: [...seed.EVENT_BIDDERS, ...seed.REQUEST_BIDDERS],
    responses: [],
    counterpartyId,
    now: NOW,
  });
  const item = sections
    .flatMap((section) => [...section.active, ...section.past])
    .find((each) => each.event.id === EVENT_ID);
  expect(item, `${counterpartyId} cannot see ${EVENT_ID}`).toBeDefined();
  return item as VendorItem;
}

function paint(counterpartyId: string): string {
  return renderToString(
    <StoreProvider seed={STATE}>
      <RequestDetail item={askFor(counterpartyId)} now={NOW} onBack={() => {}} />
    </StoreProvider>,
  )
    .replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

describe('a supplier shortlisted for the whole basket', () => {
  const html = paint('cp-abc');

  it('sees a heading for each category, not one merged list', () => {
    expect(html).toContain('Indirect — what we are asking');
    expect(html).toContain('Logistics — what we are asking');
  });

  it('sees the logistics questions, which only that library asks', () => {
    expect(html).toContain('ISPM 15 heat treated');
    expect(html).toContain('Pallet supply model');
  });

  it('sees the ordinary commercial questions too', () => {
    expect(html).toContain('Payment terms offered');
  });

  it('is told why there is more than one set', () => {
    expect(html).toContain('This event buys in more than one category');
  });
});

describe('a supplier shortlisted for one category', () => {
  const html = paint('cp-brightpath');

  it('sees the questions for the category they were asked for', () => {
    expect(html).toContain('ISPM 15 heat treated');
  });

  it('is not shown the other category’s questions at all', () => {
    expect(html).not.toContain('Payment terms offered');
    expect(html).not.toContain('Price validity, in days');
  });

  it('gets the plain heading, because there is nothing to distinguish', () => {
    expect(html).toContain('What we are asking');
    expect(html).not.toContain('This event buys in more than one category');
  });
});

describe('the other side of the same split', () => {
  const html = paint('cp-prime');

  it('sees the commercial questions they were shortlisted for', () => {
    expect(html).toContain('Payment terms offered');
  });

  it('is not asked about pallets they do not supply', () => {
    expect(html).not.toContain('ISPM 15 heat treated');
    expect(html).not.toContain('Pallet supply model');
  });
});

describe('the submission reads as one form', () => {
  it('numbers the questions across both sets rather than restarting', () => {
    const html = paint('cp-abc');
    // Four questions in each set; the second set must start at 5, so a "1"
    // appearing twice as a question index would be the bug.
    const indices = Array.from(html.matchAll(/>(\d+)\.</g)).map((m) => Number(m[1]));
    expect(indices.length).toBeGreaterThanOrEqual(8);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });
});
