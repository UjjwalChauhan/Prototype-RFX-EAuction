/**
 * Reading a buyer's spreadsheet into a questionnaire.
 *
 * The tests divide in two. First, that the file we hand out comes back in
 * unchanged — if the round trip is not exact then the template is advice
 * rather than a format. Second, that every departure from the template is
 * either handled with a stated default or refused with a row number. The one
 * thing an import may never do is drop a question quietly.
 */
import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS, RESPONSE_TYPE_LABELS, importCsv, importQuestionnaire, importWorkbook,
  nameFromFile, parseChoices, parseSettings, templateRows, type ImportMode,
} from '../questionnaireImport';
import { emptyTemplate, validateTemplate } from '../questionnaireTemplates';
import { parseCsv, readXlsx, type Sheet } from '../spreadsheet';
import type { QuestionnaireTemplate } from '../types';

const BLANK = (): QuestionnaireTemplate => emptyTemplate({
  id: 'qt-900', scopeType: 'TENANT', scopeId: 'tenant-1', userId: 'u-1', now: 1_700_000_000_000,
});

/** A template with a name and one section, so only the questions are at issue. */
function named(over: Partial<QuestionnaireTemplate> = {}): QuestionnaireTemplate {
  return { ...BLANK(), name: 'Supplier qualification — RFI', ...over };
}

const HEADERS = IMPORT_COLUMNS.map((c) => c.header);
const indexOf = (header: string) => HEADERS.indexOf(header);

/** A grid built from `{ 'Question': '…' }` so a test names only what it means. */
function grid(...rows: Record<string, string>[]): Sheet[] {
  return [{
    name: 'Questions',
    rows: [HEADERS, ...rows.map((row) => HEADERS.map((h) => row[h] ?? ''))],
  }];
}

function run(sheets: Sheet[], mode: ImportMode = 'replace', template = named()) {
  return importQuestionnaire(sheets, { template, mode });
}

const said = (result: ReturnType<typeof run>) => result.issues.map((i) => i.message).join(' || ');

// ---------------------------------------------------------------------------

describe('the file we hand out', () => {
  it('names a column for every field the question editor sets', () => {
    expect(HEADERS).toEqual([
      'Section', 'Section Weight %', 'Asked Per', 'ID', 'Question', 'Response Type', 'Weight',
      'Scoring', 'Envelope', 'Required', 'Knockout', 'Attachment', 'Help Text', 'Rubric',
      'Choices', 'Answer Settings',
    ]);
  });

  it('puts the ID before the question, as the question editor now does', () => {
    expect(indexOf('ID')).toBeLessThan(indexOf('Question'));
  });

  it('offers every response type the editor offers, and no layout elements', () => {
    expect(RESPONSE_TYPE_LABELS).toContain('Short text');
    expect(RESPONSE_TYPE_LABELS).toContain('Matrix rating');
    expect(RESPONSE_TYPE_LABELS).toContain('Hidden metadata');
    expect(RESPONSE_TYPE_LABELS).not.toContain('Page break');
    expect(RESPONSE_TYPE_LABELS).not.toContain('Section break');
  });

  it('comes back from Excel as the questionnaire it describes, with nothing to report', async () => {
    const result = run(await readXlsx(importWorkbook()));

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.questionsRead).toBe(5);
    expect(result.next.sections.map((s) => [s.name, s.weight, s.askedPer])).toEqual([
      ['Company & compliance', 40, 'VENDOR'],
      ['Per item commitments', 60, 'LINE'],
    ]);
    expect(validateTemplate(result.next).valid).toBe(true);
  });

  it('comes back from CSV as the same questionnaire', () => {
    const fromCsv = run([{ name: 'Questions', rows: parseCsv(importCsv()) }]);
    expect(fromCsv.ok).toBe(true);
    expect(fromCsv.issues).toEqual([]);
    expect(fromCsv.next.questions.map((q) => q.code)).toEqual(['Q.1', 'Q.2', 'Q.3', 'Q.4', 'Q.5']);
  });

  it('carries the worked example all the way down to the answer format', async () => {
    const result = run(await readXlsx(importWorkbook()));
    const certification = result.next.questions[0];

    expect(certification.type).toBe('single_choice');
    expect(certification.config.options?.map((o) => [o.label, o.score, o.isDisqualifying])).toEqual([
      ['ISO 9001', 10, false],
      ['Equivalent standard', 6, false],
      ['Not certified', 0, true],
    ]);

    const leadTime = result.next.questions[3];
    expect(leadTime.type).toBe('lead_time');
    expect(leadTime.config).toMatchObject({ unit: 'days', min: 1, max: 120 });
    expect(leadTime.askedPer).toBe('LINE');
  });

  it('is the same five rows whichever download the buyer took', () => {
    expect(parseCsv(importCsv())).toEqual(templateRows());
  });
});

