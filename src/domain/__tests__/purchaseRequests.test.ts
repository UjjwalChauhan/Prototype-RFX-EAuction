/**
 * Purchase requests: the derivation rules, the sourcing projection, and the
 * shape of the seeded requisitions the list is built to handle.
 */
import { describe, expect, it } from 'vitest';
import {
  PR_STATUS_PRESENTATION, SOURCING_STATE_PRESENTATION, categoriesOf, derivedStatus,
  filterLines, filterRequests, lineValue, linesFor, matchesTab, requestAmount,
  sourceableLines, sourcingRollup, toCsv,
} from '../purchaseRequests';
import { PURCHASE_REQUESTS, PURCHASE_REQUEST_LINES } from '../../data/purchaseRequests';
import type { PrFilter, PrTab } from '../purchaseRequests';
import type { PurchaseRequest, PurchaseRequestLine } from '../types';

function line(over: Partial<PurchaseRequestLine> = {}): PurchaseRequestLine {
  return {
    id: 'l1', requestId: 'pr1', lineNumber: 1, itemCode: 'ABC-001',
    description: 'Widget', specification: 'spec', quantity: 10, uom: 'each',
    needBy: '2026-06-01', deliveryLocation: 'Pune', indicativePrice: 5,
    currency: 'USD', sourcingState: 'UNSOURCED', eventNumber: null,
    hasVendorQuote: false, isCatalogItem: false, ...over,
  };
}

function request(over: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: 'pr1', tenantId: 't1', requestNumber: 'RQ-0001', title: 'Test',
    category: 'IT Hardware', superCategory: 'Technology', status: 'APPROVED',
    submittedOn: '2026-01-01', submittedById: 'user-ar', submittedByName: 'A. Rahman',
    submittedByCode: 'TGR-1001', businessUnit: 'BU', costCentre: 'CC-1',
    currency: 'USD', needBy: '2026-06-01', deliveryLocation: 'Pune',
    justification: 'because', ...over,
  };
}

describe('amount derivation', () => {
  it('extends quantity by indicative price', () => {
    expect(lineValue(line({ quantity: 12, indicativePrice: 2.5 }))).toBe(30);
  });

  it('treats a line with no indicative price as contributing nothing', () => {
    expect(lineValue(line({ indicativePrice: null }))).toBe(0);
  });

  it('sums the lines to the header amount', () => {
    const amount = requestAmount([
      line({ id: 'a', quantity: 10, indicativePrice: 3 }),
      line({ id: 'b', quantity: 4, indicativePrice: 2.5 }),
    ]);
    expect(amount).toBe(40);
  });

  it('excludes cancelled lines — a requisition is worth what it still asks for', () => {
    const amount = requestAmount([
      line({ id: 'a', quantity: 10, indicativePrice: 3 }),
      line({ id: 'b', quantity: 100, indicativePrice: 50, sourcingState: 'CANCELLED' }),
    ]);
    expect(amount).toBe(30);
  });
});

describe('sourcing rollup', () => {
  const lines = [
    line({ id: 'a', sourcingState: 'UNSOURCED', quantity: 1, indicativePrice: 100 }),
    line({ id: 'b', sourcingState: 'UNSOURCED', quantity: 1, indicativePrice: 50 }),
    line({ id: 'c', sourcingState: 'IN_EVENT', eventNumber: 'RFQ-2026-0142' }),
    line({ id: 'd', sourcingState: 'AWARDED', eventNumber: 'RFQ-2024-041' }),
    line({ id: 'e', sourcingState: 'ON_CONTRACT' }),
    line({ id: 'f', sourcingState: 'CANCELLED' }),
  ];

  it('counts each state', () => {
    const rollup = sourcingRollup(lines);
    expect(rollup).toMatchObject({
      total: 6, unsourced: 2, inEvent: 1, awarded: 1, onContract: 1, cancelled: 1,
    });
  });

  it('values only the unsourced lines', () => {
    expect(sourcingRollup(lines).unsourcedValue).toBe(150);
  });

  it('lists the distinct events the lines are already out in', () => {
    expect(sourcingRollup(lines).events).toEqual(['RFQ-2024-041', 'RFQ-2026-0142']);
  });
});

