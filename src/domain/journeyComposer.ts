/**
 * Journey composition — building a custom journey out of stage components.
 *
 * Two ideas carry this file.
 *
 * **Not everything a journey does is a stage.** Evaluation is what a buyer
 * does to the responses an RFI, RFP or RFQ brought in; negotiation is a round
 * run inside an RFQ or an auction; clarifications are a window the buyer can
 * open at any point. Modelling those three as stages of their own put them in
 * the rail as though the process stopped and started again, and forced them
 * into a fixed position in a sequence they do not belong to. They are
 * **activities**: switched on at the stage that hosts them.
 *
 * **The remaining stages are independent, so the buyer orders them.** What is
 * left — intake, the solicitations, the auction, the award — is genuinely
 * sequential work, and which order it runs in is the client's process, not
 * ours. The composer keeps only the two anchors that are structural: a journey
 * begins at intake and ends in an award decision. Everything between is the
 * buyer's to arrange, and `orderStages` is the one place that is enforced.
 *
 * Nothing here is hand-entered that can be derived. Wizard steps, workspace
 * tabs, supplier task labels and the duration estimate are all computed from
 * the stages and activities, so a composed journey cannot drift out of step
 * with what the product will do when it runs.
 *
 * The thirteen master patterns still declare EVALUATION, CLARIFICATION and
 * NEGOTIATION as stages — they ship with the module and drive live events.
 * `activitiesFromStages` reads those sets in the new vocabulary, so the
 * composer can seed from a master without the two models disagreeing.
 */
import {
  STAGE_LABELS, STAGE_ORDER,
  WIZARD_AUCTION, WIZARD_BASICS, WIZARD_EVALUATION, WIZARD_ITEMS,
  WIZARD_QUESTIONNAIRE, WIZARD_REVIEW, WIZARD_TERMS, WIZARD_TIMELINE,
  ALL_PATTERNS,
} from './journeyPatterns';
import type {
  ConfigScopeType, Id, JourneyPatternId, ServerMillis, Side, Stage, VendorInputPoint,
} from './types';

export const JOURNEY_CUSTOM_KEY = 'patterns.custom';
export const JOURNEY_ENABLED_KEY = 'patterns.enabled';

// ---------------------------------------------------------------------------
// The components a journey is assembled from
// ---------------------------------------------------------------------------

export interface StageComponent {
  stage: Stage;
  label: string;
  /** What including this component actually does to the event. */
  purpose: string;
  /** Every master pattern carries these; the composer will not let them go. */
  mandatory: boolean;
  /** True when a supplier does something here — it can be a vendor input point. */
  vendorFacing: boolean;
  /**
   * Where the stage is allowed to sit. Intake opens a journey and the award
   * decision closes it; everything between is the buyer's to arrange.
   */
  anchor: 'OPENS' | 'CLOSES' | null;
  /** Rough working days this stage adds, for the duration estimate. */
  typicalDays: number;
}

/** Stages a supplier can be asked to act at. Mirrors `VendorInputPoint`. */
const VENDOR_FACING: Stage[] = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'];

/** A stage that puts a solicitation in front of suppliers and collects responses. */
export const SOLICITATION_STAGES: Stage[] = ['RFI', 'RFP', 'RFQ'];

/** Stages that imply a competitive field, and therefore a bidder list. */
const COMPETITIVE_STAGES: Stage[] = ['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'];

/**
 * Whether this journey puts anything in front of a supplier to compete for.
 *
 * A rate-contract call-off buys from a vendor already chosen, so the Items
 * step shows the basket and nothing else. Every other journey needs a roster
 * on that same step, because the lines and the people asked to price them are
 * one decision.
 */
export function invitesVendors(
  stages: Stage[], activities?: Partial<JourneyActivities>,
): boolean {
  return stages.some((stage) => COMPETITIVE_STAGES.includes(stage))
    || activitiesOf(stages, activities).negotiateAt.length > 0;
}

export const MANDATORY_STAGES: Stage[] = ['INTAKE', 'AWARD'];

/**
 * The three the master patterns declare as stages and the composer now treats
 * as activities. Kept in the catalogue so a legacy stage set still resolves.
 */
