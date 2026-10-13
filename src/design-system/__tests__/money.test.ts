/**
 * How money reads on screen.
 *
 * Two things are pinned here. The first is that the tenant buys in rupees, so
 * a figure with no currency of its own is a rupee figure. The second is that a
 * rupee figure is grouped and abbreviated the way its reader expects — Indian
 * digit grouping and lakh/crore, not thousands and millions. Those are not
 * cosmetic: 1,50,000 and 150,000 are the same number written for two different
 * readers, and a rupee amount grouped in thousands reads as a mistake to the
 * person who has to approve it.
 *
 * A record that carries its own currency still wins, which is why the foreign
 * cases are here too — the base currency is a default, not a conversion.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY, currencySymbol, groupNumber, money, signedMoney,
} from '../tokens';
import { TENANT_DEFAULTS } from '../../domain/config';

describe('the currency everything is quoted in', () => {
  it('is the rupee', () => {
    expect(BASE_CURRENCY).toBe('INR');
    expect(currencySymbol(BASE_CURRENCY)).toBe('₹');
  });

  it('is one fact, not one per module', () => {
    // The tenant default and the formatter's default are the same constant, so
    // they cannot drift into the board reading in one currency and the line
    // items in another.
    expect(TENANT_DEFAULTS['event.currency']).toBe(BASE_CURRENCY);
  });

  it('applies when a caller names no currency', () => {
    expect(money(150_000)).toBe('₹1,50,000');
    expect(signedMoney(-4_200)).toBe('−₹4,200');
    expect(signedMoney(4_200)).toBe('+₹4,200');
  });
});

describe('Indian grouping', () => {
  it('groups in lakh, not in thousands', () => {
    expect(money(150_000)).toBe('₹1,50,000');
    expect(money(1_200_000)).toBe('₹12,00,000');
    expect(money(125_000_000)).toBe('₹12,50,00,000');
  });

  it('groups a plain count the same way', () => {
    expect(groupNumber(1_250_000)).toBe('12,50,000');
  });

  it('leaves a figure below a lakh alone', () => {
    expect(money(18_900)).toBe('₹18,900');
  });
});

describe('short forms', () => {
  it('scales in lakh and crore', () => {
    expect(money(150_000, BASE_CURRENCY, { compact: true })).toBe('₹1.5L');
    expect(money(812_000, BASE_CURRENCY, { compact: true })).toBe('₹8.1L');
    expect(money(125_000_000, BASE_CURRENCY, { compact: true })).toBe('₹12.5Cr');
  });

  it('keeps a decimal where rounding it away would cost real money', () => {
    // 1.5L reported as 2L is fifty thousand rupees of rounding on a figure
    // somebody is about to approve.
    expect(money(141_500, BASE_CURRENCY, { compact: true })).toBe('₹1.4L');
  });

  it('drops a decimal that carries nothing', () => {
    expect(money(1_200_000, BASE_CURRENCY, { compact: true })).toBe('₹12L');
  });
});

describe('decimals, where an approver will add the figures up', () => {
  it('keeps them exactly', () => {
    // A pen at ₹8.67 shown as ₹9 disagrees with its own arithmetic once
    // quantity is applied.
    expect(money(8.67, BASE_CURRENCY, { decimals: 2 })).toBe('₹8.67');
    expect(money(150_000, BASE_CURRENCY, { decimals: 2 })).toBe('₹1,50,000.00');
  });

  it('wins over the short form, so a total is never both', () => {
    expect(money(125_000_000, BASE_CURRENCY, { compact: true, decimals: 2 }))
      .toBe('₹12,50,00,000.00');
  });
});

describe('a record that carries its own currency', () => {
  it('is not converted, and is not regrouped', () => {
    expect(money(150_000, 'USD')).toBe('$150,000');
    expect(money(1_200_000, 'USD', { compact: true })).toBe('$1.2M');
    expect(money(1_200_000, 'EUR', { compact: true })).toBe('€1.2M');
  });

  it('falls back to naming a currency it has no symbol for', () => {
    expect(money(1_000, 'JPY')).toBe('JPY 1,000');
  });
});
