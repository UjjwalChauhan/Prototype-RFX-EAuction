/**
 * Evaluation and scoring, including the corrected non-overlapping award score.
 *
 * The legacy formula `Combined = Price x 40% + RFP Score x 60%` double-counts
 * price at an effective 64% because the RFP score itself contains price. The
 * model here forces price into exactly one component and validates it.
 */
import type {
  AwardScoreComponent, ConsensusMode, Id, PriceScoreMethod, Question, Score,
  Side, TechnicalGate,
} from './types';
import { bestOf, isBetter } from './comparator';

// ---------------------------------------------------------------------------
// Question scoring
// ---------------------------------------------------------------------------

/** Latest score per (bidder, question, evaluator) from the append-only chain. */
export function effectiveScores(scores: Score[]): Score[] {
  const overridden = new Set(scores.map((s) => s.overridesScoreId).filter(Boolean) as Id[]);
  return scores.filter((s) => !overridden.has(s.id));
}

export interface ConsensusResult {
  value: number | null;
  evaluatorCount: number;
  /** Spread between the highest and lowest evaluator, as a percentage of max. */
  divergencePct: number;
  /** Divergence beyond the threshold is flagged for moderation. */
  needsModeration: boolean;
}

export function consensus(
  scores: Score[],
  maxScore: number,
  mode: ConsensusMode,
  divergenceThreshold: number,
): ConsensusResult {
  const values = scores.map((s) => s.value);
  if (values.length === 0) {
    return { value: null, evaluatorCount: 0, divergencePct: 0, needsModeration: false };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const divergencePct = maxScore > 0 ? ((max - min) / maxScore) * 100 : 0;

  let value: number;
  switch (mode) {
    case 'SINGLE':
      value = values[values.length - 1];
      break;
    case 'MODERATED':
    case 'AVERAGE':
    default:
      value = values.reduce((a, b) => a + b, 0) / values.length;
  }

  return {
    value,
    evaluatorCount: values.length,
    divergencePct,
    needsModeration: divergencePct > divergenceThreshold,
  };
}

export interface TechnicalResult {
  bidderId: Id;
  /** Weighted percentage across scored technical questions. */
  score: number;
  answered: number;
  total: number;
  knockoutFailed: { questionId: Id; title: string }[];
  passesGate: boolean;
}

export function technicalScore(
  bidderId: Id,
  questions: Question[],
  scores: Score[],
  gate: TechnicalGate,
  minScore: number,
  mode: ConsensusMode = 'AVERAGE',
  divergenceThreshold = 20,
): TechnicalResult {
  const technical = questions.filter(
    (q) => q.envelope === 'TECHNICAL' && q.scoringMethod !== 'NONE' && q.weight > 0,
  );
  const live = effectiveScores(scores).filter((s) => s.bidderId === bidderId);

  let weightedTotal = 0;
  let weightSum = 0;
  let answered = 0;
  const knockoutFailed: { questionId: Id; title: string }[] = [];

  for (const question of technical) {
    const forQuestion = live.filter((s) => s.questionId === question.id);
    const result = consensus(forQuestion, question.maxScore, mode, divergenceThreshold);
    weightSum += question.weight;
    if (result.value === null) continue;
    answered += 1;
    const pct = question.maxScore > 0 ? (result.value / question.maxScore) * 100 : 0;
    weightedTotal += pct * question.weight;
    // A knockout at zero immediately disqualifies, citing the failing question.
    if (question.isKnockout && result.value <= 0) {
      knockoutFailed.push({ questionId: question.id, title: question.title });
    }
  }

  const score = weightSum > 0 ? weightedTotal / weightSum : 0;

  let passesGate = true;
  if (knockoutFailed.length > 0 && (gate === 'PASS_FAIL' || gate === 'BOTH' || gate === 'MIN_SCORE')) {
    passesGate = false;
  } else if (gate === 'MIN_SCORE' || gate === 'BOTH') {
    passesGate = score >= minScore;
  }

  return { bidderId, score, answered, total: technical.length, knockoutFailed, passesGate };
}

// ---------------------------------------------------------------------------
// Section scoring — what each part of the questionnaire earned
// ---------------------------------------------------------------------------

export interface SectionScore {
  sectionId: Id | null;
  name: string;
  /** What the section set aside for its questions. */
  declaredWeight: number;
  /** What its scored questions actually carry. Scoring runs off this. */
  allocatedWeight: number;
  /**
   * The section's own result on the questionnaire's scale, or null when
   * nothing in it has been scored yet.
   *
   * Reported out of the scale, not out of the section's weight: an evaluator
   * reading "7.5 of 10" for one section and "7.5 of 10" for another is reading
   * two comparable statements of how well the supplier did. How much each one
   * *counts* is `allocatedWeight`, and that is a separate number precisely so
   * the two cannot be confused.
   */
  score: number | null;
  /** How much of this section contributes to the overall, as a percentage. */
  sharePct: number;
  scored: number;
  total: number;
}

export interface ScoreBreakdown {
  /** One per section, in section order, plus the ungrouped questions last. */
  sections: SectionScore[];
  /** The whole questionnaire on its scale, or null when nothing is scored. */
  overall: number | null;
  scale: number;
  /** Total weight actually in play — the sum of the sections' allocations. */
  weight: number;
  scored: number;
  total: number;
}

/**
 * A supplier's result, split by section and totalled.
 *
 * Two deliberate choices, both of which change what the numbers mean.
 *
 * **The overall is weighted by question, not by section.** A section's
 * influence is the sum of what its questions carry, so a section that set aside
 * 40 and allocated 30 counts 30. Holding it to 40 would make the missing 10
 * unearnable and mark every supplier down for the buyer's arithmetic.
 *
 * **An unscored question is excluded, not counted as zero.** A half-evaluated
 * response would otherwise look like a bad one, and the ranking would move
 * every time an evaluator got round to another answer. `scored` against
 * `total` is what says how much of the picture this is.
 */
export function scoreBreakdown({
  bidderId, questions, sections, scores, scale = 100,
  mode = 'AVERAGE', divergenceThreshold = 20,
}: {
  bidderId: Id;
  questions: Question[];
  sections: { id: Id; name: string; sequence: number; weight: number }[];
  scores: Score[];
  scale?: number;
  mode?: ConsensusMode;
  divergenceThreshold?: number;
}): ScoreBreakdown {
  const live = effectiveScores(scores).filter((s) => s.bidderId === bidderId);
  const counts = (q: Question) =>
    q.scoringMethod !== 'NONE' && q.weight > 0 && q.maxScore > 0;

  /** One group's result: the weighted ratio of what was scored in it. */
  const resultFor = (group: Question[]) => {
    let weighted = 0;
    let weightSum = 0;
    let scored = 0;
    for (const question of group.filter(counts)) {
      const consensusValue = consensus(
        live.filter((s) => s.questionId === question.id),
        question.maxScore, mode, divergenceThreshold,
      ).value;
      if (consensusValue === null) continue;
      scored += 1;
      weightSum += question.weight;
      weighted += (consensusValue / question.maxScore) * question.weight;
    }
    return { weighted, weightSum, scored };
  };

  const ordered = [...sections].sort((a, b) => a.sequence - b.sequence);
  const grouped: { id: Id | null; name: string; declared: number; questions: Question[] }[] = [
    ...ordered.map((section) => ({
      id: section.id as Id | null,
      name: section.name,
      declared: Math.max(0, section.weight),
      questions: questions.filter((q) => q.sectionId === section.id),
    })),
  ];
  // Questions in no section still score; they are reported together so the
  // parts add up to the whole rather than quietly going missing.
  const loose = questions.filter(
    (q) => q.sectionId === null || !ordered.some((section) => section.id === q.sectionId),
  );
  if (loose.length > 0) {
    grouped.push({ id: null, name: 'Ungrouped questions', declared: 0, questions: loose });
  }

  const allocationOf = (group: Question[]) =>
    group.filter(counts).reduce((sum, q) => sum + q.weight, 0);

  const totalAllocated = grouped.reduce((sum, g) => sum + allocationOf(g.questions), 0);

  const sectionScores: SectionScore[] = grouped.map((group) => {
    const { weighted, weightSum, scored } = resultFor(group.questions);
    const allocated = allocationOf(group.questions);
    return {
      sectionId: group.id,
      name: group.name,
      declaredWeight: group.declared,
      allocatedWeight: allocated,
      score: weightSum > 0 ? (weighted / weightSum) * scale : null,
      sharePct: totalAllocated > 0 ? (allocated / totalAllocated) * 100 : 0,
      scored,
      total: group.questions.filter(counts).length,
    };
  });

  const all = resultFor(questions);

  return {
    sections: sectionScores,
    overall: all.weightSum > 0 ? (all.weighted / all.weightSum) * scale : null,
    scale,
    weight: totalAllocated,
    scored: all.scored,
    total: questions.filter(counts).length,
  };
}

// ---------------------------------------------------------------------------
// Price normalisation
// ---------------------------------------------------------------------------

/**
 * Convert a transformed commercial value into a 0-100 score.
 * The method used is always disclosed alongside the formula.
 */
export function priceScore(
  value: number,
  allValues: number[],
  method: PriceScoreMethod,
  side: Side,
  targetPrice: number | null = null,
): number {
  const best = bestOf(allValues, side);
  if (best === null || value === 0) return 0;

  switch (method) {
    case 'RATIO':
      // BUY: best/this. SELL: this/best. Best always scores 100.
      return side === 'BUY' ? (best / value) * 100 : (value / best) * 100;

    case 'LINEAR': {
      const worst = side === 'BUY' ? Math.max(...allValues) : Math.min(...allValues);
      if (worst === best) return 100;
      const span = Math.abs(worst - best);
      return (1 - Math.abs(value - best) / span) * 100;
    }

    case 'TARGET_RELATIVE': {
      if (targetPrice === null || targetPrice === 0) return 0;
      if (isBetter(value, targetPrice, side) || value === targetPrice) return 100;
      const away = Math.abs((value - targetPrice) / targetPrice);
      return Math.max(0, (1 - away) * 100);
    }
  }
}

// ---------------------------------------------------------------------------
// Award score — the corrected, non-overlapping model
// ---------------------------------------------------------------------------

export interface AwardScoreValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Weights must sum to 100 and price must appear in exactly one component.
 * A configuration that double-counts price is a configuration error, not a
 * stylistic choice — it is the 64%-effective-weight bug from the source system.
 */
export function validateAwardScoreModel(components: AwardScoreComponent[]): AwardScoreValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const active = components.filter((c) => c.weight > 0);
  const sum = active.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(sum - 100) > 0.001) {
    errors.push(`Weights total ${sum}%. They must sum to 100%.`);
  }

  const priceCarriers = active.filter((c) => c.containsPrice);
  if (priceCarriers.length === 0) {
    warnings.push('No component carries price. The award score will be entirely non-commercial.');
  } else if (priceCarriers.length > 1) {
    const names = priceCarriers.map((c) => c.label).join(' and ');
    const effective = priceCarriers.reduce((a, c) => a + c.weight, 0);
    errors.push(
      `Price appears in more than one component (${names}), giving it an effective weight of ${effective}%. ` +
      'Price must appear in exactly one component.',
    );
  }

  if (active.some((c) => c.weight < 0)) errors.push('A component weight cannot be negative.');

  return { valid: errors.length === 0, errors, warnings };
}