describe('sourceableLines', () => {
  it('offers only unsourced lines — nothing may be bid on twice', () => {
    const lines = [
      line({ id: 'a', sourcingState: 'UNSOURCED' }),
      line({ id: 'b', sourcingState: 'IN_EVENT' }),
      line({ id: 'c', sourcingState: 'AWARDED' }),
      line({ id: 'd', sourcingState: 'ON_CONTRACT' }),
      line({ id: 'e', sourcingState: 'CANCELLED' }),
    ];
    expect(sourceableLines(lines).map((l) => l.id)).toEqual(['a']);
  });
});

describe('derivedStatus', () => {
  it('leaves a requisition in its own approval workflow alone', () => {
    for (const status of ['DRAFT', 'PENDING', 'APPROVAL', 'REJECTED'] as const) {
      const result = derivedStatus(request({ status }), [line({ sourcingState: 'AWARDED' })]);
      expect(result, status).toBe(status);
    }
  });

  it('reports approved while every line is still unsourced', () => {
    expect(derivedStatus(request(), [line({ id: 'a' }), line({ id: 'b' })])).toBe('APPROVED');
  });

  it('reports sourcing once no line is left unsourced', () => {
    const result = derivedStatus(request(), [
      line({ id: 'a', sourcingState: 'IN_EVENT' }),
      line({ id: 'b', sourcingState: 'AWARDED' }),
    ]);
    expect(result).toBe('SOURCING');
  });

  it('reports partially sourced on a mixed requisition', () => {
    const result = derivedStatus(request(), [
      line({ id: 'a', sourcingState: 'UNSOURCED' }),
      line({ id: 'b', sourcingState: 'IN_EVENT' }),
    ]);
    expect(result).toBe('PARTIALLY_SOURCED');
  });

  it('closes once every live line is awarded or on contract', () => {
    const result = derivedStatus(request(), [
      line({ id: 'a', sourcingState: 'AWARDED' }),
      line({ id: 'b', sourcingState: 'ON_CONTRACT' }),
      line({ id: 'c', sourcingState: 'CANCELLED' }),
    ]);
    expect(result).toBe('CLOSED');
  });

  it('closes a requisition whose every line was cancelled', () => {
    expect(derivedStatus(request(), [line({ sourcingState: 'CANCELLED' })])).toBe('CLOSED');
  });
});

