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
import { carryConfig, defaultConfigFor, validateQuestionConfig } from './questionTypes';
import type {
  Id, QuestionAudience, QuestionScope, QuestionType, Questionnaire, QuestionnaireTemplate,
  ServerMillis,
  SourcingEvent, Stage,
  StageWeight, TemplateQuestion, TemplateSection, TemplateStatus, VendorInputPoint,
} from './types';

/** Question types that carry a price. None of them may be weighted. */
export const PRICED_QUESTION_TYPES: QuestionType[] = [
  'price_schedule', 'rate_table', 'quantity_break',
];

/**
 * Who a question is put to, and why a buyer would choose each.
 *
 * The two are not interchangeable and the difference is not cosmetic. A
 * vendor-level question is answered once and is the same fact however many
 * lines the event carries — a certificate, a turnover figure, a policy. A
 * line-level question is answered once per line and genuinely differs between
 * them: lead time on a laptop is not lead time on a pallet of paper.
 *
 * Before this existed, buyers asked the line-level ones anyway and took the
 * answer as a spreadsheet attachment, which is the same information with none
 * of the structure — uncomparable across suppliers and unscoreable by anyone.
 */
export const QUESTION_SCOPES: { id: QuestionScope; label: string; purpose: string }[] = [
  {
    id: 'VENDOR',
    label: 'Per vendor',
    purpose: 'Asked once. The answer is about the company and is the same whatever is in the basket.',
  },
  {
    id: 'LINE',
    label: 'Per line item',
    purpose: 'Asked once for every line in the basket. The answer differs item by item.',
  },
];

export const QUESTION_SCOPE_LABEL: Record<QuestionScope, string> = {
  VENDOR: 'Per vendor',
  LINE: 'Per line item',
};

/**
 * Types that cannot sensibly be repeated per line.
 *
 * A price schedule already spans the whole basket — asking it per line would
 * put a grid of every line inside every line. Structural types display
 * something rather than ask for anything, so repeating them per line just
 * repeats the heading.
 */
export const BASKET_WIDE_TYPES: QuestionType[] = [
  'price_schedule', 'rate_table', 'quantity_break',
];

export const STRUCTURAL_TYPES: QuestionType[] = [
  'section', 'page_break', 'instruction_block', 'hidden_metadata',
];

export function canAskPerLine(type: QuestionType): boolean {
  return !BASKET_WIDE_TYPES.includes(type) && !STRUCTURAL_TYPES.includes(type);
}

/**
 * The scope a question actually runs at.
 *
 * The section owns the grain and the question follows it, with one exception
 * that is not a special case so much as a fact about the type: a price
 * schedule inside a per-line section is still asked once, because it already
 * spans the basket. A question in no section answers for itself.
 */
export function effectiveScope(
  question: Pick<TemplateQuestion, 'type' | 'askedPer' | 'sectionId'>,
  sections: TemplateSection[],
): QuestionScope {
  if (!canAskPerLine(question.type)) return 'VENDOR';
  const section = sections.find((s) => s.id === question.sectionId);
  return (section ? section.askedPer : question.askedPer);
}

/**
 * Move a section to the other grain, taking its questions with it.
 *
 * Questions whose type cannot be repeated per line are left alone rather than
 * dragged into an invalid state — a price schedule in a per-line section is
 * still one price schedule, and refusing the whole change over it would make
 * the control feel broken.
 */
export function setSectionScope(
  template: QuestionnaireTemplate, sectionId: Id, askedPer: QuestionScope,
): QuestionnaireTemplate {
  return {
    ...template,
    sections: template.sections.map((s) => (s.id === sectionId ? { ...s, askedPer } : s)),
    questions: template.questions.map((q) =>
      (q.sectionId === sectionId && canAskPerLine(q.type) ? { ...q, askedPer } : q)),
  };
}

/**
 * Put the sections in order and number everything from the top.
 *
 * `sequence` is what the builder, the preview and the supplier's form all read
 * the order from, so it has to be rewritten whenever anything moves rather
 * than left to drift. Questions are numbered straight through the form, not
 * restarted per section — question 9 is the ninth thing the supplier is asked,
 * which is how anyone talking about it will refer to it.
 */
function resequence(template: QuestionnaireTemplate): QuestionnaireTemplate {
  const sections = [...template.sections]
    .sort((a, b) => a.sequence - b.sequence)
    .map((section, index) => ({ ...section, sequence: index + 1 }));

  const ordered: TemplateQuestion[] = [];
  for (const section of sections) ordered.push(...questionsInSection(template, section.id));
  // Anything in no section, or pointing at a section that is gone, goes last
  // rather than being dropped — losing a question to a reorder would be the
  // worst possible outcome of pressing an arrow.
  ordered.push(...template.questions.filter((q) => !ordered.includes(q)));

  return {
    ...template,
    sections,
    questions: ordered.map((question, index) => ({ ...question, sequence: index + 1 })),
  };
}

