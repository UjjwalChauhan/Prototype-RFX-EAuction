/**
 * Per-category shortlisting: what the system proposes, and what it insists on.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_BIDDERS_PER_CATEGORY, defaultShortlist, rankForCategory, servesCategory,
  suggestBidders, validateCoverage,
} from '../bidders';
import { COUNTERPARTIES } from '../../data/seed';
import type { Counterparty } from '../types';

function supplier(over: Partial<Counterparty> = {}): Counterparty {
  return {
    id: 'cp-x', name: 'X', onboardingRating: 80, performanceRating: 70,
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
