/**
 * Who a question is put to.
 *
 * Most questions go to everybody — every supplier invited to the ask, and,
 * where the question is asked per line, every line in the basket. That is the
 * default and it is stored as nothing at all: a question with no audience on
 * it asks everyone, and keeps asking everyone as the shortlist and the basket
 * change around it.
 *
 * A narrowing is the exception, and it is stored as a list of ids. The
 * distinction matters more than it looks. "Everyone" is a rule and stays true
 * when a supplier is invited next week; a list of six ids is a fact about
 * today that silently excludes the seventh. So the two are never collapsed
 * into each other: picking every row in the picker records "everyone" again,
 * not a list that happens to be complete.
 *
 * Nothing here decides what a question means — only who sees it. The scoring,
 * weighting and envelope rules live where they always did.
 */
import { PRICED_QUESTION_TYPES, isScored } from './questionnaireTemplates';
import type { Id, QuestionAudience, QuestionScope, TemplateQuestion } from './types';

/** The audience of a question nobody has narrowed: everyone, as a rule. */
export const EVERYONE: QuestionAudience = { vendorIds: null, lineIds: null };

/**
 * The suppliers and lines a questionnaire can actually reach.
 *
 * Not the whole event — the slice this questionnaire belongs to. A
 * consolidated event carries one questionnaire per category, and the pallet
 * suppliers have no business appearing in the laptop questionnaire's picker.
 */
export interface AudienceRoster {
  vendorIds: Id[];
  lineIds: Id[];
}

/**
 * Anything that holds questions and, optionally, the narrowings against them.
 *
 * Kept structural rather than naming `DraftQuestionnaire` so this module stays
 * a leaf: the supplier portal reads audiences too, and it has no business
 * loading the template builder to do it.
 */
export interface AudienceHolder {
  questions: TemplateQuestion[];
  /** Keyed by question id. A question absent from the map asks everyone. */
  audience?: Record<Id, QuestionAudience>;
}

/** Is this supplier asked? */
export function asksVendor(audience: QuestionAudience, vendorId: Id): boolean {
  return audience.vendorIds === null || audience.vendorIds.includes(vendorId);
}

/** Is this line asked about? */
export function asksLine(audience: QuestionAudience, lineId: Id): boolean {
  return audience.lineIds === null || audience.lineIds.includes(lineId);
}

/** Does this audience narrow anything that matters at this grain? */
export function isNarrowed(audience: QuestionAudience, scope: QuestionScope): boolean {
  return audience.vendorIds !== null || (scope === 'LINE' && audience.lineIds !== null);
}

/** The audience recorded against one question, or everyone. */
export function audienceOf(holder: AudienceHolder, questionId: Id): QuestionAudience {
  return holder.audience?.[questionId] ?? EVERYONE;
}

/**
 * The audience as concrete ids, in roster order.
 *
 * "Everyone" expands to the roster, and a list is intersected with it — an id
 * naming a supplier who is no longer invited reaches nobody and must not be
 * counted as though it did.
 */
export function resolveAudience(
  audience: QuestionAudience, roster: AudienceRoster,
): { vendorIds: Id[]; lineIds: Id[] } {
  return {
    vendorIds: audience.vendorIds === null
      ? roster.vendorIds
      : roster.vendorIds.filter((id) => audience.vendorIds!.includes(id)),
    lineIds: audience.lineIds === null
      ? roster.lineIds
      : roster.lineIds.filter((id) => audience.lineIds!.includes(id)),
  };
}

/**
 * How a narrowing reads in a table cell — or null when there is nothing to
 * say.
 *
 * Null is the point of this function. A column that prints "All 6 suppliers"
 * against every row spends its ink on the case nobody needs to check, and
 * buries the two rows that were narrowed. Silence is the default; the chip is
 * the exception.
 */
export function audienceSummary(
  audience: QuestionAudience, roster: AudienceRoster, scope: QuestionScope,
): string | null {
  if (!isNarrowed(audience, scope)) return null;
  const reach = resolveAudience(audience, roster);
  const parts: string[] = [];
  if (audience.vendorIds !== null) {
    parts.push(reach.vendorIds.length === 0
      ? 'No supplier'
      : `${reach.vendorIds.length}/${roster.vendorIds.length} suppliers`);
  }
  if (scope === 'LINE' && audience.lineIds !== null) {
    parts.push(reach.lineIds.length === 0
      ? 'No line'
      : `${reach.lineIds.length}/${roster.lineIds.length} lines`);
  }
  return parts.join(' · ');
}

