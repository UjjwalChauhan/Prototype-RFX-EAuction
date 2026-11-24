/**
 * Items & Vendors — the basket and the people asked to price it, on one step.
 *
 * The step replaced two: a basket the buyer could see and a shortlist they
 * built against a basket they could not. What is worth holding is that a line
 * carries its provenance, its lot and who is shortlisted on it in the same
 * row, that suppliers are shortlisted against lines rather than the event, and
 * that coverage is reported per line, since a category with four vendors in
 * it can still contain a line with none.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import {
  AddVendorPanel, INITIAL_DRAFT, ItemsAndVendorsStep, categoryGroupsOf,
  invitedByCategoryOf, type Draft,
} from '../CreateEventWizard';
import { defaultShortlist, suggestBidders } from '../../domain/bidders';
import { COUNTERPARTIES } from '../../data/seed';

function line(over: Partial<Draft['lines'][number]>): Draft['lines'][number] {
  return {
    id: 'l1', itemCode: 'X-1', description: 'A thing', specification: '', quantity: 10,
    uom: 'each', deliveryLocation: 'Dubai DC', needBy: '',
    baselinePrice: 100, lotName: 'Lot 1 · Things', category: 'IT Hardware',
    superCategory: 'Technology', ...over,
  };
}

const LINES = [
  line({ id: 'l1', itemCode: 'LAP-005', description: 'Laptop, 15in', quantity: 52, baselinePrice: 2022, lotName: 'Lot 1 · Laptop', sourceRequestNumber: 'RQ-TGRANL-00130' }),
  line({ id: 'l2', itemCode: 'MON-012', description: 'Monitor, 24in', quantity: 93, baselinePrice: 453, lotName: 'Lot 2 · Monitor' }),
  line({ id: 'l3', itemCode: 'PMP-001', description: 'Pump, centrifugal', quantity: 4, baselinePrice: 9000, lotName: 'Lot 3 · Pump', category: 'Facilities & MRO', superCategory: 'Indirect' }),
];

function draftWith(over: Partial<Draft> = {}): Draft {
  return { ...INITIAL_DRAFT, lines: LINES, ...over };
}

/** A draft with a roster already on it — seeding runs in an effect, which
 *  server rendering does not, so the grid is set up explicitly here. */
const STAFFED = draftWith({
  vendorIds: ['cp-nova', 'cp-orion', 'cp-summit'],
  invitedByLine: {
    l1: ['cp-nova', 'cp-orion'],
    l2: ['cp-nova'],
    l3: [],
  },
  seededCategories: ['IT Hardware', 'Facilities & MRO'],
});