/** Move a section one place up (-1) or down (+1) the form. */
export function moveSection(
  template: QuestionnaireTemplate, sectionId: Id, by: -1 | 1,
): QuestionnaireTemplate {
  const sections = [...template.sections].sort((a, b) => a.sequence - b.sequence);
  const at = sections.findIndex((s) => s.id === sectionId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= sections.length) return template;
  [sections[at], sections[to]] = [sections[to], sections[at]];
  return resequence({ ...template, sections: sections.map((s, i) => ({ ...s, sequence: i + 1 })) });
}

/**
 * Remove a section and the questions inside it.
 *
 * Taking the questions with it rather than orphaning them: a question whose
 * section has gone sits outside every budget and appears in no section score,
 * which the validator reports as a problem the buyer did not knowingly create.
 * The caller is expected to say how many are going before calling this.
 */
export function removeSection(template: QuestionnaireTemplate, sectionId: Id): QuestionnaireTemplate {
  return resequence({
    ...template,
    sections: template.sections.filter((s) => s.id !== sectionId),
    questions: template.questions.filter((q) => q.sectionId !== sectionId),
  });
}

/**
 * Remove a question, and give its share back to the section it was taken from.
 *
 * A section's weight is the score its questions allocate between them. Delete
 * a 15-point question from a section declaring 40 and leave the 40 standing,
 * and the section claims three-eighths of the technical score while being able
 * to award only a quarter of it — the gap is silently unearnable, and every
 * supplier is marked down for it. So the declaration follows the question out.
 *
 * What it deliberately does not do is move that 15 anywhere else. Where the
 * freed share belongs — another section, or nowhere because the decision is
 * genuinely smaller now — is a judgement about what the buyer is buying, and
 * the sections total meter says plainly that it is outstanding.
 *
 * Only a *scored* question frees anything: an unscored one carries weight that
 * never reached the allocation in the first place, so taking it off the
 * section would lower the budget twice.
 */
export function removeQuestion(
  template: QuestionnaireTemplate, questionId: Id,
): QuestionnaireTemplate {
  const question = template.questions.find((q) => q.id === questionId);
  if (question === undefined) return template;

  const freed = isScored(question) ? question.weight : 0;

  return resequence({
    ...template,
    sections: template.sections.map((section) =>
      (section.id === question.sectionId && freed > 0
        ? { ...section, weight: Math.max(0, section.weight - freed) }
        : section)),
    questions: template.questions.filter((q) => q.id !== questionId),
  });
}

/** What a section's weight becomes if this question is removed. Null when it does not move. */
export function weightAfterRemoving(
  template: QuestionnaireTemplate, questionId: Id,
): { section: TemplateSection; from: number; to: number } | null {
  const question = template.questions.find((q) => q.id === questionId);
  if (question === undefined || !isScored(question) || question.weight === 0) return null;
  const section = template.sections.find((s) => s.id === question.sectionId);
  if (section === undefined) return null;
  return { section, from: section.weight, to: Math.max(0, section.weight - question.weight) };
}

/** Blocking errors indexed by the question each is about. */
export function errorsByQuestion(errors: TemplateIssue[]): Map<Id, TemplateIssue[]> {
  const byQuestion = new Map<Id, TemplateIssue[]>();
  for (const error of errors) {
    if (error.questionId === undefined) continue;
    byQuestion.set(error.questionId, [...(byQuestion.get(error.questionId) ?? []), error]);
  }
  return byQuestion;
}

/** Move a question one place up (-1) or down (+1) inside its own section. */
export function moveQuestion(
  template: QuestionnaireTemplate, questionId: Id, by: -1 | 1,
): QuestionnaireTemplate {
  const question = template.questions.find((q) => q.id === questionId);
  if (question === undefined) return template;

  const siblings = questionsInSection(template, question.sectionId);
  const at = siblings.findIndex((q) => q.id === questionId);
  const to = at + by;
  if (to < 0 || to >= siblings.length) return template;

  // Swapping the two sequence numbers is enough: `resequence` then renumbers
  // the whole form from the new order.
  const swapped = template.questions.map((q) => {
    if (q.id === siblings[at].id) return { ...q, sequence: siblings[to].sequence };
    if (q.id === siblings[to].id) return { ...q, sequence: siblings[at].sequence };
    return q;
  });
  return resequence({ ...template, questions: swapped });
}

/** What the sections declare between them. Must be 100 on a scored template. */
export function sectionWeightTotal(template: { sections: TemplateSection[] }): number {
  return template.sections.reduce((sum, section) => sum + Math.max(0, section.weight), 0);
}

/**
 * Whether this template's sections are meant to add up.
 *
 * A pure RFI that scores nothing has every section at zero and is complete as
 * it stands. The moment one section claims a share, the rest have to account
 * for theirs — a template where the shares total 85 is one where nobody can
 * say what the missing 15 was supposed to measure.
 */
export function isScoredTemplate(template: { sections: TemplateSection[] }): boolean {
  return template.sections.some((section) => section.weight > 0);
}

/** How a question set splits between the two scopes, for a summary line. */
export function scopeCounts(
  questions: { type: QuestionType; askedPer: QuestionScope }[],
): { vendor: number; line: number } {
  const askable = questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type));
  return {
    vendor: askable.filter((q) => q.askedPer !== 'LINE').length,
    line: askable.filter((q) => q.askedPer === 'LINE').length,
  };
}

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
// Section budgets — the weight a section may spend on its questions
// ---------------------------------------------------------------------------

