/**
 * The practice run.
 *
 * A supplier invited to their first Japanese auction has to learn the format
 * while real money is on the clock. Every mechanism here behaves differently
 * enough that "place a bid" means five different things — a Dutch bidder
 * presses accept once and it is over, a Japanese bidder confirms or is out
 * permanently, an English bidder must beat a decrement they cannot see the
 * arithmetic of. The console already told them a practice run existed; this is
 * it.
 *
 * Two decisions shape everything below.
 *
 * **It rehearses *this* auction, not a demonstration of the format.** The
 * practice run uses the configured mechanism, the configured anti-gaming
 * bounds, the configured feedback policy and the real lot. A supplier who
 * learns that bids within 2% of the lead are refused has learned it about the
 * auction they are about to bid in. A generic demo would teach them the rules
 * of a different event, which is worse than teaching them nothing.
 *
 * **Practice bids live in their own ledger.** Not a flag on `Bid` — a separate
 * array. Every ranking, projection and award path in this system reads
 * `state.bids`, and a flag is a thing each of them has to remember to filter.
 * One that forgot would put a practice bid in a real ranking. A separate array
 * cannot be read by accident: the code has to ask for it by name.
 *
 * The rehearsal runs in the lobby and is cleared when the auction opens, so
 * nothing a supplier typed while learning can survive into the competition.
 */
import { placeBid, rankLot, type IntegrityFlag, type ValidationOutcome } from './auctionEngine';
import { MECHANISM_PROFILE, bidderRules, latestControlEvent } from './auctionMechanics';
import type {
  Auction, AuctionControlEvent, AuctionLot, Bid, CostComponent, Id, Lot, ServerMillis,
} from './types';

/**
 * Whether a rehearsal is running, read from the control log.
 *
 * Derived rather than stored for the same reason the Japanese round is: the
 * log is what a dispute is settled from, and a flag beside it is a second
 * answer to the same question that can disagree with the first.
 */
export function rehearsalOpen(controlEvents: AuctionControlEvent[]): boolean {
  return latestControlEvent(
    controlEvents, ['REHEARSAL_OPENED', 'REHEARSAL_CLOSED'],
  )?.kind === 'REHEARSAL_OPENED';
}

/** When the running rehearsal was opened, or null if none is. */
export function rehearsalOpenedAt(controlEvents: AuctionControlEvent[]): ServerMillis | null {
  const last = latestControlEvent(controlEvents, ['REHEARSAL_OPENED', 'REHEARSAL_CLOSED']);
  return last?.kind === 'REHEARSAL_OPENED' ? last.at : null;
}

/**
 * The auction as the rehearsal presents it: the real configuration, running.
 *
 * Only `status` moves. Changing anything else would be the demonstration this
 * deliberately is not — a practice run against relaxed bounds teaches a
 * supplier that their bid will be accepted when it will not.
 */
export function rehearsalAuction(auction: Auction): Auction {
  return { ...auction, status: 'LIVE' };
}

/** The lot as the rehearsal presents it: open, and closing when practice ends. */
export function rehearsalLot(lot: AuctionLot, endsAt: ServerMillis | null): AuctionLot {
  return { ...lot, status: 'LOT_OPEN', closesAt: endsAt };
}

export interface RehearsalAttempt {
  auction: Auction;
  lot: AuctionLot;
  /** The lot behind the auction lot — where the ceiling and floor live. */
  lotDetail: Lot | undefined;
  bidderId: Id;
  bidValue: number;
  quantity: number;
  lineCount: number;
  serverNow: ServerMillis;
  /** The practice ledger for this lot, not the real one. */
  practiceBids: Bid[];
  costComponents: CostComponent[];
  confirmed?: boolean;
  userId: Id;
}

export interface RehearsalResult {
  /** The practice ledger after the attempt. Rejected attempts are kept. */
  practiceBids: Bid[];
  outcome: ValidationOutcome;
  bid: Bid | null;
  integrityFlags: IntegrityFlag[];
}

/**
 * Submit a practice bid.
 *
 * Routed through the same `placeBid` the real auction uses, so the supplier
 * gets the real acceptance, the real rejection and the real wording of it.
 * The point of a rehearsal is to meet the minimum decrement here rather than
 * with the clock running, and a practice path with its own gentler validation
 * would hide exactly the thing worth learning.
 */
