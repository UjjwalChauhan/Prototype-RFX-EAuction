/**
 * Bid transformation. Two properties matter beyond the arithmetic:
 * the trail must be complete, and the round trip must hold — because the
 * "bid to beat" shown to each supplier is produced by inverting the transform.
 */
import { describe, expect, it } from 'vitest';
import {
  bidToBeat, transformBid, transformationCoverage, untransform,
} from '../transformation';
import type { CostComponent } from '../types';

const COMPONENTS: CostComponent[] = [
  {
    id: 'cc-freight', eventId: 'evt-1', name: 'Inbound freight', basis: 'LUMP_SUM',
    valueByBidder: { b1: 4_200, b2: 1_100 }, source: 'Freight lane table', agentProposed: true,
  },
  {
    id: 'cc-duty', eventId: 'evt-1', name: 'Import duty', basis: 'PERCENTAGE',
    valueByBidder: { b1: 1.5, b2: 0 }, source: 'Duty schedule', agentProposed: true,
  },
  {
    id: 'cc-npv', eventId: 'evt-1', name: 'Payment-term NPV', basis: 'PERCENTAGE',
    valueByBidder: { b1: 0.4, b2: -2.1 }, source: 'Cost of capital', agentProposed: true,
  },
];

const B1 = { bidderId: 'b1', bidValue: 142_000, quantity: 1, lineCount: 1 };
const B2 = { bidderId: 'b2', bidValue: 145_000, quantity: 1, lineCount: 1 };

describe('transformBid', () => {
  it('returns the raw bid untouched when transformation is off', () => {
    const result = transformBid(B1, COMPONENTS, 'NONE');
    expect(result.transformedValue).toBe(142_000);
    expect(result.totalAdjustment).toBe(0);
    expect(result.trace).toHaveLength(0);
  });

  it('adds a lump sum once and a percentage against the bid', () => {
    const result = transformBid(B1, COMPONENTS, 'SUPPLIER_SPECIFIC');
    // 142,000 + 4,200 + 1.5% + 0.4% = 142,000 + 4,200 + 2,130 + 568
    expect(result.transformedValue).toBeCloseTo(148_898, 0);
    expect(result.totalAdjustment).toBeCloseTo(6_898, 0);
  });

  it('applies a negative percentage as an improvement to the buyer', () => {
    const result = transformBid(B2, COMPONENTS, 'SUPPLIER_SPECIFIC');
    // 145,000 + 1,100 + 0% − 2.1% = 145,000 + 1,100 − 3,045
    expect(result.transformedValue).toBeCloseTo(143_055, 0);
    expect(result.totalAdjustment).toBeLessThan(0);
  });

  it('can reverse the ranking a raw comparison would give', () => {
    // b1 bids less than b2, yet lands worse once transformed.
    const first = transformBid(B1, COMPONENTS, 'SUPPLIER_SPECIFIC');
    const second = transformBid(B2, COMPONENTS, 'SUPPLIER_SPECIFIC');
    expect(B1.bidValue).toBeLessThan(B2.bidValue);
    expect(first.transformedValue).toBeGreaterThan(second.transformedValue);
  });

  it('traces every component that moved the number', () => {
    const result = transformBid(B1, COMPONENTS, 'SUPPLIER_SPECIFIC');
    expect(result.trace.map((t) => t.componentName)).toEqual([
      'Inbound freight', 'Import duty', 'Payment-term NPV',
    ]);
    for (const entry of result.trace) {
      expect(entry.source).toBeTruthy();
      expect(entry.basis).toBeTruthy();
    }
    // The traced deltas account for the whole adjustment: nothing is hidden.
    const traced = result.trace.reduce((a, t) => a + t.delta, 0);
    expect(traced).toBeCloseTo(result.totalAdjustment, 6);
  });

  it('scales a per-unit component by quantity and a per-line component by line count', () => {
    const perUnit: CostComponent[] = [{
      id: 'cc-u', eventId: 'evt-1', name: 'Handling', basis: 'PER_UNIT',
      valueByBidder: { b1: 2 }, source: 'test', agentProposed: false,
    }];
    const perLine: CostComponent[] = [{
      id: 'cc-l', eventId: 'evt-1', name: 'Admin', basis: 'PER_LINE',
      valueByBidder: { b1: 50 }, source: 'test', agentProposed: false,
    }];
    expect(transformBid({ ...B1, quantity: 500 }, perUnit, 'SUPPLIER_SPECIFIC').totalAdjustment).toBe(1_000);
    expect(transformBid({ ...B1, lineCount: 6 }, perLine, 'SUPPLIER_SPECIFIC').totalAdjustment).toBe(300);
  });

  it('treats a bidder with no configured value as zero rather than failing', () => {
    const result = transformBid(
      { bidderId: 'unknown', bidValue: 100_000, quantity: 1, lineCount: 1 },
      COMPONENTS, 'SUPPLIER_SPECIFIC',
    );
    expect(result.transformedValue).toBe(100_000);
    expect(result.trace).toHaveLength(0);
  });
});

