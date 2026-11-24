/**
 * Bringing a questionnaire in from a spreadsheet.
 *
 * Buyers do not author questionnaires in a product. They author them in Excel,
 * circulate them for comment, and only then look for somewhere to put them —
 * by which point the sheet has thirty rows, a section structure and a column
 * of weights someone in finance argued about. Retyping that into a form is
 * where it stops being worth doing, and the usual outcome is the sheet gets
 * attached to the RFI as a document: the same questions, none of the
 * structure, nothing comparable across suppliers and nothing scoreable.
 *
 * So this module reads the sheet. Three decisions shape it:
 *
 * 1. **The grid is flat and the section repeats.** One row per question, with
 *    the section name and its weight on every row of that section. It is how
 *    people already keep these — a nested format would be tidier and would
 *    have to be taught.
 * 2. **Nothing is silently discarded.** Every row that is refused says which
 *    row and why, and every value that is adjusted — a weight dropped from a
 *    priced question, a code made unique — is reported. An import that quietly
 *    drops four of thirty questions is worse than one that fails.
 * 3. **The file we hand out is the file we read.** `importWorkbook()` writes
 *    the same column set this module parses, with the response types as a real
 *    Excel dropdown, so the common case is a round trip rather than a guess at
 *    what we accept.
 */
import {
  QUESTION_TYPES_BY_GROUP, QUESTION_TYPE_SPEC, defaultConfigFor, keysFor, newOption,
} from './questionTypes';
import {
  PRICED_QUESTION_TYPES, QUESTION_SCOPE_LABEL, TEMPLATE_STATUS_LABELS, canAskPerLine, suggestCode,
} from './questionnaireTemplates';
import { buildXlsx, toCsv, type Sheet, type SheetSpec } from './spreadsheet';
import type {
  Id, QuestionConfig, QuestionEnvelope, QuestionScope, QuestionType, QuestionnaireTemplate,
  ScoringMethod, TemplateQuestion, TemplateSection,
} from './types';

// ---------------------------------------------------------------------------
// The columns
// ---------------------------------------------------------------------------

export type ImportField =
  | 'section' | 'sectionWeight' | 'askedPer'
  | 'code' | 'title' | 'type' | 'weight'
  | 'scoring' | 'envelope' | 'required' | 'knockout' | 'attachment'
  | 'helpText' | 'rubric' | 'choices' | 'settings';

export interface ImportColumn {
  field: ImportField;
  /** The heading written into the template, and the one matched on first. */
  header: string;
  /** Other headings accepted, because the file comes back renamed. */
  aliases: string[];
  width: number;
  /** What a buyer filling the sheet needs to know, shown on the guide sheet. */
  guidance: string;
  example: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  {
    field: 'section', header: 'Section', width: 26,
    aliases: ['section name', 'group', 'category'],
    guidance: 'The block this question belongs to. Repeat it on every row of the section — the rows are read in order, so a blank one continues the section above it.',
    example: 'Company & compliance',
  },
  {
    field: 'sectionWeight', header: 'Section Weight %', width: 15,
    aliases: ['section weight', 'section %', 'sectionweight'],
    guidance: 'The share of the technical score this section carries. The sections must add up to 100. Leave the column empty and each section is given the total of the question weights inside it.',
    example: '40',
  },
  {
    field: 'askedPer', header: 'Asked Per', width: 14,
    aliases: ['asked', 'scope', 'level', 'asked at'],
    guidance: 'Per vendor — asked once, the answer is about the company. Per line item — asked again for every line in the basket. Set on the section, so every row of a section says the same thing.',
    example: 'Per vendor',
  },
  {
    field: 'code', header: 'ID', width: 12,
    aliases: ['question code', 'code', 'question id', 'q id', 'ref'],
    guidance: 'The question code. Two templates that ask the same thing share a code, which is what carries an answer given at RFI into RFP instead of asking twice. Must be unique inside one template.',
    example: 'Q.1',
  },
  {
    field: 'title', header: 'Question', width: 58,
    aliases: ['title', 'question text', 'text'],
    guidance: 'What the supplier is asked, in full. This is the only column that cannot be left blank.',
    example: 'Describe your quality management system and the standards it is certified to.',
  },
  {
    field: 'type', header: 'Response Type', width: 22,
    aliases: ['type', 'answer type', 'response', 'field type'],
    guidance: 'How the supplier answers. Pick from the dropdown — the full list is on the Lists sheet. Left blank, a question becomes short text.',
    example: 'Long text',
  },
  {
    field: 'weight', header: 'Weight', width: 10,
    aliases: ['question weight', 'points', 'marks'],
    guidance: 'What this question is worth, taken out of its section. The questions in a section cannot carry more between them than the section is worth. Price questions carry no weight, by rule.',
    example: '15',
  },
  {
    field: 'scoring', header: 'Scoring', width: 16,
    aliases: ['scoring method', 'scored by', 'how scored'],
    guidance: 'Not scored, Manual, Rule, AI assisted or AI auto. Left blank, anything with a weight is scored manually and anything without is not scored.',
    example: 'Manual',
  },
  {
    field: 'envelope', header: 'Envelope', width: 13,
    aliases: ['bid envelope', 'part'],
    guidance: 'Technical, Commercial or General. This is a permissions boundary — a commercial answer is sealed until the commercial envelope opens. Left blank, the response type decides.',
    example: 'Technical',
  },
  {
    field: 'required', header: 'Required', width: 11,
    aliases: ['mandatory', 'is required'],
    guidance: 'Yes or No. A supplier cannot submit while a required question is unanswered.',
    example: 'Yes',
  },
  {
    field: 'knockout', header: 'Knockout', width: 11,
    aliases: ['disqualifies', 'is knockout', 'gate'],
    guidance: 'Yes or No. A failed knockout removes the supplier from the event, so it cannot be used on a per-line question — one failing line is an award decision, not a gate on the whole bid.',
    example: 'No',
  },
  {
    field: 'attachment', header: 'Attachment', width: 12,
    aliases: ['allow attachment', 'file', 'supporting document'],
    guidance: 'Yes or No. Lets the supplier attach evidence alongside the answer.',
    example: 'Yes',
  },
  {
    field: 'helpText', header: 'Help Text', width: 40,
    aliases: ['help', 'guidance', 'instruction', 'note to supplier'],
    guidance: 'One line shown under the question to the supplier.',
    example: 'Name the certifying body and attach the current certificate.',
  },
  {
    field: 'rubric', header: 'Rubric', width: 34,
    aliases: ['scoring guide', 'score guide', 'criteria'],
    guidance: 'How an evaluator should score the answer. Shown to the evaluator, never to the supplier.',
    example: 'Certified = 10 · Documented = 5 · Neither = 0',
  },
  {
    field: 'choices', header: 'Choices', width: 40,
    aliases: ['options', 'answer options', 'values'],
    guidance: 'For the choice types. Separate with | , give a score with = , end with ! to make the choice disqualifying and ? to make it ask for detail.  Yes = 10 | No = 0 !',
    example: 'ISO 9001 = 10 | Equivalent = 6 | None = 0 !',
  },
  {
    field: 'settings', header: 'Answer Settings', width: 34,
    aliases: ['settings', 'format', 'answer format', 'config'],
    guidance: 'Everything else the response type needs, as key = value pairs separated by ;  —  unit, min, max, decimals, maxLength, formats, maxFileSizeMb, earliest, latest, minSelections, maxSelections, columns, rows, body, formula. Keys the type does not use are ignored and reported.',
    example: 'unit = days; min = 1; max = 90',
  },
];

