/**
 * Asking per vendor and asking per line.
 *
 * The distinction exists because buyers were already making it, informally:
 * a question that genuinely differs item by item got asked once and answered
 * with an attached spreadsheet, which is the same information stripped of
 * everything that makes it comparable. What is pinned here is that the
 * difference survives the whole round trip — it is declared on the template,
 * expanded into one box per line when the supplier is asked, recorded against
 * the line it belongs to, and read back line by line.
 */
import { describe, expect, it } from 'vitest';
import {
  QUESTION_SCOPES, canAskPerLine, scopeCounts, validateTemplate,
} from '../questionnaireTemplates';
import {
  answerKey, answersByLine, askedCells, draftFromResponse, missingRequired, splitAnswerKey,
  toAnswers, type AnswerDraft,
} from '../vendorPortal';
import type {
  LineItem, Question, QuestionnaireTemplate, Response, TemplateQuestion,
} from '../types';

function line(id: string, itemCode: string): LineItem {
  return {
    id, lotId: 'lot-1', lineNumber: 1, itemCode, description: `${itemCode} thing`,
    specification: '', quantity: 10, uom: 'each', deliveryLocation: 'Dubai DC',
    deliveryDate: null, incoterm: null, taxClass: null, baselinePrice: 100,
    baselineSource: 'PR', currency: 'INR', isOptional: false, allowAlternate: false,
    category: 'Indirect', superCategory: null, sourcePrLineId: null,
  };
}

function question(over: Partial<Question> & { id: string }): Question {
  return {
    questionnaireId: 'qn', sectionId: null, sequence: 1, code: 'C', type: 'short_text',
    title: 'A question', helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 10,
    scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR', config: {},
    ...over,
  };
}

function templateQuestion(over: Partial<TemplateQuestion> & { id: string }): TemplateQuestion {
  return {
    templateId: 't1', sectionId: null, sequence: 1, code: 'C', type: 'short_text',
    title: 'A question', helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 0,
    scoringMethod: 'NONE', maxScore: 0, rubric: null, isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR', config: {},
    ...over,
  };
}

function template(questions: TemplateQuestion[]): QuestionnaireTemplate {
  return {
    id: 't1', code: 'QT-T', name: 'A template', description: '', appliesTo: ['RFP'],
    categories: [], sections: [], questions, scoreScale: 100, status: 'DRAFT', version: 1,
    scopeType: 'TENANT', scopeId: 'tenant', createdBy: 'u', createdAt: 0,
  };
}

const LINES = [line('l1', 'LAP-005'), line('l2', 'MON-012'), line('l3', 'NET-043')];

describe('which questions can be asked per line', () => {
  it('offers both scopes, each with a reason a buyer can act on', () => {
    expect(QUESTION_SCOPES.map((s) => s.id)).toEqual(['VENDOR', 'LINE']);
    for (const scope of QUESTION_SCOPES) expect(scope.purpose.length).toBeGreaterThan(20);
  });

  it('refuses per line for a type that already spans the basket', () => {
    expect(canAskPerLine('price_schedule')).toBe(false);
    expect(canAskPerLine('rate_table')).toBe(false);
  });

  it('refuses per line for a type that asks nothing', () => {
    expect(canAskPerLine('section')).toBe(false);
    expect(canAskPerLine('instruction_block')).toBe(false);
  });

  it('allows it for the ordinary answer types', () => {
    for (const type of ['short_text', 'number', 'lead_time', 'yes_no', 'file_upload'] as const) {
      expect(canAskPerLine(type)).toBe(true);
    }
  });

  it('counts the split without counting the headings', () => {
    expect(scopeCounts([
      templateQuestion({ id: 'a' }),
      templateQuestion({ id: 'b', askedPer: 'LINE' }),
      templateQuestion({ id: 'c', type: 'section', askedPer: 'VENDOR' }),
    ])).toEqual({ vendor: 1, line: 1 });
  });
});

describe('what the library refuses to author', () => {
  it('rejects a price schedule asked per line', () => {
    const result = validateTemplate(template([
      templateQuestion({ id: 'a', type: 'price_schedule', askedPer: 'LINE' }),
    ]));
    expect(result.errors.some((e) => e.code === 'LINE_SCOPE_NOT_POSSIBLE')).toBe(true);
  });

  it('rejects a knockout asked per line, and says what to do instead', () => {
    // A knockout removes the supplier from the event. One failing line cannot
    // justify that; not awarding them the line can.
    const result = validateTemplate(template([
      templateQuestion({ id: 'a', askedPer: 'LINE', isKnockout: true }),
    ]));
    const issue = result.errors.find((e) => e.code === 'LINE_KNOCKOUT');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('ask it per vendor');
  });

  it('accepts an ordinary question asked per line', () => {
    const result = validateTemplate(template([
      templateQuestion({ id: 'a', type: 'lead_time', askedPer: 'LINE' }),
    ]));
    expect(result.errors.filter((e) => e.questionId === 'a')).toEqual([]);
  });
});

