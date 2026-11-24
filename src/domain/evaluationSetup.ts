/**
 * How an event's evaluation is set up before it is published.
 *
 * The Create Event wizard decides, per stage the supplier passes through, what
 * gets a supplier to the next one (the gate), what they are judged against
 * (the rubric and the scored questions, which come from the questionnaire),
 * and who judges them. The evaluation workspace that runs after the responses
 * are in (Pack 13) reads all of this; it does not get to change it.
 *
 * One rule is not a preference: under two envelopes, nobody named to score
 * the technical envelope may also be named to open the commercial one. A
 * technical evaluator who could see price is the failure the whole envelope
 * model exists to prevent, so the overlap blocks publish rather than warning.
 */
import { PRICED_QUESTION_TYPES, STRUCTURAL_TYPES, isScored } from './questionnaireTemplates';
import type { ConsensusMode, EnvelopeMode, Stage, TemplateQuestion, VendorInputPoint } from './types';

export type GateKind = 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';

/**
 * What a stage does to the field.
 *
 * QUALIFY screens on compliance; TECHNICAL judges the proposal on merit;
 * COMMERCIAL compares price after the technical stages have run; COMBINED is
 * the single ask that carries both envelopes because the journey has no
 * earlier technical stage to carry one.
 */
export type StageKind = 'QUALIFY' | 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED' | 'NEGOTIATION' | 'AUCTION';

export type EvaluatedStage = Extract<VendorInputPoint, 'RFI' | 'RFP' | 'RFQ' | 'NEGOTIATION' | 'AUCTION'>;

export interface StageGate {
  gate: GateKind;
  /** On the 0–100 technical scale, whatever scale the questionnaire reports on. */
  minScore: number;
  rubricId: string;
}

export interface EvaluationSetup {
  /** Per stage, where the buyer has set it. Absent means the default for the stage's kind. */
  gates: Partial<Record<EvaluatedStage, StageGate>>;
  /** Who scores the technical envelope at each stage. The first named is the lead. */
  technicalEvaluators: Partial<Record<EvaluatedStage, string[]>>;
  /** Who may open the sealed commercial envelope at each stage. */
  commercialEvaluators: Partial<Record<EvaluatedStage, string[]>>;
  /** Technical share of the combined score; commercial is the rest. Price is counted once. */
  technicalWeight: number;
  blindTechnical: boolean;
  consensus: ConsensusMode;
  /** Scores further apart than this share of the scale go to the lead to settle. */
  divergenceThreshold: number;
  /** Unlocking the commercial envelope needs a second authorised user. */
  unlockWitness: boolean;
  /** When suppliers hear whether they qualified technically. */
  notifyResult: 'ON_PUBLISH' | 'AT_AWARD';
  /** How many suppliers, by combined score, are taken into negotiation. */
  negotiationShortlist: number;
}

/** The stages evaluation has anything to say about, in the order a supplier meets them. */
const EVALUATED: EvaluatedStage[] = ['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'];

export function evaluatedStages(stages: readonly Stage[]): EvaluatedStage[] {
  return EVALUATED.filter((stage) => stages.includes(stage));
}

/**
 * The kind follows from where the stage sits in the journey, not from its
 * name alone: an RFQ after an RFP is the commercial half of a two-stage
 * tender, while an RFQ on its own has to carry the technical answers too.
 */
export function stageKind(stage: EvaluatedStage, stages: readonly Stage[]): StageKind {
  switch (stage) {
    case 'RFI': return 'QUALIFY';
    case 'RFP': return stages.includes('RFQ') ? 'TECHNICAL' : 'COMBINED';
    case 'RFQ': return stages.includes('RFI') || stages.includes('RFP') ? 'COMMERCIAL' : 'COMBINED';
    case 'NEGOTIATION': return 'NEGOTIATION';
    case 'AUCTION': return 'AUCTION';
  }
}

/** Whether a gate on this kind of stage can involve a technical score at all. */
export function judgesMerit(kind: StageKind): boolean {
  return kind === 'QUALIFY' || kind === 'TECHNICAL' || kind === 'COMBINED';
}

