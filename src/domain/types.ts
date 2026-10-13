/**
 * Domain model for the configurable RFx & E-Auction module.
 *
 * Source of truth: DATA_MODEL_REFERENCE.md and the Concepts notes.
 *
 * The single most important structural fact: RFI, RFP, RFQ, Negotiation and
 * Auction are *stages of one SourcingEvent*, not four objects. Everything in
 * this file hangs off SourcingEvent.
 */

export type Id = string;
/** Server-authoritative epoch milliseconds. Client clocks are never used for ranking. */
export type ServerMillis = number;

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

/**
 * BUY inverts every comparator against SELL. Set once at creation and
 * immutable thereafter — no screen ever hard-codes "lowest wins".
 */
export type Side = 'BUY' | 'SELL';

export type Stage =
  | 'INTAKE'
  | 'RFI'
  | 'RFP'
  | 'RFQ'
  | 'CLARIFICATION'
  | 'EVALUATION'
  | 'NEGOTIATION'
  | 'AUCTION'
  | 'AWARD'
  | 'APPROVAL';

export type EventStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'OPEN'
  | 'RESPONSES_CLOSED'
  | 'UNDER_EVALUATION'
  | 'IN_NEGOTIATION'
  | 'AUCTION_SCHEDULED'
  | 'AUCTION_LIVE'
  | 'AUCTION_CLOSED'
  | 'AWARD_RECOMMENDED'
  | 'PENDING_AWARD_APPROVAL'
  | 'AWARD_PENDING_ONBOARDING'
  | 'AWARDED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'ON_HOLD';

export type CreatedFrom = 'PR' | 'INTAKE' | 'CONTRACT_EXPIRY' | 'SHORT_CLOSE' | 'MANUAL' | 'AGENT';
export type EnvelopeMode = 'SINGLE' | 'TWO_ENVELOPE';
export type VendorInputPoint = 'INTAKE' | 'RFI' | 'RFP' | 'RFQ' | 'AUCTION' | 'NEGOTIATION';

