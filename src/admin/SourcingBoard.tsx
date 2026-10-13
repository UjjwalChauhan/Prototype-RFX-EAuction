/**
 * Pack 02 — Sourcing Board.
 *
 * Stage and Status are visually distinct and never merged into one column:
 * an event can be at the Auction stage with status "Auction Scheduled" or
 * "Auction Live", and the board must show both.
 */
import React from 'react';
import { BASE_CURRENCY, color, money, radius } from '../design-system/tokens';
import { Button, Chip, Pill, Segmented, TextInput } from '../design-system/components/primitives';
import { Card, Empty, KpiRow, Table, type Column, type Kpi } from '../design-system/components/layout';
import { EVENT_STATUS_PRESENTATION } from '../domain/statusMachine';
import { STAGE_LABELS } from '../domain/journeyPatterns';
import { JOURNEY_PATTERNS } from '../domain/journeyPatterns';
import { formatCountdown, serverNow } from '../server/clock';
import { useStore, biddersForEvent, stageEventsOf } from '../store/store';
import { isStageEvent } from '../domain/stageEvents';
import type { SourcingEvent } from '../domain/types';
import type { Route } from './AdminShell';

type ViewMode = 'table' | 'kanban';
type DataState = 'normal' | 'loading' | 'emptyFirst' | 'emptyFiltered' | 'error' | 'permission';

const STAGE_TINT: Record<string, string> = {
  INTAKE: color.textMuted, RFI: color.info, RFP: color.brandPrimary, RFQ: color.brandPrimary,
  EVALUATION: color.accentPurple, NEGOTIATION: color.accentPurple,
  AUCTION: color.accentPurple, AWARD: color.success, APPROVAL: color.warning,
  CLARIFICATION: color.info,
};

