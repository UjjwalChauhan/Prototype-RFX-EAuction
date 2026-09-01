/**
 * Purchase requests, from the sourcing side.
 *
 * A PR is not a sourcing object — it is the demand a sourcing event is raised
 * against. What the RFx module cares about is therefore not the requisition's
 * own workflow but its **lines**: which are still unsourced, which are out in an
 * event, and which are already covered.
 *
 * Two rules the rest of the module depends on:
 *
 * 1. **A header's amount is derived from its lines, never stored.** A list row
 *    and its expanded detail are computed from the same array, so they cannot
 *    disagree — which is the usual way a requisition list goes wrong.
 * 2. **Sourceable means unsourced.** A line already out in an event cannot be
 *    put into a second one; `sourceableLines` is the only function permitted to
 *    answer "what can this PR still feed into an event".
 */
import type { StatusPresentation } from './statusMachine';
import type {
  PrLineSourcingState, PrStatus, PurchaseRequest, PurchaseRequestLine,
} from './types';

export const PR_STATUS_PRESENTATION: Record<PrStatus, StatusPresentation> = {
  DRAFT: { label: 'Draft', icon: '○', fg: '#374151', bg: '#F1F2F4' },
  PENDING: { label: 'Pending', icon: '◐', fg: '#6D28D9', bg: '#F3E8FF' },
  APPROVAL: { label: 'Approval', icon: '◑', fg: '#6D28D9', bg: '#F3E8FF' },
  APPROVED: { label: 'Approved', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  SOURCING: { label: 'Sourcing', icon: '●', fg: '#0369A1', bg: '#E0F2FE' },
  PARTIALLY_SOURCED: { label: 'Partially Sourced', icon: '◧', fg: '#B45309', bg: '#FEF3C7' },
  CLOSED: { label: 'Closed', icon: '✓', fg: '#374151', bg: '#F1F2F4' },
  REJECTED: { label: 'Rejected', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
};

export const SOURCING_STATE_PRESENTATION: Record<PrLineSourcingState, StatusPresentation> = {
  UNSOURCED: { label: 'Unsourced', icon: '○', fg: '#B45309', bg: '#FEF3C7' },
  IN_EVENT: { label: 'In event', icon: '●', fg: '#0369A1', bg: '#E0F2FE' },
  AWARDED: { label: 'Awarded', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  ON_CONTRACT: { label: 'On contract', icon: '▣', fg: '#374151', bg: '#F1F2F4' },
  CANCELLED: { label: 'Cancelled', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function linesFor(
  lines: PurchaseRequestLine[],
  requestId: string,
): PurchaseRequestLine[] {
  return lines
    .filter((l) => l.requestId === requestId)
    .sort((a, b) => a.lineNumber - b.lineNumber);
}

/** Extended value of one line. Null indicative price contributes nothing. */
export function lineValue(line: PurchaseRequestLine): number {
  return line.indicativePrice === null ? 0 : line.indicativePrice * line.quantity;
}

/**
 * The header amount. Cancelled lines are excluded — a requisition's value is
 * what it is still asking for, not what it once asked for.
 */
export function requestAmount(lines: PurchaseRequestLine[]): number {
  return lines
    .filter((l) => l.sourcingState !== 'CANCELLED')
    .reduce((total, line) => total + lineValue(line), 0);
}

export interface SourcingRollup {
  total: number;
  unsourced: number;
  inEvent: number;
  awarded: number;
  onContract: number;
  cancelled: number;
  /** Value of the lines still available to be sourced. */
  unsourcedValue: number;
  /** Distinct events this requisition's lines are already out in. */
  events: string[];
}

export function sourcingRollup(lines: PurchaseRequestLine[]): SourcingRollup {
  const count = (state: PrLineSourcingState) => lines.filter((l) => l.sourcingState === state).length;
  return {
    total: lines.length,
    unsourced: count('UNSOURCED'),
    inEvent: count('IN_EVENT'),
    awarded: count('AWARDED'),
    onContract: count('ON_CONTRACT'),
    cancelled: count('CANCELLED'),
    unsourcedValue: requestAmount(lines.filter((l) => l.sourcingState === 'UNSOURCED')),
    events: Array.from(
      new Set(lines.map((l) => l.eventNumber).filter((e): e is string => e !== null)),
    ).sort(),
  };
}

/**
 * The lines this requisition can still feed into a new event. A line already
 * out in an event, awarded, on contract or cancelled is not sourceable — it
 * would otherwise be bid on twice.
 */
export function sourceableLines(lines: PurchaseRequestLine[]): PurchaseRequestLine[] {
  return lines.filter((l) => l.sourcingState === 'UNSOURCED');
}

/**
 * The status a header should be showing, given its lines. Approval states are
 * the requisition's own business and are left alone; anything downstream of
 * approval is a projection of where the lines actually are.
 */
export function derivedStatus(request: PurchaseRequest, lines: PurchaseRequestLine[]): PrStatus {
  const settled: PrStatus[] = ['DRAFT', 'PENDING', 'APPROVAL', 'REJECTED'];
  if (settled.includes(request.status)) return request.status;

  const live = lines.filter((l) => l.sourcingState !== 'CANCELLED');
  if (live.length === 0) return 'CLOSED';

  const rollup = sourcingRollup(live);
  if (rollup.awarded + rollup.onContract === live.length) return 'CLOSED';
  if (rollup.unsourced === live.length) return 'APPROVED';
  if (rollup.unsourced === 0) return 'SOURCING';
  return 'PARTIALLY_SOURCED';
}

// ---------------------------------------------------------------------------
// The list's tabs and filters
// ---------------------------------------------------------------------------

export type PrTab = 'requested' | 'pending' | 'history' | 'all';

export const PR_TAB_LABELS: Record<PrTab, string> = {
  requested: 'Requested',
  pending: 'Pending',
  history: 'History',
  all: 'All Purchase Requests',
};

const PENDING_STATUSES: PrStatus[] = ['PENDING', 'APPROVAL'];
const HISTORY_STATUSES: PrStatus[] = ['CLOSED', 'REJECTED'];

/**
 * `requested` is scoped to the signed-in user, which is the only tab that is
 * about *who asked* rather than *where it is*.
 */
export function matchesTab(request: PurchaseRequest, tab: PrTab, currentUserId: string): boolean {
  switch (tab) {
    case 'requested': return request.submittedById === currentUserId;
    case 'pending': return PENDING_STATUSES.includes(request.status);
    case 'history': return HISTORY_STATUSES.includes(request.status);
    case 'all': return true;
  }
}

export interface PrFilter {
  tab: PrTab;
  search: string;
  category: string;
  status: PrStatus | 'all';
  /** Only requisitions with lines still available to source. */
  sourceableOnly: boolean;
}

export function filterRequests(
  requests: PurchaseRequest[],
  lines: PurchaseRequestLine[],
  filter: PrFilter,
  currentUserId: string,
): PurchaseRequest[] {
  const needle = filter.search.trim().toLowerCase();

  return requests.filter((request) => {
    if (!matchesTab(request, filter.tab, currentUserId)) return false;
    if (filter.category !== 'all' && request.category !== filter.category) return false;
    if (filter.status !== 'all' && request.status !== filter.status) return false;

    const own = linesFor(lines, request.id);
    if (filter.sourceableOnly && sourceableLines(own).length === 0) return false;

    if (needle.length > 0) {
      // Search reaches into the lines: a buyer looks for an item, not a number.
      const inHeader =
        request.requestNumber.toLowerCase().includes(needle) ||
        request.title.toLowerCase().includes(needle) ||
        request.submittedByName.toLowerCase().includes(needle) ||
        request.category.toLowerCase().includes(needle);
      const inLines = own.some(
        (l) =>
          l.itemCode.toLowerCase().includes(needle) ||
          l.description.toLowerCase().includes(needle),
      );
      if (!inHeader && !inLines) return false;
    }

    return true;
  });
}

/** Line-level search inside an expanded requisition. */
export function filterLines(lines: PurchaseRequestLine[], search: string): PurchaseRequestLine[] {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return lines;
  return lines.filter(
    (l) =>
      l.itemCode.toLowerCase().includes(needle) ||
      l.description.toLowerCase().includes(needle) ||
      l.specification.toLowerCase().includes(needle) ||
      String(l.lineNumber) === needle,
  );
}

export function categoriesOf(requests: PurchaseRequest[]): string[] {
  return Array.from(new Set(requests.map((r) => r.category))).sort();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  'Request', 'Title', 'Category', 'Super category', 'Status', 'Submitted on',
  'Submitted by', 'Employee code', 'Currency', 'Line', 'Item code', 'Description',
  'Quantity', 'UoM', 'Need by', 'Delivery location', 'Indicative price', 'Line value',
  'Sourcing state', 'Event',
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per *line*, not per requisition. A requisition-level export of a
 * 100-line PR loses the only part anyone downstream needs.
 */
export function toCsv(requests: PurchaseRequest[], lines: PurchaseRequestLine[]): string {
  const rows = [CSV_HEADERS.join(',')];

  for (const request of requests) {
    for (const line of linesFor(lines, request.id)) {
      rows.push([
        request.requestNumber, request.title, request.category, request.superCategory ?? '-',
        PR_STATUS_PRESENTATION[request.status].label, request.submittedOn,
        request.submittedByName, request.submittedByCode, request.currency,
        line.lineNumber, line.itemCode, line.description, line.quantity, line.uom,
        line.needBy, line.deliveryLocation, line.indicativePrice ?? '', lineValue(line),
        SOURCING_STATE_PRESENTATION[line.sourcingState].label, line.eventNumber ?? '',
      ].map(csvCell).join(','));
    }
  }

  return rows.join('\n');
}