/** The scale a buyer reads scores on, unless the questionnaire names another. */
export const DEFAULT_SCORE_SCALE = 100;

/** The scales offered in the editor. Any positive number is accepted. */
export const SCORE_SCALE_PRESETS = [5, 10, 100];

export interface SectionBudget {
  section: TemplateSection;
  /** What the section declared it is worth. */
  declared: number;
  /** What its questions actually carry between them. */
  allocated: number;
  /** Declared minus allocated. Negative is over-budget and is an error. */
  remaining: number;
  overspent: boolean;
  /** Scored questions inside it. A section with none spends nothing. */
  scored: number;
}

/**
 * What each section has declared and what it has spent.
 *
 * The one piece of arithmetic every screen that touches section weighting needs,
 * computed once here so the editor's meter, the validation and the scoring
 * cannot each derive it slightly differently.
 */
export function sectionBudgets(template: QuestionnaireTemplate): SectionBudget[] {
  return [...template.sections]
    .sort((a, b) => a.sequence - b.sequence)
    .map((section) => {
      const inside = scoredQuestions(template).filter((q) => q.sectionId === section.id);
      const allocated = inside.reduce((sum, q) => sum + q.weight, 0);
      const declared = Math.max(0, section.weight);
      return {
        section,
        declared,
        allocated,
        remaining: declared - allocated,
        overspent: allocated > declared,
        scored: inside.length,
      };
    });
}

/**
 * The largest weight one question may take without breaking its section.
 *
 * The editor caps the input at this rather than letting a buyer type a number
 * and then telling them off for it: an over-budget section is a state they
 * should not be able to author in the first place. `null` means the question is
 * in no section, so no budget applies to it.
 */
export function weightCeilingFor(
  template: QuestionnaireTemplate, questionId: Id,
): number | null {
  const question = template.questions.find((q) => q.id === questionId);
  if (question === undefined || question.sectionId === null) return null;
  const budget = sectionBudgets(template).find((b) => b.section.id === question.sectionId);
  if (budget === undefined) return null;
  // Its own weight is already counted in `allocated`, so the ceiling is what is
  // left plus what it is holding.
  return Math.max(0, budget.remaining + (isScored(question) ? question.weight : 0));
}

/** Scored questions that sit in no section, and so against no budget. */
export function ungroupedScored(template: QuestionnaireTemplate): TemplateQuestion[] {
  return scoredQuestions(template).filter((q) => q.sectionId === null);
}

// ---------------------------------------------------------------------------
// Applying templates across a journey
// ---------------------------------------------------------------------------

/**
 * Templates that may be used at a point, for a category — the ones written for
 * that category first.
 *
 * A template declaring no categories serves any of them, which is right for a
 * tenant-wide price schedule and wrong as a *default* for a category that has
 * written its own. The whole purpose of a category library is that its
 * questions beat the generic ones, so a template naming this category sorts
 * ahead of one that merely does not exclude it. The order within each group is
 * the library's own, so the chain still reads narrowest-first.
 */
