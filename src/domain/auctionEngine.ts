/**
 * The auction engine.
 *
 * Ten mechanisms run on one engine because behaviour is composed from
 * orthogonal attributes rather than branching on a mechanism name. Everything
 * here is written as if it were the server: it owns the clock, the sequence
 * number, and the decision to accept or reject a bid.
 */
import type {
  Auction, AuctionLot, AntiGamingConfig, Bid, BidSource, CostComponent, Id,
  ProxyBidInstruction, ServerMillis, Side, TieBidPolicy,
} from './types';
import { bestFirst, improvement, improvementPct, isBetter } from './comparator';
import { transformBid } from './transformation';

// ---------------------------------------------------------------------------
// Defaults — the practitioner configuration from the concept notes
// ---------------------------------------------------------------------------

export const DEFAULT_ANTI_GAMING: AntiGamingConfig = {
  softCloseTriggerSec: 120,
  softCloseExtensionSec: 120,
  maxExtensions: null,
  minDecrementType: 'PCT',
  minDecrement: 1,
  maxDecrementPct: 25,
  frontBufferPct: 0,
  tieBidPolicy: 'FIRST_IN_WINS',
  minBiddersToStart: 3,
  belowMinPolicy: 'WARN_AND_JUSTIFY',
  confirmThresholdPct: 10,
  snipingThresholdSec: 10,
  identicalBidWindowSec: 5,
  requireDryRunFirstEvent: true,
  bidWithdrawalAllowed: false,
  rebidOnOwnLeadingBidAllowed: false,
};

/** Duration defaults in minutes. All overridable. */
export const MECHANISM_DURATION_DEFAULTS: Record<string, [number, number]> = {
  ENGLISH: [30, 60],
  JAPANESE: [45, 90],
  DUTCH: [5, 15],
  PORTFOLIO: [60, 240],
  SEALED_BID: [1440, 10080],
  RANK_COMPRESSION: [30, 90],
  MULTI_ATTRIBUTE: [45, 90],
  INDEX_LINKED: [30, 60],
  TRAFFIC_LIGHT: [30, 60],
  VICKREY: [1440, 10080],
};

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankRow {
  rank: number;
  bidderId: Id;
  bidValue: number;
  /** Ranking always reads this, never bidValue. */
  transformedValue: number;
  bidCount: number;
  lastBidAt: ServerMillis | null;
  sequenceNumber: number;
  movement: number;
}

/**
 * Standing of every bidder on a lot, from the immutable ledger.
 *
 * Only valid bids count. Ties break on sequenceNumber, which is authoritative
 * on a millisecond collision.
 */
