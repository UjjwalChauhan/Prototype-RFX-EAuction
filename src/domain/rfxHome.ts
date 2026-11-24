/**
 * RFX Home — the buyer's first screen, as a pure reading of the tenant.
 *
 * Everything here is derived. The home screen invents no numbers: a metric it
 * cannot compute from a record is not shown, and a trend it has no timestamps
 * for is returned as an empty series rather than a plausible-looking line.
 * That rule is the whole point of putting this in the domain — a dashboard is
 * the easiest place in a product to start lying, and the lie is hard to see
 * because it looks like arithmetic.
 *
 * The screen answers four questions, in this order:
 *   1. What needs me today?            `actionQueue`
 *   2. Where is everything?            `pipelineColumns`, `demandFunnel`
 *   3. What is it worth, and is it moving?  `homeMetrics`, `cashflowSeries`
 *   4. What can be handled for me?     `assistantOffers`
 */
import { AGENT_CATALOGUE } from './agents';
import { isStageEvent } from './stageEvents';
import { STAGE_LABELS } from './journeyPatterns';
import type {
  AgentCode, Clarification, EventBidder, EventStatus, Id, Nfa, PurchaseRequest,
  PurchaseRequestLine, RateContract, Response, ServerMillis, SourcingEvent,
  SourcingRequisition,
} from './types';

export const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** How far back the trailing charts look. Eight weeks is two sourcing cycles. */
export const TREND_WEEKS = 8;

/**
 * Where a row on the home screen sends the buyer.
 *
 * A shape of its own rather than the shell's `Route`, so the domain stays
 * free of the admin application. The screen maps one to the other in one
 * place, which is also the only place that has to change if the shell's
 * routes are renamed.
 */
export type HomeTarget =
  | { kind: 'board' }
  | { kind: 'requests' }
  | { kind: 'intake' }
  | { kind: 'approvals' }
  | { kind: 'agents' }
  | { kind: 'create'; prdId?: Id }
  | { kind: 'event'; eventId: Id; tab?: string }
  | { kind: 'list'; stage: 'RFI' | 'RFP' | 'RFQ' | 'AUCTION' };

export type HomeTone = 'brand' | 'info' | 'purple' | 'warning' | 'success' | 'danger' | 'neutral';

/** Everything the home screen reads. Narrow on purpose, so it can be tested. */
export interface HomeInput {
  now: ServerMillis;
  userId: Id;
  currency: string;
  events: SourcingEvent[];
  bidders: EventBidder[];
  responses: Response[];
  clarifications: Clarification[];
  nfas: Nfa[];
  purchaseRequests: PurchaseRequest[];
  purchaseRequestLines: PurchaseRequestLine[];
  requisitions: SourcingRequisition[];
  rateContracts: RateContract[];
  /** When the tenant-wide kill switch is engaged, no agent offers anything. */
  agentsPaused: boolean;
}

// ---------------------------------------------------------------------------
// Status families — named once, read everywhere
// ---------------------------------------------------------------------------

const AUTHORING: EventStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
const LIVE_TO_SUPPLIERS: EventStatus[] = ['PUBLISHED', 'OPEN', 'AUCTION_SCHEDULED', 'AUCTION_LIVE'];
const EVALUATING: EventStatus[] = [
  'RESPONSES_CLOSED', 'UNDER_EVALUATION', 'IN_NEGOTIATION', 'AUCTION_CLOSED', 'AWARD_RECOMMENDED',
];
const APPROVING: EventStatus[] = ['PENDING_AWARD_APPROVAL', 'AWARD_PENDING_ONBOARDING'];
const FINISHED: EventStatus[] = ['AWARDED', 'CLOSED', 'CANCELLED'];

/** Still the buyer's problem: not finished, not cancelled. */
export function isOpen(event: SourcingEvent): boolean {
  return !FINISHED.includes(event.status);
}

/**
 * The journeys, without the asks they produced.
 *
 * An RFI, an RFP and the RFQ behind one event are one piece of work. Counting
 * them separately reports the same money three times, which is how a sourcing
 * dashboard ends up claiming a pipeline nobody recognises.
 */
export function journeysOf(events: SourcingEvent[]): SourcingEvent[] {
  return events.filter((event) => !isStageEvent(event));
}

/** The asks those journeys put in front of suppliers. */
export function asksOf(events: SourcingEvent[]): SourcingEvent[] {
  return events.filter(isStageEvent);
}

// ---------------------------------------------------------------------------
// Trailing series
// ---------------------------------------------------------------------------

/**
 * Bucket timestamped records into trailing weeks, oldest first.
 *
 * Returns an empty array when nothing is timestamped, which is the signal the
 * chart components take to draw nothing at all. A series of zeroes would plot
 * as a confident flat line through a period we simply have no record of.
 */
