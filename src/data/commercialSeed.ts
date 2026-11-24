/**
 * What the seeded bidders offered beyond a headline unit price.
 *
 * Pack 12's price grid captured a unit price and a lead time. A real offer
 * carries more — discounts, validity, a currency, a different unit, an
 * exception to a clause — and the commercial evaluation is only worth having
 * if it meets those. Each of the four bidders is here to show one thing:
 *
 *   ABC     the incumbent: delivered, 90 days valid, a volume discount.
 *   Global  quotes in US dollars and ex-works, so it is cheaper than it looks.
 *   Prime   a composition dealer with a missing line, a wrong total, an offer
 *           that expires too soon, and a line entered on its behalf.
 *   Metro   prices four lines to the paisa the same as Prime, takes exception
 *           to a negotiable clause, and has a line lifted from a PDF.
 *
 * Kept apart from the seed so the seed stays a plain list of what was asked
 * and answered; this file only adds to the offer.
 */
import type { PriceLine } from '../domain/types';
import type { FxRate, TermsSeed } from '../domain/commercialEvaluation';

export const USD_INR = 83.2;

/** Frozen when the event was published; the date is the seed's "six days ago". */
export function seededFx(seedNow: number): Record<string, FxRate> {
  return {
    USD: {
      currency: 'USD', rate: USD_INR, source: 'RBI reference rate, buyer treasury', frozenAt: seedNow - 6 * 86_400_000,
    },
  };
}

export const SEEDED_TERMS: Record<string, TermsSeed> = {
  'eb-abc': { validityDays: 90, delivery: 'DELIVERED', taxProfile: 'REGULAR', allInclusive: true, escalationPct: 0 },
  'eb-global': {
    validityDays: 60, delivery: 'EX_WORKS', taxProfile: 'REGULAR', allInclusive: true, escalationPct: 2,
    preference: null,
  },
  'eb-prime': {
    validityDays: 40, delivery: 'DELIVERED', taxProfile: 'COMPOSITION', allInclusive: true,
    deviations: [{
      clause: '8.2', nonNegotiable: false,
      text: 'Liability for late delivery capped at 5% of the order value',
    }],
  },
  'eb-metro': {
    validityDays: 60, delivery: 'DELIVERED', taxProfile: 'REGULAR', allInclusive: true,
    preference: 'MSE',
    deviations: [{
      clause: '12.4', nonNegotiable: false,
      text: 'Returns accepted within 7 days instead of 30',
    }],
  },
};

type LineExtras = Partial<PriceLine>;

/** Extras per bidder per line, merged onto the seeded price lines. */
export const SEEDED_LINE_EXTRAS: Record<string, Record<string, LineExtras>> = {
  'eb-abc': {
    'li-1': { discountPct: 2, moq: 500, validityDays: 90 },
    'li-2': { discountPct: 2, moq: 100, validityDays: 90 },
    'li-3': { validityDays: 90 },
    'li-4': { validityDays: 90 },
    'li-5': { validityDays: 90 },
    'li-6': { validityDays: 90 },
  },
  'eb-global': {
    'li-1': { validityDays: 60, moq: 1000 },
    'li-2': { validityDays: 60 },
    'li-3': { validityDays: 60 },
    'li-4': { validityDays: 60 },
    'li-5': { validityDays: 60 },
    'li-6': { validityDays: 60 },
  },
  'eb-prime': {
    'li-1': { validityDays: 40 },
    'li-2': { validityDays: 40, source: 'ON_BEHALF', notes: 'Entered on the supplier’s behalf from their emailed quotation' },
    // The supplier's own extended value is wrong: 900 boxes at 9.2 is not 9,000.
    'li-3': { validityDays: 40 },
    'li-4': { validityDays: 40 },
  },
  'eb-metro': {
    'li-1': { validityDays: 60 },
    'li-2': { validityDays: 60 },
    'li-3': { validityDays: 60 },
    'li-4': { validityDays: 60 },
    'li-5': { validityDays: 60, source: 'EXTRACTED', notes: 'Read from the attached PDF quotation' },
    'li-6': { validityDays: 60 },
  },
};

/**
 * A supplier whose own extended value is not unit price × quantity. The factor
 * is applied to the correct figure to produce the wrong one the supplier wrote.
 */
export const SEEDED_MISCOUNT: Record<string, Record<string, number>> = {
  'eb-prime': { 'li-3': 0.9 },
};

/** An offer of something other than what was specified — shown beneath, never ranked. */
export const SEEDED_ALTERNATES: Record<string, Record<string, { unitFactor: number; note: string }>> = {
  'eb-abc': { 'li-1': { unitFactor: 0.88, note: '75gsm recycled stock, FSC certified' } },
};

/** Lines a bidder did not price at all: not offered. */
export const SEEDED_UNPRICED: Record<string, string[]> = {
  // A required line. The sixth is optional, and leaving it blank would prove nothing.
  'eb-prime': ['li-5'],
};

/**
 * Metro's price on these lines is copied from Prime's, to the paisa. Prices
 * follow Prime's `baseline × 0.91`; Metro's own would have been `× 0.90`.
 * Three of the four lines both of them priced — more than independent bids do.
 */
export const SEEDED_MATCHED_TO: Record<string, { to: string; lines: string[] }> = {
  'eb-metro': { to: 'eb-prime', lines: ['li-2', 'li-3', 'li-4'] },
};

/** Master data the agent proposes from. Read, never written, by evaluation. */
export const MASTER_DATA = {
  freightLanes: 'Standard freight lane rates, origin-based, refreshed 3 weeks ago',
  dutySchedule: 'Customs duty by country of origin',
  costOfCapital: 'Tenant cost of capital',
};
