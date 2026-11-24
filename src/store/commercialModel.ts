/**
 * The commercial evaluation of one ask, assembled from the store.
 *
 * The employee workspace and the buyer's own view both read this, so a rank
 * means the same thing on both: there is one computation, and two screens that
 * draw it. Nothing here writes; every change goes back through the store as an
 * action, and the model recomputes.
 */
import React from 'react';
import { biddersForEvent, lineItemsForEvent, useStore } from './store';
import { COUNTERPARTIES, PRIMARY_EVENT_ID, QUESTIONNAIRE, SEED_NOW } from '../data/seed';
import { SEEDED_EVALUATION } from '../data/employees';
import { SEEDED_TERMS, seededFx } from '../data/commercialSeed';
import {
  commercialAccess, commercialCoverage, commercialFlags, defaultRules, evaluateAll, modelHash,
  type AccessVerdict, type CommercialFlag, type CommercialRules, type ComparisonBasis,
  type CoverageGap, type EvaluationResult,
} from '../domain/commercialEvaluation';
import {
  commercialQuestions, technicalOutcome, technicalSources, unlockPreconditions,
  type EvaluationTask, type StageAssignment,
} from '../domain/employeePortal';
import { acceptedValidity } from '../domain/buyerRequests';
import type { CostComponent, EventBidder, Id, LineItem, Question, Response } from '../domain/types';

export function questionsOf(
  questionnaires: { eventId: string; questions: Question[] }[], eventId: string,
): Question[] {
  const own = questionnaires.filter((q) => q.eventId === eventId).flatMap((q) => q.questions);
  if (own.length > 0) return own;
  return eventId === PRIMARY_EVENT_ID ? QUESTIONNAIRE.questions : [];
}

/** The latest submitted response per bidder on one ask. */
export function submittedResponses(responses: Response[], eventId: string): Response[] {
  const latest = new Map<string, Response>();
  for (const r of responses) {
    if (r.eventId !== eventId || !r.submittedAt) continue;
    const held = latest.get(r.bidderId);
    if (!held || r.version > held.version) latest.set(r.bidderId, r);
  }
  return [...latest.values()];
}

export function supplierName(bidder: EventBidder | undefined): string {
  return COUNTERPARTIES.find((c) => c.id === bidder?.counterpartyId)?.name ?? bidder?.counterpartyId ?? 'Unknown supplier';
}

export interface CommercialBidder {
  bidder: EventBidder;
  name: string;
}

export interface CommercialModel {
  task: EvaluationTask;
  lines: LineItem[];
  /** Every question on the ask; the commercial ones are `commercial`. */
  questions: Question[];
  commercial: Question[];
  bidders: CommercialBidder[];
  /** Bidders the technical gate turned away: their price is never opened. */
  withheld: { bidder: EventBidder; name: string; reason: string }[];
  responses: Response[];
  rules: CommercialRules;
  components: CostComponent[];
  result: EvaluationResult;
  flags: CommercialFlag[];
  coverage: CoverageGap[];
  hash: string;
  unlocked: boolean;
  completed: boolean;
  preconditionsMet: boolean;
  technicalPanel: Id[];
  twoEnvelope: boolean;
  name: (bidderId: Id) => string;
  access: (personId: Id, extra?: { observer?: boolean; holdsViewCommercial?: boolean }) => AccessVerdict;
}

/** An evaluation task as the buyer's side reads it: the ask, its assignment, and its rules. */
export function taskFor(
  event: EvaluationTask['event'], assignment: StageAssignment, rules: EvaluationTask['rules'],
): EvaluationTask {
  return { event, role: 'COMMERCIAL', assignment, rules };
}

export function seededAssignment(eventId: Id): StageAssignment | undefined {
  return (SEEDED_EVALUATION as Record<string, StageAssignment[]>)[eventId]?.[0];
}

