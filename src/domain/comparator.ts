/**
 * Side-driven comparison. Nothing in this codebase hard-codes "lowest wins".
 *
 * Every ranking, "is this better", "best of", and clock direction in the module
 * routes through here so that a SELL event inverts correctly by construction.
 */
import type { Side, ClockOwner, Direction, AuctionMechanism } from './types';

/** On BUY a lower value is better; on SELL a higher value is better. */
export function isBetter(a: number, b: number, side: Side): boolean {
  return side === 'BUY' ? a < b : a > b;
}

export function isBetterOrEqual(a: number, b: number, side: Side): boolean {
  return side === 'BUY' ? a <= b : a >= b;
}

/** Sort comparator putting the best value first. */
export function bestFirst(side: Side): (a: number, b: number) => number {
  return (a, b) => (side === 'BUY' ? a - b : b - a);
}

export function bestOf(values: number[], side: Side): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, v) => (isBetter(v, best, side) ? v : best));
}

export function worstOf(values: number[], side: Side): number | null {
  if (values.length === 0) return null;
  return values.reduce((worst, v) => (isBetter(worst, v, side) ? v : worst));
}

/**
 * Direction is derived, never entered. "Dutch Reverse" is not a mechanism —
 * it is mechanism=DUTCH with side=BUY, which yields an *ascending* clock.
 */
export function deriveDirection(side: Side, clockOwner: ClockOwner): Direction {
  if (clockOwner === 'BIDDER') {
    // Bidders improve on each other: BUY bids descend, SELL bids ascend.
    return side === 'BUY' ? 'DESCENDING' : 'ASCENDING';
  }
  // A system clock moves *against* the bidder until someone accepts.
  return side === 'BUY' ? 'ASCENDING' : 'DESCENDING';
}

/** Plain-language direction label, for headers and help text. */
export function directionLabel(side: Side): string {
  return side === 'BUY' ? 'lowest price wins' : 'highest price wins';
}

export function improvementLabel(side: Side): string {
  return side === 'BUY' ? 'decrement' : 'increment';
}

/**
 * Signed improvement of `next` over `current`, always positive when better.
 * A BUY improvement of 142500 -> 141000 is +1500.
 */
export function improvement(current: number, next: number, side: Side): number {
  return side === 'BUY' ? current - next : next - current;
}

export function improvementPct(current: number, next: number, side: Side): number {
  if (current === 0) return 0;
  return (improvement(current, next, side) / Math.abs(current)) * 100;
}

/** Gap from a bid to the leading bid, as a positive percentage behind. */
export function gapPctBehind(myValue: number, bestValue: number, side: Side): number {
  if (bestValue === 0) return 0;
  const raw = ((myValue - bestValue) / Math.abs(bestValue)) * 100;
  const signed = side === 'BUY' ? raw : -raw;
  // Negating zero yields -0, which formats as "-0.0%" in the supplier console.
  return signed === 0 ? 0 : signed;
}

/** Whether a mechanism has a price clock at all (sealed and Vickrey do not). */
export function hasClock(mechanism: AuctionMechanism): boolean {
  return mechanism !== 'SEALED_BID' && mechanism !== 'VICKREY';
}

export function defaultClockOwner(mechanism: AuctionMechanism): ClockOwner {
  switch (mechanism) {
    case 'JAPANESE':
    case 'DUTCH':
      return 'SYSTEM';
    default:
      return 'BIDDER';
  }
}
