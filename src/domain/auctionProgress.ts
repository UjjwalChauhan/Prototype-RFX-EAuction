/**
 * The auction as it happened, over time.
 *
 * A ranking table answers "where do we stand"; it cannot answer "is this
 * working". Those are different questions and a live auction is run on the
 * second one. A controller watching a flat line for eleven minutes knows
 * something a leaderboard will not tell them, and a supplier who can see the
 * lead moving away from them in steps knows to act now rather than at the end.
 *
 * Both sides read this one series. What differs is how much of it survives the
 * projection — and that is decided by the same `VISIBILITY_MANIFEST` the bid
 * payload is built from, so the chart cannot show a supplier something the
 * payload was careful to withhold. A leak in a chart is still a leak.
 *
 * Everything here is derived from the append-only ledger and the control log.
 * Nothing is accumulated as the auction runs, so replaying the log reproduces
 * the chart exactly, and a client that reconnects mid-auction is not missing
 * the beginning.
 */
import { improvementPct, isBetter } from './comparator';
import { VISIBILITY_MANIFEST, trafficBand, type TrafficBand } from './feedbackPolicy';
import type {
  Auction, AuctionControlEvent, AuctionEventKind, Bid, Id, ServerMillis, Side,
} from './types';

export interface ProgressPoint {
  at: ServerMillis;
  bidderId: Id;
  /** What this bid was worth in buyer terms. */
  value: number;
  /** The best value standing *after* this bid. */
  leadValue: number;
  /** Whether this bid took the lead. */
  tookLead: boolean;
  /** Distinct bidders who had bid by this point. */
  fieldSize: number;
  /** How far the lead has moved from the opening price, as a percentage. */
  leadImprovementPct: number;
  sequenceNumber: number;
}

/** A moment in the auction that was not a bid. */
export interface ProgressMarker {
  at: ServerMillis;
  kind: AuctionEventKind;
  label: string;
  /** Whether a bidder may be told about it. */
  publicToBidders: boolean;
}

export interface ProgressSeries {
  startingPrice: number;
  points: ProgressPoint[];
  markers: ProgressMarker[];
  /** Best value standing at the end of the series. */
  leadValue: number;
  /** Movement from the opening price, as a percentage. Always positive-good. */
  improvementPct: number;
  /** Distinct bidders who have placed a valid bid. */
  fieldSize: number;
  /** Bids per minute over the last five minutes — the pulse of the room. */
  recentRate: number;
  firstBidAt: ServerMillis | null;
  lastBidAt: ServerMillis | null;
}

const FIVE_MINUTES = 5 * 60_000;

/**
 * The whole series for one lot, as the controller sees it.
 *
 * Invalid bids are excluded from the line but not from the pulse: an attempt
 * refused for being inside the front buffer is a bidder trying, and a room
 * where that is happening is not a quiet room. They are counted in
 * `recentRate` and nowhere else.
 */
