/**
 * What each auction mechanism actually *is*.
 *
 * The mechanism name is a label. The behaviour is a set of orthogonal
 * attributes — who owns the clock, how a bid arrives, whether a ranking exists
 * while it runs, whether a bidder can be eliminated, what the controller may
 * do next. That was already the design in `types.ts`; this module is where the
 * consequences of those attributes live, in one place, so the buyer cockpit and
 * the supplier console cannot disagree about the same event.
 *
 * They disagreeing is the failure this module exists to prevent. A Japanese
 * auction where the controller sees "advance round" and the bidder sees a free
 * price box is not a cosmetic inconsistency — it is a bidder eliminated because
 * the screen did not tell them a round was running.
 *
 * Nothing here is React and nothing here does IO. Both applications read these
 * functions; the projection rules in `feedbackPolicy.ts` still decide what a
 * bidder is *permitted* to see, and this module never widens them.
 */
import { deriveDirection, directionLabel, improvementLabel, isBetter } from './comparator';
import type {
  Auction, AuctionControlEvent, AuctionEventKind, AuctionMechanism, AuctionStatus, ClockOwner,
  ClosePolicy, FeedbackPolicy, Id, Rounds, ServerMillis, Side,
} from './types';

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/**
 * How a bid reaches the server.
 *
 * This is the single most consequential attribute for the supplier console:
 * it decides whether there is a number to type at all, and it is why a console
 * built for English is wrong for four of the ten mechanisms.
 */
export type BidEntryMode =
  /** A price, whenever the bidder likes. English, Index-linked, Traffic light, Portfolio. */
  | 'FREE_FORM'
  /** One button: take the clock's current price. Dutch. */
  | 'ACCEPT_CLOCK'
  /** One button per round: stay in at this price, or leave for good. Japanese. */
  | 'STAY_IN'
  /** A single sealed submission, no live feedback. Sealed bid, Vickrey. */
  | 'ONE_SHOT'
  /** A price, but only while it is your turn. Rank compression. */
  | 'TURN_BASED'
  /** Price plus the other scored attributes. Multi-attribute. */
  | 'MULTI_FIELD';

export interface MechanismProfile {
  mechanism: AuctionMechanism;
  label: string;
  /** One line for a card, correct for this side. */
  summary: (side: Side) => string;
  bidEntry: BidEntryMode;
  clockOwner: ClockOwner;
  rounds: Rounds;
  defaultClosePolicy: ClosePolicy;
  /** Is there a ranking at all while it runs? Sealed formats have none. */
  liveRanking: boolean;
  /** Can a bidder be put out of the auction permanently before it closes? */
  elimination: boolean;
  /** Does the controller drive progress — advance a round, hold a clock, call a turn? */
  buyerDrivesProgress: boolean;
  proxySupported: boolean;
  /**
   * Feedback policies that contradict the mechanism.
   *
   * A sealed bid with full-price feedback is not a strict configuration; it is
   * a sealed bid that is not sealed.
   */
  incompatibleFeedback: FeedbackPolicy[];
  /** Vickrey ships off. Present so the boundary is visible, not hidden. */
  enabledByDefault: boolean;
}

const ALL_FEEDBACK: FeedbackPolicy[] = [
  'FULL_PRICE', 'BEST_PRICE', 'RANK_ONLY', 'RANK_GAP', 'TRAFFIC_LIGHT', 'BLIND',
];

/** Everything except the ones named. */
const allBut = (...keep: FeedbackPolicy[]) => ALL_FEEDBACK.filter((p) => !keep.includes(p));