export function templatesFor(
  templates: QuestionnaireTemplate[],
  point: VendorInputPoint,
  category: string | null = null,
): QuestionnaireTemplate[] {
  const available = templates.filter(
    (t) =>
      t.status !== 'RETIRED' &&
      t.appliesTo.includes(point) &&
      (category === null || t.categories.length === 0 || t.categories.includes(category)),
  );
  if (category === null) return available;
  const named = available.filter((t) => t.categories.includes(category));
  return [...named, ...available.filter((t) => !named.includes(t))];
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

    // Asked per line, but the type cannot be repeated per line.
    if (question.askedPer === 'LINE' && !canAskPerLine(question.type)) {
      errors.push({
        code: 'LINE_SCOPE_NOT_POSSIBLE',
        questionId: question.id,
        message: BASKET_WIDE_TYPES.includes(question.type)
          ? `"${question.title}" is a ${question.type}, which already spans every line in the basket. Asking it per line would put the whole grid inside each line.`
          : `"${question.title}" displays something rather than asking for it, so repeating it per line only repeats the heading.`,
      });
    }

    /**
     * A knockout removes the supplier from the event. A per-line answer cannot
     * carry that: one line failing a specification is a reason not to award
     * that line, which is an award decision, not a gate on the whole bid.
     */
    if (question.askedPer === 'LINE' && question.isKnockout) {
      errors.push({
        code: 'LINE_KNOCKOUT',
        questionId: question.id,
        message: `"${question.title}" is asked per line and disqualifies on failure. A knockout removes the supplier from the whole event, which one failing line cannot justify — ask it per vendor, or drop the knockout and let the award decide line by line.`,
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

  /**
   * Sections are shares of one score, so they total 100.
   *
   * Before this was enforced, a template whose sections read 35 / 35 / 10 was
   * silently normalised at scoring time, and the buyer who wrote it believed
   * capability was worth 35% when it was worth 43.75%. The arithmetic was
   * right and the number on the screen was a different number from the one
   * doing the work.
   */
  if (isScoredTemplate(template)) {
    const total = sectionWeightTotal(template);
    if (total !== 100) {
      errors.push({
        code: 'SECTION_WEIGHTS_NOT_100',
        message: total < 100
          ? `The sections add up to ${total}%. ${100 - total}% of the technical score is unaccounted for — raise a section, or add the one that is missing.`
          : `The sections add up to ${total}%, which is ${total - 100}% more score than there is to give. Lower a section until they total 100%.`,
      });
    }
  }

  // --- Section budgets ------------------------------------------------------
  //
  // A section's weight is the most its questions may carry between them. Over
  // budget is an error because the declared share would be a lie; under budget
  // is a warning because the questions still score, the section just turns out
  // to be worth less than the buyer set aside for it.
  for (const budget of sectionBudgets(template)) {
    if (budget.overspent) {
      errors.push({
        code: 'SECTION_OVER_BUDGET',
        message: `"${budget.section.name}" is worth ${budget.declared} but its questions carry ${budget.allocated} between them. Lower a question or raise the section — a section cannot award more than it is worth.`,
      });
    } else if (budget.declared > 0 && budget.scored === 0) {
      warnings.push({
        code: 'SECTION_WEIGHT_UNUSED',
        message: `"${budget.section.name}" is worth ${budget.declared} but nothing inside it is scored, so none of that weight can be earned.`,
      });
    } else if (budget.remaining > 0 && budget.scored > 0) {
      warnings.push({
        code: 'SECTION_UNDER_BUDGET',
        message: `"${budget.section.name}" set aside ${budget.declared} and allocated ${budget.allocated}. Scoring follows the questions, so the section is worth ${budget.allocated} — the remaining ${budget.remaining} is unspent, not lost.`,
      });
    }
    if (budget.declared === 0 && budget.scored > 0) {
      errors.push({
        code: 'SECTION_SCORES_WITHOUT_WEIGHT',
        message: `"${budget.section.name}" carries no weight but holds ${budget.scored} scored question(s). Give the section a weight to allocate from, or stop scoring its questions.`,
      });
    }
  }

  const loose = ungroupedScored(template);
  if (loose.length > 0) {
    warnings.push({
      code: 'SCORED_OUTSIDE_SECTION',
      message: `${loose.length} scored question(s) sit in no section, so they are outside every section budget and will not appear in any section score. Move them into one.`,
    });
  }

  if (!(template.scoreScale > 0)) {
    errors.push({
      code: 'SCALE_INVALID',
      message: 'A score scale has to be a positive number — it is what every section score and the overall score are reported out of.',
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
// Deletion — a template is removable only while nothing has been asked from it
// ---------------------------------------------------------------------------

/**
 * One event ask that was built from a library template.
 *
 * A questionnaire is a *copy* of the template, so deleting the template cannot
 * corrupt an event that already went out. What deleting it does destroy is the
 * ability to say what a supplier was asked and why — the template is the only
 * place the authored intent survives in one piece, and an evaluation challenged
 * six months later is answered from it. So the library keeps a template that
 * anything has been asked from, and offers retirement instead: retired keeps it
 * readable and out of every new event, which is what "stop using this" actually
 * means.
 */
export interface TemplateUse {
  eventId: Id;
  /** The event's own reference, falling back to its id if it is not loaded. */
  eventNumber: string;
  title: string;
  stage: Stage;
}

/** The event asks built from one library template, newest reference first. */
export function templateUses(
  templateId: Id,
  questionnaires: Questionnaire[],
  events: SourcingEvent[],
): TemplateUse[] {
  return questionnaires
    .filter((questionnaire) => questionnaire.sourceTemplateId === templateId)
    .map((questionnaire) => {
      const event = events.find((e) => e.id === questionnaire.eventId);
      return {
        eventId: questionnaire.eventId,
        eventNumber: event?.eventNumber ?? questionnaire.eventId,
        title: event?.title ?? 'No longer in this workspace',
        stage: questionnaire.stage,
      };
    })
    .sort((a, b) =>
      a.eventNumber === b.eventNumber
        ? a.stage.localeCompare(b.stage)
        : b.eventNumber.localeCompare(a.eventNumber));
}

/** Uses grouped by template id, for a library listing that shows them all. */
export function templateUseIndex(
  templates: QuestionnaireTemplate[],
  questionnaires: Questionnaire[],
  events: SourcingEvent[],
): Map<Id, TemplateUse[]> {
  const index = new Map<Id, TemplateUse[]>();
  for (const template of templates) {
    index.set(template.id, templateUses(template.id, questionnaires, events));
  }
  return index;
}

/** The distinct events a set of uses covers. One event may ask at two points. */
export function eventsUsing(uses: TemplateUse[]): string[] {
  return Array.from(new Set(uses.map((use) => use.eventNumber)));
}

/**
 * Why this template cannot be deleted, or null when it can be.
 *
 * Returned as a sentence rather than a boolean because the buyer needs to know
 * *which* events hold it — "cannot delete" with nothing to act on is a dead end,
 * and the first thing they will ask is where it is still in use.
 */
export function deletionBlock(uses: TemplateUse[]): string | null {
  if (uses.length === 0) return null;
  const events = eventsUsing(uses);
  const shown = events.slice(0, 3).join(', ');
  const rest = events.length - 3;
  const where = rest > 0 ? `${shown} and ${rest} more` : shown;
  return events.length === 1
    ? `${where} was built from this template. Retire it instead — that keeps it readable and out of every new event.`
    : `${events.length} events were built from this template (${where}). Retire it instead — that keeps it readable and out of every new event.`;
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
    sections: [{ id: `${id}-sec-1`, name: 'General', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
    questions: [],
    scoreScale: DEFAULT_SCORE_SCALE,
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
    // Asked of the supplier once. Per line is a deliberate choice, never a
    // default: most questions are about the company, not the item.
    askedPer: 'VENDOR',
    config: defaultConfigFor('short_text', `${template.id}-q-${sequence}`),
  };
}

// ---------------------------------------------------------------------------
// Applying a template inside the Create Event wizard
// ---------------------------------------------------------------------------

/**
 * A questionnaire as it is being shaped for one event, at one point in the
 * journey.
 *
 * The buyer picks a template and then edits — adds, removes, reweights. Those
 * edits belong to the event, never to the library: a template is a shared asset
 * and one event's needs must not rewrite it for everybody. So instantiating
 * copies the questions and re-keys every id under the event, which also keeps
 * the codes free to stay stable (a code is the join key for answer inheritance
 * across stages, so it is deliberately *not* re-keyed).
 */
export interface DraftQuestionnaire {
  point: VendorInputPoint;
  /**
   * The category this questionnaire asks for.
   *
   * A questionnaire is chosen by category, not by event: the questions worth
   * asking a pallet supplier are not the ones worth asking a stationery
   * supplier, and a consolidated event buys from both. So an event spanning
   * three categories carries three questionnaires at each point it asks at,
   * each drawn from its own category's library. Null on an event that spans
   * one category, where the distinction would be noise.
   */
  category: string | null;
  /** The library template this started from. Null once blank, or after edits. */
  templateId: Id | null;
  templateName: string;
  sections: TemplateSection[];
  questions: TemplateQuestion[];
  /** The scale this event's scores are reported on. Copied from the template. */
  scoreScale: number;
  /**
   * Who each question is put to, where the buyer narrowed it.
   *
   * Keyed by question id and sparse by design: a question absent from the map
   * is asked of every supplier invited and, at line grain, about every line.
   * That is the ordinary case, so the ordinary case costs nothing to store and
   * stays true as the shortlist and the basket change. See `questionAudience`.
   */
  audience?: Record<Id, QuestionAudience>;
}

/** Copy a library template into an event-owned working set. */
export function instantiateTemplate(
  template: QuestionnaireTemplate,
  point: VendorInputPoint,
  idPrefix: string,
  category: string | null = null,
): DraftQuestionnaire {
  const sectionIdOf = (id: Id) => `${idPrefix}-sec-${id}`;
  return {
    point,
    category,
    templateId: template.id,
    templateName: template.name,
    scoreScale: template.scoreScale > 0 ? template.scoreScale : DEFAULT_SCORE_SCALE,
    // The section weights come across with the sections: the budget is part of
    // what the template is, not decoration on the library copy of it.
    sections: template.sections
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((section) => ({ ...section, id: sectionIdOf(section.id) })),
    questions: template.questions
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((question, i) => ({
        ...question,
        id: `${idPrefix}-q${i + 1}`,
        templateId: idPrefix,
        sectionId: question.sectionId === null ? null : sectionIdOf(question.sectionId),
        sequence: i + 1,
        // The config carries option ids that pointed at the template's question.
        config: { ...question.config },
      })),
  };
}

/** An empty questionnaire for a point, for a buyer who wants to start clean. */
export function blankQuestionnaire(
  point: VendorInputPoint, idPrefix: string, category: string | null = null,
): DraftQuestionnaire {
  return {
    point,
    category,
    templateId: null,
    templateName: 'Blank',
    sections: [{
      id: `${idPrefix}-sec-1`, name: 'General', sequence: 1, weight: 100, askedPer: 'VENDOR',
    }],
    questions: [],
    scoreScale: DEFAULT_SCORE_SCALE,
  };
}

/**
 * Present a draft questionnaire as a template so the library's own validation
 * runs against it unchanged. The wizard must not enforce a second, weaker copy
 * of rules like "RFI is pre-commercial" — it has to be the same check.
 */
export function draftAsTemplate(draft: DraftQuestionnaire): QuestionnaireTemplate {
  return {
    id: draft.templateId ?? 'draft',
    code: 'DRAFT',
    name: draft.templateName || 'Questionnaire',
    description: '',
    appliesTo: [draft.point],
    categories: draft.category === null ? [] : [draft.category],
    sections: draft.sections,
    questions: draft.questions,
    scoreScale: draft.scoreScale,
    status: 'DRAFT',
    version: 1,
    scopeType: 'EVENT',
    scopeId: 'draft',
    createdBy: 'draft',
    createdAt: 0,
  };
}

/**
 * Fold a template back into the event's working questionnaire.
 *
 * The way back from `draftAsTemplate`, used when something that speaks
 * templates — an uploaded spreadsheet, the template builder — has rewritten
 * what the event asks.
 *
 * The link to the library is cut on the way through. The event is no longer
 * asking the library's template; it is asking what came out of the file, and a
 * published event claiming a provenance it does not have is worse than one
 * claiming none. Narrowings whose questions did not survive are dropped with
 * them, because an audience keyed to a question that no longer exists is a
 * count that can never be right.
 */
export function draftFromTemplate(
  draft: DraftQuestionnaire, template: QuestionnaireTemplate,
): DraftQuestionnaire {
  const live = new Set(template.questions.map((q) => q.id));
  const kept = Object.entries(draft.audience ?? {}).filter(([id]) => live.has(id));
  return {
    ...draft,
    templateId: null,
    templateName: template.name.trim() === '' ? draft.templateName : template.name,
    sections: template.sections,
    questions: template.questions,
    scoreScale: template.scoreScale > 0 ? template.scoreScale : draft.scoreScale,
    audience: kept.length === 0 ? undefined : Object.fromEntries(kept),
  };
}

/**
 * Lift the event's working questionnaire into a library template.
 *
 * A questionnaire worth writing once is worth asking twice, and the shape it
 * ends up in on a real event is a better starting point than anything written
 * in the abstract. Ids are rewritten under the new template so the library
 * copy and the event copy are genuinely separate documents — editing one must
 * never reach the other.
 *
 * Saving over a template that already exists bumps its version rather than
 * silently replacing it at version 1, because the library tells buyers which
 * revision of a question set an event actually asked.
 */
export function templateFromDraft(
  draft: DraftQuestionnaire,
  {
    id, name, appliesTo, scopeType, scopeId, userId, now, previous = null,
  }: {
    id: Id;
    name: string;
    appliesTo: VendorInputPoint[];
    scopeType: QuestionnaireTemplate['scopeType'];
    scopeId: Id;
    userId: Id;
    now: ServerMillis;
    /** The template being written over, where this replaces one. */
    previous?: QuestionnaireTemplate | null;
  },
): QuestionnaireTemplate {
  const trimmed = name.trim();
  return {
    id,
    code: previous?.code ?? suggestCode(trimmed, appliesTo),
    name: trimmed,
    description: previous?.description ?? '',
    appliesTo: appliesTo.length === 0 ? [draft.point] : appliesTo,
    // A template saved out of a category's questionnaire serves that category.
    // One saved from an event that spans a single category carries it too —
    // it is still the only category the questions were written against.
    categories: draft.category === null ? [] : [draft.category],
    sections: draft.sections.map((section) => ({ ...section, id: `${id}-${section.id}` })),
    questions: draft.questions.map((question) => ({
      ...question,
      id: `${id}-${question.id}`,
      templateId: id,
      sectionId: question.sectionId === null ? null : `${id}-${question.sectionId}`,
    })),
    scoreScale: draft.scoreScale,
    status: previous?.status ?? 'DRAFT',
    version: previous === null ? 1 : previous.version + 1,
    scopeType,
    scopeId,
    createdBy: previous?.createdBy ?? userId,
    createdAt: previous?.createdAt ?? now,
  };
}

/**
 * Add a question to a draft questionnaire.
 *
 * Ids are sequence-independent because questions get deleted: keying off the
 * length alone would reuse an id after a delete and collide with a survivor.
 */
/**
 * The points in the journey where a question is actually put to the supplier.
 *
 * A question is not asked "at a stage" in this model — each point carries its
 * own questionnaire, and the same question appearing at two of them is two
 * rows sharing one `code`. That is deliberate: the code is the join key that
 * carries an answer given at RFI into RFP rather than asking twice. So "where
 * is this asked?" is a question about the code, answered by looking across the
 * event's questionnaires rather than at a field on the question.
 */
export function pointsAsking(
  questionnaires: DraftQuestionnaire[], code: string, category: string | null,
): VendorInputPoint[] {
  const asking = questionnaires
    .filter((q) => q.category === category && q.questions.some((x) => x.code === code))
    .map((q) => q.point);
  return VENDOR_INPUT_POINTS.filter((point) => asking.includes(point));
}

/**
 * Ask the same question at a different set of points.
 *
 * Adding copies the question into that point's questionnaire under a fresh id
 * and the same code, into a section of the same name — created if the target
 * questionnaire has not got one, because a question landing outside every
 * section would sit outside every budget and score nowhere.
 *
 * Removing takes the copy out. The last point is never removed: a question
 * asked nowhere is a deleted question, and deleting has its own control that
 * says so.
 */
export function setAskedAtPoints(
  questionnaires: DraftQuestionnaire[],
  source: TemplateQuestion,
  category: string | null,
  wanted: VendorInputPoint[],
): DraftQuestionnaire[] {
  const sourceSection = questionnaires
    .find((q) => q.category === category && q.questions.some((x) => x.id === source.id))
    ?.sections.find((s) => s.id === source.sectionId) ?? null;

  const keep = wanted.length === 0
    ? pointsAsking(questionnaires, source.code, category).slice(0, 1)
    : wanted;

  return questionnaires.map((questionnaire) => {
    if (questionnaire.category !== category) return questionnaire;

    const has = questionnaire.questions.some((q) => q.code === source.code);
    const should = keep.includes(questionnaire.point);
    if (has === should) return questionnaire;

    if (!should) {
      return {
        ...questionnaire,
        questions: questionnaire.questions.filter((q) => q.code !== source.code),
      };
    }

    // Land it in a section of the same name, adding one if there is none.
    let sections = questionnaire.sections;
    let sectionId: Id | null = null;
    if (sourceSection) {
      const match = sections.find(
        (s) => s.name.trim().toLowerCase() === sourceSection.name.trim().toLowerCase(),
      );
      if (match) {
        sectionId = match.id;
      } else {
        sectionId = `${questionnaire.point.toLowerCase()}-sec-${sections.length + 1}-${source.code}`;
        sections = [
          ...sections,
          {
            ...sourceSection,
            id: sectionId,
            sequence: sections.length + 1,
            // The budget does not travel: a section carrying 40% at RFP does
            // not thereby carry 40% at RFQ, where the rest of the form is
            // different. The buyer sets it where it now applies.
            weight: 0,
          },
        ];
      }
    }

    const sequence = questionnaire.questions.reduce((max, q) => Math.max(max, q.sequence), 0) + 1;
    return {
      ...questionnaire,
      sections,
      questions: [
        ...questionnaire.questions,
        {
          ...source,
          id: `${questionnaire.point.toLowerCase()}-q-${sequence}-${source.code}`,
          sectionId,
          sequence,
          // Weight is per questionnaire for the same reason the section's is.
          weight: 0,
          scoringMethod: source.isKnockout ? source.scoringMethod : 'NONE',
          maxScore: 0,
        },
      ],
    };
  });
}

export function addDraftQuestion(
  draft: DraftQuestionnaire, sectionId: Id | null,
): DraftQuestionnaire {
  const maxSequence = draft.questions.reduce((max, q) => Math.max(max, q.sequence), 0);
  const sequence = maxSequence + 1;
  const id = `${draft.templateId ?? 'draft'}-q-new-${sequence}-${Date.now()}`;
  const question: TemplateQuestion = {
    id,
    templateId: draft.templateId ?? 'draft',
    sectionId,
    sequence,
    code: `Q.${sequence}`,
    type: 'short_text',
    title: '',
    helpText: '',
    isRequired: true,
    // A question added at RFI is technical until the buyer says otherwise —
    // defaulting to commercial would author the rule violation for them.
    envelope: 'TECHNICAL',
    weight: 10,
    scoringMethod: 'MANUAL',
    maxScore: 10,
    rubric: null,
    isKnockout: false,
    allowAttachment: false,
    askedPer: 'VENDOR',
    config: defaultConfigFor('short_text', id),
  };
  return { ...draft, questions: [...draft.questions, question] };
}

/** Remove a question, closing the sequence gap it leaves behind. */
export function removeDraftQuestion(
  draft: DraftQuestionnaire, questionId: Id,
): DraftQuestionnaire {
  return {
    ...draft,
    questions: draft.questions
      .filter((q) => q.id !== questionId)
      .map((q, i) => ({ ...q, sequence: i + 1 })),
  };
}

/**
 * Turn scoring on or off for one question.
 *
 * Scoring and weight move together because they are meaningless apart: a
 * weighted question that is not scored contributes nothing while inflating the
 * total, and a scored question with no weight spends evaluator time on an
 * answer that cannot change the ranking. Both are caught by `validateTemplate`,
 * so the editor makes the state unreachable rather than letting a buyer author
 * it and then telling them off for it.
 */
export function setDraftScored(
  draft: DraftQuestionnaire, questionId: Id, scored: boolean,
): DraftQuestionnaire {
  return {
    ...draft,
    questions: draft.questions.map((q) => {
      if (q.id !== questionId) return q;
      if (!scored) return { ...q, scoringMethod: 'NONE' as const, weight: 0 };
      // Price reaches the score through the price component alone, so a priced
      // question cannot be made to carry weight here.
      if (PRICED_QUESTION_TYPES.includes(q.type)) return q;
      return {
        ...q,
        scoringMethod: q.scoringMethod === 'NONE' ? ('MANUAL' as const) : q.scoringMethod,
        weight: q.weight > 0 ? q.weight : 10,
      };
    }),
  };
}

/** Whether a question contributes to the technical score as it currently stands. */
export function isScored(question: TemplateQuestion): boolean {
  return (
    question.weight > 0 &&
    question.scoringMethod !== 'NONE' &&
    !PRICED_QUESTION_TYPES.includes(question.type)
  );
}

/**
 * Change a question's type, keeping the answer format coherent.
 *
 * Switching to a priced type strips weight and scoring, because price may not
 * be weighted twice — doing it here means the buyer never sees the error for a
 * state they did not intend to author.
 */
export function setDraftType(
  draft: DraftQuestionnaire, questionId: Id, type: QuestionType,
): DraftQuestionnaire {
  return {
    ...draft,
    questions: draft.questions.map((q) => {
      if (q.id !== questionId) return q;
      const config = carryConfig(q.type, type, q.config, q.id);
      if (PRICED_QUESTION_TYPES.includes(type)) {
        return { ...q, type, config, weight: 0, scoringMethod: 'NONE' as const };
      }
      return { ...q, type, config };
    }),
  };
}

/** Move a question one place up or down within the questionnaire. */
export function moveDraftQuestion(
  draft: DraftQuestionnaire, questionId: Id, direction: -1 | 1,
): DraftQuestionnaire {
  const ordered = [...draft.questions].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((q) => q.id === questionId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return draft;
  // Swapping across a section boundary moves the question into that section,
  // which is what a buyer dragging it there would expect.
  const moved = ordered[index];
  const displaced = ordered[target];
  ordered[index] = { ...displaced };
  ordered[target] = { ...moved, sectionId: displaced.sectionId };
  return { ...draft, questions: ordered.map((q, i) => ({ ...q, sequence: i + 1 })) };
}

/** Add a section to group questions under. */
export function addDraftSection(
  draft: DraftQuestionnaire, name: string, askedPer: QuestionScope = 'VENDOR',
): DraftQuestionnaire {
  const sequence = draft.sections.reduce((max, s) => Math.max(max, s.sequence), 0) + 1;
  return {
    ...draft,
    sections: [
      ...draft.sections,
      // A new section starts at zero: it has nothing in it yet, and a section
      // that silently claimed weight would put the questionnaire over budget
      // the moment it was added.
      {
        id: `${draft.templateId ?? 'draft'}-sec-${sequence}-${Date.now()}`, name, sequence,
        weight: 0, askedPer,
      },
    ],
  };
}

export function renameDraftSection(
  draft: DraftQuestionnaire, sectionId: Id, name: string,
): DraftQuestionnaire {
  return {
    ...draft,
    sections: draft.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)),
  };
}

/**
 * Remove a section. Its questions move to the questionnaire's ungrouped set
 * rather than being deleted with it — losing a buyer's questions because they
 * tidied a heading would be a data-loss bug wearing a layout costume.
 */
export function removeDraftSection(
  draft: DraftQuestionnaire, sectionId: Id,
): DraftQuestionnaire {
  return {
    ...draft,
    sections: draft.sections.filter((s) => s.id !== sectionId),
    questions: draft.questions.map((q) =>
      q.sectionId === sectionId ? { ...q, sectionId: null } : q,
    ),
  };
}

/**
 * Seed a questionnaire for every point the journey asks at, keeping whatever
 * the buyer has already shaped.
 *
 * Switching journey pattern mid-wizard reveals points that were not there
 * before — a buyer who moves from a simple RFQ to a full ladder should find the
 * RFI questionnaire already populated from the library rather than empty. Work
 * already done at a point that survives the switch is never rebuilt, because
 * re-seeding it would silently discard their edits.
 */
export function seedQuestionnaires({
  existing, points, library, categories, idSeed,
}: {
  existing: DraftQuestionnaire[];
  points: VendorInputPoint[];
  /**
   * The library to pick from. On a consolidated event this is the union of
   * every category's library, and `template.categories` decides which category
   * each one serves — the caller does not have to resolve the chain per
   * category for the seeding to come out right.
   */
  library: QuestionnaireTemplate[];
  /**
   * The categories the basket spans. One entry — or a single null — produces
   * the ordinary one-questionnaire-per-point result.
   */
  categories: (string | null)[];
  idSeed: string;
}): DraftQuestionnaire[] {
  const spans = categories.length === 0 ? [null] : categories;
  return points.flatMap((point) =>
    spans.map((category) => {
      const already = existing.find((q) => q.point === point && q.category === category);
      if (already) return already;
      const options = templatesFor(library, point, category);
      const prefix = `${idSeed}-${point.toLowerCase()}${category === null ? '' : `-${categorySlug(category)}`}`;
      return options.length > 0
        ? instantiateTemplate(options[0], point, prefix, category)
        : blankQuestionnaire(point, prefix, category);
    }),
  );
}

/** A category reduced to something safe to put in an id. */
export function categorySlug(category: string): string {
  return category.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'category';
}

/**
 * The categories a basket spans, in the order a buyer meets them.
 *
 * Deliberately the lines' own categories rather than the event's: the event
 * header carries one, and a consolidated event raised against six requisitions
 * routinely buys in three. Falls back to the event's category for a basket
 * whose lines were never classified.
 */
export function basketCategories(
  lines: { category?: string | null }[], fallback: string | null = null,
): string[] {
  const seen: string[] = [];
  for (const line of lines) {
    const category = line.category === undefined || line.category === null || line.category.trim() === ''
      ? fallback
      : line.category;
    if (category !== null && !seen.includes(category)) seen.push(category);
  }
  return seen;
}
