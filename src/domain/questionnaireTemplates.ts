/**
 * Questionnaire templates: what the buyer asks the supplier, and what each
 * asking is worth.
 *
 * The organising idea is that **a questionnaire is not owned by a stage.** An
 * RFx journey asks the supplier for information at several points — RFI to
 * qualify, RFP to evaluate, RFQ to price, negotiation to re-confirm — and the
 * same capability set is routinely asked more than once. So a template declares
 * the `VendorInputPoint`s it may be applied at, and the journey decides which
 * of those actually run. That is the same list `JourneyPattern.vendorInputPoints`
 * already drives the supplier task rail from.
 *
 * Three rules this module exists to enforce:
 *
 * 1. **Price never carries a question weight.** Price reaches the award score
 *    through the price component alone; a priced question that also scores puts
 *    price in two places, which is the same defect `validateAwardScoreModel`
 *    catches on the award side.
 * 2. **RFI is pre-commercial.** RFI qualifies the market before anyone is asked
 *    for a price, so a template applied at RFI may not carry commercial
 *    questions — that is what the stage means, not a preference.
 * 3. **Weight without scoring is dead weight.** A question weighted but never
 *    scored silently contributes nothing, and the total it inflates makes every
 *    other question look less influential than it is.
 */
import { STAGE_LABELS } from './journeyPatterns';
import { defaultConfigFor, validateQuestionConfig } from './questionTypes';
import type {
  Id, QuestionType, QuestionnaireTemplate, ServerMillis, Stage, StageWeight,
  TemplateQuestion, TemplateStatus, VendorInputPoint,
} from './types';

/** Question types that carry a price. None of them may be weighted. */
export const PRICED_QUESTION_TYPES: QuestionType[] = [
  'price_schedule', 'rate_table', 'quantity_break',
];

/** The points in a journey where a supplier can be asked for information. */
export const VENDOR_INPUT_POINTS: VendorInputPoint[] = [
  'INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION',
];

/** What the buyer is actually trying to learn at each point. */
export const POINT_PURPOSE: Record<VendorInputPoint, string> = {
  INTAKE: 'An indicative price against demand that has not been specified yet.',
  RFI: 'Capability, credentials and compliance — before anyone is asked for a price.',
  RFP: 'A full proposal: method, scope and the commercials that go with it.',
  RFQ: 'Prices against a specification that is already fixed.',
  NEGOTIATION: 'A revised position against a counter-offer.',
  AUCTION: 'A live bid. Anything not asked before the auction opens cannot be asked during it.',
};

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  RETIRED: 'Retired',
};

export function pointLabel(point: VendorInputPoint): string {
  return STAGE_LABELS[point as Stage];
}

// ---------------------------------------------------------------------------
// Weighting
// ---------------------------------------------------------------------------

export interface Weighted {
  weight: number;
}

export interface NormalisedWeight<T> {
  item: T;
  weight: number;
  /** Share of the total, as a percentage. 0 when nothing carries weight. */
  effectivePct: number;
}

/**
 * Weights are relative, not percentages — the studio lets a buyer enter 10, 15
 * and 20 without doing arithmetic. What matters is the share each ends up with,
 * so every screen shows the normalised figure alongside the raw one.
 */
export function normalise<T extends Weighted>(items: T[]): NormalisedWeight<T>[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return items.map((item) => ({
    item,
    weight: item.weight,
    effectivePct: total === 0 ? 0 : (Math.max(0, item.weight) / total) * 100,
  }));
}

/** Total weight a template carries. Priced questions contribute nothing. */
export function templateWeight(template: QuestionnaireTemplate): number {
  return scoredQuestions(template).reduce((sum, q) => sum + q.weight, 0);
}

/** Questions that actually reach the score: weighted, and scored by something. */
export function scoredQuestions(template: QuestionnaireTemplate): TemplateQuestion[] {
  return template.questions.filter(
    (q) => q.weight > 0 && q.scoringMethod !== 'NONE' && !PRICED_QUESTION_TYPES.includes(q.type),
  );
}