export function progressFor(
  auction: Auction,
  auctionLotId: Id,
  bids: Bid[],
  controlEvents: AuctionControlEvent[],
  startingPrice: number,
  now: ServerMillis,
): ProgressSeries {
  const forLot = bids
    .filter((bid) => bid.auctionLotId === auctionLotId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const valid = forLot.filter((bid) => bid.isValid);

  const seen = new Set<Id>();
  let lead: number | null = null;
  const points: ProgressPoint[] = valid.map((bid) => {
    seen.add(bid.bidderId);
    const tookLead = lead === null || isBetter(bid.transformedValue, lead, auction.side);
    if (tookLead) lead = bid.transformedValue;
    return {
      at: bid.submittedAt,
      bidderId: bid.bidderId,
      value: bid.transformedValue,
      leadValue: lead as number,
      tookLead,
      fieldSize: seen.size,
      leadImprovementPct: improvementPct(startingPrice, lead as number, auction.side),
      sequenceNumber: bid.sequenceNumber,
    };
  });

  const recent = forLot.filter((bid) => now - bid.submittedAt <= FIVE_MINUTES);
  const elapsedMin = Math.min(FIVE_MINUTES, Math.max(1, now - (forLot[0]?.submittedAt ?? now))) / 60_000;

  return {
    startingPrice,
    points,
    markers: markersFrom(controlEvents),
    leadValue: lead ?? startingPrice,
    improvementPct: lead === null ? 0 : improvementPct(startingPrice, lead, auction.side),
    fieldSize: seen.size,
    recentRate: recent.length === 0 ? 0 : Number((recent.length / elapsedMin).toFixed(1)),
    firstBidAt: valid[0]?.submittedAt ?? null,
    lastBidAt: valid.length === 0 ? null : valid[valid.length - 1].submittedAt,
  };
}

/**
 * Which control events a bidder may be told about.
 *
 * A pause, an extension and a broadcast are things a bidder is living through
 * and must know. A turn being skipped names the bidder it was skipped for, so
 * it stays on the controller's side of the line.
 */
const MARKER_LABEL: Partial<Record<AuctionEventKind, { label: string; publicToBidders: boolean }>> = {
  OPENED: { label: 'Bidding opened', publicToBidders: true },
  PAUSED: { label: 'Paused by the buyer', publicToBidders: true },
  RESUMED: { label: 'Resumed', publicToBidders: true },
  EXTENDED: { label: 'Time extended', publicToBidders: true },
  MESSAGE_BROADCAST: { label: 'Message to bidders', publicToBidders: true },
  ROUND_ADVANCED: { label: 'Round advanced', publicToBidders: true },
  CLOCK_HELD: { label: 'Clock held', publicToBidders: true },
  CLOCK_RESUMED: { label: 'Clock resumed', publicToBidders: true },
  ENVELOPES_OPENED: { label: 'Envelopes opened', publicToBidders: true },
  FEEDBACK_CHANGED: { label: 'What bidders can see was changed', publicToBidders: true },
  FORCE_CLOSED: { label: 'Closed by the buyer', publicToBidders: true },
  LOT_OPENED: { label: 'Lot opened', publicToBidders: true },
  LOT_CLOSED: { label: 'Lot closed', publicToBidders: true },
  ABORTED: { label: 'Aborted', publicToBidders: true },
  // Named actions. A bidder learning that a turn was skipped learns whose.
  TURN_CALLED: { label: 'Turn called', publicToBidders: false },
  TURN_SKIPPED: { label: 'Turn skipped', publicToBidders: false },
  REHEARSAL_OPENED: { label: 'Practice run opened', publicToBidders: true },
  REHEARSAL_CLOSED: { label: 'Practice run closed', publicToBidders: true },
};

function markersFrom(controlEvents: AuctionControlEvent[]): ProgressMarker[] {
  return [...controlEvents]
    .sort((a, b) => a.at - b.at)
    .flatMap((event) => {
      const known = MARKER_LABEL[event.kind];
      if (!known) return [];
      return [{
        at: event.at,
        kind: event.kind,
        label: known.label,
        publicToBidders: known.publicToBidders,
      }];
    });
}

// ---------------------------------------------------------------------------
// The supplier's copy
// ---------------------------------------------------------------------------

export interface BidderProgressPoint {
  at: ServerMillis;
  value: number;
  /** Whether this point is the supplier's own bid. */
  mine: boolean;
  tookLead: boolean;
}

export interface BidderProgress {
  policyLabel: string;
  /** Always present: a supplier may always see their own history. */
  mine: BidderProgressPoint[];
  /**
   * The leading line, when the policy permits a competitor's number.
   * Null under RANK_ONLY, RANK_GAP, TRAFFIC_LIGHT and BLIND.
   */
  lead: BidderProgressPoint[] | null;
  /** Every bid, anonymised, when the policy permits the whole book. */
  allBids: BidderProgressPoint[] | null;
  /** The supplier's rank over time, when the policy permits rank. */
  rankOverTime: { at: ServerMillis; rank: number }[] | null;
  /** Their colour over time, when the policy is traffic light. */
  bandOverTime: { at: ServerMillis; band: TrafficBand }[] | null;
  fieldSize: number | null;
  markers: ProgressMarker[];
  startingPrice: number;
}

/**
 * The same series, cut down to what this bidder's policy permits.
 *
 * Built by whitelist, like the bid payload: a line the policy does not grant
 * is `null`, not an empty array a client could mistake for "nothing happened",
 * and never a full array the UI is trusted to hide. The traffic-light case
 * carries colours and no numbers at all, which is the whole point of it.
 */
export function progressForBidder(
  auction: Auction,
  bidderId: Id,
  auctionLotId: Id,
  bids: Bid[],
  controlEvents: AuctionControlEvent[],
  startingPrice: number,
  /** The buyer's target for this lot. Never disclosed — only banded against. */
  targetPrice: number | null,
  now: ServerMillis,
): BidderProgress {
  const row = VISIBILITY_MANIFEST[auction.feedbackPolicy];
  const series = progressFor(auction, auctionLotId, bids, controlEvents, startingPrice, now);
  const side: Side = auction.side;

  const mine: BidderProgressPoint[] = series.points
    .filter((point) => point.bidderId === bidderId)
    .map((point) => ({ at: point.at, value: point.value, mine: true, tookLead: point.tookLead }));

  return {
    policyLabel: row.label,
    mine,
    lead: row.bestPrice
      ? series.points.map((point) => ({
        at: point.at, value: point.leadValue, mine: false, tookLead: point.tookLead,
      }))
      : null,
    allBids: row.allBids
      ? series.points.map((point) => ({
        at: point.at,
        value: point.value,
        mine: point.bidderId === bidderId,
        tookLead: point.tookLead,
      }))
      : null,
    rankOverTime: row.ownRank ? rankTrail(series, bidderId, side) : null,
    bandOverTime: row.trafficLight && targetPrice !== null
      ? mine.map((point) => ({
        at: point.at,
        band: trafficBand(point.value, targetPrice, auction.trafficAmberBandPct, side),
      }))
      : null,
    fieldSize: row.participantCount ? series.fieldSize : null,
    markers: series.markers.filter((marker) => marker.publicToBidders),
    startingPrice,
  };
}

/**
 * Where this bidder stood after each bid in the auction.
 *
 * Recomputed from the standing book at each point rather than read off
 * `rankAtSubmission`, because that field records the rank the bid had when it
 * landed — it does not move when somebody else overtakes it afterwards, and a
 * rank trail built from it would show a supplier holding first place long
 * after they had lost it.
 */
function rankTrail(
  series: ProgressSeries, bidderId: Id, side: Side,
): { at: ServerMillis; rank: number }[] {
  const best = new Map<Id, number>();
  const trail: { at: ServerMillis; rank: number }[] = [];

  for (const point of series.points) {
    const held = best.get(point.bidderId);
    if (held === undefined || isBetter(point.value, held, side)) {
      best.set(point.bidderId, point.value);
    }
    const mine = best.get(bidderId);
    if (mine === undefined) continue;
    const ahead = [...best.entries()]
      .filter(([id, value]) => id !== bidderId && isBetter(value, mine, side)).length;
    trail.push({ at: point.at, rank: ahead + 1 });
  }
  return trail;
}

// ---------------------------------------------------------------------------
// The activity feed
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  at: ServerMillis;
  /** Already projected — safe to render verbatim on the audience's screen. */
  text: string;
  tone: 'bid' | 'lead' | 'control' | 'mine' | 'rejected';
}