export const ACTIVITY_STAGES: Stage[] = ['CLARIFICATION', 'EVALUATION', 'NEGOTIATION'];

/** Every stage, including the three that are no longer composed as stages. */
export const STAGE_CATALOGUE: StageComponent[] = [
  {
    stage: 'INTAKE', label: STAGE_LABELS.INTAKE, mandatory: true, vendorFacing: true,
    anchor: 'OPENS', typicalDays: 0,
    purpose: 'Demand arrives — from a PR, a contract expiry, a short close, or manually. Every journey starts here.',
  },
  {
    stage: 'RFI', label: STAGE_LABELS.RFI, mandatory: false, vendorFacing: true,
    anchor: null, typicalDays: 5,
    purpose: 'Qualify the market before asking anyone for a price. Capability and credentials only — no commercials.',
  },
  {
    stage: 'RFP', label: STAGE_LABELS.RFP, mandatory: false, vendorFacing: true,
    anchor: null, typicalDays: 10,
    purpose: 'Solicit a full proposal — scope, method and commercials. Carries technical weighting, and is what two-envelope mode seals.',
  },
  {
    stage: 'RFQ', label: STAGE_LABELS.RFQ, mandatory: false, vendorFacing: true,
    anchor: null, typicalDays: 3,
    purpose: 'Ask a qualified field for prices against a fixed specification.',
  },
  {
    stage: 'CLARIFICATION', label: STAGE_LABELS.CLARIFICATION, mandatory: false, vendorFacing: false,
    anchor: null, typicalDays: 2,
    purpose: 'A formal Q&A window. Composed as an activity rather than a stage — the buyer opens it wherever it is needed.',
  },
  {
    stage: 'EVALUATION', label: STAGE_LABELS.EVALUATION, mandatory: false, vendorFacing: false,
    anchor: null, typicalDays: 4,
    purpose: 'Scoring responses. Composed as an activity on the solicitation whose responses are being scored.',
  },
  {
    stage: 'NEGOTIATION', label: STAGE_LABELS.NEGOTIATION, mandatory: false, vendorFacing: true,
    anchor: null, typicalDays: 4,
    purpose: 'Counter-offer rounds. Composed as an activity on the RFQ or the auction it runs inside.',
  },
  {
    stage: 'AUCTION', label: STAGE_LABELS.AUCTION, mandatory: false, vendorFacing: true,
    anchor: null, typicalDays: 1,
    purpose: 'A live competitive event that compresses price. The feedback policy set in the Auction domain governs what bidders see.',
  },
  {
    stage: 'AWARD', label: STAGE_LABELS.AWARD, mandatory: true, vendorFacing: false,
    anchor: 'CLOSES', typicalDays: 1,
    purpose: 'Pick the winner, record the reasoning, produce the NFA. Every journey ends in an award decision.',
  },
  {
    stage: 'APPROVAL', label: STAGE_LABELS.APPROVAL, mandatory: false, vendorFacing: false,
    anchor: 'CLOSES', typicalDays: 2,
    purpose: 'Route the award through the DoA chain before it becomes binding. Omitting this makes the award immediate.',
  },
];

/** The components a journey is actually assembled from — stages, in order. */
export const STAGE_COMPONENTS: StageComponent[] = STAGE_CATALOGUE.filter(
  (c) => !ACTIVITY_STAGES.includes(c.stage),
);

/** The stages the buyer picks from, in the order they are offered. */
export const COMPOSABLE_STAGES: Stage[] = STAGE_COMPONENTS.map((c) => c.stage);

/** The stages that may be dragged — everything that is not an anchor. */
export const MOVABLE_STAGES: Stage[] = STAGE_COMPONENTS
  .filter((c) => c.anchor === null)
  .map((c) => c.stage);

export function componentFor(stage: Stage): StageComponent {
  return STAGE_CATALOGUE.find((c) => c.stage === stage)!;
}

export function isMovable(stage: Stage): boolean {
  return MOVABLE_STAGES.includes(stage);
}

// ---------------------------------------------------------------------------
// Activities — work that happens inside a stage, not beside it
// ---------------------------------------------------------------------------

