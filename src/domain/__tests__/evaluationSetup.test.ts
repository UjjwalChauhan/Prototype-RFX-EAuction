/**
 * Evaluation set up in the Create Event wizard: gates per stage, evaluators
 * per role, and the envelope boundary that no setup may cross.
 */
import { describe, expect, it } from 'vitest';
import {
  candidatesFor, decisiveGate, evaluatedStages, evaluationGaps, fillEvaluatorGaps, stageKind,
  stageQuestions, technicalNeeded,
  type EvaluationSetup, type StageFacts,
} from '../evaluationSetup';
import type { Stage, TemplateQuestion } from '../types';

const FULL_LADDER: Stage[] = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'];
const RFQ_ONLY: Stage[] = ['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'];

function q(overrides: Partial<TemplateQuestion> = {}): TemplateQuestion {
  return {
    id: 'q1', templateId: 't', sectionId: null, sequence: 1, code: 'Q1', type: 'long_text',
    title: 'Question', helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 10,
    scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false, allowAttachment: false,
    askedPer: 'VENDOR', config: {},
    ...overrides,
  };
}

const SETUP: EvaluationSetup = {
  gates: {},
  technicalEvaluators: { RFI: ['ar'], RFP: ['ar'] },
  commercialEvaluators: {},
  technicalWeight: 40,
  blindTechnical: true,
  consensus: 'MODERATED',
  divergenceThreshold: 20,
  unlockWitness: false,
  notifyResult: 'AT_AWARD',
  negotiationShortlist: 3,
};

const POOL = [
  { id: 'ar', canScoreTechnical: true, canOpenCommercial: true },
  { id: 'pn', canScoreTechnical: true, canOpenCommercial: false },
  { id: 'rm', canScoreTechnical: false, canOpenCommercial: true },
];

function ladderFacts(): StageFacts[] {
  return evaluatedStages(FULL_LADDER).map((stage) => ({
    stage,
    kind: stageKind(stage, FULL_LADDER),
    questions: stageQuestions(
      stage === 'RFI' ? [q({ id: 'ko', isKnockout: true, weight: 0, scoringMethod: 'NONE' })]
        : stage === 'RFP' ? [q({ id: 'a', weight: 50 }), q({ id: 'b', weight: 30 }), q({ id: 'c', weight: 20 })]
          : stage === 'RFQ' ? [q({ id: 'p', type: 'price_schedule', envelope: 'COMMERCIAL', weight: 0, scoringMethod: 'NONE' })]
            : [],
    ),
  }));
}

describe('stage kinds', () => {
  it('reads a stage by where it sits in the journey', () => {
    expect(evaluatedStages(FULL_LADDER)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(stageKind('RFI', FULL_LADDER)).toBe('QUALIFY');
    expect(stageKind('RFP', FULL_LADDER)).toBe('TECHNICAL');
    expect(stageKind('RFQ', FULL_LADDER)).toBe('COMMERCIAL');
    // An RFQ with nothing before it has to carry the technical answers too.
    expect(stageKind('RFQ', RFQ_ONLY)).toBe('COMBINED');
  });

  it('keeps price out of the scored questions', () => {
    const split = stageQuestions([
      q({ id: 'tech', weight: 10 }),
      q({ id: 'price', type: 'price_schedule', weight: 10 }),
      q({ id: 'terms', envelope: 'COMMERCIAL', weight: 10 }),
    ]);
    expect(split.scored.map((x) => x.id)).toEqual(['tech']);
    expect(split.commercial.map((x) => x.id)).toEqual(['price', 'terms']);
  });
});

describe('evaluation gaps', () => {
  it('asks for a second technical evaluator on a scored stage and a commercial one where price opens', () => {
    const gaps = evaluationGaps(SETUP, ladderFacts(), 'TWO_ENVELOPE', (id) => id.toUpperCase());
    expect(gaps.filter((g) => g.blocking).map((g) => [g.stage, g.target])).toEqual([
      ['RFP', 'TECHNICAL'],
      ['RFQ', 'COMMERCIAL'],
    ]);
    expect(technicalNeeded('QUALIFY', 'PASS_FAIL', 0)).toBe(1);
    expect(technicalNeeded('TECHNICAL', 'MIN_SCORE', 3)).toBe(2);
  });

  it('blocks a technical evaluator who could also open price under two envelopes', () => {
    const crossed = { ...SETUP, commercialEvaluators: { RFQ: ['ar'] } };
    const two = evaluationGaps(crossed, ladderFacts(), 'TWO_ENVELOPE', (id) => id);
    expect(two.some((g) => g.blocking && g.text.includes('both a technical and a commercial'))).toBe(true);
    const single = evaluationGaps(crossed, ladderFacts(), 'SINGLE', (id) => id);
    expect(single.some((g) => g.text.includes('both a technical and a commercial'))).toBe(false);
  });

  it('refuses a minimum-score gate with nothing scored to reach it', () => {
    const setup = { ...SETUP, gates: { RFI: { gate: 'MIN_SCORE' as const, minScore: 60, rubricId: 'BANDS_4' } } };
    const gaps = evaluationGaps(setup, ladderFacts(), 'TWO_ENVELOPE', (id) => id);
    expect(gaps.some((g) => g.stage === 'RFI' && g.target === 'GATE' && g.blocking)).toBe(true);
  });

  it('warns, without blocking, when a scored stage has no gate', () => {
    const setup = { ...SETUP, gates: { RFP: { gate: 'NONE' as const, minScore: 0, rubricId: 'BANDS_4' } } };
    const gap = evaluationGaps(setup, ladderFacts(), 'TWO_ENVELOPE', (id) => id)
      .find((g) => g.stage === 'RFP' && g.target === 'GATE');
    expect(gap?.blocking).toBe(false);
  });
});

describe('naming evaluators', () => {
  it('never offers someone across the envelope line', () => {
    const stages = evaluatedStages(FULL_LADDER);
    const commercial = candidatesFor('COMMERCIAL', 'RFQ', SETUP, stages, 'TWO_ENVELOPE', POOL);
    expect(commercial.map((p) => p.id)).toEqual(['rm']);
    expect(candidatesFor('COMMERCIAL', 'RFQ', SETUP, stages, 'SINGLE', POOL).map((p) => p.id)).toEqual(['ar', 'rm']);
  });

  it('fills every short stage and leaves a setup with no gaps', () => {
    const facts = ladderFacts();
    const { setup, added } = fillEvaluatorGaps(SETUP, facts, 'TWO_ENVELOPE', POOL);
    expect(added).toEqual([
      { id: 'pn', role: 'TECHNICAL', stage: 'RFP' },
      { id: 'rm', role: 'COMMERCIAL', stage: 'RFQ' },
    ]);
    expect(evaluationGaps(setup, facts, 'TWO_ENVELOPE', (id) => id).filter((g) => g.blocking)).toEqual([]);
  });
});

describe('the gate the event records', () => {
  it('is the last stage judged on merit — the one that decides who reaches price', () => {
    expect(decisiveGate(SETUP, FULL_LADDER)).toEqual({ technicalGate: 'MIN_SCORE', minTechnicalScore: 70 });
    // The tenant default on a single combined ask, as before this step existed.
    expect(decisiveGate(SETUP, RFQ_ONLY)).toEqual({ technicalGate: 'MIN_SCORE', minTechnicalScore: 60 });
  });
});
