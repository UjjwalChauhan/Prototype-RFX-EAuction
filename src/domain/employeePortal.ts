/**
 * The Employee Portal's view of sourcing: what an employee is asked to approve,
 * and what they are asked to evaluate.
 *
 * Two sources of approval feed one inbox. An event raised with a DoA chain is
 * held as Pending Approval until every level signs, and only then goes out to
 * suppliers; an award NFA moves through its own chain. Both read the same way
 * to the approver — a reference, an amount, a chain, a current holder.
 *
 * Evaluation reads the assignment the Create Event wizard froze onto each ask.
 * The technical projection is built here, and it is the only thing the
 * technical workspace receives: price lines and commercial answers are dropped
 * before anything renders, so there is nothing on screen to blur or hide.
 */
import { PRICED_QUESTION_TYPES, STRUCTURAL_TYPES } from './questionnaireTemplates';
import type {
  Answer, EventBidder, Nfa, Question, Response, Score, SourcingEvent,
  EnvelopeMode,
} from './types';

type Id = string;

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type StepDecision = 'PENDING' | 'APPROVED' | 'DECLINED' | 'RETURNED';

export interface EventApprovalStep {
  level: number;
  holderName: string;
  role: string;
  slaHours: number;
  decision: StepDecision;
  comment: string | null;
  decidedAt: number | null;
}

/** An event held back from suppliers until its approval chain signs. */
export interface EventApprovalRequest {
  id: Id;
  eventId: Id;
  raisedById: Id;
  raisedByName: string;
  raisedAt: number;
  amount: number;
  currency: string;
  steps: EventApprovalStep[];
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
}

/** A hold, a release or a clarification, against any approval in the inbox. */
export interface ApprovalNote {
  id: Id;
  /** `event:<request id>` or `award:<nfa id>`. */
  key: string;
  kind: 'HOLD' | 'UNHOLD' | 'CLARIFICATION';
  byName: string;
  at: number;
  text: string;
}

export type ApprovalStatus = 'PENDING' | 'ON_HOLD' | 'APPROVED' | 'DECLINED' | 'RETURNED';

export interface ApprovalItem {
  key: string;
  kind: 'EVENT' | 'AWARD';
  /** The request id or the NFA id. */
  refId: Id;
  eventId: Id;
  reference: string;
  title: string;
  raisedByName: string;
  raisedAt: number;
  amount: number;
  currency: string;
  steps: EventApprovalStep[];
  status: ApprovalStatus;
  /** The level waiting for a decision, while one is. */
  currentLevel: number | null;
  notes: ApprovalNote[];
}

export function eventApprovalSteps(
  chain: { level: number; role: string; holderName: string; slaHours: number }[],
): EventApprovalStep[] {
  return chain.map((c) => ({ ...c, decision: 'PENDING', comment: null, decidedAt: null }));
}

/** One decision against a held event. A decline ends the chain; the last approval releases the event. */
export function decideEventApproval(
  request: EventApprovalRequest, level: number, decision: 'APPROVED' | 'DECLINED', comment: string, at: number,
): EventApprovalRequest {
  const steps = request.steps.map((s) => (s.level === level
    ? { ...s, decision, comment: comment || null, decidedAt: at }
    : s));
  const status = decision === 'DECLINED' ? 'DECLINED'
    : steps.every((s) => s.decision === 'APPROVED') ? 'APPROVED' : 'PENDING';
  return { ...request, steps, status };
}

const NFA_STATUS: Partial<Record<Nfa['status'], ApprovalStatus>> = {
  IN_APPROVAL: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'DECLINED', RETURNED: 'RETURNED',
};

function withHold(status: ApprovalStatus, notes: ApprovalNote[]): ApprovalStatus {
  if (status !== 'PENDING') return status;
  const last = [...notes].reverse().find((n) => n.kind === 'HOLD' || n.kind === 'UNHOLD');
  return last?.kind === 'HOLD' ? 'ON_HOLD' : status;
}

