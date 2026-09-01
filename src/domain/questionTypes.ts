/**
 * What each question type actually asks for.
 *
 * A question type is not a display preference — it decides what the supplier is
 * asked to produce, and therefore what the buyer has to configure. A multiple
 * choice is meaningless without the choices; a number is ambiguous without a
 * unit; a knockout has no trigger unless some answer is marked as failing.
 *
 * Twenty-six types would be twenty-six config shapes, so instead each type
 * declares the **facets** it uses. The editor renders the facets, validation
 * checks the facets, and changing a type carries over what the two types have
 * in common and drops the rest — a `formula` left behind on a question that is
 * no longer calculated is exactly the kind of stale data that later gets read.
 *
 * The presets exist because the same lists are authored over and over. A buyer
 * asking for organisation type or incoterms should not retype eight options and
 * invent their own scores; they should start from the standard set and edit it.
 * Presets carry scores and disqualifying flags, because those are the parts
 * people get wrong.
 */
import type {
  Id, QuestionEnvelope, QuestionOption, QuestionConfig, QuestionType, TemplateQuestion,
} from './types';

/** The configurable aspects of an answer. A type uses some; most use one or two. */
export type QuestionFacet =
  | 'options'
  | 'selection_limits'
  | 'numeric_range'
  | 'text_limits'
  | 'file_rules'
  | 'date_window'
  | 'grid'
  | 'body_text'
  | 'formula';

export interface QuestionTypeSpec {
  label: string;
  group: 'Basic' | 'Sourcing' | 'Structural' | 'Advanced';
  /** What this type asks the supplier for, in one line. */
  asks: string;
  facets: QuestionFacet[];
  /** The answer is picked from a list the buyer authors. */
  choice: boolean;
  defaultEnvelope: QuestionEnvelope;
}

