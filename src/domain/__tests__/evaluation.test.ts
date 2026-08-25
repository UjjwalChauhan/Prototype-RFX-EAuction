/**
 * Evaluation and the corrected award-score model.
 *
 * The legacy formula `Combined = Price x 40% + RFP Score x 60%` double-counts
 * price because the RFP score contains price, giving price an effective 64%.
 * The validator exists to make that configuration impossible to save quietly.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AWARD_COMPONENTS, awardScore, consensus, effectiveScores, formulaText,
  priceScore, technicalScore, validateAwardScoreModel,
} from '../evaluation';
import type { AwardScoreComponent, Question, Score } from '../types';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1', questionnaireId: 'qn1', sectionId: null, sequence: 1, code: 'Q1',
    type: 'number', title: 'Question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false,
    ...overrides,
  };
}

function score(overrides: Partial<Score> = {}): Score {
  return {
    id: 's1', eventId: 'evt1', bidderId: 'b1', questionId: 'q1', evaluatorId: 'e1',
    value: 8, comment: '', method: 'MANUAL', agentConfidence: null, citedEvidence: null,
    overridesScoreId: null, overrideReason: null, createdAt: 0,
    ...overrides,
  };
}

describe('effectiveScores', () => {
  it('drops a score that a later row overrides, and keeps the override', () => {
    const original = score({ id: 's1', value: 4 });
    const override = score({ id: 's2', value: 9, overridesScoreId: 's1', overrideReason: 'Revised' });
    const live = effectiveScores([original, override]);
    expect(live.map((s) => s.id)).toEqual(['s2']);
  });

  it('retains every non-overridden score', () => {
    const a = score({ id: 's1', questionId: 'q1' });
    const b = score({ id: 's2', questionId: 'q2' });
    expect(effectiveScores([a, b])).toHaveLength(2);
  });
});

describe('consensus', () => {
  it('averages evaluators by default', () => {
    const result = consensus([score({ value: 6 }), score({ value: 8 })], 10, 'AVERAGE', 20);
    expect(result.value).toBe(7);
    expect(result.evaluatorCount).toBe(2);
  });

  it('takes the latest under SINGLE', () => {
    const result = consensus([score({ value: 6 }), score({ value: 9 })], 10, 'SINGLE', 20);
    expect(result.value).toBe(9);
  });

  it('flags divergence beyond the threshold for moderation', () => {
    // A 3-to-9 spread on a 10-point scale is 60% divergence.
    const result = consensus([score({ value: 3 }), score({ value: 9 })], 10, 'AVERAGE', 20);
    expect(result.divergencePct).toBe(60);
    expect(result.needsModeration).toBe(true);
  });

  it('does not flag agreement', () => {
    const result = consensus([score({ value: 7 }), score({ value: 8 })], 10, 'AVERAGE', 20);
    expect(result.needsModeration).toBe(false);
  });

  it('returns null with no scores rather than zero', () => {
    // Unscored and scored-zero are different facts.
    const result = consensus([], 10, 'AVERAGE', 20);
    expect(result.value).toBeNull();
  });
});

describe('technicalScore', () => {
  const questions = [
    question({ id: 'q1', weight: 30, maxScore: 10 }),
    question({ id: 'q2', weight: 70, maxScore: 10 }),
    // Commercial questions must not enter the technical score.
    question({ id: 'q3', weight: 50, maxScore: 10, envelope: 'COMMERCIAL' }),
  ];

  it('weights questions and ignores the commercial envelope entirely', () => {
    const scores = [
      score({ id: 's1', questionId: 'q1', value: 10 }),
      score({ id: 's2', questionId: 'q2', value: 5 }),
      score({ id: 's3', questionId: 'q3', value: 0 }),
    ];
    const result = technicalScore('b1', questions, scores, 'MIN_SCORE', 60);
    // (100 x 30 + 50 x 70) / 100 = 65
    expect(result.score).toBe(65);
    expect(result.total).toBe(2);
  });

  it('passes the gate at or above the minimum and fails below it', () => {
    const high = technicalScore('b1', questions, [
      score({ id: 's1', questionId: 'q1', value: 10 }),
      score({ id: 's2', questionId: 'q2', value: 8 }),
    ], 'MIN_SCORE', 60);
    expect(high.passesGate).toBe(true);

    const low = technicalScore('b1', questions, [
      score({ id: 's1', questionId: 'q1', value: 4 }),
      score({ id: 's2', questionId: 'q2', value: 4 }),
    ], 'MIN_SCORE', 60);
    expect(low.passesGate).toBe(false);
  });

  it('fails a knockout regardless of the aggregate score', () => {
    const withKnockout = [
      question({ id: 'q1', weight: 30, maxScore: 10, isKnockout: true }),
      question({ id: 'q2', weight: 70, maxScore: 10 }),
    ];
    const result = technicalScore('b1', withKnockout, [
      score({ id: 's1', questionId: 'q1', value: 0 }),
      score({ id: 's2', questionId: 'q2', value: 10 }),
    ], 'MIN_SCORE', 60);
    expect(result.knockoutFailed).toHaveLength(1);
    expect(result.passesGate).toBe(false);
  });

  it('counts only the questions actually scored', () => {
    const result = technicalScore('b1', questions, [
      score({ id: 's1', questionId: 'q1', value: 10 }),
    ], 'NONE', 60);
    expect(result.answered).toBe(1);
    expect(result.total).toBe(2);
  });

  it('ignores another bidder\'s scores', () => {
    const result = technicalScore('b1', questions, [
      score({ id: 's1', questionId: 'q1', value: 10, bidderId: 'b2' }),
    ], 'NONE', 60);
    expect(result.answered).toBe(0);
  });
});

describe('priceScore', () => {
  const values = [100_000, 120_000, 150_000];

  it('gives the best price 100 under RATIO, on both sides', () => {
    expect(priceScore(100_000, values, 'RATIO', 'BUY')).toBe(100);
    expect(priceScore(150_000, values, 'RATIO', 'SELL')).toBe(100);
  });

  it('scales others in proportion under RATIO on BUY', () => {
    expect(priceScore(120_000, values, 'RATIO', 'BUY')).toBeCloseTo(83.33, 2);
  });

  it('spreads the field from 0 to 100 under LINEAR', () => {
    expect(priceScore(100_000, values, 'LINEAR', 'BUY')).toBe(100);
    expect(priceScore(150_000, values, 'LINEAR', 'BUY')).toBe(0);
    expect(priceScore(125_000, values, 'LINEAR', 'BUY')).toBe(50);
  });

  it('caps at 100 for anything at or better than target under TARGET_RELATIVE', () => {
    expect(priceScore(95_000, values, 'TARGET_RELATIVE', 'BUY', 100_000)).toBe(100);
    expect(priceScore(100_000, values, 'TARGET_RELATIVE', 'BUY', 100_000)).toBe(100);
    expect(priceScore(110_000, values, 'TARGET_RELATIVE', 'BUY', 100_000)).toBeCloseTo(90);
  });

  it('never goes negative', () => {
    expect(priceScore(500_000, values, 'TARGET_RELATIVE', 'BUY', 100_000)).toBe(0);
  });

  it('returns 0 rather than dividing by zero', () => {
    expect(priceScore(0, values, 'RATIO', 'BUY')).toBe(0);
    expect(priceScore(100_000, [], 'RATIO', 'BUY')).toBe(0);
  });
});

describe('validateAwardScoreModel', () => {
  it('accepts the default model', () => {
    const result = validateAwardScoreModel(DEFAULT_AWARD_COMPONENTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects weights that do not total 100', () => {
    const model: AwardScoreComponent[] = [
      { key: 'price_score', label: 'Price', weight: 40, containsPrice: true },
      { key: 'technical_score', label: 'Technical', weight: 40, containsPrice: false },
    ];
    const result = validateAwardScoreModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('80');
  });

  /** The specific bug the corrected model exists to prevent. */
  it('rejects the legacy double-counting configuration and names the effective weight', () => {
    const legacy: AwardScoreComponent[] = [
      { key: 'price_score', label: 'Price', weight: 40, containsPrice: true },
      // The RFP score itself contained price in the source system.
      { key: 'technical_score', label: 'RFP score', weight: 60, containsPrice: true },
    ];
    const result = validateAwardScoreModel(legacy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('more than one component'))).toBe(true);
    expect(result.errors.some((e) => e.includes('100%'))).toBe(true);
  });

  it('warns when nothing carries price at all', () => {
    const model: AwardScoreComponent[] = [
      { key: 'technical_score', label: 'Technical', weight: 100, containsPrice: false },
    ];
    const result = validateAwardScoreModel(model);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('No component carries price'))).toBe(true);
  });

  it('rejects a negative weight', () => {
    const model: AwardScoreComponent[] = [
      { key: 'price_score', label: 'Price', weight: 110, containsPrice: true },
      { key: 'technical_score', label: 'Technical', weight: -10, containsPrice: false },
    ];
    expect(validateAwardScoreModel(model).valid).toBe(false);
  });

  it('ignores zero-weight components when checking price overlap', () => {
    const model: AwardScoreComponent[] = [
      { key: 'price_score', label: 'Price', weight: 100, containsPrice: true },
      // Disabled, so it cannot double-count.
      { key: 'commercial_terms_score', label: 'Commercial', weight: 0, containsPrice: true },
    ];
    expect(validateAwardScoreModel(model).valid).toBe(true);
  });
});