/**
 * `tyres-rfp-questionnaire (2).xlsx` into `Tyres rfp questionnaire`.
 *
 * Deliberately plain. Title-casing every word would invent capitals the buyer
 * did not write, and the point is a recognisable placeholder, not a finished
 * name.
 */
export function nameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base === '' ? '' : base.charAt(0).toUpperCase() + base.slice(1);
}

/** A header cell matched loosely — case, spacing and punctuation are noise. */
function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Value vocabularies
// ---------------------------------------------------------------------------

export const SCORING_IMPORT_LABEL: Record<ScoringMethod, string> = {
  NONE: 'Not scored',
  MANUAL: 'Manual',
  RULE: 'Rule',
  AI_ASSISTED: 'AI assisted',
  AI_AUTO: 'AI auto',
};

export const ENVELOPE_IMPORT_LABEL: Record<QuestionEnvelope, string> = {
  TECHNICAL: 'Technical',
  COMMERCIAL: 'Commercial',
  GENERAL: 'General',
};

/**
 * The response types the sheet offers, in the order the question editor
 * offers them.
 *
 * Exactly the editor's list, not every type the data model has. The structural
 * types — page breaks, conditional groups — are layout rather than questions
 * and the editor does not offer them, so a sheet that could set one would
 * import a row nobody can then open and change.
 */
export const RESPONSE_TYPES: QuestionType[] = QUESTION_TYPES_BY_GROUP.flatMap((g) => g.types);

export const RESPONSE_TYPE_LABELS: string[] = RESPONSE_TYPES
  .map((type) => QUESTION_TYPE_SPEC[type].label);

function lookupType(value: string): QuestionType | null {
  const wanted = normaliseHeader(value);
  if (wanted === '') return null;
  for (const type of RESPONSE_TYPES) {
    if (normaliseHeader(QUESTION_TYPE_SPEC[type].label) === wanted) return type;
    // The raw key is accepted too: a sheet produced from an export, or by
    // someone reading the API, says `short_text` rather than `Short text`.
    if (normaliseHeader(type) === wanted) return type;
  }
  return null;
}

function lookupScoring(value: string): ScoringMethod | null {
  const wanted = normaliseHeader(value);
  if (wanted === '') return null;
  for (const method of Object.keys(SCORING_IMPORT_LABEL) as ScoringMethod[]) {
    if (normaliseHeader(SCORING_IMPORT_LABEL[method]) === wanted) return method;
    if (normaliseHeader(method) === wanted) return method;
  }
  if (wanted === 'none' || wanted === 'no' || wanted === 'not scored') return 'NONE';
  if (wanted === 'human' || wanted === 'evaluator') return 'MANUAL';
  if (wanted === 'auto' || wanted === 'automatic') return 'RULE';
  return null;
}

function lookupEnvelope(value: string): QuestionEnvelope | null {
  const wanted = normaliseHeader(value);
  if (wanted === '') return null;
  for (const envelope of Object.keys(ENVELOPE_IMPORT_LABEL) as QuestionEnvelope[]) {
    if (normaliseHeader(ENVELOPE_IMPORT_LABEL[envelope]) === wanted) return envelope;
  }
  if (wanted === 'tech') return 'TECHNICAL';
  if (wanted === 'price' || wanted === 'commercials') return 'COMMERCIAL';
  return null;
}

function lookupScope(value: string): QuestionScope | null {
  const wanted = normaliseHeader(value);
  if (wanted === '') return null;
  if (['per vendor', 'vendor', 'supplier', 'per supplier', 'company', 'once'].includes(wanted)) {
    return 'VENDOR';
  }
  if (['per line item', 'line', 'line item', 'per line', 'per item', 'item'].includes(wanted)) {
    return 'LINE';
  }
  return null;
}