export const QUESTION_TYPE_SPEC: Record<QuestionType, QuestionTypeSpec> = {
  // -- Basic ----------------------------------------------------------------
  short_text: {
    label: 'Short text', group: 'Basic', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A single line of free text.', facets: ['text_limits'],
  },
  long_text: {
    label: 'Long text', group: 'Basic', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A paragraph — method statements, explanations, anything read rather than compared.',
    facets: ['text_limits'],
  },
  number: {
    label: 'Number', group: 'Basic', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A single figure, inside bounds and against a unit.', facets: ['numeric_range'],
  },
  yes_no: {
    label: 'Yes / No', group: 'Basic', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'A binary answer. Both choices are editable so each can carry a score.',
    facets: ['options'],
  },
  single_choice: {
    label: 'Single choice', group: 'Basic', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'One answer from a list you define.', facets: ['options'],
  },
  multiple_choice: {
    label: 'Multiple choice', group: 'Basic', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'Any number of answers from a list, within limits you set.',
    facets: ['options', 'selection_limits'],
  },
  file_upload: {
    label: 'File upload', group: 'Basic', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A document. Formats and size are constrained here, not in the help text.',
    facets: ['file_rules'],
  },
  date: {
    label: 'Date', group: 'Basic', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A single date, optionally inside a window.', facets: ['date_window'],
  },

  // -- Sourcing -------------------------------------------------------------
  price_schedule: {
    label: 'Price schedule', group: 'Sourcing', choice: false, defaultEnvelope: 'COMMERCIAL',
    asks: 'Unit prices against every line in the event. Rows come from the lots; you define the columns.',
    facets: ['grid'],
  },
  rate_table: {
    label: 'Rate table', group: 'Sourcing', choice: false, defaultEnvelope: 'COMMERCIAL',
    asks: 'Rates against a fixed set of columns — day rates, tariffs, call-off prices.',
    facets: ['grid'],
  },
  quantity_break: {
    label: 'Quantity break', group: 'Sourcing', choice: false, defaultEnvelope: 'COMMERCIAL',
    asks: 'Price by volume band. Each band is a row the supplier fills in.', facets: ['grid'],
  },
  compliance_statement: {
    label: 'Compliance statement', group: 'Sourcing', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'A clause the supplier responds to on a fixed scale.', facets: ['body_text', 'options'],
  },
  certificate: {
    label: 'Certificate', group: 'Sourcing', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A credential with an issuing body and an expiry date.',
    facets: ['file_rules', 'date_window'],
  },
  matrix_rating: {
    label: 'Matrix rating', group: 'Sourcing', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'A grid: one row per item, answered on a scale you define once.',
    facets: ['grid', 'options'],
  },
  capacity_declaration: {
    label: 'Capacity declaration', group: 'Sourcing', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A quantity per period the supplier commits to.', facets: ['numeric_range'],
  },
  reference_submission: {
    label: 'References', group: 'Sourcing', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'Contactable references, each answering the same fields.',
    facets: ['selection_limits', 'grid'],
  },
  lead_time: {
    label: 'Lead time', group: 'Sourcing', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'Time from order to delivery, in a unit you fix so answers compare.',
    facets: ['numeric_range'],
  },
  currency_payment_terms: {
    label: 'Payment terms', group: 'Sourcing', choice: true, defaultEnvelope: 'COMMERCIAL',
    asks: 'The terms the supplier will trade on, picked from the ones you accept.',
    facets: ['options'],
  },

  // -- Structural -----------------------------------------------------------
  section: {
    label: 'Section break', group: 'Structural', choice: false, defaultEnvelope: 'GENERAL',
    asks: 'A heading. Asks the supplier for nothing.', facets: [],
  },
  page_break: {
    label: 'Page break', group: 'Structural', choice: false, defaultEnvelope: 'GENERAL',
    asks: 'Splits the form. Asks the supplier for nothing.', facets: [],
  },
  instruction_block: {
    label: 'Instructions', group: 'Structural', choice: false, defaultEnvelope: 'GENERAL',
    asks: 'Text shown to the supplier. Asks for nothing in return.', facets: ['body_text'],
  },
  repeating_group: {
    label: 'Repeating group', group: 'Structural', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A block the supplier can add more of — sites, products, people.',
    facets: ['selection_limits', 'grid'],
  },
  conditional_group: {
    label: 'Conditional group', group: 'Structural', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A block shown only when an earlier answer matches.', facets: [],
  },

  // -- Advanced -------------------------------------------------------------
  calculated_field: {
    label: 'Calculated field', group: 'Advanced', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'Nothing. Derived from other answers and read-only to the supplier.',
    facets: ['formula'],
  },
  lookup: {
    label: 'Lookup', group: 'Advanced', choice: true, defaultEnvelope: 'TECHNICAL',
    asks: 'A choice from a list the platform holds — plants, incoterms, currencies.',
    facets: ['options'],
  },
  signature: {
    label: 'Signature', group: 'Advanced', choice: false, defaultEnvelope: 'GENERAL',
    asks: 'A named acceptance of the declaration below it.', facets: ['body_text'],
  },
  table: {
    label: 'Table', group: 'Advanced', choice: false, defaultEnvelope: 'TECHNICAL',
    asks: 'A free grid the supplier fills in, one row at a time.', facets: ['grid'],
  },
  hidden_metadata: {
    label: 'Hidden metadata', group: 'Advanced', choice: false, defaultEnvelope: 'GENERAL',
    asks: 'Nothing. Carried on the response and never shown to the supplier.',
    facets: ['body_text'],
  },
};

export const QUESTION_TYPES_BY_GROUP: { group: string; types: QuestionType[] }[] = (
  ['Basic', 'Sourcing', 'Advanced'] as const
).map((group) => ({
  group,
  types: (Object.keys(QUESTION_TYPE_SPEC) as QuestionType[])
    .filter((t) => QUESTION_TYPE_SPEC[t].group === group),
}));

export function typeLabel(type: QuestionType): string {
  return QUESTION_TYPE_SPEC[type].label;
}

export function facetsFor(type: QuestionType): QuestionFacet[] {
  return QUESTION_TYPE_SPEC[type].facets;
}