describe('expanding a question set against a basket', () => {
  const questions = [
    question({ id: 'company', code: 'CO', title: 'Years trading' }),
    question({ id: 'lead', code: 'LT', title: 'Lead time', askedPer: 'LINE' }),
  ];

  it('gives a vendor question one box and a line question one box per line', () => {
    const cells = askedCells(questions, LINES);
    expect(cells).toHaveLength(4);
    expect(cells.filter((c) => c.question.id === 'lead').map((c) => c.lineItemId))
      .toEqual(['l1', 'l2', 'l3']);
  });

  it('names each line so the supplier knows which item they are answering for', () => {
    const cells = askedCells(questions, LINES);
    expect(cells[1].lineLabel).toBe('LAP-005 · LAP-005 thing');
    expect(cells[0].lineLabel).toBeNull();
  });

  it('keeps a line question answerable on an ask with no basket yet', () => {
    // Dropping it would lose the question from the response silently.
    const cells = askedCells(questions, []);
    expect(cells).toHaveLength(2);
    expect(cells[1].lineItemId).toBeNull();
  });

  it('still leaves out the questions that ask nothing', () => {
    const cells = askedCells([question({ id: 'heading', type: 'section' })], LINES);
    expect(cells).toEqual([]);
  });
});

describe('a required line question is required for every line', () => {
  const questions = [question({ id: 'lead', askedPer: 'LINE' })];
  const cells = askedCells(questions, LINES);

  it('counts the lines still unanswered, not the question', () => {
    const draft: AnswerDraft = {
      [answerKey('lead', 'l1')]: { value: 5, attachmentName: null },
      [answerKey('lead', 'l2')]: { value: 7, attachmentName: null },
    };
    const missing = missingRequired(cells, draft);
    expect(missing).toHaveLength(1);
    expect(missing[0].lineItemId).toBe('l3');
  });

  it('passes once every line has an answer', () => {
    const draft: AnswerDraft = Object.fromEntries(
      cells.map((c) => [c.key, { value: 5, attachmentName: null }]),
    );
    expect(missingRequired(cells, draft)).toEqual([]);
  });
});

describe('the answer carries the line it is about', () => {
  const questions = [
    question({ id: 'company' }),
    question({ id: 'lead', askedPer: 'LINE' }),
  ];
  const cells = askedCells(questions, LINES);
  const draft: AnswerDraft = {
    company: { value: '12', attachmentName: null },
    [answerKey('lead', 'l1')]: { value: 5, attachmentName: null },
    [answerKey('lead', 'l3')]: { value: 9, attachmentName: null },
  };

  it('records a line answer against its line and a vendor answer against none', () => {
    const answers = toAnswers(cells, draft);
    expect(answers).toEqual([
      { questionId: 'company', value: '12', attachmentName: null, lineItemId: null },
      { questionId: 'lead', value: 5, attachmentName: null, lineItemId: 'l1' },
      { questionId: 'lead', value: 9, attachmentName: null, lineItemId: 'l3' },
    ]);
  });

  it('reopens a submission with every line answer back in its own box', () => {
    const response = {
      id: 'r', eventId: 'e', bidderId: 'b', version: 1, submittedAt: 1,
      answers: toAnswers(cells, draft), priceLines: [],
    } as Response;
    expect(draftFromResponse(response)).toEqual(draft);
  });

  it('reads an old answer with no line as a vendor answer rather than a lost one', () => {
    const legacy = {
      id: 'r', eventId: 'e', bidderId: 'b', version: 1, submittedAt: 1,
      answers: [{ questionId: 'company', value: '9', attachmentName: null }], priceLines: [],
    } as Response;
    expect(draftFromResponse(legacy)).toEqual({ company: { value: '9', attachmentName: null } });
  });

  it('serves both kinds of answer through one accessor, keyed by line', () => {
    const byLine = answersByLine(toAnswers(cells, draft), 'lead');
    expect([...byLine.keys()]).toEqual(['l1', 'l3']);
    expect(answersByLine(toAnswers(cells, draft), 'company').get(null)?.value).toBe('12');
  });

  it('round-trips a key without losing an id that contains a dash', () => {
    expect(splitAnswerKey(answerKey('q-1', 'line-7'))).toEqual({
      questionId: 'q-1', lineItemId: 'line-7',
    });
    expect(splitAnswerKey('q-1')).toEqual({ questionId: 'q-1', lineItemId: null });
  });
});