describe('finding the grid', () => {
  it('reads a header that is not on the first row', () => {
    const sheets: Sheet[] = [{
      name: 'Sheet1',
      rows: [
        ['Category team questionnaire — v4'], ['Updated 12 March'], [],
        HEADERS, HEADERS.map((h) => (h === 'Question' ? 'How many sites do you run?' : '')),
      ],
    }];
    expect(run(sheets).questionsRead).toBe(1);
  });

  it('accepts the headings a buyer renamed on the way through', () => {
    const sheets: Sheet[] = [{
      name: 'Sheet1',
      rows: [['Question Code', 'Question Text', 'Answer Type', 'Points'],
        ['CAP-1', 'How many sites?', 'Number', '20']],
    }];
    const question = run(sheets).next.questions[0];
    expect([question.code, question.type, question.weight]).toEqual(['CAP-1', 'number', 20]);
  });

  it('prefers the sheet actually called Questions', () => {
    const sheets: Sheet[] = [
      { name: 'Notes', rows: [['ID', 'Question'], ['X', 'Not this one']] },
      { name: 'Questions', rows: [['ID', 'Question'], ['Y', 'This one']] },
    ];
    expect(run(sheets).next.questions[0].title).toBe('This one');
  });

  it('says which columns it ignored rather than silently reading past them', () => {
    const sheets: Sheet[] = [{
      name: 'Questions',
      rows: [['ID', 'Question', 'Owner', 'Raised by'], ['Q.1', 'Ask something', 'Priya', 'Legal']],
    }];
    expect(said(run(sheets))).toContain('Owner, Raised by');
  });

  it('refuses a file with no question grid in it, and says what one looks like', () => {
    const result = run([{ name: 'Notes', rows: [['Minutes of the category review']] }]);
    expect(result.ok).toBe(false);
    expect(said(result)).toContain('header row naming at least two of the columns');
  });

  it('refuses a grid with no Question column, naming the one column it needs', () => {
    const sheets: Sheet[] = [{ name: 'Questions', rows: [['ID', 'Weight'], ['Q.1', '10']] }];
    const result = run(sheets);
    expect(result.ok).toBe(false);
    expect(said(result)).toContain('the one column an import cannot do without');
  });

  it('refuses a header with nothing under it', () => {
    expect(run(grid()).ok).toBe(false);
  });
});

