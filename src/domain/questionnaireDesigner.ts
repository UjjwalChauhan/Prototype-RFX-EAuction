/**
 * AG-03 on the event wizard's Questionnaire step — read the basket and the
 * shortlist, interview the buyer, hand back a spreadsheet.
 *
 * `questionnaireAgent.ts` drafts for a *category* inside the template library.
 * This is the same agent working on a *live event*: it can see the lines being
 * bought and the suppliers who will be asked, so it can say things a category
 * corpus cannot — "six of your eight items are consumables bought by the
 * hundred, so a monthly capacity question per item earns its place", or "two of
 * the three suppliers have no delivery history here, so ask for references".
 *
 * Three rules carry over from AG-03's mandate (DRAFT, cannot publish):
 *
 * - **The buyer sets the ceiling.** The first thing asked is the most questions
 *   they are willing to put in front of a supplier. Everything is trimmed to
 *   that number and the trimming is explained — a questionnaire longer than the
 *   buyer asked for would be the agent deciding what a supplier should put up
 *   with.
 * - **The output is the upload format.** The agent does not write into the
 *   event. It produces the same Excel / CSV the Upload button reads, and the
 *   buyer loads it through that importer, so it passes every rule a
 *   hand-written sheet does and the buyer can open it, edit it, and upload it
 *   back.
 * - **No language model.** Wording comes from market practice, the library and
 *   a small set of per-item templates in this file. Where a model would go is
 *   `rankCandidates`.
 */
import { BUYER_CONCERNS } from '../data/procurementCategories';
import {
  answerProbe, emptyBrief, proposeQuestions,
  type AgentBrief, type AgentProposal, type Probe,
} from './questionnaireAgent';
import {
  ENVELOPE_IMPORT_LABEL, IMPORT_COLUMNS, SCORING_IMPORT_LABEL,
  type ImportField,
} from './questionnaireImport';
import { QUESTION_TYPE_SPEC } from './questionTypes';
import { QUESTION_SCOPE_LABEL } from './questionnaireTemplates';
import type {
  Counterparty, QuestionnaireTemplate, VendorInputPoint,
} from './types';

// ---------------------------------------------------------------------------
// What the agent can see
// ---------------------------------------------------------------------------

export interface SeenLine {
  id: string;
  description: string;
  specification: string;
  quantity: number;
  uom: string;
  category: string;
}

export interface EventSight {
  point: VendorInputPoint;
  /** The category this questionnaire is for; null when the event is not split. */
  category: string | null;
  categories: string[];
  lines: SeenLine[];
  suppliers: Counterparty[];
}

export interface Reading {
  itemCount: number;
  distinctItems: number;
  withSpecification: number;
  totalQuantity: number;
  /** Units of measure that point to a service rather than goods. */
  serviceLike: number;
  supplierCount: number;
  provisional: number;
  /** On the master but with no delivery history here. */
  noTrackRecord: number;
  /** The facts, in sentences, shown before the first question. */
  observations: string[];
}

const SERVICE_UOMS = /^(hr|hrs|hour|hours|day|days|month|months|visit|visits|job|jobs|lot|ls|service|man-?day|mandays?)$/i;

