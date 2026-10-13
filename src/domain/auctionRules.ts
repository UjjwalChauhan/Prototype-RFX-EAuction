/**
 * The rules of an auction, declared rather than drawn.
 *
 * The Setup pane used to show one fixed card of eight anti-gaming fields
 * whatever mechanism was chosen. That is wrong in both directions. Half of
 * them do nothing in a Dutch auction — there are no competing bids, so the
 * minimum improvement, the front buffer and the typed confirmation never
 * execute, and the soft-close fields cannot fire at all in a first-accept
 * format. And the settings a Dutch auction actually needs — how fast the clock
 * ticks, how far it may travel — were not on the screen at all; they were
 * constants in a panel.
 *
 * So the rules live here as a table, each one saying which auctions it is real
 * for, what it does, and what goes wrong without it. The pane renders the
 * table, the engine reads the same values, and a rule that does not apply is
 * absent rather than present and inert. An inert control is worse than a
 * missing one: a buyer sets it, believes it, and finds out afterwards.
 *
 * Two groups, because they answer different questions:
 *   CONDUCT   — what a bidder may and may not do. Mostly shared.
 *   PARAMETER — how this mechanism runs. Entirely its own.
 */
import { MECHANISM_PROFILE, profileOf } from './auctionMechanics';
import { improvementLabel } from './comparator';
import type {
  Auction, AuctionMechanism, AuctionParameters, TieBidPolicy,
} from './types';

// ---------------------------------------------------------------------------
// Parameters — the settings that exist only for one mechanism
// ---------------------------------------------------------------------------

export type ParameterKey =
  | 'dutch.tickSeconds'
  | 'dutch.limitPct'
  | 'japanese.roundSeconds'
  | 'sealed.allowResubmission'
  | 'turn.turnSeconds'
  | 'multiAttribute.publishWeights'
  | 'index.maxPremiumPct';

interface ParameterDefault {
  key: ParameterKey;
  value: number | boolean;
  mechanisms: AuctionMechanism[];
}

const PARAMETER_DEFAULTS: ParameterDefault[] = [
  { key: 'dutch.tickSeconds', value: 20, mechanisms: ['DUTCH'] },
  { key: 'dutch.limitPct', value: 40, mechanisms: ['DUTCH'] },
  { key: 'japanese.roundSeconds', value: 90, mechanisms: ['JAPANESE'] },
  { key: 'sealed.allowResubmission', value: false, mechanisms: ['SEALED_BID', 'VICKREY'] },
  { key: 'turn.turnSeconds', value: 120, mechanisms: ['RANK_COMPRESSION'] },
  { key: 'multiAttribute.publishWeights', value: true, mechanisms: ['MULTI_ATTRIBUTE'] },
  { key: 'index.maxPremiumPct', value: 25, mechanisms: ['INDEX_LINKED'] },
];

/** The parameters a mechanism starts with, at their defaults. */
export function defaultParameters(mechanism: AuctionMechanism): AuctionParameters {
  return Object.fromEntries(
    PARAMETER_DEFAULTS
      .filter((entry) => entry.mechanisms.includes(mechanism))
      .map((entry) => [entry.key, entry.value]),
  );
}

const defaultOf = (key: ParameterKey): number | boolean =>
  PARAMETER_DEFAULTS.find((entry) => entry.key === key)!.value;

/**
 * Read a numeric parameter.
 *
 * Falls back to the declared default rather than to zero, because an auction
 * seeded before a parameter existed must still run — and a Dutch clock with a
 * tick interval of zero is not a degraded auction, it is a division by zero.
 */
export function numberParam(auction: Auction, key: ParameterKey): number {
  const held = auction.parameters?.[key];
  return typeof held === 'number' && Number.isFinite(held) && held > 0
    ? held
    : defaultOf(key) as number;
}