describe('sections', () => {
  it('continues the section above when the cell is left blank', () => {
    const result = run(grid(
      { Section: 'Capability', Question: 'First', Weight: '30' },
      { Question: 'Second', Weight: '40' },
      { Section: 'Commercial', Question: 'Third', Weight: '30' },
    ));
    expect(result.next.sections.map((s) => s.name)).toEqual(['Capability', 'Commercial']);
    expect(result.next.questions.map((q) => q.sectionId)).toEqual([
      'qt-900-sec-1', 'qt-900-sec-1', 'qt-900-sec-2',
    ]);
  });

  it('puts a question with no section anywhere above it into General, and says so', () => {
    const result = run(grid({ Question: 'Orphan' }));
    expect(result.next.sections[0].name).toBe('General');
    expect(said(result)).toContain('names no section');
  });

  it('gives an unweighted section the total of the questions inside it', () => {
    const result = run(grid(
      { Section: 'Capability', Question: 'First', Weight: '60' },
      { Section: 'Capability', Question: 'Second', Weight: '40' },
    ));
    expect(result.next.sections[0].weight).toBe(100);
    expect(said(result)).toContain('the total of the question weights inside it');
    expect(validateTemplate(result.next).valid).toBe(true);
  });

  it('keeps the first weight when a section is given two, and says which it kept', () => {
    const result = run(grid(
      { Section: 'Capability', 'Section Weight %': '40', Question: 'First' },
      { Section: 'Capability', 'Section Weight %': '55', Question: 'Second' },
    ));
    expect(result.next.sections[0].weight).toBe(40);
    expect(said(result)).toContain('Keeping 40%');
  });

  it('warns when the sections do not make 100, without refusing the import', () => {
    const result = run(grid(
      { Section: 'A', 'Section Weight %': '40', Question: 'First', Weight: '40' },
      { Section: 'B', 'Section Weight %': '30', Question: 'Second', Weight: '30' },
    ));
    expect(result.ok).toBe(true);
    expect(said(result)).toContain('30% of the technical score is unaccounted for');
    expect(validateTemplate(result.next).errors.map((e) => e.code))
      .toContain('SECTION_WEIGHTS_NOT_100');
  });

  it('says nothing about 100% when nothing is weighted — a pure RFI is complete as it is', () => {
    const result = run(grid(
      { Section: 'Capability', Question: 'First' },
      { Section: 'Capability', Question: 'Second' },
    ));
    expect(said(result)).not.toContain('unaccounted for');
    expect(validateTemplate(result.next).errors.map((e) => e.code))
      .not.toContain('SECTION_WEIGHTS_NOT_100');
  });
});

describe('the grain a section is asked at', () => {
  it('takes Asked Per from the rows and applies it to the whole section', () => {
    const result = run(grid(
      { Section: 'Per item', 'Asked Per': 'Per line item', Question: 'Lead time?', 'Response Type': 'Lead time' },
      { Section: 'Per item', Question: 'Capacity?', 'Response Type': 'Capacity declaration' },
    ));
    expect(result.next.sections[0].askedPer).toBe('LINE');
    expect(result.next.questions.every((q) => q.askedPer === 'LINE')).toBe(true);
  });

  it('keeps a basket-wide type per vendor even inside a per-line section', () => {
    const result = run(grid(
      { Section: 'Per item', 'Asked Per': 'Per line item', Question: 'Prices', 'Response Type': 'Price schedule' },
    ));
    expect(result.next.sections[0].askedPer).toBe('LINE');
    expect(result.next.questions[0].askedPer).toBe('VENDOR');
  });

  it('keeps the first grain when a section is given two, because the grain is the section’s', () => {
    const result = run(grid(
      { Section: 'Mixed', 'Asked Per': 'Per vendor', Question: 'First' },
      { Section: 'Mixed', 'Asked Per': 'Per line item', Question: 'Second' },
    ));
    expect(result.next.sections[0].askedPer).toBe('VENDOR');
    expect(said(result)).toContain('the grain belongs to the section, not the row');
  });

  it('drops a knockout that lands in a per-line section, because it could never fire', () => {
    const result = run(grid(
      { Section: 'Per item', 'Asked Per': 'Per line item', Question: 'Meets spec?', 'Response Type': 'Yes / No', Knockout: 'Yes' },
    ));
    expect(result.next.questions[0].isKnockout).toBe(false);
    expect(said(result)).toContain('the knockout was dropped');
    expect(validateTemplate(result.next).errors.map((e) => e.code)).not.toContain('LINE_KNOCKOUT');
  });

  it('refuses a value that is not a grain and says what the two are', () => {
    expect(said(run(grid({ Question: 'Ask', 'Asked Per': 'Monthly' }))))
      .toContain('is not an Asked Per value');
  });
});