function paint(draft: Draft, showVendors = true): string {
  return renderToString(
    <StoreProvider>
      <ItemsAndVendorsStep
        draft={draft}
        patch={() => {}}
        estimatedValue={draft.lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0)}
        groups={categoryGroupsOf(draft)}
        showVendors={showVendors}
      />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

describe('the basket carries everything a line is', () => {
  it('shows the description, the item code and the requisition it came from', () => {
    const html = paint(STAFFED);
    expect(html).toContain('Laptop, 15in');
    expect(html).toContain('LAP-005');
    expect(html).toContain('from RQ-TGRANL-00130');
    // A line typed here says so rather than looking like it came from nowhere.
    expect(html).toContain('added here');
  });

  it('shows quantity with its unit, the target and the extended value', () => {
    const html = paint(STAFFED);
    expect(html).toContain('52 each');
    expect(html).toContain('Target');
    expect(html).toMatch(/2,022\S* \/ each/);
    expect(html).toContain('Estimated value');
  });

  it('groups the lines under every lot, with the number of lines in it', () => {
    const html = paint(STAFFED);
    expect(html).toContain('Lot 1 · Laptop');
    expect(html).toContain('Lot 3 · Pump');
    expect(html).toContain('1 line · ');
    expect(html).toContain('3 lines · 3 lots');
  });

  it('carries the delivery point and the category on the line itself', () => {
    const html = paint(STAFFED);
    expect(html).toContain('Dubai DC');
    expect(html).toContain('Facilities & MRO');
  });
});

describe('vendors sit on the same step as the lines', () => {
  it('shows each vendor with the master detail a buyer would otherwise go looking for', () => {
    const html = paint(STAFFED);
    const nova = COUNTERPARTIES.find((c) => c.id === 'cp-nova')!;
    expect(html).toContain(nova.name);
    expect(html).toContain(nova.code);
    expect(html).toContain(nova.contactEmail);
    expect(html).toContain(nova.locationsServed[0]);
    expect(html).toContain(`Onboarding ${nova.onboardingRating}`);
    expect(html).toContain('Onboarded');
  });

  it('says which lines each supplier is shortlisted for', () => {
    const html = paint(STAFFED);
    // Nova is on the laptop and the monitor; Summit sits on the event with nothing to price.
    expect(html).toContain('Laptop, Monitor');
    expect(html).toContain('No lines yet');
  });

  it('shows who is on each line and what the policy still wants', () => {
    const html = paint(STAFFED);
    expect(html).toContain('2 of 3 needed');
    expect(html).toContain('Nobody shortlisted');
    expect(html).toContain('Laptop · 2, needs 1 more');
  });

  it('lets lines be selected, and suppliers shortlisted, by name', () => {
    const html = paint(STAFFED);
    expect(html).toContain('Select Laptop, 15in');
    expect(html).toContain('Shortlist Nova Technologies FZE');
    expect(html).toContain('Shortlist for lot');
  });

  it('marks a shortlisting the vendor master would not have proposed', () => {
    // Summit serves Facilities & MRO, not IT Hardware. The buyer may still
    // shortlist them for a monitor — but the row says the master does not list it.
    const html = paint({ ...STAFFED, invitedByLine: { ...STAFFED.invitedByLine, l2: ['cp-nova', 'cp-summit'] } });
    expect(html).toContain('does not list Summit Industrial Supply against IT Hardware');
  });

  it('reports coverage per line, not per category', () => {
    const html = paint(STAFFED);
    // Two lines have somebody on them; the pump has nobody, even though its
    // category has a vendor sitting on the event.
    expect(html).toContain('2 of 3 lines covered');
    expect(html).toContain('1 with two or more vendors');
  });

  it('shows nothing about vendors on a journey that competes for nothing', () => {
    const html = paint(STAFFED, false);
    expect(html).not.toContain('Suppliers & bidders');
    expect(html).not.toContain('Shortlist Nova Technologies FZE');
    expect(html).toContain('Laptop, 15in');
  });

  it('says plainly when the buyer has cleared the roster', () => {
    const html = paint(draftWith({ vendorIds: [], invitedByLine: {} }));
    expect(html).toContain('No vendors on the event');
  });

  it('opens on a roster rather than on nothing', () => {
    // The vendor master proposes per category before the buyer gets here, so
    // the readiness rail is right from the first screen of the wizard.
    expect(INITIAL_DRAFT.vendorIds.length).toBeGreaterThan(0);
    for (const line of INITIAL_DRAFT.lines) {
      expect(INITIAL_DRAFT.invitedByLine[line.id]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('the shortlist is still proposed per category', () => {
  const panel = (alreadyOn: string[] = []) => renderToString(
    <StoreProvider>
      <AddVendorPanel
        open
        onClose={() => {}}
        groups={categoryGroupsOf(draftWith())}
        onAdd={() => {}}
        alreadyOn={alreadyOn}
      />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");

  it('proposes the suppliers that serve each category in the basket', () => {
    const html = panel();
    for (const cp of suggestBidders(COUNTERPARTIES, 'IT Hardware').suggested) {
      expect(html).toContain(cp.name);
    }
    for (const cp of suggestBidders(COUNTERPARTIES, 'Facilities & MRO', 'Indirect').suggested) {
      expect(html).toContain(cp.name);
    }
  });

  it('keeps a supplier who serves neither category behind "add another"', () => {
    // Meridian is Professional & Consultancy only. They can still be invited —
    // the master is a proposal, not a gate — but not from the opening list.
    const html = panel();
    expect(html).not.toContain('Meridian Advisory Partners');
    expect(html).toMatch(/Add another supplier \(\d+ available\)/);
  });

  it('does not offer somebody already on the event', () => {
    expect(panel(['cp-nova'])).not.toContain('Nova Technologies FZE');
  });

  it('never opens with a supplier who could not be awarded', () => {
    for (const id of defaultShortlist(COUNTERPARTIES, 'Electrical & Instrumentation')) {
      expect(COUNTERPARTIES.find((c) => c.id === id)!.isProvisional).toBe(false);
    }
  });
});

describe('the shortlist per category is derived, not kept twice', () => {
  it('reads a category shortlist back out of the line invitations', () => {
    expect(invitedByCategoryOf(STAFFED)).toEqual({
      'IT Hardware': ['cp-nova', 'cp-orion'],
      'Facilities & MRO': [],
    });
  });

  it('groups the lines by the category they were requisitioned under', () => {
    const groups = categoryGroupsOf(draftWith());
    expect(groups.map((g) => g.category)).toEqual(['IT Hardware', 'Facilities & MRO']);
    expect(groups[0].lines).toHaveLength(2);
  });
});
