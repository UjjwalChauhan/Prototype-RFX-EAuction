/**
 * The agent catalogue.
 *
 * Sixteen discrete, named, individually-toggleable agents with explicit
 * mandates — deliberately not one general assistant. Agents assist; humans
 * decide. The hard limits below are not configurable at any scope and are
 * surfaced as permanently-disabled, explained controls so administrators can
 * see the boundary rather than wonder whether it exists.
 */
import type { AgentCode, AgentDefinition, AgentMandate, AutonomyLevel } from './types';

export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  'OFF', 'SUGGEST', 'DRAFT', 'ACT_WITH_APPROVAL', 'AUTONOMOUS',
];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  OFF: 'Off',
  SUGGEST: 'Suggest',
  DRAFT: 'Draft',
  ACT_WITH_APPROVAL: 'Act with approval',
  AUTONOMOUS: 'Autonomous within mandate',
};

export const AGENT_CATALOGUE: Record<AgentCode, AgentDefinition> = {
  'AG-01': { code: 'AG-01', name: 'Intake & Event Setup', stage: 'Intake', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'DRAFT', mandate: 'Consolidate requisition lines, classify, propose a journey pattern.', cannot: ['Publish an event without a human'] },
  'AG-02': { code: 'AG-02', name: 'Supplier Discovery & Shortlist', stage: 'Bidder selection', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'SUGGEST', mandate: 'Propose bidders from the master and market signals.', cannot: ['Disqualify a counterparty'] },
  'AG-03': { code: 'AG-03', name: 'Questionnaire Builder', stage: 'Event build', maxAutonomy: 'DRAFT', defaultAutonomy: 'DRAFT', mandate: 'Draft questions from the category and template library.', cannot: ['Publish a questionnaire'] },
  'AG-04': { code: 'AG-04', name: 'Document Extraction', stage: 'Response intake', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'ACT_WITH_APPROVAL', mandate: 'Extract structured values from supplier attachments.', cannot: ['Alter a submitted bid'] },
  'AG-05': { code: 'AG-05', name: 'Clarification', stage: 'Any open stage', maxAutonomy: 'DRAFT', defaultAutonomy: 'DRAFT', mandate: 'Draft answers with cited sources.', cannot: ['Publish an answer', 'Answer privately on a substantive matter'] },
  'AG-06': { code: 'AG-06', name: 'Technical Evaluation', stage: 'Evaluation', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'SUGGEST', mandate: 'Propose scores with confidence and cited evidence.', cannot: ['Write a score below its confidence threshold without degrading to assisted'] },
  'AG-07': { code: 'AG-07', name: 'Commercial Normalisation', stage: 'Evaluation', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'ACT_WITH_APPROVAL', mandate: 'Propose bid-transformation values from master data.', cannot: ["Alter a supplier's quoted figure"] },
  'AG-08': { code: 'AG-08', name: 'Compliance & Risk', stage: 'Continuous', maxAutonomy: 'AUTONOMOUS', defaultAutonomy: 'AUTONOMOUS', mandate: 'Flag compliance and risk findings. Flag only, never block.', cannot: ['Block a process', 'Override a failed statutory validation'] },
  'AG-09': { code: 'AG-09', name: 'Negotiation', stage: 'Negotiation', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'SUGGEST', mandate: 'Recommend a target, draft counter-offers, run tail-spend rounds within mandate.', cannot: ['Go below the mandate floor', 'Exceed the round limit', 'Award'] },
  'AG-10': { code: 'AG-10', name: 'Auction Orchestration', stage: 'Auction live', maxAutonomy: 'SUGGEST', defaultAutonomy: 'SUGGEST', mandate: 'Suggest extensions, nudges and integrity checks during a live auction.', cannot: ['Start, pause, extend or close an auction without human confirmation'] },
  'AG-11': { code: 'AG-11', name: 'Award Optimisation', stage: 'Award', maxAutonomy: 'SUGGEST', defaultAutonomy: 'SUGGEST', mandate: 'Compute the optimal allocation and explain the binding constraints.', cannot: ['Make a final award decision'] },
  'AG-12': { code: 'AG-12', name: 'NFA / Award Note', stage: 'Award', maxAutonomy: 'DRAFT', defaultAutonomy: 'DRAFT', mandate: 'Draft NFA sections 2–9 and 11.', cannot: ['Write the recommendation', 'Submit an NFA'] },
  'AG-13': { code: 'AG-13', name: 'Savings Validation', stage: 'Award / post-award', maxAutonomy: 'AUTONOMOUS', defaultAutonomy: 'AUTONOMOUS', mandate: 'Flag baseline anomalies.', cannot: ['Change a baseline'] },
  'AG-14': { code: 'AG-14', name: 'Vendor Performance', stage: 'Continuous', maxAutonomy: 'AUTONOMOUS', defaultAutonomy: 'AUTONOMOUS', mandate: 'Maintain the performance rating from event and fulfilment outcomes.', cannot: ['Disqualify a counterparty'] },
  'AG-15': { code: 'AG-15', name: 'Event Retrospective', stage: 'Post-event', maxAutonomy: 'AUTONOMOUS', defaultAutonomy: 'AUTONOMOUS', mandate: 'Report on what the event achieved. Report only.', cannot: ['Change any event record'] },
  'AG-16': { code: 'AG-16', name: 'Rate Refresh / Watchdog', stage: 'Continuous', maxAutonomy: 'ACT_WITH_APPROVAL', defaultAutonomy: 'SUGGEST', mandate: 'Monitor contract expiry and index drift; raise a refresh event.', cannot: ['Publish a refresh event without approval'] },
};

