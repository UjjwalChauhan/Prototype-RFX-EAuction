/**
 * Turning a published auction into an auction that can actually be run.
 *
 * A journey that reaches AUCTION creates an ask — a row on the board with a
 * number, a window and a shortlist. That is not an auction. An auction is a
 * mechanism, a clock, a starting price per lot and a roster, and until those
 * exist there is nothing for the cockpit to control or the console to bid into.
 * This is the step that was missing: the ask was created and the auction never
 * was, so a Dutch auction published from a requisition appeared on the sourcing
 * board and nowhere in the E-Auction section.
 *
 * Almost none of it is a buyer's choice. A buyer chooses the mechanism and how
 * much the field is told; everything else — who holds the clock, whether the
 * rounds are discrete, how it closes, whether a proxy is even meaningful —
 * follows from the mechanism, and is read from `MECHANISM_PROFILE` rather than
 * asked for again. Two screens that disagree about what a Japanese auction is
 * would be a worse bug than the one this fixes.
 */
import { MECHANISM_PROFILE, profileOf } from './auctionMechanics';
import { DEFAULT_ANTI_GAMING } from './auctionEngine';
import { defaultParameters } from './auctionRules';
import type {
  Auction, AuctionLot, AuctionMechanism, AuctionStatus, ClosePolicy, DecrementType,
  FeedbackPolicy, Id, IdentityPolicy, Lot, LotStrategy, ServerMillis, Side,
} from './types';

/**
 * What a buyer actually chooses about an auction.
 *
 * Everything absent from here is derived. Adding a field to this interface is
 * a decision to put another question in front of a buyer, which is why it is
 * this short.
 */
export interface AuctionConfig {
  mechanism: AuctionMechanism;
  feedbackPolicy: FeedbackPolicy;
  identityPolicy?: IdentityPolicy;
  /** How much a bid must improve on the standing one. */
  minDecrement?: number;
  minDecrementType?: DecrementType;
  /** Honoured only where the mechanism closes on a clock at all. */
  softClose?: boolean;
  proxyBidding?: boolean;
  discloseTarget?: boolean;
  startingPriceSource?: string;
  targetPriceDerivation?: string | null;
}

/**
 * The feedback policy this mechanism can actually carry.
 *
 * A buyer who picks a sealed bid and leaves the rank feedback from the last
 * event they ran has asked for a sealed bid that is not sealed. Refusing the
 * publish would be defensible; silently publishing it is not. So the
 * contradiction is resolved here, in one place, and the caller is told what
 * changed — `mechanismIssues` says the same thing on the Setup pane before
 * publish, and this is the backstop for everything that does not go through it.
 */
export function resolveFeedbackPolicy(
  mechanism: AuctionMechanism, wanted: FeedbackPolicy,
): FeedbackPolicy {
  const profile = profileOf(mechanism);
  if (!profile.incompatibleFeedback.includes(wanted)) return wanted;
  // The mechanisms that reject a policy each have exactly one they mean: a
  // sealed format is blind, and a traffic-light auction shows a colour.
  return profile.incompatibleFeedback.includes('BLIND') ? 'TRAFFIC_LIGHT' : 'BLIND';
}

/**
 * How it ends.
 *
 * `softClose` is a buyer's answer to "should a late bid extend the clock",
 * which is a question only a clock-closed auction asks. A Dutch auction ends on
 * the first acceptance and a sealed bid at the reveal; extending either is not
 * a setting, it is a category error.
 */
export function resolveClosePolicy(
  mechanism: AuctionMechanism, softClose: boolean,
): ClosePolicy {
  const { defaultClosePolicy } = profileOf(mechanism);
  if (defaultClosePolicy !== 'SOFT_EXTENSION') return defaultClosePolicy;
  return softClose ? 'SOFT_EXTENSION' : 'HARD';
}

/** Portfolio solves across the basket; everything else runs its lots apart. */
export function resolveLotStrategy(mechanism: AuctionMechanism): LotStrategy {
  return mechanism === 'PORTFOLIO' ? 'PARALLEL' : 'INDEPENDENT';
}

/**
 * Where the auction stands against its own clock.
 *
 * Derived rather than stored, so an auction whose window opened while nobody
 * was looking is live when someone looks — the alternative is a scheduled
 * auction that stays scheduled because no screen was open to start it.
 */