export function opensPrice(kind: StageKind): boolean {
  return kind === 'COMMERCIAL' || kind === 'COMBINED';
}

export const DEFAULT_RUBRIC_ID = 'BANDS_4';

export function defaultGate(kind: StageKind): StageGate {
  switch (kind) {
    case 'QUALIFY': return { gate: 'PASS_FAIL', minScore: 60, rubricId: DEFAULT_RUBRIC_ID };
    case 'TECHNICAL': return { gate: 'MIN_SCORE', minScore: 70, rubricId: DEFAULT_RUBRIC_ID };
    // The tenant default, so a journey with no Evaluation step publishes the
    // gate it always has.
    case 'COMBINED': return { gate: 'MIN_SCORE', minScore: 60, rubricId: DEFAULT_RUBRIC_ID };
    default: return { gate: 'NONE', minScore: 0, rubricId: DEFAULT_RUBRIC_ID };
  }
}

export function gateOf(setup: EvaluationSetup, stage: EvaluatedStage, kind: StageKind): StageGate {
  return setup.gates[stage] ?? defaultGate(kind);
}

export function usesScore(gate: GateKind): boolean {
  return gate === 'MIN_SCORE' || gate === 'BOTH';
}

export function usesKnockouts(gate: GateKind): boolean {
  return gate === 'PASS_FAIL' || gate === 'BOTH';
}

/** What the questionnaire asks at a stage, split by what evaluation does with it. */
export interface StageQuestions {
  /** Weighted and judged — the questions a technical score is made of. */
  scored: TemplateQuestion[];
  knockouts: TemplateQuestion[];
  /** Price, or anything in the commercial envelope. Never shown to a technical evaluator. */
  commercial: TemplateQuestion[];
  total: number;
}

export function stageQuestions(questions: TemplateQuestion[]): StageQuestions {
  const askable = questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type));
  const commercial = askable.filter(
    (q) => q.envelope === 'COMMERCIAL' || PRICED_QUESTION_TYPES.includes(q.type),
  );
  return {
    scored: askable.filter((q) => isScored(q) && !commercial.includes(q)),
    knockouts: askable.filter((q) => q.isKnockout),
    commercial,
    total: askable.length,
  };
}

/**
 * A scored stage needs two technical evaluators: one person's opinion is not
 * a score anyone can defend, and moderation needs someone to moderate
 * between. A pass / fail screen needs one.
 */
export function technicalNeeded(kind: StageKind, gate: GateKind, scoredCount: number): number {
  if (!judgesMerit(kind)) return 0;
  return usesScore(gate) || (kind !== 'QUALIFY' && scoredCount > 0) ? 2 : 1;
}

export function commercialNeeded(kind: StageKind): number {
  return opensPrice(kind) ? 1 : 0;
}

export type GapTarget = 'GATE' | 'TECHNICAL' | 'COMMERCIAL';

export interface EvaluationGap {
  stage: EvaluatedStage | null;
  tone: 'error' | 'warning';
  blocking: boolean;
  text: string;
  /** What fixing it means, so the screen can offer the one control that does. */
  target: GapTarget | null;
}

export interface StageFacts {
  stage: EvaluatedStage;
  kind: StageKind;
  questions: StageQuestions;
}

const LABEL: Record<EvaluatedStage, string> = {
  RFI: 'RFI', RFP: 'RFP', RFQ: 'RFQ', NEGOTIATION: 'Negotiation', AUCTION: 'Auction',
};

const NUMBER_WORD = ['no', 'one', 'two', 'three'];

/**
 * Everything that stands between this setup and a publishable event.
 *
 * Ordered by stage so the banner reads in the order a supplier would meet
 * the problems.
 */
