/**
 * The comparator is the single point that inverts BUY and SELL. If it is
 * wrong, every ranking, every "best" and every clock in the product is wrong,
 * so it is tested from both sides throughout.
 */
import { describe, expect, it } from 'vitest';
import {
  bestOf, bestFirst, deriveDirection, gapPctBehind, improvement,
  improvementPct, isBetter, worstOf,
} from '../comparator';

describe('isBetter', () => {
  it('prefers the lower value on BUY', () => {
    expect(isBetter(141_000, 142_000, 'BUY')).toBe(true);
    expect(isBetter(142_000, 141_000, 'BUY')).toBe(false);
  });

  it('prefers the higher value on SELL', () => {
    expect(isBetter(158_000, 150_000, 'SELL')).toBe(true);
    expect(isBetter(150_000, 158_000, 'SELL')).toBe(false);
  });

  it('treats equal values as not better on either side', () => {
    expect(isBetter(100, 100, 'BUY')).toBe(false);
    expect(isBetter(100, 100, 'SELL')).toBe(false);
  });
});

describe('bestOf / worstOf', () => {
  const values = [148_350, 147_200, 148_900, 151_000];

  it('picks the lowest on BUY and the highest on SELL', () => {
    expect(bestOf(values, 'BUY')).toBe(147_200);
    expect(bestOf(values, 'SELL')).toBe(151_000);
    expect(worstOf(values, 'BUY')).toBe(151_000);
    expect(worstOf(values, 'SELL')).toBe(147_200);
  });

  it('returns null for an empty field rather than a sentinel number', () => {
    expect(bestOf([], 'BUY')).toBeNull();
    expect(worstOf([], 'SELL')).toBeNull();
  });
});

describe('bestFirst', () => {
  it('sorts ascending on BUY and descending on SELL', () => {
    const values = [3, 1, 2];
    expect([...values].sort(bestFirst('BUY'))).toEqual([1, 2, 3]);
    expect([...values].sort(bestFirst('SELL'))).toEqual([3, 2, 1]);
  });
});

describe('deriveDirection', () => {
  it('descends when bidders compete on a BUY event', () => {
    expect(deriveDirection('BUY', 'BIDDER')).toBe('DESCENDING');
  });

  it('ascends when bidders compete on a SELL event', () => {
    expect(deriveDirection('SELL', 'BIDDER')).toBe('ASCENDING');
  });

  /**
   * "Dutch reverse" is not a mechanism: it is mechanism=DUTCH with side=BUY,
   * and a system clock on a BUY event *rises* until someone accepts.
   */
  it('rises on a BUY Dutch clock and falls on a SELL Dutch clock', () => {
    expect(deriveDirection('BUY', 'SYSTEM')).toBe('ASCENDING');
    expect(deriveDirection('SELL', 'SYSTEM')).toBe('DESCENDING');
  });
});

describe('improvement', () => {
  it('is positive whenever the new value is better, on either side', () => {
    expect(improvement(142_500, 141_000, 'BUY')).toBe(1_500);
    expect(improvement(150_000, 158_000, 'SELL')).toBe(8_000);
  });

  it('is negative when the new value is worse', () => {
    expect(improvement(141_000, 142_500, 'BUY')).toBe(-1_500);
    expect(improvement(158_000, 150_000, 'SELL')).toBe(-8_000);
  });

  it('expresses the same move as a percentage of the reference', () => {
    expect(improvementPct(100_000, 99_000, 'BUY')).toBeCloseTo(1);
    expect(improvementPct(100_000, 101_000, 'SELL')).toBeCloseTo(1);
  });

  it('does not divide by zero', () => {
    expect(improvementPct(0, 500, 'BUY')).toBe(0);
  });
});

describe('gapPctBehind', () => {
  it('reports a positive gap for a bidder behind the lead on BUY', () => {
    expect(gapPctBehind(148_350, 147_200, 'BUY')).toBeCloseTo(0.781, 2);
  });

  it('reports a positive gap for a bidder behind the lead on SELL', () => {
    // On SELL the leader is higher, so being lower is being behind.
    expect(gapPctBehind(150_000, 158_000, 'SELL')).toBeCloseTo(5.063, 2);
  });

  it('is zero for the leader', () => {
    expect(gapPctBehind(147_200, 147_200, 'BUY')).toBe(0);
    expect(gapPctBehind(158_000, 158_000, 'SELL')).toBe(0);
  });
});