export function questionsInSection(
  template: QuestionnaireTemplate, sectionId: Id | null,
): TemplateQuestion[] {
  return template.questions
    .filter((q) => q.sectionId === sectionId)
    .sort((a, b) => a.sequence - b.sequence);
}

// ---------------------------------------------------------------------------
// Applying templates across a journey
// ---------------------------------------------------------------------------

/** Templates that may be used at a point, for a category. */
export function templatesFor(
  templates: QuestionnaireTemplate[],
  point: VendorInputPoint,
  category: string | null = null,
): QuestionnaireTemplate[] {
  return templates.filter(
    (t) =>
      t.status !== 'RETIRED' &&
      t.appliesTo.includes(point) &&
      (category === null || t.categories.length === 0 || t.categories.includes(category)),
  );
}

/**
 * A question code asked at more than one point.
 *
 * This is the payoff of a stable code: a supplier who declared ISO 9001 at RFI
 * should see it carried into RFP, not be asked again. Surfacing the overlap is
 * how a buyer decides which askings to inherit and which to genuinely re-ask.
 */
export interface InheritedCode {
  code: string;
  title: string;
  points: VendorInputPoint[];
  /** The templates that ask it. */
  templateIds: Id[];
  /**
   * True when two *different* templates ask the same code — a genuine second
   * asking in the journey, and the case worth inheriting. A single template
   * reused at two points is one asking that happens to be available twice.
   */
  reAsked: boolean;
}

