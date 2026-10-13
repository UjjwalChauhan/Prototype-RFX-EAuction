/**
 * The comparison page, painted.
 *
 * What is checked here is what a buyer would notice immediately if it broke:
 * the suppliers are the columns, the line-item block carries price / quantity /
 * tax / total, the L1 columns name a winner, and a two-envelope event shows a
 * seal rather than a price.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparisonTab } from '../tabs/ComparisonTab';
import { StoreProvider, initialState, type AppState } from '../../store/store';
import { PRIMARY_EVENT_ID } from '../../data/seed';

function paint(
  eventId: string, seed: Partial<AppState> = {}, sheet: 'TECHNICAL' | 'COMMERCIAL' = 'TECHNICAL',
): string {
  return renderToString(
    <StoreProvider seed={{ ...initialState(), ...seed }}>
      <ComparisonTab eventId={eventId} initialSheet={sheet} />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

/** The demonstration event runs a single envelope, so prices are readable. */
const SINGLE = (): Partial<AppState> => {
  const base = initialState();
  return {
    events: base.events.map((e) => (e.id === PRIMARY_EVENT_ID ? { ...e, envelopeMode: 'SINGLE' as const } : e)),
  };
};

describe('the technical sheet', () => {
  const html = paint(PRIMARY_EVENT_ID);

  it('opens on technical, with a column per supplier', () => {
    expect(html).toContain('Technical comparison');
    // Blind technical is locked on at tenant scope, so the columns are labels.
    expect(html).toContain('Bidder A');
    expect(html).toContain('Bidder D');
    expect(html).not.toContain('ABC Supplies Co.');
  });

  it('shows the questions and the answers given to them', () => {
    expect(html).toContain('Years trading in this category');
    expect(html).toContain('Is all paper FSC or PEFC certified?');
    expect(html).toContain('ISO 9001 certification');
  });

  it('marks the knockout question as one', () => {
    expect(html).toContain('knockout');
  });

  it('says the scoring is incomplete rather than failing everyone on it', () => {
    expect(html).toContain('The technical evaluation is not finished');
    expect(html).toContain('scoring incomplete');
    expect(html).not.toContain('does not qualify');
  });

  it('carries the totals a buyer reads the sheet for', () => {
    expect(html).toContain('Technical score');
    expect(html).toContain('Technical rank');
    expect(html).toContain('Technical gate');
  });
});

describe('the commercial sheet', () => {
  const html = paint(PRIMARY_EVENT_ID, SINGLE(), 'COMMERCIAL');

  it('puts the suppliers across the top, named once prices are readable', () => {
    expect(html).toContain('Commercial comparison');
    expect(html).toContain('ABC Supplies Co.');
    expect(html).toContain('Metro Business Supplies');
  });

  it('carries the L1 columns beside the suppliers', () => {
    expect(html).toContain('L1 VENDOR');
    expect(html).toContain('L1 QUANTITY');
  });

  it('lays a line item out as a block of price, quantity, tax and total', () => {
    expect(html).toContain('A4 copier paper, 80gsm, ream of 500');
    expect(html).toContain('>Price<');
    expect(html).toContain('>Qtty<');
    expect(html).toContain('>Total<');
    expect(html).toContain('Tax (12%)');
  });

  it('groups the lines under the lot they are bid in', () => {
    expect(html).toContain('Lot 1 · Paper');
    expect(html).toContain('Lot 3 · Filing');
  });

  it('closes with the rows the client sheet closes with', () => {
    expect(html).toContain('Other Charges');
    expect(html).toContain('Base Amount');
    expect(html).toContain('Tax Amount');
    expect(html).toContain('Commercial rank');
  });

  it('names an L1 supplier and ranks the rest', () => {
    expect(html).toContain('Rank 1');
    expect(html).toContain('Rank 4');
    expect(html).toContain('Total landed value');
  });

  it('shows the commercial questions that are not the price schedule', () => {
    expect(html).toContain('Commercial terms as answered');
    expect(html).toContain('Payment terms offered');
    expect(html).not.toContain('Price schedule');
  });

  it('seals it on a two-envelope event, and shows no price at all', () => {
    const sealed = paint(PRIMARY_EVENT_ID, {}, 'COMMERCIAL');
    expect(sealed).toContain('Commercial envelopes are sealed');
    expect(sealed).toContain('Unlock commercial');
    expect(sealed).not.toContain('Base Amount');
    expect(sealed).not.toContain('L1 VENDOR');
  });
});

describe('an event with nobody on it', () => {
  it('says so instead of drawing an empty grid', () => {
    // The seeded events all carry a shortlist, so the emptiness is made here.
    const html = paint('evt-rfq-039', { bidders: [] });
    expect(html).toContain('Nobody has been invited yet');
  });
});