export function evaluationGaps(
  setup: EvaluationSetup,
  facts: StageFacts[],
  envelopeMode: EnvelopeMode,
  name: (id: string) => string,
): EvaluationGap[] {
  const gaps: EvaluationGap[] = [];
  for (const { stage, kind, questions } of facts) {
    const label = LABEL[stage];
    if (judgesMerit(kind)) {
      const gate = gateOf(setup, stage, kind);
      if (gate.gate === 'NONE' && questions.scored.length > 0) {
        gaps.push({
          stage, tone: 'warning', blocking: false, target: 'GATE',
          text: `${label} is scored but has no gate — every responding supplier goes through`,
        });
      }
      if (usesScore(gate.gate) && questions.scored.length === 0) {
        gaps.push({
          stage, tone: 'error', blocking: true, target: 'GATE',
          text: `${label} gates on a minimum score, but none of its questions is scored`,
        });
      }
      if (usesScore(gate.gate) && (gate.minScore <= 0 || gate.minScore > 100)) {
        gaps.push({
          stage, tone: 'error', blocking: true, target: 'GATE',
          text: `${label}'s minimum score has to be between 1 and 100`,
        });
      }
      if (usesKnockouts(gate.gate) && questions.knockouts.length === 0) {
        gaps.push({
          stage, tone: 'warning', blocking: false, target: 'GATE',
          text: `${label} gates on knockouts, but its questionnaire has none — nobody can fail it`,
        });
      }
      const needed = technicalNeeded(kind, gate.gate, questions.scored.length);
      const named = setup.technicalEvaluators[stage] ?? [];
      if (named.length < needed) {
        gaps.push({
          stage, tone: 'error', blocking: true, target: 'TECHNICAL',
          text: named.length === 0
            ? `${label} has no technical evaluator — nobody is named to score it`
            : `${label} is a scored stage and needs ${NUMBER_WORD[needed] ?? needed} technical evaluators — only ${named.map(name).join(', ')} is named`,
        });
      }
    }
    if (opensPrice(kind)) {
      const named = setup.commercialEvaluators[stage] ?? [];
      if (named.length < commercialNeeded(kind)) {
        gaps.push({
          stage, tone: 'error', blocking: true, target: 'COMMERCIAL',
          text: `${label} has no commercial evaluator — nobody is authorised to open the sealed price schedules`,
        });
      }
    }
  }

  // The envelope boundary, judged across the whole event: a person who scores
  // any technical envelope may not open any commercial one.
  if (envelopeMode === 'TWO_ENVELOPE') {
    const technical = new Set(facts.flatMap((f) => setup.technicalEvaluators[f.stage] ?? []));
    const both = [...new Set(facts.flatMap((f) => setup.commercialEvaluators[f.stage] ?? []))]
      .filter((id) => technical.has(id));
    for (const id of both) {
      gaps.push({
        stage: null, tone: 'error', blocking: true, target: 'COMMERCIAL',
        text: `${name(id)} is named as both a technical and a commercial evaluator — under two envelopes a technical evaluator must never see price`,
      });
    }
  }

  if (facts.some((f) => opensPrice(f.kind)) && facts.some((f) => judgesMerit(f.kind))) {
    if (setup.technicalWeight <= 0 || setup.technicalWeight >= 100) {
      gaps.push({
        stage: null, tone: 'warning', blocking: false, target: null,
        text: setup.technicalWeight <= 0
          ? 'The combined score gives technical 0% — price alone decides negotiation and award'
          : 'The combined score gives commercial 0% — price plays no part in the award',
      });
    }
  }
  return gaps;
}

/**
 * The single technical gate the published event has always recorded: the one
 * that decides who reaches price. That is the last stage judged on merit —
 * the RFP in a full ladder, the RFQ itself when it carries both envelopes.
 */
export function decisiveGate(
  setup: EvaluationSetup, stages: readonly Stage[],
): { technicalGate: GateKind; minTechnicalScore: number } {
  const merit = evaluatedStages(stages)
    .map((stage) => ({ stage, kind: stageKind(stage, stages) }))
    .filter((s) => judgesMerit(s.kind));
  const last = merit[merit.length - 1];
  if (!last) return { technicalGate: 'NONE', minTechnicalScore: 0 };
  const gate = gateOf(setup, last.stage, last.kind);
  return { technicalGate: gate.gate, minTechnicalScore: usesScore(gate.gate) ? gate.minScore : 0 };
}

/** The award formula, in plain arithmetic — disclosed wherever scoring appears. */
export function combinedFormula(technicalWeight: number): string {
  return `Combined score = technical score × ${technicalWeight}% + commercial score × ${100 - technicalWeight}%. Price is counted once, in the commercial score.`;
}