/** `Yes`, `Y`, `TRUE`, `1`, `✓` — all of these turn up in real sheets. */
function lookupFlag(value: string): boolean | null {
  // Ticks are checked before normalising, which strips everything that is not
  // a letter or a digit — and a tick is neither.
  const raw = value.trim();
  if (raw === '✓' || raw === '✔' || raw === '✅') return true;
  if (raw === '✕' || raw === '✗' || raw === '—' || raw === '-') return false;

  const wanted = normaliseHeader(value);
  if (wanted === '') return null;
  if (['yes', 'y', 'true', '1', 'required', 'mandatory', 'x'].includes(wanted)) return true;
  if (['no', 'n', 'false', '0', 'optional'].includes(wanted)) return false;
  return null;
}

function lookupNumber(value: string): number | null {
  const cleaned = value.replace(/[%\s,]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Choices and answer settings
// ---------------------------------------------------------------------------

/**
 * `ISO 9001 = 10 | Equivalent = 6 | None = 0 !` into real options.
 *
 * The suffixes carry the two facts a plain list of labels cannot: which choice
 * fails the question, and which one has to be explained. Both are things
 * buyers write in brackets after the label today, where nothing reads them.
 */
export function parseChoices(value: string, idPrefix: string) {
  return value
    .split(/[|\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part, index) => {
      let text = part;
      let isDisqualifying = false;
      let requiresDetail = false;

      // Suffixes may be stacked and in either order: `None = 0 !?`
      for (;;) {
        const last = text.trim().slice(-1);
        if (last === '!') { isDisqualifying = true; text = text.trim().slice(0, -1); continue; }
        if (last === '?') { requiresDetail = true; text = text.trim().slice(0, -1); continue; }
        break;
      }

      const split = text.lastIndexOf('=');
      const label = (split >= 0 ? text.slice(0, split) : text).trim();
      const score = split >= 0 ? lookupNumber(text.slice(split + 1)) : null;

      return {
        ...newOption(idPrefix, index + 1, label, score),
        isDisqualifying,
        requiresDetail,
      };
    });
}

const SETTING_ALIASES: Record<string, keyof QuestionConfig> = {
  'unit': 'unit',
  'min': 'min',
  'minimum': 'min',
  'max': 'max',
  'maximum': 'max',
  'decimals': 'decimals',
  'maxlength': 'maxLength',
  'max length': 'maxLength',
  'length': 'maxLength',
  'formats': 'acceptedFormats',
  'accepted formats': 'acceptedFormats',
  'file types': 'acceptedFormats',
  'maxfilesizemb': 'maxFileSizeMb',
  'max file size mb': 'maxFileSizeMb',
  'max file mb': 'maxFileSizeMb',
  'earliest': 'earliest',
  'latest': 'latest',
  'minselections': 'minSelections',
  'min selections': 'minSelections',
  'min answers': 'minSelections',
  'maxselections': 'maxSelections',
  'max selections': 'maxSelections',
  'max answers': 'maxSelections',
  'columns': 'columns',
  'rows': 'rows',
  'body': 'body',
  'formula': 'formula',
};

const NUMERIC_SETTINGS: (keyof QuestionConfig)[] = [
  'min', 'max', 'decimals', 'maxLength', 'maxFileSizeMb', 'minSelections', 'maxSelections',
];
const LIST_SETTINGS: (keyof QuestionConfig)[] = ['acceptedFormats', 'columns', 'rows'];

export interface SettingsParse {
  config: Partial<QuestionConfig>;
  /** Keys that were understood but mean nothing to this response type. */
  ignored: string[];
  /** Keys that were not understood at all. */
  unknown: string[];
}

/** `unit = days; min = 1; max = 90` against the keys the type actually reads. */
export function parseSettings(value: string, type: QuestionType): SettingsParse {
  const used = new Set<keyof QuestionConfig>(keysFor(type));
  const config: Partial<QuestionConfig> = {};
  const ignored: string[] = [];
  const unknown: string[] = [];

  for (const pair of value.split(/[;\n]/)) {
    const text = pair.trim();
    if (text === '') continue;
    const split = text.indexOf('=');
    if (split < 0) { unknown.push(text); continue; }

    const rawKey = text.slice(0, split).trim();
    const rawValue = text.slice(split + 1).trim();
    const key = SETTING_ALIASES[rawKey.toLowerCase()]
      ?? SETTING_ALIASES[normaliseHeader(rawKey)];

    if (!key) { unknown.push(rawKey); continue; }
    if (!used.has(key)) { ignored.push(rawKey); continue; }

    if (NUMERIC_SETTINGS.includes(key)) {
      (config as Record<string, unknown>)[key] = rawValue === '' ? null : lookupNumber(rawValue);
    } else if (LIST_SETTINGS.includes(key)) {
      (config as Record<string, unknown>)[key] = rawValue
        .split(/[|,/]/).map((v) => v.trim()).filter((v) => v !== '');
    } else {
      (config as Record<string, unknown>)[key] = rawValue;
    }
  }

  return { config, ignored, unknown };
}

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

export type ImportSeverity = 'error' | 'warning' | 'info';

export interface ImportIssue {
  severity: ImportSeverity;
  /** Row number as the buyer sees it in the spreadsheet. Null for the file. */
  row: number | null;
  message: string;
}

export type ImportMode = 'replace' | 'append';

export interface QuestionnaireImport {
  /** The template as it would be after the import. */
  next: QuestionnaireTemplate;
  issues: ImportIssue[];
  /** Rows under the header that held anything at all. */
  rowsRead: number;
  questionsRead: number;
  sectionsRead: number;
  /** Whether anything at all came through. */
  ok: boolean;
}

interface PendingSection {
  name: string;
  declaredWeight: number | null;
  askedPer: QuestionScope | null;
  questions: TemplateQuestion[];
}

/**
 * Find the header row.
 *
 * Not assumed to be row 1: sheets that have been through a few hands carry a
 * title, a date and a blank line above the grid. The header is the first row
 * where at least two cells name a column we know — one is too easy to hit by
 * accident on a row that happens to say "Question".
 */
export function findHeaderRow(rows: string[][]): number {
  for (let r = 0; r < rows.length; r += 1) {
    const hits = rows[r].filter((cell) => fieldOfHeader(cell) !== null).length;
    if (hits >= 2) return r;
  }
  return -1;
}

function fieldOfHeader(cell: string): ImportField | null {
  const wanted = normaliseHeader(cell);
  if (wanted === '') return null;
  for (const column of IMPORT_COLUMNS) {
    if (normaliseHeader(column.header) === wanted) return column.field;
    if (column.aliases.some((alias) => normaliseHeader(alias) === wanted)) return column.field;
  }
  return null;
}

/** The sheet the questions are on: by name, else the first one with a header. */
export function questionSheet(sheets: Sheet[]): Sheet | null {
  const named = sheets.find((s) => normaliseHeader(s.name) === 'questions');
  if (named && findHeaderRow(named.rows) >= 0) return named;
  return sheets.find((s) => findHeaderRow(s.rows) >= 0) ?? null;
}

/**
 * Read a workbook into a template.
 *
 * `replace` throws away what the template held; `append` keeps it and adds.
 * Both re-key everything they create under the template id, so an import never
 * carries an id that belongs to the file it came from.
 */
export function importQuestionnaire(
  sheets: Sheet[],
  { template, mode, fileName = '' }: {
    template: QuestionnaireTemplate;
    mode: ImportMode;
    /** Used to name an unnamed template, so an upload is never saveless. */
    fileName?: string;
  },
): QuestionnaireImport {
  const issues: ImportIssue[] = [];
  const fail = (message: string): QuestionnaireImport => ({
    next: template,
    issues: [...issues, { severity: 'error', row: null, message }],
    rowsRead: 0, questionsRead: 0, sectionsRead: 0, ok: false,
  });

  const sheet = questionSheet(sheets);
  if (!sheet) {
    return fail(
      'No question grid in this file. The sheet needs a header row naming at least two of the columns — ID, Question, Response Type, Weight. Download the template to see the shape.',
    );
  }

  const headerRow = findHeaderRow(sheet.rows);
  const header = sheet.rows[headerRow];
  const at = new Map<ImportField, number>();
  const unrecognised: string[] = [];

  header.forEach((cell, index) => {
    const field = fieldOfHeader(cell);
    if (field === null) {
      if (cell.trim() !== '') unrecognised.push(cell.trim());
    } else if (!at.has(field)) {
      at.set(field, index);
    }
  });

  if (!at.has('title')) {
    return fail(
      `No "Question" column on sheet "${sheet.name}". That is the one column an import cannot do without — everything else has a default.`,
    );
  }
  if (unrecognised.length > 0) {
    issues.push({
      severity: 'info',
      row: headerRow + 1,
      message: `Ignored ${unrecognised.length} column(s) this import does not read: ${unrecognised.join(', ')}.`,
    });
  }

  const cellAt = (row: string[], field: ImportField): string => {
    const index = at.get(field);
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  // --- Rows ----------------------------------------------------------------

  const pending: PendingSection[] = [];
  const byName = new Map<string, PendingSection>();
  const takenCodes = new Set(
    mode === 'append' ? template.questions.map((q) => q.code.toLowerCase()) : [],
  );

  /** Which spreadsheet row each question came off, for issues raised later. */
  const sourceRow = new Map<Id, number>();

  let rowsRead = 0;
  let questionsRead = 0;
  let carriedSection = '';
  let counter = mode === 'append' ? template.questions.length : 0;

  for (let r = headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const line = r + 1;
    if (row.every((cell) => (cell ?? '').trim() === '')) continue;
    rowsRead += 1;

    const title = cellAt(row, 'title');
    if (title === '') {
      issues.push({
        severity: 'error', row: line,
        message: 'No question text on this row, so there is nothing to ask. Row skipped.',
      });
      continue;
    }

    // --- The section this row belongs to -----------------------------------
    const sectionCell = cellAt(row, 'section');
    const sectionName = sectionCell !== '' ? sectionCell : carriedSection;
    if (sectionName === '') {
      issues.push({
        severity: 'warning', row: line,
        message: `"${title}" names no section and no section is open above it, so it goes into "General".`,
      });
    }
    const resolvedSection = sectionName === '' ? 'General' : sectionName;
    carriedSection = resolvedSection;

    let section = byName.get(resolvedSection.toLowerCase());
    if (!section) {
      section = { name: resolvedSection, declaredWeight: null, askedPer: null, questions: [] };
      byName.set(resolvedSection.toLowerCase(), section);
      pending.push(section);
    }

    const sectionWeight = lookupNumber(cellAt(row, 'sectionWeight'));
    if (sectionWeight !== null) {
      if (section.declaredWeight !== null && section.declaredWeight !== sectionWeight) {
        issues.push({
          severity: 'warning', row: line,
          message: `"${section.name}" is given ${sectionWeight}% here and ${section.declaredWeight}% on an earlier row. Keeping ${section.declaredWeight}% — a section has one weight.`,
        });
      } else {
        section.declaredWeight = Math.max(0, sectionWeight);
      }
    }

    const scope = lookupScope(cellAt(row, 'askedPer'));
    if (cellAt(row, 'askedPer') !== '' && scope === null) {
      issues.push({
        severity: 'warning', row: line,
        message: `"${cellAt(row, 'askedPer')}" is not an Asked Per value. Use ${QUESTION_SCOPE_LABEL.VENDOR} or ${QUESTION_SCOPE_LABEL.LINE}.`,
      });
    }
    if (scope !== null) {
      if (section.askedPer !== null && section.askedPer !== scope) {
        issues.push({
          severity: 'warning', row: line,
          message: `"${section.name}" is asked ${QUESTION_SCOPE_LABEL[section.askedPer]} on an earlier row and ${QUESTION_SCOPE_LABEL[scope]} here. Keeping ${QUESTION_SCOPE_LABEL[section.askedPer]} — the grain belongs to the section, not the row.`,
        });
      } else {
        section.askedPer = scope;
      }
    }

    // --- Response type ------------------------------------------------------
    const typeCell = cellAt(row, 'type');
    let type = lookupType(typeCell);
    if (typeCell !== '' && type === null) {
      // A type that exists but is not offered gets its own message. "Page
      // break is not a response type" is a sentence someone can act on;
      // "pick one of 23" when they picked a real one is not.
      const structural = (Object.keys(QUESTION_TYPE_SPEC) as QuestionType[])
        .find((t) => normaliseHeader(QUESTION_TYPE_SPEC[t].label) === normaliseHeader(typeCell));
      issues.push({
        severity: 'error', row: line,
        message: structural
          ? `"${typeCell}" arranges the form rather than asking the supplier anything, so it is not a response type an import can set. Row skipped.`
          : `"${typeCell}" is not a response type. Pick one from the Lists sheet — ${RESPONSE_TYPE_LABELS.slice(0, 4).join(', ')} and ${RESPONSE_TYPE_LABELS.length - 4} others. Row skipped.`,
      });
      continue;
    }
    if (type === null) {
      type = 'short_text';
      issues.push({
        severity: 'warning', row: line,
        message: `"${title}" names no response type, so it is asked as short text.`,
      });
    }

    counter += 1;
    const id = `${template.id}-q-${counter}`;

    // --- Code ---------------------------------------------------------------
    let code = cellAt(row, 'code');
    if (code === '') {
      code = `Q.${counter}`;
      issues.push({
        severity: 'info', row: line,
        message: `No ID on this row, so "${title.slice(0, 40)}${title.length > 40 ? '…' : ''}" was given ${code}. A code is what carries an answer from one stage to the next, so it is worth setting.`,
      });
    }
    if (takenCodes.has(code.toLowerCase())) {
      const original = code;
      let suffix = 2;
      while (takenCodes.has(`${original}-${suffix}`.toLowerCase())) suffix += 1;
      code = `${original}-${suffix}`;
      issues.push({
        severity: 'warning', row: line,
        message: `ID ${original} is already used in this template, so this question became ${code}. Codes carry answers between stages and two questions cannot share one.`,
      });
    }
    takenCodes.add(code.toLowerCase());

    // --- Weight and scoring --------------------------------------------------
    const priced = PRICED_QUESTION_TYPES.includes(type);
    let weight = Math.max(0, lookupNumber(cellAt(row, 'weight')) ?? 0);
    if (priced && weight > 0) {
      issues.push({
        severity: 'warning', row: line,
        message: `"${title}" is a ${QUESTION_TYPE_SPEC[type].label} carrying weight ${weight}. Price reaches the award score through the price component alone, so the weight was dropped rather than counting price twice.`,
      });
      weight = 0;
    }

    const scoringCell = cellAt(row, 'scoring');
    let scoring = lookupScoring(scoringCell);
    if (scoringCell !== '' && scoring === null) {
      issues.push({
        severity: 'warning', row: line,
        message: `"${scoringCell}" is not a scoring method, so ${code} falls back to the default. Use ${Object.values(SCORING_IMPORT_LABEL).join(', ')}.`,
      });
    }
    if (priced) scoring = 'NONE';
    else if (scoring === null) scoring = weight > 0 ? 'MANUAL' : 'NONE';

    // --- Envelope and flags ---------------------------------------------------
    const envelopeCell = cellAt(row, 'envelope');
    let envelope = lookupEnvelope(envelopeCell);
    if (envelopeCell !== '' && envelope === null) {
      issues.push({
        severity: 'warning', row: line,
        message: `"${envelopeCell}" is not an envelope, so ${code} uses the one its response type defaults to.`,
      });
    }
    if (envelope === null) envelope = QUESTION_TYPE_SPEC[type].defaultEnvelope;

    const isRequired = lookupFlag(cellAt(row, 'required')) ?? true;
    const isKnockout = lookupFlag(cellAt(row, 'knockout')) ?? false;
    const allowAttachment = lookupFlag(cellAt(row, 'attachment')) ?? false;

    // --- Answer format --------------------------------------------------------
    const config: QuestionConfig = { ...defaultConfigFor(type, id) };

    const choicesCell = cellAt(row, 'choices');
    if (choicesCell !== '') {
      if (keysFor(type).includes('options')) {
        config.options = parseChoices(choicesCell, id);
      } else {
        issues.push({
          severity: 'info', row: line,
          message: `Choices were given for ${code}, but a ${QUESTION_TYPE_SPEC[type].label} is not answered from a list, so they were left out.`,
        });
      }
    }

    const settingsCell = cellAt(row, 'settings');
    if (settingsCell !== '') {
      const parsed = parseSettings(settingsCell, type);
      Object.assign(config, parsed.config);
      if (parsed.ignored.length > 0) {
        issues.push({
          severity: 'info', row: line,
          message: `${code}: a ${QUESTION_TYPE_SPEC[type].label} does not use ${parsed.ignored.join(', ')}, so ${parsed.ignored.length === 1 ? 'it was' : 'they were'} left out.`,
        });
      }
      if (parsed.unknown.length > 0) {
        issues.push({
          severity: 'warning', row: line,
          message: `${code}: could not read the setting${parsed.unknown.length === 1 ? '' : 's'} ${parsed.unknown.join(', ')}. Settings are written as  key = value  and separated with  ;`,
        });
      }
    }

    sourceRow.set(id, line);
    section.questions.push({
      id,
      templateId: template.id,
      sectionId: '', // filled once the section has an id
      sequence: counter,
      code,
      type,
      title,
      helpText: cellAt(row, 'helpText'),
      isRequired,
      envelope,
      weight,
      scoringMethod: scoring,
      maxScore: scoring === 'NONE' ? 0 : 10,
      rubric: cellAt(row, 'rubric') || null,
      isKnockout,
      allowAttachment,
      askedPer: 'VENDOR', // settled from the section below
      config,
    });

    questionsRead += 1;
  }

  if (questionsRead === 0) {
    return fail(
      rowsRead === 0
        ? `Sheet "${sheet.name}" has a header row and nothing under it.`
        : `None of the ${rowsRead} row(s) under the header could be read as a question. The issues above say why for each.`,
    );
  }

  // --- Sections -------------------------------------------------------------

  const keptSections = mode === 'append' ? template.sections : [];
  const usedIds = new Set(keptSections.map((s) => s.id));
  const sections: TemplateSection[] = [...keptSections];
  const questions: TemplateQuestion[] = mode === 'append' ? [...template.questions] : [];

  pending.forEach((group) => {
    const existing = mode === 'append'
      ? keptSections.find((s) => s.name.trim().toLowerCase() === group.name.trim().toLowerCase())
      : undefined;

    let id = existing?.id;
    if (!id) {
      let n = sections.length + 1;
      while (usedIds.has(`${template.id}-sec-${n}`)) n += 1;
      id = `${template.id}-sec-${n}`;
      usedIds.add(id);
    }

    /**
     * A section with no declared weight is given what its questions carry.
     *
     * This is the budget semantics restated, not a guess: the section weight
     * is the most its questions may allocate, so the tightest honest value is
     * exactly what they do allocate. A buyer who has filled in the question
     * weights and left the section column alone gets sections that add up
     * whenever the question weights do.
     */
    const allocated = group.questions.reduce((sum, q) => sum + q.weight, 0);
    const weight = group.declaredWeight ?? allocated;
    const askedPer: QuestionScope = group.askedPer ?? existing?.askedPer ?? 'VENDOR';

    if (existing) {
      const at2 = sections.findIndex((s) => s.id === existing.id);
      sections[at2] = { ...existing, weight: group.declaredWeight ?? existing.weight, askedPer };
      issues.push({
        severity: 'info', row: null,
        message: `"${group.name}" already exists in this template, so its ${group.questions.length} new question(s) were added to it.`,
      });
    } else {
      sections.push({
        id, name: group.name, sequence: sections.length + 1, weight, askedPer,
      });
    }

    for (const question of group.questions) {
      // The grain belongs to the section, and the types that cannot be
      // repeated per line stay per vendor whatever the section says.
      const grain: QuestionScope = canAskPerLine(question.type) ? askedPer : 'VENDOR';

      /**
       * A knockout on a per-line question cannot fire, so it is dropped at the
       * door rather than imported into an error state. A knockout removes the
       * supplier from the whole event, which one failing line cannot justify —
       * that is an award decision, line by line.
       */
      const knockout = question.isKnockout && grain === 'LINE';
      if (knockout) {
        issues.push({
          severity: 'warning', row: sourceRow.get(question.id) ?? null,
          message: `"${question.title}" is in a per-line-item section and marked as a knockout. A knockout removes the supplier from the whole event, which one failing line cannot justify — the knockout was dropped.`,
        });
      }

      questions.push({
        ...question,
        sectionId: id,
        askedPer: grain,
        isKnockout: question.isKnockout && !knockout,
      });
    }

    if (group.declaredWeight === null && allocated > 0) {
      issues.push({
        severity: 'info', row: null,
        message: `"${group.name}" was given no Section Weight %, so it takes ${allocated}% — the total of the question weights inside it.`,
      });
    }
  });

  const total = sections.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  if (sections.some((s) => s.weight > 0) && total !== 100) {
    issues.push({
      severity: 'warning', row: null,
      message: total < 100
        ? `The sections add up to ${total}%, so ${100 - total}% of the technical score is unaccounted for. The import goes through; the template cannot be saved until they total 100%.`
        : `The sections add up to ${total}%, which is ${total - 100}% more score than there is to give. The import goes through; the template cannot be saved until they total 100%.`,
    });
  }

  // --- Template-level values, when the file carries them ---------------------

  const meta = mode === 'replace'
    ? readTemplateSheet(sheets)
    : { patch: {}, issues: [] as ImportIssue[] };
  issues.push(...meta.issues);

  /**
   * An upload lands in draft, whatever the template was before.
   *
   * A published template is a promise about what it asks; once a spreadsheet
   * has rewritten the questions, that promise is about a questionnaire that
   * no longer exists. Draft is also what makes everything editable — the code
   * unfreezes, and the buyer is expected to read through what arrived, change
   * it, and publish deliberately rather than by uploading.
   */
  if (template.status !== 'DRAFT') {
    issues.push({
      severity: 'info', row: null,
      message: `This template was ${TEMPLATE_STATUS_LABELS[template.status].toLowerCase()}. An upload rewrites what it asks, so it goes back to draft — review the sections and questions, change whatever you need to, and publish it again when it is right.`,
    });
  }

  const next: QuestionnaireTemplate = {
    ...template,
    ...meta.patch,
    status: 'DRAFT',
    sections: sections.map((s, i) => ({ ...s, sequence: i + 1 })),
    questions: questions.map((q, i) => ({ ...q, sequence: i + 1 })),
  };

  /**
   * Name it from the file when nothing else does.
   *
   * A template without a name cannot be saved, and the sheet never asked for
   * one — the Template sheet's name cell is blank in the file we hand out, so
   * the common path was: fill in thirty questions, upload, and find the Save
   * button greyed out with the reason at the top of a long form. A name taken
   * from the file is a placeholder the buyer will recognise and can change in
   * the first field of the builder.
   */
  if (next.name.trim() === '') {
    const fromFile = nameFromFile(fileName);
    if (fromFile !== '') {
      next.name = fromFile;
      issues.push({
        severity: 'info', row: null,
        message: `Nothing in the file names this template, so it took the file's name — "${fromFile}". Rename it at the top of the builder: this is what buyers pick from in the library.`,
      });
    }
  }

  // The code follows the name, exactly as typing the name would have made it.
  if (next.code.trim() === '' && next.name.trim() !== '') {
    next.code = suggestCode(next.name, next.appliesTo);
  }

  /**
   * An RFI may not ask commercial questions — so a file that does cannot be
   * an RFI.
   *
   * Only moved when the template is still on the default the New-template
   * path set, and only when the file replaced its contents. Left alone, this
   * is a blocking error on arrival about a stage the buyer never chose.
   */
  const commercial = next.questions.filter((q) => q.envelope === 'COMMERCIAL');
  if (mode === 'replace' && commercial.length > 0
      && next.appliesTo.length === 1 && next.appliesTo[0] === 'RFI') {
    next.appliesTo = ['RFP'];
    issues.push({
      severity: 'warning', row: null,
      message: `${commercial.length} question(s) in this file are commercial, and an RFI qualifies the market before anyone is asked for a price. The template was moved from RFI to RFP — change it under "Where in the journey it is asked" if that is not where this belongs.`,
    });
  }

  return {
    next,
    issues,
    rowsRead,
    questionsRead,
    sectionsRead: pending.length,
    ok: true,
  };
}

// ---------------------------------------------------------------------------
// The Template sheet — name, code, where it is asked
// ---------------------------------------------------------------------------

const META_KEYS = {
  'template name': 'name',
  'name': 'name',
  'code': 'code',
  'template code': 'code',
  'description': 'description',
  'score scale': 'scoreScale',
  'scale': 'scoreScale',
} as const;

function readTemplateSheet(sheets: Sheet[]): {
  patch: Partial<QuestionnaireTemplate>; issues: ImportIssue[];
} {
  const sheet = sheets.find((s) => normaliseHeader(s.name) === 'template');
  if (!sheet) return { patch: {}, issues: [] };

  const patch: Partial<QuestionnaireTemplate> = {};
  const issues: ImportIssue[] = [];

  for (const row of sheet.rows) {
    const key = normaliseHeader(row[0] ?? '');
    const value = (row[1] ?? '').trim();
    if (key === '' || value === '') continue;

    const field = (META_KEYS as Record<string, string | undefined>)[key];
    if (field === 'name') patch.name = value;
    else if (field === 'code') patch.code = value;
    else if (field === 'description') patch.description = value;
    else if (field === 'scoreScale') {
      const scale = lookupNumber(value);
      if (scale !== null && scale > 0) patch.scoreScale = scale;
    }
  }

  if (patch.name) {
    issues.push({
      severity: 'info', row: null,
      message: `The Template sheet names this "${patch.name}", so the template was renamed to match the file.`,
    });
  }
  // Applied-at points and categories are deliberately not read from the file.
  // Both are closed lists this organisation owns, and a typo in a spreadsheet
  // that silently creates an unmatched category is a template nobody can find.
  return { patch, issues };
}

// ---------------------------------------------------------------------------
// The file we hand out
// ---------------------------------------------------------------------------

/** The header row and a few worked rows, used by both downloads. */
export function templateRows(): string[][] {
  // Written field by field rather than as positional arrays: sixteen columns
  // of bare strings is a row nobody can check, and a column inserted in the
  // middle would silently shift every example one to the left.
  const row = (values: Partial<Record<ImportField, string>>): string[] =>
    IMPORT_COLUMNS.map((column) => values[column.field] ?? '');

  return [
    IMPORT_COLUMNS.map((c) => c.header),
    row({
      section: 'Company & compliance', sectionWeight: '40', askedPer: 'Per vendor',
      code: 'Q.1', title: 'Are you certified to ISO 9001, or to an equivalent quality standard?',
      type: 'Single choice', weight: '15', scoring: 'Rule', envelope: 'Technical',
      required: 'Yes', knockout: 'Yes', attachment: 'Yes',
      helpText: 'Name the certifying body and attach the current certificate.',
      rubric: 'Certified = 10 · Equivalent = 6 · Neither = 0',
      choices: 'ISO 9001 = 10 | Equivalent standard = 6 | Not certified = 0 !',
    }),
    row({
      section: 'Company & compliance', sectionWeight: '40', askedPer: 'Per vendor',
      code: 'Q.2', title: 'Attach your latest audited financial statements.',
      type: 'File upload', weight: '10', scoring: 'Manual', envelope: 'Technical',
      required: 'Yes', knockout: 'No', attachment: 'No',
      helpText: 'The two most recent financial years.',
      rubric: 'Two years supplied = 10 · One = 5 · None = 0',
      settings: 'formats = pdf, xlsx; maxFileSizeMb = 20',
    }),
    row({
      section: 'Company & compliance', sectionWeight: '40', askedPer: 'Per vendor',
      code: 'Q.3',
      title: 'Describe how you would mobilise for this scope in the first thirty days.',
      type: 'Long text', weight: '15', scoring: 'Manual', envelope: 'Technical',
      required: 'Yes', knockout: 'No', attachment: 'No',
      rubric: 'Specific and resourced = 10 · Generic = 4 · Absent = 0',
      settings: 'maxLength = 3000',
    }),
    row({
      section: 'Per item commitments', sectionWeight: '60', askedPer: 'Per line item',
      code: 'Q.4', title: 'What is your lead time for this item, from purchase order to delivery?',
      type: 'Lead time', weight: '35', scoring: 'Rule', envelope: 'Technical',
      required: 'Yes', knockout: 'No', attachment: 'No',
      helpText: 'Working days, assuming the item is not already in stock.',
      rubric: '14 days or fewer = 10 · 30 days or fewer = 6 · longer = 2',
      settings: 'unit = days; min = 1; max = 120',
    }),
    row({
      section: 'Per item commitments', sectionWeight: '60', askedPer: 'Per line item',
      code: 'Q.5', title: 'What quantity of this item can you supply per month at steady state?',
      type: 'Capacity declaration', weight: '25', scoring: 'Manual', envelope: 'Technical',
      required: 'Yes', knockout: 'No', attachment: 'No',
      rubric: 'At or above the demanded quantity = 10 · below it = scaled',
      settings: 'unit = units / month; min = 0',
    }),
  ];
}

function guideRows(): string[][] {
  return [
    ['Column', 'What goes in it', 'Example'],
    ...IMPORT_COLUMNS.map((c) => [c.header, c.guidance, c.example]),
    ['', '', ''],
    [
      'How this sheet is read',
      'One row per question. The Questions sheet is read top to bottom: a row with a blank Section continues the section above it, so a section only needs naming on its first row. Rows with no question text are skipped and reported. Nothing is imported silently — every row that is changed or refused is listed before you confirm.',
      '',
    ],
    [
      'Weights',
      'Section Weight % is the share of the technical score the section carries, and the sections must total 100. Weight is what one question is worth out of its section, so the questions in a section cannot carry more between them than the section is worth. Leave Section Weight % empty and each section takes the total of the questions inside it.',
      '',
    ],
    [
      'Per vendor or per line item',
      'Asked Per belongs to the section, not to the row — the supplier meets one coherent block rather than a form that changes grain row by row. A per-line-item question is asked again for every line in the basket, so five questions across a six-line basket is thirty answers.',
      '',
    ],
  ];
}

function listRows(): string[][] {
  const scoring = Object.values(SCORING_IMPORT_LABEL);
  const envelopes = Object.values(ENVELOPE_IMPORT_LABEL);
  const scopes = [QUESTION_SCOPE_LABEL.VENDOR, QUESTION_SCOPE_LABEL.LINE];
  const yesNo = ['Yes', 'No'];

  const height = Math.max(
    RESPONSE_TYPE_LABELS.length, scoring.length, envelopes.length, scopes.length, yesNo.length,
  );

  const rows: string[][] = [['Response Type', 'Scoring', 'Envelope', 'Asked Per', 'Yes / No']];
  for (let i = 0; i < height; i += 1) {
    rows.push([
      RESPONSE_TYPE_LABELS[i] ?? '', scoring[i] ?? '', envelopes[i] ?? '',
      scopes[i] ?? '', yesNo[i] ?? '',
    ]);
  }
  return rows;
}

function metaRows(): string[][] {
  return [
    ['Field', 'Value'],
    ['Template name', ''],
    ['Code', ''],
    ['Description', ''],
    ['Score scale', '100'],
    ['', ''],
    [
      'Leave these blank to keep what is already on the template. Where the template is asked in the journey, and the categories it serves, are set in the product rather than here — they are closed lists, and a typo in a spreadsheet would create a category nothing matches.',
      '',
    ],
  ];
}

/** How many rows of the Questions sheet carry the response-type dropdown. */
const DROPDOWN_ROWS = 400;

/** The `.xlsx` a buyer downloads, fills in, and uploads back. */
export function importWorkbook(questionRows: string[][] = templateRows()): Uint8Array {
  const questions = questionRows;
  const lists = listRows();
  const typeColumn = IMPORT_COLUMNS.findIndex((c) => c.field === 'type');
  const askedColumn = IMPORT_COLUMNS.findIndex((c) => c.field === 'askedPer');
  const scoringColumn = IMPORT_COLUMNS.findIndex((c) => c.field === 'scoring');
  const envelopeColumn = IMPORT_COLUMNS.findIndex((c) => c.field === 'envelope');

  const dropdown = (column: number, listColumn: number, count: number) => ({
    column,
    fromRow: 1,
    toRow: DROPDOWN_ROWS,
    list: { sheet: 'Lists', column: listColumn, fromRow: 1, toRow: count },
  });

  const sheets: SheetSpec[] = [
    {
      name: 'Questions',
      rows: questions,
      widths: IMPORT_COLUMNS.map((c) => c.width),
      freezeHeader: true,
      validations: [
        dropdown(typeColumn, 0, RESPONSE_TYPE_LABELS.length),
        dropdown(scoringColumn, 1, Object.keys(SCORING_IMPORT_LABEL).length),
        dropdown(envelopeColumn, 2, Object.keys(ENVELOPE_IMPORT_LABEL).length),
        dropdown(askedColumn, 3, 2),
        ...[9, 10, 11].map((column) => dropdown(column, 4, 2)),
      ],
    },
    { name: 'Template', rows: metaRows(), widths: [30, 60] },
    { name: 'How to fill it in', rows: guideRows(), widths: [22, 96, 44] },
    { name: 'Lists', rows: lists, widths: [24, 16, 14, 16, 12] },
  ];

  return buildXlsx(sheets);
}

/**
 * The CSV equivalent.
 *
 * One sheet, so the guide cannot ride along — the column headings have to
 * carry it. They are the same headings, which is what makes the two files
 * interchangeable on the way back in.
 */
export function importCsv(questionRows: string[][] = templateRows()): string {
  return toCsv(questionRows);
}