export type ActivityKey = 'CLARIFICATION' | 'EVALUATION' | 'NEGOTIATION';

export interface StageActivity {
  key: ActivityKey;
  label: string;
  /** What switching it on at a stage actually does. */
  purpose: string;
  /** Why it is not a stage of its own. Shown in the composer. */
  rationale: string;
  /** The stages it can be hosted by. Empty means the journey as a whole. */
  hosts: Stage[];
  /** True when the supplier does something as part of it. */
  vendorFacing: boolean;
  /** Working days it adds once, however many stages host it. */
  typicalDays: number;
}

export const STAGE_ACTIVITIES: StageActivity[] = [
  {
    key: 'EVALUATION',
    label: STAGE_LABELS.EVALUATION,
    hosts: SOLICITATION_STAGES,
    vendorFacing: false,
    typicalDays: 4,
    purpose: 'Score the responses that solicitation brought in, and gate on the technical result before the journey moves on.',
    rationale: 'Scoring is what a buyer does to the responses of an RFI, RFP or RFQ. There is nothing to score without one, so it belongs to the solicitation rather than standing beside it.',
  },
  {
    key: 'NEGOTIATION',
    label: STAGE_LABELS.NEGOTIATION,
    hosts: ['RFQ', 'AUCTION'],
    vendorFacing: true,
    typicalDays: 4,
    purpose: 'Run counter-offer rounds against what was submitted here. Bounded by negotiation.max_rounds.',
    rationale: 'A negotiation is a round inside a price event — against quotes in an RFQ, or against standing bids in an auction. It is how that stage closes, not a stage after it.',
  },
  {
    key: 'CLARIFICATION',
    label: STAGE_LABELS.CLARIFICATION,
    hosts: [],
    vendorFacing: false,
    typicalDays: 2,
    purpose: 'Let suppliers raise questions and broadcast substantive answers to the whole field. Open at every stage the journey runs.',
    rationale: 'A buyer clarifies whenever a supplier asks, which is at any point in the journey. Pinning it to one position in the sequence meant the window was shut everywhere else.',
  },
];

export function activityFor(key: ActivityKey): StageActivity {
  return STAGE_ACTIVITIES.find((a) => a.key === key)!;
}

/** Which stages in a journey may host a given activity. */
export function hostsFor(key: ActivityKey, stages: Stage[]): Stage[] {
  return orderStages(stages).filter((s) => activityFor(key).hosts.includes(s));
}

export interface JourneyActivities {
  /** Solicitations whose responses are scored. */
  evaluateAt: Stage[];
  /** The RFQ and/or auction that carries negotiation rounds. */
  negotiateAt: Stage[];
  /** Whether the Q&A window is open across the journey. */
  clarifications: boolean;
}

export const NO_ACTIVITIES: JourneyActivities = {
  evaluateAt: [], negotiateAt: [], clarifications: false,
};

/**
 * Read a legacy stage set in the new vocabulary.
 *
 * The master patterns, and any custom journey composed before activities
 * existed, carry EVALUATION, CLARIFICATION and NEGOTIATION as stages. Rather
 * than keep two models alive, everything funnels through here: a stage set
 * that mentions them is read as the activities it was always describing.
 */
export function activitiesFromStages(stages: Stage[]): JourneyActivities {
  const has = (s: Stage) => stages.includes(s);
  const negotiationHosts = activityFor('NEGOTIATION').hosts.filter(has);
  return {
    // Scoring applies to whatever the journey actually solicited.
    evaluateAt: has('EVALUATION') ? SOLICITATION_STAGES.filter(has) : [],
    // A legacy negotiation lands on the price event it ran against: the RFQ
    // where there is one, the auction otherwise.
    negotiateAt: has('NEGOTIATION') ? negotiationHosts.slice(0, 1) : [],
    clarifications: has('CLARIFICATION'),
  };
}