export interface AwardScoreInput {
  price_score?: number;
  technical_score?: number;
  commercial_terms_score?: number;
  performance_rating?: number;
  qualification_rating?: number;
}

export interface AwardScoreBreakdown {
  total: number;
  contributions: { key: string; label: string; weight: number; score: number; contribution: number }[];
}

export function awardScore(
  input: AwardScoreInput,
  components: AwardScoreComponent[],
): AwardScoreBreakdown {
  const contributions = components
    .filter((c) => c.weight > 0)
    .map((c) => {
      const score = input[c.key] ?? 0;
      return {
        key: c.key,
        label: c.label,
        weight: c.weight,
        score,
        contribution: (c.weight / 100) * score,
      };
    });
  return {
    total: contributions.reduce((a, c) => a + c.contribution, 0),
    contributions,
  };
}

/** Human-readable formula, rendered identically in the vendor portal. */
export function formulaText(components: AwardScoreComponent[], method: PriceScoreMethod): string {
  const parts = components
    .filter((c) => c.weight > 0)
    .map((c) => `${c.label} x ${c.weight}%`);
  return `Award Score = ${parts.join('  +  ')}   (price normalised by ${method})`;
}

export const DEFAULT_AWARD_COMPONENTS: AwardScoreComponent[] = [
  { key: 'price_score', label: 'Price', weight: 45, containsPrice: true },
  { key: 'technical_score', label: 'Technical', weight: 35, containsPrice: false },
  { key: 'commercial_terms_score', label: 'Commercial terms', weight: 10, containsPrice: false },
  { key: 'performance_rating', label: 'Performance rating', weight: 10, containsPrice: false },
  { key: 'qualification_rating', label: 'Qualification rating', weight: 0, containsPrice: false },
];
