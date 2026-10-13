/**
 * Consolidating requisition lines into one sourceable demand.
 *
 * The thing this module exists to make visible: **a basket is normally
 * single-category.** Lines from six requisitions are routinely sourced as one
 * event. Lines from two categories can be too — a buyer consolidating spend
 * across categories to win volume is doing something real — but it is never
 * free, because category drives the questionnaire, the bidder shortlist, the
 * evaluation model and the DoA chain, and an event carries exactly one of each.
 *
 * So a mixed basket is allowed and warned rather than refused. The event is
 * raised under the category holding the most lines, and the warning names that
 * category and what follows from it, so the buyer chooses the consequence
 * instead of discovering it at evaluation.
 *
 * The second rule: **only unsourced lines may enter a basket.** A line already
 * out in an event would otherwise be bid on twice for one requirement.
 *
 * The PRD number is assigned here and never typed by a user. It is the single
 * `sourceReference` the event carries, and it is what lets an award line be
 * walked back through the PRD to the requisition line that asked for it.
 */
import { lineValue } from './purchaseRequests';
import type {
  Id, PurchaseRequest, PurchaseRequestLine, ServerMillis, SourcingRequisition,
} from './types';

export interface BasketIssue {
  code: string;
  message: string;
}

export interface BasketValidation {
  errors: BasketIssue[];
  warnings: BasketIssue[];
  valid: boolean;
}

/**
 * The categories present in a selection, by weight of lines — the first is the
 * one an event spanning several would be raised under.
 *
 * Ranked rather than alphabetical because the lead category decides the
 * questionnaire and the approval chain: picking it by sort order would hand
 * those to whichever name happened to sort first.
 */
export function categoriesRanked(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): string[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const line of lines) {
    const category = byId.get(line.requestId)?.category;
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);
}

/** The categories present in a selection, sorted for display. */
export function categoriesIn(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): string[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  return Array.from(
    new Set(lines.map((l) => byId.get(l.requestId)?.category).filter((c): c is string => !!c)),
  ).sort();
}

/**
 * Whether a line may join a selection that already holds `selected`.
 *
 * Only one thing actually refuses a line: it is already out in an event, and
 * sourcing it twice would have two suppliers bidding for one requirement.
 * Crossing a category is permitted and reported — `warning` is set so the
 * caller can say what the cost is at the moment the line goes in, rather than
 * leaving the buyer to find out after the basket is built.
 */
export function canSelect(
  line: PurchaseRequestLine,
  selected: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): { allowed: boolean; reason: string | null; warning: string | null } {
  if (line.sourcingState !== 'UNSOURCED') {
    return {
      allowed: false,
      warning: null,
      reason: `Already ${line.sourcingState === 'IN_EVENT' ? 'out in an event' : line.sourcingState.toLowerCase().replace('_', ' ')} — it cannot be sourced twice.`,
    };
  }
  if (selected.length === 0) return { allowed: true, reason: null, warning: null };

  const current = categoriesRanked(selected, requests)[0];
  const own = categoriesIn([line], requests)[0];
  if (current && own && current !== own) {
    return {
      allowed: true,
      reason: null,
      warning: `The basket is sourcing ${current}. Adding ${own} makes this a cross-category event — one questionnaire, one shortlist and one approval chain will have to cover both.`,
    };
  }
  return { allowed: true, reason: null, warning: null };
}