/**
 * How many answers this question will come back as.
 *
 * The number a buyer is really deciding when they narrow something: a
 * line-level question put to six suppliers across nine lines is fifty-four
 * boxes to fill in and fifty-four to read. Saying so while the question is
 * being written is cheaper than discovering it when the responses land.
 */
export function answerLoad(
  audience: QuestionAudience,
  roster: AudienceRoster,
  scope: QuestionScope,
): { answers: number; vendors: number; lines: number } {
  const reach = resolveAudience(audience, roster);
  const vendors = reach.vendorIds.length;
  const lines = scope === 'LINE' ? reach.lineIds.length : 0;
  return {
    vendors,
    lines,
    answers: scope === 'LINE' ? vendors * lines : vendors,
  };
}

/** One question that is not asked of everyone, with the reach it does have. */
export interface NarrowedQuestion {
  question: TemplateQuestion;
  audience: QuestionAudience;
  reach: { vendorIds: Id[]; lineIds: Id[] };
  /** Never null: a question is only listed here because it reads as something. */
  summary: string;
}

/** The questions on a form that someone has narrowed. */
export function narrowedQuestions(
  holder: AudienceHolder,
  roster: AudienceRoster,
  scopeOf: (question: TemplateQuestion) => QuestionScope,
): NarrowedQuestion[] {
  const out: NarrowedQuestion[] = [];
  for (const question of holder.questions) {
    const audience = audienceOf(holder, question.id);
    const scope = scopeOf(question);
    const summary = audienceSummary(audience, roster, scope);
    if (summary === null) continue;
    out.push({ question, audience, reach: resolveAudience(audience, roster), summary });
  }
  return out;
}

export interface AudienceIssue {
  questionId: Id;
  message: string;
  /** An error is a narrowing that collects nothing; a warning still runs. */
  tone: 'error' | 'warning';
}

/**
 * What is wrong with the narrowings on this form.
 *
 * Two things can be, and they are genuinely different. A question asked of
 * nobody is broken — it occupies a weight and returns nothing, and the buyer
 * has to fix it. A *scored* question asked of only some suppliers is not
 * broken but it is a decision with a consequence: the suppliers who were
 * never asked cannot earn those points, so the technical totals stop being
 * comparable. That is worth saying once, on the row it belongs to, and then
 * leaving alone.
 */
export function audienceIssues(
  holder: AudienceHolder,
  roster: AudienceRoster,
  scopeOf: (question: TemplateQuestion) => QuestionScope,
): AudienceIssue[] {
  const issues: AudienceIssue[] = [];
  for (const question of holder.questions) {
    const audience = audienceOf(holder, question.id);
    const scope = scopeOf(question);
    if (!isNarrowed(audience, scope)) continue;
    const reach = resolveAudience(audience, roster);

    if (reach.vendorIds.length === 0) {
      issues.push({
        questionId: question.id,
        tone: 'error',
        message: 'Asked of no supplier — choose at least one, or ask everyone.',
      });
      continue;
    }

    if (scope === 'LINE' && roster.lineIds.length > 0 && reach.lineIds.length === 0) {
      issues.push({
        questionId: question.id,
        tone: 'error',
        message: 'Asked about no line — choose at least one line, or ask about every line.',
      });
      continue;
    }

    if (
      audience.vendorIds !== null
      && reach.vendorIds.length < roster.vendorIds.length
      && isScored(question)
      && !PRICED_QUESTION_TYPES.includes(question.type)
    ) {
      const missing = roster.vendorIds.length - reach.vendorIds.length;
      issues.push({
        questionId: question.id,
        tone: 'warning',
        message: `Scored, but ${missing} of the ${roster.vendorIds.length} suppliers are not`
          + ' asked it — they cannot earn its weight.',
      });
    }
  }
  return issues;
}

