/**
 * Consolidating requisition lines into one sourceable demand.
 *
 * The thing this module exists to enforce: **a basket is single-category.**
 * Lines from six requisitions can be sourced as one event; lines from two
 * categories cannot, because category drives the questionnaire, the bidder
 * shortlist, the evaluation model and the DoA chain. A mixed basket would have
 * to pick one of those and silently mis-apply it to the rest.
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

/** The categories present in a selection. More than one is a blocking error. */
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
 * An empty selection accepts any unsourced line; after that, category binds.
 */
export function canSelect(
  line: PurchaseRequestLine,
  selected: PurchaseRequestLine[],
  requests: PurchaseRequest[],
): { allowed: boolean; reason: string | null } {
  if (line.sourcingState !== 'UNSOURCED') {
    return {
      allowed: false,
      reason: `Already ${line.sourcingState === 'IN_EVENT' ? 'out in an event' : line.sourcingState.toLowerCase().replace('_', ' ')} — it cannot be sourced twice.`,
    };
  }
  if (selected.length === 0) return { allowed: true, reason: null };

  const current = categoriesIn(selected, requests)[0];
  const own = categoriesIn([line], requests)[0];
  if (current && own && current !== own) {
    return {
      allowed: false,
      reason: `The basket is sourcing ${current}. Category drives the questionnaire, the shortlist and the approval chain, so one event cannot carry two.`,
    };
  }
  return { allowed: true, reason: null };
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

  const categories = categoriesIn(lines, requests);
  if (categories.length > 1) {
    errors.push({
      code: 'MIXED_CATEGORY',
      message: `The selection spans ${categories.join(' and ')}. One event carries one category — raise a separate event per category.`,
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
    category: categoriesIn(lines, requests)[0],
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
  quantity: number;
  uom: string;
  baselinePrice: number | null;
  lotName: string;
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
    return {
      id: `dl-${line.id}`,
      itemCode: line.itemCode,
      description: line.description,
      quantity: line.quantity,
      uom: line.uom,
      baselinePrice: line.indicativePrice,
      lotName: `Lot ${families.indexOf(family) + 1} · ${family}`,
      sourcePrLineId: line.id,
      sourceRequestNumber: byId.get(line.requestId)?.requestNumber ?? '',
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
  const category = categoriesIn(lines, requests)[0] ?? 'Consolidated';
  const numbers = requestNumbersIn(lines, requests);
  if (numbers.length === 1) return `${category} — ${numbers[0]}`;
  return `${category} — consolidated across ${numbers.length} requisitions`;
}
