/**
 * Shortlisting: what the system proposes, and what it insists on.
 *
 * Two grains, deliberately. The vendor master proposes per category, because
 * that is what it knows. Coverage is judged per line, because that is where
 * the failure happens — a category with four vendors in it can still hold one
 * line nobody was ticked against, and that line comes back empty.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_BIDDERS_PER_CATEGORY, biddersByCategory, defaultShortlist, rankForCategory,
  servesCategory, suggestBidders, validateCoverage, validateLineCoverage, validateRoster,
} from '../bidders';
import { COUNTERPARTIES } from '../../data/seed';
import type { Counterparty } from '../types';

function supplier(over: Partial<Counterparty> = {}): Counterparty {
  return {
    id: 'cp-x', code: 'VN-00001', name: 'X', onboardingRating: 80, performanceRating: 70,
    categoriesServed: ['IT Hardware'], locationsServed: ['Dubai'],
    isProvisional: false, contactEmail: 'x@example.test', ...over,
  };
}

describe('matching a supplier to a category', () => {
  it('matches on the category itself', () => {
    expect(servesCategory(supplier(), 'IT Hardware')).toBe(true);
    expect(servesCategory(supplier(), 'Fleet & Logistics')).toBe(false);
  });

  it('accepts a master maintained at super-category grain', () => {
    const coarse = supplier({ categoriesServed: ['Indirect'] });
    expect(servesCategory(coarse, 'Facilities & MRO', 'Indirect')).toBe(true);
    expect(servesCategory(coarse, 'Facilities & MRO', null)).toBe(false);
  });
});

describe('ranking', () => {
  it('puts suppliers with delivery history above those without', () => {
    const ranked = rankForCategory([
      supplier({ id: 'new', performanceRating: 0, onboardingRating: 99 }),
      supplier({ id: 'proven', performanceRating: 60, onboardingRating: 70 }),
    ]);
    expect(ranked[0].id).toBe('proven');
  });

  it('ranks provisional suppliers last however good they look', () => {
    const ranked = rankForCategory([
      supplier({ id: 'prov', isProvisional: true, performanceRating: 99, onboardingRating: 99 }),
      supplier({ id: 'plain', performanceRating: 40, onboardingRating: 40 }),
    ]);
    expect(ranked[0].id).toBe('plain');
    expect(ranked[1].id).toBe('prov');
  });
});

describe('suggestions', () => {
  it('splits the master into serving and not, losing nobody', () => {
    const { suggested, others } = suggestBidders(COUNTERPARTIES, 'IT Hardware');
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.length + others.length).toBe(COUNTERPARTIES.length);
    for (const s of suggested) expect(s.categoriesServed).toContain('IT Hardware');
  });

  it('offers the non-serving suppliers rather than hiding them', () => {
    // The buyer may know the market better than the master does.
    const { others } = suggestBidders(COUNTERPARTIES, 'Fleet & Logistics');
    expect(others.length).toBeGreaterThan(0);
  });

  it('proposes candidates for every seeded category', () => {
    const categories = [
      'IT Hardware', 'Office & Administrative', 'Facilities & MRO',
      'Fleet & Logistics', 'Electrical & Instrumentation', 'Professional & Consultancy',
    ];
    for (const category of categories) {
      expect(suggestBidders(COUNTERPARTIES, category).suggested.length).toBeGreaterThan(0);
    }
  });
});

describe('the opening shortlist', () => {
  it('never auto-selects a supplier who cannot be awarded', () => {
    const shortlist = defaultShortlist(COUNTERPARTIES, 'Electrical & Instrumentation');
    const provisional = COUNTERPARTIES.filter((c) => c.isProvisional).map((c) => c.id);
    for (const id of shortlist) expect(provisional).not.toContain(id);
  });

  it('caps at the competitive minimum rather than inviting the whole master', () => {
    const shortlist = defaultShortlist(COUNTERPARTIES, 'Office & Administrative');
    expect(shortlist.length).toBeLessThanOrEqual(MIN_BIDDERS_PER_CATEGORY);
  });
});

describe('coverage is judged per category, not per event', () => {
  const master = [
    supplier({ id: 'a' }), supplier({ id: 'b' }), supplier({ id: 'c' }),
    supplier({ id: 'p', isProvisional: true }),
  ];

  it('blocks a category with nobody in it', () => {
    const [issue] = validateCoverage([{ category: 'IT Hardware', bidderIds: [] }], master);
    expect(issue.blocking).toBe(true);
    expect(issue.message).toContain('nobody to price them');
  });

  it('blocks a category whose only bidders cannot be awarded', () => {
    const [issue] = validateCoverage([{ category: 'IT Hardware', bidderIds: ['p'] }], master);
    expect(issue.blocking).toBe(true);
    expect(issue.message).toContain('provisional');
  });

  it('warns a thin category without blocking it', () => {
    const [issue] = validateCoverage([{ category: 'IT Hardware', bidderIds: ['a', 'b'] }], master);
    expect(issue.tone).toBe('warning');
    expect(issue.blocking).toBeFalsy();
  });

  it('does not let a healthy total hide a thin category', () => {
    const issues = validateCoverage(
      [
        { category: 'IT Hardware', bidderIds: ['a', 'b', 'c'] },
        { category: 'Fleet & Logistics', bidderIds: ['a'] },
      ],
      master,
    );
    expect(issues[0].tone).toBe('success');
    expect(issues[1].tone).toBe('warning');
    expect(issues[1].message).toContain('Fleet & Logistics');
  });
});

describe('invitations recorded per line', () => {
  const lines = [
    { id: 'l1', category: 'IT Hardware' },
    { id: 'l2', category: 'IT Hardware' },
    { id: 'l3', category: 'Facilities & MRO' },
  ];

  it('reads the shortlist per category back out of the per-line ticks', () => {
    expect(biddersByCategory(lines, { l1: ['a', 'b'], l2: ['b'], l3: ['c'] })).toEqual({
      'IT Hardware': ['a', 'b'],
      'Facilities & MRO': ['c'],
    });
  });

  it('keeps a category with no ticks in the result rather than dropping it', () => {
    // A category that vanishes reads as a category with nothing wrong with it.
    expect(biddersByCategory(lines, { l1: ['a'] })).toEqual({
      'IT Hardware': ['a'],
      'Facilities & MRO': [],
    });
  });
});

describe('coverage judged line by line', () => {
  const nova = supplier({ id: 'nova', name: 'Nova' });
  const metro = supplier({ id: 'metro', name: 'Metro', isProvisional: true });
  const master = [nova, metro];
  const line = (id: string, itemCode: string, invitedIds: string[]) =>
    ({ id, itemCode, description: itemCode, invitedIds });

  it('blocks publish on a line nobody was ticked against', () => {
    const issues = validateLineCoverage([line('l1', 'NET-043', [])], master);
    expect(issues[0].blocking).toBe(true);
    expect(issues[0].message).toContain('NET-043');
    expect(issues[0].message).toContain('nobody to price it');
  });

  it('names up to three bare lines, then counts the rest', () => {
    const bare = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5'].map((code, i) => line(`l${i}`, code, []));
    expect(validateLineCoverage(bare, master)[0].message).toContain('A-1, A-2, A-3 and 2 more');
  });

  it('warns a line with exactly one bidder without blocking it', () => {
    const issues = validateLineCoverage([line('l1', 'MON-019', ['nova'])], master);
    expect(issues).toHaveLength(1);
    expect(issues[0].tone).toBe('warning');
    expect(issues[0].blocking).toBeUndefined();
    expect(issues[0].message).toContain('no competition on price');
  });

  it('blocks a line every bidder on it is provisional', () => {
    // It can be bid and it cannot be awarded, which is a different failure
    // from an empty line and is reported as its own.
    const issues = validateLineCoverage([line('l1', 'BAT-095', ['metro'])], master);
    expect(issues.some((i) => i.blocking && i.message.includes('could be awarded'))).toBe(true);
  });

  it('says nothing about a line two awardable vendors are on', () => {
    const other = supplier({ id: 'orion', name: 'Orion' });
    expect(validateLineCoverage([line('l1', 'LAP-005', ['nova', 'orion'])], [...master, other]))
      .toEqual([]);
  });
});

describe('the roster beside the invitations', () => {
  const nova = supplier({ id: 'nova', name: 'Nova' });
  const metro = supplier({ id: 'metro', name: 'Metro', isProvisional: true });
  const master = [nova, metro];

  it('blocks an event with nobody on it', () => {
    expect(validateRoster([], [], master)[0].blocking).toBe(true);
  });

  it('counts the roster and separates who could actually be awarded', () => {
    const issues = validateRoster(['nova', 'metro'], ['nova', 'metro'], master);
    expect(issues[0].message).toBe('2 vendors on the event · 1 onboarded, 1 provisional');
    expect(issues.some((i) => i.message.includes('cannot be awarded until onboarding'))).toBe(true);
  });

  it('warns about a vendor sitting on the event with no line to price', () => {
    const issues = validateRoster(['nova', 'metro'], ['nova'], master);
    expect(issues.some((i) => i.message.includes('invited to no line'))).toBe(true);
  });
});