/** Every approval the inbox knows about, newest first. */
export function approvalItems(input: {
  events: SourcingEvent[];
  nfas: Nfa[];
  requests: EventApprovalRequest[];
  notes: ApprovalNote[];
  nameOf: (id: Id) => string;
}): ApprovalItem[] {
  const eventOf = (id: Id) => input.events.find((e) => e.id === id);
  const items: ApprovalItem[] = [];

  for (const request of input.requests) {
    const event = eventOf(request.eventId);
    if (!event) continue;
    const key = `event:${request.id}`;
    const notes = input.notes.filter((n) => n.key === key);
    const status = withHold(request.status, notes);
    items.push({
      key, kind: 'EVENT', refId: request.id, eventId: event.id,
      reference: event.eventNumber, title: event.title,
      raisedByName: request.raisedByName, raisedAt: request.raisedAt,
      amount: request.amount, currency: request.currency,
      steps: request.steps, status,
      currentLevel: status === 'PENDING' || status === 'ON_HOLD'
        ? request.steps.find((s) => s.decision === 'PENDING')?.level ?? null : null,
      notes,
    });
  }

  for (const nfa of input.nfas) {
    const base = NFA_STATUS[nfa.status];
    const event = eventOf(nfa.eventId);
    if (!base || !event || nfa.steps.length === 0) continue;
    const key = `award:${nfa.id}`;
    const notes = input.notes.filter((n) => n.key === key);
    const status = withHold(base, notes);
    const steps: EventApprovalStep[] = nfa.steps.map((s) => ({
      level: s.level,
      holderName: s.delegatedToName ?? s.holderName,
      role: s.role,
      slaHours: s.slaHours,
      decision: s.decision === 'REJECTED' ? 'DECLINED'
        : s.decision === 'APPROVED' ? 'APPROVED'
          : s.decision === 'RETURNED' ? 'RETURNED' : 'PENDING',
      comment: s.comment,
      decidedAt: s.decidedAt,
    }));
    items.push({
      key, kind: 'AWARD', refId: nfa.id, eventId: event.id,
      reference: event.eventNumber, title: `Award — ${event.title}`,
      raisedByName: input.nameOf(nfa.recommendedBy), raisedAt: nfa.createdAt,
      amount: event.estimatedValue, currency: event.currency,
      steps, status,
      currentLevel: status === 'PENDING' || status === 'ON_HOLD'
        ? steps.find((s) => s.decision === 'PENDING')?.level ?? null : null,
      notes,
    });
  }
  return items.sort((a, b) => b.raisedAt - a.raisedAt);
}

export function currentHolder(item: ApprovalItem): string | null {
  return item.steps.find((s) => s.level === item.currentLevel)?.holderName ?? null;
}

/** Waiting on this person now — pending or held at their level. */
export function awaiting(item: ApprovalItem, name: string): boolean {
  return (item.status === 'PENDING' || item.status === 'ON_HOLD') && currentHolder(item) === name;
}

export function actedBy(item: ApprovalItem, name: string): EventApprovalStep | undefined {
  return item.steps.find((s) => s.holderName === name && s.decision !== 'PENDING');
}

/**
 * Release an event held for approval: the umbrella and its first ask go out,
 * and the first ask's suppliers are invited now — the moment they were
 * actually asked, not the moment the draft was saved.
 */
export function releaseHeldEvent(
  events: SourcingEvent[], bidders: EventBidder[], eventId: Id, at: number,
): { events: SourcingEvent[]; bidders: EventBidder[] } {
  const children = events.filter((e) => e.parentEventId === eventId);
  const first = children[0];
  const snapshotOf = (e: SourcingEvent | undefined) => {
    if (!e?.configSnapshotAtPublish) return null;
    const { stage: _s, opensAt: _o, closesAt: _c, ...rest } = e.configSnapshotAtPublish;
    return { ...rest, journeyPattern: events.find((x) => x.id === eventId)?.journeyPattern };
  };
  return {
    events: events.map((e) => {
      if (e.id === eventId) {
        return {
          ...e, status: 'PUBLISHED' as const, publishedAt: at,
          configSnapshotAtPublish: e.configSnapshotAtPublish ?? snapshotOf(first),
        };
      }
      if (first && e.id === first.id && e.status === 'DRAFT') {
        return { ...e, status: 'PUBLISHED' as const, publishedAt: at };
      }
      return e;
    }),
    bidders: bidders.map((b) => (
      (first ? b.eventId === first.id : b.eventId === eventId) && b.invitedAt === null
        ? { ...b, invitedAt: at } : b
    )),
  };
}

// ---------------------------------------------------------------------------
// Evaluation assignments
// ---------------------------------------------------------------------------

export interface StageAssignment {
  stage: string;
  gate: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
  minScore: number;
  rubricId: string;
  technicalEvaluatorIds: Id[];
  commercialEvaluatorIds: Id[];
}

export interface EvaluationRules {
  blindTechnical: boolean;
  consensusMode: 'SINGLE' | 'AVERAGE' | 'MODERATED';
  divergenceThreshold: number;
  unlockWitness: boolean;
  technicalWeight: number;
  envelopeMode: EnvelopeMode;
}

export type EvaluatorRole = 'TECHNICAL' | 'COMMERCIAL';

export interface EvaluationTask {
  event: SourcingEvent;
  role: EvaluatorRole;
  assignment: StageAssignment;
  rules: EvaluationRules;
}

