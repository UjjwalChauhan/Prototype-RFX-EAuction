/**
 * Turning one filled-in wizard into the events it actually implies.
 *
 * A buyer fills in the Create Event wizard once — basics, items, bidders,
 * questionnaires, terms, evaluation, auction, timeline — and presses publish.
 * A Full Ladder journey does not produce one thing to work on: it produces an
 * RFI to issue now, an RFP to issue after it, an RFQ after that, and an
 * auction at the end. Each of those is a separate ask with its own number, its
 * own deadline, its own invitations and its own inbox of responses, and each
 * belongs in its own section of the platform.
 *
 * So one publish creates a *family*:
 *
 *   SRC-2026-0007  the sourcing event on the board — the umbrella
 *     ├─ RFI-2026-0011   issued now
 *     ├─ RFP-2026-0012   planned, issued when the RFI closes
 *     ├─ RFQ-2026-0013   planned
 *     └─ AUC-2026-0014   planned
 *
 * Two rules keep this from turning into four copies of the same event:
 *
 * - **One basket.** Lots and lines belong to the umbrella. A stage event
 *   inherits them, so re-lotting at RFQ time cannot leave the RFP describing
 *   something else.
 * - **Invitations belong to the ask, not the umbrella.** A supplier is invited
 *   to the RFI; whether they are invited to the RFP is a later decision. That
 *   is also what lets the portal show a supplier four separate asks with four
 *   separate deadlines rather than one event with a list of stages.
 *
 * Everything here is pure: same input, same clock, same numbers out. The HTTP
 * API and the in-app wizard both go through these functions, which is what
 * makes them one behaviour rather than two that agree today.
 */
import { BASE_CURRENCY } from './config';
import { JOURNEY_PATTERNS, STAGE_LABELS } from './journeyPatterns';
import {
  buildSchedule, resolveTimelineRules, validateSchedule,
  type StageSchedule, type StageWindow, type TimelineRules,
} from './eventTimeline';
import {
  describeTerms, validateTerms, type TermsDocument, type TermsDocumentInput,
} from './terms';
import { buildAuction, type BuiltAuction } from './auctionSetup';
import type {
  AuctionMechanism, CreatedFrom, EnvelopeMode, EventBidder, EventStatus, FeedbackPolicy, Id,
  IdentityPolicy, JourneyPatternId, LineItem, Lot, Question, Questionnaire, ServerMillis, Side,
  SourcingEvent, Stage, VendorInputPoint,
} from './types';

// ---------------------------------------------------------------------------
// Which stages become events of their own
// ---------------------------------------------------------------------------

/**
 * The stages that put a solicitation in front of a supplier as an ask of its
 * own. Evaluation, negotiation, award and approval are work the buyer does on
 * the umbrella — they are not something a supplier is sent.
 */
export const SOLICITATION_STAGES = ['RFI', 'RFP', 'RFQ', 'AUCTION'] as const;

export type SolicitationStage = (typeof SOLICITATION_STAGES)[number];

export function isSolicitationStage(stage: Stage): stage is SolicitationStage {
  return (SOLICITATION_STAGES as readonly string[]).includes(stage);
}

/**
 * Whether an event is an ask created under a sourcing event.
 *
 * Not simply "has a parent": a re-auction on a balance quantity also carries a
 * parent, and it is a whole event with a journey of its own, not one ask. An
 * ask is the narrower thing — a single solicitation stage, hanging off the
 * event that raised it.
 */
export function isStageEvent(event: SourcingEvent): boolean {
  return event.parentEventId !== null
    && event.stagesEnabled.length === 1
    && isSolicitationStage(event.stagesEnabled[0]);
}