/** Activities as given, or read off the stages when a caller has none. */
export function activitiesOf(
  stages: Stage[], activities?: Partial<JourneyActivities>,
): JourneyActivities {
  if (activities === undefined) return activitiesFromStages(stages);
  const fallback = activitiesFromStages(stages);
  return {
    evaluateAt: activities.evaluateAt ?? fallback.evaluateAt,
    negotiateAt: activities.negotiateAt ?? fallback.negotiateAt,
    clarifications: activities.clarifications ?? fallback.clarifications,
  };
}

/**
 * The canonical stage set this journey is equivalent to, activities folded
 * back in. The engine, the workspace tabs and the duplicate check all still
 * speak in stages, so this is the translation they read.
 */
export function equivalentStages(
  stages: Stage[], activities?: Partial<JourneyActivities>,
): Stage[] {
  const resolved = activitiesOf(stages, activities);
  const folded: Stage[] = [...stages];
  if (resolved.evaluateAt.length > 0) folded.push('EVALUATION');
  if (resolved.negotiateAt.length > 0) folded.push('NEGOTIATION');
  if (resolved.clarifications) folded.push('CLARIFICATION');
  return STAGE_ORDER.filter((s) => folded.includes(s));
}

// ---------------------------------------------------------------------------
// A composed journey
// ---------------------------------------------------------------------------

export interface CustomJourney {
  id: string;
  name: string;
  description: string;
  side: Side;
  /**
   * The stages, **in the order the buyer arranged them**. Not a subset of a
   * canonical order: a journey that auctions before it quotes is a real
   * process, and this is where it is recorded.
   */
  stages: Stage[];
  vendorInputPoints: VendorInputPoint[];
  /**
   * Scored solicitations, negotiated price events, and whether the Q&A window
   * is open. Optional so a journey composed before activities existed still
   * reads — `activitiesOf` recovers them from its stages.
   */
  evaluateAt?: Stage[];
  negotiateAt?: Stage[];
  clarifications?: boolean;
  /** The master pattern this was seeded from, for provenance. */
  basedOn: JourneyPatternId | null;
  scopeType: ConfigScopeType;
  scopeId: Id;
  createdBy: Id;
  createdAt: ServerMillis;
}

/** The read model both master and custom journeys render through. */
export interface JourneySummary {
  id: string;
  name: string;
  description: string;
  side: Side | 'ANY';
  stages: Stage[];
  activities: JourneyActivities;
  vendorInputPoints: VendorInputPoint[];
  wizardSteps: string[];
  duration: string;
  serves: string;
  origin: 'MASTER' | 'CUSTOM';
  /** Null for master patterns, which ship with the module rather than a scope. */
  scopeType: ConfigScopeType | null;
}

export function masterSummaries(): JourneySummary[] {
  return ALL_PATTERNS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    side: p.side,
    stages: p.stages,
    // A master declares its activities as stages. Reading them here lets the
    // studio describe all thirteen in the same vocabulary the composer uses,
    // without rewriting patterns that are already driving live events.
    activities: activitiesFromStages(p.stages),
    vendorInputPoints: p.vendorInputPoints,
    wizardSteps: p.wizardSteps,
    duration: p.typicalDuration,
    serves: p.serves,
    origin: 'MASTER' as const,
    scopeType: null,
  }));
}

export function customSummary(journey: CustomJourney): JourneySummary {
  const activities = activitiesOf(journey.stages, {
    evaluateAt: journey.evaluateAt,
    negotiateAt: journey.negotiateAt,
    clarifications: journey.clarifications,
  });
  const stages = orderStages(journey.stages);
  return {
    id: journey.id,
    name: journey.name,
    description: journey.description,
    side: journey.side,
    stages,
    activities,
    vendorInputPoints: journey.vendorInputPoints,
    wizardSteps: deriveWizardSteps(stages, journey.vendorInputPoints, activities),
    duration: estimateDuration(stages, activities),
    serves: journey.description,
    origin: 'CUSTOM',
    scopeType: journey.scopeType,
  };
}

// ---------------------------------------------------------------------------
// Sequence — the one place ordering is enforced
// ---------------------------------------------------------------------------

/**
 * Put a selection into a runnable order.
 *
 * Only two rules survive, and both are structural rather than editorial:
 * intake opens a journey because that is where the demand arrives, and the
 * award decision closes it — with approval after it, since approving an award
 * that has not been made is not a thing. The order of everything between is
 * preserved exactly as the buyer arranged it.
 *
 * Activity stages are dropped: they are no longer positions in a sequence.
 */
