/**
 * Section weighting: the budget, and the score that comes out of it.
 *
 * A section's weight is a **ceiling on what its questions may carry**, not a
 * claim about what they do carry. That distinction is the whole design, and
 * everything here follows from it:
 *
 * - over budget is an error, because the section would award more than it is
 *   worth;
 * - under budget is a warning, because the questions still score — the section
 *   simply turns out to be worth less than the buyer set aside;
 * - and **scoring runs off the questions**, so under-allocation costs the
 *   supplier nothing. Holding the section to its declared figure would make
 *   the unallocated part unearnable and mark every supplier down for the
 *   buyer's arithmetic.
 *
 * The scale is the other half. It is chosen when the questionnaire is written,
 * because a scale changed afterwards silently rewrites what every committed
 * score meant.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORE_SCALE, sectionBudgets, ungroupedScored, validateTemplate, weightCeilingFor,
} from '../questionnaireTemplates';
import { scoreBreakdown } from '../evaluation';
import { defaultConfigFor } from '../questionTypes';
import type {
  Question, QuestionnaireTemplate, Score, TemplateQuestion, TemplateSection,
} from '../types';

function question(over: Partial<TemplateQuestion> = {}): TemplateQuestion {
  const id = over.id ?? 'q1';
  return {
    id,
    templateId: 't1',
    sectionId: 's1',
    sequence: 1,
    code: id.toUpperCase(),
    type: 'short_text',
    title: `Question ${id}`,
    helpText: '',
    isRequired: true,
    envelope: 'TECHNICAL',
    weight: 10,
    scoringMethod: 'MANUAL',
    maxScore: 10,
    rubric: null,
    isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR',
    config: defaultConfigFor('short_text', id),
    ...over,
  };
}

const section = (id: string, weight: number, sequence = 1): TemplateSection =>
  ({ id, name: `Section ${id}`, sequence, weight, askedPer: 'VENDOR' });

function template(over: Partial<QuestionnaireTemplate> = {}): QuestionnaireTemplate {
  return {
    id: 't1', code: 'QT-RFI-X', name: 'A template', description: '',
    appliesTo: ['RFI'], categories: [],
    sections: [section('s1', 30)],
    questions: [question()],
    scoreScale: DEFAULT_SCORE_SCALE,
    status: 'PUBLISHED', version: 1, scopeType: 'TENANT', scopeId: 'tenant-udaan',
    createdBy: 'u1', createdAt: 0, ...over,
  };
}

const codes = (t: QuestionnaireTemplate) => ({
  errors: validateTemplate(t).errors.map((issue) => issue.code),
  warnings: validateTemplate(t).warnings.map((issue) => issue.code),
});

describe('what a section has spent', () => {
  it('reports the declared budget and what the questions carry', () => {
    const [budget] = sectionBudgets(template({
      sections: [section('s1', 30)],
      questions: [question({ id: 'a', weight: 10 }), question({ id: 'b', weight: 15 })],
    }));
    expect(budget.declared).toBe(30);
    expect(budget.allocated).toBe(25);
    expect(budget.remaining).toBe(5);
    expect(budget.overspent).toBe(false);
  });

  it('counts only the questions that actually score', () => {
    const [budget] = sectionBudgets(template({
      sections: [section('s1', 30)],
      questions: [
        question({ id: 'a', weight: 10 }),
        question({ id: 'b', weight: 20, scoringMethod: 'NONE' }),
      ],
    }));
    expect(budget.allocated).toBe(10);
    expect(budget.scored).toBe(1);
  });

  it('never counts a priced question, which cannot carry weight at all', () => {
    const [budget] = sectionBudgets(template({
      sections: [section('s1', 30)],
      questions: [question({ id: 'p', type: 'price_schedule', weight: 0, scoringMethod: 'NONE' })],
    }));
    expect(budget.allocated).toBe(0);
  });

  it('marks a section whose questions carry more than it is worth', () => {
    const [budget] = sectionBudgets(template({
      sections: [section('s1', 20)],
      questions: [question({ id: 'a', weight: 15 }), question({ id: 'b', weight: 15 })],
    }));
    expect(budget.overspent).toBe(true);
    expect(budget.remaining).toBe(-10);
  });

  it('reports every section, in the order they are shown', () => {
    const budgets = sectionBudgets(template({
      sections: [section('s2', 10, 2), section('s1', 20, 1)],
      questions: [],
    }));
    expect(budgets.map((b) => b.section.id)).toEqual(['s1', 's2']);
  });
});

describe('the ceiling one question may take', () => {
  const t = template({
    sections: [section('s1', 30)],
    questions: [question({ id: 'a', weight: 10 }), question({ id: 'b', weight: 15 })],
  });

  it('is what is unspent plus what this question already holds', () => {
    // 30 declared, 25 allocated, this question holds 10 — so it may go to 15.
    expect(weightCeilingFor(t, 'a')).toBe(15);
  });

  it('lets a question keep the weight it has when the section is exactly full', () => {
    const full = template({
      sections: [section('s1', 25)],
      questions: [question({ id: 'a', weight: 10 }), question({ id: 'b', weight: 15 })],
    });
    expect(weightCeilingFor(full, 'a')).toBe(10);
  });

  it('gives an unscored question only what is unspent', () => {
    const t2 = template({
      sections: [section('s1', 30)],
      questions: [
        question({ id: 'a', weight: 25 }),
        question({ id: 'b', weight: 0, scoringMethod: 'NONE' }),
      ],
    });
    expect(weightCeilingFor(t2, 'b')).toBe(5);
  });

  it('is null for a question in no section, where no budget applies', () => {
    const loose = template({ questions: [question({ id: 'a', sectionId: null })] });
    expect(weightCeilingFor(loose, 'a')).toBeNull();
  });

  it('never goes negative, even on a section already over budget', () => {
    const over = template({
      sections: [section('s1', 10)],
      questions: [question({ id: 'a', weight: 30 })],
    });
    expect(weightCeilingFor(over, 'a')).toBe(10);
  });
});

describe('what the library refuses', () => {
  it('refuses a section whose questions carry more than it is worth', () => {
    const t = template({
      sections: [section('s1', 20)],
      questions: [question({ id: 'a', weight: 25 })],
    });
    expect(codes(t).errors).toContain('SECTION_OVER_BUDGET');
    expect(validateTemplate(t).valid).toBe(false);
  });

  it('says by how much, so the buyer knows what to change', () => {
    const t = template({
      sections: [section('s1', 20)],
      questions: [question({ id: 'a', weight: 25 })],
    });
    const issue = validateTemplate(t).errors.find((e) => e.code === 'SECTION_OVER_BUDGET');
    expect(issue?.message).toContain('20');
    expect(issue?.message).toContain('25');
  });

  it('refuses a section that scores without having a budget to score from', () => {
    const t = template({ sections: [section('s1', 0)], questions: [question({ weight: 10 })] });
    expect(codes(t).errors).toContain('SECTION_SCORES_WITHOUT_WEIGHT');
  });

  it('accepts a section exactly on budget', () => {
    const t = template({
      sections: [section('s1', 25)],
      questions: [question({ id: 'a', weight: 10 }), question({ id: 'b', weight: 15 })],
    });
    expect(codes(t).errors).not.toContain('SECTION_OVER_BUDGET');
    expect(codes(t).warnings).not.toContain('SECTION_UNDER_BUDGET');
  });

  it('warns rather than refuses when a section is under budget', () => {
    // One section carrying the whole score, with only 10 of it allocated.
    const t = template({
      sections: [section('s1', 100)],
      questions: [question({ id: 'a', weight: 10 })],
    });
    expect(codes(t).errors).not.toContain('SECTION_OVER_BUDGET');
    expect(codes(t).warnings).toContain('SECTION_UNDER_BUDGET');
    expect(validateTemplate(t).valid).toBe(true);
  });

  it('says the unspent weight is unspent, not lost', () => {
    const t = template({
      sections: [section('s1', 40)],
      questions: [question({ id: 'a', weight: 10 })],
    });
    const issue = validateTemplate(t).warnings.find((w) => w.code === 'SECTION_UNDER_BUDGET');
    expect(issue?.message).toContain('unspent, not lost');
  });

  it('warns about a section carrying weight that nothing inside can earn', () => {
    const t = template({
      sections: [section('s1', 20)],
      questions: [question({ id: 'a', weight: 0, scoringMethod: 'NONE' })],
    });
    expect(codes(t).warnings).toContain('SECTION_WEIGHT_UNUSED');
  });

  it('warns about a scored question that sits outside every section', () => {
    const t = template({
      sections: [section('s1', 10)],
      questions: [question({ id: 'a', sectionId: null, weight: 10 })],
    });
    expect(codes(t).warnings).toContain('SCORED_OUTSIDE_SECTION');
    expect(ungroupedScored(t)).toHaveLength(1);
  });

  it('refuses a scale that is not a positive number', () => {
    expect(codes(template({ scoreScale: 0 })).errors).toContain('SCALE_INVALID');
    expect(codes(template({ scoreScale: -5 })).errors).toContain('SCALE_INVALID');
  });

  it('accepts the scales a buyer actually picks', () => {
    for (const scale of [5, 10, 100, 1000]) {
      expect(codes(template({ scoreScale: scale })).errors).not.toContain('SCALE_INVALID');
    }
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const asked = (over: Partial<Question>): Question => ({
  id: 'q', questionnaireId: 'qn', sectionId: 's1', sequence: 1, code: 'C',
  type: 'short_text', title: 'A question', helpText: '', isRequired: true,
  envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
  rubric: null, isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', ...over,
});

const scored = (questionId: string, value: number): Score => ({
  id: `sc-${questionId}`, eventId: 'e1', bidderId: 'b1', questionId, evaluatorId: 'u1',
  value, comment: '', method: 'MANUAL', agentConfidence: null, citedEvidence: null,
  overridesScoreId: null, overrideReason: null, createdAt: 1,
});

describe('the score a section earns', () => {
  const sections = [section('s1', 60, 1), section('s2', 40, 2)];
  const questions = [
    asked({ id: 'a', sectionId: 's1', weight: 40, maxScore: 10 }),
    asked({ id: 'b', sectionId: 's1', weight: 20, maxScore: 10 }),
    asked({ id: 'c', sectionId: 's2', weight: 40, maxScore: 10 }),
  ];

  it('reports each section on the questionnaire scale', () => {
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections,
      scores: [scored('a', 10), scored('b', 5), scored('c', 8)],
      scale: 100,
    });
    // s1: (40x1.0 + 20x0.5) / 60 = 0.833 -> 83.3
    expect(result.sections[0].score).toBeCloseTo(83.3, 1);
    expect(result.sections[1].score).toBeCloseTo(80, 1);
  });

  it('reports the same result on a scale of ten', () => {
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections,
      scores: [scored('a', 10), scored('b', 5), scored('c', 8)],
      scale: 10,
    });
    expect(result.sections[0].score).toBeCloseTo(8.33, 2);
    expect(result.overall).toBeCloseTo(8.2, 1);
  });

  it('weights the overall by the questions, not by the declared section weight', () => {
    // s1 allocated 60 of 60, s2 allocated 40 of 40 — overall is 0.833x0.6 + 0.8x0.4.
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections,
      scores: [scored('a', 10), scored('b', 5), scored('c', 8)],
      scale: 100,
    });
    expect(result.overall).toBeCloseTo(82, 1);
  });

  it('does not punish a supplier for a section the buyer under-allocated', () => {
    // s2 declares 40 but allocates 10. The supplier's full marks there are
    // full marks; the section simply counts for less.
    const thin = [section('s1', 60, 1), section('s2', 40, 2)];
    const result = scoreBreakdown({
      bidderId: 'b1',
      questions: [
        asked({ id: 'a', sectionId: 's1', weight: 60, maxScore: 10 }),
        asked({ id: 'c', sectionId: 's2', weight: 10, maxScore: 10 }),
      ],
      sections: thin,
      scores: [scored('a', 10), scored('c', 10)],
      scale: 100,
    });
    expect(result.overall).toBe(100);
    expect(result.sections[1].score).toBe(100);
    expect(result.sections[1].declaredWeight).toBe(40);
    expect(result.sections[1].allocatedWeight).toBe(10);
  });

  it('states each section’s share of the total, which is not its score', () => {
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections, scores: [scored('a', 10)], scale: 100,
    });
    expect(result.sections[0].sharePct).toBeCloseTo(60, 1);
    expect(result.sections[1].sharePct).toBeCloseTo(40, 1);
  });

  it('leaves an unscored section null rather than calling it zero', () => {
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections, scores: [scored('a', 10), scored('b', 10)], scale: 100,
    });
    expect(result.sections[1].score).toBeNull();
    expect(result.sections[0].score).toBe(100);
  });

  it('excludes an unscored question from the overall rather than counting it zero', () => {
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections, scores: [scored('a', 10)], scale: 100,
    });
    expect(result.overall).toBe(100);
    expect(result.scored).toBe(1);
    expect(result.total).toBe(3);
  });

  it('is null overall when nothing at all has been scored', () => {
    const result = scoreBreakdown({ bidderId: 'b1', questions, sections, scores: [], scale: 100 });
    expect(result.overall).toBeNull();
  });

  it('reports questions in no section together, so the parts add up', () => {
    const result = scoreBreakdown({
      bidderId: 'b1',
      questions: [...questions, asked({ id: 'd', sectionId: null, weight: 10, maxScore: 10 })],
      sections,
      scores: [scored('d', 10)],
      scale: 100,
    });
    const loose = result.sections.find((s) => s.sectionId === null);
    expect(loose?.name).toBe('Ungrouped questions');
    expect(loose?.score).toBe(100);
  });

  it('scores one bidder without reading another’s scores', () => {
    const other: Score = { ...scored('a', 2), id: 'sc-other', bidderId: 'b2' };
    const result = scoreBreakdown({
      bidderId: 'b1', questions, sections, scores: [scored('a', 10), other], scale: 100,
    });
    expect(result.sections[0].score).toBe(100);
  });

  it('carries the scale back so a screen cannot report it on a different one', () => {
    expect(scoreBreakdown({ bidderId: 'b1', questions, sections, scores: [], scale: 5 }).scale)
      .toBe(5);
  });
});

describe('the seeded library', () => {
  it('ships fully allocated, so a buyer does not open it to warnings', async () => {
    const { TENANT_TEMPLATES, CATEGORY_TEMPLATES, LOGISTICS_TEMPLATES } =
      await import('../../data/questionnaireTemplates');
    for (const t of [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES, ...LOGISTICS_TEMPLATES]) {
      for (const budget of sectionBudgets(t)) {
        expect(budget.overspent, `${t.id} ${budget.section.name}`).toBe(false);
        if (budget.scored > 0) {
          expect(budget.remaining, `${t.id} ${budget.section.name}`).toBe(0);
        }
      }
    }
  });

  it('gives every seeded template a scale', async () => {
    const { TENANT_TEMPLATES, CATEGORY_TEMPLATES, LOGISTICS_TEMPLATES } =
      await import('../../data/questionnaireTemplates');
    for (const t of [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES, ...LOGISTICS_TEMPLATES]) {
      expect(t.scoreScale, t.id).toBeGreaterThan(0);
    }
  });

  it('carries the sections onto the event questionnaires it seeds', async () => {
    const seed = await import('../../data/seed');
    for (const questionnaire of seed.REQUEST_QUESTIONNAIRES()) {
      expect((questionnaire.sections ?? []).length, questionnaire.id).toBeGreaterThan(0);
      expect(questionnaire.scoreScale, questionnaire.id).toBeGreaterThan(0);
    }
  });

  it('keeps every question’s section resolvable on the event copy', async () => {
    const seed = await import('../../data/seed');
    for (const questionnaire of seed.REQUEST_QUESTIONNAIRES()) {
      const ids = new Set((questionnaire.sections ?? []).map((s) => s.id));
      for (const question of questionnaire.questions) {
        if (question.sectionId === null) continue;
        expect(ids.has(question.sectionId), `${questionnaire.id} ${question.code}`).toBe(true);
      }
    }
  });
});
