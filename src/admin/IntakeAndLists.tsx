/**
 * Pack 03 — Intake / PR workbench, and the RFX / E-Auction shortcut lists.
 *
 * The workbench works at requisition *line* level, not header level: a buyer
 * consolidates lines from many requisitions into one event, which is why the
 * layout is three zones rather than a single table of PRs.
 *
 * The list views are filtered projections of one object — an "RFQ list" is
 * events whose current stage is RFQ, not a separate RFQ table.
 */
import React from 'react';
import { BASE_CURRENCY, color, money, radius } from '../design-system/tokens';
import { Button, Chip, Pill, Segmented, TextInput } from '../design-system/components/primitives';
import { Card, Empty, KpiRow, Table, type Column, type Kpi } from '../design-system/components/layout';
import { AgentCard, ValidationBanner } from '../design-system/components/domain';
import { EVENT_STATUS_PRESENTATION } from '../domain/statusMachine';
import { JOURNEY_PATTERNS, STAGE_LABELS } from '../domain/journeyPatterns';
import { formatCountdown, serverNow } from '../server/clock';
import { biddersForEvent, responsesForEvent, useStore } from '../store/store';
import type { SourcingEvent, Stage } from '../domain/types';
import type { Route } from './AdminShell';

// ---------------------------------------------------------------------------
// Intake / PR workbench
// ---------------------------------------------------------------------------

interface PrLine {
  id: string;
  prNumber: string;
  requester: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  needBy: string;
  category: string;
  indicativePrice: number | null;
  /** Some requisitioners already hold a supplier quote — JP-07 depends on this. */
  hasVendorQuote: boolean;
}

const PR_LINES: PrLine[] = [
  { id: 'prl-1', prNumber: 'PR-2024-0131', requester: 'Facilities', lineNumber: 1, itemCode: 'PPR-A4-80', description: 'A4 copier paper, 80gsm', quantity: 4_000, uom: 'ream', needBy: '2026-10-01', category: 'Indirect', indicativePrice: 8.90, hasVendorQuote: false },
  { id: 'prl-2', prNumber: 'PR-2024-0134', requester: 'Marketing', lineNumber: 1, itemCode: 'PPR-A4-80', description: 'A4 copier paper, 80gsm', quantity: 2_200, uom: 'ream', needBy: '2026-09-20', category: 'Indirect', indicativePrice: 9.10, hasVendorQuote: false },
  { id: 'prl-3', prNumber: 'PR-2024-0134', requester: 'Marketing', lineNumber: 2, itemCode: 'MKR-ASST', description: 'Whiteboard marker, assorted', quantity: 180, uom: 'box', needBy: '2026-09-20', category: 'Indirect', indicativePrice: 9.40, hasVendorQuote: false },
  { id: 'prl-4', prNumber: 'PR-2024-0138', requester: 'IT', lineNumber: 1, itemCode: 'LAP-14-I7', description: 'Laptop, 14in, i7, 32GB', quantity: 40, uom: 'each', needBy: '2026-11-15', category: 'IT', indicativePrice: 1_480, hasVendorQuote: true },
  { id: 'prl-5', prNumber: 'PR-2024-0140', requester: 'Operations', lineNumber: 1, itemCode: 'FLD-LEV-A4', description: 'Lever arch file, A4', quantity: 900, uom: 'each', needBy: '2026-10-10', category: 'Indirect', indicativePrice: 4.05, hasVendorQuote: false },
  { id: 'prl-6', prNumber: 'PR-2024-0142', requester: 'Fleet', lineNumber: 1, itemCode: 'TYR-205-55', description: 'Tyre 205/55 R16', quantity: 64, uom: 'each', needBy: '2026-09-30', category: 'Fleet', indicativePrice: 96, hasVendorQuote: false },
];