export function orderStages(stages: Stage[]): Stage[] {
  const picked: Stage[] = [];
  for (const stage of stages) {
    if (!COMPOSABLE_STAGES.includes(stage)) continue;
    if (!picked.includes(stage)) picked.push(stage);
  }
  const opens = picked.filter((s) => componentFor(s).anchor === 'OPENS');
  const closes = STAGE_ORDER.filter(
    (s) => picked.includes(s) && componentFor(s).anchor === 'CLOSES',
  );
  const middle = picked.filter((s) => componentFor(s).anchor === null);
  return [...opens, ...middle, ...closes];
}

/**
 * Move the stage at `from` to sit at `to`, then re-assert the anchors.
 *
 * Drag-and-drop hands over two indices and nothing else, so the rules live
 * here rather than in the event handler — a drop that would put the award
 * first is corrected rather than refused, because refusing silently is the
 * worse half of that trade.
 */
export function moveStage(stages: Stage[], from: number, to: number): Stage[] {
  const ordered = orderStages(stages);
  if (from < 0 || from >= ordered.length || to < 0 || to >= ordered.length || from === to) {
    return ordered;
  }
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return orderStages(next);
}

/**
 * Kept for callers that genuinely want canonical order — the stage strip for
 * a master pattern, and the duplicate check. Composing no longer uses it.
 */
export function normaliseStages(stages: Stage[]): Stage[] {
  return STAGE_ORDER.filter((s) => stages.includes(s));
}

// ---------------------------------------------------------------------------
// Derivation — everything that must not be hand-entered
// ---------------------------------------------------------------------------

/**
 * The wizard the composed journey will present.
 *
 * These rules reproduce eleven of the thirteen master patterns exactly. JP-10
 * and JP-11 trim steps by hand because they optimise for speed — a rate refresh
 * reuses an existing questionnaire, and a spot buy skips the timeline. The
 * composer derives rather than guessing at that intent, and says so.
 *
 * The asks are passed in rather than read off the stages because two journeys
 * can run the same stages and ask the supplier different things: JP-07 takes a
 * quote at intake, JP-08 calls off a rate contract and asks for nothing.
 */
export function deriveWizardSteps(
  stages: Stage[],
  vendorInputPoints: VendorInputPoint[] = availableVendorPoints(stages),
  activities?: Partial<JourneyActivities>,
): string[] {
  const resolved = activitiesOf(stages, activities);
  const has = (s: Stage) => stages.includes(s);
  const anyOf = (list: Stage[]) => list.some(has);

  // Items and the vendor roster are one step: a line is only sourceable once
  // somebody has been asked to price it, and splitting the two made the buyer
  // tick vendors against a basket they could no longer see.
  const steps: string[] = [WIZARD_BASICS, WIZARD_ITEMS];
  if (anyOf(SOLICITATION_STAGES)) steps.push(WIZARD_QUESTIONNAIRE);
  // Terms belong wherever the journey asks a supplier for anything at all —
  // a quote at intake and a bid in an auction are both commitments, and
  // publishing is blocked when an ask goes out with nothing attached. A
  // weighted evaluation model is narrower: it is worth a step only where the
  // journey negotiates or scores a proposal.
  if (vendorInputPoints.length > 0) steps.push(WIZARD_TERMS);
  if (has('RFP') || resolved.negotiateAt.length > 0) steps.push(WIZARD_EVALUATION);
  if (has('AUCTION')) steps.push(WIZARD_AUCTION);
  if (anyOf(SOLICITATION_STAGES)) steps.push(WIZARD_TIMELINE);
  steps.push(WIZARD_REVIEW);
  return steps;
}

/**
 * Vendor input points a stage set can legally offer.
 *
 * Negotiation stays on the list when it is switched on as an activity: the
 * supplier is still asked to respond to an offer, and the portal still has to
 * name that task. Where it happens changed; that it happens did not.
 */