/** The assignment frozen onto an ask at publish, or the seeded one for older events. */
export function assignmentOf(
  event: SourcingEvent, seeded: Record<Id, StageAssignment[]> = {},
): { assignment: StageAssignment; rules: EvaluationRules } | null {
  const snap = (event.configSnapshotAtPublish ?? {}) as Record<string, unknown>;
  const stages = (snap.evaluationStages as StageAssignment[] | undefined) ?? seeded[event.id] ?? [];
  if (stages.length === 0) return null;
  const own = (snap.stage as string | undefined) ?? event.currentStage;
  const assignment = stages.find((s) => s.stage === own) ?? (stages.length === 1 ? stages[0] : undefined);
  if (!assignment) return null;
  return {
    assignment,
    rules: {
      blindTechnical: (snap.blindTechnical as boolean | undefined) ?? true,
      consensusMode: (snap.consensusMode as EvaluationRules['consensusMode'] | undefined) ?? 'MODERATED',
      divergenceThreshold: (snap.divergenceThreshold as number | undefined) ?? 20,
      unlockWitness: (snap.unlockWitness as boolean | undefined) ?? false,
      technicalWeight: (snap.technicalWeight as number | undefined) || 40,
      envelopeMode: event.envelopeMode,
    },
  };
}

/** Every ask this person evaluates, in either envelope. Drafts are not asks yet. */
export function evaluationTasks(
  events: SourcingEvent[], personId: Id, seeded: Record<Id, StageAssignment[]> = {},
): EvaluationTask[] {
  const tasks: EvaluationTask[] = [];
  // A sourcing event that raised asks is evaluated through them, never itself:
  // its RFI, RFP or RFQ carries the responses, the envelopes and the panel.
  const umbrellas = new Set(events.map((e) => e.parentEventId).filter((id): id is Id => id !== null));
  for (const event of events) {
    if (umbrellas.has(event.id)) continue;
    if (event.status === 'DRAFT' || event.status === 'PENDING_APPROVAL' || event.status === 'CANCELLED') continue;
    const found = assignmentOf(event, seeded);
    if (!found) continue;
    if (found.assignment.technicalEvaluatorIds.includes(personId)) tasks.push({ event, role: 'TECHNICAL', ...found });
    if (found.assignment.commercialEvaluatorIds.includes(personId)) tasks.push({ event, role: 'COMMERCIAL', ...found });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// The two envelopes
// ---------------------------------------------------------------------------

export function isCommercialQuestion(q: Question): boolean {
  return q.envelope === 'COMMERCIAL' || PRICED_QUESTION_TYPES.includes(q.type);
}

export function technicalQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type) && !isCommercialQuestion(q))
    .sort((a, b) => a.sequence - b.sequence);
}

export function commercialQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type) && isCommercialQuestion(q))
    .sort((a, b) => a.sequence - b.sequence);
}

/** What a technical evaluator is handed: technical answers only. No price line exists on it. */
export interface TechnicalView {
  responseId: Id;
  bidderId: Id;
  answers: Answer[];
}

export function technicalProjection(response: Response, questions: Question[]): TechnicalView {
  const allowed = new Set(technicalQuestions(questions).map((q) => q.id));
  return {
    responseId: response.id,
    bidderId: response.bidderId,
    answers: response.answers.filter((a) => allowed.has(a.questionId)),
  };
}

