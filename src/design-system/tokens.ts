/**
 * Design tokens — the shadcn/ui palette, read by the screens that style inline.
 *
 * `global.css` declares the same values as CSS variables in shadcn's two-layer
 * arrangement, which is what `bg-primary` and `text-muted-foreground` resolve
 * to in the design-system components. This file is the second reading of that
 * one palette, for the screens that still carry their own inline styles. The
 * names here are the product's; the values are shadcn's zinc scale, with this
 * product's violet kept as the primary because a component library does not
 * get to decide the brand.
 *
 * Changing a value here moves every screen at once, which is the only reason a
 * token file is worth having — and anything changed here must be changed in
 * the `:root` block of `global.css` too, or the two readings disagree.
 *
 * Colour is never the only carrier of meaning: status is always colour + icon
 * + text, which is why every status map in the domain layer ships an icon.
 */
import { BASE_CURRENCY } from '../domain/config';

export { BASE_CURRENCY };

export const color = {
  /** --primary. The brand, kept through the shadcn move. */
  brandPrimary: '#6C5DD3',
  /** The pressed/hover step of the primary. */
  brandPrimaryStrong: '#5B4CC4',
  /** --accent. */
  brandPrimarySoft: '#F2F0FD',
  /** The border that sits on `brandPrimarySoft`. */
  brandPrimaryTint: '#E3DFFA',
  /** --card. */
  surface: '#FFFFFF',
  surfacePage: '#FAFAFA',
  /** --muted. Zebra striping and inset panels. */
  rowAlt: '#F4F4F5',
  /** --border, --input. */
  border: '#E4E4E7',
  borderStrong: '#D4D4D8',
  /** --foreground. */
  textPrimary: '#09090B',
  /** --muted-foreground. */
  textSecondary: '#71717A',
  textMuted: '#A1A1AA',
  textBody: '#27272A',
  /** Near-black, for the one dark control on a screen. */
  ink: '#18181B',
  success: '#16A34A',
  successSoft: '#F0FDF4',
  successText: '#15803D',
  warning: '#F59E0B',
  warningSoft: '#FFFBEB',
  warningText: '#B45309',
  /** --destructive. */
  danger: '#EF4444',
  dangerSoft: '#FEF2F2',
  dangerText: '#B91C1C',
  info: '#3B82F6',
  infoSoft: '#EFF6FF',
  infoText: '#1D4ED8',
  accentPurple: '#8B5CF6',
  accentPurpleSoft: '#F5F3FF',
  accentPurpleText: '#6D28D9',
  gold: '#CA8A04',
  /** --secondary. */
  neutralSoft: '#F4F4F5',
} as const;

export const font = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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

/**
 * shadcn's radius scale, from `--radius: 0.5rem`: `rounded-lg` on surfaces,
 * `rounded-md` on controls.
 */
export const radius = {
  card: 8,
  control: 6,
  /** Nav rows and other soft-cornered strips. */
  nav: 6,
  pill: 999,
} as const;

/** 4px base, 8px rhythm. */
export const space = {
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48,
} as const;

/**
 * Tailwind's shadow scale, which is what shadcn's components carry: a 1px
 * border does most of the work and the shadow only separates a surface from
 * the one behind it.
 */
export const elevation = {
  none: 'none',
  /** shadow-sm */
  card: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  /** shadow */
  raised: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  /** shadow-lg, for anything that floats over the page. */
  overlay: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
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