export function usesFacet(type: QuestionType, facet: QuestionFacet): boolean {
  return QUESTION_TYPE_SPEC[type].facets.includes(facet);
}

/** Types whose answer is picked from a list the buyer authors. */
export function isChoiceType(type: QuestionType): boolean {
  return QUESTION_TYPE_SPEC[type].choice;
}

// ---------------------------------------------------------------------------
// Facets and the keys they own
// ---------------------------------------------------------------------------

const FACET_KEYS: Record<QuestionFacet, (keyof QuestionConfig)[]> = {
  options: ['options'],
  selection_limits: ['minSelections', 'maxSelections'],
  numeric_range: ['min', 'max', 'unit', 'decimals'],
  text_limits: ['maxLength'],
  file_rules: ['acceptedFormats', 'maxFileSizeMb'],
  date_window: ['earliest', 'latest'],
  grid: ['rows', 'columns'],
  body_text: ['body'],
  formula: ['formula'],
};

export const FACET_LABELS: Record<QuestionFacet, string> = {
  options: 'Choices',
  selection_limits: 'How many may be given',
  numeric_range: 'Bounds and unit',
  text_limits: 'Length',
  file_rules: 'Accepted files',
  date_window: 'Allowed dates',
  grid: 'Rows and columns',
  body_text: 'Text shown to the supplier',
  formula: 'Formula',
};

/** Keys a type actually reads. Everything else on the config is ignored. */
export function keysFor(type: QuestionType): (keyof QuestionConfig)[] {
  return facetsFor(type).flatMap((facet) => FACET_KEYS[facet]);
}

// ---------------------------------------------------------------------------
// Defaults and type switching
// ---------------------------------------------------------------------------

export function newOption(
  prefix: string, index: number, label = '', score: number | null = null,
): QuestionOption {
  return {
    id: `${prefix}-opt-${index}`,
    label,
    score,
    isDisqualifying: false,
    requiresDetail: false,
  };
}

/**
 * The config a question of this type starts with.
 *
 * Choice types deliberately start with **no** choices rather than two blank
 * rows: an empty list reads as unfinished and the validator says so, whereas
 * two rows labelled "Option 1" and "Option 2" look finished and ship.
 */
export function defaultConfigFor(type: QuestionType, idPrefix = 'q'): QuestionConfig {
  switch (type) {
    case 'yes_no':
      return {
        options: [
          { ...newOption(idPrefix, 1, 'Yes', 10) },
          { ...newOption(idPrefix, 2, 'No', 0) },
        ],
      };
    case 'compliance_statement':
      return {
        body: '',
        options: optionsFromPreset(presetById('compliance'), idPrefix),
      };
    case 'matrix_rating':
      return { rows: [], options: optionsFromPreset(presetById('rating-5'), idPrefix) };
    case 'single_choice':
    case 'multiple_choice':
    case 'lookup':
    case 'currency_payment_terms':
      return { options: [] };
    case 'number':
      return { min: null, max: null, unit: '', decimals: 0 };
    case 'capacity_declaration':
      return { min: 0, max: null, unit: 'units / month', decimals: 0 };
    case 'lead_time':
      return { min: 0, max: null, unit: 'days', decimals: 0 };
    case 'short_text':
      return { maxLength: 250 };
    case 'long_text':
      return { maxLength: 4000 };
    case 'file_upload':
      return { acceptedFormats: ['pdf'], maxFileSizeMb: 10 };
    case 'certificate':
      return { acceptedFormats: ['pdf', 'jpg', 'png'], maxFileSizeMb: 10, earliest: null, latest: null };
    case 'date':
      return { earliest: null, latest: null };
    case 'price_schedule':
      return { columns: ['Unit price'], rows: [] };
    case 'rate_table':
      return { columns: ['Role or item', 'Unit', 'Rate'], rows: [] };
    case 'quantity_break':
      return { columns: ['From qty', 'To qty', 'Unit price'], rows: [] };
    case 'reference_submission':
      return {
        minSelections: 3, maxSelections: null,
        columns: ['Client', 'Contact', 'Scope', 'Value', 'Year'], rows: [],
      };
    case 'repeating_group':
      return { minSelections: 1, maxSelections: null, columns: ['Column 1'], rows: [] };
    case 'table':
      return { columns: ['Column 1', 'Column 2'], rows: [] };
    case 'instruction_block':
    case 'signature':
    case 'hidden_metadata':
      return { body: '' };
    case 'calculated_field':
      return { formula: '' };
    default:
      return {};
  }
}