export function validateBasket(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): BasketValidation {
  const errors: BasketIssue[] = [];
  const warnings: BasketIssue[] = [];

  if (lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Select at least one requisition line to source.' });
    return { errors, warnings, valid: false };
  }

  const ranked = categoriesRanked(lines, requests);
  if (ranked.length > 1) {
    const lead = ranked[0];
    const others = ranked.slice(1);
    const counts = new Map<string, number>();
    const byId = new Map(requests.map((r) => [r.id, r]));
    for (const l of lines) {
      const category = byId.get(l.requestId)?.category;
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    warnings.push({
      code: 'MIXED_CATEGORY',
      message: `The selection spans ${ranked.length} categories — ${ranked.map((c) => `${c} (${counts.get(c)})`).join(', ')}. The event will be raised under ${lead}, so its questionnaire, bidder shortlist and DoA chain resolve against ${lead} and apply unchanged to the ${others.join(' and ')} lines. Split the basket if any of those three need to differ.`,
    });
  }

  const alreadySourced = lines.filter((l) => l.sourcingState !== 'UNSOURCED');
  if (alreadySourced.length > 0) {
    errors.push({
      code: 'NOT_SOURCEABLE',
      message: `${alreadySourced.length} selected ${alreadySourced.length === 1 ? 'line is' : 'lines are'} already sourced and cannot go into a second event.`,
    });
  }

  const units = businessUnitsIn(lines, requests);
  if (units.length > 1) {
    warnings.push({
      code: 'MIXED_BUSINESS_UNIT',
      message: `Lines come from ${units.length} business units (${units.join(', ')}). The event will be raised under ${units[0]}, and the DoA chain resolves against that.`,
    });
  }

  const currencies = Array.from(new Set(lines.map((l) => l.currency)));
  if (currencies.length > 1) {
    errors.push({
      code: 'MIXED_CURRENCY',
      message: `The selection mixes ${currencies.join(' and ')}. Bids cannot be ranked across currencies without a rate, which this event has no way to fix.`,
    });
  }

  const unpriced = lines.filter((l) => l.indicativePrice === null);
  if (unpriced.length > 0) {
    warnings.push({
      code: 'UNPRICED_LINES',
      message: `${unpriced.length} ${unpriced.length === 1 ? 'line has' : 'lines have'} no indicative price, so they contribute nothing to the estimated value and no baseline for savings.`,
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

/** Business units in the selection, most-represented first. */
export function businessUnitsIn(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): string[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const line of lines) {
    const unit = byId.get(line.requestId)?.businessUnit;
    if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([unit]) => unit);
}

export function requestNumbersIn(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): string[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  return Array.from(
    new Set(lines.map((l) => byId.get(l.requestId)?.requestNumber).filter((n): n is string => !!n)),
  ).sort();
}

/** Sequential and system-assigned — a user never types a PRD number. */
export function nextPrdNumber(existing: SourcingRequisition[], year = 2026): string {
  const used = existing
    .map((r) => Number(r.prdNumber.split('-')[2]))
    .filter((n) => Number.isFinite(n));
  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  return `PRD-${year}-${String(next).padStart(4, '0')}`;
}

export function buildSourcingRequisition({
  lines, requests, existing, userId, now,
}: {
  lines: PurchaseRequestLine[];
  requests: PurchaseRequest[];
  existing: SourcingRequisition[];
  userId: Id;
  now: ServerMillis;
}): SourcingRequisition {
  const validation = validateBasket(lines, requests);
  if (!validation.valid) {
    throw new Error(`Cannot consolidate: ${validation.errors.map((e) => e.message).join(' ')}`);
  }

  const byId = new Map(requests.map((r) => [r.id, r]));
  const first = byId.get(lines[0].requestId);
  const prdNumber = nextPrdNumber(existing);

  return {
    id: `prd-${prdNumber.toLowerCase()}`,
    prdNumber,
    tenantId: first?.tenantId ?? 'tenant-udaan',
    lineIds: lines.map((l) => l.id),
    requestNumbers: requestNumbersIn(lines, requests),
    // The category holding the most lines — a cross-category basket is raised
    // under its lead, and validateBasket has already warned that it is.
    category: categoriesRanked(lines, requests)[0],
    superCategory: first?.superCategory ?? null,
    businessUnits: businessUnitsIn(lines, requests),
    currency: lines[0].currency,
    createdBy: userId,
    createdAt: now,
    eventId: null,
  };
}

// ---------------------------------------------------------------------------
// Handing the demand to the event
// ---------------------------------------------------------------------------

/**
 * The lot a line lands in.
 *
 * Grouped by item family — the noun before the first comma in the description —
 * because that is how a buyer actually lots: like competes with like, and a
 * supplier strong in cable should not have to price laptops to win the cable.
 * Grouping by source requisition instead would be traceable and commercially
 * meaningless.
 */
export function lotNameFor(line: PurchaseRequestLine): string {
  const noun = line.description.split(',')[0].trim();
  return noun.length > 0 ? noun : 'General';
}

export interface ConsolidatedLine {
  id: Id;
  itemCode: string;
  description: string;
  /** Carried across so the event line asks for what the requisition asked for. */
  specification: string;
  quantity: number;
  uom: string;
  deliveryLocation: string;
  needBy: string;
  baselinePrice: number | null;
  lotName: string;
  /**
   * The category of the requisition this line came from. Carried onto the
   * event line because a consolidated event can span several, and the bidder
   * shortlist is built per category rather than per event.
   */
  category: string;
  superCategory: string | null;
  /** Traceability, carried onto the event line. */
  sourcePrLineId: Id;
  sourceRequestNumber: string;
}

/**
 * Turn the consolidated demand into event lines, numbered lots in a stable
 * order so two runs of the same basket produce the same lotting.
 */
export function toConsolidatedLines(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): ConsolidatedLine[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const families = Array.from(new Set(lines.map(lotNameFor))).sort();

  return lines.map((line) => {
    const family = lotNameFor(line);
    const request = byId.get(line.requestId);
    return {
      id: `dl-${line.id}`,
      itemCode: line.itemCode,
      description: line.description,
      specification: line.specification,
      quantity: line.quantity,
      uom: line.uom,
      deliveryLocation: line.deliveryLocation,
      needBy: line.needBy,
      baselinePrice: line.indicativePrice,
      lotName: `Lot ${families.indexOf(family) + 1} · ${family}`,
      category: request?.category ?? '',
      superCategory: request?.superCategory ?? null,
      sourcePrLineId: line.id,
      sourceRequestNumber: request?.requestNumber ?? '',
    };
  });
}

/** Estimated value of the consolidated demand. */
export function basketValue(lines: PurchaseRequestLine[]): number {
  return lines.reduce((total, line) => total + lineValue(line), 0);
}

/**
 * A title a buyer would not have to rewrite. Category plus the span of source
 * requisitions is more useful than either alone.
 */
export function suggestedTitle(
  lines: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): string {
  const ranked = categoriesRanked(lines, requests);
  const category = ranked[0] ?? 'Consolidated';
  const numbers = requestNumbersIn(lines, requests);
  // A cross-category title says so, because the category in it is only the
  // lead one and a buyer reading the event later should not be misled.
  const subject = ranked.length > 1
    ? `${category} and ${ranked.length - 1} further ${ranked.length === 2 ? 'category' : 'categories'}`
    : category;
  if (numbers.length === 1) return `${subject} — ${numbers[0]}`;
  return `${subject} — consolidated across ${numbers.length} requisitions`;
}
