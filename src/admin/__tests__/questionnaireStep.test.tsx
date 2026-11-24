/**
 * The Questionnaire step of Create Event — that the template reaches the page.
 *
 * The domain tests prove the editing rules. These prove a buyer opening the
 * step actually sees the template's questions, their weights, and the reason a
 * question is not carrying one — first-paint facts, so server rendering is
 * enough.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, type AppState } from '../../store/store';
import { BulkTagBar, INITIAL_DRAFT, QuestionnaireStep, type Draft } from '../CreateEventWizard';
import {
  instantiateTemplate, seedQuestionnaires, setDraftScored,
} from '../../domain/questionnaireTemplates';
import { setAudienceOnAll, type AudienceRoster } from '../../domain/questionAudience';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type { QuestionnaireTemplate, VendorInputPoint } from '../../domain/types';

const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

function paint(
  draft: Draft,
  points: VendorInputPoint[] = ['RFI'],
  categories: string[] = [],
  seed?: Partial<AppState>,
): string {
  return renderToString(
    <StoreProvider seed={seed}>
      <QuestionnaireStep
        draft={draft}
        patch={() => {}}
        points={points}
        categories={categories}
      />
    </StoreProvider>,
  )
    // React splits interpolated text with comment markers, and escapes
    // ampersands inside attribute values. Neither is what a reader sees.
    .replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'");
}

/** A draft already seeded at the given points, as the step itself would seed it. */
function seededDraft(points: VendorInputPoint[]): Draft {
  return {
    ...INITIAL_DRAFT,
    questionnaires: seedQuestionnaires({
      existing: [], points, library: TENANT_TEMPLATES, categories: [null], idSeed: 'test',
    }),
  };
}

describe('the template populates the page', () => {
  it('renders every question the template defines', () => {
    const html = paint(seededDraft(['RFI']));
    for (const question of RFI.questions) {
      expect(html).toContain(question.title);
    }
  });

  it('renders the template sections', () => {
    const html = paint(seededDraft(['RFI']));
    for (const section of RFI.sections) {
      expect(html).toContain(section.name);
    }
  });

  it('seeds from the library even before any effect runs', () => {
    // The step computes its questionnaire during render, so the first paint is
    // already populated rather than briefly empty.
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [] });
    expect(html).toContain(RFI.questions[0].title);
  });

  it('counts the questions and the scored subset', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain(`${RFI.questions.length} questions`);
    expect(html).toContain('scored');
  });
});

describe('weight is shown, and optional', () => {
  it('shows a normalised share for a weighted question', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toMatch(/\d+\.\d%/);
  });

  it('says a question is not weighted rather than showing a silent zero', () => {
    const draft = seededDraft(['RFI']);
    const questionnaire = draft.questionnaires[0];
    const html = paint({
      ...draft,
      questionnaires: [setDraftScored(questionnaire, questionnaire.questions[0].id, false)],
    });
    expect(html).toContain('Not weighted');
  });

  it('reports a questionnaire that scores nothing as gathering only', () => {
    let questionnaire = instantiateTemplate(RFI, 'RFI', 'test');
    for (const question of questionnaire.questions) {
      questionnaire = setDraftScored(questionnaire, question.id, false);
    }
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [questionnaire] });
    expect(html).toContain('gathers information only');
  });
});

describe('RFI best practice reaches the buyer', () => {
  it('states what the point is for', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain('before anyone is asked for a price');
  });

  it('surfaces a commercial question set at RFI', () => {
    const questionnaire = instantiateTemplate(RFI, 'RFI', 'test');
    const html = paint({
      ...INITIAL_DRAFT,
      questionnaires: [{
        ...questionnaire,
        questions: questionnaire.questions.map((q, i) =>
          i === 0 ? { ...q, envelope: 'COMMERCIAL' as const } : q,
        ),
      }],
    });
    expect(html).toContain('RFI qualifies the market');
  });

  it('offers a point selector only when the journey asks more than once', () => {
    expect(paint(seededDraft(['RFI']), ['RFI'])).not.toContain('Asked at');
    expect(paint(seededDraft(['RFI', 'RFP']), ['RFI', 'RFP'])).toContain('Asked at');
  });

  it('says the auction takes no questionnaire', () => {
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [] }, []);
    expect(html).toContain('takes a live bid');
  });
});