export function readEvent(sight: EventSight): Reading {
  const { lines, suppliers } = sight;
  const distinct = new Set(lines.map((l) => (l.description ?? '').trim().toLowerCase())).size;
  const withSpec = lines.filter((l) => (l.specification ?? '').trim() !== '').length;
  const serviceLike = lines.filter((l) => SERVICE_UOMS.test((l.uom ?? '').trim())).length;
  const provisional = suppliers.filter((s) => s.isProvisional).length;
  const noTrack = suppliers.filter((s) => !s.isProvisional && s.performanceRating <= 0).length;
  const totalQuantity = lines.reduce((sum, l) => sum + (l.quantity || 0), 0);

  const observations: string[] = [];
  if (lines.length === 0) {
    observations.push('No items on this event yet, so I can only ask about the suppliers.');
  } else {
    const names = lines.slice(0, 3).map((l) => l.description).join(', ');
    observations.push(
      `${lines.length} item${lines.length === 1 ? '' : 's'} (${names}${lines.length > 3 ? ', …' : ''})`
      + `${sight.category ? ` in ${sight.category}` : ''}, ${totalQuantity.toLocaleString('en-IN')} units in all.`,
    );
    if (serviceLike > 0) {
      observations.push(`${serviceLike} line${serviceLike === 1 ? ' is' : 's are'} measured like a service (hours, days, visits), so delivery means mobilisation, not shipping.`);
    }
    if (withSpec < lines.length) {
      observations.push(`${lines.length - withSpec} line${lines.length - withSpec === 1 ? ' has' : 's have'} no specification, so a per-item compliance question would have nothing to check against.`);
    }
  }
  if (suppliers.length === 0) {
    observations.push('No suppliers shortlisted yet — I will assume a mixed field.');
  } else {
    observations.push(
      `${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}: ${suppliers.slice(0, 3).map((s) => s.name).join(', ')}${suppliers.length > 3 ? ', …' : ''}.`,
    );
    if (provisional + noTrack > 0) {
      observations.push(`${provisional + noTrack} of them ${provisional + noTrack === 1 ? 'is' : 'are'} ${provisional > 0 ? 'provisional or ' : ''}without delivery history, so their claims have not been tested.`);
    }
  }

  return {
    itemCount: lines.length, distinctItems: distinct, withSpecification: withSpec,
    totalQuantity, serviceLike, supplierCount: suppliers.length,
    provisional, noTrackRecord: noTrack, observations,
  };
}

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

export const MAX_QUESTION_CHOICES = [5, 8, 10, 15, 20, 30] as const;
export const MAX_QUESTIONS_HARD_LIMIT = 60;

export type DesignProbeId =
  | 'max' | 'concerns' | 'perItem' | 'newSuppliers' | 'incumbent' | 'notes';

export interface DesignBrief {
  base: AgentBrief;
  /** Null until the buyer answers. The agent never drafts without it. */
  maxQuestions: number | null;
  perItem: boolean | null;
  askNewSuppliers: boolean | null;
}

export const emptyDesignBrief = (sight: EventSight): DesignBrief => ({
  base: emptyBrief(sight.category ? [sight.category] : sight.categories, sight.point),
  maxQuestions: null, perItem: null, askNewSuppliers: null,
});

export interface DesignProbe extends Omit<Probe, 'id'> {
  id: DesignProbeId;
  /** `number` renders a numeric box beside the choices. */
  allowNumber?: boolean;
}

/**
 * Every probe the agent might ask for this event, in order. Probes that have
 * no reason to be asked here (a single item, no unproven suppliers) are
 * absent rather than skipped — a question whose answer cannot change the draft
 * is noise.
 */
