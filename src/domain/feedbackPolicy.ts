/**
 * The visibility manifest.
 *
 * Pack 18 (buyer cockpit) ends with a manifest stating, per feedback policy,
 * exactly what a bidder may see. Pack 19 (supplier console) is built from it.
 * This module *is* that manifest, expressed as code, and it is the only place
 * a bidder-facing auction projection is allowed to be built.
 *
 * Skipping it risks a data leak — a bidder seeing competitor prices the policy
 * forbids. So the projection is built by whitelist: every field a policy does
 * not permit is genuinely absent from the returned object, not blanked out.
 */
import type { FeedbackPolicy, Id, Side } from './types';
import { gapPctBehind, isBetter } from './comparator';

export interface ManifestRow {
  policy: FeedbackPolicy;
  label: string;
  /** May the bidder see their own numeric rank? */
  ownRank: boolean;
  /** May the bidder see the leading price as a number? */
  bestPrice: boolean;
  /** May the bidder see every competitor's price? */
  allBids: boolean;
  /** May the bidder see competitor identities? */
  competitorIdentity: boolean;
  /** May the bidder see a percentage gap to the lead? */
  gapPct: boolean;
  /** May the bidder see a colour band against the buyer's target? */
  trafficLight: boolean;
  /** How many bidders are in the room (a count, never a list). */
  participantCount: boolean;
}

export const VISIBILITY_MANIFEST: Record<FeedbackPolicy, ManifestRow> = {
  FULL_PRICE: {
    policy: 'FULL_PRICE', label: 'Full price',
    ownRank: true, bestPrice: true, allBids: true,
    competitorIdentity: false, gapPct: true, trafficLight: false, participantCount: true,
  },
  BEST_PRICE: {
    policy: 'BEST_PRICE', label: 'Best price',
    ownRank: true, bestPrice: true, allBids: false,
    competitorIdentity: false, gapPct: false, trafficLight: false, participantCount: true,
  },
  RANK_ONLY: {
    policy: 'RANK_ONLY', label: 'Rank only',
    ownRank: true, bestPrice: false, allBids: false,
    competitorIdentity: false, gapPct: false, trafficLight: false, participantCount: true,
  },
  RANK_GAP: {
    policy: 'RANK_GAP', label: 'Rank + gap %',
    ownRank: true, bestPrice: false, allBids: false,
    competitorIdentity: false, gapPct: true, trafficLight: false, participantCount: true,
  },
  TRAFFIC_LIGHT: {
    policy: 'TRAFFIC_LIGHT', label: 'Traffic light',
    ownRank: false, bestPrice: false, allBids: false,
    competitorIdentity: false, gapPct: false, trafficLight: true, participantCount: false,
  },
  BLIND: {
    policy: 'BLIND', label: 'Blind',
    ownRank: false, bestPrice: false, allBids: false,
    competitorIdentity: false, gapPct: false, trafficLight: false, participantCount: false,
  },
};

export type TrafficBand = 'GREEN' | 'AMBER' | 'RED';

/** Colour is never the sole carrier of meaning — icon and label travel with it. */
export const TRAFFIC_BAND_PRESENTATION: Record<TrafficBand, { icon: string; label: string; hex: string; soft: string }> = {
  GREEN: { icon: '●', label: 'At or better than target', hex: '#16A34A', soft: '#DCFCE7' },
  AMBER: { icon: '◐', label: 'Close to target', hex: '#F59E0B', soft: '#FEF3C7' },
  RED: { icon: '▲', label: 'Well away from target', hex: '#DC2626', soft: '#FEE2E2' },
};

export function trafficBand(
  myValue: number,
  targetPrice: number,
  amberBandPct: number,
  side: Side,
): TrafficBand {
  if (isBetter(myValue, targetPrice, side) || myValue === targetPrice) return 'GREEN';
  const away = Math.abs((myValue - targetPrice) / targetPrice) * 100;
  return away <= amberBandPct ? 'AMBER' : 'RED';
}

// ---------------------------------------------------------------------------
// Bidder projection
// ---------------------------------------------------------------------------

export interface RankedEntry {
  bidderId: Id;
  maskedLabel: string;
  displayName: string;
  transformedValue: number;
  rawBidValue: number;
}

export interface ProjectionContext {
  policy: FeedbackPolicy;
  side: Side;
  bidderId: Id;
  ranked: RankedEntry[];
  /** Internal-only. Passed in so the traffic band can be computed here and
   *  the number itself discarded — the target never enters the projection. */
  targetPrice: number | null;
  amberBandPct: number;
  discloseTarget: boolean;
}

/**
 * What a bidder is permitted to receive. Fields absent from the result are
 * absent from the wire — the client is never sent a value it must not render.
 */
export interface BidderProjection {
  policy: FeedbackPolicy;
  policyLabel: string;
  ownRank?: number;
  fieldCount?: number;
  bestPrice?: number;
  gapPctBehind?: number;
  allBids?: { label: string; value: number }[];
  trafficBand?: TrafficBand;
  targetPrice?: number;
  /** Always permitted: a bidder may see their own position and own numbers. */
  isLeading: boolean;
}

export function projectForBidder(ctx: ProjectionContext): BidderProjection {
  const row = VISIBILITY_MANIFEST[ctx.policy];
  const ordered = [...ctx.ranked].sort((a, b) =>
    ctx.side === 'BUY'
      ? a.transformedValue - b.transformedValue
      : b.transformedValue - a.transformedValue,
  );
  const myIndex = ordered.findIndex((e) => e.bidderId === ctx.bidderId);
  const me = myIndex >= 0 ? ordered[myIndex] : undefined;
  const leader = ordered[0];

  const projection: BidderProjection = {
    policy: ctx.policy,
    policyLabel: row.label,
    isLeading: !!me && !!leader && me.bidderId === leader.bidderId,
  };

  if (row.ownRank && myIndex >= 0) projection.ownRank = myIndex + 1;
  if (row.participantCount) projection.fieldCount = ordered.length;

  if (row.bestPrice && leader) projection.bestPrice = leader.transformedValue;

  if (row.gapPct && me && leader) {
    projection.gapPctBehind = Math.max(
      0,
      gapPctBehind(me.transformedValue, leader.transformedValue, ctx.side),
    );
  }

  if (row.allBids) {
    // Even under FULL_PRICE, identity stays masked unless the identity policy
    // says NAMED — that is a separate axis, applied by the caller.
    projection.allBids = ordered.map((e) => ({
      label: row.competitorIdentity ? e.displayName : e.maskedLabel,
      value: e.transformedValue,
    }));
  }

  if (row.trafficLight && me && ctx.targetPrice !== null) {
    projection.trafficBand = trafficBand(
      me.transformedValue, ctx.targetPrice, ctx.amberBandPct, ctx.side,
    );
    // The target number itself travels only when explicitly disclosed.
    if (ctx.discloseTarget) projection.targetPrice = ctx.targetPrice;
  }

  return projection;
}

/** Assertion helper used by tests and by the cockpit's manifest panel. */
export function permittedFields(policy: FeedbackPolicy): (keyof BidderProjection)[] {
  const row = VISIBILITY_MANIFEST[policy];
  const fields: (keyof BidderProjection)[] = ['policy', 'policyLabel', 'isLeading'];
  if (row.ownRank) fields.push('ownRank');
  if (row.participantCount) fields.push('fieldCount');
  if (row.bestPrice) fields.push('bestPrice');
  if (row.gapPct) fields.push('gapPctBehind');
  if (row.allBids) fields.push('allBids');
  if (row.trafficLight) fields.push('trafficBand', 'targetPrice');
  return fields;
}
