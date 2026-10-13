/**
 * Journey composition — building a custom journey out of stage components.
 *
 * The load-bearing constraint: **a journey is a subset of the canonical stage
 * order, never a re-ordering.** `buildStageRail` and `workspaceTabs` both walk
 * `STAGE_ORDER`, so a journey claiming AUCTION before RFQ would still render in
 * canonical order and the configuration would be a lie. The composer therefore
 * offers inclusion only, and normalises whatever it is handed back into
 * `STAGE_ORDER`.
 *
 * The second idea: nothing here is hand-entered that can be derived. Wizard
 * steps, workspace tabs, vendor task labels and the duration estimate are all
 * computed from the stage set, so a composed journey cannot drift out of step
 * with what the product will actually do when it runs.
 */
import {
  STAGE_LABELS, STAGE_ORDER,
  WIZARD_AUCTION, WIZARD_BASICS, WIZARD_BIDDERS, WIZARD_EVALUATION, WIZARD_ITEMS,
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
  /** At least one of these stages must also be present. */
  requiresOneOf: Stage[];
  /** Rough working days this stage adds, for the duration estimate. */
  typicalDays: number;
}

/** Stages a supplier can be asked to act at. Mirrors `VendorInputPoint`. */
const VENDOR_FACING: Stage[] = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'];

/** A stage that puts a solicitation in front of suppliers and collects responses. */
export const SOLICITATION_STAGES: Stage[] = ['RFI', 'RFP', 'RFQ'];

/** Stages that imply a competitive field, and therefore a bidder list. */
const COMPETITIVE_STAGES: Stage[] = ['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'];

export const MANDATORY_STAGES: Stage[] = ['INTAKE', 'AWARD'];

export const STAGE_COMPONENTS: StageComponent[] = [
  {
    stage: 'INTAKE', label: STAGE_LABELS.INTAKE, mandatory: true, vendorFacing: true,
    requiresOneOf: [], typicalDays: 0,
    purpose: 'Demand arrives — from a PR, a contract expiry, a short close, or manually. Every journey starts here.',
  },
  {
    stage: 'RFI', label: STAGE_LABELS.RFI, mandatory: false, vendorFacing: true,
    requiresOneOf: [], typicalDays: 5,
    purpose: 'Qualify the market before asking anyone for a price. Capability and credentials only — no commercials.',
  },
  {
    stage: 'RFP', label: STAGE_LABELS.RFP, mandatory: false, vendorFacing: true,
    requiresOneOf: [], typicalDays: 10,
    purpose: 'Solicit a full proposal — scope, method and commercials. Carries technical weighting, and is what two-envelope mode seals.',
  },
  {
    stage: 'RFQ', label: STAGE_LABELS.RFQ, mandatory: false, vendorFacing: true,
    requiresOneOf: [], typicalDays: 3,
    purpose: 'Ask a qualified field for prices against a fixed specification.',
  },
  {
    stage: 'CLARIFICATION', label: STAGE_LABELS.CLARIFICATION, mandatory: false, vendorFacing: false,
    requiresOneOf: SOLICITATION_STAGES, typicalDays: 2,
    purpose: 'A formal Q&A window held open as its own gate. Substantive answers are broadcast to every bidder — that fairness rule is not configurable.',
  },
  {
    stage: 'EVALUATION', label: STAGE_LABELS.EVALUATION, mandatory: false, vendorFacing: false,
    requiresOneOf: SOLICITATION_STAGES, typicalDays: 4,
    purpose: 'Score responses against the questionnaire and gate on the technical result. Needs responses to score.',
  },
  {
    stage: 'NEGOTIATION', label: STAGE_LABELS.NEGOTIATION, mandatory: false, vendorFacing: true,
    requiresOneOf: SOLICITATION_STAGES, typicalDays: 4,
    purpose: 'Structured counter-offer rounds against submitted responses. Bounded by negotiation.max_rounds.',
  },
  {
    stage: 'AUCTION', label: STAGE_LABELS.AUCTION, mandatory: false, vendorFacing: true,
    requiresOneOf: [], typicalDays: 1,
    purpose: 'A live competitive event that compresses price. The feedback policy set in the Auction domain governs what bidders see.',
  },
  {
    stage: 'AWARD', label: STAGE_LABELS.AWARD, mandatory: true, vendorFacing: false,
    requiresOneOf: [], typicalDays: 1,
    purpose: 'Pick the winner, record the reasoning, produce the NFA. Every journey ends in an award decision.',
  },
  {
    stage: 'APPROVAL', label: STAGE_LABELS.APPROVAL, mandatory: false, vendorFacing: false,
    requiresOneOf: [], typicalDays: 2,
    purpose: 'Route the award through the DoA chain before it becomes binding. Omitting this makes the award immediate.',
  },
];

export function componentFor(stage: Stage): StageComponent {
  return STAGE_COMPONENTS.find((c) => c.stage === stage)!;
}