export function boolParam(auction: Auction, key: ParameterKey): boolean {
  const held = auction.parameters?.[key];
  return typeof held === 'boolean' ? held : defaultOf(key) as boolean;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export type SettingGroup = 'CONDUCT' | 'PARAMETER';

export type SettingKind =
  /** A number with a unit segmented beside it — the decrement and its basis. */
  | 'DECREMENT'
  | 'PERCENT' | 'SECONDS' | 'COUNT' | 'BOOLEAN' | 'CHOICE';

export type SettingKey = `antiGaming.${string}` | ParameterKey | 'trafficAmberBandPct';

export interface AuctionSetting {
  key: SettingKey;
  group: SettingGroup;
  /** Reads differently per mechanism and per side, so it is computed. */
  label: (auction: Auction) => string;
  /** What it does, in the buyer's terms. */
  hint: (auction: Auction) => string;
  /**
   * What goes wrong without it.
   *
   * The half of the explanation a tooltip usually leaves out, and the half a
   * buyer needs to choose a number rather than accept the default.
   */
  why: (auction: Auction) => string;
  kind: SettingKind;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Whether this setting is real for this auction as configured. */
  applies: (auction: Auction) => boolean;
  /** Set when the control is shown only so the boundary is visible. */
  locked?: string;
}

/** Mechanisms where one bid is judged against another, so improvement rules run. */
const improves = (auction: Auction): boolean => {
  const profile = profileOf(auction.mechanism);
  return auction.rounds !== 'SINGLE'
    && profile.bidEntry !== 'ACCEPT_CLOCK'
    && profile.bidEntry !== 'STAY_IN';
};

/** Mechanisms whose price is set by a clock rather than typed by a bidder. */
const clockDriven = (auction: Auction): boolean =>
  profileOf(auction.mechanism).clockOwner === 'SYSTEM';

const always = () => true;
const isMechanism = (...list: AuctionMechanism[]) =>
  (auction: Auction) => list.includes(auction.mechanism);

export const AUCTION_SETTINGS: AuctionSetting[] = [
  // -------------------------------------------------------------------------
  // Conduct — what a bidder may and may not do
  // -------------------------------------------------------------------------
  {
    key: 'antiGaming.minDecrement',
    group: 'CONDUCT',
    kind: 'DECREMENT',
    min: 0,
    step: 0.1,
    label: (auction) => (clockDriven(auction)
      ? 'Clock step'
      : `Minimum ${improvementLabel(auction.side)}`),
    hint: (auction) => (clockDriven(auction)
      ? 'How far the price moves on every tick of the clock.'
      : 'The smallest amount by which a new bid must beat the standing one.'),
    why: (auction) => (clockDriven(auction)
      ? 'This is the single biggest lever on the outcome. Too small and the clock crawls while bidders wait each other out; too large and the price it lands on overshoots what the field would have taken.'
      : 'Without it a bidder holds the lead all session by shaving a rupee at a time, and nobody else can get a move in.'),
    // Not on a single-shot format: there is no standing bid to improve on and
    // no clock to step.
    applies: (auction) => auction.rounds !== 'SINGLE',
  },
  {
    key: 'antiGaming.maxDecrementPct',
    group: 'CONDUCT',
    kind: 'PERCENT',
    min: 1,
    max: 100,
    label: () => 'Maximum improvement guard',
    hint: () => 'Bids that improve by more than this are refused outright.',
    why: () => 'A fat finger — a figure typed with one zero too few — wins the auction and then has to be unwound. This catches it at entry, where it costs nothing.',
    applies: improves,
  },
  {
    key: 'antiGaming.frontBufferPct',
    group: 'CONDUCT',
    kind: 'PERCENT',
    min: 0,
    max: 50,
    label: () => 'Front buffer',
    hint: () => 'A band immediately ahead of the leading bid in which bids are refused.',
    why: () => 'Set it to zero and a bidder can sit a hair in front of the leader, reading how hard they push back before committing anything real. A buffer makes taking the lead a decision rather than a probe.',
    applies: improves,
  },
  {
    key: 'antiGaming.confirmThresholdPct',
    group: 'CONDUCT',
    kind: 'PERCENT',
    min: 1,
    max: 100,
    label: () => 'Typed confirmation above',
    hint: () => 'An improvement this large is refused once, and accepted when the bidder confirms it.',
    why: () => 'Sits below the maximum guard and catches what that lets through: a move which is legal, enormous, and probably not what the bidder meant. The second press is the record that they meant it.',
    applies: improves,
  },
  {
    key: 'antiGaming.softCloseTriggerSec',
    group: 'CONDUCT',
    kind: 'SECONDS',
    min: 5,
    max: 900,
    label: () => 'Soft close trigger',
    hint: () => 'A bid placed within this long of the close extends the clock.',
    why: () => 'This is the anti-sniping rule. Without it the auction is won by whoever has the fastest connection in the last second, which is not the supplier you were trying to find.',
    applies: (auction) => auction.closePolicy === 'SOFT_EXTENSION',
  },
  {
    key: 'antiGaming.softCloseExtensionSec',
    group: 'CONDUCT',
    kind: 'SECONDS',
    min: 5,
    max: 900,
    label: () => 'Extension length',
    hint: () => 'How much time a late bid adds.',
    why: () => 'Long enough that a competitor can actually respond — a thirty-second extension on a page a bidder has to read is not a chance to reply, it is the appearance of one.',
    applies: (auction) => auction.closePolicy === 'SOFT_EXTENSION',
  },
  {
    key: 'antiGaming.snipingThresholdSec',
    group: 'CONDUCT',
    kind: 'SECONDS',
    min: 0,
    max: 300,
    label: () => 'Flag bids inside',
    hint: () => 'Bids this close to the deadline are flagged on the cockpit for the record.',
    why: () => 'An observation, not a refusal. Late bidding is legitimate; a pattern of it across events is worth being able to point at afterwards.',
    applies: (auction) => auction.closePolicy !== 'FIRST_ACCEPT' && auction.closePolicy !== 'LAST_STANDING',
  },
  {
    key: 'antiGaming.identicalBidWindowSec',
    group: 'CONDUCT',
    kind: 'SECONDS',
    min: 0,
    max: 300,
    label: () => 'Flag identical bids within',
    hint: () => 'Two bidders submitting the same figure this close together are flagged.',
    why: () => 'Identical numbers seconds apart are usually a coincidence and occasionally two bidders who spoke beforehand. The flag does not accuse anyone; it records that it happened.',
    applies: always,
  },
  {
    key: 'antiGaming.minBiddersToStart',
    group: 'CONDUCT',
    kind: 'COUNT',
    min: 1,
    max: 20,
    label: () => 'Minimum bidders to start',
    hint: () => 'Below this the start is blocked or has to be justified.',
    why: (auction) => (clockDriven(auction)
      ? 'A clock format with two participants is a posted price with a countdown on it. The pressure this mechanism creates comes entirely from bidders watching each other.'
      : 'Two bidders is a negotiation. An auction below this count produces a number you could have got by asking, and a process you then have to defend.'),
    applies: always,
  },
  {
    key: 'antiGaming.tieBidPolicy',
    group: 'CONDUCT',
    kind: 'CHOICE',
    options: [
      { value: 'FIRST_IN_WINS', label: 'First in' },
      { value: 'SPLIT', label: 'Split' },
      { value: 'TIE_BREAK_ROUND', label: 'Tie-break' },
      { value: 'BUYER_DECIDES', label: 'Buyer' },
    ],
    label: () => 'Tie-bid policy',
    hint: () => 'How two identical values are separated.',
    why: (auction) => (auction.closePolicy === 'FIRST_ACCEPT'
      ? 'Two acceptances in the same tick of the clock is the realistic tie here, and it decides the winner outright. "First in" resolves it on the server sequence number, which is the only clock nobody can argue with.'
      : 'Decided now, in writing, or decided later by whoever is in the room — which is the version that ends in a complaint.'),
    applies: always,
  },
  {
    key: 'antiGaming.requireDryRunFirstEvent',
    group: 'CONDUCT',
    kind: 'BOOLEAN',
    label: () => 'Require a dry run before a supplier’s first live auction',
    hint: () => 'A first-time bidder is warned in the lobby until they have practised.',
    why: () => 'A supplier who loses because they could not work the screen is a supplier you did not actually get a price from.',
    applies: always,
  },
  {
    key: 'antiGaming.bidWithdrawalAllowed',
    group: 'CONDUCT',
    kind: 'BOOLEAN',
    label: () => 'Allow bid withdrawal',
    hint: () => 'Never permitted.',
    why: () => 'The ledger is append-only. A correction is a new row, so the record of what was offered survives the correction.',
    applies: always,
    locked: 'Bid withdrawal is never permitted. The ledger is append-only; a correction is a new row.',
  },
  {
    key: 'antiGaming.rebidOnOwnLeadingBidAllowed',
    group: 'CONDUCT',
    kind: 'BOOLEAN',
    label: () => 'Allow rebid on your own leading bid',
    hint: () => 'Never permitted.',
    why: () => 'Bidding against yourself is either a mistake or an attempt to manufacture activity. Neither is a price.',
    applies: (auction) => auction.rounds !== 'SINGLE',
    locked: 'Bidding against your own leading bid is never permitted.',
  },

  // -------------------------------------------------------------------------
  // Parameters — how this mechanism runs
  // -------------------------------------------------------------------------
  {
    key: 'dutch.tickSeconds',
    group: 'PARAMETER',
    kind: 'SECONDS',
    min: 5,
    max: 300,
    label: () => 'Clock tick',
    hint: () => 'How often the price moves one step.',
    why: (auction) => (auction.side === 'BUY'
      ? 'Tick and step together are the whole auction. Every tick nobody accepts costs you one more step, so a slow clock is money and a fast one is pressure a supplier may not have time to get approval for.'
      : 'Tick and step together are the whole auction. Every tick nobody accepts loses you one more step of the sale price.'),
    applies: isMechanism('DUTCH'),
  },
  {
    key: 'dutch.limitPct',
    group: 'PARAMETER',
    kind: 'PERCENT',
    min: 5,
    max: 200,
    label: (auction) => (auction.side === 'BUY' ? 'Walk-away ceiling' : 'Reserve floor'),
    hint: (auction) => (auction.side === 'BUY'
      ? 'How far above the opening price the clock may travel before it stops.'
      : 'How far below the opening price the clock may fall before it stops.'),
    why: (auction) => (auction.side === 'BUY'
      ? 'The clock stopping here means nobody accepted at a price you were willing to pay — a failed auction, which is a result. Used only where the lot carries no ceiling of its own.'
      : 'Your reserve. The clock stopping here means the lot did not sell, which is better than selling it below what it is worth. Used only where the lot carries no floor of its own.'),
    applies: isMechanism('DUTCH'),
  },
  {
    key: 'japanese.roundSeconds',
    group: 'PARAMETER',
    kind: 'SECONDS',
    min: 15,
    max: 900,
    label: () => 'Round length',
    hint: () => 'How long bidders have to confirm they are staying in at the clock price.',
    why: () => 'Short enough to keep the auction moving, long enough that a bidder who needs to make a phone call is not eliminated for making it. Elimination here is permanent, so this number decides who leaves for the wrong reason.',
    applies: isMechanism('JAPANESE'),
  },
  {
    key: 'sealed.allowResubmission',
    group: 'PARAMETER',
    kind: 'BOOLEAN',
    label: () => 'Allow a bidder to replace their submission before the deadline',
    hint: () => 'Off, the first submission is final. On, a later one replaces it and both stay in the ledger.',
    why: () => 'Off is the stricter reading of a sealed bid and the one most public procurement expects. On is kinder to a supplier who spots an error, and costs nothing while the envelopes are still sealed — nobody can be reacting to anything they have seen.',
    applies: isMechanism('SEALED_BID', 'VICKREY'),
  },
  {
    key: 'turn.turnSeconds',
    group: 'PARAMETER',
    kind: 'SECONDS',
    min: 15,
    max: 900,
    label: () => 'Turn length',
    hint: () => 'How long a bidder has once their turn is called.',
    why: () => 'The whole field is waiting while one bidder thinks. Too long and the auction stalls; too short and a bidder passes because of the clock rather than because of the price.',
    applies: isMechanism('RANK_COMPRESSION'),
  },
  {
    key: 'multiAttribute.publishWeights',
    group: 'PARAMETER',
    kind: 'BOOLEAN',
    label: () => 'Publish the scoring weights to bidders',
    hint: () => 'On, every bidder sees what each attribute is worth before they bid.',
    why: () => 'Undisclosed weights invite a dispute after the award, and a bidder who cannot see the trade-off optimises the wrong thing — which costs you the improvement you ran a multi-attribute auction to get.',
    applies: isMechanism('MULTI_ATTRIBUTE'),
  },
  {
    key: 'index.maxPremiumPct',
    group: 'PARAMETER',
    kind: 'PERCENT',
    min: 1,
    max: 100,
    label: () => 'Premium band',
    hint: () => 'The largest premium or discount to the index a bidder may quote.',
    why: () => 'A quote expressed against an index has no natural bound, so a typo is not obviously a typo. The band is what makes one visible.',
    applies: isMechanism('INDEX_LINKED'),
  },
  {
    key: 'trafficAmberBandPct',
    group: 'PARAMETER',
    kind: 'PERCENT',
    min: 1,
    max: 50,
    label: () => 'Amber band',
    hint: () => 'How far from your target still counts as amber rather than red.',
    why: () => 'The only number a bidder sees the effect of. Too wide and everyone sits on amber learning nothing; too narrow and a bidder who is close reads red and gives up.',
    applies: (auction) => auction.feedbackPolicy === 'TRAFFIC_LIGHT',
  },
];

/** The settings real for this auction, in the order they should be shown. */
export function settingsFor(auction: Auction, group?: SettingGroup): AuctionSetting[] {
  return AUCTION_SETTINGS.filter(
    (setting) => (group === undefined || setting.group === group) && setting.applies(auction),
  );
}

/**
 * Settings the screen used to show that this mechanism cannot honour.
 *
 * Kept as a function rather than as a comment because it is the answer to
 * "where did the soft close go" — a buyer who has run English auctions all
 * year and switches to Dutch should be told the fields went away on purpose.
 */
export function settingsWithdrawn(auction: Auction): AuctionSetting[] {
  return AUCTION_SETTINGS.filter((setting) => !setting.applies(auction));
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

export function readSetting(auction: Auction, key: SettingKey): number | boolean | string {
  if (key === 'trafficAmberBandPct') return auction.trafficAmberBandPct;
  if (key.startsWith('antiGaming.')) {
    return (auction.antiGaming as unknown as Record<string, number | boolean | string>)[
      key.slice('antiGaming.'.length)
    ];
  }
  const parameter = key as ParameterKey;
  return typeof defaultOf(parameter) === 'boolean'
    ? boolParam(auction, parameter)
    : numberParam(auction, parameter);
}

/**
 * The patch that applies one setting.
 *
 * Returned rather than applied so the caller dispatches it, and so the same
 * function serves the pane, the API and a test without any of them knowing
 * which of the three places a given key actually lives in.
 */
export function patchSetting(
  auction: Auction, key: SettingKey, value: number | boolean | string,
): Partial<Auction> {
  if (key === 'trafficAmberBandPct') return { trafficAmberBandPct: Number(value) };
  if (key.startsWith('antiGaming.')) {
    return {
      antiGaming: { ...auction.antiGaming, [key.slice('antiGaming.'.length)]: value },
    };
  }
  return {
    parameters: { ...auction.parameters, [key]: value as number | boolean },
  };
}

/**
 * Bring the parameter bag into line with the mechanism.
 *
 * Switching a live draft from Dutch to English leaves the tick interval behind
 * with nothing to tick; switching back to Dutch must not find it missing. So
 * the defaults for the new mechanism are filled in and anything it has no use
 * for is dropped.
 */
export function alignParameters(auction: Auction): AuctionParameters {
  const wanted = defaultParameters(auction.mechanism);
  return Object.fromEntries(
    Object.keys(wanted).map((key) => [key, auction.parameters?.[key] ?? wanted[key]]),
  );
}

/** Every tie policy, for a caller that needs the union at runtime. */
export const TIE_POLICIES: TieBidPolicy[] = [
  'FIRST_IN_WINS', 'SPLIT', 'TIE_BREAK_ROUND', 'BUYER_DECIDES',
];

/** Present so a caller can label a mechanism without importing two modules. */
export const mechanismLabel = (mechanism: AuctionMechanism): string =>
  MECHANISM_PROFILE[mechanism].label;
