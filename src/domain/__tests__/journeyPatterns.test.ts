/**
 * The master patterns, held to the one thing a pattern must be: publishable.
 *
 * A pattern declares the asks it puts to a supplier and the wizard steps a
 * buyer walks. Publishing is blocked when an ask goes out with no terms
 * attached, so a pattern that asks for something and offers no step to attach
 * terms at is a dead end — the buyer reaches Review, sees a blocking item, and
 * has nowhere to go and fix it. That is not a validation message; it is a
 * pattern nobody can use.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PATTERNS, WIZARD_TERMS } from '../journeyPatterns';
import { alignTermsToJourney, instantiateTerms, validateTerms } from '../terms';
import { TERMS_TEMPLATES } from '../../data/termsTemplates';

/** The two the wizard seeds a draft with, before the buyer touches anything. */
const seeded = () => [
  instantiateTerms(TERMS_TEMPLATES[0], 'draft'),
  instantiateTerms(TERMS_TEMPLATES[1], 'draft'),
];

describe('every master pattern', () => {
  it('offers a terms step wherever it asks the supplier for something', () => {
    for (const pattern of ALL_PATTERNS) {
      expect(
        pattern.wizardSteps.includes(WIZARD_TERMS),
        `${pattern.id} · ${pattern.name} asks at ${pattern.vendorInputPoints.join(', ') || 'nothing'}`,
      ).toBe(pattern.vendorInputPoints.length > 0);
    }
  });

  it('publishes on the terms the wizard seeds, without the buyer editing them', () => {
    for (const pattern of ALL_PATTERNS) {
      const terms = alignTermsToJourney(seeded(), pattern.vendorInputPoints);
      const blocking = validateTerms(terms, pattern.vendorInputPoints)
        .filter((issue) => issue.blocking);
      expect(blocking.map((issue) => issue.message), pattern.id).toEqual([]);
    }
  });

  it('asks only at stages it actually runs', () => {
    for (const pattern of ALL_PATTERNS) {
      for (const point of pattern.vendorInputPoints) {
        expect(pattern.stages, pattern.id).toContain(point);
      }
    }
  });

  it('opens on basics and ends on review, whatever shape it takes', () => {
    for (const pattern of ALL_PATTERNS) {
      expect(pattern.wizardSteps[0], pattern.id).toBe('Basics');
      expect(pattern.wizardSteps[pattern.wizardSteps.length - 1], pattern.id).toBe('Review');
    }
  });
});