export function designProbes(reading: Reading): DesignProbe[] {
  const probes: DesignProbe[] = [
    {
      id: 'max',
      question: 'What is the most questions you want in this questionnaire?',
      because: `A supplier answering ${reading.supplierCount || 'several'} bids at once gives short questionnaires more attention. I will rank everything I would ask and cut to this number, keeping knockouts and the questions that fit your priorities first.`,
      choices: MAX_QUESTION_CHOICES.map((n) => ({
        id: String(n), label: `${n} questions`,
        blurb: n <= 8 ? 'Qualification only.' : n <= 15 ? 'A proportionate technical set.' : 'Detailed.',
      })),
      multi: false, optional: false, allowNumber: true,
    },
    {
      id: 'concerns',
      question: 'What matters most when you compare these suppliers?',
      because: 'It decides which questions survive the cut. Each one I keep has to serve something you named.',
      choices: BUYER_CONCERNS.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb })),
      multi: true, optional: false,
    },
  ];

  if (reading.itemCount > 1) {
    probes.push({
      id: 'perItem',
      question: `Should suppliers also answer a few questions for each of the ${reading.itemCount} items?`,
      because: `Per-item questions are answered once per line — a supplier owes ${reading.itemCount} answers for each one. ${reading.distinctItems < reading.itemCount ? 'Some of your lines repeat, so this multiplies. ' : ''}Worth it for lead time and capacity; not for company facts.`,
      choices: [
        { id: 'YES', label: 'Yes — lead time, capacity and specification fit per item' },
        { id: 'NO', label: 'No — only ask about the company' },
      ],
      multi: false, optional: false,
    });
  }

  if (reading.provisional + reading.noTrackRecord > 0) {
    const n = reading.provisional + reading.noTrackRecord;
    probes.push({
      id: 'newSuppliers',
      question: `${n} of your ${reading.supplierCount} suppliers have no delivery history with you. Ask for references and financial proof?`,
      because: 'A claim from a supplier you have never bought from is worth less than the same claim from one you have. References and audited accounts are the cheapest way to test it.',
      choices: [
        { id: 'YES', label: 'Yes, ask for references and financials' },
        { id: 'NO', label: 'No, treat everyone the same' },
      ],
      multi: false, optional: true,
    });
  }

  probes.push(
    {
      id: 'incumbent',
      question: 'Is one of these suppliers the incumbent?',
      because: 'With an incumbent you already know half the answers; the questions that matter are about transition and continuity.',
      choices: [{ id: 'YES', label: 'Yes' }, { id: 'NO', label: 'No, this is a new requirement' }],
      multi: false, optional: true,
    },
    {
      id: 'notes',
      question: 'Anything specific to this buy I should ask about?',
      because: 'Market practice is the floor. A site constraint or a regulation particular to this requirement will not be in any corpus.',
      choices: [], multi: false, optional: true,
    },
  );
  return probes;
}

export function nextDesignProbe(reading: Reading, answered: string[]): DesignProbe | null {
  return designProbes(reading).find((p) => !answered.includes(p.id)) ?? null;
}

export function clampMax(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(1, Math.min(MAX_QUESTIONS_HARD_LIMIT, Math.round(value)));
}

export function answerDesignProbe(
  brief: DesignBrief, id: DesignProbeId, value: string[],
): DesignBrief {
  switch (id) {
    case 'max': {
      const n = clampMax(Number(value[0]));
      return { ...brief, maxQuestions: n === 0 ? null : n };
    }
    case 'concerns': return { ...brief, base: answerProbe(brief.base, 'concerns', value) };
    case 'incumbent': return { ...brief, base: answerProbe(brief.base, 'incumbent', value) };
    case 'notes': return { ...brief, base: answerProbe(brief.base, 'notes', value) };
    case 'perItem': return { ...brief, perItem: value[0] === 'YES' };
    case 'newSuppliers': return { ...brief, askNewSuppliers: value[0] === 'YES' };
  }
}

export const canDesign = (brief: DesignBrief): boolean =>
  brief.maxQuestions !== null && brief.maxQuestions > 0 && brief.base.concerns.length > 0;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface DesignQuestion {
  code: string;
  title: string;
  helpText: string;
  type: AgentProposal['type'];
  envelope: AgentProposal['envelope'];
  scoringMethod: AgentProposal['scoringMethod'];
  weight: number;
  isKnockout: boolean;
  allowAttachment: boolean;
  rubric: string;
  section: string;
  perLine: boolean;
  choices: string;
  settings: string;
  /** Why it is in. Shown on the plan and in the Help sheet. */
  reason: string;
  /** Higher is kept first when the ceiling bites. */
  priority: number;
}

const COMPANY = 'Company & compliance';
const TRACK = 'Track record & finances';
const PER_ITEM = 'Per item commitments';