export interface SourcingEvent {
  id: Id;
  tenantId: Id;
  eventNumber: string;
  title: string;
  description: string;
  /** Immutable after creation. */
  side: Side;
  templateId: Id | null;
  journeyPattern: JourneyPatternId;
  businessUnit: string;
  category: string;
  project: string | null;
  costCentre: string | null;
  currency: string;
  estimatedValue: number;
  ownerId: Id;
  status: EventStatus;
  createdFrom: CreatedFrom;
  sourceReference: string | null;
  stagesEnabled: Stage[];
  currentStage: Stage;
  envelopeMode: EnvelopeMode;
  vendorInputPoints: VendorInputPoint[];
  publishedAt: ServerMillis | null;
  closesAt: ServerMillis | null;
  awardedAt: ServerMillis | null;
  /** Re-auction / short-close lineage. */
  parentEventId: Id | null;
  version: number;
  /** Resolved configuration frozen at publish, so history is reconstructable. */
  configSnapshotAtPublish: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Purchase requests — the demand a sourcing event is raised against
// ---------------------------------------------------------------------------

/**
 * A requisition header. The amount is deliberately *not* stored: it is the sum
 * of its lines, so a header and its expanded detail can never disagree.
 */
export type PrStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVAL'
  | 'APPROVED'
  | 'SOURCING'
  | 'PARTIALLY_SOURCED'
  | 'CLOSED'
  | 'REJECTED';

/**
 * What has happened to a requisition line from the sourcing side. This is the
 * RFx view of a PR: a line is demand that is either waiting to be sourced, out
 * in an event, already awarded, or covered by a standing contract.
 */
export type PrLineSourcingState =
  | 'UNSOURCED'
  | 'IN_EVENT'
  | 'AWARDED'
  | 'ON_CONTRACT'
  | 'CANCELLED';

export interface PurchaseRequest {
  id: Id;
  tenantId: Id;
  requestNumber: string;
  title: string;
  category: string;
  /** The parent category in the spend taxonomy. Shown as "-" when unclassified. */
  superCategory: string | null;
  status: PrStatus;
  submittedOn: string;
  submittedById: Id;
  submittedByName: string;
  /** Employee code, shown under the name in the list. */
  submittedByCode: string;
  businessUnit: string;
  costCentre: string;
  currency: string;
  needBy: string;
  deliveryLocation: string;
  justification: string;
}

export interface PurchaseRequestLine {
  id: Id;
  requestId: Id;
  lineNumber: number;
  itemCode: string;
  description: string;
  specification: string;
  quantity: number;
  uom: string;
  needBy: string;
  deliveryLocation: string;
  /** The requisitioner's indicative price. Never a baseline on its own. */
  indicativePrice: number | null;
  currency: string;
  sourcingState: PrLineSourcingState;
  /** The event this line went out in, once it has been sourced. */
  eventNumber: string | null;
  hasVendorQuote: boolean;
  isCatalogItem: boolean;
}

/**
 * A consolidated demand: the system-assigned object that maps one sourcing
 * event back to the many requisition lines it was raised for.
 *
 * This is what makes "source these 40 lines from six different requisitions"
 * traceable. The event carries one `sourceReference` — the PRD id — and the PRD
 * carries the RQ numbers and the specific lines, so an award line can be walked
 * back to the requisition that asked for it.
 */
export interface SourcingRequisition {
  id: Id;
  /** System-assigned. Never typed by a user. */
  prdNumber: string;
  tenantId: Id;
  /** The requisition lines consolidated into this demand. */
  lineIds: Id[];
  /** The requisitions those lines came from, in number order. */
  requestNumbers: string[];
  /** Single category by construction — a mixed-category basket is refused. */
  category: string;
  superCategory: string | null;
  /** Every business unit represented, dominant first. */
  businessUnits: string[];
  currency: string;
  createdBy: Id;
  createdAt: ServerMillis;
  /** Set once the event is published against it. */
  eventId: Id | null;
}

// ---------------------------------------------------------------------------
// Journey patterns
// ---------------------------------------------------------------------------

export type JourneyPatternId =
  | 'JP-01' | 'JP-02' | 'JP-03' | 'JP-04' | 'JP-05' | 'JP-06' | 'JP-07'
  | 'JP-08' | 'JP-09' | 'JP-10' | 'JP-11' | 'JP-12' | 'JP-13';

export interface JourneyPattern {
  id: JourneyPatternId;
  name: string;
  description: string;
  stages: Stage[];
  vendorInputPoints: VendorInputPoint[];
  side: Side | 'ANY';
  /** Wizard steps this pattern needs. The stepper reshapes; work is never lost. */
  wizardSteps: string[];
  typicalDuration: string;
  serves: string;
}

// ---------------------------------------------------------------------------
// Lots and line items
// ---------------------------------------------------------------------------

export type LotStrategy = 'INDEPENDENT' | 'SERIAL' | 'PARALLEL' | 'STAGGERED';
export type BiddingLevel = 'LOT' | 'LINE' | 'BOTH';
export type AwardMode = 'SINGLE' | 'SPLIT';
export type LotStatus = 'LOT_PENDING' | 'LOT_OPEN' | 'LOT_CLOSING' | 'LOT_CLOSED';
export type BaselineSource = 'PR' | 'LPP' | 'PO' | 'GRN' | 'BUDGET' | 'SHOULD_COST' | 'INDEX';

export interface Lot {
  id: Id;
  eventId: Id;
  lotNumber: number;
  name: string;
  description: string;
  sequence: number;
  biddingOpenAt: ServerMillis | null;
  biddingCloseAt: ServerMillis | null;
  awardMode: AwardMode;
  minSuppliers: number | null;
  maxSuppliers: number | null;
  /** Internal-only. Never leaves the buyer boundary. */
  reservePrice: number | null;
  /** Internal-only. Drives traffic-light feedback; never a hard constraint. */
  targetPrice: number | null;
  /** Hard bid-validation bounds. */
  ceilingPrice: number | null;
  floorPrice: number | null;
  status: LotStatus;
}

export interface LineItem {
  id: Id;
  lotId: Id;
  lineNumber: number;
  itemCode: string;
  description: string;
  specification: string;
  quantity: number;
  uom: string;
  deliveryLocation: string;
  deliveryDate: string | null;
  incoterm: string | null;
  taxClass: string | null;
  baselinePrice: number | null;
  baselineSource: BaselineSource | null;
  currency: string;
  isOptional: boolean;
  allowAlternate: boolean;
  /** Traceability: PR line -> event line -> bid -> award line -> PO line. */
  sourcePrLineId: Id | null;
}

// ---------------------------------------------------------------------------
// Bidders
// ---------------------------------------------------------------------------

/** Invitation and participation are two independent axes. Never one column. */
export type InvitationStatus = 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'REVOKED';
export type ParticipationStatus =
  | 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'WITHDRAWN'
  | 'REGISTERED' | 'JOINED' | 'BIDDING' | 'IDLE' | 'DROPPED_OUT' | 'ELIMINATED';
export type QualificationStatus = 'PENDING' | 'QUALIFIED' | 'DISQUALIFIED' | 'SHORTLISTED' | 'NOT_SHORTLISTED';
export type AwardStatus = 'NONE' | 'AWARDED' | 'PARTIALLY_AWARDED' | 'REGRETTED';

export interface Counterparty {
  id: Id;
  name: string;
  /** Compliance / categories / locations served. Distinct from performance. */
  onboardingRating: number;
  /** RFx, auction, award, fulfilment, commercial. Distinct from onboarding. */
  performanceRating: number;
  categoriesServed: string[];
  locationsServed: string[];
  /** Invited but not yet on the master. Can bid; must be onboarded before award. */
  isProvisional: boolean;
  contactEmail: string;
}

export interface EventBidder {
  id: Id;
  eventId: Id;
  counterpartyId: Id;
  isProvisional: boolean;
  invitedAt: ServerMillis | null;
  invitationStatus: InvitationStatus;
  declineReason: string | null;
  ndaAcceptedAt: ServerMillis | null;
  participationStatus: ParticipationStatus;
  qualificationStatus: QualificationStatus;
  awardStatus: AwardStatus;
  /** Frozen at invite so a later master change cannot rewrite history. */
  qualificationSnapshot: number;
  performanceRatingSnapshot: number;
  bidOnBehalfAllowed: boolean;
  /** "Bidder A" — used under MASKED identity policy and blind technical. */
  maskedLabel: string;
  disqualified: boolean;
  disqualificationReason: string | null;
}

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

export type QuestionEnvelope = 'TECHNICAL' | 'COMMERCIAL' | 'GENERAL';
export type ScoringMethod = 'MANUAL' | 'RULE' | 'AI_ASSISTED' | 'AI_AUTO' | 'NONE';

export type QuestionType =
  // basic
  | 'short_text' | 'long_text' | 'number' | 'yes_no' | 'single_choice'
  | 'multiple_choice' | 'file_upload' | 'date'
  // sourcing
  | 'price_schedule' | 'rate_table' | 'quantity_break' | 'compliance_statement'
  | 'certificate' | 'matrix_rating' | 'capacity_declaration' | 'reference_submission'
  | 'lead_time' | 'currency_payment_terms'
  // structural
  | 'section' | 'page_break' | 'instruction_block' | 'repeating_group' | 'conditional_group'
  // advanced
  | 'calculated_field' | 'lookup' | 'signature' | 'table' | 'hidden_metadata';

/**
 * One selectable answer.
 *
 * `score` is what the choice is worth under RULE scoring — the thing that turns
 * a rubric written in prose ("DDP = 10 · DAP = 7") into something the system can
 * actually compute. `isDisqualifying` is what a knockout question fires on:
 * without it a knockout has no trigger and can never fail anyone.
 */
export interface QuestionOption {
  id: Id;
  label: string;
  /** Points under RULE scoring. Null when a human scores the answer. */
  score: number | null;
  /** Choosing this fails the question. A knockout needs at least one. */
  isDisqualifying: boolean;
  /** "Other — please specify": free text must accompany the choice. */
  requiresDetail: boolean;
}

/**
 * The answer format for one question — the fields that only make sense once a
 * type is chosen. A multiple choice needs a list of choices; a number needs
 * bounds and a unit; a file upload needs formats.
 *
 * Rather than a union of twenty-six shapes, each type declares the *facets* it
 * uses in `QUESTION_TYPE_SPEC`, and only those keys are ever read or edited.
 * Changing a question's type carries over the facets the two types share and
 * drops the rest, so a stale key can never quietly drive behaviour.
 */
export interface QuestionConfig {
  /** Choice types: the list the supplier picks from. */
  options?: QuestionOption[];
  minSelections?: number | null;
  maxSelections?: number | null;
  min?: number | null;
  max?: number | null;
  unit?: string;
  decimals?: number;
  maxLength?: number | null;
  acceptedFormats?: string[];
  maxFileSizeMb?: number | null;
  earliest?: string | null;
  latest?: string | null;
  /** Row labels for a matrix; column headers for a table, rate card or grid. */
  rows?: string[];
  columns?: string[];
  formula?: string;
  /** Clause text, instructions, declaration — whatever the type shows verbatim. */
  body?: string;
}

export interface Question {
  id: Id;
  questionnaireId: Id;
  sectionId: Id | null;
  sequence: number;
  /** Stable code — enables answer inheritance across stages and reporting. */
  code: string;
  type: QuestionType;
  title: string;
  helpText: string;
  isRequired: boolean;
  /** A permissions boundary, not a layout preference. */
  envelope: QuestionEnvelope;
  weight: number;
  scoringMethod: ScoringMethod;
  maxScore: number;
  rubric: string | null;
  isKnockout: boolean;
  allowAttachment: boolean;
  /** Answer format. Carried from the template the question came from. */
  config?: QuestionConfig;
}

export interface Questionnaire {
  id: Id;
  eventId: Id;
  stage: Stage;
  name: string;
  questions: Question[];
}

// ---------------------------------------------------------------------------
// Questionnaire templates — configured once, applied at many stages
// ---------------------------------------------------------------------------

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

/**
 * Sections group questions; they do not carry their own weight. A section's
 * share is the sum of the scored questions inside it, so a declared weight
 * could disagree with its own contents — the same header/detail drift the
 * requisition amount is derived to avoid.
 */
export interface TemplateSection {
  id: Id;
  name: string;
  sequence: number;
}

/**
 * A question as it exists in a template — the same shape the event-level
 * `Question` carries, bound to a template rather than to one event's
 * questionnaire. The template is where the answer format is authored, so
 * `config` is required here and optional on the event-level question that
 * inherits it.
 */
export interface TemplateQuestion {
  id: Id;
  templateId: Id;
  sectionId: Id | null;
  sequence: number;
  /**
   * Stable code. Two templates that ask the same thing at different stages
   * share a code, which is what lets an answer given at RFI be carried into
   * RFP rather than asked twice.
   */
  code: string;
  type: QuestionType;
  title: string;
  helpText: string;
  isRequired: boolean;
  envelope: QuestionEnvelope;
  weight: number;
  scoringMethod: ScoringMethod;
  maxScore: number;
  rubric: string | null;
  isKnockout: boolean;
  allowAttachment: boolean;
  /** The answer format — which keys apply is decided by `type`. */
  config: QuestionConfig;
}

export interface QuestionnaireTemplate {
  id: Id;
  /** Stable across versions, e.g. QT-RFI-CAPABILITY. */
  code: string;
  name: string;
  description: string;
  /**
   * The points in the journey where this template may be put in front of a
   * supplier. A template is not tied to one stage — the same capability set is
   * routinely asked at RFI and re-confirmed at RFP.
   */
  appliesTo: VendorInputPoint[];
  /** Categories this template serves. Empty means any category. */
  categories: string[];
  sections: TemplateSection[];
  questions: TemplateQuestion[];
  status: TemplateStatus;
  version: number;
  scopeType: ConfigScopeType;
  scopeId: Id;
  createdBy: Id;
  createdAt: ServerMillis;
}

/**
 * How much the questionnaire at each vendor input point contributes to the
 * technical score. An event that asks for information three times must say what
 * each asking is worth, or the last one silently wins.
 */
export interface StageWeight {
  point: VendorInputPoint;
  weight: number;
}

// ---------------------------------------------------------------------------
// Responses and envelopes
// ---------------------------------------------------------------------------

export type EnvelopeStatus =
  | 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'SEALED'
  | 'UNLOCKED' | 'UNDER_EVALUATION' | 'EVALUATED';

export interface Envelope {
  id: Id;
  eventId: Id;
  bidderId: Id;
  kind: 'TECHNICAL' | 'COMMERCIAL';
  status: EnvelopeStatus;
  /** True while sealed. Content is genuinely absent from any projection. */
  sealed: boolean;
  submittedAt: ServerMillis | null;
  unlockedAt: ServerMillis | null;
  unlockedBy: Id | null;
  witnesses: Id[];
}

export interface Answer {
  questionId: Id;
  value: string | number | boolean | string[] | null;
  attachmentName: string | null;
}

export interface Response {
  id: Id;
  eventId: Id;
  bidderId: Id;
  version: number;
  /** Frozen at submission; a resubmission creates a new version. */
  submittedAt: ServerMillis | null;
  answers: Answer[];
  priceLines: PriceLine[];
}

export interface PriceLine {
  lineItemId: Id;
  unitPrice: number;
  currency: string;
  leadTimeDays: number | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type TechnicalGate = 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
export type ConsensusMode = 'SINGLE' | 'AVERAGE' | 'MODERATED';
export type PriceScoreMethod = 'RATIO' | 'LINEAR' | 'TARGET_RELATIVE';

/** Append-only. An override is a new row referencing the original. */
export interface Score {
  id: Id;
  eventId: Id;
  bidderId: Id;
  questionId: Id;
  evaluatorId: Id;
  value: number;
  comment: string;
  method: ScoringMethod;
  /** AI_ASSISTED / AI_AUTO only. */
  agentConfidence: number | null;
  /** Clickable evidence for an agent-proposed score. */
  citedEvidence: string | null;
  overridesScoreId: Id | null;
  overrideReason: string | null;
  createdAt: ServerMillis;
}

export type AwardScoreComponentKey =
  | 'price_score'
  | 'technical_score'
  | 'commercial_terms_score'
  | 'performance_rating'
  | 'qualification_rating';

export interface AwardScoreComponent {
  key: AwardScoreComponentKey;
  label: string;
  weight: number;
  /** True for exactly one component. The UI validates this. */
  containsPrice: boolean;
}

// ---------------------------------------------------------------------------
// Bid transformation
// ---------------------------------------------------------------------------

export type CostComponentBasis = 'PER_UNIT' | 'PER_LINE' | 'PERCENTAGE' | 'LUMP_SUM';

/** Buyer-defined and bidder-specific. The bidder never sees the adjustment. */
export interface CostComponent {
  id: Id;
  eventId: Id;
  name: string;
  basis: CostComponentBasis;
  /** Keyed by bidder id — the value may differ per bidder. */
  valueByBidder: Record<Id, number>;
  source: string;
  /** AG-07 proposed this value; a human has not yet confirmed it. */
  agentProposed: boolean;
}

export type TransformationMode = 'NONE' | 'SUPPLIER_SPECIFIC' | 'TOTAL_COST_FORMULA';

export interface TransformationTrace {
  componentName: string;
  basis: CostComponentBasis;
  input: number;
  delta: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------

export type AuctionMechanism =
  | 'ENGLISH' | 'JAPANESE' | 'DUTCH' | 'SEALED_BID' | 'RANK_COMPRESSION'
  | 'MULTI_ATTRIBUTE' | 'PORTFOLIO' | 'INDEX_LINKED' | 'TRAFFIC_LIGHT' | 'VICKREY';

export type ClockOwner = 'BIDDER' | 'SYSTEM';
/** Derived from side + clock_owner. Never entered by hand. */
export type Direction = 'ASCENDING' | 'DESCENDING';
export type Rounds = 'CONTINUOUS' | 'DISCRETE' | 'SINGLE';
export type FeedbackPolicy =
  | 'FULL_PRICE' | 'BEST_PRICE' | 'RANK_ONLY' | 'RANK_GAP' | 'TRAFFIC_LIGHT' | 'BLIND';
export type IdentityPolicy = 'NAMED' | 'MASKED';
export type ClosePolicy =
  | 'HARD' | 'SOFT_EXTENSION' | 'FIRST_ACCEPT' | 'LAST_STANDING' | 'REVEAL_AT_TIME';
export type TieBidPolicy = 'FIRST_IN_WINS' | 'SPLIT' | 'TIE_BREAK_ROUND' | 'BUYER_DECIDES';
export type BelowMinPolicy = 'BLOCK' | 'WARN_AND_JUSTIFY' | 'ALLOW';
export type DecrementType = 'PCT' | 'ABSOLUTE';

export type AuctionStatus =
  | 'DRAFT' | 'CONFIGURED' | 'VALIDATED' | 'SCHEDULED' | 'LOBBY_OPEN'
  | 'LIVE' | 'PAUSED' | 'EXTENDED' | 'CLOSED' | 'RESULTS_PUBLISHED'
  | 'CANCELLED' | 'ABORTED';

export interface AntiGamingConfig {
  /** Soft close: any bid inside the trigger window extends the clock. */
  softCloseTriggerSec: number;
  softCloseExtensionSec: number;
  /** null = unlimited. */
  maxExtensions: number | null;
  minDecrementType: DecrementType;
  minDecrement: number;
  /** Fat-finger and gaming guard. */
  maxDecrementPct: number;
  /** Band ahead of the lead bid in which competing bids are rejected. */
  frontBufferPct: number;
  tieBidPolicy: TieBidPolicy;
  minBiddersToStart: number;
  belowMinPolicy: BelowMinPolicy;
  /** Typed confirmation required for improvements beyond this. */
  confirmThresholdPct: number;
  snipingThresholdSec: number;
  identicalBidWindowSec: number;
  requireDryRunFirstEvent: boolean;
  /** Never permitted. Present so the boundary is visible, not configurable. */
  readonly bidWithdrawalAllowed: false;
  readonly rebidOnOwnLeadingBidAllowed: false;
}

export interface Auction {
  id: Id;
  /**
   * The reference both sides quote.
   *
   * `id` is a slug the code joins on; this is what a person types into an
   * email. It is the auction's own, not the ask's: the ask that carries this
   * auction may be numbered RFQ-2026-0142 because the journey reached the
   * auction through an RFQ, and a supplier asking "which auction" needs an
   * answer that means an auction. Its own series (`EA-`) so it can never be
   * confused with an event number, and stored rather than derived because a
   * reference that renumbers itself is not a reference.
   */
  auctionNumber: string;
  eventId: Id;
  /** Inherited from the event, never re-entered. */
  side: Side;
  mechanism: AuctionMechanism;
  clockOwner: ClockOwner;
  rounds: Rounds;
  feedbackPolicy: FeedbackPolicy;
  identityPolicy: IdentityPolicy;
  lotStrategy: LotStrategy;
  biddingLevel: BiddingLevel;
  closePolicy: ClosePolicy;
  transformation: TransformationMode;
  proxyBidding: boolean;
  status: AuctionStatus;
  startsAt: ServerMillis | null;
  endsAt: ServerMillis | null;
  extensionsUsed: number;
  /** Internal-only, never disclosed by default. */
  discloseTarget: boolean;
  trafficAmberBandPct: number;
  antiGaming: AntiGamingConfig;
  /**
   * Settings that exist only for this mechanism.
   *
   * A Dutch clock has a tick interval, a Japanese round has a length, a sealed
   * bid has a resubmission rule — and none of them mean anything to the other
   * nine. Held as a bag rather than as nine optional columns, with the keys,
   * the bounds and the defaults declared in `domain/auctionRules`, which is
   * also what renders them and what reads them back.
   */
  parameters: AuctionParameters;
  startingPriceSource: string;
  targetPriceDerivation: string | null;
}

/** Keys are declared in `domain/auctionRules`. */
export type AuctionParameters = Record<string, number | boolean>;

export interface AuctionLot {
  id: Id;
  auctionId: Id;
  lotId: Id;
  status: LotStatus;
  startingPrice: number;
  opensAt: ServerMillis | null;
  closesAt: ServerMillis | null;
}

export type BidSource = 'PORTAL' | 'PROXY' | 'ON_BEHALF' | 'API';

/** Append-only ledger. A correction is a new row; nothing is ever updated. */
export interface Bid {
  id: Id;
  auctionId: Id;
  auctionLotId: Id;
  lineItemId: Id | null;
  bidderId: Id;
  bidValue: number;
  /** Buyer-side comparable. Ranking reads this, never bidValue. */
  transformedValue: number;
  currency: string;
  rankAtSubmission: number;
  /** Server-authoritative — the only time used for ranking and deadlines. */
  submittedAt: ServerMillis;
  source: BidSource;
  submittedByUserId: Id;
  onBehalfReason: string | null;
  /** Diagnostics only. Never authoritative. */
  clientTimestamp: ServerMillis | null;
  ipHash: string;
  isValid: boolean;
  rejectionReason: string | null;
  /** Monotonic. Authoritative on a millisecond collision. */
  sequenceNumber: number;
}

export interface ProxyBidInstruction {
  id: Id;
  auctionId: Id;
  auctionLotId: Id;
  bidderId: Id;
  /** Mandatory. A proxy without a ceiling is not accepted. */
  ceiling: number;
  step: number;
  active: boolean;
}

export type AuctionEventKind =
  | 'OPENED' | 'PAUSED' | 'RESUMED' | 'EXTENDED' | 'FORCE_CLOSED'
  | 'ABORTED' | 'LOT_OPENED' | 'LOT_CLOSED' | 'MESSAGE_BROADCAST'
  /**
   * Progress the controller drives, in the mechanisms that need driving.
   *
   * These are the append-only record of the auction advancing: the Japanese
   * round, the sealed reveal, the held Dutch clock, the turn handed over. The
   * live state is derived from them rather than stored a second time, so the
   * log and the screen cannot disagree.
   */
  | 'ROUND_ADVANCED' | 'ENVELOPES_OPENED' | 'CLOCK_HELD' | 'CLOCK_RESUMED'
  | 'TURN_CALLED' | 'TURN_SKIPPED'
  /**
   * The practice run, opened and closed by the controller.
   *
   * Whether a rehearsal is running is read from these rather than held as a
   * flag, for the same reason as the round and the turn: one source, so the
   * log and the screen cannot disagree about whether what a supplier just
   * submitted counted.
   */
  | 'REHEARSAL_OPENED' | 'REHEARSAL_CLOSED'
  /**
   * What bidders may see, changed while the auction is running.
   *
   * A material change to the rules of a live competition, so it is logged with
   * who made it and why, and every console is told. The `detail` carries the
   * policy moved from and to.
   */
  | 'FEEDBACK_CHANGED';

/** Logged with actor, timestamp and reason *before* it takes effect. */
export interface AuctionControlEvent {
  id: Id;
  auctionId: Id;
  kind: AuctionEventKind;
  actorId: Id;
  reason: string;
  at: ServerMillis;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

export type NegotiationRoundType = 'STANDARD' | 'BAFO' | 'TARGETED';
export type NegotiationScope = 'ALL' | 'SELECTED' | 'TOP_N';

export interface NegotiationRound {
  id: Id;
  eventId: Id;
  roundNumber: number;
  type: NegotiationRoundType;
  scope: NegotiationScope;
  negotiable: ('PRICE' | 'TERMS' | 'NAMED_LINES')[];
  deadline: ServerMillis;
  message: string;
  bidderIds: Id[];
  closed: boolean;
}

export interface QuoteVersion {
  id: Id;
  eventId: Id;
  bidderId: Id;
  roundId: Id | null;
  version: number;
  priceLines: PriceLine[];
  paymentTermsDays: number | null;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
  /** Computed value of the concession, so the buyer sees what a term is worth. */
  commercialImpact: number | null;
  createdAt: ServerMillis;
}

// ---------------------------------------------------------------------------
// Award, NFA, approvals
// ---------------------------------------------------------------------------

export type AwardScenarioKind = 'RECOMMENDED' | 'LOWEST_TOTAL_COST' | 'BEST_TECHNICAL' | 'DUAL_SOURCE' | 'CUSTOM';

export interface AwardLine {
  lotId: Id;
  lineItemId: Id | null;
  bidderId: Id;
  quantity: number;
  sharePct: number;
  /** Every award line traces to a bid. Non-negotiable for audit. */
  bidId: Id;
  sourcePrLineId: Id | null;
}

export interface AwardScenario {
  id: Id;
  eventId: Id;
  kind: AwardScenarioKind;
  name: string;
  lines: AwardLine[];
  constraints: AwardConstraints;
  totalValue: number;
  /** Which constraints bound the solution, and what each cost. */
  bindingConstraints: { name: string; cost: number }[];
}

export interface AwardConstraints {
  minSuppliersPerLot: number | null;
  maxSuppliersPerLot: number | null;
  maxSharePerSupplierPct: number | null;
  mandatoryDualSource: boolean;
  incumbentProtectionPct: number | null;
  moq: number | null;
  localContentTargetPct: number | null;
}

export type ApprovalDecision = 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'DELEGATED';

/** How a step came to be held by the person holding it. */
export type ApprovalStepKind = 'NORMAL' | 'DELEGATED' | 'ESCALATED' | 'UPLIFT';

export interface ApprovalStep {
  id: Id;
  nfaId: Id;
  level: number;
  holderId: Id;
  holderName: string;
  role: string;
  slaHours: number;
  decision: ApprovalDecision;
  /** Mandatory on RETURNED and REJECTED. */
  comment: string | null;
  decidedAt: ServerMillis | null;
  /** Which revision of the note this step belongs to. Revision 1 by default. */
  revisionNumber?: number;
  kind?: ApprovalStepKind;
  /** Set when the step was passed on: the original holder stays visible. */
  delegatedToId?: Id | null;
  delegatedToName?: string | null;
  /** Set when a breached SLA escalated the step upward. */
  escalatedFromName?: string | null;
  /**
   * A decision invalidated by a later material revision. Superseded decisions
   * are struck through in the chain history, never deleted.
   */
  superseded?: boolean;
  supersededReason?: string | null;
  /** A non-material amendment keeps earlier approvals; they carry forward. */
  carriedForward?: boolean;
}

export interface Nfa {
  id: Id;
  eventId: Id;
  scenarioId: Id;
  comparisonSheetVersion: number;
  /** Section 8 recommendation is always written by a human. */
  recommendation: string;
  recommendedBy: Id;
  deviations: string[];
  riskStatement: string;
  /** Applied automatically when awarding other than rank 1. */
  doaUpliftApplied: boolean;
  overrideReason: string | null;
  /** The live steps of the current revision. History lives on `revisions`. */
  steps: ApprovalStep[];
  createdAt: ServerMillis;