describe('each row', () => {
  it('skips a row with no question text and says which row', () => {
    const result = run(grid(
      { ID: 'Q.1', Question: 'Real question' },
      { ID: 'Q.2', Weight: '10' },
    ));
    expect(result.questionsRead).toBe(1);
    expect(result.issues.find((i) => i.severity === 'error')?.row).toBe(3);
  });

  it('refuses a response type it does not know, and skips only that row', () => {
    const result = run(grid(
      { Question: 'Good row' },
      { Question: 'Bad row', 'Response Type': 'Sliding scale' },
    ));
    expect(result.questionsRead).toBe(1);
    expect(said(result)).toContain('"Sliding scale" is not a response type');
  });

  it('explains itself when the type exists but arranges the form rather than asking', () => {
    expect(said(run(grid({ Question: 'A heading', 'Response Type': 'Page break' }))))
      .toContain('arranges the form rather than asking the supplier anything');
  });

  it('falls back to short text when no type is given, and says it did', () => {
    const result = run(grid({ Question: 'Something' }));
    expect(result.next.questions[0].type).toBe('short_text');
    expect(said(result)).toContain('asked as short text');
  });

  it('accepts the raw type key as well as the label', () => {
    expect(run(grid({ Question: 'A', 'Response Type': 'long_text' })).next.questions[0].type)
      .toBe('long_text');
  });

  it('invents an ID when there is none, and says what it chose', () => {
    const result = run(grid({ Question: 'Unnumbered' }));
    expect(result.next.questions[0].code).toBe('Q.1');
    expect(said(result)).toContain('was given Q.1');
  });

  it('reads yes and no however the sheet writes them', () => {
    const result = run(grid(
      { Question: 'A', Required: 'TRUE', Knockout: 'N', Attachment: '1' },
      { Question: 'B', Required: 'no', Attachment: '✓' },
    ));
    expect(result.next.questions.map((q) => [q.isRequired, q.isKnockout, q.allowAttachment]))
      .toEqual([[true, false, true], [false, false, true]]);
  });

  it('scores a weighted question manually and leaves an unweighted one unscored', () => {
    const result = run(grid(
      { Section: 'A', 'Section Weight %': '100', Question: 'Weighted', Weight: '100' },
      { Section: 'A', Question: 'Not weighted' },
    ));
    expect(result.next.questions.map((q) => [q.scoringMethod, q.maxScore]))
      .toEqual([['MANUAL', 10], ['NONE', 0]]);
  });

  it('drops the weight off a priced question rather than counting price twice', () => {
    const result = run(grid(
      { Section: 'Price', Question: 'Unit prices', 'Response Type': 'Price schedule', Weight: '40' },
    ));
    expect(result.next.questions[0].weight).toBe(0);
    expect(result.next.questions[0].scoringMethod).toBe('NONE');
    expect(said(result)).toContain('the weight was dropped');
    expect(validateTemplate(result.next).errors.map((e) => e.code))
      .not.toContain('PRICE_CARRIES_WEIGHT');
  });

  it('takes the envelope from the response type when the sheet leaves it out', () => {
    const result = run(grid({ Question: 'Terms', 'Response Type': 'Payment terms' }));
    expect(result.next.questions[0].envelope).toBe('COMMERCIAL');
  });

  it('falls back and says so when the envelope is not one of the three', () => {
    const result = run(grid({ Question: 'A', Envelope: 'Sealed' }));
    expect(result.next.questions[0].envelope).toBe('TECHNICAL');
    expect(said(result)).toContain('is not an envelope');
  });
});

describe('choices', () => {
  it('reads label, score, disqualification and detail off one line', () => {
    const options = parseChoices('Yes = 10 | No = 0 ! | Other ?', 'q1');
    expect(options.map((o) => [o.label, o.score, o.isDisqualifying, o.requiresDetail])).toEqual([
      ['Yes', 10, false, false],
      ['No', 0, true, false],
      ['Other', null, false, true],
    ]);
  });

  it('leaves choices out of a type that is not answered from a list, and says so', () => {
    const result = run(grid({ Question: 'Describe', 'Response Type': 'Long text', Choices: 'A | B' }));
    expect(result.next.questions[0].config.options).toBeUndefined();
    expect(said(result)).toContain('is not answered from a list');
  });
});