/** The stage events a journey pattern produces, in the order it runs them. */
export function solicitationStagesOf(pattern: JourneyPatternId): SolicitationStage[] {
  return JOURNEY_PATTERNS[pattern].stages.filter(isSolicitationStage);
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** The umbrella carries its own prefix so it is never mistaken for an ask. */
export const SOURCING_PREFIX = 'SRC';

export const STAGE_PREFIX: Record<SolicitationStage, string> = {
  RFI: 'RFI', RFP: 'RFP', RFQ: 'RFQ', AUCTION: 'AUC',
};

/**
 * Auctions are numbered in a series of their own.
 *
 * Not `AUC`: that is the *ask* that holds an auction, and two objects sharing
 * a prefix and an adjacent number is how a supplier ends up quoting one and
 * meaning the other. `EA-2026-0001` points at exactly one thing.
 */
export const AUCTION_PREFIX = 'EA';

/**
 * The next number in a series, derived from the numbers already taken rather
 * than from a counter held somewhere else. Two callers looking at the same set
 * of events agree without having to share a sequence.
 */
export function nextEventNumber(taken: readonly string[], prefix: string, year: number): string {
  const head = `${prefix}-${year}-`;
  const highest = taken
    .filter((number) => number.startsWith(head))
    .map((number) => Number.parseInt(number.slice(head.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${head}${String(highest + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// The request — one field group per wizard step
// ---------------------------------------------------------------------------

/** Step 2. A line as the buyer entered or imported it, before it is lotted. */
export interface EventLineInput {
  itemCode?: string;
  description: string;
  specification?: string;
  quantity: number;
  uom: string;
  deliveryLocation?: string;
  /** ISO date the requisition needs it by. */
  needBy?: string;
  baselinePrice?: number | null;
  baselineSource?: LineItem['baselineSource'];
  /** The lot this line is bid, ranked and awarded in. */
  lotName: string;
  /** The category it was requisitioned under — the shortlist is built per one. */
  category?: string;
  superCategory?: string | null;
  /** Traceability: PR line → event line → bid → award line → PO line. */
  sourcePrLineId?: Id | null;
  isOptional?: boolean;
  allowAlternate?: boolean;
}

/** Step 3. Who is asked. Category scopes a supplier to the lines they can bid. */
export interface BidderInput {
  counterpartyId: Id;
  category?: string;
  isProvisional?: boolean;
  bidOnBehalfAllowed?: boolean;
  qualificationSnapshot?: number;
  performanceRatingSnapshot?: number;
}

/** A question as posted. Ids are assigned here so a caller need not invent them. */
export type QuestionInput =
  Omit<Question, 'id' | 'questionnaireId'> & { id?: Id; questionnaireId?: Id };

/** Step 4. What this event asks, at the point it asks it. */
export interface QuestionnaireInput {
  point: VendorInputPoint;
  name?: string;
  questions: QuestionInput[];
}

/**
 * Step 5. The terms the event goes out with.
 *
 * A list rather than a flag: general conditions, payment terms, and whatever
 * else the category needs, each naming the asks it applies at. See
 * `domain/terms.ts`.
 */
export type TermsInput = TermsDocumentInput[];

/** Step 6. */
export interface EvaluationInput {
  envelopeMode?: EnvelopeMode;
  technicalGate?: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
  minTechnicalScore?: number;
  technicalWeight?: number;
  commercialWeight?: number;
}

/**
 * Step 7.
 *
 * What a buyer chooses about the auction. Everything else an auction needs —
 * who holds the clock, whether the rounds are discrete, how it closes — follows
 * from the mechanism and is derived in `domain/auctionSetup`, not asked for.
 */
export interface AuctionInput {
  mechanism?: AuctionMechanism;
  feedbackPolicy?: FeedbackPolicy;
  minDecrement?: number;
  softClose?: boolean;
  /** Whether a bidder's competitors are named to them. Masked by default. */
  identityPolicy?: IdentityPolicy;
  proxyBidding?: boolean;
}

/**
 * Step 8. When each ask opens and closes, and the rules for moving those dates.
 *
 * Windows run back to back by default: the RFP opens when the RFI closes. That
 * is the honest default — a ladder is sequential, and a supplier cannot answer
 * an RFP written against answers they have not given yet. A buyer who sets a
 * window by hand in `windows` gets exactly that window.
 *
 * The rules apply to every ask the journey creates, and are frozen onto each of
 * them at publish. See `domain/eventTimeline.ts`.
 */
export interface TimelineInput {
  /** When the first ask opens. Defaults to the moment of publish. */
  opensAt?: ServerMillis;
  /** How long each ask stays open, unless `stageHours` says otherwise. */
  closesInHours?: number;
  stageHours?: Partial<Record<SolicitationStage, number>>;
  /** Windows the buyer set by hand. Used verbatim rather than derived. */
  windows?: Partial<Record<SolicitationStage, { opensAt: ServerMillis; closesAt: ServerMillis }>>;
  /** Extension limits, clarification cutoff, notification and cascade policy. */
  rules?: Partial<TimelineRules>;
}

/** Everything the nine wizard steps collect, as one request. */
export interface SourcingEventInput {
  // 1 — Basics
  journeyPattern: JourneyPatternId;
  title: string;
  description?: string;
  side?: Side;
  category: string;
  businessUnit: string;
  currency?: string;
  ownerId: Id;
  tenantId?: Id;
  project?: string | null;
  costCentre?: string | null;
  createdFrom?: CreatedFrom;
  /** The consolidated demand this was raised against, e.g. PRD-2026-0004. */
  sourceReference?: string | null;
  sourcingRequisitionId?: Id | null;
  // 2 — Items & Lots
  lines: EventLineInput[];
  // 3 — Bidders
  bidders?: BidderInput[];
  // 4 — Questionnaire
  questionnaires?: QuestionnaireInput[];
  // 5 — Terms
  terms?: TermsInput;
  // 6 — Evaluation
  evaluation?: EvaluationInput;
  // 7 — Auction
  auction?: AuctionInput;
  // 8 — Timeline
  timeline?: TimelineInput;
  // 9 — Review
  /** False creates the family as drafts — nothing reaches a supplier. */
  publish?: boolean;
}

/**
 * Creating one ask directly, rather than through a journey.
 *
 * Everything is optional because an ask added to an event that already exists
 * inherits what it does not restate — its title, its owner, its basket and the
 * shortlist already invited to the asks beside it.
 */
export interface StageEventInput
  extends Partial<Omit<SourcingEventInput, 'journeyPattern' | 'lines'>> {
  journeyPattern?: JourneyPatternId;
  /** Omitted when the ask hangs off a parent — the basket is inherited. */
  lines?: EventLineInput[];
  parentEventId?: Id | null;
}

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

/**
 * Everything one publish creates. Returned whole rather than as an id, because
 * both callers — the reducer and the HTTP client — need every record to show
 * the result without a second round trip.
 */
export interface CreatedEvents {
  /** The umbrella on the sourcing board. */
  event: SourcingEvent;
  /** The asks, in the order the journey issues them. */
  stageEvents: SourcingEvent[];
  lots: Lot[];
  lineItems: LineItem[];
  bidders: EventBidder[];
  questionnaires: Questionnaire[];
  /**
   * The terms, owned by the sourcing event and applied at the points each one
   * names. One document applying at RFP and RFQ is one row, not two.
   */
  terms: TermsDocument[];
  /**
   * The auction the journey implies, ready to run.
   *
   * Null for a journey with no auction stage. Present as the mechanism, the
   * clock and a starting price per lot — an auction ask with no auction behind
   * it is a row on the board that no cockpit can open and no supplier can bid
   * into, which is exactly what it used to be.
   */
  auction: BuiltAuction | null;
  /** Requisition lines this event takes out of the sourceable pool. */
  sourcedLineIds: Id[];
}

export interface CreateContext {
  now: ServerMillis;
  /** Numbers already in use, so a new one cannot collide with them. */
  takenNumbers?: readonly string[];
  /** Id stem for everything created. Deterministic in a test, unique in life. */
  idPrefix?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface FieldError {
  field: string;
  message: string;
}

const isBlank = (value: string | undefined | null): boolean =>
  value === undefined || value === null || value.trim().length === 0;

/**
 * What must be true before an event can be created at all.
 *
 * Deliberately the same set the wizard's Review step blocks on, so an event
 * posted to the API cannot be in a state the UI would have refused to create.
 */
export function validateSourcingEventInput(
  input: Partial<SourcingEventInput>,
  { requireLines = true, stages }: {
    requireLines?: boolean;
    /**
     * The asks actually being scheduled. Defaults to everything the journey
     * creates; one ask added to an existing event passes just that one, so its
     * window is not checked against a stage it is not.
     */
    stages?: readonly SolicitationStage[];
  } = {},
): FieldError[] {
  const errors: FieldError[] = [];
  const say = (field: string, message: string) => errors.push({ field, message });

  if (input.journeyPattern === undefined) {
    say('journeyPattern', 'A journey pattern is required.');
  } else if (JOURNEY_PATTERNS[input.journeyPattern] === undefined) {
    say('journeyPattern', `Unknown journey pattern "${input.journeyPattern}".`);
  }
  if (isBlank(input.title)) say('title', 'A title is required.');
  if (isBlank(input.category)) say('category', 'A category is required.');
  if (isBlank(input.businessUnit)) say('businessUnit', 'A business unit is required.');
  if (isBlank(input.ownerId)) say('ownerId', 'An owner is required.');

  const lines = input.lines ?? [];
  if (requireLines && lines.length === 0) {
    say('lines', 'At least one line is required — an event with no lines asks for nothing.');
  }
  lines.forEach((line, i) => {
    if (isBlank(line.description)) say(`lines[${i}].description`, 'A description is required.');
    if (isBlank(line.uom)) say(`lines[${i}].uom`, 'A unit of measure is required.');
    if (isBlank(line.lotName)) {
      say(`lines[${i}].lotName`, 'Every line sits in a lot; name the lot it belongs to.');
    }
    if (!(line.quantity > 0)) say(`lines[${i}].quantity`, 'Quantity must be greater than zero.');
  });

  const pattern = input.journeyPattern ? JOURNEY_PATTERNS[input.journeyPattern] : undefined;
  if (pattern && pattern.vendorInputPoints.length > 0 && (input.bidders ?? []).length === 0) {
    say('bidders', `${pattern.name} asks suppliers for something, so at least one is required.`);
  }
  if (pattern && input.side !== undefined && pattern.side !== 'ANY' && pattern.side !== input.side) {
    say('side', `${pattern.name} is a ${pattern.side}-side journey.`);
  }

  const hours = input.timeline?.closesInHours;
  if (hours !== undefined && !(hours > 0)) {
    say('timeline.closesInHours', 'A response window must be longer than zero hours.');
  }
  for (const [stage, stageHours] of Object.entries(input.timeline?.stageHours ?? {})) {
    if (!(Number(stageHours) > 0)) {
      say(`timeline.stageHours.${stage}`, 'A stage window must be longer than zero hours.');
    }
  }

  // The schedule is checked with the same function the Timeline step and the
  // extend dialog use, so an event cannot be published on dates a later screen
  // would call impossible.
  if (pattern) {
    const scheduled = stages ?? solicitationStagesOf(pattern.id);
    if (scheduled.length > 0) {
      const rules = resolveTimelineRules(input.timeline?.rules);
      const schedule = buildSchedule(
        scheduled,
        {
          // Anchored at the stated start, so "opens in the past" — which is
          // about the clock, not the input — cannot fire here.
          startAt: input.timeline?.opensAt ?? 0,
          defaultHours: input.timeline?.closesInHours ?? 72,
          stageHours: input.timeline?.stageHours,
          fixed: input.timeline?.windows,
        },
        rules,
      );
      for (const issue of validateSchedule(schedule, rules, input.timeline?.opensAt ?? 0)) {
        if (!issue.blocking) continue;
        say(`timeline.${issue.stage ? `${issue.stage.toLowerCase()}.` : ''}${issue.field}`, issue.message);
      }
    }
  }

  if (pattern && input.terms !== undefined) {
    for (const issue of validateTerms(input.terms, pattern.vendorInputPoints)) {
      if (!issue.blocking) continue;
      say(`terms${issue.documentId ? `.${issue.documentId}` : ''}.${issue.field}`, issue.message);
    }
  }

  const points = new Set<string>();
  (input.questionnaires ?? []).forEach((questionnaire, i) => {
    if (points.has(questionnaire.point)) {
      say(`questionnaires[${i}].point`, `Two questionnaires are given for ${questionnaire.point}.`);
    }
    points.add(questionnaire.point);
    if (pattern && !pattern.vendorInputPoints.includes(questionnaire.point)) {
      say(
        `questionnaires[${i}].point`,
        `${pattern.name} does not ask the supplier anything at ${questionnaire.point}.`,
      );
    }
  });

  const seen = new Set<Id>();
  (input.bidders ?? []).forEach((bidder, i) => {
    if (isBlank(bidder.counterpartyId)) {
      say(`bidders[${i}].counterpartyId`, 'A counterparty is required.');
    }
    const key = `${bidder.counterpartyId}::${bidder.category ?? ''}`;
    if (seen.has(key)) say(`bidders[${i}].counterpartyId`, 'This supplier is listed twice.');
    seen.add(key);
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const DEFAULT_HOURS = 72;

/**
 * One window per ask.
 *
 * Delegates to the scheduler in `eventTimeline` so the wizard's preview, the
 * publish and the extend dialog all lay out dates the same way — a schedule
 * that shifts by an hour depending on who computed it is a schedule nobody
 * trusts.
 */
export function stageWindows(
  stages: readonly SolicitationStage[], timeline: TimelineInput | undefined, now: ServerMillis,
): StageSchedule[] {
  return buildSchedule(
    stages,
    {
      startAt: timeline?.opensAt ?? now,
      defaultHours: timeline?.closesInHours ?? DEFAULT_HOURS,
      stageHours: timeline?.stageHours,
      fixed: timeline?.windows,
    },
    resolveTimelineRules(timeline?.rules),
  );
}

// ---------------------------------------------------------------------------
// Building the family
// ---------------------------------------------------------------------------

interface Resolved {
  tenantId: Id;
  timelineRules: TimelineRules;
  side: Side;
  currency: string;
  description: string;
  terms: TermsDocumentInput[];
  evaluation: Required<EvaluationInput>;
  auction: Required<AuctionInput>;
  publish: boolean;
}

const patternSide = (pattern: JourneyPatternId | undefined): Side | 'ANY' =>
  pattern === undefined ? 'ANY' : JOURNEY_PATTERNS[pattern]?.side ?? 'ANY';

function resolve(input: Partial<SourcingEventInput>): Resolved {
  return {
    tenantId: input.tenantId ?? 'tenant-udaan',
    timelineRules: resolveTimelineRules(input.timeline?.rules),
    // Side follows the journey when it is not stated: a disposal pattern is a
    // sell-side process whether or not the caller thought to say so.
    side: input.side ?? (patternSide(input.journeyPattern) === 'SELL' ? 'SELL' : 'BUY'),
    currency: input.currency ?? BASE_CURRENCY,
    description: input.description ?? '',
    terms: input.terms ?? [],
    evaluation: {
      envelopeMode: input.evaluation?.envelopeMode ?? 'SINGLE',
      technicalGate: input.evaluation?.technicalGate ?? 'NONE',
      minTechnicalScore: input.evaluation?.minTechnicalScore ?? 0,
      technicalWeight: input.evaluation?.technicalWeight ?? 0,
      commercialWeight: input.evaluation?.commercialWeight ?? 0,
    },
    auction: {
      mechanism: input.auction?.mechanism ?? 'ENGLISH',
      feedbackPolicy: input.auction?.feedbackPolicy ?? 'RANK_GAP',
      minDecrement: input.auction?.minDecrement ?? 1,
      softClose: input.auction?.softClose ?? true,
      identityPolicy: input.auction?.identityPolicy ?? 'MASKED',
      proxyBidding: input.auction?.proxyBidding ?? false,
    },
    publish: input.publish ?? true,
  };
}

/** The lots a basket implies, in the order the lines first name them. */
function buildLots(
  lines: EventLineInput[], eventId: Id, window: StageWindow | null,
): Lot[] {
  const names: string[] = [];
  for (const line of lines) if (!names.includes(line.lotName)) names.push(line.lotName);
  return names.map((name, i) => ({
    id: `${eventId}-lot-${i + 1}`,
    eventId,
    lotNumber: i + 1,
    name,
    description: '',
    sequence: i + 1,
    biddingOpenAt: window?.opensAt ?? null,
    biddingCloseAt: window?.closesAt ?? null,
    awardMode: 'SINGLE',
    minSuppliers: 1,
    maxSuppliers: null,
    reservePrice: null, targetPrice: null, ceilingPrice: null, floorPrice: null,
    status: 'LOT_PENDING',
  }));
}

function buildLineItems(
  lines: EventLineInput[], lots: Lot[], eventId: Id, currency: string,
): LineItem[] {
  const lotIdByName = new Map(lots.map((lot) => [lot.name, lot.id]));
  return lines.map((line, i) => ({
    id: `${eventId}-li-${i + 1}`,
    lotId: lotIdByName.get(line.lotName) ?? lots[0]?.id ?? `${eventId}-lot-1`,
    lineNumber: i + 1,
    itemCode: line.itemCode ?? '',
    description: line.description,
    specification: line.specification ?? '',
    quantity: line.quantity,
    uom: line.uom,
    deliveryLocation: line.deliveryLocation ?? '',
    deliveryDate: isBlank(line.needBy) ? null : line.needBy!,
    incoterm: null,
    taxClass: null,
    baselinePrice: line.baselinePrice ?? null,
    // A line off a requisition carries its indicative price as the baseline; a
    // line typed here is a budget figure until sourcing gives it a better one.
    baselineSource: line.baselineSource
      ?? (line.baselinePrice === undefined || line.baselinePrice === null
        ? null
        : line.sourcePrLineId ? 'PR' : 'BUDGET'),
    currency,
    isOptional: line.isOptional ?? false,
    allowAlternate: line.allowAlternate ?? false,
    sourcePrLineId: line.sourcePrLineId ?? null,
  }));
}

export function basketValue(lines: EventLineInput[]): number {
  return lines.reduce((total, line) => total + (line.baselinePrice ?? 0) * line.quantity, 0);
}

/** The invitations that put one ask in front of its shortlist. */
function buildBidders(
  shortlist: BidderInput[], eventId: Id, invitedAt: ServerMillis, invited: boolean,
): EventBidder[] {
  const unique: BidderInput[] = [];
  for (const bidder of shortlist) {
    // A supplier shortlisted under two categories of one event is one bidder.
    if (!unique.some((b) => b.counterpartyId === bidder.counterpartyId)) unique.push(bidder);
  }
  return unique.map((bidder, i) => ({
    id: `${eventId}-eb-${bidder.counterpartyId}`,
    eventId,
    counterpartyId: bidder.counterpartyId,
    isProvisional: bidder.isProvisional ?? false,
    // A planned ask has a shortlist but has not gone out yet. Recording an
    // invitation time it never had would be a lie the audit trail keeps, so it
    // stays null until the ask is issued.
    invitedAt: invited ? invitedAt : null,
    invitationStatus: 'SENT',
    declineReason: null,
    ndaAcceptedAt: null,
    participationStatus: 'NOT_STARTED',
    qualificationStatus: 'PENDING',
    awardStatus: 'NONE',
    qualificationSnapshot: bidder.qualificationSnapshot ?? 0,
    performanceRatingSnapshot: bidder.performanceRatingSnapshot ?? 0,
    bidOnBehalfAllowed: bidder.bidOnBehalfAllowed ?? false,
    maskedLabel: `Bidder ${String.fromCharCode(65 + i)}`,
    disqualified: false,
    disqualificationReason: null,
  }));
}

function buildQuestionnaire(
  questionnaire: QuestionnaireInput, eventId: Id, stage: Stage,
): Questionnaire {
  const questionnaireId = `${eventId}-qn-${stage.toLowerCase()}`;
  return {
    id: questionnaireId,
    eventId,
    stage,
    name: questionnaire.name ?? `${STAGE_LABELS[stage]} questionnaire`,
    questions: questionnaire.questions
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((question, i): Question => ({
        ...question,
        id: `${questionnaireId}-q${i + 1}`,
        questionnaireId,
      })),
  };
}

/**
 * The terms, owned by the event that raised them.
 *
 * Applied at the points each document names, so an ask resolves what it carries
 * rather than holding a copy that can drift from its siblings.
 */
function buildTerms(documents: TermsDocumentInput[], eventId: Id): TermsDocument[] {
  return documents.map((document, i) => ({
    ...document,
    id: document.id.startsWith(eventId) ? document.id : `${eventId}-terms-${i + 1}`,
    eventId,
    clauses: document.clauses.map((clause, c) => ({
      ...clause,
      id: `${eventId}-terms-${i + 1}-c${c + 1}`,
    })),
  }));
}

/** The configuration frozen onto an event so history stays reconstructable. */
function snapshot(resolved: Resolved, extra: Record<string, unknown> = {}) {
  return {
    // The time rules are frozen with the rest of the configuration: an
    // extension is judged against the rules the event was published under, not
    // against whatever the tenant default has since become.
    timelineRules: resolved.timelineRules,
    feedbackPolicy: resolved.auction.feedbackPolicy,
    mechanism: resolved.auction.mechanism,
    envelopeMode: resolved.evaluation.envelopeMode,
    minDecrement: resolved.auction.minDecrement,
    softClose: resolved.auction.softClose,
    technicalGate: resolved.evaluation.technicalGate,
    minTechnicalScore: resolved.evaluation.minTechnicalScore,
    // What went out, in one line, so an approver reading the snapshot months
    // later does not have to reconstruct it from the documents.
    terms: describeTerms(resolved.terms),
    ...extra,
  };
}

/**
 * Create the umbrella and every ask its journey implies.
 *
 * Throws on invalid input rather than returning a half-built family — a caller
 * that skipped `validateSourcingEventInput` should fail loudly, not quietly
 * publish something a supplier cannot answer.
 */
export function createSourcingEvent(
  input: SourcingEventInput, ctx: CreateContext,
): CreatedEvents {
  const errors = validateSourcingEventInput(input);
  if (errors.length > 0) {
    throw new InvalidEventInput(errors);
  }

  const resolved = resolve(input);
  const pattern = JOURNEY_PATTERNS[input.journeyPattern];
  const { now } = ctx;
  const year = new Date(now).getFullYear();
  const eventId = ctx.idPrefix ?? `evt-${now}`;
  const taken = [...(ctx.takenNumbers ?? [])];

  const stages = solicitationStagesOf(input.journeyPattern);
  const windows = stageWindows(stages, input.timeline, now);
  const opensAt = windows[0]?.opensAt ?? input.timeline?.opensAt ?? now;
  const closesAt = windows[windows.length - 1]?.closesAt ?? null;

  const estimatedValue = basketValue(input.lines);
  // Lots follow the money: they are bid in the auction when there is one, and
  // in the last written ask when there is not.
  const biddingWindow = windows.find((w) => w.stage === 'AUCTION')
    ?? windows[windows.length - 1]
    ?? null;
  const lots = buildLots(input.lines, eventId, biddingWindow);
  const lineItems = buildLineItems(input.lines, lots, eventId, resolved.currency);

  const takeNumber = (prefix: string) => {
    const number = nextEventNumber(taken, prefix, year);
    taken.push(number);
    return number;
  };

  const event: SourcingEvent = {
    id: eventId,
    tenantId: resolved.tenantId,
    eventNumber: takeNumber(SOURCING_PREFIX),
    title: input.title,
    description: resolved.description,
    side: resolved.side,
    templateId: null,
    journeyPattern: input.journeyPattern,
    businessUnit: input.businessUnit,
    category: input.category,
    project: input.project ?? null,
    costCentre: input.costCentre ?? null,
    currency: resolved.currency,
    estimatedValue,
    ownerId: input.ownerId,
    status: resolved.publish ? 'PUBLISHED' : 'DRAFT',
    createdFrom: input.createdFrom ?? (input.sourceReference ? 'PR' : 'MANUAL'),
    sourceReference: input.sourceReference ?? null,
    stagesEnabled: pattern.stages,
    currentStage: pattern.stages[0],
    envelopeMode: resolved.evaluation.envelopeMode,
    // The umbrella asks the supplier nothing itself — each ask does that, and
    // an invitation to the umbrella would show the supplier the same event
    // four times over.
    vendorInputPoints: stages.length === 0 ? pattern.vendorInputPoints : [],
    publishedAt: resolved.publish ? opensAt : null,
    closesAt,
    awardedAt: null,
    parentEventId: null,
    version: 1,
    configSnapshotAtPublish: resolved.publish
      ? snapshot(resolved, { journeyPattern: input.journeyPattern })
      : null,
  };

  const shortlist = input.bidders ?? [];
  const questionnaireOf = (stage: Stage) =>
    (input.questionnaires ?? []).find((q) => q.point === stage);

  const stageEvents: SourcingEvent[] = [];
  const bidders: EventBidder[] = [];
  const questionnaires: Questionnaire[] = [];

  windows.forEach((window, index) => {
    const { stage } = window;
    const stageId = `${eventId}-${stage.toLowerCase()}`;
    // The first ask goes out with the publish. The ones behind it are prepared
    // and scheduled, not issued — a supplier cannot be asked to answer an RFP
    // written against answers they have not given yet.
    const issued = resolved.publish && index === 0;
    const status: EventStatus = issued ? 'PUBLISHED' : 'DRAFT';

    stageEvents.push({
      ...event,
      id: stageId,
      eventNumber: takeNumber(STAGE_PREFIX[stage]),
      title: `${input.title} — ${STAGE_LABELS[stage]}`,
      stagesEnabled: [stage],
      currentStage: stage,
      vendorInputPoints: [stage],
      // The auction takes a live bid; sealing it against a technical envelope
      // is a written-stage idea and does not apply.
      envelopeMode: stage === 'AUCTION' ? 'SINGLE' : resolved.evaluation.envelopeMode,
      status,
      publishedAt: issued ? window.opensAt : null,
      closesAt: window.closesAt,
      parentEventId: eventId,
      configSnapshotAtPublish: snapshot(resolved, {
        stage, opensAt: window.opensAt, closesAt: window.closesAt,
      }),
    });

    bidders.push(...buildBidders(shortlist, stageId, window.opensAt, issued));

    const asked = questionnaireOf(stage);
    if (asked && asked.questions.length > 0) {
      questionnaires.push(buildQuestionnaire(asked, stageId, stage));
    }
  });

  // A journey with no solicitation stage — a call-off, or a requisition raised
  // against a quote already held — still has suppliers on it. They belong to
  // the umbrella, because there is nothing else for them to belong to.
  if (stageEvents.length === 0) {
    bidders.push(...buildBidders(shortlist, eventId, opensAt, resolved.publish));
    for (const point of pattern.vendorInputPoints) {
      const asked = questionnaireOf(point);
      if (asked && asked.questions.length > 0) {
        questionnaires.push(buildQuestionnaire(asked, eventId, point as Stage));
      }
    }
  }

  return {
    event,
    stageEvents,
    lots,
    lineItems,
    bidders,
    questionnaires,
    terms: buildTerms(resolved.terms, eventId),
    auction: auctionOf(
      stageEvents, lots, lineItems, resolved, now,
      () => takeNumber(AUCTION_PREFIX),
    ),
    sourcedLineIds: input.lines
      .map((line) => line.sourcePrLineId)
      .filter((id): id is Id => id !== undefined && id !== null),
  };
}

/**
 * The auction behind the auction ask, where the journey runs one.
 *
 * Its window is the ask's window rather than the family's, so an auction at the
 * end of a ladder opens when the RFQ in front of it has closed. The opening
 * price of each lot is the baseline value of what is in it — the indicative
 * figure the requisition carried, which is precisely what JP-01 means by "the
 * PR price becomes the auction start price".
 */
function auctionOf(
  stageEvents: SourcingEvent[], lots: Lot[], lineItems: LineItem[],
  resolved: Resolved, now: ServerMillis,
  /**
   * Allocates the auction's reference. A function rather than a string so a
   * journey with no auction in it does not burn a number on the way past.
   */
  takeAuctionNumber: () => string,
): BuiltAuction | null {
  const ask = stageEvents.find((stage) => stage.currentStage === 'AUCTION');
  if (!ask) return null;

  const valueOf = (lotId: Id) => lineItems
    .filter((line) => line.lotId === lotId)
    .reduce((total, line) => total + (line.baselinePrice ?? 0) * line.quantity, 0);

  return buildAuction({
    eventId: ask.id,
    auctionNumber: takeAuctionNumber(),
    side: resolved.side,
    config: {
      mechanism: resolved.auction.mechanism,
      feedbackPolicy: resolved.auction.feedbackPolicy,
      identityPolicy: resolved.auction.identityPolicy,
      minDecrement: resolved.auction.minDecrement,
      softClose: resolved.auction.softClose,
      proxyBidding: resolved.auction.proxyBidding,
    },
    lots: lots
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((lot) => ({ lot, startingPrice: valueOf(lot.id) })),
    opensAt: ask.publishedAt ?? lots[0]?.biddingOpenAt ?? null,
    closesAt: ask.closesAt,
    now,
  });
}

/**
 * Create one ask on its own.
 *
 * Two callers want this. A buyer adding an RFP to a sourcing event that was
 * already published passes `parent`, and the ask inherits the umbrella's
 * basket, currency and value — one basket, several asks. A caller creating a
 * standalone RFQ passes its own lines instead, and gets a one-ask family with
 * an umbrella of its own so it still reaches the board.
 */
export function createStageEvent(
  args: {
    stage: SolicitationStage;
    input: StageEventInput;
    parent?: SourcingEvent | null;
    /**
     * The umbrella's basket, so an auction added to an event that already
     * exists opens on the lots that event is actually bidding. Omitted, the ask
     * is still created — with no auction behind it, because there is nothing to
     * put a starting price on.
     */
    basket?: { lots: Lot[]; lineItems: LineItem[] };
  },
  ctx: CreateContext,
): CreatedEvents {
  const { stage, input, parent = null, basket } = args;

  if (parent === null) {
    // No umbrella to hang off: create the whole family for a journey that runs
    // this one stage, so the ask is never an orphan on the board. Everything a
    // family needs and an ask can inherit must be stated here, which is what
    // the validation on the way in is for.
    const errors = validateSourcingEventInput({
      ...input,
      journeyPattern: input.journeyPattern ?? DEFAULT_PATTERN_FOR[stage],
      lines: input.lines ?? [],
    });
    if (errors.length > 0) throw new InvalidEventInput(errors);
    return createSourcingEvent(
      {
        ...input,
        journeyPattern: input.journeyPattern ?? DEFAULT_PATTERN_FOR[stage],
        title: input.title!,
        category: input.category!,
        businessUnit: input.businessUnit!,
        ownerId: input.ownerId!,
        lines: input.lines ?? [],
      },
      ctx,
    );
  }

  // An ask added to an event that already exists restates only what differs.
  // Everything else is the umbrella's — including who owns it, which is not a
  // detail worth letting a caller get wrong.
  const merged: SourcingEventInput = {
    ...input,
    journeyPattern: input.journeyPattern ?? parent.journeyPattern,
    title: input.title?.trim() ? input.title : `${parent.title} — ${STAGE_LABELS[stage]}`,
    description: input.description ?? parent.description,
    side: input.side ?? parent.side,
    category: input.category ?? parent.category,
    businessUnit: input.businessUnit ?? parent.businessUnit,
    currency: input.currency ?? parent.currency,
    ownerId: input.ownerId ?? parent.ownerId,
    tenantId: input.tenantId ?? parent.tenantId,
    lines: input.lines ?? [],
  };

  const errors = validateSourcingEventInput(merged, { requireLines: false, stages: [stage] });
  if (errors.length > 0) throw new InvalidEventInput(errors);

  const resolved = resolve(merged);
  const { now } = ctx;
  const stageId = ctx.idPrefix ?? `${parent.id}-${stage.toLowerCase()}`;
  const [window] = stageWindows([stage], merged.timeline, now);
  const issued = resolved.publish;

  const event: SourcingEvent = {
    ...parent,
    id: stageId,
    eventNumber: nextEventNumber(
      ctx.takenNumbers ?? [], STAGE_PREFIX[stage], new Date(now).getFullYear(),
    ),
    title: merged.title,
    description: merged.description ?? parent.description,
    stagesEnabled: [stage],
    currentStage: stage,
    vendorInputPoints: [stage],
    envelopeMode: stage === 'AUCTION'
      ? 'SINGLE'
      : merged.evaluation?.envelopeMode ?? parent.envelopeMode,
    status: issued ? 'PUBLISHED' : 'DRAFT',
    publishedAt: issued ? window.opensAt : null,
    closesAt: window.closesAt,
    awardedAt: null,
    parentEventId: parent.id,
    version: 1,
    configSnapshotAtPublish: snapshot(resolved, {
      stage, opensAt: window.opensAt, closesAt: window.closesAt,
    }),
  };

  const asked = (merged.questionnaires ?? []).find((q) => q.point === stage);

  return {
    event,
    stageEvents: [event],
    // The basket stays on the umbrella. An ask that re-lotted it could describe
    // something the sibling asks do not.
    lots: [],
    lineItems: [],
    bidders: buildBidders(merged.bidders ?? [], stageId, window.opensAt, issued),
    questionnaires: asked && asked.questions.length > 0
      ? [buildQuestionnaire(asked, stageId, stage)]
      : [],
    // An ask added to an existing event inherits the umbrella's terms; it does
    // not bring a second set that could contradict them.
    terms: merged.terms === undefined ? [] : buildTerms(merged.terms, parent.id),
    auction: stage === 'AUCTION'
      ? auctionOf(
        [event], basket?.lots ?? [], basket?.lineItems ?? [], resolved, now,
        () => nextEventNumber(
          ctx.takenNumbers ?? [], AUCTION_PREFIX, new Date(now).getFullYear(),
        ),
      )
      : null,
    sourcedLineIds: [],
  };
}

/** The journey a standalone ask is treated as running, when none is given. */
export const DEFAULT_PATTERN_FOR: Record<SolicitationStage, JourneyPatternId> = {
  RFI: 'JP-05',
  RFP: 'JP-06',
  RFQ: 'JP-02',
  AUCTION: 'JP-01',
};

/** Raised when input that has not been validated turns out to be unusable. */
export class InvalidEventInput extends Error {
  readonly errors: FieldError[];

  constructor(errors: FieldError[]) {
    super(`Invalid event input: ${errors.map((e) => `${e.field} — ${e.message}`).join('; ')}`);
    this.name = 'InvalidEventInput';
    this.errors = errors;
  }
}

/**
 * Issue an ask that was created as planned.
 *
 * The schedule already says when it opens and closes; issuing is the buyer
 * deciding that moment has come, which is why it is an action rather than a
 * timer. Returns the event unchanged when it has already gone out.
 */
export function issueStageEvent(event: SourcingEvent, now: ServerMillis): SourcingEvent {
  if (event.status !== 'DRAFT') return event;
  return { ...event, status: 'PUBLISHED', publishedAt: now };
}