export function weeklyTotals(
  entries: { at: ServerMillis | null; value: number }[],
  now: ServerMillis,
  weeks = TREND_WEEKS,
): number[] {
  const dated = entries.filter((e): e is { at: number; value: number } => e.at !== null);
  if (dated.length === 0) return [];
  const buckets = new Array<number>(weeks).fill(0);
  for (const entry of dated) {
    const weeksAgo = Math.floor((now - entry.at) / WEEK);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo] += entry.value;
  }
  // Everything is dated, and all of it falls outside the window. A flat line
  // at zero would read as eight quiet weeks rather than as no record at all,
  // so the series is withheld and the number stands on its own.
  return buckets.some((bucket) => bucket > 0) ? buckets : [];
}

/** The same, counting records rather than summing a value. */
export function weeklyCounts(
  timestamps: (ServerMillis | null)[], now: ServerMillis, weeks = TREND_WEEKS,
): number[] {
  return weeklyTotals(timestamps.map((at) => ({ at, value: 1 })), now, weeks);
}

/** Week labels matching `weeklyTotals`, for an axis. */
export function weekLabels(now: ServerMillis, weeks = TREND_WEEKS): string[] {
  return Array.from({ length: weeks }, (_, index) => {
    const at = new Date(now - (weeks - 1 - index) * WEEK);
    return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  });
}

// ---------------------------------------------------------------------------
// 3 — The metric strip
// ---------------------------------------------------------------------------

export interface HomeMetric {
  key: string;
  label: string;
  value: number;
  /** Money metrics are formatted by the screen, counts are not. */
  format: 'count' | 'money';
  hint: string;
  tone: HomeTone;
  /** Trailing weekly figures, oldest first. Empty when nothing is dated. */
  series: number[];
  seriesLabel: string;
  target: HomeTarget;
}

export function homeMetrics(input: HomeInput): HomeMetric[] {
  const { events, purchaseRequestLines, purchaseRequests, now } = input;
  const journeys = journeysOf(events);
  const open = journeys.filter(isOpen);
  const byRequest = new Map(purchaseRequests.map((r) => [r.id, r]));

  const unsourced = purchaseRequestLines.filter((l) => l.sourcingState === 'UNSOURCED');
  const live = events.filter((e) => LIVE_TO_SUPPLIERS.includes(e.status));
  const evaluating = journeys.filter((e) => EVALUATING.includes(e.status));
  const approving = journeys.filter((e) => APPROVING.includes(e.status));
  const awarded = journeys.filter((e) => e.awardedAt !== null);

  return [
    {
      key: 'demand',
      label: 'Unsourced demand',
      value: unsourced.length,
      format: 'count',
      hint: 'Approved requisition lines with no event raised against them.',
      tone: 'warning',
      series: weeklyCounts(
        unsourced.map((l) => {
          const raised = byRequest.get(l.requestId)?.submittedOn;
          const at = raised ? Date.parse(raised) : NaN;
          return Number.isNaN(at) ? null : at;
        }),
        now,
      ),
      seriesLabel: 'Requisition lines raised per week over the last eight weeks',
      target: { kind: 'intake' },
    },
    {
      key: 'live',
      label: 'Live with suppliers',
      value: live.length,
      format: 'count',
      hint: 'Asks and auctions suppliers can act on right now.',
      tone: 'brand',
      series: weeklyCounts(live.map((e) => e.publishedAt), now),
      seriesLabel: 'Asks published per week over the last eight weeks',
      target: { kind: 'board' },
    },
    {
      key: 'evaluating',
      label: 'In evaluation',
      value: evaluating.length,
      format: 'count',
      hint: 'Closed to suppliers and waiting on a buyer decision.',
      tone: 'purple',
      series: [],
      seriesLabel: '',
      target: { kind: 'board' },
    },
    {
      key: 'approving',
      label: 'Awaiting approval',
      value: approving.length,
      format: 'count',
      hint: 'Award NFAs sitting with an approver.',
      tone: 'warning',
      series: [],
      seriesLabel: '',
      target: { kind: 'approvals' },
    },
    {
      key: 'in-flight',
      label: 'Value in flight',
      value: open.reduce((a, e) => a + e.estimatedValue, 0),
      format: 'money',
      hint: 'Estimated value of every journey that has not been awarded or closed.',
      tone: 'info',
      series: [],
      seriesLabel: '',
      target: { kind: 'board' },
    },
    {
      key: 'awarded',
      label: 'Awarded, 8 weeks',
      value: awarded
        .filter((e) => e.awardedAt !== null && now - e.awardedAt <= TREND_WEEKS * WEEK)
        .reduce((a, e) => a + e.estimatedValue, 0),
      format: 'money',
      hint: 'Awarded value in the trailing window the charts cover.',
      tone: 'success',
      series: weeklyTotals(awarded.map((e) => ({ at: e.awardedAt, value: e.estimatedValue })), now),
      seriesLabel: 'Awarded value per week over the last eight weeks',
      target: { kind: 'board' },
    },
  ];
}

// ---------------------------------------------------------------------------
// 1 — What needs me today
// ---------------------------------------------------------------------------

