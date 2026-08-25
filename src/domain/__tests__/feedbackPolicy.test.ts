/**
 * The visibility manifest is the security boundary between the buyer cockpit
 * and the supplier console. These tests assert the *absence* of fields, not
 * their emptiness: a policy that forbids a competitor price must produce a
 * payload with no such key, because a key that exists can be rendered.
 */
import { describe, expect, it } from 'vitest';
import {
  VISIBILITY_MANIFEST, permittedFields, projectForBidder, trafficBand,
  type ProjectionContext,
} from '../feedbackPolicy';
import type { FeedbackPolicy } from '../types';

const RANKED = [
  { bidderId: 'b1', maskedLabel: 'Bidder A', displayName: 'ABC Supplies Co.', transformedValue: 148_350, rawBidValue: 141_000 },
  { bidderId: 'b2', maskedLabel: 'Bidder B', displayName: 'Global Office', transformedValue: 147_200, rawBidValue: 141_500 },
  { bidderId: 'b3', maskedLabel: 'Bidder C', displayName: 'Prime Stationery', transformedValue: 148_900, rawBidValue: 145_000 },
];

function context(policy: FeedbackPolicy, overrides: Partial<ProjectionContext> = {}): ProjectionContext {
  return {
    policy,
    side: 'BUY',
    bidderId: 'b1',
    ranked: RANKED,
    targetPrice: 138_000,
    amberBandPct: 5,
    discloseTarget: false,
    ...overrides,
  };
}

const ALL_POLICIES: FeedbackPolicy[] = [
  'FULL_PRICE', 'BEST_PRICE', 'RANK_ONLY', 'RANK_GAP', 'TRAFFIC_LIGHT', 'BLIND',
];

