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
}

export interface Questionnaire {
  id: Id;
  eventId: Id;
  stage: Stage;
  name: string;
  questions: Question[];
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
  startingPriceSource: string;
  targetPriceDerivation: string | null;
}

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
  | 'ABORTED' | 'LOT_OPENED' | 'LOT_CLOSED' | 'MESSAGE_BROADCAST';

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
  steps: ApprovalStep[];
  createdAt: ServerMillis;
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