describe('tabs and filters', () => {
  const requests = [
    request({ id: 'a', status: 'PENDING', submittedById: 'user-ar' }),
    request({ id: 'b', status: 'APPROVAL', submittedById: 'user-kt' }),
    request({ id: 'c', status: 'CLOSED', submittedById: 'user-ar' }),
    request({ id: 'd', status: 'REJECTED', submittedById: 'user-kt' }),
    request({ id: 'e', status: 'SOURCING', submittedById: 'user-ar' }),
  ];

  it('scopes Requested to the signed-in user', () => {
    const mine = requests.filter((r) => matchesTab(r, 'requested', 'user-ar'));
    expect(mine.map((r) => r.id)).toEqual(['a', 'c', 'e']);
  });

  it('puts pending and approval under Pending', () => {
    const pending = requests.filter((r) => matchesTab(r, 'pending', 'user-ar'));
    expect(pending.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('puts closed and rejected under History', () => {
    const history = requests.filter((r) => matchesTab(r, 'history', 'user-ar'));
    expect(history.map((r) => r.id)).toEqual(['c', 'd']);
  });

  it('shows everything under All', () => {
    expect(requests.filter((r) => matchesTab(r, 'all', 'user-ar'))).toHaveLength(5);
  });

  const base: PrFilter = {
    tab: 'all', search: '', category: 'all', status: 'all', sourceableOnly: false,
  };

  it('searches into the lines, because a buyer looks for an item not a number', () => {
    const lines = [line({ id: 'l', requestId: 'a', description: 'Titanium bracket' })];
    const found = filterRequests(requests, lines, { ...base, search: 'titanium' }, 'user-ar');
    expect(found.map((r) => r.id)).toEqual(['a']);
  });

  it('hides requisitions with nothing left to source when asked', () => {
    const lines = [
      line({ id: 'l1', requestId: 'a', sourcingState: 'UNSOURCED' }),
      line({ id: 'l2', requestId: 'b', sourcingState: 'AWARDED' }),
    ];
    const found = filterRequests(requests, lines, { ...base, sourceableOnly: true }, 'user-ar');
    expect(found.map((r) => r.id)).toEqual(['a']);
  });

  it('filters lines inside an expansion by code, description and line number', () => {
    const lines = [
      line({ id: 'a', lineNumber: 1, itemCode: 'LAP-001', description: 'Laptop' }),
      line({ id: 'b', lineNumber: 2, itemCode: 'MON-002', description: 'Monitor' }),
    ];
    expect(filterLines(lines, 'mon').map((l) => l.id)).toEqual(['b']);
    expect(filterLines(lines, 'LAP').map((l) => l.id)).toEqual(['a']);
    expect(filterLines(lines, '2').map((l) => l.id)).toEqual(['b']);
    expect(filterLines(lines, '')).toHaveLength(2);
  });
});

describe('csv export', () => {
  it('emits one row per line, not per requisition', () => {
    const lines = [line({ id: 'a', lineNumber: 1 }), line({ id: 'b', lineNumber: 2 })];
    const rows = toCsv([request()], lines).split('\n');
    expect(rows).toHaveLength(3);
  });

  it('quotes a field containing a comma rather than splitting the row', () => {
    const csv = toCsv([request()], [line({ description: 'Cable, armoured' })]);
    expect(csv).toContain('"Cable, armoured"');
  });
});

// ---------------------------------------------------------------------------
// The seeded requisitions
// ---------------------------------------------------------------------------

describe('seeded purchase requests', () => {
  it('spans one line to a hundred, so the expansion is exercised across the range', () => {
    const counts = PURCHASE_REQUESTS
      .map((r) => linesFor(PURCHASE_REQUEST_LINES, r.id).length)
      .sort((a, b) => a - b);
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(100);
    // At least five requisitions in the 20–100 band the screen is built for.
    expect(counts.filter((c) => c >= 20 && c <= 100).length).toBeGreaterThanOrEqual(5);
  });

  it('never repeats an item code inside one requisition', () => {
    for (const r of PURCHASE_REQUESTS) {
      const own = linesFor(PURCHASE_REQUEST_LINES, r.id);
      expect(new Set(own.map((l) => l.itemCode)).size, r.requestNumber).toBe(own.length);
    }
  });

  it('numbers lines contiguously from one', () => {
    for (const r of PURCHASE_REQUESTS) {
      const own = linesFor(PURCHASE_REQUEST_LINES, r.id);
      expect(own.map((l) => l.lineNumber), r.requestNumber)
        .toEqual(own.map((_, i) => i + 1));
    }
  });

  it('gives every line a positive quantity and a priced or explicitly unpriced value', () => {
    for (const l of PURCHASE_REQUEST_LINES) {
      expect(l.quantity, l.id).toBeGreaterThan(0);
      if (l.indicativePrice !== null) expect(l.indicativePrice, l.id).toBeGreaterThan(0);
    }
  });

  it('only names an event on a line that has actually been sourced', () => {
    for (const l of PURCHASE_REQUEST_LINES) {
      if (l.eventNumber !== null) {
        expect(['IN_EVENT', 'AWARDED'], l.id).toContain(l.sourcingState);
      }
    }
  });

  it('leaves no orphan lines', () => {
    const ids = new Set(PURCHASE_REQUESTS.map((r) => r.id));
    for (const l of PURCHASE_REQUEST_LINES) expect(ids.has(l.requestId), l.id).toBe(true);
  });

  it('is deterministic — the same import yields the same first line', () => {
    const first = PURCHASE_REQUEST_LINES[0];
    expect(first.requestId).toBe('pr-00130');
    expect(first.lineNumber).toBe(1);
  });

  it('presents every status and sourcing state it actually uses', () => {
    for (const r of PURCHASE_REQUESTS) expect(PR_STATUS_PRESENTATION[r.status]).toBeDefined();
    for (const l of PURCHASE_REQUEST_LINES) {
      expect(SOURCING_STATE_PRESENTATION[l.sourcingState]).toBeDefined();
    }
  });

  it('offers more than one category to filter by', () => {
    expect(categoriesOf(PURCHASE_REQUESTS).length).toBeGreaterThan(1);
  });

  it('has a requisition in every tab', () => {
    for (const tab of ['requested', 'pending', 'history', 'all'] as PrTab[]) {
      const found = PURCHASE_REQUESTS.filter((r) => matchesTab(r, tab, 'user-ar'));
      expect(found.length, tab).toBeGreaterThan(0);
    }
  });
});