describe('answer settings', () => {
  it('applies the keys the type uses', () => {
    const { config, ignored, unknown } = parseSettings('unit = days; min = 1; max = 90', 'lead_time');
    expect(config).toEqual({ unit: 'days', min: 1, max: 90 });
    expect([ignored, unknown]).toEqual([[], []]);
  });

  it('splits a list setting on commas or pipes', () => {
    expect(parseSettings('formats = pdf, docx | xlsx', 'file_upload').config.acceptedFormats)
      .toEqual(['pdf', 'docx', 'xlsx']);
  });

  it('reports a key the type does not use rather than writing it anyway', () => {
    const result = run(grid({ Question: 'A', 'Response Type': 'Short text', 'Answer Settings': 'unit = days' }));
    expect(result.next.questions[0].config.unit).toBeUndefined();
    expect(said(result)).toContain('does not use unit');
  });

  it('reports a key it could not read at all, with the syntax', () => {
    const result = run(grid({ Question: 'A', 'Answer Settings': 'colour = blue' }));
    expect(said(result)).toContain('could not read the setting colour');
  });
});

describe('adding to a template that already has questions', () => {
  const existing = (): QuestionnaireTemplate => run(grid(
    { Section: 'Capability', 'Section Weight %': '100', ID: 'CAP-1', Question: 'Existing', Weight: '100' },
  )).next;

  it('replaces everything when asked to replace', () => {
    const result = run(grid({ Question: 'New one' }), 'replace', existing());
    expect(result.next.questions.map((q) => q.title)).toEqual(['New one']);
    expect(result.next.sections).toHaveLength(1);
  });

  it('keeps what was there when asked to add', () => {
    const result = run(grid({ Section: 'Commercial', Question: 'New one' }), 'append', existing());
    expect(result.next.questions.map((q) => q.title)).toEqual(['Existing', 'New one']);
    expect(result.next.sections.map((s) => s.name)).toEqual(['Capability', 'Commercial']);
  });

  it('adds into a section of the same name rather than creating it twice', () => {
    const result = run(grid({ Section: 'Capability', Question: 'Second' }), 'append', existing());
    expect(result.next.sections).toHaveLength(1);
    expect(result.next.questions.every((q) => q.sectionId === result.next.sections[0].id)).toBe(true);
    expect(said(result)).toContain('already exists in this template');
  });

  it('makes a colliding code unique instead of breaking answer inheritance', () => {
    const result = run(grid({ Section: 'Capability', ID: 'CAP-1', Question: 'Clashing' }), 'append', existing());
    expect(result.next.questions.map((q) => q.code)).toEqual(['CAP-1', 'CAP-1-2']);
    expect(said(result)).toContain('two questions cannot share one');
    expect(validateTemplate(result.next).errors.map((e) => e.code)).not.toContain('DUPLICATE_CODE');
  });

  it('numbers new ids past the ones already on the template', () => {
    const result = run(grid({ Question: 'Second' }), 'append', existing());
    expect(new Set(result.next.questions.map((q) => q.id)).size).toBe(2);
  });
});

describe('the Template sheet', () => {
  const withMeta = (): Sheet[] => [
    ...grid({ Section: 'A', Question: 'Ask' }),
    { name: 'Template', rows: [['Field', 'Value'], ['Template name', 'Fleet tyres — RFP'], ['Score scale', '10']] },
  ];

  it('renames the template to match the file, and says it did', () => {
    const result = run(withMeta());
    expect(result.next.name).toBe('Fleet tyres — RFP');
    expect(result.next.scoreScale).toBe(10);
    expect(said(result)).toContain('renamed to match the file');
  });

  it('leaves the name alone when the file is only being added to the template', () => {
    const result = run(withMeta(), 'append');
    expect(result.next.name).toBe('Supplier qualification — RFI');
  });

  it('never reads the categories or the stages off a sheet', () => {
    const sheets: Sheet[] = [
      ...grid({ Section: 'A', Question: 'Ask' }),
      { name: 'Template', rows: [['Categories', 'Tyers'], ['Applies to', 'RFQ']] },
    ];
    const result = run(sheets, 'replace', named({ categories: ['IT Hardware'], appliesTo: ['RFI'] }));
    expect(result.next.categories).toEqual(['IT Hardware']);
    expect(result.next.appliesTo).toEqual(['RFI']);
  });
});