export const ALL_AGENTS = Object.values(AGENT_CATALOGUE);

/**
 * The eight hard limits. Not configurable at any scope, for any agent.
 * `assertAgentMayNot` is called at every boundary an agent could reach.
 */
export const AGENT_HARD_LIMITS = [
  'Approve any step in a DoA chain',
  'Make a final award decision',
  'Alter, delete or withdraw a submitted bid',
  'Disqualify a counterparty (may recommend with evidence)',
  'Release a PO, contract, LoA or sales order',
  'Override a failed mandatory statutory validation',
  'Start, pause, extend or close a live auction without human confirmation',
  'Change a target, reserve, ceiling or floor price without human confirmation',
] as const;

export type AgentForbiddenAction =
  | 'APPROVE_DOA_STEP'
  | 'FINAL_AWARD'
  | 'MUTATE_BID'
  | 'DISQUALIFY_COUNTERPARTY'
  | 'RELEASE_PO'
  | 'OVERRIDE_STATUTORY'
  | 'CONTROL_AUCTION_UNCONFIRMED'
  | 'CHANGE_PRICE_CONTROL_UNCONFIRMED';

const FORBIDDEN_MESSAGES: Record<AgentForbiddenAction, string> = {
  APPROVE_DOA_STEP: 'No agent may approve a step in a DoA chain.',
  FINAL_AWARD: 'No agent may make a final award decision.',
  MUTATE_BID: 'No agent may alter, delete or withdraw a submitted bid.',
  DISQUALIFY_COUNTERPARTY: 'No agent may disqualify a counterparty. It may recommend, with evidence.',
  RELEASE_PO: 'No agent may release a PO, contract, LoA or sales order.',
  OVERRIDE_STATUTORY: 'No agent may override a failed mandatory statutory validation.',
  CONTROL_AUCTION_UNCONFIRMED: 'No agent may start, pause, extend or close a live auction without human confirmation.',
  CHANGE_PRICE_CONTROL_UNCONFIRMED: 'No agent may change a target, reserve, ceiling or floor price without human confirmation.',
};

export class AgentLimitError extends Error {
  constructor(public action: AgentForbiddenAction) {
    super(FORBIDDEN_MESSAGES[action]);
    this.name = 'AgentLimitError';
  }
}

/** Throws. There is no flag that makes this pass. */
export function assertAgentMayNot(action: AgentForbiddenAction): never {
  throw new AgentLimitError(action);
}

export function forbiddenReason(action: AgentForbiddenAction): string {
  return FORBIDDEN_MESSAGES[action];
}

export const DEFAULT_MANDATE: AgentMandate = {
  valueCeiling: 250_000,
  categoryScope: ['Indirect', 'Facilities'],
  counterpartyScope: [],
  priceFloor: null,
  maxRounds: 2,
  confidenceThreshold: 0.75,
  timeWindow: 'Business hours',
  escalateTo: 'Category Manager',
};

export interface MandateCheck {
  withinMandate: boolean;
  breaches: string[];
}

export function checkMandate(
  mandate: AgentMandate,
  facts: { value: number; category: string; roundNumber: number; confidence: number; proposedPrice: number | null },
): MandateCheck {
  const breaches: string[] = [];
  if (mandate.valueCeiling !== null && facts.value > mandate.valueCeiling) {
    breaches.push(`Value ${facts.value.toLocaleString()} exceeds the mandate ceiling of ${mandate.valueCeiling.toLocaleString()}.`);
  }
  if (mandate.categoryScope.length > 0 && !mandate.categoryScope.includes(facts.category)) {
    breaches.push(`Category "${facts.category}" is outside the mandate scope.`);
  }
  if (mandate.maxRounds !== null && facts.roundNumber > mandate.maxRounds) {
    breaches.push(`Round ${facts.roundNumber} exceeds the mandate limit of ${mandate.maxRounds}.`);
  }
  if (facts.confidence < mandate.confidenceThreshold) {
    breaches.push(`Confidence ${(facts.confidence * 100).toFixed(0)}% is below the ${(mandate.confidenceThreshold * 100).toFixed(0)}% threshold — degrading to assisted.`);
  }
  if (mandate.priceFloor !== null && facts.proposedPrice !== null && facts.proposedPrice < mandate.priceFloor) {
    breaches.push(`Proposed price is below the mandate floor of ${mandate.priceFloor.toLocaleString()}.`);
  }
  return { withinMandate: breaches.length === 0, breaches };
}

/**
 * An AI_AUTO agent degrades to AI_ASSISTED below its confidence threshold —
 * it never silently writes a low-confidence value.
 */
export function effectiveAutonomy(
  configured: AutonomyLevel,
  definition: AgentDefinition,
  confidence: number | null,
  threshold: number,
): AutonomyLevel {
  const cap = AUTONOMY_LEVELS.indexOf(definition.maxAutonomy);
  const requested = AUTONOMY_LEVELS.indexOf(configured);
  let level = AUTONOMY_LEVELS[Math.min(cap, requested)];
  if (
    confidence !== null &&
    confidence < threshold &&
    (level === 'AUTONOMOUS' || level === 'ACT_WITH_APPROVAL')
  ) {
    level = 'SUGGEST';
  }
  return level;
}
