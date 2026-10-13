/**
 * Purchase Request list.
 *
 * The screen exists for one job: find the demand that still needs sourcing, and
 * see what is actually in it. So the row is a header and the expansion is the
 * **lines**, because a requisition's identity to a buyer is its items — a
 * 100-line MRO replenishment and a 1-line server swap are the same row until
 * you open them.
 *
 * Three things the layout is built around:
 *
 * - **The amount is derived, never stored.** Row and expansion read the same
 *   line array through `requestAmount`, so they cannot disagree.
 * - **A 100-line expansion scrolls inside itself.** Pushing the page to 4,000px
 *   because one row is open makes the list unusable; the panel is capped and
 *   carries its own line search, because at 100 lines scanning is not viable.
 * - **Sourcing state is per line, not per header.** A requisition is routinely
 *   part-sourced — the header status is a projection of the lines, and the
 *   expansion shows which specific lines are still available.
 */
import React from 'react';
import { BASE_CURRENCY, color, money, radius } from '../design-system/tokens';
import {
  Button, Checkbox, Chip, Pill, Select, TextInput,
} from '../design-system/components/primitives';
import { Card, Empty, KpiRow, Table, Tabs, type Column, type Kpi } from '../design-system/components/layout';
import { Modal, ValidationBanner } from '../design-system/components/domain';
import {
  PR_STATUS_PRESENTATION, PR_TAB_LABELS, SOURCING_STATE_PRESENTATION, categoriesOf,
  derivedStatus, filterLines, filterRequests, lineValue, linesFor, requestAmount,
  sourceableLines, sourcingRollup, toCsv, type PrFilter, type PrTab,
} from '../domain/purchaseRequests';
import {
  basketValue, buildSourcingRequisition, canSelect, categoriesRanked,
  requestNumbersIn, validateBasket,
} from '../domain/sourcingRequisition';
import { serverNow } from '../server/clock';
import { useStore } from '../store/store';
import type { PurchaseRequest, PurchaseRequestLine } from '../domain/types';
import type { Route } from './AdminShell';

const TABS: PrTab[] = ['requested', 'pending', 'history', 'all'];

