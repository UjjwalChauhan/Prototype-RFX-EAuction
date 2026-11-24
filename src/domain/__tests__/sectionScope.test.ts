/**
 * Sections: shares that total 100, and the grain their questions run at.
 *
 * Two rules that look like housekeeping and are not. A template whose
 * sections read 35 / 35 / 10 was being normalised at scoring time, so the
 * buyer who wrote it believed capability was worth 35% when it was worth
 * 43.75% — the arithmetic was right and the number on the screen was a
 * different number from the one doing the work. And scope on the section
 * rather than the question is what lets a supplier meet "about your company"
 * and "about each item" as two coherent blocks instead of a list that
 * switches grain row by row.
 */
import { describe, expect, it } from 'vitest';
import {
  effectiveScope, isScoredTemplate, sectionWeightTotal, setSectionScope, validateTemplate,
} from '../questionnaireTemplates';
import { supplierGroups } from '../vendorPortal';
import type {
  LineItem, Question, QuestionnaireTemplate, TemplateQuestion, TemplateSection,
} from '../types';

function section(over: Partial<TemplateSection> & { id: string }): TemplateSection {
  return { name: `Section ${over.id}`, sequence: 1, weight: 0, askedPer: 'VENDOR', ...over };
}

function templateQuestion(over: Partial<TemplateQuestion> & { id: string }): TemplateQuestion {
  return {
    templateId: 't1', sectionId: null, sequence: 1, code: over.id.toUpperCase(),
    type: 'short_text', title: `Q ${over.id}`, helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 0, scoringMethod: 'NONE', maxScore: 0, rubric: null,
    isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', config: {},
    ...over,
  };
}

function template(
  sections: TemplateSection[], questions: TemplateQuestion[] = [],
): QuestionnaireTemplate {
  return {
    id: 't1', code: 'QT-T', name: 'A template', description: '', appliesTo: ['RFP'],
    categories: [], sections, questions, scoreScale: 100, status: 'DRAFT', version: 1,
    scopeType: 'TENANT', scopeId: 'tenant', createdBy: 'u', createdAt: 0,
  };
}

const codes = (t: QuestionnaireTemplate) => validateTemplate(t).errors.map((e) => e.code);

describe('sections are shares of one score', () => {
  it('adds up what the sections declare', () => {
    expect(sectionWeightTotal(template([section({ id: 'a', weight: 30 }), section({ id: 'b', weight: 70 })])))
      .toBe(100);
  });

  it('accepts a template whose sections total exactly 100', () => {
    const t = template([section({ id: 'a', weight: 40 }), section({ id: 'b', weight: 60 })]);
    expect(codes(t)).not.toContain('SECTION_WEIGHTS_NOT_100');
  });

  it('refuses one that leaves score unaccounted for, and says how much', () => {
    const t = template([section({ id: 'a', weight: 35 }), section({ id: 'b', weight: 35 })]);
    const issue = validateTemplate(t).errors.find((e) => e.code === 'SECTION_WEIGHTS_NOT_100')!;
    expect(issue.message).toContain('70%');
    expect(issue.message).toContain('30% of the technical score is unaccounted for');
  });

  it('refuses one that gives away more score than exists', () => {
    const t = template([section({ id: 'a', weight: 80 }), section({ id: 'b', weight: 40 })]);
    const issue = validateTemplate(t).errors.find((e) => e.code === 'SECTION_WEIGHTS_NOT_100')!;
    expect(issue.message).toContain('20% more score than there is to give');
  });

  it('leaves a gathering-only template alone', () => {
    // A pure RFI scores nothing. Demanding 100 from sections that are all
    // zero would refuse a questionnaire that is complete as it stands.
    const t = template([section({ id: 'a' }), section({ id: 'b' })]);
    expect(isScoredTemplate(t)).toBe(false);
    expect(codes(t)).not.toContain('SECTION_WEIGHTS_NOT_100');
  });
});