/**
 * The room, narrated.
 *
 * The controller's version names companies; the supplier's version names
 * nobody and says only what their policy grants. Both are generated here from
 * the same ledger rather than written twice, because two narrators drift and
 * the one that drifts is always the one with the boundary in it.
 */
export function activityFeed({
  auction, bids, controlEvents, auctionLotId, nameOf, audience, bidderId, limit = 40,
}: {
  auction: Auction;
  bids: Bid[];
  controlEvents: AuctionControlEvent[];
  auctionLotId: Id;
  /** Resolves a bidder id to a display name. Only used for the controller. */
  nameOf: (bidderId: Id) => string;
  audience: 'CONTROLLER' | 'BIDDER';
  /** Required when the audience is a bidder — their own row reads differently. */
  bidderId?: Id;
  limit?: number;
}): ActivityEntry[] {
  const row = VISIBILITY_MANIFEST[auction.feedbackPolicy];
  const controller = audience === 'CONTROLLER';
  const entries: ActivityEntry[] = [];

  const forLot = bids
    .filter((bid) => bid.auctionLotId === auctionLotId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  let lead: number | null = null;
  for (const bid of forLot) {
    const mine = bid.bidderId === bidderId;
    const tookLead = bid.isValid
      && (lead === null || isBetter(bid.transformedValue, lead, auction.side));
    if (tookLead) lead = bid.transformedValue;

    if (!bid.isValid) {
      // A rejection is the bidder's own business. The controller sees all of
      // them because a room full of refused bids is a misconfigured room.
      if (controller) {
        entries.push({
          at: bid.submittedAt, tone: 'rejected',
          text: `${nameOf(bid.bidderId)} — bid refused: ${bid.rejectionReason ?? 'not accepted'}`,
        });
      } else if (mine) {
        entries.push({
          at: bid.submittedAt, tone: 'rejected',
          text: `Your bid was not accepted — ${bid.rejectionReason ?? 'not accepted'}`,
        });
      }
      continue;
    }

    if (controller) {
      entries.push({
        at: bid.submittedAt,
        tone: tookLead ? 'lead' : 'bid',
        text: tookLead
          ? `${nameOf(bid.bidderId)} took the lead`
          : `${nameOf(bid.bidderId)} bid, without taking the lead`,
      });
      continue;
    }

    if (mine) {
      entries.push({
        at: bid.submittedAt,
        tone: 'mine',
        text: tookLead ? 'Your bid took the lead' : 'Your bid was accepted',
      });
      continue;
    }

    // Somebody else moved. What a bidder may be told about it depends
    // entirely on the policy — under BLIND, nothing at all.
    if (row.competitorIdentity) {
      entries.push({
        at: bid.submittedAt, tone: tookLead ? 'lead' : 'bid',
        text: `${nameOf(bid.bidderId)} ${tookLead ? 'took the lead' : 'bid'}`,
      });
    } else if (row.ownRank || row.bestPrice || row.allBids) {
      entries.push({
        at: bid.submittedAt, tone: tookLead ? 'lead' : 'bid',
        text: tookLead ? 'Another bidder took the lead' : 'Another bidder moved',
      });
    }
  }

  for (const marker of markersFrom(controlEvents)) {
    if (!controller && !marker.publicToBidders) continue;
    entries.push({ at: marker.at, tone: 'control', text: marker.label });
  }

  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}
