/**
 * Consolidating requisition lines into one sourceable demand: the category
 * constraint, the PRD assignment, and the handover into event lines.
 */
import { describe, expect, it } from 'vitest';
import {
  basketValue, buildSourcingRequisition, businessUnitsIn, canSelect, categoriesIn,
  lotNameFor, nextPrdNumber, requestNumbersIn, suggestedTitle, toConsolidatedLines,
  validateBasket,
} from '../sourcingRequisition';
import { linesFor, sourceableLines } from '../purchaseRequests';
import { PURCHASE_REQUESTS, PURCHASE_REQUEST_LINES } from '../../data/purchaseRequests';
import type { PurchaseRequest, PurchaseRequestLine, SourcingRequisition } from '../types';

function request(over: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: 'pr1', tenantId: 't1', requestNumber: 'RQ-0001', title: 'T',
    category: 'IT Hardware', superCategory: 'Technology', status: 'APPROVED',
    submittedOn: '2026-01-01', submittedById: 'u1', submittedByName: 'A',
    submittedByCode: 'C1', businessUnit: 'Corporate Services', costCentre: 'CC-1',
    currency: 'USD', needBy: '2026-06-01', deliveryLocation: 'Pune',
    justification: 'j', ...over,
  };
}

function line(over: Partial<PurchaseRequestLine> = {}): PurchaseRequestLine {
  return {
    id: 'l1', requestId: 'pr1', lineNumber: 1, itemCode: 'LAP-001',
    description: 'Laptop, 14in i7 32GB', specification: 's', quantity: 10, uom: 'each',
    needBy: '2026-06-01', deliveryLocation: 'Pune', indicativePrice: 100,
    currency: 'USD', sourcingState: 'UNSOURCED', eventNumber: null,
    hasVendorQuote: false, isCatalogItem: false, ...over,
  };
}

const REQUESTS = [
  request({ id: 'pr1', requestNumber: 'RQ-0001', category: 'IT Hardware', businessUnit: 'Corporate Services' }),
  request({ id: 'pr2', requestNumber: 'RQ-0002', category: 'IT Hardware', businessUnit: 'Corporate Services' }),
  request({ id: 'pr3', requestNumber: 'RQ-0003', category: 'Facilities & MRO', businessUnit: 'Manufacturing' }),
];