export function statusAt(
  opensAt: ServerMillis | null, closesAt: ServerMillis | null, now: ServerMillis,
): AuctionStatus {
  if (opensAt === null) return 'CONFIGURED';
  if (now < opensAt) {
    // The last stretch before the start is the lobby: bidders can be in the
    // room, read the rules and see the clock, without being able to bid.
    return opensAt - now <= LOBBY_MS ? 'LOBBY_OPEN' : 'SCHEDULED';
  }
  if (closesAt !== null && now >= closesAt) return 'CLOSED';
  return 'LIVE';
}

/** How long before the start a bidder can be in the room. */
export const LOBBY_MS = 30 * 60 * 1000;

export interface AuctionLotInput {
  lot: Lot;
  /** The basket value of the lot. The opening price, before any front buffer. */
  startingPrice: number;
}

export interface BuiltAuction {
  auction: Auction;
  lots: AuctionLot[];
}

export interface BuildAuctionArgs {
  /** The auction ask, not the umbrella. Its window is the auction's window. */
  eventId: Id;
  side: Side;
  config: AuctionConfig;
  lots: AuctionLotInput[];
  opensAt: ServerMillis | null;
  closesAt: ServerMillis | null;
  now: ServerMillis;
  /** Deterministic in a test, unique in life. Defaults to the event's own id. */
  idPrefix?: Id;
  /**
   * The reference a person quotes. Required: an auction without one cannot be
   * named in an email, a dispute or a call, which is most of what a reference
   * is for. Callers allocate it from the numbers already taken.
   */
  auctionNumber: string;
}

/**
 * Build the auction an ask implies.
 *
 * The lots are the event's lots, in sequence. The first opens with the auction
 * and the rest wait, which is what `INDEPENDENT` means in practice — a
 * controller opens the next one when the one in front of it is done. A
 * mechanism that runs its lots together gets them all open at once.
 */
export function buildAuction(args: BuildAuctionArgs): BuiltAuction {
  const { eventId, side, config, opensAt, closesAt, now } = args;
  const profile = MECHANISM_PROFILE[config.mechanism];
  const auctionId = `${args.idPrefix ?? eventId}-auc`;
  const parallel = resolveLotStrategy(config.mechanism) !== 'INDEPENDENT';

  const auction: Auction = {
    id: auctionId,
    auctionNumber: args.auctionNumber,
    eventId,
    // Inherited from the event. A sell-side journey does not get to publish a
    // reverse auction because a default said so.
    side,
    mechanism: config.mechanism,
    clockOwner: profile.clockOwner,
    rounds: profile.rounds,
    feedbackPolicy: resolveFeedbackPolicy(config.mechanism, config.feedbackPolicy),
    identityPolicy: config.identityPolicy ?? 'MASKED',
    lotStrategy: resolveLotStrategy(config.mechanism),
    biddingLevel: 'LOT',
    closePolicy: resolveClosePolicy(config.mechanism, config.softClose ?? true),
    transformation: 'NONE',
    // Asked for, but only where the mechanism has a price to proxy.
    proxyBidding: (config.proxyBidding ?? false) && profile.proxySupported,
    status: statusAt(opensAt, closesAt, now),
    startsAt: opensAt,
    endsAt: closesAt,
    extensionsUsed: 0,
    discloseTarget: config.discloseTarget ?? false,
    trafficAmberBandPct: 5,
    antiGaming: {
      ...DEFAULT_ANTI_GAMING,
      minDecrementType: config.minDecrementType ?? 'PCT',
      minDecrement: config.minDecrement ?? DEFAULT_ANTI_GAMING.minDecrement,
    },
    // The settings that exist only for this mechanism, at their declared
    // defaults. A Dutch auction is published with a clock tick; an English one
    // is published without one, because it has no clock.
    parameters: defaultParameters(config.mechanism),
    startingPriceSource: config.startingPriceSource ?? 'Baseline from the requisition',
    targetPriceDerivation: config.targetPriceDerivation ?? null,
  };

  const live = auction.status === 'LIVE';
  const lots: AuctionLot[] = args.lots.map((entry, i) => ({
    id: `${auctionId}-al-${i + 1}`,
    auctionId,
    lotId: entry.lot.id,
    status: live && (parallel || i === 0) ? 'LOT_OPEN' : 'LOT_PENDING',
    startingPrice: entry.startingPrice,
    opensAt,
    closesAt,
  }));

  return { auction, lots };
}