export type Urgency = 'overdue' | 'today' | 'soon' | 'scheduled' | 'open';

export interface HomeAction {
  id: string;
  urgency: Urgency;
  /** "Due in 2 days", "Overdue", "Mon 11:00". */
  due: string;
  title: string;
  /** The record this is about — an event number, or a requisition. */
  reference: string;
  context: string;
  /** Position in the journey, where the record is running one. */
  progress: { step: number; total: number; label: string } | null;
  cta: string;
  target: HomeTarget;
  /** Sorts the queue. Lower is more urgent. */
  rank: number;
}

function dueLabel(at: ServerMillis | null, now: ServerMillis): { due: string; urgency: Urgency; rank: number } {
  if (at === null) return { due: 'Not scheduled', urgency: 'open', rank: 9 * DAY };
  const delta = at - now;
  if (delta < 0) return { due: 'Overdue', urgency: 'overdue', rank: -1 };
  if (delta < DAY) return { due: `In ${Math.max(1, Math.round(delta / (60 * 60 * 1000)))}h`, urgency: 'today', rank: delta };
  const days = Math.round(delta / DAY);
  return {
    due: `In ${days} ${days === 1 ? 'day' : 'days'}`,
    urgency: days <= 3 ? 'soon' : 'scheduled',
    rank: delta,
  };
}

/** Where an event has reached, counted over the stages it actually runs. */
export function journeyProgress(event: SourcingEvent): { step: number; total: number; label: string } {
  const index = event.stagesEnabled.indexOf(event.currentStage);
  return {
    step: index < 0 ? 1 : index + 1,
    total: event.stagesEnabled.length,
    label: STAGE_LABELS[event.currentStage] ?? event.currentStage,
  };
}