export const MECHANISM_PROFILE: Record<AuctionMechanism, MechanismProfile> = {
  ENGLISH: {
    mechanism: 'ENGLISH', label: 'English',
    summary: (side) => `Open bidding until nobody improves — ${directionLabel(side)}.`,
    bidEntry: 'FREE_FORM', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'SOFT_EXTENSION',
    liveRanking: true, elimination: false, buyerDrivesProgress: false,
    proxySupported: true, incompatibleFeedback: [], enabledByDefault: true,
  },
  JAPANESE: {
    mechanism: 'JAPANESE', label: 'Japanese',
    summary: (side) =>
      `A clock moves in fixed steps ${side === 'BUY' ? 'down' : 'up'}; each round a bidder confirms they are staying in, or leaves for good.`,
    bidEntry: 'STAY_IN', clockOwner: 'SYSTEM', rounds: 'DISCRETE',
    defaultClosePolicy: 'LAST_STANDING',
    liveRanking: false, elimination: true, buyerDrivesProgress: true,
    // There is no price to proxy — the clock sets it and the bidder only stays
    // or leaves. A proxy here would be an instruction to leave at a price,
    // which is a different product.
    proxySupported: false,
    incompatibleFeedback: ['FULL_PRICE', 'RANK_ONLY', 'RANK_GAP'],
    enabledByDefault: true,
  },
  DUTCH: {
    mechanism: 'DUTCH', label: 'Dutch',
    summary: (side) =>
      `A clock ${side === 'BUY' ? 'rises' : 'falls'} from the opening price until the first bidder accepts. That acceptance ends it.`,
    bidEntry: 'ACCEPT_CLOCK', clockOwner: 'SYSTEM', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'FIRST_ACCEPT',
    liveRanking: false, elimination: false, buyerDrivesProgress: true,
    proxySupported: false,
    incompatibleFeedback: allBut('BLIND'),
    enabledByDefault: true,
  },
  SEALED_BID: {
    mechanism: 'SEALED_BID', label: 'Sealed bid',
    summary: () => 'One submission each, nothing revealed until the reveal time.',
    bidEntry: 'ONE_SHOT', clockOwner: 'BIDDER', rounds: 'SINGLE',
    defaultClosePolicy: 'REVEAL_AT_TIME',
    liveRanking: false, elimination: false, buyerDrivesProgress: true,
    proxySupported: false,
    incompatibleFeedback: allBut('BLIND'),
    enabledByDefault: true,
  },
  RANK_COMPRESSION: {
    mechanism: 'RANK_COMPRESSION', label: 'Rank compression',
    summary: (side) =>
      `Bidders improve in turn, worst position first, until the field stops moving — ${directionLabel(side)}.`,
    bidEntry: 'TURN_BASED', clockOwner: 'BIDDER', rounds: 'DISCRETE',
    defaultClosePolicy: 'LAST_STANDING',
    liveRanking: true, elimination: false, buyerDrivesProgress: true,
    proxySupported: false,
    incompatibleFeedback: ['FULL_PRICE'],
    enabledByDefault: true,
  },
  MULTI_ATTRIBUTE: {
    mechanism: 'MULTI_ATTRIBUTE', label: 'Multi-attribute',
    summary: () =>
      'Bidders improve price and the other scored terms together; a composite score decides the standing.',
    bidEntry: 'MULTI_FIELD', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'SOFT_EXTENSION',
    liveRanking: true, elimination: false, buyerDrivesProgress: false,
    proxySupported: false,
    // Rank against a composite score is meaningful; a bare price is not.
    incompatibleFeedback: ['FULL_PRICE', 'BEST_PRICE'],
    enabledByDefault: true,
  },
  PORTFOLIO: {
    mechanism: 'PORTFOLIO', label: 'Portfolio',
    summary: () =>
      'Bidders price bundles as well as lots; the winning combination is solved across the whole basket.',
    bidEntry: 'FREE_FORM', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'SOFT_EXTENSION',
    liveRanking: true, elimination: false, buyerDrivesProgress: false,
    proxySupported: true,
    // The standing is a solved combination, so a single "best price" misleads.
    incompatibleFeedback: ['FULL_PRICE', 'BEST_PRICE'],
    enabledByDefault: true,
  },
  INDEX_LINKED: {
    mechanism: 'INDEX_LINKED', label: 'Index-linked',
    summary: () =>
      'Bidders quote a premium or discount to a published index rather than an absolute price.',
    bidEntry: 'FREE_FORM', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'SOFT_EXTENSION',
    liveRanking: true, elimination: false, buyerDrivesProgress: false,
    proxySupported: true, incompatibleFeedback: [], enabledByDefault: true,
  },
  TRAFFIC_LIGHT: {
    mechanism: 'TRAFFIC_LIGHT', label: 'Traffic light',
    summary: () =>
      'Open bidding, but a bidder sees only a colour against the buyer’s target — never a competitor’s number.',
    bidEntry: 'FREE_FORM', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    defaultClosePolicy: 'SOFT_EXTENSION',
    liveRanking: true, elimination: false, buyerDrivesProgress: false,
    proxySupported: true,
    // The mechanism *is* the feedback policy. Anything else contradicts it.
    incompatibleFeedback: allBut('TRAFFIC_LIGHT'),
    enabledByDefault: true,
  },
  VICKREY: {
    mechanism: 'VICKREY', label: 'Vickrey',
    summary: () =>
      'One sealed submission each; the best bidder wins but is awarded at the second-best price.',
    bidEntry: 'ONE_SHOT', clockOwner: 'BIDDER', rounds: 'SINGLE',
    defaultClosePolicy: 'REVEAL_AT_TIME',
    liveRanking: false, elimination: false, buyerDrivesProgress: true,
    proxySupported: false,
    incompatibleFeedback: allBut('BLIND'),
    enabledByDefault: false,
  },
};

export const MECHANISMS = Object.keys(MECHANISM_PROFILE) as AuctionMechanism[];

export const profileOf = (mechanism: AuctionMechanism): MechanismProfile =>
  MECHANISM_PROFILE[mechanism];

/** Whether the bidder is asked for a number at all. */
export const asksForAPrice = (mechanism: AuctionMechanism): boolean =>
  ['FREE_FORM', 'TURN_BASED', 'MULTI_FIELD', 'ONE_SHOT'].includes(
    MECHANISM_PROFILE[mechanism].bidEntry,
  );

// ---------------------------------------------------------------------------
// How it works, and how a bidder reads it
// ---------------------------------------------------------------------------

/**
 * The controller's description of the event *as configured*.
 *
 * Regenerated from the configuration rather than written once, so switching
 * from best-price to blind changes the text — help that does not track the
 * settings is worse than none, because it is believed.
 */