export function SourcingBoard({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state } = useStore();
  const [view, setView] = React.useState<ViewMode>('table');
  const [dataState, setDataState] = React.useState<DataState>('normal');
  const [search, setSearch] = React.useState('');
  const [dense, setDense] = React.useState(false);

  /**
   * The board lists sourcing events, not the asks under them. An RFI and the
   * RFP behind it are one piece of work here and four rows would be four times
   * the same event; each ask is listed in its own section instead.
   */
  let events = state.events.filter((e) => !isStageEvent(e));
  if (dataState === 'permission') {
    // A user scoped to their own events sees only those.
    events = events.filter((e) => e.ownerId === state.currentUser.id);
  }
  if (search.trim()) {
    const needle = search.trim().toLowerCase();
    events = events.filter(
      (e) => e.title.toLowerCase().includes(needle) || e.eventNumber.toLowerCase().includes(needle),
    );
  }
  if (dataState === 'emptyFirst' || dataState === 'emptyFiltered') events = [];

  // Counted over sourcing events. An ask carries its parent's value, so
  // counting both would report the same money four times.
  const board = state.events.filter((e) => !isStageEvent(e));
  const liveCount = board.filter((e) => e.status === 'AUCTION_LIVE').length
    + state.events.filter((e) => isStageEvent(e) && e.status === 'AUCTION_LIVE').length;
  const awaitingAction = board.filter(
    (e) => e.status === 'PENDING_AWARD_APPROVAL' || e.status === 'RESPONSES_CLOSED' || e.status === 'UNDER_EVALUATION',
  ).length;
  const valueInFlight = board
    .filter((e) => e.status !== 'AWARDED' && e.status !== 'CLOSED' && e.status !== 'CANCELLED')
    .reduce((a, e) => a + e.estimatedValue, 0);

  const kpis: Kpi[] = [
    { icon: '◈', value: String(board.filter((e) => e.status !== 'DRAFT' && e.status !== 'CLOSED').length), label: 'Open Events', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary },
    { icon: '⏰', value: String(awaitingAction), label: 'Awaiting My Action', iconBg: color.warningSoft, iconFg: color.warningText },
    { icon: '●', value: String(liveCount), label: 'Auctions Today', iconBg: color.dangerSoft, iconFg: color.dangerText, live: liveCount > 0 },
    { icon: '₹', value: money(valueInFlight, BASE_CURRENCY, { compact: true }), label: 'Value in Flight', iconBg: color.infoSoft, iconFg: color.infoText },
    { icon: '↓', value: '₹8.1L', label: 'Savings YTD', iconBg: color.successSoft, iconFg: color.successText },
  ];

  const columns: Column<SourcingEvent>[] = [
    {
      key: 'number', header: 'Event', width: '250px',
      render: (event) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: color.brandPrimary }}>{event.eventNumber}</span>
            {event.side === 'SELL' && <Chip tone="purple" title="Sell-side: highest bid wins">SELL</Chip>}
            {event.parentEventId && <Chip tone="neutral" title="Re-auction lineage">re-auction</Chip>}
            {(() => {
              // What this event actually produced, so the board says whether a
              // journey turned into asks without having to open it.
              const asks = stageEventsOf(state, event.id);
              return asks.length === 0 ? null : (
                <Chip
                  tone="info"
                  title={asks.map((a) => `${a.eventNumber} (${STAGE_LABELS[a.currentStage]})`).join(' · ')}
                >
                  {asks.length} {asks.length === 1 ? 'ask' : 'asks'}
                </Chip>
              );
            })()}
          </div>
          <div style={{ fontSize: 12.5, color: color.textPrimary, marginTop: 2 }}>{event.title}</div>
        </div>
      ),
    },
    {
      key: 'pattern', header: 'Pattern', width: '150px',
      render: (event) => (
        <span style={{ fontSize: 11.5, color: color.textSecondary }}>
          {JOURNEY_PATTERNS[event.journeyPattern]?.name ?? event.journeyPattern}
        </span>
      ),
    },
    {
      // Stage: where in the graph. Separate column from status, deliberately.
      key: 'stage', header: 'Stage', width: '110px',
      render: (event) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 3, height: 16, borderRadius: 2,
              background: STAGE_TINT[event.currentStage] ?? color.textMuted,
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 500 }}>{STAGE_LABELS[event.currentStage]}</span>
        </span>
      ),
    },
    {
      // Status: the lifecycle state. Never merged with stage.
      key: 'status', header: 'Status', width: '160px',
      render: (event) => (
        <Pill
          presentation={EVENT_STATUS_PRESENTATION[event.status]}
          size="small"
          live={event.status === 'AUCTION_LIVE'}
        />
      ),
    },
    {
      key: 'value', header: 'Value', numeric: true, width: '110px',
      render: (event) => money(event.estimatedValue, event.currency, { compact: true }),
    },
    {
      key: 'bidders', header: 'Responded', width: '110px',
      render: (event) => {
        const bidders = biddersForEvent(state, event.id);
        const submitted = bidders.filter(
          (b) => b.participationStatus === 'SUBMITTED' || b.participationStatus === 'BIDDING',
        ).length;
        if (bidders.length === 0) return <span style={{ color: color.textMuted }}>—</span>;
        const few = bidders.length < 3;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {submitted}/{bidders.length}
            </span>
            {few && <Chip tone="gold" icon="⚑" title="Fewer than 3 bidders — competition is thin">thin</Chip>}
          </span>
        );
      },
    },
    {
      key: 'milestone', header: 'Next milestone', width: '150px',
      render: (event) => {
        if (event.closesAt === null) {
          return <span style={{ fontSize: 11.5, color: color.textMuted }}>Not scheduled</span>;
        }
        const remaining = event.closesAt - serverNow();
        const overdue = remaining < 0;
        const urgent = remaining < 60 * 60_000;
        return (
          <div>
            <div style={{ fontSize: 11, color: color.textSecondary }}>
              {event.status === 'AUCTION_LIVE' ? 'Auction ends' : 'Responses close'}
            </div>
            <div
              style={{
                fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: overdue ? color.dangerText : urgent ? color.warningText : color.textPrimary,
              }}
            >
              {overdue ? 'overdue' : formatCountdown(remaining)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'owner', header: 'Owner', width: '70px',
      render: (event) => {
        const owner = state.events.find((e) => e.id === event.id)?.ownerId;
        return (
          <span style={{ fontSize: 11, fontWeight: 700, color: color.textSecondary }}>
            {owner?.replace('user-', '').toUpperCase()}
          </span>
        );
      },
    },
  ];

  const kanbanStages = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION', 'EVALUATION', 'AWARD', 'APPROVAL'] as const;

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <KpiRow kpis={kpis} />

      {/* Demo controls. Every state the pack requires is reachable. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#FBFCFD', border: `1px dashed ${color.border}`,
          borderRadius: radius.control, padding: '8px 11px',
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, color: color.textMuted, letterSpacing: '.05em' }}>STATE</span>
        {(['normal', 'loading', 'emptyFirst', 'emptyFiltered', 'error', 'permission'] as DataState[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setDataState(s)}
            style={{
              border: `1px solid ${dataState === s ? color.brandPrimary : color.border}`,
              background: dataState === s ? color.brandPrimarySoft : '#fff',
              color: dataState === s ? color.brandPrimary : color.textBody,
              borderRadius: radius.control, padding: '3px 9px', fontSize: 11,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Segmented
            size="small"
            value={dense ? 'dense' : 'comfortable'}
            onChange={(v) => setDense(v === 'dense')}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'dense', label: 'Dense' }]}
          />
        </span>
      </div>

      <Card
        padded={false}
        title={`Sourcing · ${events.length} result${events.length === 1 ? '' : 's'}`}
        hint="Stage and status are separate columns — an event at the auction stage may be scheduled, live or closed."
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, bidders…"
              style={{ width: 200 }}
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[{ value: 'table', label: 'Table' }, { value: 'kanban', label: 'Board' }]}
            />
            <Button variant="primary" onClick={() => onNavigate({ name: 'create' })}>＋ Create Event</Button>
          </div>
        }
      >
        {dataState === 'error' ? (
          <Empty
            icon="!"
            tone="danger"
            title="The board could not load"
            hint="The sourcing service did not respond. Nothing has been lost — retry, or open an event directly from its number."
            action={<Button variant="secondary" onClick={() => setDataState('normal')}>Retry</Button>}
          />
        ) : dataState === 'permission' && events.length === 0 ? (
          <Empty
            icon="👁"
            tone="permission"
            title="You can see only your own events"
            hint="Your role is scoped to events you own. Ask a category manager for wider scope if you need the full board."
          />
        ) : view === 'table' ? (
          <Table
            columns={columns}
            rows={events}
            rowKey={(event) => event.id}
            dense={dense}
            loading={dataState === 'loading'}
            onRowClick={(event) => onNavigate({ name: 'event', eventId: event.id })}
            rowStyle={(event) =>
              event.status === 'AUCTION_LIVE' ? { background: '#FFF7F7' } : undefined
            }
            empty={
              dataState === 'emptyFiltered' || search ? (
                <Empty
                  icon="⌕"
                  title="No events match this view"
                  hint="Clear the search or widen the filters."
                  action={<Button variant="secondary" onClick={() => { setSearch(''); setDataState('normal'); }}>Clear filters</Button>}
                />
              ) : (
                <Empty
                  icon="＋"
                  title="No sourcing events yet"
                  hint="Start from a purchase requisition, or pick a journey-pattern template."
                  action={<Button variant="primary" onClick={() => onNavigate({ name: 'create' })}>Create Event</Button>}
                />
              )
            }
          />
        ) : (
          <div className="rfx-scroll-x" style={{ display: 'flex', gap: 10, padding: 12, alignItems: 'flex-start' }}>
            {kanbanStages.map((stage) => {
              const cards = events.filter((e) => e.currentStage === stage);
              return (
                <div key={stage} style={{ width: 210, flexShrink: 0 }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 9px', background: color.neutralSoft,
                      borderRadius: radius.control, marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 700 }}>{STAGE_LABELS[stage]}</span>
                    <span style={{ fontSize: 11, color: color.textSecondary }}>{cards.length || ''}</span>
                  </div>
                  <div className="rfx-stack" style={{ gap: 7 }}>
                    {cards.length === 0 && (
                      <div
                        style={{
                          border: `1px dashed ${color.border}`, borderRadius: radius.control,
                          padding: '14px 8px', textAlign: 'center',
                          fontSize: 11, color: color.textMuted,
                        }}
                      >
                        Nothing here
                      </div>
                    )}
                    {cards.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onNavigate({ name: 'event', eventId: event.id })}
                        style={{
                          width: '100%', textAlign: 'left', cursor: 'pointer',
                          background: '#fff', border: `1px solid ${color.border}`,
                          borderLeft: `3px solid ${STAGE_TINT[stage] ?? color.textMuted}`,
                          borderRadius: radius.control, padding: '9px 10px',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: color.brandPrimary }}>{event.eventNumber}</div>
                        <div style={{ fontSize: 12, marginTop: 2, lineHeight: 1.35 }}>{event.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {money(event.estimatedValue, event.currency, { compact: true })}
                          </span>
                          <Pill presentation={EVENT_STATUS_PRESENTATION[event.status]} size="small" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