export function availableVendorPoints(
  stages: Stage[], activities?: Partial<JourneyActivities>,
): VendorInputPoint[] {
  const resolved = activitiesOf(stages, activities);
  const offered = new Set<Stage>(stages.filter((s) => VENDOR_FACING.includes(s)));
  if (resolved.negotiateAt.length > 0) offered.add('NEGOTIATION');
  return STAGE_ORDER.filter((s) => offered.has(s)).map((s) => s as VendorInputPoint);
}

/**
 * An estimate, not a promise. The master patterns state durations observed in
 * practice; a composed journey has none, so the studio shows a computed figure
 * and labels it as computed.
 *
 * An activity is charged once however many stages host it — three scored
 * solicitations are three passes of the same panel, not three calendars.
 */
export function estimateDuration(
  stages: Stage[], activities?: Partial<JourneyActivities>,
): string {
  const resolved = activitiesOf(stages, activities);
  let days = orderStages(stages).reduce((total, s) => total + componentFor(s).typicalDays, 0);
  if (resolved.evaluateAt.length > 0) days += activityFor('EVALUATION').typicalDays;
  if (resolved.negotiateAt.length > 0) days += activityFor('NEGOTIATION').typicalDays;
  if (resolved.clarifications) days += activityFor('CLARIFICATION').typicalDays;

  if (days === 0) return 'under an hour';
  if (days <= 1) return '1 day';
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 5);
  return weeks <= 1 ? '1 week' : `${weeks} weeks`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface JourneyIssue {
  code: string;
  message: string;
}

export interface JourneyValidation {
  errors: JourneyIssue[];
  warnings: JourneyIssue[];
  valid: boolean;
}

export interface JourneyDraft {
  name: string;
  description: string;
  side: Side;
  /** In the buyer's own order. */
  stages: Stage[];
  vendorInputPoints: VendorInputPoint[];
  evaluateAt?: Stage[];
  negotiateAt?: Stage[];
  clarifications?: boolean;
}

/**
 * `takenNames` is every journey name already visible at the authoring scope —
 * master and custom alike. Two journeys with one name is a support incident.
 */