/** "Bidder A", "Bidder B" — stable by invitation order. */
export function maskedLabel(index: number): string {
  return `Bidder ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;
}

const GENERIC = new Set([
  'private', 'limited', 'india', 'pvt', 'ltd', 'llc', 'inc', 'company', 'corporation', 'group',
  'industries', 'supplies', 'supply', 'services', 'trading', 'enterprises', 'solutions', 'global',
]);

function nameTokens(names: string[]): string[] {
  return names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/))
    .filter((t) => t.length >= 4 && !GENERIC.has(t));
}

/** The words in a file name that would tell an evaluator whose it is. */
export function revealingTokens(text: string, names: string[]): string[] {
  const lower = text.toLowerCase();
  return [...new Set(nameTokens(names).filter((t) => lower.includes(t)))];
}

export function redact(text: string, names: string[]): string {
  return revealingTokens(text, names).reduce(
    (out, token) => out.replace(new RegExp(token, 'gi'), '▇▇▇'), text,
  );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function answerText(answer: Answer | undefined): string {
  if (!answer || answer.value === null || answer.value === undefined) return '';
  if (Array.isArray(answer.value)) return answer.value.join(', ');
  if (typeof answer.value === 'boolean') return answer.value ? 'Yes' : 'No';
  return String(answer.value);
}

/** The rule that fires for an answer, in plain language, where one can be read off the question. */
export function ruleProposal(q: Question, answer: Answer | undefined): { value: number; rule: string } | null {
  if (!answer || answer.value === null || answer.value === '') {
    return { value: 0, rule: 'No answer given scores 0' };
  }
  const options = q.config?.options ?? [];
  if (options.length > 0) {
    const picked = Array.isArray(answer.value) ? answer.value.map(String) : [String(answer.value)];
    const hits = options.filter((o) => picked.includes(o.label) || picked.includes(o.id));
    const scored = hits.map((o) => o.score).filter((s): s is number => typeof s === 'number');
    if (scored.length > 0) {
      return { value: Math.min(q.maxScore, Math.max(...scored)), rule: `"${hits.map((h) => h.label).join(', ')}" is worth ${Math.max(...scored)}` };
    }
  }
  if (typeof answer.value === 'boolean' || q.type === 'yes_no') {
    const yes = answer.value === true || String(answer.value).toLowerCase() === 'yes';
    return { value: yes ? q.maxScore : 0, rule: `Yes scores ${q.maxScore}, No scores 0` };
  }
  if (typeof answer.value === 'number' && q.rubric) {
    const band = bandFor(q.rubric, answer.value);
    if (band !== null) return { value: Math.min(q.maxScore, band.points), rule: `${answer.value} falls in "${band.text}"` };
  }
  if (typeof answer.value === 'number' && typeof q.config?.min === 'number') {
    const ok = answer.value >= q.config.min;
    return { value: ok ? q.maxScore : 0, rule: `${answer.value} is ${ok ? 'at or above' : 'below'} the minimum of ${q.config.min}` };
  }
  if (q.type === 'certificate' || q.type === 'file_upload') {
    return answer.attachmentName
      ? { value: q.maxScore, rule: 'A document is attached — full marks once it is checked as valid' }
      : { value: 0, rule: 'No document attached scores 0' };
  }
  return null;
}

/**
 * Read a banded rule off the rubric — "0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10",
 * "≤5 days = 10 · 6–10 = 7 · >20 = 1" — and find the band a number falls in.
 */
export function bandFor(rubric: string, value: number): { points: number; text: string } | null {
  for (const raw of rubric.split(/[·;,]/)) {
    const text = raw.trim();
    const points = text.match(/=\s*(\d+(?:\.\d+)?)\s*$/);
    if (!points) continue;
    const head = text.slice(0, text.lastIndexOf('='));
    const range = head.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/);
    const atLeast = head.match(/(?:≥|>=)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*\+/);
    const above = head.match(/(?<![<≥>=])>\s*(\d+(?:\.\d+)?)/);
    const atMost = head.match(/(?:≤|<=)\s*(\d+(?:\.\d+)?)/);
    const below = head.match(/<\s*(\d+(?:\.\d+)?)/);
    const hit = range ? value >= Number(range[1]) && value <= Number(range[2])
      : atLeast ? value >= Number(atLeast[1] ?? atLeast[2])
        : above ? value > Number(above[1])
          : atMost ? value <= Number(atMost[1])
            : below ? value < Number(below[1])
              : false;
    if (hit) return { points: Number(points[1]), text };
  }
  return null;
}

export interface AgentProposal {
  value: number;
  confidence: number;
  evidence: string;
}

/** The agent reads the answer and proposes. Deterministic, so the same answer always reads the same. */
export function agentProposal(q: Question, answer: Answer | undefined): AgentProposal {
  const text = answerText(answer);
  if (!text && !answer?.attachmentName) {
    return { value: 0, confidence: 0.92, evidence: 'No answer was given to this question.' };
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  const share = Math.min(1, 0.35 + words / 60 + (answer?.attachmentName ? 0.15 : 0));
  const confidence = Math.round(Math.min(0.94, 0.42 + words / 90 + (answer?.attachmentName ? 0.12 : 0)) * 100) / 100;
  const evidence = text
    ? `"${text.length > 160 ? `${text.slice(0, 157)}…` : text}"`
    : `Attachment ${answer?.attachmentName}, page 1`;
  return { value: Math.round(q.maxScore * share), confidence, evidence };
}

export const AUTO_CONFIDENCE = 0.7;

/** Scores are append-only: the latest row for a question, bidder and evaluator is the one that counts. */
export function latestScore(scores: Score[], bidderId: Id, questionId: Id, evaluatorId: Id): Score | undefined {
  return scores
    .filter((s) => s.bidderId === bidderId && s.questionId === questionId && s.evaluatorId === evaluatorId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .pop();
}

/** Weighted 0–100 from whatever scores are given; knockouts carry no weight. */
export function weightedScore(questions: Question[], valueOf: (q: Question) => number | null): number {
  const scored = questions.filter((q) => q.weight > 0 && q.maxScore > 0 && !q.isKnockout);
  const total = scored.reduce((a, q) => a + q.weight, 0);
  if (total === 0) return 0;
  const got = scored.reduce((a, q) => a + q.weight * ((valueOf(q) ?? 0) / q.maxScore), 0);
  return Math.round((got / total) * 1000) / 10;
}

export const MODERATOR_PREFIX = 'consensus:';

/** The agreed value: the moderator's where one was set, otherwise the evaluators' average. */
export function agreedValue(
  scores: Score[], bidderId: Id, q: Question, evaluatorIds: Id[],
): number | null {
  const moderated = scores
    .filter((s) => s.bidderId === bidderId && s.questionId === q.id && s.evaluatorId.startsWith(MODERATOR_PREFIX))
    .sort((a, b) => a.createdAt - b.createdAt).pop();
  if (moderated) return moderated.value;
  const values = evaluatorIds
    .map((id) => latestScore(scores, bidderId, q.id, id)?.value)
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

export interface TechnicalOutcome {
  bidderId: Id;
  score: number;
  knockoutFailed: Question[];
  qualified: boolean;
}

export function technicalOutcome(
  bidderId: Id, questions: Question[], scores: Score[], evaluatorIds: Id[], assignment: StageAssignment,
): TechnicalOutcome {
  const technical = technicalQuestions(questions);
  const knockoutFailed = technical.filter((q) => q.isKnockout && agreedValue(scores, bidderId, q, evaluatorIds) === 0);
  const score = weightedScore(technical, (q) => agreedValue(scores, bidderId, q, evaluatorIds));
  const byScore = assignment.gate === 'MIN_SCORE' || assignment.gate === 'BOTH' ? score >= assignment.minScore : true;
  const byKnockout = assignment.gate === 'PASS_FAIL' || assignment.gate === 'BOTH' ? knockoutFailed.length === 0 : true;
  return { bidderId, score, knockoutFailed, qualified: byScore && byKnockout };
}

export interface Divergence {
  questionId: Id;
  bidderId: Id;
  values: { evaluatorId: Id; value: number | null }[];
  /** Spread as a share of the question's scale. */
  spread: number;
  divergent: boolean;
}

/** Every question × bidder, the divergent ones first — that is where a moderator's time goes. */
export function divergences(
  questions: Question[], bidderIds: Id[], scores: Score[], evaluatorIds: Id[], threshold: number,
): Divergence[] {
  const rows: Divergence[] = [];
  for (const q of technicalQuestions(questions).filter((x) => x.maxScore > 0)) {
    for (const bidderId of bidderIds) {
      const values = evaluatorIds.map((evaluatorId) => ({
        evaluatorId, value: latestScore(scores, bidderId, q.id, evaluatorId)?.value ?? null,
      }));
      const given = values.map((v) => v.value).filter((v): v is number => v !== null);
      const spread = given.length > 1 ? ((Math.max(...given) - Math.min(...given)) / q.maxScore) * 100 : 0;
      rows.push({ questionId: q.id, bidderId, values, spread: Math.round(spread), divergent: spread > threshold });
    }
  }
  return rows.sort((a, b) => Number(b.divergent) - Number(a.divergent) || b.spread - a.spread);
}

// ---------------------------------------------------------------------------
// Commercial unlock
// ---------------------------------------------------------------------------

export interface EvaluationSubmission {
  eventId: Id;
  evaluatorId: Id;
  envelope: EvaluatorRole;
  submittedAt: number;
}

export interface TechnicalResultRecord {
  eventId: Id;
  publishedBy: Id;
  publishedAt: number;
  minScore: number;
  /** Counterparty ids, so a later ask with its own bidder rows can read it. */
  qualified: Id[];
  disqualified: { counterpartyId: Id; reason: string }[];
  notify: 'ON_PUBLISH' | 'AT_AWARD';
}

export interface CommercialUnlock {
  eventId: Id;
  requestedBy: Id;
  requestedAt: number;
  witnessedBy: Id | null;
  unlockedAt: number | null;
}

/**
 * The asks whose technical evaluation gates this one's price: the ask itself
 * when it carries both envelopes, otherwise its technical siblings.
 */
export function technicalSources(
  task: EvaluationTask, events: SourcingEvent[], seeded: Record<Id, StageAssignment[]> = {},
): { event: SourcingEvent; assignment: StageAssignment }[] {
  if (task.assignment.technicalEvaluatorIds.length > 0) return [{ event: task.event, assignment: task.assignment }];
  if (!task.event.parentEventId) return [];
  return events
    .filter((e) => e.parentEventId === task.event.parentEventId && e.id !== task.event.id)
    .map((e) => ({ event: e, found: assignmentOf(e, seeded) }))
    .filter((x) => x.found && x.found.assignment.technicalEvaluatorIds.length > 0)
    .map((x) => ({ event: x.event, assignment: x.found!.assignment }));
}

export function unlockPreconditions(
  sources: { event: SourcingEvent; assignment: StageAssignment }[],
  submissions: EvaluationSubmission[],
  results: TechnicalResultRecord[],
): { label: string; met: boolean }[] {
  if (sources.length === 0) {
    return [{ label: 'No technical stage on this journey — price opens on its own', met: true }];
  }
  return sources.flatMap(({ event, assignment }) => {
    const done = assignment.technicalEvaluatorIds.filter((id) =>
      submissions.some((s) => s.eventId === event.id && s.evaluatorId === id && s.envelope === 'TECHNICAL'));
    const result = results.find((r) => r.eventId === event.id);
    return [
      { label: `All technical scores submitted on ${event.eventNumber} (${done.length} of ${assignment.technicalEvaluatorIds.length})`, met: done.length === assignment.technicalEvaluatorIds.length },
      { label: `Technical result published on ${event.eventNumber}`, met: Boolean(result) },
      { label: 'Gate applied and disqualifications confirmed', met: Boolean(result) },
    ];
  });
}

// ---------------------------------------------------------------------------
// The envelopes as an evaluator receives them
// ---------------------------------------------------------------------------

/** The recorded breaking of an ask's technical seal — who opened it, and when. */
export interface EnvelopeOpening {
  eventId: Id;
  envelope: EvaluatorRole;
  openedBy: Id;
  openedAt: number;
  /** The one bidder whose envelope was opened. Absent on an older, ask-wide opening. */
  bidderId?: Id;
}

export type EnvelopeStage =
  /** No sealed response inside yet. */
  | 'AWAITING'
  /** Responses are in and sealed; the panel may open it. */
  | 'SEALED'
  /** Sealed, and held shut by a precondition (the commercial one, before the technical result). */
  | 'LOCKED'
  /** A second authorised person must confirm the opening. */
  | 'WITNESS'
  | 'OPEN'
  | 'EVALUATED'
  /** This ask carries no such envelope. */
  | 'NONE';

export interface EnvelopeState {
  envelope: EvaluatorRole;
  stage: EnvelopeStage;
  label: string;
  detail: string;
  questions: Question[];
  priceLines: number;
  responses: number;
  panel: Id[];
  opening: EnvelopeOpening | null;
}

/**
 * The technical envelope: sealed until a responder is in, then sealed until
 * someone on the panel opens it — an opening that is recorded. It is evaluated
 * once the result is published.
 */
export function technicalEnvelope(input: {
  eventId: Id;
  assignment: StageAssignment;
  questions: Question[];
  responses: number;
  openings: EnvelopeOpening[];
  scores: Score[];
  submissions: EvaluationSubmission[];
  result: TechnicalResultRecord | undefined;
  nameOf: (id: Id) => string;
}): EnvelopeState {
  const { eventId, assignment, responses, result, nameOf } = input;
  const panel = assignment.technicalEvaluatorIds;
  const questions = technicalQuestions(input.questions);
  const base = { envelope: 'TECHNICAL' as const, questions, priceLines: 0, responses, panel };
  if (panel.length === 0) {
    return { ...base, stage: 'NONE', label: 'Not on this ask', detail: 'The technical envelope was evaluated on an earlier ask of this event.', opening: null };
  }
  const recorded = input.openings.find((o) => o.eventId === eventId && o.envelope === 'TECHNICAL') ?? null;
  // Work already begun counts as opened — older scores predate the record.
  const begun = input.scores.some((s) => s.eventId === eventId && panel.some((p) => s.evaluatorId === p || s.evaluatorId === `${MODERATOR_PREFIX}${p}`));
  const opening = recorded ?? (begun ? { eventId, envelope: 'TECHNICAL' as const, openedBy: panel[0], openedAt: 0 } : null);
  if (result) {
    return { ...base, stage: 'EVALUATED', label: 'Evaluated', detail: `Result published · ${result.qualified.length} qualified, ${result.disqualified.length} out`, opening };
  }
  if (opening) {
    const done = panel.filter((id) => input.submissions.some((s) => s.eventId === eventId && s.evaluatorId === id && s.envelope === 'TECHNICAL'));
    return { ...base, stage: 'OPEN', label: 'Open', detail: `${done.length} of ${panel.length} evaluators submitted${recorded ? ` · opened by ${nameOf(recorded.openedBy)}` : ''}`, opening };
  }
  if (responses === 0) {
    return { ...base, stage: 'AWAITING', label: 'Awaiting responses', detail: 'No sealed response inside yet.', opening: null };
  }
  return { ...base, stage: 'SEALED', label: 'Sealed · ready to open', detail: `${responses} sealed response${responses === 1 ? '' : 's'} inside`, opening: null };
}

/**
 * The commercial envelope: locked until the technical evaluation that gates it
 * is published, then opened by an authorised person (and a witness where the
 * event asks for one). Its contents are never described before it opens.
 */
export function commercialEnvelope(input: {
  assignment: StageAssignment;
  questions: Question[];
  priceLines: number;
  responses: number;
  preconditions: { label: string; met: boolean }[];
  unlock: CommercialUnlock | undefined;
  submitted: boolean;
  nameOf: (id: Id) => string;
}): EnvelopeState {
  const { assignment, responses, unlock, nameOf } = input;
  const panel = assignment.commercialEvaluatorIds;
  const questions = commercialQuestions(input.questions);
  const opening = unlock?.unlockedAt ? { eventId: unlock.eventId, envelope: 'COMMERCIAL' as const, openedBy: unlock.requestedBy, openedAt: unlock.unlockedAt } : null;
  const base = { envelope: 'COMMERCIAL' as const, questions, priceLines: input.priceLines, responses, panel, opening };
  if (panel.length === 0) {
    return { ...base, stage: 'NONE', label: 'Not on this ask', detail: 'Price is taken on a later ask of this event.' };
  }
  if (input.submitted) return { ...base, stage: 'EVALUATED', label: 'Evaluated', detail: `Opened by ${nameOf(unlock?.requestedBy ?? '')}` };
  if (opening) {
    return { ...base, stage: 'OPEN', label: 'Open', detail: `Opened by ${nameOf(opening.openedBy)}${unlock?.witnessedBy ? `, witnessed by ${nameOf(unlock.witnessedBy)}` : ''}` };
  }
  if (unlock) return { ...base, stage: 'WITNESS', label: 'Awaiting witness', detail: `${nameOf(unlock.requestedBy)} asked to open it — a second person must confirm` };
  if (responses === 0) return { ...base, stage: 'AWAITING', label: 'Awaiting responses', detail: 'No sealed response inside yet.' };
  const blocker = input.preconditions.find((p) => !p.met);
  if (blocker) return { ...base, stage: 'LOCKED', label: 'Locked', detail: `Opens after: ${blocker.label}` };
  return { ...base, stage: 'SEALED', label: 'Sealed · ready to open', detail: `${responses} sealed price${responses === 1 ? '' : 's'} inside` };
}

// ---------------------------------------------------------------------------
// Envelopes per bidder
// ---------------------------------------------------------------------------
//
// An envelope is a bidder's sealed submission, so it exists only once that
// bidder has submitted: an ask nobody has answered has no envelopes at all.
// Each responding bidder has a technical envelope, opened bidder by bidder and
// recorded, and a commercial one, which opens only through the ask's unlock —
// and never for a bidder the technical gate turned away.

export type BidderEnvelopeStage =
  | 'SEALED' | 'OPEN' | 'SCORED' | 'QUALIFIED' | 'DISQUALIFIED'
  | 'LOCKED' | 'WITNESS' | 'WITHHELD' | 'EVALUATED' | 'NONE';

export interface BidderEnvelope {
  envelope: EvaluatorRole;
  stage: BidderEnvelopeStage;
  label: string;
  detail: string;
  opening: EnvelopeOpening | null;
  /**
   * The agreed technical score out of 100, once the result is published — and
   * only for a bidder who passed every knockout. A knockout failure ends the
   * evaluation, so a weighted score beside it would read as a near miss.
   */
  score?: number | null;
  /** The knockout questions a bidder failed, by title. */
  knockoutFailed?: string[];
}

/** Whether a bidder's technical envelope has been opened — recorded, or plainly begun on. */
export function bidderOpening(
  openings: EnvelopeOpening[], scores: Score[], eventId: Id, bidderId: Id, panel: Id[],
): EnvelopeOpening | null {
  const recorded = openings.find((o) => o.eventId === eventId && o.envelope === 'TECHNICAL'
    && (o.bidderId === undefined || o.bidderId === bidderId));
  if (recorded) return recorded;
  const begun = scores.some((s) => s.eventId === eventId && s.bidderId === bidderId
    && panel.some((p) => s.evaluatorId === p || s.evaluatorId === `${MODERATOR_PREFIX}${p}`));
  return begun ? { eventId, envelope: 'TECHNICAL', openedBy: panel[0], openedAt: 0, bidderId } : null;
}

export function bidderTechnicalEnvelope(input: {
  eventId: Id;
  bidder: EventBidder;
  panel: Id[];
  /** The ask's gate, so the result reads the way the bidder was judged. */
  assignment?: StageAssignment;
  questions: Question[];
  openings: EnvelopeOpening[];
  scores: Score[];
  result: TechnicalResultRecord | undefined;
  viewerId: Id;
  nameOf: (id: Id) => string;
}): BidderEnvelope {
  const { eventId, bidder, panel, result, viewerId, nameOf } = input;
  const base = { envelope: 'TECHNICAL' as const };
  if (panel.length === 0) {
    return { ...base, stage: 'NONE', label: 'Not on this ask', detail: 'Evaluated on an earlier ask of this event.', opening: null };
  }
  const opening = bidderOpening(input.openings, input.scores, eventId, bidder.id, panel);
  if (result) {
    const qualified = result.qualified.includes(bidder.counterpartyId);
    const reason = result.disqualified.find((d) => d.counterpartyId === bidder.counterpartyId)?.reason;
    const gate = input.assignment?.gate ?? 'MIN_SCORE';
    const outcome = technicalOutcome(bidder.id, input.questions, input.scores, panel, input.assignment
      ?? { stage: '', gate, minScore: result.minScore, rubricId: '', technicalEvaluatorIds: panel, commercialEvaluatorIds: [] });
    const failed = outcome.knockoutFailed.map((q) => q.title);
    const score = failed.length === 0 ? Math.round(outcome.score * 10) / 10 : null;
    const usesMin = gate === 'MIN_SCORE' || gate === 'BOTH';
    const hasKnockouts = technicalQuestions(input.questions).some((q) => q.isKnockout);
    const passed = [hasKnockouts ? 'Passed every knockout' : null, usesMin ? `cleared the minimum of ${result.minScore}` : null]
      .filter(Boolean).join(' and ');
    const detail = qualified
      ? (passed ? `${passed.charAt(0).toUpperCase()}${passed.slice(1)}` : 'Cleared the technical gate')
      : failed.length > 0
        ? `Failed knockout: ${failed.join(', ')}`
        : reason ?? (usesMin ? `Below the minimum of ${result.minScore}` : 'Did not clear the technical gate');
    return {
      ...base, stage: qualified ? 'QUALIFIED' : 'DISQUALIFIED', label: qualified ? 'Qualified' : 'Not qualified',
      detail, opening, score, knockoutFailed: failed,
    };
  }
  if (!opening) {
    return { ...base, stage: 'SEALED', label: 'Sealed', detail: 'Opens for the panel when one of you opens it', opening: null };
  }
  const scored = technicalQuestions(input.questions).filter((q) => q.maxScore > 0 || q.isKnockout);
  const by = opening.openedAt > 0 ? ` · opened by ${nameOf(opening.openedBy)}` : '';
  if (!panel.includes(viewerId)) return { ...base, stage: 'OPEN', label: 'Open', detail: `With the panel${by}`, opening };
  const done = scored.filter((q) => latestScore(input.scores, bidder.id, q.id, viewerId)).length;
  return done >= scored.length && scored.length > 0
    ? { ...base, stage: 'SCORED', label: 'Scored by you', detail: `${done} of ${scored.length} questions${by}`, opening }
    : { ...base, stage: 'OPEN', label: 'Open', detail: `You have scored ${done} of ${scored.length}${by}`, opening };
}

export function bidderCommercialEnvelope(input: {
  bidder: EventBidder;
  panel: Id[];
  preconditions: { label: string; met: boolean }[];
  unlock: CommercialUnlock | undefined;
  /** The technical result that gates this ask's price, wherever it was published. */
  result: TechnicalResultRecord | undefined;
  submitted: boolean;
  /** Where the evaluator's review of this bidder's price stands, once the envelope is open. */
  review?: 'IN_REVIEW' | 'REVIEWED';
  nameOf: (id: Id) => string;
}): BidderEnvelope {
  const { bidder, panel, unlock, result, nameOf } = input;
  const base = { envelope: 'COMMERCIAL' as const };
  if (panel.length === 0) {
    return { ...base, stage: 'NONE', label: 'Not on this ask', detail: 'No price is opened at this stage of the event.', opening: null };
  }
  if (result && !result.qualified.includes(bidder.counterpartyId)) {
    return { ...base, stage: 'WITHHELD', label: 'Stays sealed', detail: 'Not technically qualified — this price is never opened.', opening: null };
  }
  const opening = unlock?.unlockedAt
    ? { eventId: unlock.eventId, envelope: 'COMMERCIAL' as const, openedBy: unlock.requestedBy, openedAt: unlock.unlockedAt, bidderId: bidder.id }
    : null;
  if (input.submitted && opening) return { ...base, stage: 'EVALUATED', label: 'Evaluated', detail: `Opened by ${nameOf(opening.openedBy)}`, opening };
  if (opening) {
    const by = `Opened by ${nameOf(opening.openedBy)}${unlock?.witnessedBy ? `, witnessed by ${nameOf(unlock.witnessedBy)}` : ''}`;
    if (input.review === 'REVIEWED') return { ...base, stage: 'OPEN', label: 'Reviewed', detail: `Price reviewed · ${by}`, opening };
    if (input.review === 'IN_REVIEW') return { ...base, stage: 'OPEN', label: 'In review', detail: `Price review under way · ${by}`, opening };
    return { ...base, stage: 'OPEN', label: 'Open', detail: by, opening };
  }
  if (unlock) return { ...base, stage: 'WITNESS', label: 'Awaiting witness', detail: `${nameOf(unlock.requestedBy)} asked to open it`, opening: null };
  const blocker = input.preconditions.find((p) => !p.met);
  if (blocker) return { ...base, stage: 'LOCKED', label: 'Locked', detail: `Opens after: ${blocker.label}`, opening: null };
  return { ...base, stage: 'SEALED', label: 'Sealed · ready to unlock', detail: 'Contents hidden until it is unlocked', opening: null };
}