export function useCommercialModel(task: EvaluationTask, basis: ComparisonBasis): CommercialModel {
  const { state } = useStore();
  const event = task.event;
  const seeded = SEEDED_EVALUATION as Record<string, StageAssignment[]>;
  const sources = technicalSources(task, state.events, seeded);
  const unlock = state.commercialUnlocks.find((u) => u.eventId === event.id);
  const unlocked = Boolean(unlock?.unlockedAt);
  const preconditions = unlockPreconditions(sources, state.evaluationSubmissions, state.technicalResults);

  const questions = questionsOf(state.questionnaires, event.id);
  const commercial = commercialQuestions(questions);
  const lines = lineItemsForEvent(state, event.id);
  const responses = submittedResponses(state.responses, event.id);
  const everyone = biddersForEvent(state, event.id).filter((b) => responses.some((r) => r.bidderId === b.id));

  // A bidder the technical gate turned away has a commercial envelope that never opens.
  const turnedAway = new Map(
    sources.flatMap((s) => state.technicalResults.find((r) => r.eventId === s.event.id)?.disqualified ?? [])
      .map((d) => [d.counterpartyId, d.reason] as const),
  );
  const bidders: CommercialBidder[] = everyone
    .filter((b) => !turnedAway.has(b.counterpartyId))
    .map((bidder) => ({ bidder, name: supplierName(bidder) }));
  const withheld = everyone
    .filter((b) => turnedAway.has(b.counterpartyId))
    .map((bidder) => ({ bidder, name: supplierName(bidder), reason: turnedAway.get(bidder.counterpartyId) ?? '' }));

  const rules = React.useMemo(() => {
    const snap = (event.configSnapshotAtPublish ?? {}) as { commercial?: Partial<CommercialRules> };
    const hasTechnical = sources.length > 0;
    const tw = task.rules.technicalWeight;
    return defaultRules({
      currency: event.currency,
      side: event.side,
      method: hasTechnical && tw > 0 && tw < 100 ? 'QCBS' : 'L1',
      technicalWeight: tw,
      fx: event.id === PRIMARY_EVENT_ID ? seededFx(SEED_NOW) : {},
      ...snap.commercial,
      basis,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, event.currency, event.side, task.rules.technicalWeight, sources.length, basis]);

  const components = state.costComponents.filter((c) => c.eventId === event.id);
  const panel = task.assignment.commercialEvaluatorIds;
  const technicalPanel = sources.flatMap((s) => s.assignment.technicalEvaluatorIds);

  const technical: Record<Id, number | null> = {};
  if (sources.length > 0) {
    for (const { bidder } of bidders) {
      const source = sources[sources.length - 1];
      const there = source.event.id === event.id
        ? bidder
        : state.bidders.find((b) => b.eventId === source.event.id && b.counterpartyId === bidder.counterpartyId);
      technical[bidder.id] = there && state.scores.some((s) => s.bidderId === there.id)
        ? technicalOutcome(there.id, questionsOf(state.questionnaires, source.event.id), state.scores, source.assignment.technicalEvaluatorIds, source.assignment).score
        : null;
    }
  }

  const bidderIds = bidders.map((b) => b.bidder.id);
  const termsSeed = event.id === PRIMARY_EVENT_ID ? SEEDED_TERMS : {};
  const validityOverride = acceptedValidity(event.id, state.buyerRequests, state.buyerReplies);
  const nameOfBidder = (id: Id) => bidders.find((b) => b.bidder.id === id)?.name ?? id;

  const input = {
    side: event.side, rules, lines, responses, bidderIds, questions, scores: state.scores,
    panel, components, termsSeed, technical, validityOverride,
  };
  const result = React.useMemo(
    () => evaluateAll(input),
    // The inputs are rebuilt each render; these are the ones that change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, lines, responses, bidderIds.join(), questions, state.scores, components, state.buyerRequests, state.buyerReplies],
  );
  const flags = React.useMemo(
    () => commercialFlags(result, input, nameOfBidder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result],
  );
  const coverage = React.useMemo(() => commercialCoverage(components, bidderIds), [components, bidderIds.join()]);
  const hash = React.useMemo(() => modelHash(rules, questions), [rules, questions]);
  const completed = state.commercialResults.some((r) => r.eventId === event.id);

  return {
    task, lines, questions, commercial, bidders, withheld, responses, rules, components, result, flags,
    coverage, hash, unlocked, completed,
    preconditionsMet: preconditions.every((p) => p.met),
    technicalPanel, twoEnvelope: event.envelopeMode === 'TWO_ENVELOPE',
    name: nameOfBidder,
    access: (personId, extra = {}) => commercialAccess({
      personId, panel, technicalPanel, twoEnvelope: event.envelopeMode === 'TWO_ENVELOPE',
      unlocked, completed, ...extra,
    }),
  };
}
