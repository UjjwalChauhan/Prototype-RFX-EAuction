/**
 * Design tokens — Pack 00, Foundation file 1 of 3.
 *
 * Values are lifted verbatim from "Foundation — Tokens & Primitives.dc.html".
 * Colour is never the only carrier of meaning: status is always colour + icon
 * + text, which is why every status map in the domain layer ships an icon.
 */
import { BASE_CURRENCY } from '../domain/config';

export { BASE_CURRENCY };

export const color = {
  brandPrimary: '#2563EB',
  brandPrimarySoft: '#EFF4FF',
  surface: '#FFFFFF',
  surfacePage: '#F7F8FA',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textBody: '#374151',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  successText: '#15803D',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  warningText: '#B45309',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  dangerText: '#B91C1C',
  info: '#0EA5E9',
  infoSoft: '#E0F2FE',
  infoText: '#0369A1',
  accentPurple: '#7C3AED',
  accentPurpleSoft: '#F3E8FF',
  accentPurpleText: '#6D28D9',
  gold: '#D97706',
  neutralSoft: '#F1F2F4',
} as const;

export const font = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** Admin is compact; the portal is comfortable. Two densities, one scale. */
export const type = {
  pageTitle: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' },
  sectionHeading: { fontSize: 15, fontWeight: 600 },
  tableHeader: { fontSize: 12, fontWeight: 500 },
  bodyAdmin: { fontSize: 14, fontWeight: 400 },
  bodyPortal: { fontSize: 16, fontWeight: 400 },
  metricValue: { fontSize: 24, fontWeight: 600 },
  auctionPrice: { fontSize: 32, fontWeight: 700 },
  label: { fontSize: 12, fontWeight: 500 },
  micro: { fontSize: 11, fontWeight: 500 },
} as const;

export const radius = {
  card: 8,
  control: 6,
  pill: 999,
} as const;

/** 4px base, 8px rhythm. */
export const space = {
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48,
} as const;

/** A 1px border does most of the work; shadow is minimal. */
export const elevation = {
  none: 'none',
  card: '0 1px 2px rgba(17,24,39,.05)',
  raised: '0 1px 2px rgba(17,24,39,.14)',
  overlay: '0 12px 40px rgba(17,24,39,.18)',
} as const;

export const density = {
  admin: { rowHeight: 44, bodySize: 14, navDepth: 4 },
  portal: { rowHeight: 56, bodySize: 16, navDepth: 2 },
} as const;

// ---------------------------------------------------------------------------
// Money and number formatting
//
// The currency itself is a tenant fact, not a design token, so it is read from
// the domain rather than declared twice.
// ---------------------------------------------------------------------------

/**
 * How a currency groups its digits, and what it calls a large number.
 *
 * Indian grouping is not a formatting preference — 1,50,000 and 150,000 are the
 * same number written for two different readers, and a rupee figure grouped in
 * thousands reads as a mistake to the person who has to approve it. The same
 * goes for the short forms: a reader of rupees scales in lakh and crore, not in
 * k and M, and 12M where 1.2Cr belongs is a number nobody can check at a glance.
 */
interface Grouping {
  locale: string;
  /** Short forms, largest first, as [divisor, suffix]. */
  scale: [number, string][];
}

const INDIAN: Grouping = {
  locale: 'en-IN',
  scale: [[10_000_000, 'Cr'], [100_000, 'L'], [1_000, 'k']],
};

const WESTERN: Grouping = {
  locale: 'en-US',
  scale: [[1_000_000, 'M'], [1_000, 'k']],
};

const groupingFor = (currency: string): Grouping => (currency === 'INR' ? INDIAN : WESTERN);

/** Money uses tabular figures, right-aligned in tables, currency always shown. */
export function money(
  value: number,
  currency = BASE_CURRENCY,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const symbol = currencySymbol(currency);
  const { locale, scale } = groupingFor(currency);

  // Unit prices and anything an approver will add up need their decimals: a
  // pen at 17.39 shown as 17 disagrees with its own arithmetic once quantity
  // is applied. Asked for, they win over compaction.
  if (options.decimals !== undefined) {
    return `${symbol}${value.toLocaleString(locale, {
      minimumFractionDigits: options.decimals, maximumFractionDigits: options.decimals,
    })}`;
  }

  if (options.compact) {
    for (const [divisor, suffix] of scale) {
      if (Math.abs(value) < divisor) continue;
      // One decimal, dropped when it is a zero. Rounding to whole units loses
      // too much where the units are large — 1.5L reported as 2L is fifty
      // thousand rupees of rounding on a figure someone is about to approve.
      const scaled = (value / divisor).toFixed(1).replace(/\.0$/, '');
      return `${symbol}${scaled}${suffix}`;
    }
  }
  return `${symbol}${Math.round(value).toLocaleString(locale)}`;
}

/** Group a plain number the way its currency's readers expect. */
export function groupNumber(value: number, currency = BASE_CURRENCY): string {
  return value.toLocaleString(groupingFor(currency).locale);
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'INR': return '₹';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'AED': return 'AED ';
    default: return `${currency} `;
  }
}

/** Percentages carry one decimal. */
export function pct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Savings are signed, and negatives are never hidden. */
export function signedMoney(value: number, currency = BASE_CURRENCY): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}${money(Math.abs(value), currency)}`;
}

export function signedPct(value: number): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/** Negative savings render in danger, always. */
export function savingsColor(value: number): string {
  return value < 0 ? color.dangerText : color.successText;
}

export const tabularNums: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: font.mono,
};