export function howItWorks(auction: Auction): string[] {
  const profile = MECHANISM_PROFILE[auction.mechanism];
  const side = auction.side;
  const lines: string[] = [profile.summary(side)];
  const direction = deriveDirection(side, auction.clockOwner);

  switch (auction.mechanism) {
    case 'JAPANESE':
      lines.push(
        `The clock starts at the opening price and steps by ${decrementLabel(auction)} each round. A bidder who does not confirm is out, permanently, and cannot return.`,
        'The last bidder standing wins at the price of the final round they accepted.',
        'Every exit price is recorded. The drop-out ladder that produces is the format’s real value — it shows where the market’s costs actually sit.',
      );
      break;
    case 'DUTCH':
      lines.push(
        `The clock moves ${side === 'BUY' ? 'up' : 'down'} by ${decrementLabel(auction)} a tick until someone accepts.`,
        'The first acceptance ends the auction for everybody. There is no second chance and no ranking.',
        'Nobody is told anything about anybody else, because there is nothing to tell until it is over.',
      );
      break;
    case 'SEALED_BID':
      lines.push(
        'Each bidder submits once. Nothing is visible to anyone — including the controller — until the reveal.',
        'Opening the envelopes is a deliberate action, logged with the actor, and cannot be undone.',
      );
      break;
    case 'VICKREY':
      lines.push(
        'Each bidder submits once, sealed. The best bid wins and is awarded at the second-best price.',
        'Bidders are told the rule before they bid; a second-price award that comes as a surprise is a dispute.',
      );
      break;
    case 'RANK_COMPRESSION':
      lines.push(
        'Bidders act in turn, the worst position first, each given a turn timer.',
        'A missed turn is the format’s main failure, so the turn is announced loudly and a skipped turn is recorded rather than silently passed.',
        'It ends when a full round passes with nobody improving.',
      );
      break;
    case 'MULTI_ATTRIBUTE':
      lines.push(
        'Price is one input. Lead time, warranty and payment terms score alongside it, and the composite decides the standing.',
        'The weights are published to bidders before the event. Undisclosed weights invite disputes and are not permitted here.',
      );
      break;
    case 'INDEX_LINKED':
      lines.push(
        'Bidders quote a premium or discount to the named index. The absolute price is computed and shown, so nobody bids on arithmetic they cannot check.',
        'The index value, its source and its date travel with every bid.',
      );
      break;
    case 'PORTFOLIO':
      lines.push(
        'Bids arrive on individual lots and on bundles. The winning combination is solved across the basket, so the cheapest set of bids is not always the winning one.',
      );
      break;
    case 'TRAFFIC_LIGHT':
      lines.push(
        'A bidder sees a colour against your target and nothing else — no rank, no competitor price, not even how many are ahead.',
      );
      break;
    default:
      lines.push(
        `Bids ${direction === 'DESCENDING' ? 'descend' : 'ascend'}; each must improve on the leading position by ${decrementLabel(auction)}.`,
      );
  }

  lines.push(closeLine(auction));
  if (auction.transformation !== 'NONE') {
    lines.push(
      'Bid transformation is active. Ranking reads the transformed value; every bidder sees and bids their own untransformed number, and is never told an adjustment exists.',
    );
  }
  return lines;
}

function decrementLabel(auction: Auction): string {
  const { minDecrement, minDecrementType } = auction.antiGaming;
  return minDecrementType === 'PCT' ? `${minDecrement}%` : `${minDecrement}`;
}

function closeLine(auction: Auction): string {
  switch (auction.closePolicy) {
    case 'SOFT_EXTENSION':
      return `It closes at the scheduled time, except that a bid in the final ${auction.antiGaming.softCloseTriggerSec} seconds extends it by ${auction.antiGaming.softCloseExtensionSec} seconds — ${auction.antiGaming.maxExtensions === null ? 'without limit' : `up to ${auction.antiGaming.maxExtensions} times`}.`;
    case 'FIRST_ACCEPT':
      return 'It closes the moment one bidder accepts.';
    case 'LAST_STANDING':
      return 'It closes when one bidder is left, or when a round passes with nobody moving.';
    case 'REVEAL_AT_TIME':
      return 'It closes at the scheduled time and everything is revealed together.';
    default:
      return 'It closes at the scheduled time. A bid one second late is not a bid.';
  }
}

/**
 * The same event in the supplier's words.
 *
 * The lobby shows this, the console shows this, and the practice run runs
 * against it — one generator, so the three cannot drift apart and leave a
 * bidder prepared for an auction that is not the one they joined.
 */
