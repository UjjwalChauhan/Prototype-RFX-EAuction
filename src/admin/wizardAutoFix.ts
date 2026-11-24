/**
 * Auto-fix for the Create sourcing event wizard.
 *
 * Every blocking check the wizard raises has a fix that can be read off the
 * rule that raised it: a choice list with no choices takes the suggested set
 * for its type, commercial questions asked at the RFI move to the first priced
 * ask, section shares are rescaled to 100, a stage short of evaluators is given
 * the first eligible one, and so on. Each fix is applied here, on a copy of the
 * draft, and described in a sentence the buyer can read before keeping it.
 *
 * What cannot be decided for the buyer — what to source, a formula, the
 * columns of a grid — is left alone and reported as left, never guessed.
 */
import { COUNTERPARTIES } from '../data/seed';
import { BUDGET_LINES } from '../data/sourcingFields';
import { EVALUATORS } from '../data/evaluators';
import { TERMS_TEMPLATES } from '../data/termsTemplates';
import { defaultShortlist } from '../domain/bidders';
import {
  fillEvaluatorGaps, gateOf, judgesMerit, usesScore,
  type EvaluationSetup, type StageFacts,
} from '../domain/evaluationSetup';
import { roundToNextHour, validateSchedule } from '../domain/eventTimeline';
import { isChoiceType, optionsFromPreset, presetById, presetsFor } from '../domain/questionTypes';
import {
  PRICED_QUESTION_TYPES, draftAsTemplate, sectionBudgets, sectionWeightTotal, isScoredTemplate,
  validateTemplate, type DraftQuestionnaire,
} from '../domain/questionnaireTemplates';
import { stageWindows, type SolicitationStage } from '../domain/stageEvents';
import {
  PRICED_POINTS, alignTermsToJourney, instantiateTerms, validateTerms, type TermsDocumentInput,
} from '../domain/terms';
import type { QuestionOption, TemplateQuestion, VendorInputPoint } from '../domain/types';
import { draftEnvelope, type Draft } from './CreateEventWizard';

export interface AutoFixChange {
  step: string;
  text: string;
}

export interface AutoFixContext {
  /** Points a questionnaire is asked at (the auction excluded). */
  questionnairePoints: VendorInputPoint[];
  /** Every point the journey asks the supplier at — terms are judged against these. */
  inputPoints: VendorInputPoint[];
  /** The asks the event creates, in order. */
  stages: readonly SolicitationStage[];
  showVendors: boolean;
  hasEvaluation: boolean;
  /** What evaluation works with for a given draft — recomputed after questionnaire fixes. */
  factsOf: (draft: Draft) => StageFacts[];
  costCentres: { code: string; businessUnit: string }[];
  now: number;
}

export interface AutoFixResult {
  draft: Draft;
  changes: AutoFixChange[];
}

export const AUTO_FIX_STEPS = ['Basics', 'Items & Vendors', 'Questionnaire', 'Terms', 'Evaluation', 'Timeline'] as const;

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function fixBasics(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  let next = draft;
  if (!draft.title.trim()) {
    const lot = draft.lines[0]?.lotName.replace(/^Lot \d+\s*·\s*/, '') || draft.lines[0]?.description;
    const title = `${draft.category}${lot ? ` — ${lot}` : ''} sourcing`;
    next = { ...next, title };
    changes.push({ step: 'Basics', text: `Titled the event "${title}" from its category and first lot` });
  }
  if (!next.costCentre) {
    const centre = ctx.costCentres.find((c) => c.businessUnit === next.businessUnit) ?? ctx.costCentres[0];
    if (centre) {
      next = { ...next, costCentre: centre.code, businessUnit: centre.businessUnit };
      changes.push({ step: 'Basics', text: `Raised it under cost centre ${centre.code} (${centre.businessUnit})` });
    }
  }
  if (!next.budgetLine && BUDGET_LINES.length > 0) {
    next = { ...next, budgetLine: BUDGET_LINES[0] };
    changes.push({ step: 'Basics', text: `Committed it against the budget line "${BUDGET_LINES[0]}"` });
  }
  return { draft: next, changes };
}

// ---------------------------------------------------------------------------
// Items & Vendors
// ---------------------------------------------------------------------------

