/**
 * Auto-fix: every fix it makes leaves the rule that raised the error satisfied,
 * and what it cannot decide for the buyer it leaves alone.
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_DRAFT, type Draft } from '../CreateEventWizard';
import { autoFix, fixBasics, fixEvaluation, fixQuestionnaires, fixTerms, fixTimeline, type AutoFixContext } from '../wizardAutoFix';
import { draftAsTemplate, validateTemplate, type DraftQuestionnaire } from '../../domain/questionnaireTemplates';
import { validateTerms } from '../../domain/terms';
import { evaluationGaps, stageKind, stageQuestions, type StageFacts } from '../../domain/evaluationSetup';
import { validateSchedule } from '../../domain/eventTimeline';
import { stageWindows } from '../../domain/stageEvents';
import type { TemplateQuestion } from '../../domain/types';

const STAGES = ['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'] as const;

function q(over: Partial<TemplateQuestion>): TemplateQuestion {
  return {
    id: 'q', templateId: 't', sectionId: 's1', sequence: 1, code: 'Q', type: 'short_text', title: 'Question',
    helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 0, scoringMethod: 'NONE', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', config: {},
    ...over,
  };
}

function questionnaire(point: 'RFI' | 'RFP' | 'RFQ', questions: TemplateQuestion[], sectionWeight = 100): DraftQuestionnaire {
  return {
    point, category: null, templateId: null, templateName: `${point} set`, scoreScale: 100,
    sections: [{ id: 's1', name: 'About the supplier', sequence: 1, weight: sectionWeight } as DraftQuestionnaire['sections'][number]],
    questions,
  };
}

function factsOf(d: Draft): StageFacts[] {
  return (['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'] as const).map((stage) => ({
    stage, kind: stageKind(stage, [...STAGES]),
    questions: stageQuestions(d.questionnaires.filter((x) => x.point === stage).flatMap((x) => x.questions)),
  })) as StageFacts[];
}

const ctx: AutoFixContext = {
  questionnairePoints: ['RFI', 'RFP', 'RFQ'],
  inputPoints: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
  stages: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
  showVendors: true,
  hasEvaluation: true,
  factsOf,
  costCentres: [{ code: 'CC-1104', businessUnit: 'Corporate Services' }],
  now: Date.now(),
};

describe('auto-fix', () => {
  it('fills the required basics', () => {
    const out = fixBasics({ ...INITIAL_DRAFT, title: '', costCentre: '', budgetLine: '' }, ctx);
    expect(out.draft.title).toMatch(/Indirect/);
    expect(out.draft.costCentre).toBe('CC-1104');
    expect(out.draft.budgetLine).not.toBe('');
    expect(out.changes).toHaveLength(3);
  });

  it('gives a choice question its suggested set and moves commercial questions off the RFI', () => {
    const rfi = questionnaire('RFI', [
      q({ id: 'a', code: 'PAY', type: 'single_choice', title: 'What are your standard payment terms?', scoringMethod: 'MANUAL', weight: 50, config: { options: [] } }),
      q({ id: 'b', code: 'PRICE', title: 'Indicative price', envelope: 'COMMERCIAL', sequence: 2, weight: 0 }),
      q({ id: 'c', code: 'YRS', type: 'number', title: 'Years trading', scoringMethod: 'MANUAL', weight: 70, sequence: 3 }),
    ]);
    const rfq = questionnaire('RFQ', [q({ id: 'd', code: 'LEAD', scoringMethod: 'MANUAL', weight: 100 })]);
    const out = fixQuestionnaires({ ...INITIAL_DRAFT, questionnaires: [rfi, rfq] }, ctx);
    for (const fixed of out.draft.questionnaires) {
      expect(validateTemplate(draftAsTemplate(fixed)).errors.map((e) => e.code)).toEqual([]);
    }
    const [fixedRfi, fixedRfq] = out.draft.questionnaires;
    expect(fixedRfi.questions.find((x) => x.code === 'PAY')?.config.options?.map((o) => o.label)).toContain('Net 30 days');
    expect(fixedRfi.questions.some((x) => x.envelope === 'COMMERCIAL')).toBe(false);
    expect(fixedRfq.questions.some((x) => x.code === 'PRICE')).toBe(true);
  });

  it('adds the general and payment terms each ask needs', () => {
    const out = fixTerms({ ...INITIAL_DRAFT, terms: [] }, ctx);
    expect(validateTerms(out.draft.terms, ctx.inputPoints).filter((i) => i.blocking)).toEqual([]);
  });

  it('separates the envelopes and names the evaluators each stage is short of', () => {
    const d: Draft = {
      ...INITIAL_DRAFT,
      envelopeByStage: { RFP: 'TWO_ENVELOPE', RFQ: 'TWO_ENVELOPE' },
      questionnaires: [questionnaire('RFP', [q({ id: 'p', scoringMethod: 'MANUAL', weight: 100 })])],
      evaluation: { ...INITIAL_DRAFT.evaluation, technicalEvaluators: { RFP: ['user-ar'] }, commercialEvaluators: { RFQ: ['user-ar'] } },
    };
    const out = fixEvaluation(d, ctx);
    const gaps = evaluationGaps(out.draft.evaluation, factsOf(out.draft), 'TWO_ENVELOPE', (id) => id).filter((g) => g.blocking);
    expect(gaps).toEqual([]);
    expect(out.draft.evaluation.commercialEvaluators.RFQ).not.toContain('user-ar');
  });

  it('puts a broken schedule back in sequence', () => {
    const start = INITIAL_DRAFT.startAt;
    const d: Draft = { ...INITIAL_DRAFT, stageWindowOverrides: { RFP: { opensAt: start + 10 * 3600_000, closesAt: start + 5 * 3600_000 } } };
    const out = fixTimeline(d, ctx);
    const schedule = stageWindows(ctx.stages, {
      opensAt: out.draft.startAt, closesInHours: out.draft.closesInHours, stageHours: out.draft.stageHours,
      windows: out.draft.stageWindowOverrides, rules: out.draft.timelineRules,
    }, out.draft.startAt);
    expect(validateSchedule(schedule, out.draft.timelineRules, ctx.now).filter((i) => i.blocking)).toEqual([]);
    expect(out.changes.length).toBeGreaterThan(0);
  });

  it('changes nothing on a draft with nothing to fix outside its own steps', () => {
    const out = autoFix(INITIAL_DRAFT, ctx, ['Basics']);
    expect(out.changes.filter((c) => c.step !== 'Basics')).toEqual([]);
  });
});