  // -- Pack 28: lifecycle ---------------------------------------------------
  status: NfaStatus;
  /** Every submitted revision, oldest first. The last one is the live note. */
  revisions: NfaRevision[];
  /** The working document the buyer is editing, which may not be submitted. */
  draft: NfaDocument;
  /** Mandatory, captured at rejection, carried into any successor note. */
  rejectionReason: string | null;
  /** Mandatory, captured at recall. */
  recallReason: string | null;
  /** OD-04b: a rejected note may be superseded by a linked successor NFA. */
  supersededByNfaId: Id | null;
  predecessorNfaId: Id | null;
}

// ---------------------------------------------------------------------------
// Pack 28 — NFA lifecycle, revisions and amendments
// ---------------------------------------------------------------------------

export type NfaStatus =
  /** Submitted and moving through the chain. */
  | 'IN_APPROVAL'
  /** An approver returned it; the buyer holds the pen. */
  | 'RETURNED'
  /** The buyer pulled it back before a decision closed the chain. */
  | 'RECALLED'
  | 'APPROVED'
  | 'REJECTED';

export type NfaRevisionOutcome =
  | 'IN_FLIGHT'
  | 'APPROVED'
  | 'RETURNED'
  | 'REJECTED'
  | 'RECALLED'
  | 'SUPERSEDED';

/**
 * What a change to the note is worth. The whole pack turns on this word:
 * a material change restarts the chain, a non-material one does not.
 */
export type ChangeClass = 'NONE' | 'NON_MATERIAL' | 'MATERIAL';

/** One awarded allocation line. Every line traces to a bid — never to nothing. */
export interface NfaAllocationLine {
  lineId: Id;
  lotId: Id;
  lotName: string;
  bidderId: Id;
  bidderName: string;
  sharePct: number;
  quantity: number;
  value: number;
  /** The bid this award line traces to. An empty string is a defect, not a state. */
  bidId: Id;
}

/**
 * The diffable content of the note. Pack 22 owns how the twelve sections are
 * *rendered*; this is what a revision *freezes* so two revisions can be compared.
 */
export interface NfaDocument {
  scenarioId: Id;
  currency: string;
  allocations: NfaAllocationLine[];
  totalValue: number;
  comparisonSheetVersion: number;
  rankOverride: boolean;
  overrideReason: string | null;
  deviations: string[];
  /** The resolved chain, reduced to one comparable string. */
  chainSignature: string;
  // Narrative and administrative fields — non-material by default.
  recommendation: string;
  riskStatement: string;
  processSummary: string;
  competitionSummary: string;
  costCentre: string | null;
  requiredByDate: string | null;
  paymentTerms: string;
}

/**
 * The DoA chain as it stood when a revision was submitted. Editing the matrix
 * next quarter must not alter how a decision taken today renders, so the chain
 * is copied into the revision rather than resolved again at read time.
 */
export interface NfaChainSnapshot {
  ruleId: Id | null;
  ruleName: string;
  chainMode: 'SEQUENTIAL' | 'PARALLEL' | 'ANY_ONE';
  capturedAt: ServerMillis;
  totalSlaHours: number;
  upliftApplied: boolean;
  levels: { level: number; role: string; holderName: string; slaHours: number }[];
}

/** A correction to an already-approved revision that does not re-enter approval. */
export interface NfaErratum {
  id: Id;
  revisionNumber: number;
  field: string;
  label: string;
  from: string;
  to: string;
  /** Mandatory. An errata note with no reason is not an errata note. */
  reason: string;
  authoredBy: Id;
  authoredByName: string;
  authoredAt: ServerMillis;
}

export interface NfaRevision {
  id: Id;
  nfaId: Id;
  number: number;
  document: NfaDocument;
  chainSnapshot: NfaChainSnapshot;
  /** The steps of this revision, with their decisions, frozen at close. */
  steps: ApprovalStep[];
  outcome: NfaRevisionOutcome;
  /** "returned by level 2", "rejected by the CFO", "recalled by the buyer". */
  outcomeDetail: string | null;
  changeClass: ChangeClass;
  changeSummary: string;
  submittedBy: Id;
  submittedByName: string;
  submittedAt: ServerMillis;
  closedAt: ServerMillis | null;
  /** Set when this revision restarted the chain and invalidated approvals. */
  supersededApprovals: { level: number; role: string; holderName: string }[];
  errata: NfaErratum[];
}

/**
 * A rate contract an award established. It exists here for one reason: it is
 * the only legitimate destination for "we also need this item" that does not
 * require a new event.
 */
export interface RateContract {
  id: Id;
  contractNumber: string;
  eventId: Id;
  supplierId: Id;
  supplierName: string;
  /** The categories the contract's scope covers. Outside them, it cannot absorb a line. */
  categoryScope: string[];
  currency: string;
  ceilingValue: number;
  committedValue: number;
  startsAt: ServerMillis;
  expiresAt: ServerMillis;
}

export interface DoARule {
  id: Id;
  name: string;
  minValue: number;
  maxValue: number | null;
  category: string | null;
  businessUnit: string | null;
  levels: { level: number; role: string; holderName: string; slaHours: number }[];
  chainMode: 'SEQUENTIAL' | 'PARALLEL' | 'ANY_ONE';
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

export interface SavingsLine {
  lineItemId: Id;
  lotName: string;
  description: string;
  quantity: number;
  awardedUnitPrice: number;
  baselineUnitPrice: number | null;
  baselineSource: BaselineSource | null;
  /** Known at award. */
  negotiatedSavings: number;
  /** Only known post-GRN. Null until then, and shown as pending. */
  realisedSavings: number | null;
}

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export type ClarificationVisibility = 'BROADCAST' | 'PRIVATE_ADMINISTRATIVE';

export interface Clarification {
  id: Id;
  eventId: Id;
  askedByBidderId: Id;
  subject: string;
  question: string;
  askedAt: ServerMillis;
  answer: string | null;
  answeredAt: ServerMillis | null;
  answeredBy: Id | null;
  /** Substantive answers are always BROADCAST. Not configurable. */
  visibility: ClarificationVisibility;
  /** AG-05 drafted this. Cannot publish. */
  agentDrafted: boolean;
  revealAsker: boolean;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentCode =
  | 'AG-01' | 'AG-02' | 'AG-03' | 'AG-04' | 'AG-05' | 'AG-06' | 'AG-07' | 'AG-08'
  | 'AG-09' | 'AG-10' | 'AG-11' | 'AG-12' | 'AG-13' | 'AG-14' | 'AG-15' | 'AG-16';

export type AutonomyLevel = 'OFF' | 'SUGGEST' | 'DRAFT' | 'ACT_WITH_APPROVAL' | 'AUTONOMOUS';

export interface AgentDefinition {
  code: AgentCode;
  name: string;
  stage: string;
  maxAutonomy: AutonomyLevel;
  defaultAutonomy: AutonomyLevel;
  mandate: string;
  cannot: string[];
}

export interface AgentMandate {
  valueCeiling: number | null;
  categoryScope: string[];
  counterpartyScope: string[];
  priceFloor: number | null;
  maxRounds: number | null;
  confidenceThreshold: number;
  timeWindow: string | null;
  escalateTo: string;
}

export type HumanDecision = 'PENDING' | 'ACCEPTED' | 'MODIFIED' | 'REJECTED';

export interface AgentAction {
  id: Id;
  eventId: Id;
  agentCode: AgentCode;
  autonomyLevelAtExecution: AutonomyLevel;
  trigger: string;
  inputsRef: string[];
  output: string;
  confidence: number | null;
  reasoningSummary: string;
  executedAt: ServerMillis;
  humanReviewedBy: Id | null;
  humanDecision: HumanDecision;
  modificationDelta: string | null;
  mandateSnapshot: AgentMandate;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: Id;
  eventId: Id | null;
  objectType: string;
  objectId: Id;
  action: string;
  actorId: Id;
  at: ServerMillis;
  before: unknown;
  after: unknown;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ConfigScopeType = 'TENANT' | 'CATEGORY' | 'TEMPLATE' | 'EVENT';

export interface ConfigSetting<T = unknown> {
  key: string;
  scopeType: ConfigScopeType;
  scopeId: Id | null;
  value: T;
  /** Locked at a broader scope wins regardless of narrower settings. */
  isLocked: boolean;
  setBy: Id;
  setAt: ServerMillis;
}

export interface ResolvedConfig<T = unknown> {
  key: string;
  value: T;
  /** The scope the effective value resolved from — always shown in the UI. */
  resolvedFrom: ConfigScopeType;
  isLocked: boolean;
  lockedBy: ConfigScopeType | null;
  chain: { scopeType: ConfigScopeType; value: T | undefined; isLocked: boolean }[];
}

// ---------------------------------------------------------------------------
// Users and permissions
// ---------------------------------------------------------------------------

export type Permission =
  | 'create_event' | 'publish_event' | 'manage_bidders' | 'score_technical'
  | 'view_commercial' | 'unlock_commercial' | 'run_auction' | 'control_auction'
  | 'bid_on_behalf' | 'recommend_award' | 'approve_at_level' | 'configure_tenant'
  | 'view_only';

export type PermissionScopeType = 'GLOBAL' | 'BUSINESS_UNIT' | 'CATEGORY' | 'EVENT';

export interface User {
  id: Id;
  name: string;
  initials: string;
  email: string;
  role: string;
  permissions: Permission[];
  scopeType: PermissionScopeType;
  scopeId: Id | null;
}