/**
 * The two grains, which is how the page is now organised.
 *
 * A buyer reads a questionnaire as two things — what we ask the company and
 * what we ask about each item — because that is how the answers come back and
 * how they are compared. The step has to make that division the first thing
 * on the page, not something recoverable by reading a section list.
 */
describe('supplier and line-item questions are separated', () => {
  const RFP = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFP-TECHNICAL') as QuestionnaireTemplate;

  /** The RFP template is the one with a real per-line section in it. */
  const rfpDraft = (): Draft => ({
    ...INITIAL_DRAFT,
    lines: [
      { id: 'l1', itemCode: 'PAP-001', description: 'A4 paper' },
      { id: 'l2', itemCode: 'PEN-004', description: 'Ballpoint pen' },
      { id: 'l3', itemCode: 'STA-009', description: 'Stapler' },
    ] as unknown as Draft['lines'],
    questionnaires: [instantiateTemplate(RFP, 'RFP', 'test')],
  });

  const html = paint(rfpDraft(), ['RFP']);

  it('gives each grain its own card', () => {
    expect(html).toContain('About the supplier');
    expect(html).toContain('Per line item');
  });

  it('says how often each grain is asked', () => {
    expect(html).toContain('Asked once per supplier');
    expect(html).toContain('Asked for each of the 3 lines');
  });

  it('counts the two grains in the header rather than only the total', () => {
    expect(html).toMatch(/\d+ about the supplier, \d+ per line item/);
  });

  it('multiplies the per-line questions by the basket, which is what a supplier owes', () => {
    expect(html).toMatch(/× 3 lines = \d+ answers/);
  });

  it('tallies the weight of each grain against what its sections declared', () => {
    expect(html).toContain('Supplier-level weight:');
    expect(html).toContain('Line-level weight:');
  });

  it('offers an add button worded for the grain it sits under', () => {
    expect(html).toContain('Add supplier question');
    expect(html).toContain('Add line-item question');
  });

  it('keeps the section weights editable inside the grain they belong to', () => {
    expect(html).toContain('aria-label="Section weight — Method & delivery"');
    expect(html).toContain('aria-label="Section weight — Per item commitments"');
  });

  it('shows how the technical score splits before the rows that make it up', () => {
    expect(html).toContain('How suppliers are scored');
    expect(html).toContain('Asked once per supplier ·');
    expect(html).toContain('Asked per line item ·');
  });

  it('says where the award split is really set, rather than implying it is set here', () => {
    expect(html).toContain("set on the event's evaluation tab");
  });
});

describe('the rule or weight a question carries', () => {
  const html = paint(seededDraft(['RFI']));

  it('says what a knockout actually tests, not just that it is one', () => {
    expect(html).toContain('Knockout · valid on bid date');
  });

  it('counts the knockouts in the summary, and says they carry no weight', () => {
    expect(html).toMatch(/Knockouts · \d+/);
    expect(html).toContain('They carry no weight');
  });

  it('shows a question code, which is what carries an answer between stages', () => {
    expect(html).toContain('CO.ISO9001');
  });
});

describe('stage chips', () => {
  it('say what each point does rather than only how many rows it holds', () => {
    const html = paint(seededDraft(['RFI', 'RFP']), ['RFI', 'RFP']);
    expect(html).toMatch(/RFI · \d+/);
    expect(html).toMatch(/technical|knockout/);
  });

  it('are not drawn at all when the journey asks once', () => {
    expect(paint(seededDraft(['RFI']), ['RFI'])).not.toContain('each point gets its own');
  });
});