describe('awardScore', () => {
  it('weights each component and sums the contributions', () => {
    const breakdown = awardScore(
      { price_score: 100, technical_score: 80, commercial_terms_score: 60, performance_rating: 90 },
      DEFAULT_AWARD_COMPONENTS,
    );
    // 45 + 28 + 6 + 9
    expect(breakdown.total).toBeCloseTo(88);
    expect(breakdown.contributions).toHaveLength(4);
  });

  it('treats a missing input as zero rather than dropping the weight', () => {
    const breakdown = awardScore({ price_score: 100 }, DEFAULT_AWARD_COMPONENTS);
    expect(breakdown.total).toBeCloseTo(45);
  });

  it('excludes zero-weight components from the breakdown', () => {
    const breakdown = awardScore({ qualification_rating: 90 }, DEFAULT_AWARD_COMPONENTS);
    expect(breakdown.contributions.some((c) => c.key === 'qualification_rating')).toBe(false);
  });
});

describe('formulaText', () => {
  it('states every active weight and the normalisation method', () => {
    const text = formulaText(DEFAULT_AWARD_COMPONENTS, 'RATIO');
    expect(text).toContain('Price x 45%');
    expect(text).toContain('Technical x 35%');
    expect(text).toContain('RATIO');
    // A zero-weight component is not advertised.
    expect(text).not.toContain('Qualification rating');
  });
});