describe('the section owns the grain', () => {
  const sections = [
    section({ id: 'about-you', weight: 60, askedPer: 'VENDOR' }),
    section({ id: 'per-item', weight: 40, askedPer: 'LINE' }),
  ];

  it('a question runs at its section s scope, not its own', () => {
    const question = templateQuestion({ id: 'q1', sectionId: 'per-item', askedPer: 'VENDOR' });
    expect(effectiveScope(question, sections)).toBe('LINE');
  });

  it('a question in no section answers for itself', () => {
    const question = templateQuestion({ id: 'q1', sectionId: null, askedPer: 'LINE' });
    expect(effectiveScope(question, sections)).toBe('LINE');
  });

  it('a type that spans the basket stays per vendor inside a per-line section', () => {
    const question = templateQuestion({ id: 'q1', sectionId: 'per-item', type: 'price_schedule' });
    expect(effectiveScope(question, sections)).toBe('VENDOR');
  });

  it('moving a section takes its questions with it', () => {
    const t = template(sections, [
      templateQuestion({ id: 'q1', sectionId: 'about-you' }),
      templateQuestion({ id: 'q2', sectionId: 'about-you' }),
      templateQuestion({ id: 'q3', sectionId: 'per-item' }),
    ]);
    const next = setSectionScope(t, 'about-you', 'LINE');
    expect(next.questions.filter((q) => q.askedPer === 'LINE').map((q) => q.id))
      .toEqual(['q1', 'q2']);
    expect(next.sections.find((s) => s.id === 'about-you')!.askedPer).toBe('LINE');
  });

  it('leaves behind the questions that cannot be repeated per line', () => {
    // Dragging a price schedule into an invalid state would make the control
    // feel broken over a question that was never going to repeat anyway.
    const t = template(sections, [
      templateQuestion({ id: 'q1', sectionId: 'about-you' }),
      templateQuestion({ id: 'q2', sectionId: 'about-you', type: 'price_schedule' }),
    ]);
    const next = setSectionScope(t, 'about-you', 'LINE');
    expect(next.questions.find((q) => q.id === 'q2')!.askedPer).toBe('VENDOR');
  });
});

describe('what the supplier is handed', () => {
  function line(id: string, itemCode: string): LineItem {
    return {
      id, lotId: 'lot', lineNumber: 1, itemCode, description: `${itemCode} thing`,
      specification: '', quantity: 1, uom: 'each', deliveryLocation: '', deliveryDate: null,
      incoterm: null, taxClass: null, baselinePrice: null, baselineSource: null,
      currency: 'INR', isOptional: false, allowAlternate: false, category: '',
      superCategory: null, sourcePrLineId: null,
    };
  }
  function question(over: Partial<Question> & { id: string }): Question {
    return {
      questionnaireId: 'qn', sectionId: null, sequence: 1, code: 'C', type: 'short_text',
      title: `Q ${over.id}`, helpText: '', isRequired: true, envelope: 'TECHNICAL',
      weight: 0, scoringMethod: 'NONE', maxScore: 0, rubric: null, isKnockout: false,
      allowAttachment: false, askedPer: 'VENDOR', config: {}, ...over,
    };
  }
  const sections = [
    section({ id: 's1', name: 'About your company', sequence: 1, askedPer: 'VENDOR' }),
    section({ id: 's2', name: 'About each item', sequence: 2, askedPer: 'LINE' }),
  ];
  const questions = [
    question({ id: 'q1', sectionId: 's1', sequence: 1 }),
    question({ id: 'q2', sectionId: 's2', sequence: 2, askedPer: 'LINE' }),
  ];
  const lines = [line('l1', 'LAP-005'), line('l2', 'MON-012'), line('l3', 'NET-043')];

  it('groups the form by section, in section order', () => {
    const groups = supplierGroups(questions, sections, lines);
    expect(groups.map((g) => g.name)).toEqual(['About your company', 'About each item']);
  });

  it('expands a per-line section once per line, and the other once', () => {
    const groups = supplierGroups(questions, sections, lines);
    expect(groups[0].cells).toHaveLength(1);
    expect(groups[1].cells).toHaveLength(3);
    expect(groups[1].askedPer).toBe('LINE');
  });

  it('still asks a question whose section the questionnaire did not carry', () => {
    // Dropping it silently would lose it from the response with nobody told.
    const groups = supplierGroups(questions, [sections[0]], lines);
    expect(groups.map((g) => g.name)).toEqual(['About your company', null]);
    expect(groups[1].questions.map((q) => q.id)).toEqual(['q2']);
  });

  it('leaves out the questions that ask nothing', () => {
    const groups = supplierGroups(
      [question({ id: 'heading', sectionId: 's1', type: 'section' })], sections, lines,
    );
    expect(groups).toEqual([]);
  });
});