export function bidderRules(auction: Auction): string[] {
  const side = auction.side;
  const improve = improvementLabel(side);
  const rules: string[] = [];

  switch (MECHANISM_PROFILE[auction.mechanism].bidEntry) {
    case 'STAY_IN':
      rules.push(
        `The price moves on a clock. Each round you confirm you are staying in at the price shown, or you leave.`,
        'If you do not confirm before the round timer ends, you are out of this auction for good. You cannot rejoin.',
        'You will not be told how many others are still in.',
        'The last company still in wins, at the last price they accepted.',
      );
      break;
    case 'ACCEPT_CLOCK':
      rules.push(
        `The price is on a clock and moves ${side === 'BUY' ? 'up' : 'down'} until someone accepts it.`,
        'The first company to accept wins immediately and the auction ends for everyone.',
        'There is one button and no price to type. Waiting gets you a better price and risks losing it entirely.',
      );
      break;
    case 'ONE_SHOT':
      rules.push(
        'You submit one price. You cannot change it, and you cannot submit twice.',
        'Nothing is revealed — not your position, not anyone else’s price — until the reveal time.',
        auction.mechanism === 'VICKREY'
          ? 'The best price wins, but the winner pays the second-best price. Bid the most you are genuinely willing to accept.'
          : 'The best price at the reveal wins.',
      );
      break;
    case 'TURN_BASED':
      rules.push(
        'You bid in turn. When it is your turn you have a timer, and outside your turn the bid box is closed.',
        `When your turn comes you may ${improve} your price or pass.`,
        'If you pass, you stay in the auction at your current price — passing is not leaving.',
      );
      break;
    case 'MULTI_FIELD':
      rules.push(
        'You improve price and the other terms together — lead time, warranty, payment terms.',
        'Each carries a published weight. Improving lead time can beat cutting price, and the score updates as you type so you can see which.',
      );
      break;
    default:
      rules.push(
        `You will bid ${side === 'BUY' ? 'downward' : 'upward'}. Each new bid must ${improve} your last by at least ${decrementLabel(auction)}.`,
      );
  }

  rules.push(feedbackLine(auction.feedbackPolicy));
  rules.push(closeLine(auction).replace(/^It closes/, 'The auction closes'));
  if (MECHANISM_PROFILE[auction.mechanism].proxySupported && auction.proxyBidding) {
    rules.push(
      'You can set a limit and let the system bid for you in the smallest steps needed. It never goes past your limit.',
    );
  }
  return rules;
}

function feedbackLine(policy: FeedbackPolicy): string {
  switch (policy) {
    case 'FULL_PRICE': return 'You will see every price in the room, without company names.';
    case 'BEST_PRICE': return 'You will see the best price in the room, but not who placed it.';
    case 'RANK_ONLY': return 'You will see your position — not anyone’s price.';
    case 'RANK_GAP': return 'You will see your position and how far behind the lead you are, as a percentage.';
    case 'TRAFFIC_LIGHT': return 'You will see a colour telling you how your price compares to what the buyer is looking for. You will not see other companies at all.';
    case 'BLIND': return 'You will see your own bids and nothing else.';
  }
}

// ---------------------------------------------------------------------------
// What the controller may do, and when
// ---------------------------------------------------------------------------

export type AuctionActionKey =
  // Universal
  | 'OPEN' | 'PAUSE' | 'RESUME' | 'EXTEND' | 'FORCE_CLOSE' | 'ABORT' | 'BROADCAST'
  // Mechanism-specific
  | 'ADVANCE_ROUND' | 'HOLD_CLOCK' | 'RESUME_CLOCK' | 'OPEN_ENVELOPES'
  | 'CALL_TURN' | 'SKIP_TURN' | 'OPEN_NEXT_LOT';

export interface ActionSpec {
  key: AuctionActionKey;
  label: string;
  /** What it does, in the controller's terms. */
  hint: string;
  /** Destructive enough to need the word typed out. */
  typedConfirmation: boolean;
  /** A reason is written to the audit log before the action takes effect. */
  reasonRequired: boolean;
  tone: 'neutral' | 'primary' | 'danger';
}

const UNIVERSAL: Record<string, ActionSpec> = {
  OPEN: {
    key: 'OPEN', label: 'Open the auction',
    hint: 'Starts the room and opens the first lot. Every invited bidder can bid from this moment.',
    typedConfirmation: false, reasonRequired: true, tone: 'primary',
  },
  BROADCAST: {
    key: 'BROADCAST', label: 'Message bidders',
    hint: 'A note to everyone in the room, or to one bidder. Logged either way.',
    typedConfirmation: false, reasonRequired: false, tone: 'neutral',
  },
  EXTEND: {
    key: 'EXTEND', label: 'Extend',
    hint: 'Adds time to the open lot. Everyone is notified.',
    typedConfirmation: false, reasonRequired: true, tone: 'neutral',
  },
  PAUSE: {
    key: 'PAUSE', label: 'Pause',
    hint: 'Freezes the clock and rejects bids at the server, not merely in the screen.',
    typedConfirmation: false, reasonRequired: true, tone: 'neutral',
  },
  RESUME: {
    key: 'RESUME', label: 'Resume',
    hint: 'Bidding reopens and every participant is told.',
    typedConfirmation: false, reasonRequired: true, tone: 'primary',
  },
  FORCE_CLOSE: {
    key: 'FORCE_CLOSE', label: 'Close now',
    hint: 'Ends bidding immediately. The standing at this moment becomes the result.',
    typedConfirmation: true, reasonRequired: true, tone: 'danger',
  },
  ABORT: {
    key: 'ABORT', label: 'Abort',
    hint: 'Voids the auction. No result, no winner, and every bid is struck from consideration.',
    typedConfirmation: true, reasonRequired: true, tone: 'danger',
  },
};