export function validateJourney(draft: JourneyDraft, takenNames: string[]): JourneyValidation {
  const errors: JourneyIssue[] = [];
  const warnings: JourneyIssue[] = [];
  const stages = orderStages(draft.stages);
  const activities = activitiesOf(draft.stages, {
    evaluateAt: draft.evaluateAt,
    negotiateAt: draft.negotiateAt,
    clarifications: draft.clarifications,
  });
  const has = (s: Stage) => stages.includes(s);
  const solicitations = SOLICITATION_STAGES.filter(has);

  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push({ code: 'NAME_REQUIRED', message: 'A journey needs a name buyers will recognise in the create-event wizard.' });
  } else if (takenNames.some((t) => t.trim().toLowerCase() === name.toLowerCase())) {
    errors.push({ code: 'NAME_TAKEN', message: `"${name}" is already the name of a journey visible at this scope.` });
  }

  for (const stage of MANDATORY_STAGES) {
    if (!has(stage)) {
      errors.push({
        code: 'MISSING_MANDATORY',
        message: `${STAGE_LABELS[stage]} cannot be removed — every journey begins at intake and ends in an award decision.`,
      });
    }
  }

  // An activity switched on at a stage the journey does not run has nothing to
  // attach to. This is the replacement for the old REQUIRES_ONE_OF gate: the
  // dependency is now named rather than inferred from a position.
  for (const stage of activities.evaluateAt) {
    if (!has(stage)) {
      errors.push({
        code: 'ACTIVITY_HOST_MISSING',
        message: `Scoring is switched on at ${STAGE_LABELS[stage]}, which this journey does not run — there would be no responses to score.`,
      });
    }
  }
  for (const stage of activities.negotiateAt) {
    if (!has(stage)) {
      errors.push({
        code: 'ACTIVITY_HOST_MISSING',
        message: `Negotiation is switched on at ${STAGE_LABELS[stage]}, which this journey does not run — there would be nothing to negotiate against.`,
      });
    } else if (!activityFor('NEGOTIATION').hosts.includes(stage)) {
      errors.push({
        code: 'ACTIVITY_HOST_INVALID',
        message: `${STAGE_LABELS[stage]} cannot host a negotiation — counter-offers run against submitted prices, which means an RFQ or an auction.`,
      });
    }
  }

  for (const point of draft.vendorInputPoints) {
    const available = availableVendorPoints(stages, activities);
    if (!available.includes(point)) {
      errors.push({
        code: 'VENDOR_POINT_ORPHANED',
        message: `${STAGE_LABELS[point as Stage]} is set as a supplier touchpoint but the journey never runs it.`,
      });
    }
  }

  if (!has('APPROVAL')) {
    warnings.push({
      code: 'NO_APPROVAL',
      message: 'No approval stage — the award becomes binding without a DoA chain. JP-11 Spot Buy does this deliberately for tail spend.',
    });
  }

  if (draft.vendorInputPoints.length === 0) {
    warnings.push({
      code: 'NO_VENDOR_INPUT',
      message: 'No supplier touchpoints — nothing is ever asked of a supplier. Valid only for a call-off against an existing rate contract.',
    });
  }

  if (solicitations.length > 0 && activities.evaluateAt.length === 0) {
    warnings.push({
      code: 'NOTHING_SCORED',
      message: `Responses arrive at ${solicitations.map((s) => STAGE_LABELS[s]).join(', ')} and nothing scores them. The award is then made on price and judgement alone, which is deliberate for a commodity RFQ and a gap anywhere else.`,
    });
  }

  if (has('AUCTION') && solicitations.length === 0) {
    warnings.push({
      code: 'AUCTION_WITHOUT_SOLICITATION',
      message: 'The auction runs without a solicitation to qualify the field, so bidders must be invited and qualified by hand. JP-01 accepts this trade for speed.',
    });
  }

  // Order is the buyer's to set, so a surprising one is reported rather than
  // corrected — but an auction that opens before anyone has been qualified is
  // worth saying out loud, because the sequence is what makes it so.
  if (has('AUCTION') && solicitations.length > 0) {
    const auctionAt = stages.indexOf('AUCTION');
    const firstSolicitation = Math.min(...solicitations.map((s) => stages.indexOf(s)));
    if (auctionAt < firstSolicitation) {
      warnings.push({
        code: 'AUCTION_BEFORE_SOLICITATION',
        message: `The auction is sequenced before ${STAGE_LABELS[stages[firstSolicitation]]}, so bidders compete on price before the journey has qualified them. Deliberate for a sealed-floor auction; an accident if you dragged it there.`,
      });
    }
  }

  const equivalent = equivalentStages(stages, activities);
  const twin = ALL_PATTERNS.find(
    (p) =>
      p.stages.length === equivalent.length &&
      p.stages.every((s) => equivalent.includes(s)) &&
      (p.side === draft.side || p.side === 'ANY'),
  );
  if (twin) {
    warnings.push({
      code: 'DUPLICATES_MASTER',
      message: `These stages are exactly ${twin.id} ${twin.name}. Enabling the master pattern gives you the same journey with a tuned wizard.`,
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

// ---------------------------------------------------------------------------
// Enablement
// ---------------------------------------------------------------------------

/**
 * An absent `patterns.enabled` means every journey is available — a fresh
 * tenant should not have to opt in to the module's own master before it can
 * raise an event. Turning one off writes the explicit list.
 */
export function isJourneyEnabled(enabled: string[] | undefined, id: string): boolean {
  return enabled === undefined || enabled.includes(id);
}

export function toggleEnabled(
  enabled: string[] | undefined,
  allIds: string[],
  id: string,
): string[] {
  const current = enabled ?? allIds;
  return current.includes(id) ? current.filter((x) => x !== id) : normaliseOrder(allIds, [...current, id]);
}

function normaliseOrder(allIds: string[], selected: string[]): string[] {
  return allIds.filter((x) => selected.includes(x));
}

export function nextJourneyId(existing: CustomJourney[]): string {
  const used = existing
    .map((j) => Number(j.id.replace('CJ-', '')))
    .filter((n) => Number.isFinite(n));
  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  return `CJ-${String(next).padStart(2, '0')}`;
}