describe('what arrives is a draft', () => {
  it('lands a brand new template in draft', () => {
    expect(run(grid({ Question: 'Ask' })).next.status).toBe('DRAFT');
  });

  it('puts a published template back to draft, because the upload rewrote what it asks', () => {
    const published = named({ status: 'PUBLISHED' });
    const result = run(grid({ Question: 'Ask' }), 'replace', published);
    expect(result.next.status).toBe('DRAFT');
    expect(said(result)).toContain('it goes back to draft');
  });

  it('does the same when the file is only being added to a published template', () => {
    const result = run(grid({ Question: 'Ask' }), 'append', named({ status: 'PUBLISHED' }));
    expect(result.next.status).toBe('DRAFT');
  });

  it('says nothing about status when the template was already a draft', () => {
    expect(said(run(grid({ Question: 'Ask' })))).not.toContain('back to draft');
  });
});

describe('an upload is saveable the moment it lands', () => {
  const FILE = 'tyres-rfp-questionnaire (2).xlsx';
  const unnamed = (): QuestionnaireTemplate => ({ ...BLANK(), name: '', code: '' });

  const withFile = (sheets: Sheet[], template = unnamed()) =>
    importQuestionnaire(sheets, { template, mode: 'replace', fileName: FILE });

  it('names an unnamed template from the file, and says it did', () => {
    const result = withFile(grid({ Section: 'A', Question: 'Ask', Weight: '0' }));
    expect(result.next.name).toBe('Tyres rfp questionnaire');
    expect(said(result)).toContain('took the file’s name'.replace('’', "'"));
  });

  it('gives it a code too, the same one typing that name would have', () => {
    expect(withFile(grid({ Question: 'Ask' })).next.code).toBe('QT-RFI-TYRES-RFP');
  });

  it('leaves a name the file supplied alone', () => {
    const sheets: Sheet[] = [
      ...grid({ Question: 'Ask' }),
      { name: 'Template', rows: [['Template name', 'Fleet tyres — RFP']] },
    ];
    expect(withFile(sheets).next.name).toBe('Fleet tyres — RFP');
  });

  it('leaves a name the template already had alone', () => {
    expect(withFile(grid({ Question: 'Ask' }), named()).next.name)
      .toBe('Supplier qualification — RFI');
  });

  it('moves off RFI when the file brings commercial questions, and says why', () => {
    const result = withFile(grid(
      { Section: 'Commercial', Question: 'What payment terms?', 'Response Type': 'Payment terms', Choices: 'Net 30 = 10 | Net 60 = 5' },
    ));
    expect(result.next.appliesTo).toEqual(['RFP']);
    expect(said(result)).toContain('moved from RFI to RFP');
    expect(validateTemplate(result.next).errors.map((e) => e.code))
      .not.toContain('COMMERCIAL_AT_RFI');
  });

  it('does not touch the journey when the buyer has already chosen one', () => {
    const chosen = named({ appliesTo: ['RFI', 'RFQ'], name: '' });
    expect(withFile(grid({ Question: 'Prices', 'Response Type': 'Price schedule' }), chosen)
      .next.appliesTo).toEqual(['RFI', 'RFQ']);
  });

  it('does not touch the journey when the file is only being added', () => {
    const result = importQuestionnaire(
      grid({ Question: 'What payment terms?', 'Response Type': 'Payment terms' }),
      { template: named(), mode: 'append', fileName: FILE },
    );
    expect(result.next.appliesTo).toEqual(['RFI']);
  });

  it('comes out of our own workbook with nothing left blocking Save', async () => {
    const result = importQuestionnaire(await readXlsx(importWorkbook()), {
      template: unnamed(), mode: 'replace', fileName: 'category-questionnaire.xlsx',
    });
    expect(validateTemplate(result.next).errors).toEqual([]);
  });
});

describe('naming from a file', () => {
  it('drops the extension, the download suffix and the separators', () => {
    expect(nameFromFile('rfp_tyres-2026 (3).xlsx')).toBe('Rfp tyres 2026');
  });

  it('gives nothing back for a file with no name to give', () => {
    expect(nameFromFile('.csv')).toBe('');
    expect(nameFromFile('')).toBe('');
  });
});