export function actionQueue(input: HomeInput, limit = 6): HomeAction[] {
  const { events, clarifications, requisitions, now } = input;
  const items: HomeAction[] = [];

  const unanswered = clarifications.filter((c) => c.answer === null);
  const openQuestions = new Map<Id, number>();
  for (const question of unanswered) {
    openQuestions.set(question.eventId, (openQuestions.get(question.eventId) ?? 0) + 1);
  }

  for (const event of events) {
    const when = dueLabel(event.closesAt, now);
    const progress = journeyProgress(event);
    const questions = openQuestions.get(event.id) ?? 0;

    if (questions > 0) {
      items.push({
        id: `clar-${event.id}`,
        ...when,
        rank: when.rank - DAY,
        title: `Answer ${questions} supplier ${questions === 1 ? 'question' : 'questions'}`,
        reference: event.eventNumber,
        context: 'A substantive answer goes to every invited supplier, so it has to be right before it is fast.',
        progress,
        cta: 'Answer questions',
        target: { kind: 'event', eventId: event.id, tab: 'Clarifications' },
      });
      continue;
    }
    if (APPROVING.includes(event.status)) {
      items.push({
        id: `nfa-${event.id}`,
        due: 'With approver',
        urgency: 'soon',
        rank: 2 * DAY,
        title: 'Award decision waiting on approval',
        reference: event.eventNumber,
        context: `${event.title} — the NFA is routed and nothing moves until it clears.`,
        progress,
        cta: 'Open approval',
        target: { kind: 'approvals' },
      });
      continue;
    }
    if (EVALUATING.includes(event.status)) {
      items.push({
        id: `eval-${event.id}`,
        ...when,
        rank: when.rank,
        title: 'Score and compare what came in',
        reference: event.eventNumber,
        context: `${event.title} — closed to suppliers, waiting on your evaluation.`,
        progress,
        cta: 'Review pricing',
        target: { kind: 'event', eventId: event.id, tab: 'Comparison' },
      });
      continue;
    }
    if (event.status === 'AUCTION_LIVE') {
      items.push({
        id: `auc-${event.id}`,
        due: 'Live now',
        urgency: 'today',
        rank: -2,
        title: 'Auction is live',
        reference: event.eventNumber,
        context: `${event.title} — the room is open and the clock is running.`,
        progress,
        cta: 'Open cockpit',
        target: { kind: 'event', eventId: event.id, tab: 'Auction' },
      });
      continue;
    }
    if (event.status === 'AUCTION_SCHEDULED') {
      items.push({
        id: `lock-${event.id}`,
        ...when,
        rank: when.rank,
        title: 'Lock lots and reserve price before the auction',
        reference: event.eventNumber,
        context: `${event.title} — nothing in the room can be changed once it opens.`,
        progress,
        cta: 'Open cockpit',
        target: { kind: 'event', eventId: event.id, tab: 'Auction' },
      });
      continue;
    }
    if (event.status === 'DRAFT') {
      items.push({
        id: `draft-${event.id}`,
        due: 'Not published',
        urgency: 'open',
        rank: 8 * DAY,
        title: 'Finish and publish this event',
        reference: event.eventNumber,
        context: `${event.title} — suppliers cannot see it and the demand behind it is still waiting.`,
        progress,
        cta: 'Open event',
        target: { kind: 'event', eventId: event.id },
      });
    }
  }

  // Demand that was consolidated and then left. The requisition is the record
  // that lapses, so it earns a row of its own rather than a line in a list.
  for (const requisition of requisitions.filter((r) => r.eventId === null)) {
    items.push({
      id: `prd-${requisition.id}`,
      due: 'Not started',
      urgency: 'open',
      rank: 7 * DAY,
      title: 'Raise an RFX against consolidated demand',
      reference: requisition.prdNumber,
      context: `${requisition.lineIds.length} ${requisition.lineIds.length === 1 ? 'line' : 'lines'} from ${requisition.requestNumbers.join(', ')} · ${requisition.category}`,
      progress: null,
      cta: 'Create RFX',
      target: { kind: 'create', prdId: requisition.id },
    });
  }

  return items.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 2 — Where everything is
// ---------------------------------------------------------------------------

export interface PipelineColumn {
  key: string;
  label: string;
  count: number;
  /** One line of why this column needs looking at, or null when it does not. */
  note: string | null;
  tone: HomeTone;
  target: HomeTarget;
}

/**
 * The pipeline, as mutually exclusive columns over journeys.
 *
 * Exclusive so the columns sum to the number of journeys the buyer owns. A
 * board where the parts add up to more than the whole teaches people not to
 * trust the parts.
 */
export function pipelineColumns(input: HomeInput): PipelineColumn[] {
  const journeys = journeysOf(input.events);
  const blocked = journeys.filter((e) => e.status === 'DRAFT').length;
  const unanswered = new Set(
    input.clarifications.filter((c) => c.answer === null).map((c) => c.eventId),
  );
  const bidding = journeys.filter(
    (e) => e.status === 'OPEN' || e.status === 'AUCTION_LIVE' || e.status === 'AUCTION_SCHEDULED',
  );
  const questionsOut = bidding.filter((e) => unanswered.has(e.id)).length;
  const approving = journeys.filter((e) => APPROVING.includes(e.status));

  return [
    {
      key: 'authoring',
      label: 'Authoring',
      count: journeys.filter((e) => AUTHORING.includes(e.status)).length,
      note: blocked > 0 ? `${blocked} not published` : null,
      tone: 'neutral',
      target: { kind: 'board' },
    },
    {
      key: 'published',
      label: 'Published',
      count: journeys.filter((e) => e.status === 'PUBLISHED').length,
      note: null,
      tone: 'info',
      target: { kind: 'board' },
    },
    {
      key: 'bidding',
      label: 'Bidding',
      count: bidding.length,
      note: questionsOut > 0 ? `${questionsOut} with questions for you` : null,
      tone: 'brand',
      target: { kind: 'board' },
    },
    {
      key: 'evaluation',
      label: 'Evaluation',
      count: journeys.filter((e) => EVALUATING.includes(e.status)).length,
      note: null,
      tone: 'purple',
      target: { kind: 'board' },
    },
    {
      key: 'approval',
      label: 'Approval',
      count: approving.length,
      note: approving.length > 0 ? `${approving.length} award due` : null,
      tone: 'warning',
      target: { kind: 'approvals' },
    },
    {
      key: 'awarded',
      label: 'Awarded',
      count: journeys.filter((e) => e.status === 'AWARDED' || e.status === 'CLOSED').length,
      note: null,
      tone: 'success',
      target: { kind: 'board' },
    },
  ];
}

export interface FunnelStep {
  label: string;
  count: number;
  tone: HomeTone;
  hint: string;
}

/**
 * Demand from raised to contracted, counted in requisition lines.
 *
 * Lines rather than requisitions, because a requisition is partly sourced far
 * more often than it is wholly sourced, and a header-level funnel hides that
 * entirely.
 */
export function demandFunnel(input: HomeInput): FunnelStep[] {
  const lines = input.purchaseRequestLines;
  const count = (state: PurchaseRequestLine['sourcingState']) =>
    lines.filter((l) => l.sourcingState === state).length;
  return [
    { label: 'Unsourced', count: count('UNSOURCED'), tone: 'warning', hint: 'Approved and waiting for an event' },
    { label: 'In an event', count: count('IN_EVENT'), tone: 'brand', hint: 'Out with suppliers' },
    { label: 'Awarded', count: count('AWARDED'), tone: 'success', hint: 'Decision taken, PO to raise' },
    { label: 'On contract', count: count('ON_CONTRACT'), tone: 'info', hint: 'Absorbed by a rate contract' },
  ];
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export interface CashflowSeries {
  labels: string[];
  committed: number[];
  awarded: number[];
}

/**
 * What was put in front of suppliers against what was actually awarded, by
 * week. Two series on one axis, because the gap between them is the question.
 */
export function cashflowSeries(input: HomeInput): CashflowSeries {
  const journeys = journeysOf(input.events);
  return {
    labels: weekLabels(input.now),
    committed: weeklyTotals(
      journeys.map((e) => ({ at: e.publishedAt, value: e.estimatedValue })), input.now,
    ),
    awarded: weeklyTotals(
      journeys.map((e) => ({ at: e.awardedAt, value: e.estimatedValue })), input.now,
    ),
  };
}

export interface CategorySlice { label: string; value: number }

/** Open value by category, largest first, with a tail rolled into "Other". */
export function spendByCategory(input: HomeInput, keep = 5): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const event of journeysOf(input.events).filter(isOpen)) {
    totals.set(event.category, (totals.get(event.category) ?? 0) + event.estimatedValue);
  }
  const ordered = [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  if (ordered.length <= keep) return ordered;
  const tail = ordered.slice(keep).reduce((a, s) => a + s.value, 0);
  return [...ordered.slice(0, keep), { label: 'Other', value: tail }];
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export interface HomePerformance {
  awardedValue: number;
  awardedCount: number;
  inFlightValue: number;
  /** Median days from publish to award, or null when nothing has been awarded. */
  cycleDays: number | null;
  /** How many awards the median is drawn from, so a sample of one says so. */
  cycleSample: number;
}

export function homePerformance(input: HomeInput): HomePerformance {
  const journeys = journeysOf(input.events);
  const awarded = journeys.filter((e) => e.awardedAt !== null);
  const cycles = awarded
    .filter((e) => e.publishedAt !== null)
    .map((e) => (e.awardedAt! - e.publishedAt!) / DAY)
    .sort((a, b) => a - b);
  const middle = Math.floor(cycles.length / 2);
  return {
    awardedValue: awarded.reduce((a, e) => a + e.estimatedValue, 0),
    awardedCount: awarded.length,
    inFlightValue: journeys.filter(isOpen).reduce((a, e) => a + e.estimatedValue, 0),
    cycleDays: cycles.length === 0
      ? null
      : Math.round(cycles.length % 2 === 1
        ? cycles[middle]
        : (cycles[middle - 1] + cycles[middle]) / 2),
    cycleSample: cycles.length,
  };
}

// ---------------------------------------------------------------------------
// Coming up, and alerts
// ---------------------------------------------------------------------------

export interface AgendaItem {
  id: string;
  at: ServerMillis;
  /** "In 2 days", "Overdue". */
  when: string;
  title: string;
  detail: string;
  tone: HomeTone;
  target: HomeTarget;
}

export function comingUp(input: HomeInput, limit = 6): AgendaItem[] {
  const { now } = input;
  const items: AgendaItem[] = [];

  for (const event of input.events) {
    if (event.closesAt === null || !isOpen(event)) continue;
    const when = dueLabel(event.closesAt, now);
    items.push({
      id: `close-${event.id}`,
      at: event.closesAt,
      when: when.due,
      title: event.status === 'AUCTION_LIVE' || event.status === 'AUCTION_SCHEDULED'
        ? 'Auction closes'
        : 'Responses close',
      detail: `${event.eventNumber} · ${event.title}`,
      tone: when.urgency === 'overdue' ? 'danger' : when.urgency === 'today' ? 'warning' : 'info',
      target: { kind: 'event', eventId: event.id },
    });
  }

  for (const contract of input.rateContracts) {
    if (contract.expiresAt <= now) continue;
    items.push({
      id: `rc-${contract.id}`,
      at: contract.expiresAt,
      when: dueLabel(contract.expiresAt, now).due,
      title: 'Contract expires',
      detail: `${contract.contractNumber} · ${contract.supplierName}`,
      tone: 'neutral',
      target: { kind: 'board' },
    });
  }

  return items.sort((a, b) => a.at - b.at).slice(0, limit);
}

export interface HomeAlert {
  id: string;
  tone: HomeTone;
  title: string;
  detail: string;
  target: HomeTarget;
}

export function homeAlerts(input: HomeInput, limit = 6): HomeAlert[] {
  const { events, clarifications, bidders, now } = input;
  const byId = new Map(events.map((e) => [e.id, e]));
  const alerts: HomeAlert[] = [];

  for (const question of clarifications.filter((c) => c.answer === null)) {
    const event = byId.get(question.eventId);
    if (!event) continue;
    alerts.push({
      id: `q-${question.id}`,
      tone: 'warning',
      title: 'Supplier question unanswered',
      detail: `${event.eventNumber} · ${question.subject}`,
      target: { kind: 'event', eventId: question.eventId, tab: 'Clarifications' },
    });
  }

  for (const event of events) {
    if (isOpen(event) && event.closesAt !== null && event.closesAt < now) {
      alerts.push({
        id: `late-${event.id}`,
        tone: 'danger',
        title: 'Closed to suppliers, still open here',
        detail: `${event.eventNumber} passed its deadline and has not moved on.`,
        target: { kind: 'event', eventId: event.id },
      });
    }
    if (event.status === 'AUCTION_LIVE') {
      alerts.push({
        id: `live-${event.id}`,
        tone: 'danger',
        title: 'Auction live',
        detail: `${event.eventNumber} · ${event.title}`,
        target: { kind: 'event', eventId: event.id, tab: 'Auction' },
      });
    }
  }

  // A provisional supplier can bid and cannot be awarded. On an event about to
  // be decided that is not a detail, it is a decision waiting to be blocked.
  const deciding = events.filter((e) => EVALUATING.includes(e.status) || APPROVING.includes(e.status));
  for (const event of deciding) {
    const provisional = bidders.filter((b) => b.eventId === event.id && b.isProvisional);
    if (provisional.length === 0) continue;
    alerts.push({
      id: `prov-${event.id}`,
      tone: 'warning',
      title: 'Provisional supplier in a decision',
      detail: `${event.eventNumber} has ${provisional.length} bidder${provisional.length === 1 ? '' : 's'} who cannot be awarded until onboarding completes.`,
      target: { kind: 'event', eventId: event.id, tab: 'Bidders' },
    });
  }

  return alerts.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 4 — What the agents are offering
// ---------------------------------------------------------------------------

export interface AssistantOffer {
  id: string;
  agent: AgentCode;
  agentName: string;
  /** What the agent is allowed to do with this, verbatim from its mandate. */
  limit: string;
  title: string;
  detail: string;
  cta: string;
  target: HomeTarget;
}

/**
 * The assistant, as the named agents that already exist.
 *
 * Deliberately not one general chatbot: every offer below belongs to an agent
 * with a published mandate and a published list of things it cannot do, and
 * the offer says which. An assistant that cannot name what it is not allowed
 * to do is an assistant nobody can supervise.
 *
 * The tenant kill switch silences all of it, because a switch that leaves
 * suggestions on the screen is not a switch.
 */
export function assistantOffers(input: HomeInput, limit = 5): AssistantOffer[] {
  if (input.agentsPaused) return [];
  const offers: AssistantOffer[] = [];
  const describe = (code: AgentCode) => ({
    agent: code,
    agentName: AGENT_CATALOGUE[code].name,
    limit: AGENT_CATALOGUE[code].cannot[0] ?? AGENT_CATALOGUE[code].mandate,
  });

  const waiting = input.requisitions.filter((r) => r.eventId === null);
  for (const requisition of waiting.slice(0, 2)) {
    offers.push({
      id: `ag01-${requisition.id}`,
      ...describe('AG-01'),
      title: `Draft the event for ${requisition.prdNumber}`,
      detail: `${requisition.lineIds.length} consolidated ${requisition.lineIds.length === 1 ? 'line' : 'lines'} in ${requisition.category}. A journey pattern and the basics come back filled in for you to change.`,
      cta: 'Draft it',
      target: { kind: 'create', prdId: requisition.id },
    });
  }

  const unanswered = input.clarifications.filter((c) => c.answer === null);
  if (unanswered.length > 0) {
    offers.push({
      id: 'ag05',
      ...describe('AG-05'),
      title: `Draft answers to ${unanswered.length} supplier ${unanswered.length === 1 ? 'question' : 'questions'}`,
      detail: 'Answers come back cited against the event documents. You publish them, broadcast to every invited supplier.',
      cta: 'Draft answers',
      target: { kind: 'event', eventId: unanswered[0].eventId, tab: 'Clarifications' },
    });
  }

  const thin = journeysOf(input.events)
    .filter(isOpen)
    .map((event) => ({ event, count: input.bidders.filter((b) => b.eventId === event.id).length }))
    .filter(({ count }) => count > 0 && count < 3);
  if (thin.length > 0) {
    offers.push({
      id: `ag02-${thin[0].event.id}`,
      ...describe('AG-02'),
      title: `Find more suppliers for ${thin[0].event.eventNumber}`,
      detail: `${thin[0].count} invited — below the three where competitive tension starts. Candidates come from the master and from market signals.`,
      cta: 'Suggest suppliers',
      target: { kind: 'event', eventId: thin[0].event.id, tab: 'Bidders' },
    });
  }

  const scoring = journeysOf(input.events).filter((e) => e.status === 'RESPONSES_CLOSED' || e.status === 'UNDER_EVALUATION');
  if (scoring.length > 0) {
    offers.push({
      id: `ag06-${scoring[0].id}`,
      ...describe('AG-06'),
      title: `Propose technical scores for ${scoring[0].eventNumber}`,
      detail: 'Each score arrives with its confidence and the passage it was read from. Below threshold it degrades to assisted rather than guessing.',
      cta: 'Propose scores',
      target: { kind: 'event', eventId: scoring[0].id, tab: 'Evaluation' },
    });
  }

  const negotiating = journeysOf(input.events).filter((e) => e.status === 'IN_NEGOTIATION');
  if (negotiating.length > 0) {
    offers.push({
      id: `ag09-${negotiating[0].id}`,
      ...describe('AG-09'),
      title: `Recommend a counter-target on ${negotiating[0].eventNumber}`,
      detail: 'A target and a draft counter-offer, inside the mandate floor and the round limit set for this event.',
      cta: 'Open negotiation',
      target: { kind: 'event', eventId: negotiating[0].id, tab: 'Negotiation' },
    });
  }

  return offers.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Headline — the four numbers above the fold
// ---------------------------------------------------------------------------

export type EventKind = 'RFI' | 'RFP' | 'RFQ' | 'e-Auction';

/**
 * What a buyer calls a journey: the ask it is running now, or failing that the
 * last price-finding ask it will run. An auction with no RFQ or RFP in front of
 * it is an e-Auction in its own right.
 */
export function eventKindOf(event: SourcingEvent): EventKind {
  const current = event.currentStage;
  if (current === 'RFI' || current === 'RFP' || current === 'RFQ') return current;
  const stages = event.stagesEnabled;
  if (stages.includes('AUCTION') && !stages.includes('RFQ') && !stages.includes('RFP')) return 'e-Auction';
  if (current === 'AUCTION') return 'e-Auction';
  if (stages.includes('RFQ')) return 'RFQ';
  if (stages.includes('RFP')) return 'RFP';
  if (stages.includes('RFI')) return 'RFI';
  return 'RFQ';
}

export interface Coverage {
  invited: number;
  responded: number;
}

/**
 * Invited against responded, for a journey and every ask under it.
 *
 * A supplier invited to the RFP and again to the RFQ behind it is one supplier,
 * and responded if they submitted anywhere in the family — counting per ask
 * would make a three-stage journey look three times as well covered.
 */
export function coverageOf(input: HomeInput, eventId: Id): Coverage {
  const family = new Set<Id>([
    eventId,
    ...input.events.filter((e) => e.parentEventId === eventId).map((e) => e.id),
  ]);
  const bidders = input.bidders.filter((b) => family.has(b.eventId));
  const invited = new Set(bidders.map((b) => b.counterpartyId));
  const byBidder = new Map(bidders.map((b) => [b.id, b.counterpartyId]));
  const responded = new Set(
    input.responses
      .filter((r) => family.has(r.eventId) && r.submittedAt !== null && byBidder.has(r.bidderId))
      .map((r) => byBidder.get(r.bidderId)!),
  );
  return { invited: invited.size, responded: responded.size };
}

export interface HomeHeadline {
  needsAction: number;
  /** Actions on an event already past its deadline. */
  overdue: number;
  /** Deadlines inside 48 hours (overdue included), soonest first. */
  dueSoon: AgendaItem[];
  /** Further deadlines inside the week, after those. */
  dueThisWeek: number;
  liveCount: number;
  liveByKind: { kind: EventKind; count: number }[];
  /** Across every journey suppliers can act on now. Null when none has invitees. */
  coverage: Coverage | null;
}

export function homeHeadline(input: HomeInput): HomeHeadline {
  const actions = actionQueue(input, Number.POSITIVE_INFINITY);
  const deadlines = comingUp(input, Number.POSITIVE_INFINITY);
  const live = journeysOf(input.events).filter((e) => LIVE_TO_SUPPLIERS.includes(e.status));
  const kinds: EventKind[] = ['RFQ', 'RFP', 'RFI', 'e-Auction'];
  const coverages = live.map((e) => coverageOf(input, e.id)).filter((c) => c.invited > 0);
  return {
    needsAction: actions.length,
    overdue: actions.filter((a) => a.urgency === 'overdue').length,
    dueSoon: deadlines.filter((d) => d.at - input.now < 2 * DAY),
    dueThisWeek: deadlines.filter((d) => d.at - input.now >= 2 * DAY && d.at - input.now < 7 * DAY).length,
    liveCount: live.length,
    liveByKind: kinds
      .map((kind) => ({ kind, count: live.filter((e) => eventKindOf(e) === kind).length }))
      .filter((k) => k.count > 0),
    coverage: coverages.length === 0
      ? null
      : {
        invited: coverages.reduce((a, c) => a + c.invited, 0),
        responded: coverages.reduce((a, c) => a + c.responded, 0),
      },
  };
}

/** Bid coverage per open journey that has invited anyone, thinnest first. */
export function coverageByEvent(input: HomeInput): { event: SourcingEvent; coverage: Coverage }[] {
  return journeysOf(input.events)
    .filter(isOpen)
    .map((event) => ({ event, coverage: coverageOf(input, event.id) }))
    .filter(({ coverage }) => coverage.invited > 0)
    .sort((a, b) => a.coverage.responded / a.coverage.invited - b.coverage.responded / b.coverage.invited);
}

/** Journeys published against journeys awarded, per week. */
export function throughputSeries(input: HomeInput): { labels: string[]; published: number[]; awarded: number[] } {
  const journeys = journeysOf(input.events);
  return {
    labels: weekLabels(input.now),
    published: weeklyCounts(journeys.map((e) => e.publishedAt), input.now),
    awarded: weeklyCounts(journeys.map((e) => e.awardedAt), input.now),
  };
}

export interface WaitingDemand {
  requisition: SourcingRequisition;
  value: number;
  /** Days since the demand was consolidated without an event. */
  ageDays: number;
}

/** Consolidated demand that never became an event, oldest first. */
export function demandWaiting(input: HomeInput): WaitingDemand[] {
  const lines = new Map(input.purchaseRequestLines.map((l) => [l.id, l]));
  return input.requisitions
    .filter((r) => r.eventId === null)
    .map((requisition) => ({
      requisition,
      value: requisition.lineIds.reduce((a, id) => {
        const l = lines.get(id);
        return a + (l ? l.quantity * (l.indicativePrice ?? 0) : 0);
      }, 0),
      ageDays: Math.max(0, Math.floor((input.now - requisition.createdAt) / DAY)),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

// ---------------------------------------------------------------------------
// The ask box
// ---------------------------------------------------------------------------

export interface HomeAnswer {
  answer: string;
  target: HomeTarget | null;
  /** What the answer was read off, so it can be checked rather than believed. */
  basis: string;
}

/**
 * Answer a typed question from the tenant's own records.
 *
 * Keyword matching over what this screen already computed, not a model. The
 * distinction matters and is stated in the panel: an answer here is arithmetic
 * over records the buyer can open, so it is either right or visibly wrong.
 * Anything outside that is refused and handed to the agent console rather than
 * guessed at, because a sourcing assistant that improvises is a liability.
 */
export function answerHomeQuestion(input: HomeInput, question: string): HomeAnswer {
  const text = question.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const journeys = journeysOf(input.events);
  const money = (value: number) => `${input.currency} ${Math.round(value).toLocaleString('en-IN')}`;

  if (has('approval', 'approve', 'nfa', 'sign off')) {
    const approving = journeys.filter((e) => APPROVING.includes(e.status));
    return {
      answer: approving.length === 0
        ? 'Nothing is sitting with an approver right now.'
        : `${approving.length} award${approving.length === 1 ? ' is' : 's are'} with an approver: ${approving.map((e) => e.eventNumber).join(', ')}.`,
      target: { kind: 'approvals' },
      basis: 'Event status',
    };
  }
  if (has('question', 'clarif', 'supplier ask')) {
    const open = input.clarifications.filter((c) => c.answer === null);
    return {
      answer: open.length === 0
        ? 'Every supplier question has been answered.'
        : `${open.length} supplier ${open.length === 1 ? 'question is' : 'questions are'} unanswered. A substantive answer is broadcast to everyone invited.`,
      target: open.length > 0 ? { kind: 'event', eventId: open[0].eventId, tab: 'Clarifications' } : null,
      basis: 'Clarifications',
    };
  }
  if (has('auction', 'live', 'cockpit')) {
    const live = input.events.filter((e) => e.status === 'AUCTION_LIVE');
    return {
      answer: live.length === 0
        ? 'No auction is live at the moment.'
        : `${live.length} auction${live.length === 1 ? ' is' : 's are'} live: ${live.map((e) => e.eventNumber).join(', ')}.`,
      target: { kind: 'list', stage: 'AUCTION' },
      basis: 'Event status',
    };
  }
  if (has('value', 'spend', 'worth', 'flight', 'budget')) {
    const performance = homePerformance(input);
    return {
      answer: `${money(performance.inFlightValue)} is in flight across ${journeys.filter(isOpen).length} open journeys, and ${money(performance.awardedValue)} has been awarded.`,
      target: { kind: 'board' },
      basis: 'Estimated value on each event',
    };
  }
  if (has('demand', 'requisition', 'unsourced', 'pr ', 'purchase request')) {
    const unsourced = input.purchaseRequestLines.filter((l) => l.sourcingState === 'UNSOURCED').length;
    return {
      answer: unsourced === 0
        ? 'Every approved requisition line is in an event.'
        : `${unsourced} approved requisition ${unsourced === 1 ? 'line has' : 'lines have'} no event raised against them.`,
      target: { kind: 'intake' },
      basis: 'Requisition line sourcing state',
    };
  }
  if (has('evaluat', 'score', 'compare')) {
    const evaluating = journeys.filter((e) => EVALUATING.includes(e.status));
    return {
      answer: evaluating.length === 0
        ? 'Nothing is waiting on an evaluation.'
        : `${evaluating.length} ${evaluating.length === 1 ? 'event is' : 'events are'} waiting on evaluation: ${evaluating.map((e) => e.eventNumber).join(', ')}.`,
      target: { kind: 'board' },
      basis: 'Event status',
    };
  }
  return {
    answer: 'This box answers from the records on this tenant — approvals, questions, auctions, value, demand and evaluations. For anything that needs drafting or judgement, the named agents in the console do it under a published mandate.',
    target: { kind: 'agents' },
    basis: 'No matching record',
  };
}