export function IntakeWorkbench({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [search, setSearch] = React.useState('');

  let lines = PR_LINES;
  if (categoryFilter !== 'all') lines = lines.filter((l) => l.category === categoryFilter);
  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    lines = lines.filter(
      (l) => l.description.toLowerCase().includes(needle) || l.prNumber.toLowerCase().includes(needle),
    );
  }

  const selectedLines = PR_LINES.filter((l) => selected.includes(l.id));
  const selectedValue = selectedLines.reduce((a, l) => a + (l.indicativePrice ?? 0) * l.quantity, 0);
  const categories = [...new Set(selectedLines.map((l) => l.category))];
  const mixedCategories = categories.length > 1;
  const anyQuoted = selectedLines.some((l) => l.hasVendorQuote);

  // Consolidation opportunity: the same item code across separate requisitions.
  const duplicateCodes = [...new Set(
    PR_LINES.map((l) => l.itemCode).filter(
      (code, i, all) => all.indexOf(code) !== i,
    ),
  )];

  const kpis: Kpi[] = [
    { icon: '▤', value: String(PR_LINES.length), label: 'Unsourced lines', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary },
    { icon: '₹', value: money(PR_LINES.reduce((a, l) => a + (l.indicativePrice ?? 0) * l.quantity, 0), BASE_CURRENCY, { compact: true }), label: 'Value awaiting sourcing', iconBg: color.infoSoft, iconFg: color.infoText },
    { icon: '⧉', value: String(duplicateCodes.length), label: 'Consolidation opportunities', iconBg: color.accentPurpleSoft, iconFg: color.accentPurpleText },
    { icon: '◔', value: String(PR_LINES.filter((l) => l.hasVendorQuote).length), label: 'Lines with a vendor quote', iconBg: color.warningSoft, iconFg: color.warningText },
  ];

  const columns: Column<PrLine>[] = [
    {
      key: 'select', header: '', width: '40px',
      render: (line) => (
        <input
          type="checkbox"
          checked={selected.includes(line.id)}
          onChange={(e) =>
            setSelected((s) => (e.target.checked ? [...s, line.id] : s.filter((x) => x !== line.id)))
          }
          style={{ width: 14, height: 14, accentColor: color.brandPrimary }}
          aria-label={`Select ${line.description}`}
        />
      ),
    },
    {
      key: 'pr', header: 'Requisition line', width: '190px',
      render: (line) => (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: color.brandPrimary }}>
            {line.prNumber} · line {line.lineNumber}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 1 }}>{line.requester}</div>
        </div>
      ),
    },
    {
      key: 'item', header: 'Item',
      render: (line) => (
        <div>
          <div style={{ fontSize: 12.5 }}>{line.description}</div>
          <div style={{ fontSize: 10.5, color: color.textSecondary }}>{line.itemCode}</div>
        </div>
      ),
    },
    { key: 'qty', header: 'Qty', numeric: true, render: (line) => `${line.quantity.toLocaleString()} ${line.uom}` },
    { key: 'need', header: 'Need by', render: (line) => <span style={{ fontSize: 11.5 }}>{line.needBy}</span> },
    { key: 'category', header: 'Category', render: (line) => <Chip tone="neutral">{line.category}</Chip> },
    {
      key: 'price', header: 'Indicative', numeric: true,
      render: (line) =>
        line.indicativePrice === null ? (
          <span style={{ color: color.textMuted }}>—</span>
        ) : (
          <span>
            {money(line.indicativePrice)}
            {line.hasVendorQuote && (
              <Chip tone="gold" icon="◔" title="Requisitioner already holds a supplier quote">quoted</Chip>
            )}
          </span>
        ),
    },
    {
      key: 'extended', header: 'Extended', numeric: true,
      render: (line) => <strong>{money((line.indicativePrice ?? 0) * line.quantity)}</strong>,
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <KpiRow kpis={kpis} />

      {duplicateCodes.length > 0 && (
        <ValidationBanner tone="info" title="The same item appears on more than one requisition">
          {duplicateCodes.join(', ')} appear across separate requisitions. Consolidating them into one
          event gives more volume leverage than sourcing each separately.
        </ValidationBanner>
      )}

      <div className="rfx-side">
        <Card
          padded={false}
          title="Unsourced requisition lines"
          hint="Selection works at line level — that is what lets you consolidate across requisitions."
          action={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search lines…"
                style={{ width: 170 }}
              />
              <Segmented
                size="small"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'Indirect', label: 'Indirect' },
                  { value: 'IT', label: 'IT' },
                  { value: 'Fleet', label: 'Fleet' },
                ]}
              />
            </div>
          }
        >
          <Table
            columns={columns}
            rows={lines}
            rowKey={(line) => line.id}
            rowStyle={(line) => (selected.includes(line.id) ? { background: color.brandPrimarySoft } : undefined)}
            empty={<Empty icon="⌕" title="No lines match" hint="Clear the search or widen the category filter." />}
          />
        </Card>

        <div className="rfx-stack" style={{ gap: 12 }}>
          <Card title="Build an event" hint={`${selected.length} line(s) selected`}>
            {selected.length === 0 ? (
              <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
                Select requisition lines on the left. You can mix lines from different requisitions —
                that is the point of working at line level.
              </div>
            ) : (
              <div className="rfx-stack" style={{ gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: color.textSecondary }}>Consolidated value</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {money(selectedValue)}
                  </div>
                </div>
                <div className="rfx-stack" style={{ gap: 5 }}>
                  {selectedLines.map((line) => (
                    <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.description}
                      </span>
                      <span style={{ flexShrink: 0, color: color.textSecondary }}>
                        {line.quantity.toLocaleString()} {line.uom}
                      </span>
                    </div>
                  ))}
                </div>

                {mixedCategories && (
                  <ValidationBanner tone="warning" title="Mixed categories">
                    {categories.join(' and ')} in one event means one supplier field and one approval
                    route for both. Usually better as separate events.
                  </ValidationBanner>
                )}

                {anyQuoted && (
                  <ValidationBanner tone="info" title="A selected line already has a vendor quote">
                    Pattern JP-07 (PR with vendor quote) skips solicitation entirely and goes straight to
                    award. Consider it if the quote is current and competitive.
                  </ValidationBanner>
                )}

                <Button variant="primary" onClick={() => onNavigate({ name: 'create' })}>
                  Create event from {selected.length} line(s) →
                </Button>
                <Button variant="tertiary" onClick={() => setSelected([])}>Clear selection</Button>
              </div>
            )}
          </Card>

          <AgentCard
            code="AG-01"
            name="Intake & Event Setup"
            autonomy="DRAFT"
            confidence={0.86}
            summary={
              duplicateCodes.length > 0
                ? `Three paper lines across PR-0131 and PR-0134 total 6,200 reams. Consolidating them and running a Simple RFQ matches the six comparable events in this category, which averaged 4.1% saving.`
                : 'No consolidation opportunity in the current selection.'
            }
            evidence={[
              { label: 'PR-2024-0131 line 1', detail: '4,000 reams at an indicative ₹8.90' },
              { label: 'PR-2024-0134 line 1', detail: '2,200 reams at an indicative ₹9.10' },
              { label: '6 prior events', detail: 'Indirect / paper, average 4.1% saving' },
            ]}
            onAccept={() => setSelected(['prl-1', 'prl-2'])}
            onReject={() => undefined}
          />

          <AgentCard
            code="AG-02"
            name="Supplier Discovery & Shortlist"
            autonomy="SUGGEST"
            confidence={0.74}
            summary="Four qualified suppliers serve this category and location. Two more are qualified but have not delivered in 18 months — including them widens the field without much risk."
            evidence={[
              { label: 'Vendor master', detail: '6 qualified in Indirect / Dubai' },
              { label: 'Performance history', detail: '4 with delivery in the last 18 months' },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage-filtered list views
// ---------------------------------------------------------------------------

export function StageList({
  stage, onNavigate,
}: { stage: 'RFI' | 'RFP' | 'RFQ' | 'AUCTION'; onNavigate: (route: Route) => void }) {
  const { state } = useStore();
  const [tab, setTab] = React.useState('All');

  const titles: Record<typeof stage, { title: string; hint: string }> = {
    RFI: { title: 'Requests for Information', hint: 'Events currently at the RFI stage. An RFI is a stage of a sourcing event, not a separate object.' },
    RFP: { title: 'Requests for Proposal', hint: 'Events currently at the RFP stage.' },
    RFQ: { title: 'Requests for Quotation', hint: 'Events currently at the RFQ stage.' },
    AUCTION: { title: 'E-Auctions', hint: 'Events currently at the auction stage, scheduled, live or closed.' },
  };

  const tabsFor: Record<typeof stage, string[]> = {
    RFI: ['All', 'Active', 'Completed', 'Draft'],
    RFP: ['All', 'Active', 'Evaluation', 'Completed', 'Draft'],
    RFQ: ['All', 'Active', 'Evaluation', 'Negotiation', 'Completed', 'Draft'],
    AUCTION: ['All', 'Scheduled', 'Live', 'Closed', 'Draft'],
  };

  const stageKey: Stage = stage === 'AUCTION' ? 'AUCTION' : stage;

  /**
   * One object, filtered — never a second table. The base view is events
   * standing at this stage; the Draft tab is the exception, because a draft has
   * not reached any stage yet and is found by the stage being *planned*.
   */
  const events = React.useMemo(() => {
    if (tab === 'Draft') {
      return state.events.filter(
        (event) => event.status === 'DRAFT' && event.stagesEnabled.includes(stageKey),
      );
    }

    const atStage = state.events.filter((event) => event.currentStage === stageKey);

    switch (tab) {
      case 'Live': return atStage.filter((e) => e.status === 'AUCTION_LIVE');
      case 'Scheduled': return atStage.filter((e) => e.status === 'AUCTION_SCHEDULED');
      case 'Closed': return atStage.filter((e) => e.status === 'AUCTION_CLOSED');
      case 'Active': return atStage.filter((e) => e.status === 'OPEN' || e.status === 'PUBLISHED');
      case 'Evaluation': return atStage.filter((e) => e.status === 'UNDER_EVALUATION');
      case 'Negotiation': return atStage.filter((e) => e.status === 'IN_NEGOTIATION');
      case 'Completed': return atStage.filter((e) => e.status === 'AWARDED' || e.status === 'CLOSED');
      default: return atStage;
    }
  }, [state.events, stageKey, tab]);

  const columns: Column<SourcingEvent>[] = [
    {
      key: 'number', header: 'Event', width: '250px',
      render: (event) => {
        // An ask says which sourcing event raised it. Without that the section
        // reads as a flat list of unrelated tenders.
        const parent = event.parentEventId === null
          ? null
          : state.events.find((e) => e.id === event.parentEventId);
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: color.brandPrimary }}>
                {event.eventNumber}
              </span>
              {event.status === 'DRAFT' && parent && (
                <Chip tone="neutral" title="Prepared and scheduled; it goes out when the ask before it closes.">
                  planned
                </Chip>
              )}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>{event.title}</div>
            {parent && (
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                under {parent.eventNumber}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'pattern', header: 'Pattern',
      render: (event) => (
        <span style={{ fontSize: 11.5, color: color.textSecondary }}>
          {JOURNEY_PATTERNS[event.journeyPattern]?.name}
        </span>
      ),
    },
    { key: 'stage', header: 'Stage', render: (event) => STAGE_LABELS[event.currentStage] },
    {
      key: 'status', header: 'Status',
      render: (event) => (
        <Pill
          presentation={EVENT_STATUS_PRESENTATION[event.status]}
          size="small"
          live={event.status === 'AUCTION_LIVE'}
        />
      ),
    },
    {
      key: 'value', header: 'Value', numeric: true,
      render: (event) => money(event.estimatedValue, event.currency, { compact: true }),
    },
    {
      key: 'bidders', header: 'Bidders', numeric: true,
      render: (event) => {
        const bidders = biddersForEvent(state, event.id);
        return bidders.length === 0 ? <span style={{ color: color.textMuted }}>—</span> : String(bidders.length);
      },
    },
    {
      /**
       * What has actually come back.
       *
       * The invited count says who was asked; on its own it left a buyer with
       * no way to tell from this section whether anybody had answered, which
       * is the one thing they open an RFI list to find out. An auction is
       * bid in the room rather than answered on a form, so it is spared the
       * column.
       */
      key: 'responses', header: 'Responses', numeric: true,
      render: (event) => {
        const invited = biddersForEvent(state, event.id).length;
        if (stage === 'AUCTION' || invited === 0) {
          return <span style={{ color: color.textMuted }}>—</span>;
        }
        const back = responsesForEvent(state, event.id)
          .filter((response) => response.submittedAt !== null).length;
        return (
          <span
            style={{
              fontSize: 12, fontVariantNumeric: 'tabular-nums',
              color: back === 0 ? color.textMuted : color.successText, fontWeight: back === 0 ? 400 : 600,
            }}
            title={`${back} of ${invited} invited supplier(s) have submitted`}
          >
            {back} / {invited}
          </span>
        );
      },
    },
    {
      key: 'closes', header: 'Closes',
      render: (event) => {
        if (event.closesAt === null) return <span style={{ fontSize: 11.5, color: color.textMuted }}>—</span>;
        const remaining = event.closesAt - serverNow();
        return (
          <span
            style={{
              fontSize: 12, fontVariantNumeric: 'tabular-nums',
              color: remaining < 0 ? color.dangerText : remaining < 3_600_000 ? color.warningText : color.textPrimary,
            }}
          >
            {remaining < 0 ? 'closed' : formatCountdown(remaining)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner tone="info" title="This is a filtered view of one object">
        {titles[stage].hint} Opening any row lands on the same event workspace — there is no separate
        RFI, RFP or RFQ record to keep in step.
      </ValidationBanner>

      <Card
        padded={false}
        title={titles[stage].title}
        hint={`${events.length} result(s)`}
        action={
          <Segmented
            size="small"
            value={tab}
            onChange={setTab}
            options={tabsFor[stage].map((t) => ({ value: t, label: t }))}
          />
        }
      >
        <Table
          columns={columns}
          rows={events}
          rowKey={(event) => event.id}
          onRowClick={(event) => onNavigate({ name: 'event', eventId: event.id })}
          rowStyle={(event) => (event.status === 'AUCTION_LIVE' ? { background: '#FFF7F7' } : undefined)}
          empty={
            <Empty
              icon={stage === 'AUCTION' ? '◈' : '▤'}
              title={`No ${stage === 'AUCTION' ? 'auctions' : `${stage}s`} match this view`}
              hint="Change the filter, or create an event whose pattern includes this stage."
              action={<Button variant="primary" onClick={() => onNavigate({ name: 'create' })}>Create Event</Button>}
            />
          }
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval inbox
// ---------------------------------------------------------------------------

export function ApprovalInbox({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state } = useStore();
  const pending = state.events.filter(
    (e) => e.status === 'PENDING_AWARD_APPROVAL' || e.status === 'PENDING_APPROVAL',
  );

  return (
    <div className="rfx-stack" style={{ gap: 14, maxWidth: 900 }}>
      <ValidationBanner tone="info" title="Bulk approve is deliberately not offered for award NFAs">
        Each award decision is taken on its own facts. Approving a batch without reading them is the
        failure mode this inbox is designed to prevent.
      </ValidationBanner>

      {pending.length === 0 ? (
        <Card>
          <Empty icon="✓" title="Nothing awaiting your approval" hint="Approval requests raised against your DoA levels appear here." />
        </Card>
      ) : (
        <div className="rfx-stack" style={{ gap: 10 }}>
          {pending.map((event) => {
            const nfa = state.nfas.find((n) => n.eventId === event.id);
            return (
              <div
                key={event.id}
                style={{
                  background: '#fff', border: `1px solid ${color.border}`,
                  borderRadius: radius.card, padding: '15px 18px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 11, color: color.textSecondary }}>
                      {event.eventNumber} · {event.category}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>
                      Award {money(event.estimatedValue, event.currency)} — {event.title}
                    </div>
                    <div style={{ display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
                      <Chip tone="neutral">
                        {nfa ? `${nfa.steps.length} approval levels` : 'chain not yet resolved'}
                      </Chip>
                      {nfa && nfa.deviations.length > 0 && (
                        <Chip tone="gold" icon="⚑">{nfa.deviations.length} deviation(s)</Chip>
                      )}
                      {nfa?.doaUpliftApplied && <Chip tone="danger" icon="↑">rank override uplift</Chip>}
                    </div>
                  </div>
                  <Pill presentation={EVENT_STATUS_PRESENTATION[event.status]} />
                  <Button
                    variant="primary"
                    onClick={() => onNavigate({ name: 'event', eventId: event.id, tab: 'Approvals' })}
                  >
                    Review
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