describe('untransform', () => {
  it('inverts the transform exactly, including percentage components', () => {
    const forward = transformBid(B1, COMPONENTS, 'SUPPLIER_SPECIFIC');
    const back = untransform(forward.transformedValue, B1, COMPONENTS, 'SUPPLIER_SPECIFIC');
    expect(back).toBeCloseTo(B1.bidValue, 4);
  });

  it('inverts for a bidder whose adjustments are negative', () => {
    const forward = transformBid(B2, COMPONENTS, 'SUPPLIER_SPECIFIC');
    const back = untransform(forward.transformedValue, B2, COMPONENTS, 'SUPPLIER_SPECIFIC');
    expect(back).toBeCloseTo(B2.bidValue, 4);
  });

  it('is the identity when transformation is off', () => {
    expect(untransform(150_000, B1, COMPONENTS, 'NONE')).toBe(150_000);
  });
});

describe('bidToBeat', () => {
  it('gives two bidders different raw targets for the same landed value', () => {
    // This is the whole point of transforming the target back: the same buyer
    // objective is a different number in each supplier's own terms.
    const target = 145_000;
    const forB1 = bidToBeat(target, B1, COMPONENTS, 'SUPPLIER_SPECIFIC', 'BUY');
    const forB2 = bidToBeat(target, B2, COMPONENTS, 'SUPPLIER_SPECIFIC', 'BUY');
    expect(forB1.rawBidToBeat).not.toBeCloseTo(forB2.rawBidToBeat, 2);
    // b1 carries more cost, so it must bid lower to reach the same landed value.
    expect(forB1.rawBidToBeat).toBeLessThan(forB2.rawBidToBeat);
  });

  it('reports the improvement each bidder must make from where they stand', () => {
    const result = bidToBeat(145_000, B1, COMPONENTS, 'SUPPLIER_SPECIFIC', 'BUY');
    expect(result.requiredImprovement).toBeCloseTo(B1.bidValue - result.rawBidToBeat, 6);
  });

  it('inverts the required improvement on SELL', () => {
    const result = bidToBeat(150_000, B1, COMPONENTS, 'SUPPLIER_SPECIFIC', 'SELL');
    expect(result.requiredImprovement).toBeCloseTo(result.rawBidToBeat - B1.bidValue, 6);
  });
});

describe('transformationCoverage', () => {
  it('reports which bidders are missing which component', () => {
    const coverage = transformationCoverage(COMPONENTS, ['b1', 'b2', 'b3']);
    expect(coverage.total).toBe(3);
    expect(coverage.covered).toBe(2);
    expect(coverage.missing).toHaveLength(3);
    for (const gap of coverage.missing) {
      expect(gap.bidderIds).toEqual(['b3']);
    }
  });

  it('reports full coverage when every bidder has every component', () => {
    const coverage = transformationCoverage(COMPONENTS, ['b1', 'b2']);
    expect(coverage.covered).toBe(2);
    expect(coverage.missing).toHaveLength(0);
  });
});