const MECHANISM_ACTIONS: Record<string, ActionSpec> = {
  ADVANCE_ROUND: {
    key: 'ADVANCE_ROUND', label: 'Advance the round',
    hint: 'Moves the clock one step and opens a new confirmation window. Anyone who did not confirm the last round is out.',
    typedConfirmation: false, reasonRequired: false, tone: 'primary',
  },
  HOLD_CLOCK: {
    key: 'HOLD_CLOCK', label: 'Hold the clock',
    hint: 'Stops the price moving without ending the auction. Acceptances are still taken.',
    typedConfirmation: false, reasonRequired: true, tone: 'neutral',
  },
  RESUME_CLOCK: {
    key: 'RESUME_CLOCK', label: 'Restart the clock',
    hint: 'The price resumes moving from where it was held.',
    typedConfirmation: false, reasonRequired: true, tone: 'primary',
  },
  OPEN_ENVELOPES: {
    key: 'OPEN_ENVELOPES', label: 'Open the envelopes',
    hint: 'Reveals every submission at once. Irreversible, and logged with your name against the moment.',
    typedConfirmation: true, reasonRequired: true, tone: 'primary',
  },
  CALL_TURN: {
    key: 'CALL_TURN', label: 'Call the next turn',
    hint: 'Hands the bid box to the next bidder in order and starts their turn timer.',
    typedConfirmation: false, reasonRequired: false, tone: 'primary',
  },
  SKIP_TURN: {
    key: 'SKIP_TURN', label: 'Skip this turn',
    hint: 'Records the turn as passed and moves on. The bidder keeps their current price.',
    typedConfirmation: false, reasonRequired: true, tone: 'neutral',
  },
  OPEN_NEXT_LOT: {
    key: 'OPEN_NEXT_LOT', label: 'Open the next lot',
    hint: 'Starts the next lot in the sequence.',
    typedConfirmation: false, reasonRequired: false, tone: 'primary',
  },
};

export interface ActionContext {
  /** Serial strategy with a lot still waiting. */
  hasPendingLot: boolean;
  /** Sealed formats: whether the reveal has already happened. */
  revealed?: boolean;
  /** Dutch: whether the clock is currently held. */
  clockHeld?: boolean;
  /** Japanese/rank-compression: whether a round or turn is currently open. */
  windowOpen?: boolean;
}

/**
 * The actions this controller may take right now.
 *
 * Driven by mechanism and status together, because the same button means
 * different things — "extend" adds minutes to an English auction and is
 * meaningless in a Dutch one, where the clock is the whole event.
 */
export function availableActions(
  auction: Auction,
  ctx: ActionContext = { hasPendingLot: false },
): ActionSpec[] {
  const { mechanism, status } = auction;
  const profile = MECHANISM_PROFILE[mechanism];
  const running = status === 'LIVE' || status === 'EXTENDED';
  const actions: ActionSpec[] = [];

  /**
   * Before it runs there is exactly one thing to do: start it.
   *
   * Offered from the moment it is configured rather than only once the window
   * arrives — the window is a plan, and a controller who is ready early should
   * not have to wait for the clock to agree with them.
   */
  if (status === 'CONFIGURED' || status === 'SCHEDULED' || status === 'LOBBY_OPEN') {
    return [UNIVERSAL.OPEN, UNIVERSAL.BROADCAST, UNIVERSAL.ABORT];
  }

  if (!running && status !== 'PAUSED') return actions;

  if (status === 'PAUSED') {
    actions.push(UNIVERSAL.RESUME, UNIVERSAL.BROADCAST, UNIVERSAL.ABORT);
    return actions;
  }

  // Progress first — it is what the controller is here to do.
  switch (profile.bidEntry) {
    case 'STAY_IN':
      /**
       * Always offered while it runs.
       *
       * Gating it on everyone having confirmed was backwards: advancing is
       * precisely how a controller ends a round somebody is sitting out, and
       * withholding it leaves one silent bidder able to stall the auction
       * indefinitely. The consequence — who this eliminates — belongs in the
       * confirmation, not in hiding the button.
       */
      actions.push(MECHANISM_ACTIONS.ADVANCE_ROUND);
      break;
    case 'ACCEPT_CLOCK':
      actions.push(ctx.clockHeld ? MECHANISM_ACTIONS.RESUME_CLOCK : MECHANISM_ACTIONS.HOLD_CLOCK);
      break;
    case 'ONE_SHOT':
      if (!ctx.revealed) actions.push(MECHANISM_ACTIONS.OPEN_ENVELOPES);
      break;
    case 'TURN_BASED':
      actions.push(MECHANISM_ACTIONS.CALL_TURN);
      if (ctx.windowOpen) actions.push(MECHANISM_ACTIONS.SKIP_TURN);
      break;
    default:
      break;
  }

  if (ctx.hasPendingLot && auction.lotStrategy === 'SERIAL') {
    actions.push(MECHANISM_ACTIONS.OPEN_NEXT_LOT);
  }

  actions.push(UNIVERSAL.BROADCAST);

  // A Dutch auction has no time to extend — the clock *is* the auction — and a
  // sealed bid extends its deadline through the timeline, not from here.
  if (profile.bidEntry !== 'ACCEPT_CLOCK') actions.push(UNIVERSAL.EXTEND);

  actions.push(UNIVERSAL.PAUSE, UNIVERSAL.FORCE_CLOSE, UNIVERSAL.ABORT);
  return actions;
}

