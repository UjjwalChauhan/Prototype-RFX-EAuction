/**
 * The Bidders step — that a cross-category event gets a shortlist per category
 * rather than one flat list, and that the buyer can reach past the proposal.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import {
  BiddersStep, INITIAL_DRAFT, categoryGroupsOf, type Draft,
} from '../CreateEventWizard';
import { defaultShortlist, suggestBidders } from '../../domain/bidders';
import { COUNTERPARTIES } from '../../data/seed';

function draftWith(lines: Draft['lines']): Draft {
  return { ...INITIAL_DRAFT, lines };
}

function line(over: Partial<Draft['lines'][number]>): Draft['lines'][number] {
  return {
    id: 'l1', itemCode: 'X-1', description: 'A thing', specification: '', quantity: 10,
    uom: 'each', deliveryLocation: 'Dubai DC', needBy: '',
    baselinePrice: 100, lotName: 'Lot 1 · Things', category: 'IT Hardware',
    superCategory: 'Technology', ...over,
  };
}

const MIXED = draftWith([
  line({ id: 'l1', description: 'Laptop, 15in', category: 'IT Hardware', superCategory: 'Technology' }),
  line({ id: 'l2', description: 'Monitor, 24in', category: 'IT Hardware', superCategory: 'Technology' }),
  line({ id: 'l3', description: 'Pump, centrifugal', category: 'Facilities & MRO', superCategory: 'Indirect' }),
]);

function paint(draft: Draft): string {
  return renderToString(
    <StoreProvider>
      <BiddersStep
        draft={draft}
        patch={() => {}}
        provisionalSelected={[]}
        groups={categoryGroupsOf(draft)}
      />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
}

describe('lines are distributed across categories', () => {
  it('groups the lines by the category they were requisitioned under', () => {
    const groups = categoryGroupsOf(MIXED);
    expect(groups.map((g) => g.category)).toEqual(['IT Hardware', 'Facilities & MRO']);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(1);
  });

  it('leads with the category carrying the most lines', () => {
    const groups = categoryGroupsOf(draftWith([
      line({ id: 'a', category: 'Fleet & Logistics' }),
      line({ id: 'b', category: 'IT Hardware' }),
      line({ id: 'c', category: 'IT Hardware' }),
    ]));
    expect(groups[0].category).toBe('IT Hardware');
  });

  it('shows each category with its own line count and its items', () => {
    const html = paint(MIXED);
    expect(html).toContain('IT Hardware');
    expect(html).toContain('Facilities & MRO');
    expect(html).toContain('2 lines');
    expect(html).toContain('1 line');
    expect(html).toContain('Laptop, 15in');
    expect(html).toContain('Pump, centrifugal');
  });

  it('says the event spans several categories when it does', () => {
    expect(paint(MIXED)).toContain('spans 2 categories');
    expect(paint(draftWith([line({})]))).not.toContain('spans');
  });
});

describe('suppliers are proposed per category', () => {
  it('proposes suppliers that serve each category', () => {
    const html = paint(MIXED);
    for (const cp of suggestBidders(COUNTERPARTIES, 'IT Hardware').suggested) {
      expect(html).toContain(cp.name);
    }
    for (const cp of suggestBidders(COUNTERPARTIES, 'Facilities & MRO', 'Indirect').suggested) {
      expect(html).toContain(cp.name);
    }
  });

  it('does not propose a supplier who serves neither category', () => {
    // Meridian is Professional & Consultancy only — it may be added, but it is
    // behind "add another supplier", not in the proposed list.
    const html = paint(MIXED);
    expect(html).toContain('Add another supplier');
    expect(html).not.toContain('Meridian Advisory Partners');
  });

  it('never opens with a supplier who could not be awarded', () => {
    const shortlist = defaultShortlist(COUNTERPARTIES, 'Electrical & Instrumentation');
    for (const id of shortlist) {
      expect(COUNTERPARTIES.find((c) => c.id === id)!.isProvisional).toBe(false);
    }
  });
});

describe('the buyer can go past the proposal', () => {
  it('offers every other supplier for adding against the category', () => {
    const html = paint(MIXED);
    expect(html).toMatch(/Add another supplier \(\d+ available\)/);
  });

  it('shows a supplier the buyer added despite the master, marked off-category', () => {
    const html = paint({
      ...MIXED,
      bidderIdsByCategory: { 'IT Hardware': ['cp-meridian'], 'Facilities & MRO': [] },
    });
    expect(html).toContain('Meridian Advisory Partners');
    expect(html).toContain('off-category');
  });

  it('warns a category left with nobody in it', () => {
    const html = paint({
      ...MIXED,
      bidderIdsByCategory: { 'IT Hardware': ['cp-nova'], 'Facilities & MRO': [] },
    });
    expect(html).toContain('nobody to price them');
  });

  it('warns a thin category without calling it empty', () => {
    const html = paint({
      ...MIXED,
      bidderIdsByCategory: { 'IT Hardware': ['cp-nova'], 'Facilities & MRO': ['cp-abc'] },
    });
    expect(html).toContain('recommended 3');
  });
});