export function PurchaseRequests({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state, dispatch } = useStore();
  const allRequests = state.purchaseRequests;
  const allLines = state.purchaseRequestLines;

  const [filter, setFilter] = React.useState<PrFilter>({
    tab: 'pending', search: '', category: 'all', status: 'all', sourceableOnly: false,
  });
  const [expanded, setExpanded] = React.useState<string[]>([]);

  const patch = (next: Partial<PrFilter>) => setFilter((f) => ({ ...f, ...next }));

  const requests = filterRequests(
    allRequests, allLines, filter, state.currentUser.id,
  );

  const toggle = (id: string) =>
    setExpanded((open) => (open.includes(id) ? open.filter((x) => x !== id) : [...open, id]));

  // Counts come from the unfiltered set: a tab label that changed with the
  // search box would be lying about what is behind the tab.
  const tabCount = (tab: PrTab) =>
    filterRequests(
      allRequests, allLines,
      { tab, search: '', category: 'all', status: 'all', sourceableOnly: false },
      state.currentUser.id,
    ).length;

  const shownLines = requests.flatMap((r) => linesFor(allLines, r.id));
  const shownSourceable = sourceableLines(shownLines);

  const kpis: Kpi[] = [
    {
      icon: '▤', label: 'Requisitions', value: String(requests.length),
      iconBg: color.neutralSoft, iconFg: color.textBody,
    },
    {
      icon: '≡', label: 'Lines', value: shownLines.length.toLocaleString('en-IN'),
      iconBg: color.neutralSoft, iconFg: color.textBody,
    },
    {
      icon: '○', label: 'Unsourced lines', value: shownSourceable.length.toLocaleString('en-IN'),
      iconBg: color.warningSoft, iconFg: color.warningText,
      title: 'Lines still available to feed a new sourcing event',
    },
    {
      icon: '◆', label: 'Unsourced value',
      value: money(requestAmount(shownSourceable), BASE_CURRENCY, { compact: true }),
      iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary,
      title: 'Spend still addressable by sourcing',
    },
  ];

  /**
   * Sourcing straight from one requisition takes the same path as the basket:
   * a consolidated demand is raised first, so the event's source reference is a
   * PRD in both cases and there is only one way an event learns its lines.
   */
  const sourceRequest = (request: PurchaseRequest) => {
    const lines = sourceableLines(linesFor(allLines, request.id));
    if (lines.length === 0) return;
    const requisition = buildSourcingRequisition({
      lines, requests: allRequests, existing: state.sourcingRequisitions,
      userId: state.currentUser.id, now: serverNow(),
    });
    dispatch({ type: 'CREATE_SOURCING_REQUISITION', requisition });
    onNavigate({ name: 'create', prdId: requisition.id });
  };

  const downloadCsv = () => {
    const csv = toCsv(requests, allLines);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `purchase-requests-${filter.tab}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<PurchaseRequest>[] = [
    {
      key: 'details', header: 'Details', width: '300px',
      render: (row) => {
        const own = linesFor(allLines, row.id);
        const open = expanded.includes(row.id);
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
            aria-expanded={open}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
              border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
            }}
          >
            <span
              aria-hidden
              style={{
                fontSize: 9, color: color.textMuted, marginTop: 4, flexShrink: 0,
                transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
              }}
            >
              ▶
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block', fontSize: 12.5, fontWeight: 600,
                  color: color.brandPrimary, textDecoration: 'underline',
                }}
              >
                {row.requestNumber}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                {row.title}
              </span>
              <span style={{ display: 'block', fontSize: 11, color: color.textMuted, marginTop: 3 }}>
                {own.length} {own.length === 1 ? 'item' : 'items'} · {row.businessUnit}
              </span>
            </span>
          </button>
        );
      },
    },
    {
      key: 'category', header: 'Category', width: '150px',
      render: (row) => <span style={{ fontSize: 12 }}>{row.category}</span>,
    },
    {
      key: 'super', header: 'Super Category', width: '130px',
      render: (row) =>
        row.superCategory
          ? <span style={{ fontSize: 12 }}>{row.superCategory}</span>
          : <span style={{ color: color.textMuted }}>–</span>,
    },
    {
      key: 'status', header: 'Status', width: '160px',
      render: (row) => {
        const own = linesFor(allLines, row.id);
        const effective = derivedStatus(row, own);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Pill presentation={PR_STATUS_PRESENTATION[effective]} size="small" />
            {effective !== row.status && (
              <span
                title={`Stored as ${PR_STATUS_PRESENTATION[row.status].label}; shown from where the lines actually are.`}
                style={{ fontSize: 10, color: color.textMuted }}
              >
                ⓘ
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'submitted', header: 'Submitted On', width: '120px',
      render: (row) => <span style={{ fontSize: 12 }}>{formatDate(row.submittedOn)}</span>,
    },
    {
      key: 'by', header: 'Submitted By', width: '170px',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: color.neutralSoft, color: color.textBody,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10.5, fontWeight: 700,
            }}
          >
            {initialsOf(row.submittedByName)}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 12 }}>{row.submittedByName}</span>
            <span style={{ display: 'block', fontSize: 10.5, color: color.textMuted }}>
              {row.submittedByCode}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'amount', header: 'Amount', numeric: true, width: '120px',
      render: (row) => (
        <span style={{ fontSize: 12 }}>
          {money(requestAmount(linesFor(allLines, row.id)), row.currency)}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Actions', width: '110px',
      render: (row) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="secondary"
            size="small"
            onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
          >
            {expanded.includes(row.id) ? 'Close' : 'View'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Tabs
        tabs={TABS.map((tab) => PR_TAB_LABELS[tab])}
        active={PR_TAB_LABELS[filter.tab]}
        counts={Object.fromEntries(TABS.map((tab) => [PR_TAB_LABELS[tab], tabCount(tab)]))}
        onChange={(label) => {
          const tab = TABS.find((t) => PR_TAB_LABELS[t] === label);
          if (tab) patch({ tab });
        }}
      />

      {filter.tab === 'requested' ? (
        <ConsolidatedBasket onNavigate={onNavigate} />
      ) : (
      <>
      <KpiRow kpis={kpis} />

      <Card padded={false}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', borderBottom: `1px solid ${color.border}`,
          }}
        >
          <div style={{ width: 260 }}>
            <TextInput
              value={filter.search}
              placeholder="Search requisitions and items…"
              onChange={(e) => patch({ search: e.target.value })}
            />
          </div>
          <div style={{ width: 190 }}>
            <Select value={filter.category} onChange={(e) => patch({ category: e.target.value })}>
              <option value="all">All categories</option>
              {categoriesOf(allRequests).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <Checkbox
            checked={filter.sourceableOnly}
            label="Only with unsourced lines"
            onChange={(next) => patch({ sourceableOnly: next })}
          />
          <span style={{ flex: 1 }} />
          <Button
            variant="tertiary"
            size="small"
            onClick={() => setExpanded(expanded.length > 0 ? [] : requests.map((r) => r.id))}
          >
            {expanded.length > 0 ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button variant="secondary" size="small" onClick={downloadCsv}>
            ↓ Download CSV
          </Button>
        </div>

        <Table
          columns={columns}
          rows={requests}
          rowKey={(row) => row.id}
          isExpanded={(row) => expanded.includes(row.id)}
          renderExpanded={(row) => (
            <RequestLines
              request={row}
              lines={linesFor(allLines, row.id)}
              onSource={() => sourceRequest(row)}
            />
          )}
          empty={
            <Empty
              icon="▤"
              title="No requisitions match"
              hint="Clear the search, or widen the category and tab filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => patch({ search: '', category: 'all', sourceableOnly: false })}
                >
                  Clear filters
                </Button>
              }
            />
          }
        />
      </Card>
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The consolidated basket — every requisition line, in one list
// ---------------------------------------------------------------------------

/**
 * A requisition-header list answers "what has been asked for". It does not
 * answer "what can I put in one event", because the answer to that spans
 * requisitions: forty laptop lines sitting across six PRs are one negotiation,
 * not six. So this view flattens to the line and lets a buyer pick across
 * headers.
 *
 * The one constraint the picker enforces is **category**. Category drives the
 * questionnaire, the bidder shortlist, the evaluation model and the DoA chain,
 * so a mixed basket would have to pick one and mis-apply it to the rest.
 * Selecting the first line therefore locks the category, and lines outside it
 * are disabled with the reason rather than hidden.
 */
const PAGE_SIZE = 50;

function ConsolidatedBasket({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state, dispatch } = useStore();
  const requests = state.purchaseRequests;

  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('all');
  const [sourceableOnly, setSourceableOnly] = React.useState(true);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(0);

  const byRequestId = new Map(requests.map((r) => [r.id, r]));

  let rows = state.purchaseRequestLines;
  if (sourceableOnly) rows = rows.filter((l) => l.sourcingState === 'UNSOURCED');
  if (mineOnly) {
    rows = rows.filter((l) => byRequestId.get(l.requestId)?.submittedById === state.currentUser.id);
  }
  if (category !== 'all') {
    rows = rows.filter((l) => byRequestId.get(l.requestId)?.category === category);
  }
  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    rows = rows.filter((l) => {
      const request = byRequestId.get(l.requestId);
      return (
        l.itemCode.toLowerCase().includes(needle) ||
        l.description.toLowerCase().includes(needle) ||
        (request?.requestNumber.toLowerCase().includes(needle) ?? false)
      );
    });
  }

  const selected = state.purchaseRequestLines.filter((l) => selectedIds.includes(l.id));
  // Ranked, because the first is the category the event is actually raised
  // under when the basket spans several.
  const basketCategories = categoriesRanked(selected, requests);
  const mixedCategory = basketCategories.length > 1;
  const validation = validateBasket(selected, requests);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  /** Held while the buyer confirms a cross-category basket. */
  const [confirmMixed, setConfirmMixed] = React.useState(false);

  const toggle = (line: PurchaseRequestLine) =>
    setSelectedIds((ids) =>
      ids.includes(line.id) ? ids.filter((x) => x !== line.id) : [...ids, line.id],
    );

  /** Select every line on this page that the category lock still permits. */
  const selectPage = () => {
    const additions: string[] = [];
    const running = [...selected];
    for (const line of shown) {
      if (selectedIds.includes(line.id)) continue;
      if (!canSelect(line, running, requests).allowed) continue;
      additions.push(line.id);
      running.push(line);
    }
    setSelectedIds((ids) => [...ids, ...additions]);
  };

  const initiateSourcing = () => {
    if (!validation.valid) return;
    // Crossing a category is allowed, but never silently: the buyer confirms
    // the consequence before a PRD number is burned on it.
    if (mixedCategory && !confirmMixed) {
      setConfirmMixed(true);
      return;
    }
    const requisition = buildSourcingRequisition({
      lines: selected, requests, existing: state.sourcingRequisitions,
      userId: state.currentUser.id, now: serverNow(),
    });
    dispatch({ type: 'CREATE_SOURCING_REQUISITION', requisition });
    setSelectedIds([]);
    setConfirmMixed(false);
    onNavigate({ name: 'create', prdId: requisition.id });
  };

  const columns: Column<PurchaseRequestLine>[] = [
    {
      key: 'select', header: '', width: '40px',
      render: (line) => {
        const { allowed, reason, warning } = canSelect(line, selected, requests);
        const isSelected = selectedIds.includes(line.id);
        return (
          <span title={isSelected ? undefined : reason ?? warning ?? undefined}>
            <Checkbox
              checked={isSelected}
              disabled={!allowed && !isSelected}
              label=""
              onChange={() => toggle(line)}
            />
          </span>
        );
      },
    },
    {
      key: 'name', header: 'Name',
      render: (line) => {
        const request = byRequestId.get(line.requestId);
        return (
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong style={{ fontSize: 12 }}>{line.description}</strong>
              {line.hasVendorQuote && <Chip tone="info" title="The requisitioner already holds a supplier quote">quoted</Chip>}
            </span>
            <span style={{ display: 'block', fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
              {line.itemCode} · line {line.lineNumber} of {request?.requestNumber}
            </span>
          </span>
        );
      },
    },
    {
      key: 'pr', header: 'PR Number', width: '160px',
      render: (line) => {
        const request = byRequestId.get(line.requestId);
        return (
          <span>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: color.brandPrimary }}>
              {request?.requestNumber}
            </span>
            <span style={{ display: 'block', fontSize: 10.5, color: color.textMuted }}>
              {request?.submittedByName}
            </span>
          </span>
        );
      },
    },
    {
      key: 'category', header: 'Category', width: '160px',
      render: (line) => {
        const own = byRequestId.get(line.requestId)?.category;
        const lead = basketCategories[0];
        // Once a basket exists, a line from another category is still
        // selectable — it is marked because picking it changes what the event
        // becomes, not because it is out of bounds.
        const crosses = lead !== undefined && own !== undefined && own !== lead;
        return (
          <span
            style={{ fontSize: 12, color: crosses ? color.warningText : color.textPrimary }}
            title={crosses ? `Outside ${lead} — adding this makes the event cross-category` : undefined}
          >
            {own}
          </span>
        );
      },
    },
    {
      key: 'office', header: 'Office', width: '160px',
      render: (line) => <span style={{ fontSize: 11.5 }}>{line.deliveryLocation}</span>,
    },
    {
      key: 'qty', header: 'Quantity', numeric: true, width: '110px',
      render: (line) => (
        <span>
          {line.quantity.toLocaleString('en-IN')}
          <span style={{ color: color.textMuted, fontSize: 10.5 }}> {line.uom}</span>
        </span>
      ),
    },
    {
      key: 'value', header: 'Line value', numeric: true, width: '110px',
      render: (line) => <span>{money(lineValue(line), line.currency)}</span>,
    },
    {
      key: 'state', header: 'Sourcing', width: '140px',
      render: (line) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Pill presentation={SOURCING_STATE_PRESENTATION[line.sourcingState]} size="small" />
          {line.eventNumber && (
            <span style={{ fontSize: 10.5, color: color.textMuted }}>{line.eventNumber}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <ValidationBanner tone="info" title="Every requisition line, across every requisition">
        A header list answers what has been asked for; it cannot answer what belongs in one event,
        because that spans requisitions. Select lines here — from as many requisitions as you like —
        and the system consolidates them into one demand with its own PRD number.
      </ValidationBanner>

      <Card padded={false}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', borderBottom: `1px solid ${color.border}`,
          }}
        >
          <div style={{ width: 250 }}>
            <TextInput
              value={search}
              placeholder="Search items and PR numbers…"
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <div style={{ width: 200 }}>
            <Select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(0); }}
            >
              <option value="all">All categories</option>
              {categoriesOf(requests).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <Checkbox checked={sourceableOnly} label="Unsourced only" onChange={(v) => { setSourceableOnly(v); setPage(0); }} />
          <Checkbox checked={mineOnly} label="My requests only" onChange={(v) => { setMineOnly(v); setPage(0); }} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: color.textSecondary }}>
            Items: {rows.length.toLocaleString('en-IN')}
          </span>
          <Button variant="tertiary" size="small" onClick={selectPage}>
            Select page
          </Button>
        </div>

        <Table
          dense
          columns={columns}
          rows={shown}
          rowKey={(line) => line.id}
          rowStyle={(line) => {
            if (selectedIds.includes(line.id)) return { background: color.brandPrimarySoft };
            return canSelect(line, selected, requests).allowed ? undefined : { opacity: 0.45 };
          }}
          empty={
            <Empty
              icon="▤"
              title="No items match"
              hint="Widen the category filter, or clear the search."
            />
          }
        />

        {pageCount > 1 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              padding: '10px 14px', borderTop: `1px solid ${color.border}`,
            }}
          >
            <Button variant="tertiary" size="small" disabled={current === 0} onClick={() => setPage(current - 1)}>
              ‹ Previous
            </Button>
            <span style={{ fontSize: 12, color: color.textSecondary }}>
              Page {current + 1} of {pageCount}
            </span>
            <Button
              variant="tertiary" size="small"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              Next ›
            </Button>
          </div>
        )}
      </Card>

      {selected.length > 0 && (
        <Card>
          <div className="rfx-stack" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>
                {selected.length} {selected.length === 1 ? 'item' : 'items'} selected
              </strong>
              <span style={{ color: color.textMuted }}>·</span>
              {basketCategories.map((category, i) => (
                <Chip
                  key={category}
                  tone={mixedCategory ? (i === 0 ? 'gold' : 'neutral') : 'brand'}
                  title={
                    mixedCategory
                      ? i === 0
                        ? `The event will be raised under ${category}`
                        : `Sourced under ${basketCategories[0]}, not ${category}`
                      : undefined
                  }
                >
                  {category}
                </Chip>
              ))}
              <span style={{ color: color.textMuted }}>·</span>
              <span style={{ fontSize: 12 }}>
                from {requestNumbersIn(selected, requests).length} requisitions
              </span>
              <span style={{ color: color.textMuted }}>·</span>
              <span style={{ fontSize: 12 }}>
                {money(basketValue(selected), selected[0].currency)} indicative
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="tertiary" size="small" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
              <Button variant="primary" disabled={!validation.valid} onClick={initiateSourcing}>
                Initiate sourcing →
              </Button>
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {requestNumbersIn(selected, requests).map((number) => (
                <Chip key={number} tone="neutral">
                  {number} ({selected.filter((l) => byRequestId.get(l.requestId)?.requestNumber === number).length})
                </Chip>
              ))}
            </div>

            {validation.errors.map((issue) => (
              <ValidationBanner key={issue.code} tone="error" title={issue.message}>{''}</ValidationBanner>
            ))}
            {validation.warnings.map((issue) => (
              <ValidationBanner key={issue.code} tone="warning" title={issue.message}>{''}</ValidationBanner>
            ))}

            <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.55 }}>
              Initiating sourcing assigns a PRD number mapping this demand to its requisitions, and
              opens the create-event wizard with the basics and every line already populated.
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={confirmMixed}
        title="This basket spans more than one category"
        confirmLabel="Source them together"
        onClose={() => setConfirmMixed(false)}
        onConfirm={initiateSourcing}
        width={540}
      >
        <div className="rfx-stack" style={{ gap: 10, fontSize: 12.5, lineHeight: 1.6 }}>
          <div>
            You are consolidating{' '}
            <strong>
              {basketCategories.map((category) => (
                `${category} (${selected.filter((l) => byRequestId.get(l.requestId)?.category === category).length})`
              )).join(', ')}
            </strong>{' '}
            into one event.
          </div>
          <div>
            An event carries one category. This one will be raised under{' '}
            <strong>{basketCategories[0]}</strong>, which decides three things for every line in it:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>the questionnaire suppliers answer,</li>
            <li>the bidder shortlist they are drawn from,</li>
            <li>and the DoA chain that approves the award.</li>
          </ul>
          <div>
            The {basketCategories.slice(1).join(' and ')} lines will be sourced under all three
            unchanged. That is right when you are consolidating for volume and the same suppliers
            serve both. Split the basket if any of the three genuinely needs to differ.
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The expansion — every item in the requisition
// ---------------------------------------------------------------------------

/** Above this, scanning is not viable and the panel offers a line search. */
const SEARCH_THRESHOLD = 15;

function RequestLines({
  request, lines, onSource,
}: {
  request: PurchaseRequest;
  lines: PurchaseRequestLine[];
  onSource: () => void;
}) {
  const [search, setSearch] = React.useState('');
  const [sourceableOnly, setSourceableOnly] = React.useState(false);

  const rollup = sourcingRollup(lines);
  const sourceable = sourceableLines(lines);

  let shown = filterLines(lines, search);
  if (sourceableOnly) shown = shown.filter((l) => l.sourcingState === 'UNSOURCED');

  const columns: Column<PurchaseRequestLine>[] = [
    {
      key: 'line', header: '#', numeric: true, width: '48px',
      render: (line) => <span style={{ color: color.textMuted }}>{line.lineNumber}</span>,
    },
    {
      key: 'item', header: 'Item',
      render: (line) => (
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>{line.description}</strong>
            {line.isCatalogItem && <Chip tone="neutral" title="Available on an existing catalogue">catalogue</Chip>}
            {line.hasVendorQuote && <Chip tone="info" title="The requisitioner already holds a supplier quote — JP-07 depends on this">quoted</Chip>}
          </span>
          <span style={{ display: 'block', fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
            {line.itemCode} · {line.specification}
          </span>
        </span>
      ),
    },
    {
      key: 'qty', header: 'Quantity', numeric: true, width: '110px',
      render: (line) => (
        <span>
          {line.quantity.toLocaleString('en-IN')}
          <span style={{ color: color.textMuted, fontSize: 10.5 }}> {line.uom}</span>
        </span>
      ),
    },
    {
      key: 'price', header: 'Indicative', numeric: true, width: '100px',
      render: (line) =>
        line.indicativePrice === null
          ? <span style={{ color: color.textMuted }}>–</span>
          : <span>{money(line.indicativePrice, line.currency)}</span>,
    },
    {
      key: 'value', header: 'Line value', numeric: true, width: '110px',
      render: (line) => <span>{money(lineValue(line), line.currency)}</span>,
    },
    {
      key: 'needby', header: 'Need by', width: '100px',
      render: (line) => <span style={{ fontSize: 11.5 }}>{formatDate(line.needBy)}</span>,
    },
    {
      key: 'where', header: 'Deliver to', width: '160px',
      render: (line) => <span style={{ fontSize: 11.5 }}>{line.deliveryLocation}</span>,
    },
    {
      key: 'sourcing', header: 'Sourcing', width: '150px',
      render: (line) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Pill presentation={SOURCING_STATE_PRESENTATION[line.sourcingState]} size="small" />
          {line.eventNumber && (
            <span style={{ fontSize: 10.5, color: color.textMuted }}>{line.eventNumber}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: '12px 14px 14px', borderLeft: `3px solid ${color.brandPrimary}` }}>
      {/* What sourcing can actually do with this requisition. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 12.5 }}>{rollup.total} items</strong>
        <span style={{ color: color.textMuted }}>·</span>
        <span style={{ fontSize: 12 }}>{money(requestAmount(lines), request.currency)} total</span>
        <span style={{ color: color.textMuted }}>·</span>
        {rollup.unsourced > 0 && <Chip tone="gold" icon="○">{rollup.unsourced} unsourced</Chip>}
        {rollup.inEvent > 0 && <Chip tone="info" icon="●">{rollup.inEvent} in event</Chip>}
        {rollup.awarded > 0 && <Chip tone="brand" icon="✓">{rollup.awarded} awarded</Chip>}
        {rollup.onContract > 0 && <Chip tone="neutral" icon="▣">{rollup.onContract} on contract</Chip>}
        {rollup.cancelled > 0 && <Chip tone="danger" icon="✕">{rollup.cancelled} cancelled</Chip>}
        <span style={{ flex: 1 }} />
        <Button
          variant="primary"
          size="small"
          disabled={sourceable.length === 0}
          onClick={onSource}
        >
          Source {sourceable.length} unsourced {sourceable.length === 1 ? 'line' : 'lines'}
        </Button>
      </div>

      {rollup.events.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <ValidationBanner
            tone="info"
            title={`Already out in ${rollup.events.join(', ')}`}
          >
            Lines out in an event are not sourceable again — putting the same demand into a second
            event would have suppliers bidding twice for one requirement.
          </ValidationBanner>
        </div>
      )}

      {lines.length > SEARCH_THRESHOLD && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
          <div style={{ width: 240 }}>
            <TextInput
              value={search}
              placeholder={`Search ${lines.length} items…`}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Checkbox
            checked={sourceableOnly}
            label="Unsourced only"
            onChange={setSourceableOnly}
          />
          <span style={{ fontSize: 11.5, color: color.textSecondary }}>
            Showing {shown.length} of {lines.length}
          </span>
        </div>
      )}

      {/* A 100-line requisition scrolls inside its own panel rather than
          pushing every row below it off the screen. */}
      <div
        style={{
          maxHeight: 460, overflowY: 'auto',
          border: `1px solid ${color.border}`, borderRadius: radius.control,
          background: color.surface,
        }}
      >
        <Table
          dense
          columns={columns}
          rows={shown}
          rowKey={(line) => line.id}
          rowStyle={(line) =>
            line.sourcingState === 'CANCELLED'
              ? { opacity: 0.5, textDecoration: 'line-through' }
              : undefined
          }
          empty={
            <Empty
              icon="▤"
              title="No items match"
              hint="Clear the item search to see the whole requisition."
            />
          }
        />
      </div>

      <div style={{ fontSize: 11, color: color.textMuted, marginTop: 8, lineHeight: 1.55 }}>
        Requested by {request.submittedByName} ({request.submittedByCode}) · cost centre {request.costCentre} ·
        need by {formatDate(request.needBy)} · {request.deliveryLocation}
        <span style={{ display: 'block', marginTop: 3 }}>{request.justification}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(date.getUTCDate()).padStart(2, '0')}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