// ---------------------------------------------------------------------------
// Japanese — the clock, the standing field, and the drop-out ladder
// ---------------------------------------------------------------------------

export interface JapaneseExit {
  bidderId: Id;
  /** The last price they accepted before leaving. */
  price: number;
  round: number;
  at: ServerMillis;
}

export interface JapaneseState {
  round: number;
  /** The price on the clock for the round now open. */
  clockPrice: number;
  /** Bidders who have confirmed the current round. */
  confirmed: Id[];
  /** Still in, whether or not they have confirmed this round yet. */
  standing: Id[];
  exited: JapaneseExit[];
  /** True once only one bidder remains. */
  settled: boolean;
  winnerId: Id | null;
}

/**
 * Where the clock stands after `round` steps.
 *
 * A buy-side Japanese auction walks the price down, so each round is worse for
 * the bidder and better for the buyer; sell-side walks it up. The step reads
 * from the same decrement configuration the other mechanisms use.
 */
export function japaneseClockPrice(auction: Auction, startingPrice: number, round: number): number {
  const { minDecrement, minDecrementType } = auction.antiGaming;
  const steps = Math.max(0, round - 1);
  if (minDecrementType === 'PCT') {
    const factor = auction.side === 'BUY' ? 1 - minDecrement / 100 : 1 + minDecrement / 100;
    return startingPrice * factor ** steps;
  }
  return auction.side === 'BUY'
    ? startingPrice - minDecrement * steps
    : startingPrice + minDecrement * steps;
}

/**
 * The drop-out ladder — every bidder's exit price, in the order they left.
 *
 * This is the format's main product. An English auction tells you only what
 * the last two bidders would do; a Japanese auction tells you where every
 * supplier's floor sits, which is a map of the market's cost distribution.
 */
/**
 * When the round or turn now open began.
 *
 * The last time the controller advanced it, or the moment the auction opened
 * if they have not yet. Read off the control log rather than stored, for the
 * same reason the round number is: the log is what a bidder eliminated by a
 * clock will ask to see.
 */
export function windowOpenedAt(
  auction: Auction, controlEvents: AuctionControlEvent[], kind: AuctionEventKind,
): ServerMillis {
  const matching = controlEvents.filter((event) => event.kind === kind);
  return matching.length > 0
    ? Math.max(...matching.map((event) => event.at))
    : auction.startsAt ?? 0;
}

/**
 * The most recent control event of any of these kinds.
 *
 * Two of these can land in the same millisecond — a controller closing the
 * practice run and reopening it, a test doing both in one tick — and sorting
 * on `at` alone then returns whichever the sort happened to leave last. The
 * ledger is stored newest-first (`controllerAction` unshifts), so array
 * position is the tiebreak that actually knows the answer.
 *
 * Returns null when none of the kinds has ever happened.
 */
export function latestControlEvent(
  controlEvents: AuctionControlEvent[], kinds: AuctionEventKind[],
): AuctionControlEvent | null {
  let best: { event: AuctionControlEvent; index: number } | null = null;
  controlEvents.forEach((event, index) => {
    if (!kinds.includes(event.kind)) return;
    if (best === null || event.at > best.event.at
        || (event.at === best.event.at && index < best.index)) {
      best = { event, index };
    }
  });
  return best === null ? null : (best as { event: AuctionControlEvent }).event;
}

export function dropOutLadder(state: JapaneseState): (JapaneseExit & { position: number })[] {
  return [...state.exited]
    .sort((a, b) => a.round - b.round || a.at - b.at)
    .map((exit, i) => ({ ...exit, position: i + 1 }));
}