describe('category is the binding constraint', () => {
  it('accepts any unsourced line into an empty basket', () => {
    expect(canSelect(line({ requestId: 'pr3' }), [], REQUESTS).allowed).toBe(true);
  });

  it('accepts a line from a different requisition in the same category', () => {
    const held = [line({ id: 'a', requestId: 'pr1' })];
    const result = canSelect(line({ id: 'b', requestId: 'pr2' }), held, REQUESTS);
    expect(result.allowed).toBe(true);
  });

  it('refuses a line from another category, and says why', () => {
    const held = [line({ id: 'a', requestId: 'pr1' })];
    const result = canSelect(line({ id: 'b', requestId: 'pr3' }), held, REQUESTS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('IT Hardware');
    expect(result.reason).toContain('questionnaire');
  });

  it('refuses a line that is already sourced', () => {
    const result = canSelect(line({ sourcingState: 'IN_EVENT' }), [], REQUESTS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot be sourced twice');
  });

  it('blocks a mixed-category basket at validation too', () => {
    const validation = validateBasket(
      [line({ id: 'a', requestId: 'pr1' }), line({ id: 'b', requestId: 'pr3' })],
      REQUESTS,
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((e) => e.code)).toContain('MIXED_CATEGORY');
  });

  it('blocks an empty basket', () => {
    expect(validateBasket([], REQUESTS).errors.map((e) => e.code)).toContain('EMPTY');
  });

  it('blocks a basket mixing currencies, which cannot be ranked', () => {
    const validation = validateBasket(
      [line({ id: 'a' }), line({ id: 'b', currency: 'EUR' })],
      REQUESTS,
    );
    expect(validation.errors.map((e) => e.code)).toContain('MIXED_CURRENCY');
  });

  it('warns but does not block on mixed business units', () => {
    const requests = [
      request({ id: 'pr1', requestNumber: 'RQ-0001', businessUnit: 'Corporate Services' }),
      request({ id: 'pr2', requestNumber: 'RQ-0002', businessUnit: 'Technology' }),
    ];
    const validation = validateBasket(
      [line({ id: 'a', requestId: 'pr1' }), line({ id: 'b', requestId: 'pr2' })],
      requests,
    );
    expect(validation.valid).toBe(true);
    expect(validation.warnings.map((w) => w.code)).toContain('MIXED_BUSINESS_UNIT');
  });

  it('warns on unpriced lines, which yield no baseline', () => {
    const validation = validateBasket([line({ indicativePrice: null })], REQUESTS);
    expect(validation.warnings.map((w) => w.code)).toContain('UNPRICED_LINES');
  });
});

describe('PRD assignment', () => {
  it('starts at 0001 and increments', () => {
    expect(nextPrdNumber([])).toBe('PRD-2026-0001');
    expect(nextPrdNumber([{ prdNumber: 'PRD-2026-0007' } as SourcingRequisition]))
      .toBe('PRD-2026-0008');
  });

  it('maps one PRD to the many requisitions its lines came from', () => {
    const lines = [
      line({ id: 'a', requestId: 'pr1' }),
      line({ id: 'b', requestId: 'pr2' }),
      line({ id: 'c', requestId: 'pr2' }),
    ];
    const prd = buildSourcingRequisition({
      lines, requests: REQUESTS, existing: [], userId: 'u1', now: 1_000,
    });
    expect(prd.prdNumber).toBe('PRD-2026-0001');
    expect(prd.requestNumbers).toEqual(['RQ-0001', 'RQ-0002']);
    expect(prd.lineIds).toEqual(['a', 'b', 'c']);
    expect(prd.category).toBe('IT Hardware');
    expect(prd.eventId).toBeNull();
  });

  it('refuses to consolidate a basket that does not validate', () => {
    expect(() =>
      buildSourcingRequisition({
        lines: [line({ id: 'a', requestId: 'pr1' }), line({ id: 'b', requestId: 'pr3' })],
        requests: REQUESTS, existing: [], userId: 'u1', now: 0,
      }),
    ).toThrow(/one category/);
  });

  it('orders business units by how much of the demand they carry', () => {
    const requests = [
      request({ id: 'pr1', businessUnit: 'Technology' }),
      request({ id: 'pr2', businessUnit: 'Corporate Services' }),
    ];
    const units = businessUnitsIn(
      [
        line({ id: 'a', requestId: 'pr2' }),
        line({ id: 'b', requestId: 'pr2' }),
        line({ id: 'c', requestId: 'pr1' }),
      ],
      requests,
    );
    expect(units[0]).toBe('Corporate Services');
  });
});

describe('handover into event lines', () => {
  it('lots by item family so like competes with like', () => {
    expect(lotNameFor(line({ description: 'Laptop, 14in i7 32GB' }))).toBe('Laptop');
    expect(lotNameFor(line({ description: 'Cable, XLPE armoured 4-core, 25 sq mm' }))).toBe('Cable');
  });

  it('numbers lots stably regardless of line order', () => {
    const lines = [
      line({ id: 'a', description: 'Monitor, 27in QHD' }),
      line({ id: 'b', description: 'Laptop, 14in i7 32GB' }),
    ];
    const forward = toConsolidatedLines(lines, REQUESTS);
    const reversed = toConsolidatedLines([...lines].reverse(), REQUESTS);
    expect(forward.find((l) => l.id === 'dl-a')?.lotName).toBe('Lot 2 · Monitor');
    expect(reversed.find((l) => l.id === 'dl-a')?.lotName).toBe('Lot 2 · Monitor');
  });

  it('carries the requisition line id and number onto every event line', () => {
    const [first] = toConsolidatedLines([line({ id: 'a', requestId: 'pr2' })], REQUESTS);
    expect(first.sourcePrLineId).toBe('a');
    expect(first.sourceRequestNumber).toBe('RQ-0002');
  });

  it('carries the indicative price across as the baseline', () => {
    const [first] = toConsolidatedLines([line({ indicativePrice: 42 })], REQUESTS);
    expect(first.baselinePrice).toBe(42);
  });

  it('values the basket from its lines', () => {
    expect(basketValue([line({ quantity: 10, indicativePrice: 5 })])).toBe(50);
  });

  it('names a single-requisition event after it, and a consolidated one by span', () => {
    expect(suggestedTitle([line({ requestId: 'pr1' })], REQUESTS)).toBe('IT Hardware — RQ-0001');
    expect(
      suggestedTitle([line({ id: 'a', requestId: 'pr1' }), line({ id: 'b', requestId: 'pr2' })], REQUESTS),
    ).toContain('consolidated across 2 requisitions');
  });
});

describe('against the seeded requisitions', () => {
  it('can consolidate unsourced lines across two same-category requisitions', () => {
    const sameCategory = PURCHASE_REQUESTS.filter((r) => r.category === 'Professional & Consultancy');
    expect(sameCategory.length).toBeGreaterThan(1);

    const lines = sameCategory
      .flatMap((r) => sourceableLines(linesFor(PURCHASE_REQUEST_LINES, r.id)))
      .slice(0, 12);

    const prd = buildSourcingRequisition({
      lines, requests: PURCHASE_REQUESTS, existing: [], userId: 'user-ar', now: 0,
    });
    expect(prd.requestNumbers.length).toBeGreaterThan(1);
    expect(prd.category).toBe('Professional & Consultancy');
  });

  it('refuses a basket spanning two seeded categories', () => {
    const a = sourceableLines(linesFor(PURCHASE_REQUEST_LINES, 'pr-00130'))[0];
    const b = sourceableLines(linesFor(PURCHASE_REQUEST_LINES, 'pr-00127'))[0];
    const validation = validateBasket([a, b], PURCHASE_REQUESTS);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((e) => e.code)).toContain('MIXED_CATEGORY');
  });

  it('turns a 100-line requisition into event lines across several lots', () => {
    const lines = sourceableLines(linesFor(PURCHASE_REQUEST_LINES, 'pr-00108'));
    const consolidated = toConsolidatedLines(lines, PURCHASE_REQUESTS);
    expect(consolidated).toHaveLength(lines.length);
    const lots = new Set(consolidated.map((l) => l.lotName));
    expect(lots.size).toBeGreaterThan(1);
    for (const l of consolidated) expect(l.sourcePrLineId).toBeTruthy();
  });

  it('categoriesIn and requestNumbersIn agree with the seeded data', () => {
    const lines = linesFor(PURCHASE_REQUEST_LINES, 'pr-00124');
    expect(categoriesIn(lines, PURCHASE_REQUESTS)).toEqual(['Facilities & MRO']);
    expect(requestNumbersIn(lines, PURCHASE_REQUESTS)).toEqual(['RQ-TGRANL-00124']);
  });
});