export function fixVendors(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  if (!ctx.showVendors || draft.lines.length === 0) return { draft, changes };
  const provisional = new Set(COUNTERPARTIES.filter((c) => c.isProvisional).map((c) => c.id));
  const invitedByLine = { ...draft.invitedByLine };
  const vendorIds = [...draft.vendorIds];
  const added = new Set<string>();
  const covered: string[] = [];
  for (const line of draft.lines) {
    const invited = invitedByLine[line.id] ?? [];
    if (invited.some((id) => !provisional.has(id))) continue;
    const shortlist = defaultShortlist(COUNTERPARTIES, line.category || draft.category, line.superCategory);
    if (shortlist.length === 0) continue;
    invitedByLine[line.id] = [...new Set([...invited, ...shortlist])];
    for (const id of shortlist) {
      if (!vendorIds.includes(id)) { vendorIds.push(id); added.add(id); }
    }
    covered.push(line.itemCode);
  }
  if (covered.length > 0) {
    const names = [...added].map((id) => COUNTERPARTIES.find((c) => c.id === id)?.name ?? id);
    changes.push({
      step: 'Items & Vendors',
      text: `Invited onboarded suppliers to ${covered.join(', ')}${names.length > 0 ? ` — added ${names.join(', ')}` : ''}`,
    });
  }
  return { draft: { ...draft, invitedByLine, vendorIds }, changes };
}

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

const PRESET_BY_TITLE: [RegExp, string][] = [
  [/payment|credit/i, 'payment-terms'],
  [/incoterm/i, 'incoterms'],
  [/certif|iso\b/i, 'certifications'],
  [/region|geograph|served/i, 'regions'],
  [/msme|enterprise size|size of/i, 'enterprise-size'],
  [/type of (organi[sz]ation|entity)|legal (form|status)|constitution/i, 'org-type'],
  [/comply|compliance/i, 'compliance'],
];

/** The suggested set that fits this question best, else a plain Yes / No. */
function suggestedOptions(q: TemplateQuestion): { options: QuestionOption[]; name: string } {
  const presets = presetsFor(q.type);
  const byTitle = PRESET_BY_TITLE.find(([re, id]) => re.test(q.title) && presets.some((p) => p.id === id));
  const preset = byTitle ? presetById(byTitle[1]) : presets[0] ?? presetById('yes-no');
  return { options: optionsFromPreset(preset, q.id), name: preset.name };
}