/** A bidder who did not confirm before the window closed is out, for good. */
export function settleJapaneseRound(state: JapaneseState, at: ServerMillis): JapaneseState {
  const missed = state.standing.filter((id) => !state.confirmed.includes(id));
  const exited = [
    ...state.exited,
    ...missed.map((bidderId) => ({ bidderId, price: state.clockPrice, round: state.round, at })),
  ];
  const standing = state.standing.filter((id) => state.confirmed.includes(id));
  return {
    ...state,
    standing,
    exited,
    confirmed: [],
    settled: standing.length <= 1,
    winnerId: standing.length === 1 ? standing[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Dutch — a price that moves on its own
// ---------------------------------------------------------------------------

export interface DutchClock {
  price: number;
  /** Ticks elapsed since the clock started. */
  tick: number;
  /** True once the price has reached the buyer's limit and can move no further. */
  atLimit: boolean;
  nextTickAt: ServerMillis;
}

/**
 * Where a Dutch clock stands at `now`.
 *
 * Computed from the start time rather than counted, so a bidder who joins late
 * or reconnects sees the same price as everyone else. A clock that is counted
 * drifts, and a drifting clock in a first-acceptance format decides the winner.
 */
export function dutchClock(
  auction: Auction,
  opening: number,
  limit: number,
  tickSeconds: number,
  now: ServerMillis,
): DutchClock {
  const startedAt = auction.startsAt ?? now;
  const elapsed = Math.max(0, now - startedAt);
  const tick = Math.floor(elapsed / (tickSeconds * 1000));
  const { minDecrement, minDecrementType } = auction.antiGaming;

  const step = minDecrementType === 'PCT' ? (opening * minDecrement) / 100 : minDecrement;
  // Buy-side Dutch walks the price up from a low opening until someone accepts.
  const raw = auction.side === 'BUY' ? opening + step * tick : opening - step * tick;
  const capped = auction.side === 'BUY' ? Math.min(raw, limit) : Math.max(raw, limit);

  return {
    price: capped,
    tick,
    atLimit: capped === limit,
    nextTickAt: startedAt + (tick + 1) * tickSeconds * 1000,
  };
}

// ---------------------------------------------------------------------------
// Sealed formats — nothing exists until the reveal
// ---------------------------------------------------------------------------

export interface SealedState {
  /** How many invited bidders have submitted. A count is not a disclosure. */
  submitted: number;
  invited: number;
  revealAt: ServerMillis | null;
  revealed: boolean;
  /** Who has submitted — the controller may see this; a bidder never does. */
  submittedBy: Id[];
}

/**
 * The second price, for a Vickrey award.
 *
 * Returned separately from the winner so a screen cannot accidentally show the
 * winning bid as the award value — in this format they are different numbers,
 * and confusing them overpays or underpays by the spread.
 */
export function vickreyAward(
  values: { bidderId: Id; value: number }[], side: Side,
): { winnerId: Id; winningBid: number; awardPrice: number } | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => (isBetter(a.value, b.value, side) ? -1 : 1));
  const winner = ordered[0];
  const second = ordered[1];
  return {
    winnerId: winner.bidderId,
    winningBid: winner.value,
    // A single bidder is awarded at their own price; there is no second to pay.
    awardPrice: second ? second.value : winner.value,
  };
}

// ---------------------------------------------------------------------------
// Rank compression — turns
// ---------------------------------------------------------------------------

export interface TurnState {
  /** Bid order, worst position first — the point of the format. */
  order: Id[];
  activeBidderId: Id | null;
  turnEndsAt: ServerMillis | null;
  round: number;
  /** Bidders who passed this round. A pass is not an exit. */
  passed: Id[];
}

/**
 * Turn order: worst position first.
 *
 * The bidder with most ground to make up moves first, which is what compresses
 * the field rather than letting the leader defend a small margin all event.
 */
export function turnOrder(standing: { bidderId: Id; transformedValue: number }[], side: Side): Id[] {
  return [...standing]
    .sort((a, b) => (isBetter(a.transformedValue, b.transformedValue, side) ? 1 : -1))
    .map((row) => row.bidderId);
}

export function nextTurn(state: TurnState): Id | null {
  if (state.order.length === 0) return null;
  if (state.activeBidderId === null) return state.order[0];
  const at = state.order.indexOf(state.activeBidderId);
  return at === -1 || at + 1 >= state.order.length ? null : state.order[at + 1];
}

// ---------------------------------------------------------------------------
// Multi-attribute — a composite, and what moves it
// ---------------------------------------------------------------------------

export interface ScoredAttribute {
  key: string;
  label: string;
  unit: string;
  /** Relative, normalised for display like every other weight in the product. */
  weight: number;
  /** Which way is better for the buyer. Price is handled by `side`. */
  betterIs: 'HIGHER' | 'LOWER';
  /** The range the score is computed across. */
  best: number;
  worst: number;
}

export interface AttributeContribution {
  key: string;
  label: string;
  weight: number;
  /** 0–100 on this attribute alone. */
  score: number;
  /** Share of the composite this attribute actually contributed. */
  contribution: number;
}

export interface CompositeScore {
  total: number;
  contributions: AttributeContribution[];
}

/**
 * The composite a multi-attribute auction ranks on.
 *
 * Returned with its working shown, because the bidder console has to answer
 * "would a week off my lead time beat another 2% off my price?" while the
 * bidder is typing — and a single number cannot answer it.
 */
export function compositeScore(
  values: Record<string, number>, attributes: ScoredAttribute[],
): CompositeScore {
  const totalWeight = attributes.reduce((sum, a) => sum + Math.max(0, a.weight), 0);
  const contributions = attributes.map((attribute) => {
    const value = values[attribute.key];
    const span = attribute.best - attribute.worst;
    let score = 0;
    if (value !== undefined && span !== 0) {
      score = ((value - attribute.worst) / span) * 100;
    } else if (value !== undefined) {
      score = 100;
    }
    const clamped = Math.max(0, Math.min(100, score));
    const weight = totalWeight === 0 ? 0 : (Math.max(0, attribute.weight) / totalWeight) * 100;
    return {
      key: attribute.key,
      label: attribute.label,
      weight,
      score: clamped,
      contribution: (weight / 100) * clamped,
    };
  });
  return {
    total: contributions.reduce((sum, c) => sum + c.contribution, 0),
    contributions,
  };
}

// ---------------------------------------------------------------------------
// Index-linked — a quote is a premium, not a price
// ---------------------------------------------------------------------------

export interface IndexLink {
  name: string;
  source: string;
  value: number;
  asOf: ServerMillis;
  offsetType: 'PCT' | 'ABSOLUTE';
}

/** The absolute price a premium or discount resolves to, at today's index. */
export function indexedPrice(link: IndexLink, offset: number): number {
  return link.offsetType === 'PCT' ? link.value * (1 + offset / 100) : link.value + offset;
}

// ---------------------------------------------------------------------------
// Configuration that contradicts itself
// ---------------------------------------------------------------------------

export interface MechanismIssue {
  field: string;
  message: string;
  blocking: boolean;
}

/**
 * Settings the mechanism cannot honour.
 *
 * Kept separate from `checkCanStart`, which asks whether this auction is ready
 * to run. This asks a different question: whether what has been configured
 * describes an auction that can exist at all.
 */
export function mechanismIssues(auction: Auction): MechanismIssue[] {
  const profile = MECHANISM_PROFILE[auction.mechanism];
  const issues: MechanismIssue[] = [];

  if (profile.incompatibleFeedback.includes(auction.feedbackPolicy)) {
    issues.push({
      field: 'feedbackPolicy',
      message: `${profile.label} cannot run with ${auction.feedbackPolicy.replace('_', ' ').toLowerCase()} feedback — ${whyIncompatible(auction.mechanism)}`,
      blocking: true,
    });
  }

  if (auction.proxyBidding && !profile.proxySupported) {
    issues.push({
      field: 'proxyBidding',
      message: `${profile.label} has no price for a proxy to bid. ${profile.bidEntry === 'STAY_IN' ? 'A bidder confirms or leaves; there is no number to automate.' : 'There is one submission and nothing to improve on.'}`,
      blocking: false,
    });
  }

  if (auction.clockOwner !== profile.clockOwner) {
    issues.push({
      field: 'clockOwner',
      message: `${profile.label} is a ${profile.clockOwner === 'SYSTEM' ? 'system' : 'bidder'}-clock format. Set to ${auction.clockOwner.toLowerCase()}, the direction derives wrongly and every directional label on both applications inverts.`,
      blocking: true,
    });
  }

  if (auction.closePolicy !== profile.defaultClosePolicy && strictClose(auction.mechanism)) {
    issues.push({
      field: 'closePolicy',
      message: `${profile.label} closes on ${profile.defaultClosePolicy.replace('_', ' ').toLowerCase()}. Another close policy leaves the auction with no defined ending.`,
      blocking: true,
    });
  }

  if (!profile.enabledByDefault) {
    issues.push({
      field: 'mechanism',
      message: `${profile.label} is off by default. Enable it only where a regime mandates it, and tell bidders the rule before they bid.`,
      blocking: false,
    });
  }

  return issues;
}

/** Mechanisms whose ending is part of their definition, not a preference. */
const strictClose = (mechanism: AuctionMechanism) =>
  mechanism === 'DUTCH' || mechanism === 'SEALED_BID' || mechanism === 'VICKREY';

function whyIncompatible(mechanism: AuctionMechanism): string {
  switch (mechanism) {
    case 'DUTCH':
      return 'there is nothing to report until the first acceptance ends it.';
    case 'SEALED_BID':
    case 'VICKREY':
      return 'a sealed bid that reports a position is not sealed.';
    case 'JAPANESE':
      return 'there is no ranking while it runs — only who is still in.';
    case 'TRAFFIC_LIGHT':
      return 'the mechanism is the feedback policy; anything else contradicts it.';
    case 'MULTI_ATTRIBUTE':
    case 'PORTFOLIO':
      return 'the standing is a composite, so a bare price misrepresents it.';
    default:
      return 'the mechanism does not produce that information.';
  }
}

// ---------------------------------------------------------------------------
// Status presentation shared by both applications
// ---------------------------------------------------------------------------

/** Whether a bidder may act right now, and if not, why not in their words. */
export function biddingOpen(
  status: AuctionStatus,
): { open: boolean; reason: string | null } {
  switch (status) {
    case 'LIVE':
    case 'EXTENDED':
      return { open: true, reason: null };
    case 'PAUSED':
      return { open: false, reason: 'The buyer has paused this auction. Nothing you send now will be accepted.' };
    case 'SCHEDULED':
    case 'LOBBY_OPEN':
      return { open: false, reason: 'The auction has not started yet.' };
    case 'CLOSED':
    case 'RESULTS_PUBLISHED':
      return { open: false, reason: 'The auction has closed.' };
    case 'ABORTED':
      return { open: false, reason: 'The buyer stopped this auction. No result will be issued from it.' };
    case 'CANCELLED':
      return { open: false, reason: 'This auction was cancelled.' };
    default:
      return { open: false, reason: 'Bidding is not open.' };
  }
}