/**
 * Config for a question after a type change: keep what both types understand,
 * fill the rest from the new type's defaults, drop everything else.
 *
 * The shared part is what makes the editor usable — switching single choice to
 * multiple choice must not throw away eight options the buyer just typed.
 */
export function carryConfig(
  from: QuestionType, to: QuestionType, config: QuestionConfig, idPrefix = 'q',
): QuestionConfig {
  const shared = new Set(keysFor(from).filter((key) => keysFor(to).includes(key)));
  const next: QuestionConfig = { ...defaultConfigFor(to, idPrefix) };
  for (const key of shared) {
    if (config[key] !== undefined) {
      (next as Record<string, unknown>)[key] = config[key];
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Suggested option sets
// ---------------------------------------------------------------------------

export interface OptionPreset {
  id: string;
  name: string;
  /** Why this set, and what the scores assume. */
  hint: string;
  types: QuestionType[];
  options: {
    label: string;
    score?: number | null;
    isDisqualifying?: boolean;
    requiresDetail?: boolean;
  }[];
}

export const OPTION_PRESETS: OptionPreset[] = [
  {
    id: 'yes-no',
    name: 'Yes / No',
    hint: 'Scored 10 and 0. Make No disqualifying if the question is a knockout.',
    types: ['yes_no', 'single_choice'],
    options: [{ label: 'Yes', score: 10 }, { label: 'No', score: 0 }],
  },
  {
    id: 'yes-no-na',
    name: 'Yes / No / Not applicable',
    hint: 'Use where "not applicable" is a legitimate answer rather than a dodge.',
    types: ['yes_no', 'single_choice'],
    options: [
      { label: 'Yes', score: 10 },
      { label: 'No', score: 0 },
      { label: 'Not applicable', score: null, requiresDetail: true },
    ],
  },
  {
    id: 'compliance',
    name: 'Comply / Partially comply / Not comply',
    hint: 'The standard compliance scale. Partial answers must explain themselves.',
    types: ['single_choice', 'compliance_statement'],
    options: [
      { label: 'Comply', score: 10 },
      { label: 'Partially comply', score: 5, requiresDetail: true },
      { label: 'Not comply', score: 0, isDisqualifying: true, requiresDetail: true },
    ],
  },
  {
    id: 'org-type',
    name: 'Type of organisation',
    hint: 'Unscored — a legal form is a fact about the supplier, not a merit.',
    types: ['single_choice', 'lookup'],
    options: [
      { label: 'Proprietorship' },
      { label: 'Partnership' },
      { label: 'Limited liability partnership' },
      { label: 'Private limited company' },
      { label: 'Public limited company' },
      { label: 'Government or public sector undertaking' },
      { label: 'Trust or society' },
      { label: 'Other', requiresDetail: true },
    ],
  },
  {
    id: 'enterprise-size',
    name: 'Enterprise size / MSME status',
    hint: 'Unscored. Drives set-asides and payment-term policy, not the ranking.',
    types: ['single_choice', 'lookup'],
    options: [
      { label: 'Micro' }, { label: 'Small' }, { label: 'Medium' },
      { label: 'Large' }, { label: 'Not registered' },
    ],
  },
  {
    id: 'certifications',
    name: 'Certifications held',
    hint: 'Two points each. Cap the total with a max-selections limit if you need one.',
    types: ['multiple_choice'],
    options: [
      { label: 'ISO 9001 — quality', score: 2 },
      { label: 'ISO 14001 — environmental', score: 2 },
      { label: 'ISO 45001 — health and safety', score: 2 },
      { label: 'ISO 27001 — information security', score: 2 },
      { label: 'IATF 16949 — automotive', score: 2 },
      { label: 'None held', score: 0 },
    ],
  },
  {
    id: 'regions',
    name: 'Regions served',
    hint: 'Two points per region, so a national supplier scores above a local one.',
    types: ['multiple_choice'],
    options: [
      { label: 'North', score: 2 }, { label: 'South', score: 2 },
      { label: 'East', score: 2 }, { label: 'West', score: 2 },
      { label: 'Pan-India', score: 2 }, { label: 'Export', score: 2 },
    ],
  },
  {
    id: 'payment-terms',
    name: 'Payment terms',
    hint: 'Scored on credit to the buyer — longer terms score higher, advance scores nothing.',
    types: ['currency_payment_terms', 'single_choice', 'multiple_choice'],
    options: [
      { label: 'Advance payment', score: 0 },
      { label: 'Against delivery', score: 2 },
      { label: 'Net 15 days', score: 3 },
      { label: 'Net 30 days', score: 6 },
      { label: 'Net 45 days', score: 8 },
      { label: 'Net 60 days', score: 10 },
      { label: 'Net 90 days', score: 10 },
      { label: 'Letter of credit at sight', score: 4 },
    ],
  },
  {
    id: 'incoterms',
    name: 'Incoterms',
    hint: 'Scored on how much of the landed cost and risk the supplier carries.',
    types: ['single_choice', 'lookup', 'multiple_choice'],
    options: [
      { label: 'EXW — ex works', score: 1 },
      { label: 'FCA — free carrier', score: 4 },
      { label: 'FOB — free on board', score: 5 },
      { label: 'CIF — cost, insurance and freight', score: 6 },
      { label: 'DAP — delivered at place', score: 7 },
      { label: 'DDP — delivered duty paid', score: 10 },
    ],
  },
  {
    id: 'rating-5',
    name: 'Five-point rating',
    hint: 'An even spread from 2 to 10, so the middle of the scale is worth half.',
    types: ['matrix_rating', 'single_choice'],
    options: [
      { label: 'Poor', score: 2 }, { label: 'Fair', score: 4 },
      { label: 'Good', score: 6 }, { label: 'Very good', score: 8 },
      { label: 'Excellent', score: 10 },
    ],
  },
  {
    id: 'maturity',
    name: 'Capability maturity',
    hint: 'For process questions where "do you have one" is too blunt.',
    types: ['matrix_rating', 'single_choice'],
    options: [
      { label: 'Ad hoc', score: 2 }, { label: 'Repeatable', score: 4 },
      { label: 'Defined', score: 6 }, { label: 'Measured', score: 8 },
      { label: 'Optimising', score: 10 },
    ],
  },
];

export function presetsFor(type: QuestionType): OptionPreset[] {
  return OPTION_PRESETS.filter((preset) => preset.types.includes(type));
}

export function presetById(id: string): OptionPreset {
  const found = OPTION_PRESETS.find((preset) => preset.id === id);
  if (!found) throw new Error(`Unknown option preset: ${id}`);
  return found;
}

export function optionsFromPreset(preset: OptionPreset, idPrefix: string): QuestionOption[] {
  return preset.options.map((option, i) => ({
    id: `${idPrefix}-opt-${i + 1}`,
    label: option.label,
    score: option.score ?? null,
    isDisqualifying: option.isDisqualifying ?? false,
    requiresDetail: option.requiresDetail ?? false,
  }));
}

// ---------------------------------------------------------------------------
// Reading a config
// ---------------------------------------------------------------------------

export function optionsOf(question: { type: QuestionType; config: QuestionConfig }): QuestionOption[] {
  return usesFacet(question.type, 'options') ? question.config.options ?? [] : [];
}

/** The highest score any single choice can earn. Zero when nothing is scored. */
export function bestOptionScore(options: QuestionOption[]): number {
  const scores = options.map((o) => o.score).filter((s): s is number => s !== null);
  return scores.length === 0 ? 0 : Math.max(...scores);
}

/**
 * A one-line summary of the answer format, for the collapsed question row.
 * Says the thing a buyer scanning a template wants to check without opening it.
 */
export function formatSummary(question: { type: QuestionType; config: QuestionConfig }): string | null {
  const { type, config } = question;
  if (isChoiceType(type)) {
    const count = (config.options ?? []).length;
    if (count === 0) return 'no choices defined';
    const limits = usesFacet(type, 'selection_limits')
      ? selectionLimitLabel(config)
      : null;
    return `${count} choice${count === 1 ? '' : 's'}${limits ? ` · ${limits}` : ''}`;
  }
  if (usesFacet(type, 'numeric_range')) {
    const bounds = boundsLabel(config);
    return [bounds, config.unit].filter(Boolean).join(' ') || null;
  }
  if (usesFacet(type, 'grid')) {
    const columns = (config.columns ?? []).length;
    return columns === 0 ? 'no columns defined' : `${columns} column${columns === 1 ? '' : 's'}`;
  }
  if (usesFacet(type, 'file_rules')) {
    const formats = config.acceptedFormats ?? [];
    return formats.length === 0 ? 'any file type' : formats.join(', ');
  }
  if (usesFacet(type, 'text_limits') && config.maxLength) {
    return `up to ${config.maxLength.toLocaleString()} characters`;
  }
  return null;
}

function boundsLabel(config: QuestionConfig): string {
  const { min, max } = config;
  if (min !== null && min !== undefined && max !== null && max !== undefined) return `${min}–${max}`;
  if (min !== null && min !== undefined) return `min ${min}`;
  if (max !== null && max !== undefined) return `max ${max}`;
  return '';
}

function selectionLimitLabel(config: QuestionConfig): string | null {
  const { minSelections: min, maxSelections: max } = config;
  if (min && max) return min === max ? `exactly ${min}` : `${min}–${max} selectable`;
  if (min) return `at least ${min}`;
  if (max) return `at most ${max}`;
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Grids whose columns are not authored on the question. A price schedule takes
 * its rows from the event's lines and prices them; a matrix's columns are the
 * rating scale, which is authored as options rather than as column headers.
 */
const GRID_COLUMNS_DERIVED: QuestionType[] = ['price_schedule', 'matrix_rating'];

export interface ConfigIssue {
  code: string;
  message: string;
}

export interface ConfigValidation {
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

/**
 * Whether a question's answer format is actually askable.
 *
 * The two that matter most are the ones the type system cannot see: a rule-
 * scored choice question where no choice carries a score computes nothing, and
 * a knockout choice question where no choice is disqualifying can never fail
 * anyone — a safety net with no hole in it, which is worse than none because it
 * reads as protection.
 */
export function validateQuestionConfig(question: TemplateQuestion): ConfigValidation {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const { type, config } = question;
  const title = question.title || question.code;

  if (isChoiceType(type)) {
    const options = config.options ?? [];

    if (options.length < 2) {
      errors.push({
        code: 'NO_OPTIONS',
        message: `"${title}" asks the supplier to choose, but the list holds ${options.length} choice${options.length === 1 ? '' : 's'}. Define at least two, or pick a suggested set.`,
      });
    }

    if (options.some((option) => option.label.trim() === '')) {
      errors.push({
        code: 'BLANK_OPTION',
        message: `"${title}" has a choice with no label. A supplier cannot pick an answer that is not written down.`,
      });
    }

    const labels = options.map((o) => o.label.trim().toLowerCase()).filter(Boolean);
    const duplicate = labels.find((label, i) => labels.indexOf(label) !== i);
    if (duplicate) {
      errors.push({
        code: 'DUPLICATE_OPTION',
        message: `"${title}" lists "${duplicate}" twice. Two identical choices split the same answer into two, and the score depends on which one the supplier happens to click.`,
      });
    }

    const scored = options.filter((option) => option.score !== null);
    if (question.scoringMethod === 'RULE' && options.length > 0 && scored.length === 0) {
      errors.push({
        code: 'RULE_WITHOUT_SCORES',
        message: `"${title}" is scored by rule, but no choice carries a score, so there is nothing for the rule to compute. Score the choices or score it manually.`,
      });
    }

    if (scored.length > 0 && (question.scoringMethod === 'MANUAL' || question.scoringMethod === 'NONE')) {
      warnings.push({
        code: 'OPTION_SCORES_IGNORED',
        message: `"${title}" carries scores on its choices but is ${question.scoringMethod === 'NONE' ? 'not scored' : 'scored manually'}, so those numbers never reach the evaluation. Switch it to rule scoring to use them.`,
      });
    }

    if (question.isKnockout && options.length > 0
        && !options.some((option) => option.isDisqualifying)) {
      errors.push({
        code: 'KNOCKOUT_WITHOUT_TRIGGER',
        message: `"${title}" disqualifies on failure, but no choice is marked as failing — so nothing can ever fail it. Mark the answers that should knock a supplier out.`,
      });
    }
  }

  if (usesFacet(type, 'selection_limits')) {
    const { minSelections: min, maxSelections: max } = config;
    const count = (config.options ?? []).length;
    if (min && max && min > max) {
      errors.push({
        code: 'SELECTION_RANGE',
        message: `"${title}" asks for at least ${min} answers but allows at most ${max}.`,
      });
    }
    if (isChoiceType(type) && min && count > 0 && min > count) {
      errors.push({
        code: 'SELECTION_RANGE',
        message: `"${title}" requires ${min} answers from a list of ${count}, so no supplier can satisfy it.`,
      });
    }
  }

  if (usesFacet(type, 'numeric_range')) {
    const { min, max } = config;
    if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
      errors.push({
        code: 'NUMERIC_RANGE',
        message: `"${title}" has a minimum of ${min} above its maximum of ${max}, so no answer is valid.`,
      });
    }
    if (!config.unit || config.unit.trim() === '') {
      warnings.push({
        code: 'NO_UNIT',
        message: `"${title}" asks for a figure with no unit. Two suppliers answering in different units produce numbers that look comparable and are not.`,
      });
    }
  }

  if (usesFacet(type, 'date_window')) {
    const { earliest, latest } = config;
    if (earliest && latest && earliest > latest) {
      errors.push({
        code: 'DATE_WINDOW',
        message: `"${title}" opens its date window on ${earliest} and closes it on ${latest}.`,
      });
    }
  }

  if (usesFacet(type, 'grid') && !GRID_COLUMNS_DERIVED.includes(type)) {
    if ((config.columns ?? []).length === 0) {
      errors.push({
        code: 'GRID_EMPTY',
        message: `"${title}" is a grid with no columns, so there is nothing for the supplier to fill in.`,
      });
    }
  }

  if (type === 'matrix_rating' && (config.rows ?? []).length === 0) {
    errors.push({
      code: 'GRID_EMPTY',
      message: `"${title}" is a matrix with no rows. Add the items to be rated, or ask it as a single choice instead.`,
    });
  }

  if (usesFacet(type, 'formula') && (config.formula ?? '').trim() === '') {
    errors.push({
      code: 'FORMULA_REQUIRED',
      message: `"${title}" is calculated but carries no formula, so it will always be empty.`,
    });
  }

  if (type === 'compliance_statement' && (config.body ?? '').trim() === '') {
    errors.push({
      code: 'CLAUSE_REQUIRED',
      message: `"${title}" asks the supplier to confirm compliance without stating what with.`,
    });
  }

  return { errors, warnings };
}

/** Ids are stable within a question, so a fresh option never collides. */
export function appendOption(question: TemplateQuestion): QuestionOption[] {
  const options = question.config.options ?? [];
  const used = new Set(options.map((o) => o.id));
  let index = options.length + 1;
  let id: Id = `${question.id}-opt-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${question.id}-opt-${index}`;
  }
  return [...options, { id, label: '', score: null, isDisqualifying: false, requiresDetail: false }];
}