export function inheritedCodes(templates: QuestionnaireTemplate[]): InheritedCode[] {
  const byCode = new Map<
    string,
    { title: string; points: Set<VendorInputPoint>; templateIds: Set<Id> }
  >();

  for (const template of templates) {
    if (template.status === 'RETIRED') continue;
    for (const question of template.questions) {
      const entry = byCode.get(question.code)
        ?? { title: question.title, points: new Set<VendorInputPoint>(), templateIds: new Set<Id>() };
      for (const point of template.appliesTo) entry.points.add(point);
      entry.templateIds.add(template.id);
      byCode.set(question.code, entry);
    }
  }

  return Array.from(byCode.entries())
    .filter(([, entry]) => entry.points.size > 1)
    .map(([code, entry]) => ({
      code,
      title: entry.title,
      points: VENDOR_INPUT_POINTS.filter((p) => entry.points.has(p)),
      templateIds: Array.from(entry.templateIds).sort(),
      reAsked: entry.templateIds.size > 1,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The weighting actually in force for a journey: only the points the journey
 * runs, renormalised over those. A tenant weighting that mentions RFI is simply
 * not applied by a journey with no RFI stage.
 */
export function weightingForJourney(
  weights: StageWeight[],
  vendorInputPoints: VendorInputPoint[],
): NormalisedWeight<StageWeight>[] {
  const applicable = VENDOR_INPUT_POINTS
    .filter((point) => vendorInputPoints.includes(point))
    .map((point) => weights.find((w) => w.point === point) ?? { point, weight: 0 });
  return normalise(applicable);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TemplateIssue {
  code: string;
  message: string;
  /** The question the issue is about, when it is about one. */
  questionId?: Id;
}

export interface TemplateValidation {
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  valid: boolean;
}

export function validateTemplate(
  template: QuestionnaireTemplate,
  takenNames: string[] = [],
): TemplateValidation {
  const errors: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];

  const name = template.name.trim();
  if (name.length === 0) {
    errors.push({ code: 'NAME_REQUIRED', message: 'A template needs a name a buyer will recognise when picking one.' });
  } else if (takenNames.some((t) => t.trim().toLowerCase() === name.toLowerCase())) {
    errors.push({ code: 'NAME_TAKEN', message: `"${name}" is already the name of a template visible at this scope.` });
  }

  if (template.appliesTo.length === 0) {
    errors.push({
      code: 'NO_APPLIES_TO',
      message: 'Choose at least one point in the journey where this template is put in front of a supplier. A template applied nowhere is never asked.',
    });
  }

  if (template.questions.length === 0) {
    errors.push({ code: 'NO_QUESTIONS', message: 'A template with no questions asks the supplier for nothing.' });
  }

  // A code is the join key for answer inheritance — duplicates break it.
  const seen = new Map<string, number>();
  for (const question of template.questions) {
    seen.set(question.code, (seen.get(question.code) ?? 0) + 1);
  }
  for (const [code, count] of seen) {
    if (count > 1) {
      errors.push({
        code: 'DUPLICATE_CODE',
        message: `Code ${code} is used by ${count} questions. Codes carry answers across stages, so they must be unique within a template.`,
      });
    }
  }

  for (const question of template.questions) {
    // Rule 1 — price reaches the score through the price component alone.
    if (PRICED_QUESTION_TYPES.includes(question.type) && question.weight > 0) {
      errors.push({
        code: 'PRICE_CARRIES_WEIGHT',
        questionId: question.id,
        message: `"${question.title}" is a ${question.type} carrying weight ${question.weight}. Price enters the award score through the price component only — weighting it here counts price twice.`,
      });
    }

    // Rule 3 — weight that never reaches a score.
    if (question.weight > 0 && question.scoringMethod === 'NONE'
        && !PRICED_QUESTION_TYPES.includes(question.type)) {
      errors.push({
        code: 'WEIGHT_WITHOUT_SCORING',
        questionId: question.id,
        message: `"${question.title}" carries weight ${question.weight} but is not scored, so the weight is inert and makes every other question look less influential than it is.`,
      });
    }

    if (question.weight === 0 && question.scoringMethod !== 'NONE'
        && !PRICED_QUESTION_TYPES.includes(question.type)) {
      warnings.push({
        code: 'SCORED_WITHOUT_WEIGHT',
        questionId: question.id,
        message: `"${question.title}" is scored but carries no weight, so evaluators spend time on an answer that cannot change the ranking.`,
      });
    }

    // A knockout the supplier can skip never fires.
    if (question.isKnockout && !question.isRequired) {
      warnings.push({
        code: 'OPTIONAL_KNOCKOUT',
        questionId: question.id,
        message: `"${question.title}" disqualifies on failure but is optional, so a supplier who leaves it blank is never knocked out.`,
      });
    }

    // Whether the answer format is actually askable: choices that exist, a
    // rule that has something to compute, a knockout that can fire.
    const config = validateQuestionConfig(question);
    for (const issue of config.errors) {
      errors.push({ ...issue, questionId: question.id });
    }
    for (const issue of config.warnings) {
      warnings.push({ ...issue, questionId: question.id });
    }
  }

  // Rule 2 — RFI is pre-commercial by definition.
  if (template.appliesTo.includes('RFI')) {
    const commercial = template.questions.filter((q) => q.envelope === 'COMMERCIAL');
    if (commercial.length > 0) {
      errors.push({
        code: 'COMMERCIAL_AT_RFI',
        message: `${commercial.length} commercial ${commercial.length === 1 ? 'question' : 'questions'} in a template applied at RFI. RFI qualifies the market before anyone is asked for a price — move them to a template applied at RFP or RFQ.`,
      });
    }
  }

  // A price schedule only means something once there are lines to price.
  const priced = template.questions.filter((q) => PRICED_QUESTION_TYPES.includes(q.type));
  if (priced.length > 0 && template.appliesTo.includes('INTAKE')) {
    warnings.push({
      code: 'PRICED_AT_INTAKE',
      message: 'A priced question applied at intake asks for a price against demand that is not specified yet — the answer will be indicative at best.',
    });
  }

  if (template.questions.length > 0 && scoredQuestions(template).length === 0) {
    warnings.push({
      code: 'GATHERS_ONLY',
      message: 'Nothing in this template is scored, so it gathers information without contributing to the ranking. That is right for a pure RFI and wrong for an RFP.',
    });
  }

  const orphaned = template.questions.filter(
    (q) => q.sectionId !== null && !template.sections.some((s) => s.id === q.sectionId),
  );
  if (orphaned.length > 0) {
    errors.push({
      code: 'ORPHANED_QUESTION',
      message: `${orphaned.length} ${orphaned.length === 1 ? 'question is' : 'questions are'} assigned to a section that does not exist in this template.`,
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

export interface WeightingValidation {
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  valid: boolean;
}

/**
 * Stage weighting is validated against the templates that exist: a point given
 * weight but served by no template contributes a score that will never arrive.
 */
export function validateWeighting(
  weights: StageWeight[],
  templates: QuestionnaireTemplate[],
  vendorInputPoints: VendorInputPoint[],
): WeightingValidation {
  const errors: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];

  const inForce = weightingForJourney(weights, vendorInputPoints);
  const total = inForce.reduce((sum, w) => sum + Math.max(0, w.weight), 0);

  if (inForce.length === 0) {
    warnings.push({
      code: 'NO_INPUT_POINTS',
      message: 'This journey never asks the supplier for information, so there is nothing to weight.',
    });
    return { errors, warnings, valid: true };
  }

  if (total === 0) {
    errors.push({
      code: 'ALL_ZERO',
      message: 'Every point carries zero weight, so no questionnaire contributes to the technical score.',
    });
  }

  for (const entry of inForce) {
    const point = entry.item.point;
    const available = templatesFor(templates, point);
    if (entry.weight > 0 && available.length === 0) {
      errors.push({
        code: 'WEIGHTED_POINT_UNSERVED',
        message: `${pointLabel(point)} carries ${entry.effectivePct.toFixed(0)}% of the technical score but no template is applied there, so that share can never be earned.`,
      });
    }
    if (entry.weight === 0 && available.length > 0) {
      warnings.push({
        code: 'UNWEIGHTED_POINT_SERVED',
        message: `${pointLabel(point)} has ${available.length} template(s) but no weight — suppliers answer, and the answers change nothing.`,
      });
    }
  }

  if (total !== 100 && total !== 0) {
    warnings.push({
      code: 'NOT_HUNDRED',
      message: `Weights total ${total}, not 100. They are normalised, so the split still works — the effective share of each point is shown beside it.`,
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export const TEMPLATE_CUSTOM_KEY = 'questionnaire.templates';
export const TEMPLATE_WEIGHTING_KEY = 'questionnaire.stage_weighting';

export function nextTemplateId(existing: QuestionnaireTemplate[]): string {
  const used = existing
    .map((t) => Number(t.id.replace('qt-', '')))
    .filter((n) => Number.isFinite(n));
  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  return `qt-${String(next).padStart(3, '0')}`;
}

/** A code derived from the name, kept stable once assigned. */
export function suggestCode(name: string, appliesTo: VendorInputPoint[]): string {
  const point = appliesTo[0] ?? 'RFI';
  const words = name
    .trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Truncate at a word boundary — a code cut mid-word reads as a typo, and
  // these are meant to be recognised at a glance in a template list.
  let slug = '';
  for (const word of words.split('-').filter(Boolean)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 18) break;
    slug = next;
  }
  if (slug === '') slug = words.slice(0, 18);

  return `QT-${point}-${slug || 'UNTITLED'}`;
}

export function emptyTemplate({
  id, scopeType, scopeId, userId, now,
}: {
  id: Id; scopeType: QuestionnaireTemplate['scopeType']; scopeId: Id;
  userId: Id; now: ServerMillis;
}): QuestionnaireTemplate {
  return {
    id,
    code: '',
    name: '',
    description: '',
    appliesTo: ['RFI'],
    categories: [],
    sections: [{ id: `${id}-sec-1`, name: 'General', sequence: 1 }],
    questions: [],
    status: 'DRAFT',
    version: 1,
    scopeType,
    scopeId,
    createdBy: userId,
    createdAt: now,
  };
}

export function newQuestion(
  template: QuestionnaireTemplate, sectionId: Id | null,
): TemplateQuestion {
  const sequence = template.questions.length + 1;
  return {
    id: `${template.id}-q-${sequence}-${template.questions.length}`,
    templateId: template.id,
    sectionId,
    sequence,
    code: `Q.${sequence}`,
    type: 'short_text',
    title: 'New question',
    helpText: '',
    isRequired: true,
    envelope: 'TECHNICAL',
    weight: 10,
    scoringMethod: 'MANUAL',
    maxScore: 10,
    rubric: null,
    isKnockout: false,
    allowAttachment: false,
    config: defaultConfigFor('short_text', `${template.id}-q-${sequence}`),
  };
}