/** Choice lists for the types that need one, so the sheet imports without edits. */
const DEFAULT_CHOICES: Partial<Record<AgentProposal['type'], string>> = {
  yes_no: 'Yes = 10 | No = 0',
  single_choice: 'Yes, in full = 10 | Partly = 5 | No = 0',
  compliance_statement: 'Comply = 10 | Partially comply = 5 ! | Not comply = 0 !',
};

function perItemCandidates(reading: Reading): DesignQuestion[] {
  const service = reading.itemCount > 0 && reading.serviceLike >= reading.itemCount / 2;
  const out: DesignQuestion[] = [
    {
      code: 'ITEM.LEADTIME', section: PER_ITEM, perLine: true, type: 'lead_time',
      title: service
        ? 'How many working days after the purchase order can you mobilise for this line?'
        : 'What is your lead time for this item, from purchase order to delivery?',
      helpText: 'Working days, assuming no stock on hand.',
      envelope: 'TECHNICAL', scoringMethod: 'RULE', weight: 30, isKnockout: false,
      allowAttachment: false, choices: '', settings: 'unit = days; min = 1; max = 120',
      rubric: '14 days or fewer = 10 · 30 days or fewer = 6 · longer = 2',
      reason: `Asked per item — ${reading.itemCount} lines, and a single slow line can hold up the order.`,
      priority: 80,
    },
    {
      code: 'ITEM.CAPACITY', section: PER_ITEM, perLine: true, type: 'capacity_declaration',
      title: 'What quantity of this item can you supply per month?',
      helpText: 'At steady state, without a premium for volume.',
      envelope: 'TECHNICAL', scoringMethod: 'MANUAL', weight: 25, isKnockout: false,
      allowAttachment: false, choices: '', settings: 'unit = units / month; min = 0',
      rubric: 'At or above the quantity demanded = 10 · below it = scaled to the shortfall',
      reason: `Total demand is ${reading.totalQuantity.toLocaleString('en-IN')} units; a supplier who quotes a price they cannot fill is the failure this prevents.`,
      priority: 70,
    },
  ];
  if (reading.withSpecification > 0) {
    out.push({
      code: 'ITEM.SPECFIT', section: PER_ITEM, perLine: true, type: 'compliance_statement',
      title: 'Does the item you are quoting meet the specification on this line?',
      helpText: 'If you are quoting an alternative, say so and explain the difference.',
      envelope: 'TECHNICAL', scoringMethod: 'RULE', weight: 25, isKnockout: false,
      allowAttachment: true, choices: DEFAULT_CHOICES.compliance_statement ?? '',
      settings: '', rubric: 'Comply = 10 · Partially comply = 5 · Not comply = 0',
      reason: `${reading.withSpecification} of ${reading.itemCount} lines carry a specification to check against.`,
      priority: 65,
    });
  }
  return out;
}

function supplierCandidates(reading: Reading): DesignQuestion[] {
  return [
    {
      code: 'SUP.REFERENCES', section: TRACK, perLine: false, type: 'reference_submission',
      title: 'Give two customers you have supplied the same scope to in the last three years.',
      helpText: 'Name, contact, value and year. We may call them.',
      envelope: 'TECHNICAL', scoringMethod: 'MANUAL', weight: 20, isKnockout: false,
      allowAttachment: false, choices: '', settings: '',
      rubric: 'Two verifiable, comparable references = 10 · One = 5 · None = 0',
      reason: `${reading.provisional + reading.noTrackRecord} shortlisted supplier(s) have no delivery history with you, so references are the only test of their claims.`,
      priority: 90,
    },
    {
      code: 'SUP.FINANCIALS', section: TRACK, perLine: false, type: 'file_upload',
      title: 'Attach your last two years of audited financial statements.',
      helpText: 'PDF or Excel.',
      envelope: 'TECHNICAL', scoringMethod: 'MANUAL', weight: 15, isKnockout: false,
      allowAttachment: false, choices: '', settings: 'formats = pdf, xlsx; maxFileSizeMb = 20',
      rubric: 'Two years supplied = 10 · One = 5 · None = 0',
      reason: 'New or unproven suppliers are where financial failure after award is most likely.',
      priority: 75,
    },
  ];
}