export function rehearseBid(attempt: RehearsalAttempt): RehearsalResult {
  const auction = rehearsalAuction(attempt.auction);
  const lot = rehearsalLot(attempt.lot, attempt.lot.closesAt);

  const result = placeBid(
    {
      auction,
      auctionLot: lot,
      lotCeiling: attempt.lotDetail?.ceilingPrice ?? null,
      lotFloor: attempt.lotDetail?.floorPrice ?? null,
      bidderId: attempt.bidderId,
      bidValue: attempt.bidValue,
      quantity: attempt.quantity,
      lineCount: attempt.lineCount,
      serverNow: attempt.serverNow,
      existingBids: attempt.practiceBids,
      costComponents: attempt.costComponents,
      confirmed: attempt.confirmed,
    },
    {
      source: 'PORTAL',
      userId: attempt.userId,
      clientTimestamp: null,
      // A practice bid is never evidence, so there is nothing to trace it to.
      ipHash: 'practice',
    },
  );

  return {
    practiceBids: result.bid === null
      ? attempt.practiceBids
      : [...attempt.practiceBids, markPractice(result.bid)],
    outcome: result.outcome,
    bid: result.bid === null ? null : markPractice(result.bid),
    integrityFlags: result.integrityFlags,
  };
}

/**
 * Stamp a practice bid so it is recognisable even if it somehow escapes its
 * ledger. Belt and braces: the array is the boundary, this is the label.
 */
function markPractice(bid: Bid): Bid {
  return { ...bid, id: `practice-${bid.id}`, source: 'PORTAL', ipHash: 'practice' };
}

/** True for a bid that came out of a rehearsal. Never ranked, never awarded. */
export const isPracticeBid = (bid: Bid): boolean => bid.id.startsWith('practice-');

/**
 * Everything the rehearsal produced, discarded.
 *
 * Called when the auction opens. A practice bid that survived into the live
 * ledger would be a bid nobody meant to place, ranked against bids people did.
 */
export function clearRehearsal(practiceBids: Bid[], auctionId: Id): Bid[] {
  return practiceBids.filter((bid) => bid.auctionId !== auctionId);
}

/** The practice standing, ranked by the same function the real auction uses. */
export function rehearsalStanding(
  auction: Auction, lotId: Id, practiceBids: Bid[],
) {
  return rankLot(practiceBids, lotId, auction.side, auction.antiGaming.tieBidPolicy);
}

// ---------------------------------------------------------------------------
// What the supplier is told before they start
// ---------------------------------------------------------------------------

export interface RehearsalBriefing {
  headline: string;
  /** The auction's own rules, in the supplier's words. */
  rules: string[];
  /** What to actually try, specific to this mechanism. */
  tryThis: string[];
  /** The promise that makes a practice run safe to use. */
  assurance: string;
}

/**
 * What to tell a supplier who has never seen this format.
 *
 * The rules come from `bidderRules`, which generates them from the live
 * configuration — the same generator the console and the lobby use, so the
 * three cannot drift and leave a bidder prepared for a different auction.
 * What this adds is the part a rule list cannot give: something to go and do,
 * chosen for the thing about this mechanism that surprises people.
 */
export function rehearsalBriefing(auction: Auction): RehearsalBriefing {
  const profile = MECHANISM_PROFILE[auction.mechanism];
  const improve = auction.side === 'BUY' ? 'lower' : 'higher';
  const base: RehearsalBriefing = {
    headline: `Practice run — ${profile.label}`,
    rules: bidderRules(auction),
    tryThis: [],
    assurance:
      'Nothing here is seen by the buyer or by the other bidders, and everything you '
      + 'type is discarded when the auction opens. You cannot get this wrong.',
  };

  switch (auction.mechanism) {
    case 'DUTCH':
      return {
        ...base,
        tryThis: [
          'Watch the clock move, then press Accept. That is the whole auction — the first acceptance ends it for everybody.',
          'Try accepting a second time. The lot has closed, and it will tell you so. In the real run there is no second chance.',
          'Decide now what price you would accept at. Once it passes, waiting costs you the lot.',
        ],
      };
    case 'JAPANESE':
      return {
        ...base,
        tryThis: [
          'Confirm that you are staying in at the current price, and watch your status change.',
          'Then let a round pass without confirming. You are out, permanently — that is what silence means in this format.',
          'There is no ranking to see. You only ever know whether you are still in.',
        ],
      };
    case 'TRAFFIC_LIGHT':
      return {
        ...base,
        tryThis: [
          'Place a bid well away from the buyer’s target and watch the light go red.',
          'Improve it until the light turns amber, then green. The colour is all you will ever be told.',
          'You will never see a competitor’s number or your rank — only your own colour.',
        ],
      };
    case 'INDEX_LINKED':
      return {
        ...base,
        tryThis: [
          'Quote a premium to the index rather than an absolute price — the figure you enter moves with the index.',
          'Try a discount as well, and read the settlement price it implies at today’s index level.',
          'Your competitors are quoting against the same index, so the comparison is of premiums, not prices.',
        ],
      };
    default:
      return {
        ...base,
        tryThis: [
          `Place a bid, then place a ${improve} one. You can bid as many times as you like while the auction is open.`,
          'Try a bid that only just improves on the lead. If it is inside the minimum improvement, it will be refused — find out here rather than later.',
          'Try a very large improvement. Beyond the buyer’s limit it is refused as a mistyped figure, which is what it usually is.',
        ],
      };
  }
}