/** Deep-equal on an id list, order-insensitive. */
function sameIds(a: Id[] | null, b: Id[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

/** Is this the default — asked of everyone, at either grain? */
function isEveryone(audience: QuestionAudience): boolean {
  return audience.vendorIds === null && audience.lineIds === null;
}

/**
 * Store a narrowing against one question.
 *
 * Normalised on the way in, so the stored shape is the one the buyer meant:
 * ids are kept in roster order and deduplicated, a selection covering the
 * whole roster becomes "everyone" rather than a list that would freeze today's
 * shortlist, and an audience that narrows nothing is removed rather than left
 * behind as an empty object. A list that reaches nobody is kept exactly as it
 * is — that is a mistake the buyer has to see and correct, not one to quietly
 * widen back into "everyone".
 */
export function setQuestionAudience<T extends AudienceHolder>(
  holder: T, questionId: Id, audience: QuestionAudience, roster: AudienceRoster,
): T {
  const narrow = (ids: Id[] | null, pool: Id[]): Id[] | null => {
    if (ids === null) return null;
    const kept = pool.filter((id) => ids.includes(id));
    return kept.length === pool.length ? null : kept;
  };
  const next: QuestionAudience = {
    vendorIds: narrow(audience.vendorIds, roster.vendorIds),
    lineIds: narrow(audience.lineIds, roster.lineIds),
  };

  const current = holder.audience ?? {};
  const existing = current[questionId];
  if (isEveryone(next)) {
    if (existing === undefined) return holder;
    const rest = { ...current };
    delete rest[questionId];
    return { ...holder, audience: Object.keys(rest).length === 0 ? undefined : rest };
  }
  if (
    existing !== undefined
    && sameIds(existing.vendorIds, next.vendorIds)
    && sameIds(existing.lineIds, next.lineIds)
  ) {
    return holder;
  }
  return { ...holder, audience: { ...current, [questionId]: next } };
}

/** Store the same narrowing against several questions in one pass. */
export function setAudienceOnAll<T extends AudienceHolder>(
  holder: T,
  questionIds: Id[],
  change: Partial<QuestionAudience>,
  roster: AudienceRoster,
): T {
  let next = holder;
  for (const questionId of questionIds) {
    next = setQuestionAudience(
      next, questionId, { ...audienceOf(next, questionId), ...change }, roster,
    );
  }
  return next;
}

/**
 * The audience several questions share, or null where they differ.
 *
 * What a bulk picker has to open on. Showing one question's narrowing as if it
 * were all of theirs would apply it to the rest the moment Apply is pressed,
 * which is a change the buyer never made.
 */
export function commonAudience(
  holder: AudienceHolder, questionIds: Id[],
): QuestionAudience | null {
  if (questionIds.length === 0) return null;
  const first = audienceOf(holder, questionIds[0]);
  const agrees = questionIds.every((id) => {
    const audience = audienceOf(holder, id);
    return sameIds(audience.vendorIds, first.vendorIds)
      && sameIds(audience.lineIds, first.lineIds);
  });
  return agrees ? first : null;
}

/**
 * Drop references the event no longer holds.
 *
 * A supplier dropped from the shortlist, a line removed from the basket, a
 * question deleted — each leaves an id behind that means nothing. They are
 * cleared before anything is counted off them, because a stale id inflates
 * every "3 of 6" on the page.
 *
 * A narrowing that loses its last id stays an empty list, not "everyone". The
 * two look nothing alike to the suppliers who would be asked, and a form that
 * silently widened itself back out is one nobody would think to check.
 *
 * Returns the holder unchanged — the same object — when there was nothing to
 * clear, so a caller can use it as the test for whether to write at all.
 */
export function pruneAudience<T extends AudienceHolder>(holder: T, roster: AudienceRoster): T {
  const current = holder.audience;
  if (current === undefined) return holder;

  const live = new Set(holder.questions.map((q) => q.id));
  const kept: Record<Id, QuestionAudience> = {};
  let changed = false;

  for (const [questionId, audience] of Object.entries(current)) {
    if (!live.has(questionId)) { changed = true; continue; }
    const vendorIds = audience.vendorIds === null
      ? null
      : roster.vendorIds.filter((id) => audience.vendorIds!.includes(id));
    const lineIds = audience.lineIds === null
      ? null
      : roster.lineIds.filter((id) => audience.lineIds!.includes(id));
    if (vendorIds === null && lineIds === null) { changed = true; continue; }
    if (sameIds(vendorIds, audience.vendorIds) && sameIds(lineIds, audience.lineIds)) {
      kept[questionId] = audience;
      continue;
    }
    kept[questionId] = { vendorIds, lineIds };
    changed = true;
  }

  if (!changed) return holder;
  return { ...holder, audience: Object.keys(kept).length === 0 ? undefined : kept };
}