const fromProposal = (p: AgentProposal, base: number): DesignQuestion => ({
  code: p.code, title: p.title, helpText: p.helpText, type: p.type, envelope: p.envelope,
  scoringMethod: p.scoringMethod, weight: p.weight, isKnockout: p.isKnockout,
  allowAttachment: p.allowAttachment, rubric: p.rubric ?? '',
  section: p.section || COMPANY, perLine: false,
  choices: DEFAULT_CHOICES[p.type] ?? '', settings: '',
  reason: p.source === 'LIBRARY'
    ? `Already in ${p.citation} — same wording and code, so answers carry forward.`
    : p.rationale,
  // Knockouts and the library's own questions lead; confidence orders the rest.
  priority: base + p.confidence * 40 + (p.isKnockout ? 30 : 0) + (p.source === 'LIBRARY' ? 10 : 0),
});

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface DesignPlan {
  questions: DesignQuestion[];
  /** Everything that scored well enough to be asked but did not fit the ceiling. */
  cut: DesignQuestion[];
  maxQuestions: number;
  summary: string;
}

/**
 * Choose, cut and weigh.
 *
 * Per-item questions are capped at a third of the ceiling (at least one when
 * requested). Left uncapped they crowd out everything about the company, and
 * a per-item question is the expensive kind — it is answered once per line.
 */
export function designQuestionnaire({
  brief, reading, library,
}: {
  brief: DesignBrief;
  reading: Reading;
  library: QuestionnaireTemplate[];
}): DesignPlan {
  const max = brief.maxQuestions ?? 0;
  if (!canDesign(brief) || max === 0) {
    return { questions: [], cut: [], maxQuestions: max, summary: 'Nothing drafted yet.' };
  }

  const proposals = proposeQuestions({ brief: brief.base, library, signals: [] })
    // Market practice sometimes proposes price types; those belong to the
    // price schedule, not the questionnaire.
    .filter((p) => !['price_schedule', 'rate_table', 'quantity_break', 'currency_payment_terms'].includes(p.type));
  const company = proposals.map((p) => fromProposal(p, 20));
  const supplier = brief.askNewSuppliers ? supplierCandidates(reading) : [];
  const perItem = brief.perItem ? perItemCandidates(reading) : [];

  // Notes the buyer typed become questions of their own, high priority: they
  // asked for it by name.
  const noted: DesignQuestion[] = brief.base.notes.map((note, index) => ({
    code: `NOTE.${index + 1}`, title: note.trim().replace(/[.?]?$/, '?'),
    helpText: '', type: 'long_text', envelope: 'TECHNICAL', scoringMethod: 'MANUAL',
    weight: 15, isKnockout: false, allowAttachment: false, section: COMPANY, perLine: false,
    choices: '', settings: 'maxLength = 2000',
    rubric: 'Specific and evidenced = 10 · Generic = 4 · Absent = 0',
    reason: 'You asked for this by name.', priority: 100,
  }));

  const byPriority = (a: DesignQuestion, b: DesignQuestion) =>
    b.priority - a.priority || a.code.localeCompare(b.code);

  const lineCap = perItem.length === 0 ? 0 : Math.max(1, Math.min(perItem.length, Math.floor(max / 3)));
  const keptLine = [...perItem].sort(byPriority).slice(0, lineCap);
  const pool = [...noted, ...supplier, ...company].sort(byPriority);
  const room = Math.max(0, max - keptLine.length);
  const keptCompany = pool.slice(0, room);
  const cut = [...pool.slice(room), ...[...perItem].sort(byPriority).slice(lineCap)];

  const kept = [...keptCompany, ...keptLine];
  const questions = weigh(order(kept));
  const knockouts = questions.filter((q) => q.isKnockout).length;
  const summary = `${questions.length} question${questions.length === 1 ? '' : 's'} `
    + `(${questions.filter((q) => !q.perLine).length} about the company, ${questions.filter((q) => q.perLine).length} per item)`
    + `${knockouts > 0 ? `, ${knockouts} knockout${knockouts === 1 ? '' : 's'}` : ''}`
    + `${cut.length > 0 ? `. ${cut.length} more fit your priorities but not your ceiling of ${max}.` : '.'}`;
  return { questions, cut, maxQuestions: max, summary };
}