/**
 * Who a question is put to.
 *
 * The page's job here is to keep the default invisible and the exception
 * obvious. Every question on a new event goes to everybody, so a column that
 * announced that on every row would bury the two rows that were narrowed.
 */
describe('who each question is asked of', () => {
  /** The three suppliers and two lines a blank draft already carries. */
  const roster: AudienceRoster = { vendorIds: ['cp-abc', 'cp-prime', 'cp-global'], lineIds: ['dl-1', 'dl-2'] };

  /** A seeded draft with one question narrowed to the suppliers given. */
  function narrowedDraft(vendorIds: string[] | null): { draft: Draft; code: string } {
    const base = seededDraft(['RFI']);
    const questionnaire = base.questionnaires[0];
    const target = questionnaire.questions[0];
    return {
      code: target.code,
      draft: {
        ...base,
        questionnaires: [setAudienceOnAll(questionnaire, [target.id], { vendorIds }, roster)],
      },
    };
  }

  it('says "Everyone" rather than repeating the roster down every row', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain('Asked of');
    expect(html).toContain('Everyone');
    expect(html).not.toContain('asked of only some suppliers or lines');
  });

  it('shows the narrowing as a count against the roster', () => {
    const html = paint(narrowedDraft(['cp-abc']).draft);
    expect(html).toContain('1/3 suppliers');
  });

  it('says in the card heading how many were narrowed, and only then', () => {
    const html = paint(narrowedDraft(['cp-abc']).draft);
    expect(html).toContain('1 asked of only some suppliers or lines');
  });

  it('puts a narrowing that reaches nobody on the row it belongs to', () => {
    const html = paint(narrowedDraft([]).draft);
    expect(html).toContain('No supplier');
    expect(html).toContain('Asked of no supplier');
  });

  it('warns that a scored question not asked of everyone is not like for like', () => {
    const html = paint(narrowedDraft(['cp-abc']).draft);
    expect(html).toContain('2 of the 3 suppliers are not asked it');
  });

  it('offers a tick box on every row, and one that takes the whole grain', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain('aria-label="Select CO.ISO9001"');
    expect(html).toContain('aria-label="Select every question in About the supplier"');
  });
});

describe('tagging several questions together', () => {
  const bar = (scope: 'VENDOR' | 'LINE', count: number) => renderToString(
    <BulkTagBar
      count={count}
      scope={scope}
      onPickVendors={() => {}}
      onPickLines={() => {}}
      onEveryone={() => {}}
      onClear={() => {}}
    />,
  ).replace(/<!-- -->/g, '');

  it('says how many are selected, in the plural the count calls for', () => {
    expect(bar('VENDOR', 1)).toContain('1 question selected');
    expect(bar('VENDOR', 4)).toContain('4 questions selected');
  });

  it('offers suppliers at both grains and lines only where lines exist', () => {
    expect(bar('VENDOR', 2)).toContain('Ask of suppliers');
    expect(bar('VENDOR', 2)).not.toContain('Ask about lines');
    expect(bar('LINE', 2)).toContain('Ask about lines');
  });

  it('offers the way back to the default, not only the way into a narrowing', () => {
    expect(bar('VENDOR', 2)).toContain('Ask everyone');
  });
});

/**
 * A template written for one category, reaching the event that buys in it.
 *
 * This is the whole point of a category library and the easiest thing to get
 * silently wrong: the template is authored in one screen and read in another,
 * and nothing fails loudly if the two disagree about what a category is
 * called. So the test goes the whole way — author at category scope, put
 * lines of that category in the basket, and look for the questions on the
 * page.
 */