// ---------------------------------------------------------------------------
// A composed journey
// ---------------------------------------------------------------------------

export interface CustomJourney {
  id: string;
  name: string;
  description: string;
  side: Side;
  stages: Stage[];
  vendorInputPoints: VendorInputPoint[];
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
    vendorInputPoints: p.vendorInputPoints,
    wizardSteps: p.wizardSteps,
    duration: p.typicalDuration,
    serves: p.serves,
    origin: 'MASTER' as const,
    scopeType: null,
  }));
}

export function customSummary(journey: CustomJourney): JourneySummary {
  return {
    id: journey.id,
    name: journey.name,
    description: journey.description,
    side: journey.side,
    stages: normaliseStages(journey.stages),
    vendorInputPoints: journey.vendorInputPoints,
    wizardSteps: deriveWizardSteps(journey.stages, journey.vendorInputPoints),
    duration: estimateDuration(journey.stages),
    serves: journey.description,
    origin: 'CUSTOM',
    scopeType: journey.scopeType,
  };
}

// ---------------------------------------------------------------------------
// Derivation — everything that must not be hand-entered
// ---------------------------------------------------------------------------

/** Sort an arbitrary selection back into canonical order, dropping duplicates. */
export function normaliseStages(stages: Stage[]): Stage[] {
  return STAGE_ORDER.filter((s) => stages.includes(s));
}

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
  stages: Stage[], vendorInputPoints: VendorInputPoint[] = availableVendorPoints(stages),
): string[] {
  const has = (s: Stage) => stages.includes(s);
  const anyOf = (list: Stage[]) => list.some(has);

  const steps: string[] = [WIZARD_BASICS, WIZARD_ITEMS];
  if (anyOf(COMPETITIVE_STAGES)) steps.push(WIZARD_BIDDERS);
  if (anyOf(SOLICITATION_STAGES)) steps.push(WIZARD_QUESTIONNAIRE);
  // Terms belong wherever the journey asks a supplier for anything at all —
  // a quote at intake and a bid in an auction are both commitments, and
  // publishing is blocked when an ask goes out with nothing attached. A
  // weighted evaluation model is narrower: it is worth a step only where the
  // journey negotiates or scores a proposal.
  if (vendorInputPoints.length > 0) steps.push(WIZARD_TERMS);
  if (has('RFP') || has('NEGOTIATION')) steps.push(WIZARD_EVALUATION);
  if (has('AUCTION')) steps.push(WIZARD_AUCTION);
  if (anyOf(SOLICITATION_STAGES)) steps.push(WIZARD_TIMELINE);
  steps.push(WIZARD_REVIEW);
  return steps;
}

/** Vendor input points a stage set can legally offer. */
export function availableVendorPoints(stages: Stage[]): VendorInputPoint[] {
  return normaliseStages(stages)
    .filter((s) => VENDOR_FACING.includes(s))
    .map((s) => s as VendorInputPoint);
}

/**
 * An estimate, not a promise. The master patterns state durations observed in
 * practice; a composed journey has none, so the studio shows a computed figure
 * and labels it as computed.
 */
export function estimateDuration(stages: Stage[]): string {
  const days = normaliseStages(stages).reduce((total, s) => total + componentFor(s).typicalDays, 0);
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
  stages: Stage[];
  vendorInputPoints: VendorInputPoint[];
}

/**
 * `takenNames` is every journey name already visible at the authoring scope —
 * master and custom alike. Two journeys with one name is a support incident.
 */
export function validateJourney(draft: JourneyDraft, takenNames: string[]): JourneyValidation {
  const errors: JourneyIssue[] = [];
  const warnings: JourneyIssue[] = [];
  const stages = normaliseStages(draft.stages);
  const has = (s: Stage) => stages.includes(s);

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

  for (const stage of stages) {
    const component = componentFor(stage);
    if (component.requiresOneOf.length > 0 && !component.requiresOneOf.some(has)) {
      errors.push({
        code: 'REQUIRES_ONE_OF',
        message: `${component.label} needs one of ${component.requiresOneOf.map((s) => STAGE_LABELS[s]).join(', ')} before it — there is nothing to work on otherwise.`,
      });
    }
  }

  for (const point of draft.vendorInputPoints) {
    if (!has(point as Stage)) {
      errors.push({
        code: 'VENDOR_POINT_ORPHANED',
        message: `${STAGE_LABELS[point as Stage]} is set as a supplier touchpoint but its stage is not in the journey.`,
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

  if (has('AUCTION') && !SOLICITATION_STAGES.some(has)) {
    warnings.push({
      code: 'AUCTION_WITHOUT_SOLICITATION',
      message: 'The auction runs without a solicitation to qualify the field, so bidders must be invited and qualified by hand. JP-01 accepts this trade for speed.',
    });
  }

  const twin = ALL_PATTERNS.find(
    (p) =>
      p.stages.length === stages.length &&
      p.stages.every((s) => stages.includes(s)) &&
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
