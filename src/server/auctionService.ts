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
  Auction, AuctionControlEvent, AuctionLot, Bid, CostComponent, EventBidder,
  FeedbackPolicy, Id, Lot,
} from '../domain/types';
import { MECHANISM_PROFILE } from '../domain/auctionMechanics';
import {
  type IntegrityFlag, type RankRow, detectSharedIp, placeBid, rankLot,
} from '../domain/auctionEngine';
import {
  VISIBILITY_MANIFEST, projectForBidder, type BidderProjection,
} from '../domain/feedbackPolicy';
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

  /**
   * A Dutch clock stops the instant somebody accepts.
   *
   * Without this the lot stayed open and the second acceptance was refused by
   * the improvement rule — "your bid must be lower than the current leading
   * bid" — which is not what happened and not something a Dutch bidder can
   * act on. The format's whole proposition is that the first acceptance ends
   * it, so the close belongs here, beside the acceptance that caused it,
   * rather than in a controller action somebody has to remember to press.
   */
  if (result.bid?.isValid && state.auction.closePolicy === 'FIRST_ACCEPT') {
    const at = serverNow();
    lots = lots.map((l) => (l.id === auctionLot.id ? { ...l, status: 'LOT_CLOSED', closesAt: at } : l));
    const anyOpen = lots.some((l) => l.status === 'LOT_OPEN' || l.status === 'LOT_CLOSING');
    auction = { ...auction, status: anyOpen ? auction.status : 'CLOSED', endsAt: anyOpen ? auction.endsAt : at };
    controlEvents.unshift({
      id: `ctrl-accept-${result.bid.id}`,
      auctionId: auction.id,
      kind: 'LOT_CLOSED',
      actorId: 'system',
      reason: 'First acceptance. A Dutch auction ends when one bidder takes the clock price.',
      at,
      detail: `Accepted at ${result.bid.bidValue}.`,
    });
  }

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

export type ControllerAction =
  /**
   * Start it.
   *
   * An auction published from a journey is configured and scheduled, not
   * running: the window it was given may be hours away, and nothing else in
   * the prototype moves a clock on its own. Someone opens the room, and that
   * someone is recorded — this is the first row in the log of a live event.
   */
  | 'OPEN'
  | 'PAUSE' | 'RESUME' | 'EXTEND' | 'FORCE_CLOSE' | 'ABORT' | 'BROADCAST'
  /**
   * The mechanisms that do not run themselves.
   *
   * A Japanese round does not advance on a timer, a sealed envelope does not
   * open itself, and a turn is handed over by someone. Routed through the same
   * audited path as every other controller action rather than as UI state, so
   * "who advanced the round that put three bidders out" has an answer.
   */
  | 'ADVANCE_ROUND' | 'OPEN_ENVELOPES' | 'HOLD_CLOCK' | 'RESUME_CLOCK'
  | 'CALL_TURN' | 'SKIP_TURN' | 'OPEN_NEXT_LOT'
  /**
   * The practice run, opened and closed before the auction starts.
   *
   * A controller action rather than UI state because it changes what a
   * supplier's screen offers them, and because "the rehearsal was still open
   * when bidding started" is a question that has to have an answer.
   */
  | 'OPEN_REHEARSAL' | 'CLOSE_REHEARSAL'
  /**
   * Change what bidders can see, mid-auction.
   *
   * A real lever: a room that has gone quiet under RANK_ONLY often moves
   * again when suppliers can see the gap they are chasing. It is also a
   * material change to the rules of a competition already running, so it
   * carries a reason, lands in the log, and every console is told — see
   * `detail.feedbackPolicy`.
   */
  | 'CHANGE_FEEDBACK';