export function rankLot(
  bids: Bid[],
  auctionLotId: Id,
  side: Side,
  tiePolicy: TieBidPolicy = 'FIRST_IN_WINS',
): RankRow[] {
  const valid = bids.filter((b) => b.auctionLotId === auctionLotId && b.isValid);
  const byBidder = new Map<Id, Bid[]>();
  for (const bid of valid) {
    const list = byBidder.get(bid.bidderId) ?? [];
    list.push(bid);
    byBidder.set(bid.bidderId, list);
  }

  const rows: Omit<RankRow, 'rank'>[] = [];
  for (const [bidderId, list] of byBidder) {
    const ordered = [...list].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const best = ordered.reduce((acc, b) =>
      isBetter(b.transformedValue, acc.transformedValue, side) ? b : acc,
    );
    const latest = ordered[ordered.length - 1];
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
    rows.push({
      bidderId,
      bidValue: best.bidValue,
      transformedValue: best.transformedValue,
      bidCount: ordered.length,
      lastBidAt: latest.submittedAt,
      sequenceNumber: best.sequenceNumber,
      movement: previous
        ? improvement(previous.transformedValue, latest.transformedValue, side)
        : 0,
    });
  }

  const cmp = bestFirst(side);
  rows.sort((a, b) => {
    const byValue = cmp(a.transformedValue, b.transformedValue);
    if (byValue !== 0) return byValue;
    // Deterministic tie resolution. FIRST_IN_WINS: earlier sequence leads.
    if (tiePolicy === 'FIRST_IN_WINS') return a.sequenceNumber - b.sequenceNumber;
    return a.sequenceNumber - b.sequenceNumber;
  });

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function leaderOf(rows: RankRow[]): RankRow | null {
  return rows.length > 0 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Bid validation
// ---------------------------------------------------------------------------

export type RejectionCode =
  | 'AUCTION_NOT_LIVE'
  | 'AUCTION_PAUSED'
  | 'LOT_NOT_OPEN'
  | 'PAST_DEADLINE'
  | 'ABOVE_CEILING'
  | 'BELOW_FLOOR'
  | 'NOT_AN_IMPROVEMENT'
  | 'BELOW_MIN_DECREMENT'
  | 'ABOVE_MAX_DECREMENT'
  | 'INSIDE_FRONT_BUFFER'
  | 'REBID_ON_OWN_LEAD'
  | 'WITHDRAWAL_NOT_PERMITTED'
  | 'PROXY_CEILING_REQUIRED'
  | 'NEEDS_TYPED_CONFIRMATION';

export interface ValidationOutcome {
  accepted: boolean;
  code: RejectionCode | null;
  message: string | null;
  /** True when the bid is legal but requires typed confirmation first. */
  requiresConfirmation: boolean;
  /** Populated on acceptance: what the bid becomes in buyer terms. */
  transformedValue: number;
}

export interface BidAttempt {
  auction: Auction;
  auctionLot: AuctionLot;
  lotCeiling: number | null;
  lotFloor: number | null;
  bidderId: Id;
  bidValue: number;
  quantity: number;
  lineCount: number;
  /** Server clock. A client-supplied time is never used here. */
  serverNow: ServerMillis;
  existingBids: Bid[];
  costComponents: CostComponent[];
  /** Set when the bidder has already typed the confirmation phrase. */
  confirmed?: boolean;
}

export function validateBid(attempt: BidAttempt): ValidationOutcome {
  const { auction, auctionLot, bidValue, serverNow } = attempt;
  const side = auction.side;
  const ag = auction.antiGaming;

  const reject = (code: RejectionCode, message: string): ValidationOutcome => ({
    accepted: false, code, message, requiresConfirmation: false, transformedValue: 0,
  });

  if (auction.status === 'PAUSED') {
    // Pausing prevents bid acceptance server-side, not merely in the UI.
    return reject('AUCTION_PAUSED', 'The auction is paused. Bidding is closed until the controller resumes it.');
  }
  if (auction.status !== 'LIVE' && auction.status !== 'EXTENDED') {
    return reject('AUCTION_NOT_LIVE', 'The auction is not open for bidding.');
  }
  if (auctionLot.status !== 'LOT_OPEN' && auctionLot.status !== 'LOT_CLOSING') {
    return reject('LOT_NOT_OPEN', 'This lot is not open for bidding.');
  }
  if (auctionLot.closesAt !== null && serverNow > auctionLot.closesAt) {
    return reject('PAST_DEADLINE', 'The bidding window for this lot has closed.');
  }

  // Hard validation bounds. Ceiling and floor reject at entry.
  if (attempt.lotCeiling !== null && bidValue > attempt.lotCeiling) {
    return reject('ABOVE_CEILING', `Bids above ${attempt.lotCeiling.toLocaleString()} are not accepted.`);
  }
  if (attempt.lotFloor !== null && bidValue < attempt.lotFloor) {
    return reject('BELOW_FLOOR', `Bids below ${attempt.lotFloor.toLocaleString()} are not accepted.`);
  }

  const transform = transformBid(
    { bidderId: attempt.bidderId, bidValue, quantity: attempt.quantity, lineCount: attempt.lineCount },
    attempt.costComponents,
    auction.transformation,
  );

  const ranked = rankLot(attempt.existingBids, auctionLot.id, side, ag.tieBidPolicy);
  const leader = leaderOf(ranked);
  const mine = ranked.find((r) => r.bidderId === attempt.bidderId);

  // Sealed and Vickrey are single-shot: no improvement rules apply, and a
  // second bid replaces nothing — it is simply a new sealed submission.
  const iterative = auction.rounds !== 'SINGLE';

  if (iterative && leader) {
    const leadingIsMine = leader.bidderId === attempt.bidderId;

    if (leadingIsMine && !ag.rebidOnOwnLeadingBidAllowed) {
      return reject('REBID_ON_OWN_LEAD', 'You already hold the leading bid. Bidding against yourself is not permitted.');
    }

    const reference = leader.transformedValue;
    const delta = improvement(reference, transform.transformedValue, side);

    if (delta <= 0) {
      return reject(
        'NOT_AN_IMPROVEMENT',
        side === 'BUY'
          ? 'Your bid must be lower than the current leading bid.'
          : 'Your bid must be higher than the current leading bid.',
      );
    }

    // Front buffer: a band ahead of the lead in which competing bids are rejected.
    if (ag.frontBufferPct > 0) {
      const bufferPct = improvementPct(reference, transform.transformedValue, side);
      if (bufferPct > 0 && bufferPct < ag.frontBufferPct) {
        return reject(
          'INSIDE_FRONT_BUFFER',
          `Bids within ${ag.frontBufferPct}% of the leading bid are not accepted.`,
        );
      }
    }

    // Minimum decrement — prevents penny bidding.
    const requiredMin = ag.minDecrementType === 'PCT'
      ? (Math.abs(reference) * ag.minDecrement) / 100
      : ag.minDecrement;
    if (delta < requiredMin) {
      const label = ag.minDecrementType === 'PCT'
        ? `${ag.minDecrement}%`
        : requiredMin.toLocaleString();
      return reject('BELOW_MIN_DECREMENT', `The minimum improvement is ${label}.`);
    }

    // Maximum decrement guard — fat finger and gaming protection.
    const deltaPct = improvementPct(reference, transform.transformedValue, side);
    if (deltaPct > ag.maxDecrementPct) {
      return reject(
        'ABOVE_MAX_DECREMENT',
        `That is a ${deltaPct.toFixed(1)}% move. Improvements beyond ${ag.maxDecrementPct}% are not accepted — check the figure.`,
      );
    }

    // Typed confirmation for large but legal improvements.
    if (deltaPct >= ag.confirmThresholdPct && !attempt.confirmed) {
      return {
        accepted: false,
        code: 'NEEDS_TYPED_CONFIRMATION',
        message: `This bid improves your position by ${deltaPct.toFixed(1)}%. Type CONFIRM to place it.`,
        requiresConfirmation: true,
        transformedValue: transform.transformedValue,
      };
    }
  } else if (iterative && mine) {
    // No leader yet but this bidder has bid: still must improve on themselves.
    const delta = improvement(mine.transformedValue, transform.transformedValue, side);
    if (delta <= 0) {
      return reject('NOT_AN_IMPROVEMENT', 'Your bid must improve on your previous bid.');
    }
  }

  return {
    accepted: true, code: null, message: null,
    requiresConfirmation: false, transformedValue: transform.transformedValue,
  };
}

// ---------------------------------------------------------------------------
// Bid placement — append-only
// ---------------------------------------------------------------------------

let sequenceCounter = 0;
/** Monotonic sequence. Authoritative when two bids share a millisecond. */
export function nextSequenceNumber(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}
export function resetSequenceForTests(value = 0): void {
  sequenceCounter = value;
}

export interface PlaceBidResult {
  bid: Bid | null;
  outcome: ValidationOutcome;
  /** Set when the bid landed inside the soft-close trigger window. */
  extendedTo: ServerMillis | null;
  integrityFlags: IntegrityFlag[];
}

export function placeBid(
  attempt: BidAttempt,
  meta: { source: BidSource; userId: Id; clientTimestamp: ServerMillis | null; ipHash: string; onBehalfReason?: string },
): PlaceBidResult {
  const outcome = validateBid(attempt);
  const flags: IntegrityFlag[] = [];

  if (!outcome.accepted) {
    // A rejected bid is still written to the ledger, marked invalid with its
    // reason. The ledger is the record of what was attempted, not of what won.
    if (outcome.requiresConfirmation) {
      return { bid: null, outcome, extendedTo: null, integrityFlags: flags };
    }
    const rejected = buildBid(attempt, meta, outcome.transformedValue, 0, false, outcome.message);
    return { bid: rejected, outcome, extendedTo: null, integrityFlags: flags };
  }

  const rankedBefore = rankLot(attempt.existingBids, attempt.auctionLot.id, attempt.auction.side, attempt.auction.antiGaming.tieBidPolicy);
  const provisionalRank = 1 + rankedBefore.filter((r) =>
    isBetter(r.transformedValue, outcome.transformedValue, attempt.auction.side),
  ).length;

  const bid = buildBid(attempt, meta, outcome.transformedValue, provisionalRank, true, null);

  // Soft close: a bid inside the trigger window extends the clock.
  let extendedTo: ServerMillis | null = null;
  const ag = attempt.auction.antiGaming;
  if (
    attempt.auction.closePolicy === 'SOFT_EXTENSION' &&
    attempt.auctionLot.closesAt !== null
  ) {
    const remainingSec = (attempt.auctionLot.closesAt - attempt.serverNow) / 1000;
    if (remainingSec <= ag.softCloseTriggerSec) {
      const withinLimit = ag.maxExtensions === null || attempt.auction.extensionsUsed < ag.maxExtensions;
      if (withinLimit) {
        extendedTo = attempt.auctionLot.closesAt + ag.softCloseExtensionSec * 1000;
      }
      if (remainingSec <= ag.snipingThresholdSec) {
        flags.push({
          kind: 'SNIPING',
          bidderIds: [attempt.bidderId],
          detail: `Bid placed ${remainingSec.toFixed(0)}s before close.`,
          at: attempt.serverNow,
        });
      }
    }
  }

  flags.push(...detectIdenticalBids([...attempt.existingBids, bid], ag.identicalBidWindowSec));

  return { bid, outcome, extendedTo, integrityFlags: flags };
}

function buildBid(
  attempt: BidAttempt,
  meta: { source: BidSource; userId: Id; clientTimestamp: ServerMillis | null; ipHash: string; onBehalfReason?: string },
  transformedValue: number,
  rank: number,
  isValid: boolean,
  rejectionReason: string | null,
): Bid {
  return {
    id: `bid-${attempt.auctionLot.id}-${nextSequenceNumber()}`,
    auctionId: attempt.auction.id,
    auctionLotId: attempt.auctionLot.id,
    lineItemId: null,
    bidderId: attempt.bidderId,
    bidValue: attempt.bidValue,
    transformedValue,
    currency: 'USD',
    rankAtSubmission: rank,
    submittedAt: attempt.serverNow,
    source: meta.source,
    submittedByUserId: meta.userId,
    onBehalfReason: meta.onBehalfReason ?? null,
    clientTimestamp: meta.clientTimestamp,
    ipHash: meta.ipHash,
    isValid,
    rejectionReason,
    sequenceNumber: sequenceCounter,
  };
}

// ---------------------------------------------------------------------------
// Integrity flags
// ---------------------------------------------------------------------------

export interface IntegrityFlag {
  kind: 'SNIPING' | 'IDENTICAL_BID' | 'SHARED_IP' | 'BELOW_MIN_BIDDERS';
  bidderIds: Id[];
  detail: string;
  at: ServerMillis;
}

/** Two bidders submitting the same value within a short window — possible coordination. */
export function detectIdenticalBids(bids: Bid[], windowSec: number): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const valid = bids.filter((b) => b.isValid);
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const a = valid[i];
      const b = valid[j];
      if (a.bidderId === b.bidderId) continue;
      if (a.bidValue !== b.bidValue) continue;
      if (Math.abs(a.submittedAt - b.submittedAt) / 1000 > windowSec) continue;
      flags.push({
        kind: 'IDENTICAL_BID',
        bidderIds: [a.bidderId, b.bidderId],
        detail: `Identical bid of ${a.bidValue.toLocaleString()} within ${windowSec}s.`,
        at: Math.max(a.submittedAt, b.submittedAt),
      });
    }
  }
  return flags;
}