/** Suppliers that would reach the next stage under a minimum score, from past scores. */
export function wouldQualify(scores: number[], minScore: number): number {
  return scores.filter((score) => score >= minScore).length;
}

export type EvaluatorRole = 'TECHNICAL' | 'COMMERCIAL';

export interface EvaluatorEligibility {
  id: string;
  canScoreTechnical: boolean;
  canOpenCommercial: boolean;
}

function rosterOf(setup: EvaluationSetup, role: EvaluatorRole) {
  return role === 'TECHNICAL' ? setup.technicalEvaluators : setup.commercialEvaluators;
}

/**
 * Whether naming this person to this role would put them on both sides of the
 * envelope line somewhere on the event.
 */
export function crossesEnvelope(
  id: string, role: EvaluatorRole, setup: EvaluationSetup,
  stages: EvaluatedStage[], envelopeMode: EnvelopeMode,
): boolean {
  if (envelopeMode !== 'TWO_ENVELOPE') return false;
  const other = rosterOf(setup, role === 'TECHNICAL' ? 'COMMERCIAL' : 'TECHNICAL');
  return stages.some((stage) => (other[stage] ?? []).includes(id));
}

/**
 * Who could still be named to a role at a stage: permitted to hold it, not
 * already on it, and not across the envelope line. People already doing the
 * same job elsewhere on the event come first — one panel reading the whole
 * ladder scores more consistently than a new one per stage.
 */
export function candidatesFor<T extends EvaluatorEligibility>(
  role: EvaluatorRole, stage: EvaluatedStage, setup: EvaluationSetup,
  stages: EvaluatedStage[], envelopeMode: EnvelopeMode, pool: T[],
): T[] {
  const roster = rosterOf(setup, role);
  const onStage = roster[stage] ?? [];
  const elsewhere = new Set(stages.flatMap((s) => roster[s] ?? []));
  return pool
    .filter((person) => (role === 'TECHNICAL' ? person.canScoreTechnical : person.canOpenCommercial))
    .filter((person) => !onStage.includes(person.id))
    .filter((person) => !crossesEnvelope(person.id, role, setup, stages, envelopeMode))
    .sort((a, b) => Number(elsewhere.has(b.id)) - Number(elsewhere.has(a.id)));
}

export function withEvaluators(
  setup: EvaluationSetup, role: EvaluatorRole, stage: EvaluatedStage, ids: string[],
): EvaluationSetup {
  return role === 'TECHNICAL'
    ? { ...setup, technicalEvaluators: { ...setup.technicalEvaluators, [stage]: ids } }
    : { ...setup, commercialEvaluators: { ...setup.commercialEvaluators, [stage]: ids } };
}

/**
 * Name the first suitable candidate wherever a stage is short. Technical
 * first, so the commercial suggestions are made knowing who now scores the
 * technical envelope.
 */
export function fillEvaluatorGaps<T extends EvaluatorEligibility>(
  setup: EvaluationSetup, facts: StageFacts[],
  envelopeMode: EnvelopeMode, pool: T[],
): { setup: EvaluationSetup; added: { id: string; role: EvaluatorRole; stage: EvaluatedStage }[] } {
  const stages = facts.map((f) => f.stage);
  const added: { id: string; role: EvaluatorRole; stage: EvaluatedStage }[] = [];
  let next = setup;
  const needs = (role: EvaluatorRole, f: StageFacts) => (role === 'TECHNICAL'
    ? technicalNeeded(f.kind, gateOf(next, f.stage, f.kind).gate, f.questions.scored.length)
    : commercialNeeded(f.kind));
  for (const role of ['TECHNICAL', 'COMMERCIAL'] as const) {
    for (const f of facts) {
      let named = rosterOf(next, role)[f.stage] ?? [];
      while (named.length < needs(role, f)) {
        const [pick] = candidatesFor(role, f.stage, next, stages, envelopeMode, pool);
        if (!pick) break;
        named = [...named, pick.id];
        next = withEvaluators(next, role, f.stage, named);
        added.push({ id: pick.id, role, stage: f.stage });
      }
    }
  }
  return { setup: next, added };
}