export function controllerAction(
  state: AuctionState,
  action: ControllerAction,
  actorId: Id,
  reason: string,
  detail?: { extendSec?: number; message?: string; feedbackPolicy?: FeedbackPolicy },
): AuctionState {
  if (!reason.trim()) {
    throw new Error('A controller action requires a reason. It is written to the audit log before it takes effect.');
  }

  const kindMap: Record<ControllerAction, AuctionControlEvent['kind']> = {
    OPEN: 'OPENED',
    PAUSE: 'PAUSED', RESUME: 'RESUMED', EXTEND: 'EXTENDED',
    FORCE_CLOSE: 'FORCE_CLOSED', ABORT: 'ABORTED', BROADCAST: 'MESSAGE_BROADCAST',
    ADVANCE_ROUND: 'ROUND_ADVANCED', OPEN_ENVELOPES: 'ENVELOPES_OPENED',
    HOLD_CLOCK: 'CLOCK_HELD', RESUME_CLOCK: 'CLOCK_RESUMED',
    CALL_TURN: 'TURN_CALLED', SKIP_TURN: 'TURN_SKIPPED',
    OPEN_NEXT_LOT: 'LOT_OPENED',
    OPEN_REHEARSAL: 'REHEARSAL_OPENED', CLOSE_REHEARSAL: 'REHEARSAL_CLOSED',
    CHANGE_FEEDBACK: 'FEEDBACK_CHANGED',
  };

  /**
   * A feedback policy the mechanism forbids is refused here, not warned about
   * in the UI. `incompatibleFeedback` exists because some pairings are not
   * merely unwise: telling a Dutch bidder their rank describes a ranking the
   * format does not have, and a traffic-light auction whose feedback is
   * full price is not a traffic-light auction. The setup screen enforces the
   * same table, and this is the enforcement that cannot be bypassed.
   */
  if (action === 'CHANGE_FEEDBACK') {
    const next = detail?.feedbackPolicy;
    if (!next) {
      throw new Error('CHANGE_FEEDBACK requires the policy to change to.');
    }
    const forbidden = MECHANISM_PROFILE[state.auction.mechanism].incompatibleFeedback;
    if (forbidden.includes(next)) {
      throw new Error(
        `${VISIBILITY_MANIFEST[next].label} feedback is not available in a `
        + `${MECHANISM_PROFILE[state.auction.mechanism].label} auction.`,
      );
    }
  }

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
    detail: action === 'CHANGE_FEEDBACK'
      ? `${VISIBILITY_MANIFEST[state.auction.feedbackPolicy].label} → ${VISIBILITY_MANIFEST[detail!.feedbackPolicy!].label}`
      : detail?.message ?? (detail?.extendSec ? `+${detail.extendSec}s` : null),
  };

  let auction = state.auction;
  let lots = state.lots;

  switch (action) {
    /**
     * The room opens, and so does the first lot.
     *
     * A lot strategy that runs its lots together opens all of them; every
     * other one opens the first and leaves the controller to open the next,
     * which is what `OPEN_NEXT_LOT` is for.
     */
    case 'OPEN': {
      const parallel = auction.lotStrategy !== 'INDEPENDENT';
      auction = {
        ...auction,
        status: 'LIVE',
        startsAt: auction.startsAt ?? event.at,
      };
      lots = lots.map((l, i) => (
        (parallel || i === 0) && l.status === 'LOT_PENDING'
          ? { ...l, status: 'LOT_OPEN' as const, opensAt: l.opensAt ?? event.at }
          : l
      ));
      break;
    }
    /**
     * Opening and closing the practice run changes nothing about the auction.
     *
     * The control event *is* the effect — `rehearsalOpen` reads the log — so
     * there is no second copy of the fact to keep in step. Clearing the
     * practice ledger belongs to the store, which is where it is held.
     */
    case 'OPEN_REHEARSAL':
    case 'CLOSE_REHEARSAL':
      break;
    /**
     * The projection is rebuilt from `auction.feedbackPolicy` on every read,
     * so changing it here changes what every console is sent on its next
     * poll. Nothing already delivered is recalled — a bidder who saw the best
     * price under FULL_PRICE saw it — which is exactly why the change is
     * logged and broadcast rather than made quietly.
     */
    case 'CHANGE_FEEDBACK':
      auction = { ...auction, feedbackPolicy: detail!.feedbackPolicy! };
      break;
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

    // A held Dutch clock is a pause by another name — the price stops moving
    // and acceptances are refused — so it takes the same server-side effect
    // rather than a second, weaker one that only stops the animation.
    case 'HOLD_CLOCK':
      auction = { ...auction, status: 'PAUSED' };
      break;
    case 'RESUME_CLOCK':
      auction = { ...auction, status: 'LIVE' };
      break;

    /**
     * The round advances and the clock steps. Who is still in is derived from
     * the ledger — a bidder who confirmed the round just closed stays, one who
     * did not is out — so there is nothing to write here beyond the event
     * itself, which is exactly the record an eliminated bidder will ask for.
     */
    case 'ADVANCE_ROUND':
      break;

    /** Irreversible, and logged before the values become readable. */
    case 'OPEN_ENVELOPES':
      break;

    case 'CALL_TURN':
    case 'SKIP_TURN':
      break;

    case 'OPEN_NEXT_LOT': {
      const next = lots.find((l) => l.status === 'LOT_PENDING');
      if (next) {
        lots = lots.map((l) => (l.id === next.id ? { ...l, status: 'LOT_OPEN' as const } : l));
      }
      break;
    }
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
  /**
   * "The bid to take the lead" is the leading value with the decrement moved to
   * the other side of it, and a bidder can invert it in one step. So it travels
   * only where the leading value is already derivable from what the policy
   * sends: outright under `bestPrice`, and through arithmetic under `gapPct` —
   * a bidder told they are 4% behind and holding their own number already has
   * it, and withholding the figure there would be theatre rather than a
   * boundary.
   *
   * Under rank-only, traffic-light or blind it is a competitor's price by
   * another name. A bidder is not left guessing: the decrement they owe on
   * their own last bid is in the rules, and that one is theirs to know.
   */
  const row = VISIBILITY_MANIFEST[state.auction.feedbackPolicy];
  if (leader && mine && (row.bestPrice || row.gapPct)) {
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