/** Company sections first, in the order a supplier meets them; per-item last. */
function order(questions: DesignQuestion[]): DesignQuestion[] {
  const sections: string[] = [];
  for (const q of [...questions].sort((a, b) => Number(a.perLine) - Number(b.perLine))) {
    if (!sections.includes(q.section)) sections.push(q.section);
  }
  return sections.flatMap((section) =>
    questions.filter((q) => q.section === section).sort((a, b) => b.priority - a.priority));
}

/**
 * Give the sections weights that add to exactly 100 and the questions weights
 * that add to exactly their section's. The importer refuses anything else, and
 * the largest-remainder rounding avoids the "99" nobody can find.
 */
function weigh(questions: DesignQuestion[]): DesignQuestion[] {
  const split = (values: number[], total: number): number[] => {
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0) return values.map(() => 0);
    const raw = values.map((v) => (v / sum) * total);
    const floor = raw.map(Math.floor);
    let left = total - floor.reduce((a, b) => a + b, 0);
    raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f)
      .forEach(({ i }) => { if (left > 0) { floor[i] += 1; left -= 1; } });
    return floor;
  };

  const scored = (q: DesignQuestion) => q.scoringMethod !== 'NONE';
  const names = Array.from(new Set(questions.map((q) => q.section)));
  const sectionTotals = names.map((name) =>
    questions.filter((q) => q.section === name && scored(q)).reduce((s, q) => s + q.weight, 0));
  const sectionWeights = split(sectionTotals, 100);

  const weights = new Map<DesignQuestion, number>();
  names.forEach((name, i) => {
    const inSection = questions.filter((q) => q.section === name && scored(q));
    split(inSection.map((q) => q.weight), sectionWeights[i]).forEach((w, j) =>
      weights.set(inSection[j], w));
  });
  return questions.map((q) => ({ ...q, weight: weights.get(q) ?? 0 }));
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

const yn = (value: boolean) => (value ? 'Yes' : 'No');

/** The plan as rows of the Questions sheet — the exact columns Upload reads. */
export function planRows(plan: DesignPlan): string[][] {
  const sectionOf = new Map<string, number>();
  for (const q of plan.questions) {
    sectionOf.set(q.section, (sectionOf.get(q.section) ?? 0) + q.weight);
  }
  const rows = plan.questions.map((q) => {
    const values: Partial<Record<ImportField, string>> = {
      section: q.section,
      sectionWeight: String(sectionOf.get(q.section) ?? 0),
      askedPer: q.perLine ? QUESTION_SCOPE_LABEL.LINE : QUESTION_SCOPE_LABEL.VENDOR,
      code: q.code, title: q.title, type: QUESTION_TYPE_SPEC[q.type].label,
      weight: String(q.weight), scoring: SCORING_IMPORT_LABEL[q.scoringMethod],
      envelope: ENVELOPE_IMPORT_LABEL[q.envelope], required: 'Yes',
      knockout: yn(q.isKnockout && !q.perLine), attachment: yn(q.allowAttachment),
      helpText: q.helpText, rubric: q.rubric, choices: q.choices, settings: q.settings,
    };
    return IMPORT_COLUMNS.map((c) => values[c.field] ?? '');
  });
  return [IMPORT_COLUMNS.map((c) => c.header), ...rows];
}

export const planFileName = (sight: EventSight, ext: 'xlsx' | 'csv'): string =>
  `questionnaire-${sight.point.toLowerCase()}${sight.category ? `-${sight.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.${ext}`;