describe('a category library reaches the event that buys in that category', () => {
  const SOFTWARE: QuestionnaireTemplate = {
    id: 'qt-itsw', code: 'QT-ITSW-RFI', name: 'IT software — qualification',
    description: '', appliesTo: ['RFI'], categories: ['IT Software'],
    sections: [
      { id: 'itsw-s1', name: 'Vendor credentials', sequence: 1, weight: 60, askedPer: 'VENDOR' },
      { id: 'itsw-s2', name: 'Per licence terms', sequence: 2, weight: 40, askedPer: 'LINE' },
    ],
    questions: [
      {
        id: 'itsw-q1', templateId: 'qt-itsw', sectionId: 'itsw-s1', sequence: 1,
        code: 'SW.SOC2', type: 'short_text', title: 'SOC 2 Type II report date',
        helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 60,
        scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
        allowAttachment: false, askedPer: 'VENDOR', config: {},
      },
      {
        id: 'itsw-q2', templateId: 'qt-itsw', sectionId: 'itsw-s2', sequence: 2,
        code: 'SW.SEATS', type: 'number', title: 'Minimum seat commitment',
        helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 40,
        scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
        allowAttachment: false, askedPer: 'LINE', config: {},
      },
    ],
    scoreScale: 100, status: 'DRAFT', version: 1,
    scopeType: 'CATEGORY', scopeId: 'IT Software', createdBy: 'u-1', createdAt: 1,
  };

  /** The library as the Configuration Studio would have written it. */
  const seed: Partial<AppState> = {
    configSettings: [{
      key: 'questionnaire.templates', scopeType: 'CATEGORY', scopeId: 'IT Software',
      value: [SOFTWARE], isLocked: false, setBy: 'u-1', setAt: 1,
    }],
  };

  /** A basket of software lines, as an IT Software requisition would raise. */
  const softwareDraft = (): Draft => ({
    ...INITIAL_DRAFT,
    category: 'IT Software',
    questionnaires: [],
    lines: [
      {
        id: 'dl-sw1', itemCode: 'CRM-010', description: 'CRM, sales cloud, enterprise',
        specification: '', quantity: 250, uom: 'user / year', deliveryLocation: 'Bengaluru',
        needBy: '', baselinePrice: 9100, lotName: 'Lot 1 · Software',
        category: 'IT Software', superCategory: 'Indirect',
      },
    ],
  });

  const html = paint(softwareDraft(), ['RFI'], ['IT Software'], seed);

  it('offers the category template on the event', () => {
    expect(html).toContain('IT software — qualification');
  });

  it('seeds its questions onto the page without the buyer choosing anything', () => {
    expect(html).toContain('SOC 2 Type II report date');
    expect(html).toContain('Minimum seat commitment');
  });

  it('files each question under the grain its section was written at', () => {
    const supplier = html.indexOf('About the supplier');
    const perLine = html.indexOf('Per line item');
    const soc2 = html.indexOf('SOC 2 Type II report date');
    const seats = html.indexOf('Minimum seat commitment');
    expect(supplier).toBeGreaterThan(-1);
    expect(perLine).toBeGreaterThan(supplier);
    // The supplier question sits in the first card, the per-line one below it.
    expect(soc2).toBeGreaterThan(supplier);
    expect(soc2).toBeLessThan(perLine);
    expect(seats).toBeGreaterThan(perLine);
  });

  it('carries both section names, each inside its own grain', () => {
    expect(html).toContain('Vendor credentials');
    expect(html).toContain('Per licence terms');
  });

  it('is not offered to an event buying something else', () => {
    const elsewhere = paint(seededDraft(['RFI']), ['RFI'], ['Indirect'], seed);
    expect(elsewhere).not.toContain('IT software — qualification');
  });
});

describe('the library is reachable from the event', () => {
  const html = paint(seededDraft(['RFI']));

  it('offers the same spreadsheet upload the Questionnaire Library offers', () => {
    expect(html).toContain('Upload Excel / CSV');
  });

  it('offers a way back into the library, so a good question set is not lost', () => {
    expect(html).toContain('Save to library');
  });
});
