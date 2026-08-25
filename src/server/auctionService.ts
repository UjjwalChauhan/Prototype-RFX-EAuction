/**
 * The auction service — the boundary a bidding client talks to.
 *
 * Two responsibilities that must not live in a component:
 *   1. Accepting or rejecting a bid, and appending it to the ledger.
 *   2. Deciding what each bidder is permitted to receive back.
 *
 * The second is the security-critical one. A bidder's socket payload is built
 * by `bidderView`, which routes through the visibility manifest, so a
 * competitor price the policy forbids never reaches the client at all.
 */
import type {
  Auction, AuctionControlEvent, AuctionLot, Bid, CostComponent, EventBidder, Id, Lot,
} from '../domain/types';
import {
  type IntegrityFlag, type RankRow, detectSharedIp, placeBid, rankLot,
} from '../domain/auctionEngine';
import { projectForBidder, type BidderProjection } from '../domain/feedbackPolicy';
import { bidToBeat } from '../domain/transformation';
import { record } from './audit';
import { serverNow } from './clock';

export interface AuctionState {
  auction: Auction;
  lots: AuctionLot[];
  lotDetails: Record<Id, Lot>;
  bids: Bid[];
  bidders: EventBidder[];
  costComponents: CostComponent[];
  controlEvents: AuctionControlEvent[];
  integrityFlags: IntegrityFlag[];
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export interface SubmitBidRequest {
  state: AuctionState;
  auctionLotId: Id;
  bidderId: Id;
  bidValue: number;
  userId: Id;
  source?: Bid['source'];
  clientTimestamp?: number | null;
  onBehalfReason?: string;
  confirmed?: boolean;
}

export interface SubmitBidResponse {
  state: AuctionState;
  accepted: boolean;
  rejectionCode: string | null;
  message: string | null;
  requiresConfirmation: boolean;
}

export function submitBid(request: SubmitBidRequest): SubmitBidResponse {
  const { state } = request;
  const auctionLot = state.lots.find((l) => l.id === request.auctionLotId);
  if (!auctionLot) {
    return { state, accepted: false, rejectionCode: 'LOT_NOT_OPEN', message: 'Unknown lot.', requiresConfirmation: false };
  }
  const lot = state.lotDetails[auctionLot.lotId];

  const result = placeBid(
    {
      auction: state.auction,
      auctionLot,
      lotCeiling: lot?.ceilingPrice ?? null,
      lotFloor: lot?.floorPrice ?? null,
      bidderId: request.bidderId,
      bidValue: request.bidValue,
      quantity: 1,
      lineCount: 1,
      serverNow: serverNow(),
      existingBids: state.bids,
      costComponents: state.costComponents,
      confirmed: request.confirmed,
    },
    {
      source: request.source ?? 'PORTAL',
      userId: request.userId,
      // Stored for diagnostics only. Ranking uses submittedAt from the server.
      clientTimestamp: request.clientTimestamp ?? null,
      ipHash: `ip-${request.bidderId}`,
      onBehalfReason: request.onBehalfReason,
    },
  );

  if (result.outcome.requiresConfirmation) {
    return {
      state,
      accepted: false,
      rejectionCode: result.outcome.code,
      message: result.outcome.message,
      requiresConfirmation: true,
    };
  }

  // The ledger is append-only: a rejected attempt is recorded as invalid with
  // its reason rather than discarded.
  const bids = result.bid ? [...state.bids, result.bid] : state.bids;
  let lots = state.lots;
  let auction = state.auction;
  const controlEvents = [...state.controlEvents];

  if (result.extendedTo !== null) {
    lots = lots.map((l) =>
      l.id === auctionLot.id ? { ...l, closesAt: result.extendedTo } : l,
    );
    auction = { ...auction, status: 'EXTENDED', extensionsUsed: auction.extensionsUsed + 1, endsAt: result.extendedTo };
    controlEvents.unshift({
      id: `ctrl-${controlEvents.length + 1}`,
      auctionId: auction.id,
      kind: 'EXTENDED',
      actorId: 'system',
      reason: `Soft close: a bid landed inside the ${auction.antiGaming.softCloseTriggerSec}s trigger window.`,
      at: serverNow(),
      detail: `Extended by ${auction.antiGaming.softCloseExtensionSec}s.`,
    });
  }

  if (result.bid) {
    record({
      eventId: auction.eventId,
      objectType: 'Bid',
      objectId: result.bid.id,
      action: result.bid.isValid ? 'BID_ACCEPTED' : 'BID_REJECTED',
      actorId: request.userId,
      after: {
        bidValue: result.bid.bidValue,
        transformedValue: result.bid.transformedValue,
        sequenceNumber: result.bid.sequenceNumber,
        source: result.bid.source,
      },
      reason: result.bid.rejectionReason ?? request.onBehalfReason ?? null,
    });
  }

  const integrityFlags = [
    ...state.integrityFlags,
    ...result.integrityFlags,
    ...detectSharedIp(bids),
  ].filter(
    (flag, i, all) =>
      all.findIndex(
        (f) => f.kind === flag.kind && f.bidderIds.join() === flag.bidderIds.join() && f.detail === flag.detail,
      ) === i,
  );

  return {
    state: { ...state, auction, lots, bids, controlEvents, integrityFlags },
    accepted: result.outcome.accepted,
    rejectionCode: result.outcome.code,
    message: result.outcome.message,
    requiresConfirmation: false,
  };
}

// ---------------------------------------------------------------------------
// Controller actions — logged before they take effect
// ---------------------------------------------------------------------------

export type ControllerAction = 'PAUSE' | 'RESUME' | 'EXTEND' | 'FORCE_CLOSE' | 'ABORT' | 'BROADCAST';

export function controllerAction(
  state: AuctionState,
  action: ControllerAction,
  actorId: Id,
  reason: string,
  detail?: { extendSec?: number; message?: string },
): AuctionState {
  if (!reason.trim()) {
    throw new Error('A controller action requires a reason. It is written to the audit log before it takes effect.');
  }

  const kindMap: Record<ControllerAction, AuctionControlEvent['kind']> = {
    PAUSE: 'PAUSED', RESUME: 'RESUMED', EXTEND: 'EXTENDED',
    FORCE_CLOSE: 'FORCE_CLOSED', ABORT: 'ABORTED', BROADCAST: 'MESSAGE_BROADCAST',
  };

  // Audit first, effect second.
  record({
    eventId: state.auction.eventId,
    objectType: 'Auction',
    objectId: state.auction.id,
    action: `AUCTION_${kindMap[action]}`,
    actorId,
    before: { status: state.auction.status },
    after: null,
    reason,
  });

  const event: AuctionControlEvent = {
    id: `ctrl-${state.controlEvents.length + 1}`,
    auctionId: state.auction.id,
    kind: kindMap[action],
    actorId,
    reason,
    at: serverNow(),
    detail: detail?.message ?? (detail?.extendSec ? `+${detail.extendSec}s` : null),
  };

  let auction = state.auction;
  let lots = state.lots;

  switch (action) {
    case 'PAUSE':
      // Server-side: validateBid rejects while PAUSED, so this is not cosmetic.
      auction = { ...auction, status: 'PAUSED' };
      break;
    case 'RESUME':
      auction = { ...auction, status: 'LIVE' };
      break;
    case 'EXTEND': {
      const extendMs = (detail?.extendSec ?? auction.antiGaming.softCloseExtensionSec) * 1000;
      lots = lots.map((l) =>
        l.status === 'LOT_OPEN' && l.closesAt !== null ? { ...l, closesAt: l.closesAt + extendMs } : l,
      );
      auction = {
        ...auction,
        status: 'EXTENDED',
        extensionsUsed: auction.extensionsUsed + 1,
        endsAt: auction.endsAt !== null ? auction.endsAt + extendMs : null,
      };
      break;
    }
    case 'FORCE_CLOSE':
      auction = { ...auction, status: 'CLOSED' };
      lots = lots.map((l) => ({ ...l, status: 'LOT_CLOSED' as const }));
      break;
    case 'ABORT':
      auction = { ...auction, status: 'ABORTED' };
      lots = lots.map((l) => ({ ...l, status: 'LOT_CLOSED' as const }));
      break;
    case 'BROADCAST':
      break;
  }

  return { ...state, auction, lots, controlEvents: [event, ...state.controlEvents] };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface BuyerRankRow extends RankRow {
  displayName: string;
  maskedLabel: string;
  participationStatus: EventBidder['participationStatus'];
}

/** The buyer sees everything, always — real names and transformed values. */
export function buyerView(
  state: AuctionState,
  auctionLotId: Id,
  counterpartyNames: Record<Id, string>,
  options: { observer?: boolean } = {},
): BuyerRankRow[] {
  const rows = rankLot(state.bids, auctionLotId, state.auction.side, state.auction.antiGaming.tieBidPolicy);
  const withNames = rows.map((row) => {
    const bidder = state.bidders.find((b) => b.id === row.bidderId);
    const realName = bidder ? counterpartyNames[bidder.counterpartyId] ?? 'Unknown' : 'Unknown';
    return {
      ...row,
      // An observer sees masked labels only.
      displayName: options.observer ? bidder?.maskedLabel ?? 'Bidder' : realName,
      maskedLabel: bidder?.maskedLabel ?? 'Bidder',
      participationStatus: bidder?.participationStatus ?? 'REGISTERED',
    };
  });

  // Registered bidders with no bid still appear, so "not joined" is visible.
  const bidded = new Set(withNames.map((r) => r.bidderId));
  const silent = state.bidders
    .filter((b) => !bidded.has(b.id))
    .map((b, i) => ({
      rank: withNames.length + i + 1,
      bidderId: b.id,
      bidValue: 0,
      transformedValue: 0,
      bidCount: 0,
      lastBidAt: null,
      sequenceNumber: Number.MAX_SAFE_INTEGER,
      movement: 0,
      displayName: options.observer ? b.maskedLabel : counterpartyNames[b.counterpartyId] ?? 'Unknown',
      maskedLabel: b.maskedLabel,
      participationStatus: b.participationStatus,
    }));

  return [...withNames, ...silent];
}

export interface BidderView {
  projection: BidderProjection;
  /** The bidder's own numbers — always permitted. */
  myBestBid: number | null;
  myBidHistory: { value: number; at: number }[];
  /**
   * The bid to place to take the lead, expressed in this bidder's own terms.
   * Under transformation two bidders correctly see different numbers here.
   */
  bidToBeat: number | null;
  requiredImprovement: number | null;
  closesAt: number | null;
  auctionStatus: Auction['status'];
}

/**
 * The only function permitted to build a bidder-facing auction payload.
 * Everything a policy forbids is absent from the result.
 */
export function bidderView(
  state: AuctionState,
  auctionLotId: Id,
  bidderId: Id,
  counterpartyNames: Record<Id, string>,
): BidderView {
  const auctionLot = state.lots.find((l) => l.id === auctionLotId);
  const lot = auctionLot ? state.lotDetails[auctionLot.lotId] : undefined;
  const rows = rankLot(state.bids, auctionLotId, state.auction.side, state.auction.antiGaming.tieBidPolicy);

  const ranked = rows.map((row) => {
    const bidder = state.bidders.find((b) => b.id === row.bidderId);
    return {
      bidderId: row.bidderId,
      maskedLabel: bidder?.maskedLabel ?? 'Bidder',
      displayName:
        state.auction.identityPolicy === 'NAMED' && bidder
          ? counterpartyNames[bidder.counterpartyId] ?? 'Bidder'
          : bidder?.maskedLabel ?? 'Bidder',
      transformedValue: row.transformedValue,
      rawBidValue: row.bidValue,
    };
  });

  const projection = projectForBidder({
    policy: state.auction.feedbackPolicy,
    side: state.auction.side,
    bidderId,
    ranked,
    // The target enters here only to compute a colour band; the number itself
    // travels onward only when discloseTarget is true.
    targetPrice: lot?.targetPrice ?? null,
    amberBandPct: state.auction.trafficAmberBandPct,
    discloseTarget: state.auction.discloseTarget,
  });

  const mine = rows.find((r) => r.bidderId === bidderId);
  const myBids = state.bids
    .filter((b) => b.bidderId === bidderId && b.auctionLotId === auctionLotId && b.isValid)
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
    .map((b) => ({ value: b.bidValue, at: b.submittedAt }));

  const leader = rows[0];
  let beat: number | null = null;
  let required: number | null = null;
  if (leader && mine) {
    const computed = bidToBeat(
      leader.transformedValue,
      { bidderId, bidValue: mine.bidValue, quantity: 1, lineCount: 1 },
      state.costComponents,
      state.auction.transformation,
      state.auction.side,
    );
    beat = computed.rawBidToBeat;
    required = computed.requiredImprovement;
  }

  return {
    projection,
    myBestBid: mine?.bidValue ?? null,
    myBidHistory: myBids,
    bidToBeat: beat,
    requiredImprovement: required,
    closesAt: auctionLot?.closesAt ?? null,
    auctionStatus: state.auction.status,
  };
}