export function detectSharedIp(bids: Bid[]): IntegrityFlag[] {
  const byIp = new Map<string, Set<Id>>();
  for (const bid of bids) {
    const set = byIp.get(bid.ipHash) ?? new Set<Id>();
    set.add(bid.bidderId);
    byIp.set(bid.ipHash, set);
  }
  const flags: IntegrityFlag[] = [];
  for (const [ip, bidders] of byIp) {
    if (bidders.size > 1) {
      flags.push({
        kind: 'SHARED_IP',
        bidderIds: [...bidders],
        detail: `${bidders.size} bidders bidding from one address (${ip}).`,
        at: 0,
      });
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Start guard
// ---------------------------------------------------------------------------

export interface StartCheck {
  canStart: boolean;
  requiresJustification: boolean;
  blockers: string[];
  warnings: string[];
}

export function checkCanStart(
  auction: Auction,
  joinedBidderCount: number,
  registeredBidderCount: number,
  dryRunCompletedForAll: boolean,
): StartCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const ag = auction.antiGaming;

  if (registeredBidderCount < ag.minBiddersToStart) {
    const message = `${registeredBidderCount} bidders registered; the minimum is ${ag.minBiddersToStart}.`;
    if (ag.belowMinPolicy === 'BLOCK') blockers.push(message);
    else warnings.push(message);
  }
  if (registeredBidderCount < 3) {
    warnings.push('Fewer than 3 qualified bidders — an auction is not the right instrument. Negotiate, or run a sealed bid for the record.');
  }
  if (joinedBidderCount < registeredBidderCount) {
    warnings.push(`${registeredBidderCount - joinedBidderCount} registered bidders have not joined the room.`);
  }
  if (ag.requireDryRunFirstEvent && !dryRunCompletedForAll) {
    warnings.push('One or more first-time bidders has not completed a dry run.');
  }

  return {
    canStart: blockers.length === 0,
    requiresJustification:
      ag.belowMinPolicy === 'WARN_AND_JUSTIFY' && registeredBidderCount < ag.minBiddersToStart,
    blockers,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Proxy bidding
// ---------------------------------------------------------------------------

/**
 * Resolve proxies after a lead change. A proxy improves by exactly one step,
 * never past its ceiling. A proxy without a ceiling is never created.
 */
export function resolveProxies(
  instructions: ProxyBidInstruction[],
  currentLeadValue: number,
  side: Side,
): { bidderId: Id; bidValue: number }[] {
  const out: { bidderId: Id; bidValue: number }[] = [];
  for (const instruction of instructions) {
    if (!instruction.active) continue;
    const next = side === 'BUY'
      ? currentLeadValue - instruction.step
      : currentLeadValue + instruction.step;
    // The ceiling is the bidder's own limit; a proxy never crosses it.
    const withinCeiling = side === 'BUY' ? next >= instruction.ceiling : next <= instruction.ceiling;
    if (!withinCeiling) continue;
    out.push({ bidderId: instruction.bidderId, bidValue: next });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mechanism guidance
// ---------------------------------------------------------------------------

export interface MechanismGuidance {
  recommendation: string | null;
  warnings: string[];
}

export function mechanismGuidance(
  mechanism: Auction['mechanism'],
  qualifiedBidderCount: number,
  lineCount: number,
): MechanismGuidance {
  const warnings: string[] = [];
  if (qualifiedBidderCount < 3) {
    warnings.push('Fewer than 3 qualified bidders. Do not auction — negotiate, or sealed bid for the record.');
  }
  if (mechanism === 'ENGLISH' && qualifiedBidderCount > 8) {
    warnings.push('English auctions work best with 4–8 bidders. A larger pool dilutes pressure.');
  }
  if (mechanism === 'JAPANESE' && qualifiedBidderCount > 8) {
    warnings.push('Japanese auctions get slow with large pools.');
  }
  if (mechanism === 'PORTFOLIO' && lineCount < 20) {
    warnings.push('Portfolio optimisation earns its complexity at 20+ lines with bundle economics.');
  }
  if (mechanism === 'VICKREY') {
    warnings.push('Vickrey is off by default. Enable only where a regime mandates second-price awards.');
  }

  let recommendation: string | null = null;
  if (qualifiedBidderCount < 3) recommendation = 'SEALED_BID or negotiation';
  else if (lineCount >= 20) recommendation = 'PORTFOLIO';
  else if (qualifiedBidderCount >= 4 && qualifiedBidderCount <= 8) recommendation = 'ENGLISH';

  return { recommendation, warnings };
}