describe('projectForBidder', () => {
  it('never emits a key the manifest forbids, under any policy', () => {
    for (const policy of ALL_POLICIES) {
      const projection = projectForBidder(context(policy));
      const allowed = new Set<string>(permittedFields(policy) as string[]);
      for (const key of Object.keys(projection)) {
        expect(allowed.has(key), `${policy} leaked "${key}"`).toBe(true);
      }
    }
  });

  it('sends every bidder a price under FULL_PRICE', () => {
    const projection = projectForBidder(context('FULL_PRICE'));
    expect(projection.allBids).toHaveLength(3);
    expect(projection.bestPrice).toBe(147_200);
  });

  it('masks competitor identity even under FULL_PRICE', () => {
    // Identity is a separate axis from price disclosure.
    const projection = projectForBidder(context('FULL_PRICE'));
    expect(projection.allBids?.map((b) => b.label)).toEqual(['Bidder B', 'Bidder A', 'Bidder C']);
    for (const entry of projection.allBids ?? []) {
      expect(entry.label).not.toContain('ABC');
      expect(entry.label).not.toContain('Global');
    }
  });

  it('sends the leading price but no field map under BEST_PRICE', () => {
    const projection = projectForBidder(context('BEST_PRICE'));
    expect(projection.bestPrice).toBe(147_200);
    expect(projection).not.toHaveProperty('allBids');
    expect(projection).not.toHaveProperty('gapPctBehind');
  });

  it('sends a rank and nothing numeric under RANK_ONLY', () => {
    const projection = projectForBidder(context('RANK_ONLY'));
    expect(projection.ownRank).toBe(2);
    expect(projection).not.toHaveProperty('bestPrice');
    expect(projection).not.toHaveProperty('allBids');
    expect(projection).not.toHaveProperty('gapPctBehind');
  });

  it('sends a gap percentage but no price under RANK_GAP', () => {
    const projection = projectForBidder(context('RANK_GAP'));
    expect(projection.ownRank).toBe(2);
    expect(projection.gapPctBehind).toBeCloseTo(0.781, 2);
    expect(projection).not.toHaveProperty('bestPrice');
    expect(projection).not.toHaveProperty('allBids');
  });

  it('sends a colour band but never the rank or a price under TRAFFIC_LIGHT', () => {
    const projection = projectForBidder(context('TRAFFIC_LIGHT'));
    expect(projection.trafficBand).toBe('RED');
    expect(projection).not.toHaveProperty('ownRank');
    expect(projection).not.toHaveProperty('bestPrice');
  });

  it('withholds the target number unless it is explicitly disclosed', () => {
    const withheld = projectForBidder(context('TRAFFIC_LIGHT'));
    expect(withheld).not.toHaveProperty('targetPrice');

    const disclosed = projectForBidder(context('TRAFFIC_LIGHT', { discloseTarget: true }));
    expect(disclosed.targetPrice).toBe(138_000);
  });

  it('sends nothing competitive at all under BLIND', () => {
    const projection = projectForBidder(context('BLIND'));
    expect(Object.keys(projection).sort()).toEqual(['isLeading', 'policy', 'policyLabel']);
  });

  it('always tells a bidder whether they are leading', () => {
    for (const policy of ALL_POLICIES) {
      const leader = projectForBidder(context(policy, { bidderId: 'b2' }));
      expect(leader.isLeading).toBe(true);
      const behind = projectForBidder(context(policy, { bidderId: 'b1' }));
      expect(behind.isLeading).toBe(false);
    }
  });

  it('ranks by the transformed value, not the raw bid', () => {
    // b1 bid 141,000 — the lowest raw bid — but transforms to 148,350, which
    // is second. Rank must follow the transformed value.
    const projection = projectForBidder(context('RANK_ONLY'));
    expect(projection.ownRank).toBe(2);
  });

  it('inverts the ordering on a SELL event', () => {
    const projection = projectForBidder(context('RANK_ONLY', { side: 'SELL' }));
    // On SELL the highest transformed value leads, so b3 (148,900) is rank 1
    // and b1 (148,350) is rank 2.
    expect(projection.ownRank).toBe(2);
    const seller = projectForBidder(context('RANK_ONLY', { side: 'SELL', bidderId: 'b3' }));
    expect(seller.ownRank).toBe(1);
    expect(seller.isLeading).toBe(true);
  });

  it('handles a bidder who has not bid without throwing', () => {
    const projection = projectForBidder(context('RANK_GAP', { bidderId: 'unknown' }));
    expect(projection).not.toHaveProperty('ownRank');
    expect(projection.isLeading).toBe(false);
  });
});

describe('trafficBand', () => {
  it('is green at or better than target', () => {
    expect(trafficBand(138_000, 138_000, 5, 'BUY')).toBe('GREEN');
    expect(trafficBand(137_000, 138_000, 5, 'BUY')).toBe('GREEN');
  });

  it('is amber inside the band and red beyond it', () => {
    expect(trafficBand(142_000, 138_000, 5, 'BUY')).toBe('AMBER');
    expect(trafficBand(150_000, 138_000, 5, 'BUY')).toBe('RED');
  });

  it('inverts on SELL', () => {
    expect(trafficBand(160_000, 158_000, 5, 'SELL')).toBe('GREEN');
    expect(trafficBand(154_000, 158_000, 5, 'SELL')).toBe('AMBER');
    expect(trafficBand(120_000, 158_000, 5, 'SELL')).toBe('RED');
  });
});

describe('VISIBILITY_MANIFEST', () => {
  it('never permits competitor identity on any policy', () => {
    // Identity disclosure is controlled by identity_policy, not by feedback.
    for (const row of Object.values(VISIBILITY_MANIFEST)) {
      expect(row.competitorIdentity).toBe(false);
    }
  });

  it('permits all-bids disclosure on exactly one policy', () => {
    const withAllBids = Object.values(VISIBILITY_MANIFEST).filter((row) => row.allBids);
    expect(withAllBids.map((row) => row.policy)).toEqual(['FULL_PRICE']);
  });
});