/** One question made askable. Returns the fixed question and what changed. */
function fixQuestion(q: TemplateQuestion): { question: TemplateQuestion; notes: string[] } {
  const notes: string[] = [];
  let next: TemplateQuestion = { ...q, config: { ...q.config } };
  const title = q.title || q.code;

  if (isChoiceType(next.type)) {
    let options = (next.config.options ?? []).filter((o) => o.label.trim() !== '');
    const seen = new Set<string>();
    options = options.filter((o) => {
      const key = o.label.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (options.length < 2) {
      const suggested = suggestedOptions(next);
      options = suggested.options;
      notes.push(`gave "${title}" the suggested "${suggested.name}" choices`);
    } else if (options.length !== (next.config.options ?? []).length) {
      notes.push(`removed blank or repeated choices from "${title}"`);
    }
    next.config.options = options;
    if (next.scoringMethod === 'RULE' && !options.some((o) => o.score !== null)) {
      next = { ...next, scoringMethod: 'MANUAL' };
      notes.push(`"${title}" had no scored choice to compute, so it is now scored by hand`);
    }
    if (next.isKnockout && !options.some((o) => o.isDisqualifying)) {
      const failing = options.find((o) => /^(no|not comply|none|not held)\b/i.test(o.label.trim()))
        ?? [...options].filter((o) => o.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
      if (failing) {
        next.config.options = options.map((o) => (o.id === failing.id ? { ...o, isDisqualifying: true } : o));
        notes.push(`marked "${failing.label}" as the failing answer on knockout "${title}"`);
      } else {
        next = { ...next, isKnockout: false };
        notes.push(`"${title}" had no answer that could fail it, so it is no longer a knockout`);
      }
    }
    const count = (next.config.options ?? []).length;
    if (next.config.minSelections && next.config.minSelections > count) {
      next.config.minSelections = count;
      notes.push(`lowered the minimum selections on "${title}" to the ${count} choices it has`);
    }
  }

  const { minSelections, maxSelections, min, max, earliest, latest } = next.config;
  if (minSelections && maxSelections && minSelections > maxSelections) {
    next.config.minSelections = maxSelections;
    notes.push(`aligned the selection limits on "${title}"`);
  }
  if (min != null && max != null && min > max) {
    next.config.min = max;
    next.config.max = min;
    notes.push(`swapped the reversed range on "${title}"`);
  }
  if (earliest && latest && earliest > latest) {
    next.config.earliest = latest;
    next.config.latest = earliest;
    notes.push(`swapped the reversed date window on "${title}"`);
  }
  if (next.type === 'compliance_statement' && !(next.config.body ?? '').trim()) {
    next.config.body = `The supplier confirms full compliance with: ${title}.`;
    notes.push(`wrote the compliance statement for "${title}"`);
  }
  if (PRICED_QUESTION_TYPES.includes(next.type) && next.weight > 0) {
    next = { ...next, weight: 0 };
    notes.push(`took the weight off "${title}" — price is scored through the price component`);
  }
  if (next.weight > 0 && next.scoringMethod === 'NONE' && !PRICED_QUESTION_TYPES.includes(next.type)) {
    next = { ...next, scoringMethod: 'MANUAL' };
    notes.push(`"${title}" carried weight but was not scored — it is now scored by hand`);
  }
  if (next.askedPer === 'LINE' && next.isKnockout) {
    next = { ...next, askedPer: 'VENDOR' };
    notes.push(`knockout "${title}" is now asked once per supplier, not per line`);
  }
  return { question: next, notes };
}

/** Split `total` into whole shares in proportion to `parts`, summing exactly to `total`. */
function apportion(parts: number[], total: number): number[] {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return parts.map((_, i) => (i === 0 ? total : 0));
  const exact = parts.map((p) => (p / sum) * total);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Sections and their budgets, made to add up. */
function fixSections(q: DraftQuestionnaire): { questionnaire: DraftQuestionnaire; notes: string[] } {
  const notes: string[] = [];
  let next = { ...q, sections: q.sections.map((s) => ({ ...s })), questions: q.questions.map((x) => ({ ...x })) };

  if (!(next.scoreScale > 0)) {
    next.scoreScale = 100;
    notes.push('set the score scale to 100');
  }
  const sectionIds = new Set(next.sections.map((s) => s.id));
  const orphans = next.questions.filter((x) => x.sectionId !== null && !sectionIds.has(x.sectionId));
  if (orphans.length > 0) {
    const home = next.sections[0]?.id ?? null;
    next.questions = next.questions.map((x) => (x.sectionId !== null && !sectionIds.has(x.sectionId) ? { ...x, sectionId: home } : x));
    notes.push(`moved ${orphans.length} question(s) out of a deleted section`);
  }

  const template = () => draftAsTemplate(next);
  // A section scoring questions with no share of its own takes the share its questions carry.
  for (const budget of sectionBudgets(template())) {
    if (budget.declared === 0 && budget.scored > 0) {
      next.sections = next.sections.map((s) => (s.id === budget.section.id ? { ...s, weight: Math.max(1, budget.allocated) } : s));
      notes.push(`gave "${budget.section.name}" a share for the questions it scores`);
    }
  }
  if (isScoredTemplate(template()) && sectionWeightTotal(template()) !== 100) {
    const before = sectionWeightTotal(template());
    const shares = apportion(next.sections.map((s) => Math.max(0, s.weight)), 100);
    next.sections = next.sections.map((s, i) => ({ ...s, weight: shares[i] }));
    notes.push(`rescaled the section shares from ${before}% to 100%`);
  }
  for (const budget of sectionBudgets(template())) {
    if (!budget.overspent) continue;
    const inside = next.questions.filter((x) => x.sectionId === budget.section.id && x.weight > 0 && x.scoringMethod !== 'NONE');
    const weights = apportion(inside.map((x) => x.weight), budget.declared);
    next.questions = next.questions.map((x) => {
      const i = inside.findIndex((y) => y.id === x.id);
      return i < 0 ? x : { ...x, weight: weights[i] };
    });
    notes.push(`scaled the questions in "${budget.section.name}" to fit its ${budget.declared}% share`);
  }
  return { questionnaire: next, notes };
}

/** Codes are the join key for answer inheritance, so a repeat is renamed. */
function fixCodes(q: DraftQuestionnaire): { questionnaire: DraftQuestionnaire; notes: string[] } {
  const used = new Set<string>();
  const notes: string[] = [];
  const questions = q.questions.map((x) => {
    if (!used.has(x.code)) { used.add(x.code); return x; }
    let n = 2;
    while (used.has(`${x.code}-${n}`)) n += 1;
    const code = `${x.code}-${n}`;
    used.add(code);
    notes.push(`renamed the repeated code ${x.code} to ${code}`);
    return { ...x, code };
  });
  return { questionnaire: { ...q, questions }, notes };
}

export function fixQuestionnaires(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  const say = (q: DraftQuestionnaire, text: string) => changes.push({ step: 'Questionnaire', text: `${q.point}${q.category ? ` · ${q.category}` : ''}: ${text}` });
  let questionnaires = draft.questionnaires.map((q) => ({ ...q, questions: [...q.questions], sections: [...q.sections] }));

  // RFI is pre-commercial: its commercial questions move to the first priced ask.
  const pricedPoints = ctx.questionnairePoints.filter((p) => PRICED_POINTS.includes(p));
  questionnaires = questionnaires.map((rfi) => {
    if (rfi.point !== 'RFI' || !ctx.questionnairePoints.includes('RFI')) return rfi;
    const commercial = rfi.questions.filter((x) => x.envelope === 'COMMERCIAL');
    if (commercial.length === 0) return rfi;
    // The first priced ask that already carries a questionnaire for this category.
    const destination = pricedPoints
      .map((p) => questionnaires.find((q) => q.point === p && q.category === rfi.category && q.questions.length > 0))
      .find(Boolean);
    const target = destination?.point;
    if (destination) {
      const codes = new Set(destination.questions.map((x) => x.code));
      const moving = commercial.filter((x) => !codes.has(x.code));
      const sectionOf = (id: string | null) => {
        const name = rfi.sections.find((s) => s.id === id)?.name;
        return destination.sections.find((s) => s.name === name)?.id ?? null;
      };
      const last = destination.questions.reduce((m, x) => Math.max(m, x.sequence), 0);
      destination.questions = [
        ...destination.questions,
        ...moving.map((x, i) => ({ ...x, id: `${x.id}-${target}`, sectionId: sectionOf(x.sectionId), sequence: last + i + 1 })),
      ];
      say(rfi, `moved ${moving.length} commercial question${moving.length === 1 ? '' : 's'} to the ${target}${moving.length < commercial.length ? ` (${commercial.length - moving.length} already asked there)` : ''}`);
    } else {
      say(rfi, `removed ${commercial.length} commercial question${commercial.length === 1 ? '' : 's'} — the RFI asks for no price`);
    }
    const audience = rfi.audience ? Object.fromEntries(Object.entries(rfi.audience).filter(([id]) => !commercial.some((x) => x.id === id))) : rfi.audience;
    return { ...rfi, questions: rfi.questions.filter((x) => x.envelope !== 'COMMERCIAL'), audience };
  });

  questionnaires = questionnaires.map((q) => {
    if (!ctx.questionnairePoints.includes(q.point) || q.questions.length === 0) return q;
    if (validateTemplate(draftAsTemplate(q)).errors.length === 0) return q;
    let next = q;
    const fixed = next.questions.map(fixQuestion);
    next = { ...next, questions: fixed.map((f) => f.question) };
    const notes = fixed.flatMap((f) => f.notes);
    const codes = fixCodes(next);
    next = codes.questionnaire;
    const sections = fixSections(next);
    next = sections.questionnaire;
    const all = [...notes, ...codes.notes, ...sections.notes];
    if (all.length <= 4) all.forEach((n) => say(q, n));
    else {
      all.slice(0, 3).forEach((n) => say(q, n));
      say(q, `and ${all.length - 3} more question fixes`);
    }
    return next;
  });

  return { draft: { ...draft, questionnaires }, changes };
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export function fixTerms(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  const say = (text: string) => changes.push({ step: 'Terms', text });
  const points = ctx.inputPoints;
  if (validateTerms(draft.terms, points).every((i) => !i.blocking)) return { draft, changes };

  let terms: TermsDocumentInput[] = draft.terms.map((d) => ({ ...d, appliesTo: [...d.appliesTo] }));
  const libraryOf = (d: TermsDocumentInput) => TERMS_TEMPLATES.find((t) => t.id === d.templateId)
    ?? TERMS_TEMPLATES.find((t) => t.category === d.category);

  // Documents with nothing in them take their library clauses, or go.
  terms = terms.flatMap((d) => {
    if (d.clauses.length > 0 || d.attachmentName !== null) return [d];
    const library = libraryOf(d);
    if (!library) { say(`Removed "${d.title}" — it had nothing for a supplier to accept`); return []; }
    const fresh = instantiateTerms(library, 'fix', d.appliesTo);
    say(`Filled "${d.title}" with the library's ${fresh.clauses.length} clauses`);
    return [{ ...d, clauses: fresh.clauses.map((c, i) => ({ ...c, id: `${d.id}-c${i + 1}` })), payment: d.payment ?? fresh.payment }];
  });

  // Payment figures that cannot be true.
  terms = terms.map((d) => {
    if (d.category !== 'PAYMENT') return d;
    let payment = d.payment ?? libraryOf(d)?.payment ?? null;
    if (payment === null) return d;
    const before = JSON.stringify(d.payment);
    payment = {
      ...payment,
      creditDays: Math.max(0, payment.creditDays),
      advancePct: Math.max(0, payment.advancePct),
      retentionPct: Math.max(0, payment.retentionPct),
    };
    if (payment.advancePct + payment.retentionPct > 100) payment = { ...payment, retentionPct: 100 - payment.advancePct };
    if (JSON.stringify(payment) !== before) say(`Corrected the payment figures on "${d.title}"`);
    return { ...d, payment };
  });

  // Applied nowhere: put it where its library template would be.
  terms = terms.map((d) => {
    if (d.appliesTo.some((p) => points.includes(p))) return d;
    const wanted = (libraryOf(d)?.defaultAppliesTo ?? points).filter((p) => points.includes(p));
    const appliesTo = wanted.length > 0 ? wanted : points;
    say(`Applied "${d.title}" at ${appliesTo.join(', ')}`);
    return { ...d, appliesTo };
  });

  // Two payment documents at one ask: the first stands.
  for (const point of points) {
    const payments = terms.filter((d) => d.category === 'PAYMENT' && d.appliesTo.includes(point));
    for (const extra of payments.slice(1)) {
      extra.appliesTo = extra.appliesTo.filter((p) => p !== point);
      say(`Took "${extra.title}" off ${point} — "${payments[0].title}" already sets payment there`);
    }
  }

  const aligned = alignTermsToJourney(terms, points);
  if (JSON.stringify(aligned.map((d) => d.appliesTo)) !== JSON.stringify(terms.map((d) => d.appliesTo))) {
    say('Widened the general and payment terms to every ask this journey runs');
  }
  terms = aligned;

  // A category nothing covers is taken from the library.
  const add = (category: 'GENERAL' | 'PAYMENT', wanted: VendorInputPoint[]) => {
    const missing = wanted.filter((p) => !terms.some((d) => d.category === category && d.appliesTo.includes(p)));
    if (missing.length === 0) return;
    const library = TERMS_TEMPLATES.find((t) => t.category === category);
    if (!library) return;
    terms = [...terms, instantiateTerms(library, `fix-${Date.now()}`, missing)];
    say(`Added "${library.title}" from the library at ${missing.join(', ')}`);
  };
  add('GENERAL', points);
  add('PAYMENT', points.filter((p) => PRICED_POINTS.includes(p) && p !== 'RFP'));

  return { draft: { ...draft, terms }, changes };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function fixEvaluation(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  if (!ctx.hasEvaluation) return { draft, changes };
  const facts = ctx.factsOf(draft);
  let setup: EvaluationSetup = draft.evaluation;

  for (const f of facts) {
    if (!judgesMerit(f.kind)) continue;
    const gate = gateOf(setup, f.stage, f.kind);
    if (usesScore(gate.gate) && f.questions.scored.length === 0) {
      const to = f.questions.knockouts.length > 0 ? 'PASS_FAIL' : 'NONE';
      setup = { ...setup, gates: { ...setup.gates, [f.stage]: { ...gate, gate: to } } };
      changes.push({ step: 'Evaluation', text: `${f.stage} scores nothing, so its gate is now ${to === 'PASS_FAIL' ? 'pass / fail on its knockouts' : 'none'}` });
    } else if (usesScore(gate.gate) && (gate.minScore <= 0 || gate.minScore > 100)) {
      setup = { ...setup, gates: { ...setup.gates, [f.stage]: { ...gate, minScore: 60 } } };
      changes.push({ step: 'Evaluation', text: `Set ${f.stage}'s minimum score to 60, the tenant default` });
    }
  }

  // The envelope boundary: whoever scores a technical envelope gives up the commercial one.
  if (draftEnvelope(draft) === 'TWO_ENVELOPE') {
    const technical = new Set(facts.flatMap((f) => setup.technicalEvaluators[f.stage] ?? []));
    const commercial = Object.fromEntries(Object.entries(setup.commercialEvaluators).map(([stage, ids]) => {
      const kept = (ids ?? []).filter((id) => !technical.has(id));
      return [stage, kept];
    }));
    const dropped = [...new Set(Object.values(setup.commercialEvaluators).flat())].filter((id) => id && technical.has(id));
    if (dropped.length > 0) {
      setup = { ...setup, commercialEvaluators: commercial };
      const names = dropped.map((id) => EVALUATORS.find((e) => e.id === id)?.name ?? id);
      changes.push({ step: 'Evaluation', text: `Kept ${names.join(', ')} on the technical envelope only — a technical evaluator never sees price` });
    }
  }

  const filled = fillEvaluatorGaps(setup, facts, draftEnvelope(draft), EVALUATORS);
  for (const a of filled.added) {
    const name = EVALUATORS.find((e) => e.id === a.id)?.name ?? a.id;
    changes.push({ step: 'Evaluation', text: `Named ${name} as ${a.role === 'TECHNICAL' ? 'a technical' : 'the commercial'} evaluator on ${a.stage}` });
  }
  return { draft: { ...draft, evaluation: filled.setup }, changes };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function blockingScheduleIssues(draft: Draft, ctx: AutoFixContext): number {
  const schedule = stageWindows(ctx.stages, {
    opensAt: draft.startAt, closesInHours: draft.closesInHours, stageHours: draft.stageHours,
    windows: draft.stageWindowOverrides, rules: draft.timelineRules,
  }, draft.startAt);
  return validateSchedule(schedule, draft.timelineRules, ctx.now).filter((i) => i.blocking).length;
}

export function fixTimeline(draft: Draft, ctx: AutoFixContext): AutoFixResult {
  const changes: AutoFixChange[] = [];
  if (ctx.stages.length === 0 || blockingScheduleIssues(draft, ctx) === 0) return { draft, changes };
  const rules = draft.timelineRules;
  const lo = rules.minResponseWindowHours;
  const hi = rules.maxResponseWindowDays * 24;
  const clamp = (h: number) => Math.min(hi, Math.max(lo, h));

  const steps: [string, (d: Draft) => Draft][] = [
    ['Cleared the hand-set dates so every ask runs in sequence', (d) => ({ ...d, stageWindowOverrides: {} })],
    [`Kept every response window between ${lo}h and ${rules.maxResponseWindowDays} days`, (d) => ({
      ...d,
      closesInHours: clamp(d.closesInHours),
      stageHours: Object.fromEntries(Object.entries(d.stageHours).map(([stage, h]) => [stage, stage === 'AUCTION' ? Math.max(1, h ?? 1) : clamp(h ?? d.closesInHours)])),
    })],
    ['Started the first ask at the next full hour', (d) => ({ ...d, startAt: Math.max(d.startAt, roundToNextHour(ctx.now)) })],
    ['Reset the per-ask windows to the event default', (d) => ({ ...d, stageHours: {}, closesInHours: clamp(72) })],
  ];
  let next = draft;
  for (const [text, apply] of steps) {
    const tried = apply(next);
    if (JSON.stringify(tried) === JSON.stringify(next)) continue;
    next = tried;
    changes.push({ step: 'Timeline', text });
    if (blockingScheduleIssues(next, ctx) === 0) break;
  }
  return { draft: next, changes };
}

// ---------------------------------------------------------------------------
// All together
// ---------------------------------------------------------------------------

const FIXERS: Record<(typeof AUTO_FIX_STEPS)[number], (d: Draft, c: AutoFixContext) => AutoFixResult> = {
  Basics: fixBasics,
  'Items & Vendors': fixVendors,
  Questionnaire: fixQuestionnaires,
  Terms: fixTerms,
  Evaluation: fixEvaluation,
  Timeline: fixTimeline,
};

/**
 * Fix the named steps, or every step. Questionnaire runs before Evaluation so
 * gates and evaluators are judged against the questions as fixed.
 */
export function autoFix(draft: Draft, ctx: AutoFixContext, only?: string[]): AutoFixResult {
  let next = draft;
  const changes: AutoFixChange[] = [];
  for (const step of AUTO_FIX_STEPS) {
    if (only && !only.includes(step)) continue;
    const result = FIXERS[step](next, ctx);
    next = result.draft;
    changes.push(...result.changes);
  }
  return { draft: next, changes };
}

export function canAutoFix(step: string): boolean {
  return (AUTO_FIX_STEPS as readonly string[]).includes(step);
}
