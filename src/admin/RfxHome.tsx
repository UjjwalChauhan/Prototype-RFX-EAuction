/**
 * RFX Home — where a buyer starts the day.
 *
 * Not a report. A report tells you what happened; this screen is organised
 * around what has not happened yet and who it is waiting on. So the order on
 * the page is the order of the questions a buyer actually asks: what needs me
 * now, where is everything, is it moving, and what can be handled for me.
 *
 * Usability rules this layout holds to:
 *   - Four headline numbers, each a door: clicking one goes to the list that
 *     explains it, so no figure on the page is a dead end.
 *   - Urgency is never colour alone — every chip carries an icon and words.
 *   - One primary button per action row, named for the verb it performs.
 *   - Every chart has a table view, because a bar is a shape and a screen
 *     reader needs a number.
 *   - Filters show their counts before they are clicked, and an active search
 *     says so where its results are, with a way to clear it.
 *
 * Every figure is derived in `domain/rfxHome` from records that can be opened
 * from this page. Nothing here is illustrative: a metric with no history shows
 * its number without a trend line rather than a trend line with no history.
 */
import React from 'react';
import { BASE_CURRENCY, color, font, money, radius } from '../design-system/tokens';
import { Button, Chip, Pill, Segmented, Select, TextInput } from '../design-system/components/primitives';
import { Card, Empty, Progress, Table, type Column } from '../design-system/components/layout';
import { AreaChart } from '../design-system/components/charts';
import { EVENT_STATUS_PRESENTATION } from '../domain/statusMachine';
import { serverNow } from '../server/clock';
import { useStore } from '../store/store';
import {
  actionQueue, answerHomeQuestion, assistantOffers, comingUp, coverageByEvent, coverageOf,
  demandFunnel, demandWaiting, eventKindOf, homeAlerts, homeHeadline, homePerformance, isOpen,
  journeyProgress, journeysOf, pipelineColumns, spendByCategory, throughputSeries,
  type AgendaItem, type EventKind, type HomeAction, type HomeAnswer, type HomeInput,
  type HomeTarget, type HomeTone,
} from '../domain/rfxHome';
import type { SourcingEvent } from '../domain/types';
import type { Route } from './AdminShell';

/** The one place a domain target becomes a shell route. */
function routeOf(target: HomeTarget): Route {
  switch (target.kind) {
    case 'event': return { name: 'event', eventId: target.eventId, tab: target.tab };
    case 'create': return { name: 'create', prdId: target.prdId };
    case 'list': return { name: 'list', stage: target.stage };
    case 'intake': return { name: 'intake' };
    case 'requests': return { name: 'requests' };
    case 'approvals': return { name: 'approvals' };
    case 'agents': return { name: 'agents' };
    default: return { name: 'board' };
  }
}

const TONE_FG: Record<HomeTone, string> = {
  brand: color.brandPrimary,
  info: color.infoText,
  purple: color.accentPurpleText,
  warning: color.warningText,
  success: color.successText,
  danger: color.dangerText,
  neutral: color.textSecondary,
};

const DAY = 24 * 3600_000;
/** Below this many responses there is no competitive tension to speak of. */
const HEALTHY_RESPONSES = 3;

type EventFilter = 'mine' | 'action' | 'closing' | 'awaiting';
type EventSort = 'closes' | 'value' | 'progress';
const PAGE = 8;
const ACTIONS_SHOWN = 5;

const scrollTo = (ref: React.RefObject<HTMLElement>) =>
  ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function RfxHome({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state } = useStore();
  const now = serverNow();
  const [filter, setFilter] = React.useState<EventFilter>('mine');
  const [kind, setKind] = React.useState<EventKind | 'all'>('all');
  const [sort, setSort] = React.useState<EventSort>('closes');
  const [query, setQuery] = React.useState('');
  const [showAllEvents, setShowAllEvents] = React.useState(false);
  const [showAllActions, setShowAllActions] = React.useState(false);

  const actionsRef = React.useRef<HTMLDivElement>(null);
  const eventsRef = React.useRef<HTMLDivElement>(null);
  const metricsRef = React.useRef<HTMLDivElement>(null);

  const input: HomeInput = {
    now,
    userId: state.currentUser.id,
    currency: BASE_CURRENCY,
    events: state.events,
    bidders: state.bidders,
    responses: state.responses,
    clarifications: state.clarifications,
    nfas: state.nfas,
    purchaseRequests: state.purchaseRequests,
    purchaseRequestLines: state.purchaseRequestLines,
    requisitions: state.sourcingRequisitions,
    rateContracts: state.rateContracts,
    agentsPaused: state.agentKillSwitch.engaged,
  };

  const go = (target: HomeTarget) => onNavigate(routeOf(target));

  const headline = homeHeadline(input);
  const actions = actionQueue(input, Number.POSITIVE_INFINITY);
  const pipeline = pipelineColumns(input);
  const agenda = comingUp(input, 6);
  const alerts = homeAlerts(input);
  const offers = assistantOffers(input);
  const waiting = demandWaiting(input);
  const performance = homePerformance(input);

  // The next step for an event is the action the queue already chose for it,
  // so the table and the queue can never recommend two different things.
  const nextStep = new Map<string, HomeAction>();
  for (const action of actions) if (!nextStep.has(action.reference)) nextStep.set(action.reference, action);

  const journeys = journeysOf(state.events);
  const matchesFilter = (event: SourcingEvent, f: EventFilter) => {
    if (f === 'action') return nextStep.has(event.eventNumber);
    if (f === 'closing') return isOpen(event) && event.closesAt !== null && event.closesAt - now < 7 * DAY;
    if (f === 'awaiting') return event.status === 'PENDING_AWARD_APPROVAL' || event.status === 'AWARD_PENDING_ONBOARDING';
    return true;
  };
  const needle = query.trim().toLowerCase();
  const scoped = journeys.filter((event) =>
    (kind === 'all' || eventKindOf(event) === kind)
    && (needle === ''
      || event.eventNumber.toLowerCase().includes(needle)
      || event.title.toLowerCase().includes(needle)
      || event.category.toLowerCase().includes(needle)));
  const filterCount = (f: EventFilter) => scoped.filter((e) => matchesFilter(e, f)).length;
  const events = scoped
    .filter((event) => matchesFilter(event, filter))
    .sort((a, b) => {
      if (sort === 'value') return b.estimatedValue - a.estimatedValue;
      if (sort === 'progress') {
        const pa = journeyProgress(a);
        const pb = journeyProgress(b);
        return pb.step / pb.total - pa.step / pa.total;
      }
      // Open events by deadline, unscheduled after them, finished last.
      const key = (e: SourcingEvent) => (!isOpen(e) ? Infinity : e.closesAt ?? Number.MAX_SAFE_INTEGER);
      return key(a) - key(b);
    });

  const showEvents = (f: EventFilter) => {
    setFilter(f);
    setShowAllEvents(false);
    scrollTo(eventsRef);
  };

  return (
    <div className="rfx-side" style={{ gap: 16 }}>
      <div className="rfx-stack" style={{ gap: 16 }}>
        <Greeting
          name={state.currentUser.name}
          now={now}
          liveCount={headline.liveCount}
          actionCount={headline.needsAction}
          query={query}
          onQuery={setQuery}
          onSearch={() => showEvents('mine')}
          onNavigate={go}
        />

        <HeadlineTiles
          headline={headline}
          onActions={() => scrollTo(actionsRef)}
          onClosing={() => showEvents('closing')}
          onLive={() => go({ kind: 'board' })}
          onCoverage={() => scrollTo(metricsRef)}
        />

        <div ref={actionsRef} style={{ scrollMarginTop: 16 }}>
          <Card
            title={<TitleWithCount title="Needs your action" count={actions.length} tone={actions.length > 0 ? 'brand' : 'success'} />}
            action={<span style={{ fontSize: 11.5, color: color.textMuted }}>Sorted by what runs out first</span>}
            padded={false}
          >
            {actions.length === 0 ? (
              <Empty icon="✓" title="Nothing is waiting on you" hint="Every open event is with a supplier or an approver." />
            ) : (
              <div>
                {(showAllActions ? actions : actions.slice(0, ACTIONS_SHOWN)).map((action, index) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    first={index === 0}
                    eventId={state.events.find((e) => e.eventNumber === action.reference)?.id}
                    onNavigate={go}
                  />
                ))}
                {actions.length > ACTIONS_SHOWN && (
                  <ShowMore
                    shown={showAllActions ? actions.length : ACTIONS_SHOWN}
                    total={actions.length}
                    expanded={showAllActions}
                    onToggle={() => setShowAllActions((v) => !v)}
                  />
                )}
              </div>
            )}
          </Card>
        </div>

        <Card
          title={<span>RFX pipeline <Muted>· {journeys.length} journeys — the asks under one event are one piece of work, counted once</Muted></span>}
          action={<LinkButton onClick={() => onNavigate({ name: 'board' })}>Open RFX Board →</LinkButton>}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(112px, 100%), 1fr))',
              gap: 8,
            }}
          >
            {pipeline.map((column) => (
              <button
                key={column.key}
                type="button"
                onClick={() => go(column.target)}
                aria-label={`${column.label}: ${column.count}${column.note ? `, ${column.note}` : ''}`}
                className="rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div style={{ fontSize: 11.5, color: color.textSecondary }}>{column.label}</div>
                <div
                  style={{
                    fontSize: 20, fontWeight: 700, lineHeight: 1.3,
                    color: column.count === 0 ? color.textMuted : color.textPrimary,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {column.count}
                </div>
                <div style={{ fontSize: 11, color: column.note ? color.warningText : color.textMuted, minHeight: 15 }}>
                  {column.note ?? ' '}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div ref={metricsRef} style={{ scrollMarginTop: 16 }}>
          <SourcingMetrics input={input} />
        </div>

        <div ref={eventsRef} style={{ scrollMarginTop: 16 }}>
          <Card
            title={<TitleWithCount title="My events" count={journeys.length} tone="neutral" />}
            action={<LinkButton onClick={() => onNavigate({ name: 'board' })}>View all on board →</LinkButton>}
            padded={false}
          >
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                padding: '10px 16px', borderBottom: `1px solid ${color.border}`,
              }}
            >
              <Segmented
                size="small"
                value={filter}
                onChange={(f) => { setFilter(f); setShowAllEvents(false); }}
                options={[
                  { value: 'mine', label: `All · ${filterCount('mine')}` },
                  { value: 'action', label: `Needs action · ${filterCount('action')}` },
                  { value: 'closing', label: `Closing this week · ${filterCount('closing')}` },
                  { value: 'awaiting', label: `Awaiting award · ${filterCount('awaiting')}` },
                ]}
              />
              <span style={{ flex: 1 }} />
              {needle !== '' && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={`Clear search for ${query}`}
                  className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  “{query}” ✕
                </button>
              )}
              <div style={{ width: 132 }}>
                <Select aria-label="Event type" value={kind} onChange={(e) => setKind(e.target.value as EventKind | 'all')}>
                  <option value="all">Type: All</option>
                  <option value="RFQ">RFQ</option>
                  <option value="RFP">RFP</option>
                  <option value="RFI">RFI</option>
                  <option value="e-Auction">e-Auction</option>
                </Select>
              </div>
              <div style={{ width: 168 }}>
                <Select aria-label="Sort events" value={sort} onChange={(e) => setSort(e.target.value as EventSort)}>
                  <option value="closes">Sort: Closes soonest</option>
                  <option value="value">Sort: Highest value</option>
                  <option value="progress">Sort: Furthest along</option>
                </Select>
              </div>
            </div>
            <EventsTable
              input={input}
              events={showAllEvents ? events : events.slice(0, PAGE)}
              nextStep={nextStep}
              onNavigate={onNavigate}
              onReset={() => { setFilter('mine'); setKind('all'); setQuery(''); }}
            />
            {events.length > PAGE && (
              <ShowMore
                shown={showAllEvents ? events.length : PAGE}
                total={events.length}
                expanded={showAllEvents}
                onToggle={() => setShowAllEvents((v) => !v)}
              />
            )}
          </Card>
        </div>

        <div className="rfx-split" style={{ gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' }}>
          <Card
            title={<TitleWithCount title="Demand waiting for an RFX" count={waiting.length} tone={waiting.length > 0 ? 'gold' : 'success'} />}
            action={<LinkButton onClick={() => go({ kind: 'intake' })}>PR Workbench →</LinkButton>}
            padded={false}
          >
            {waiting.length === 0 ? (
              <Empty icon="✓" title="All consolidated demand has an event" />
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {waiting.slice(0, 4).map(({ requisition, value, ageDays }, index) => (
                  <li
                    key={requisition.id}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'center', padding: '11px 16px',
                      borderTop: index === 0 ? 'none' : `1px solid ${color.border}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>
                        <strong style={{ color: color.brandPrimary }}>{requisition.prdNumber}</strong>
                        <span style={{ color: color.textPrimary }}> · {requisition.category}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                        {requisition.lineIds.length} {requisition.lineIds.length === 1 ? 'line' : 'lines'}
                        {value > 0 && <> · {money(value, requisition.currency, { compact: true })}</>}
                        {' · '}
                        <span style={{ color: ageDays >= 7 ? color.warningText : undefined, fontWeight: ageDays >= 7 ? 600 : undefined }}>
                          waiting {ageDays === 0 ? 'since today' : `${ageDays} ${ageDays === 1 ? 'day' : 'days'}`}
                        </span>
                      </div>
                    </div>
                    <Button size="small" variant="secondary" onClick={() => go({ kind: 'create', prdId: requisition.id })}>
                      Create RFX
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Sourcing performance" hint="Read off the events themselves." padded={false}>
            <dl style={{ margin: 0 }}>
              <PerformanceRow
                label="Awarded"
                value={money(performance.awardedValue, BASE_CURRENCY, { compact: true })}
                note={`${performance.awardedCount} ${performance.awardedCount === 1 ? 'event' : 'events'}`}
                tone="success"
              />
              <PerformanceRow
                label="In flight"
                value={money(performance.inFlightValue, BASE_CURRENCY, { compact: true })}
                note={`${journeys.filter(isOpen).length} open journeys`}
              />
              <PerformanceRow
                label="Cycle time, publish → award"
                value={performance.cycleDays === null ? '—' : `${performance.cycleDays} days`}
                note={performance.cycleSample === 0
                  ? 'nothing awarded yet'
                  : `median of ${performance.cycleSample} ${performance.cycleSample === 1 ? 'award' : 'awards'}`}
              />
            </dl>
          </Card>
        </div>
      </div>

      <div className="rfx-stack" style={{ gap: 16 }}>
        <ComingUp now={now} agenda={agenda} onNavigate={go} />
        <Alerts alerts={alerts} onNavigate={go} />
        <AssistantPanel
          input={input}
          offers={offers}
          paused={state.agentKillSwitch.engaged}
          onNavigate={go}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 400, color: color.textMuted }}>{children}</span>;
}

function TitleWithCount({
  title, count, tone,
}: { title: string; count: number; tone: 'brand' | 'neutral' | 'gold' | 'success' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {title}
      <Chip tone={tone}>{count}</Chip>
    </span>
  );
}

function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function ShowMore({
  shown, total, expanded, onToggle,
}: { shown: number; total: number; expanded: boolean; onToggle: () => void }) {
  return (
    <div
      style={{
        display: 'flex', gap: 6, alignItems: 'center', padding: '10px 16px',
        borderTop: `1px solid ${color.border}`, fontSize: 11.5, color: color.textSecondary,
      }}
    >
      Showing {shown} of {total} ·
      <LinkButton onClick={onToggle}>{expanded ? 'Show fewer' : `Show ${total - shown} more`}</LinkButton>
    </div>
  );
}

function PerformanceRow({
  label, value, note, tone,
}: { label: string; value: string; note: string; tone?: HomeTone }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderTop: `1px solid ${color.border}`,
      }}
    >
      <dt style={{ fontSize: 12.5, color: color.textSecondary }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone ? TONE_FG[tone] : color.textPrimary }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: color.textMuted }}>{note}</div>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Greeting and headline
// ---------------------------------------------------------------------------

function Greeting({
  name, now, liveCount, actionCount, query, onQuery, onSearch, onNavigate,
}: {
  name: string; now: number; liveCount: number; actionCount: number;
  query: string; onQuery: (next: string) => void; onSearch: () => void;
  onNavigate: (target: HomeTarget) => void;
}) {
  const hour = new Date(now).getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Good {part}, {name}</h2>
        <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 3 }}>
          {new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          {' · '}{liveCount} live {liveCount === 1 ? 'event' : 'events'}
          {' · '}
          <strong style={{ color: actionCount > 0 ? color.warningText : color.successText, fontWeight: 600 }}>
            {actionCount === 0 ? 'nothing needs you' : `${actionCount} need${actionCount === 1 ? 's' : ''} your action`}
          </strong>
        </div>
      </div>
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); onSearch(); }}
        style={{ flex: '0 1 240px', minWidth: 180 }}
      >
        <TextInput
          type="search"
          aria-label="Search your events by number, title or category"
          placeholder="Search events…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </form>
      <Button variant="secondary" size="small" onClick={() => onNavigate({ kind: 'intake' })}>
        Source demand
      </Button>
      <Button variant="secondary" size="small" onClick={() => onNavigate({ kind: 'board' })}>
        Compare bids
      </Button>
      <Button variant="primary" size="small" onClick={() => onNavigate({ kind: 'create' })}>
        ＋ Create RFX
      </Button>
    </div>
  );
}

function HeadlineTiles({
  headline, onActions, onClosing, onLive, onCoverage,
}: {
  headline: ReturnType<typeof homeHeadline>;
  onActions: () => void; onClosing: () => void; onLive: () => void; onCoverage: () => void;
}) {
  const { coverage } = headline;
  const pct = coverage && coverage.invited > 0 ? Math.round((coverage.responded / coverage.invited) * 100) : null;
  const next = headline.dueSoon[0];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
        gap: 12,
      }}
    >
      <Tile
        label="Needs your action"
        value={String(headline.needsAction)}
        emphasis={headline.needsAction > 0}
        onClick={onActions}
        note={headline.needsAction === 0
          ? 'You are clear'
          : [
            headline.overdue > 0 ? `${headline.overdue} overdue` : null,
            `${headline.dueSoon.length} due in 48 h`,
          ].filter(Boolean).join(' · ')}
        noteTone={headline.overdue > 0 ? 'danger' : undefined}
      />
      <Tile
        label="Due in 48 hours"
        value={String(headline.dueSoon.length)}
        onClick={onClosing}
        note={next
          ? `Next: ${next.detail.split(' · ')[0]} · ${next.title.toLowerCase()} ${next.when.toLowerCase()}${headline.dueThisWeek > 0 ? ` · ${headline.dueThisWeek} more this week` : ''}`
          : headline.dueThisWeek > 0 ? `${headline.dueThisWeek} later this week` : 'No deadlines this week'}
      />
      <Tile
        label="Live with suppliers"
        value={String(headline.liveCount)}
        onClick={onLive}
        note={headline.liveByKind.length === 0
          ? 'Nothing published'
          : headline.liveByKind.map((k) => `${k.count} ${k.kind}`).join(' · ')}
      />
      <Tile
        label="Bid coverage"
        value={pct === null ? '—' : `${pct}%`}
        onClick={onCoverage}
        note={coverage ? `${coverage.responded} of ${coverage.invited} invited suppliers responded` : 'No suppliers invited yet'}
        meter={pct}
      />
    </div>
  );
}

function Tile({
  label, value, note, noteTone, emphasis, meter, onClick,
}: {
  label: string; value: string; note: string; noteTone?: HomeTone;
  emphasis?: boolean; meter?: number | null; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-4 py-3 text-left shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        background: emphasis ? color.brandPrimarySoft : color.surface,
        borderColor: emphasis ? color.brandPrimaryTint : color.border,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: emphasis ? color.brandPrimaryStrong : color.textSecondary }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 26, fontWeight: 700, lineHeight: 1.25, marginTop: 2,
          color: emphasis ? color.brandPrimaryStrong : color.textPrimary,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {meter !== undefined && meter !== null && (
        <div style={{ margin: '4px 0 2px' }}>
          <Progress value={meter} max={100} tone={meter < 50 ? color.warningText : color.brandPrimary} />
        </div>
      )}
      <div style={{ fontSize: 11.5, color: noteTone ? TONE_FG[noteTone] : color.textSecondary, marginTop: 3, lineHeight: 1.45 }}>
        {note}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Needs your action
// ---------------------------------------------------------------------------

/** Urgency carries an icon and words, so it survives without colour. */
const URGENCY: Record<HomeAction['urgency'], { tone: 'danger' | 'gold' | 'info' | 'neutral'; icon: string }> = {
  overdue: { tone: 'danger', icon: '⚠' },
  today: { tone: 'danger', icon: '◷' },
  soon: { tone: 'gold', icon: '◷' },
  scheduled: { tone: 'info', icon: '▦' },
  open: { tone: 'neutral', icon: '○' },
};

function ActionRow({
  action, first, eventId, onNavigate,
}: {
  action: HomeAction; first: boolean; eventId?: string;
  onNavigate: (target: HomeTarget) => void;
}) {
  const urgency = URGENCY[action.urgency];
  const pressing = action.urgency === 'overdue' || action.urgency === 'today' || action.urgency === 'soon';
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap',
        gap: '6px 14px', alignItems: 'start',
        padding: '13px 16px',
        borderTop: first ? 'none' : `1px solid ${color.border}`,
      }}
    >
      <div style={{ paddingTop: 1, width: 104, flexShrink: 0 }}>
        <Chip tone={urgency.tone} icon={urgency.icon}>{action.due}</Chip>
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>{action.title}</div>
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
            {eventId ? (
              <button
                type="button"
                onClick={() => onNavigate({ kind: 'event', eventId })}
                className="rounded-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {action.reference}
              </button>
            ) : (
              <strong style={{ color: color.textPrimary }}>{action.reference}</strong>
            )}
            {' · '}{action.context}
          </div>
        </div>
        <div style={{ width: 150, flexShrink: 0 }}>
          {action.progress ? (
            <>
              <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Stage {action.progress.step} of {action.progress.total} · {action.progress.label}
              </div>
              <Progress value={action.progress.step} max={action.progress.total} height={4} />
            </>
          ) : (
            <div style={{ fontSize: 11, color: color.textMuted }}>Not started</div>
          )}
        </div>
        <div style={{ width: 150, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" variant={pressing ? 'primary' : 'secondary'} onClick={() => onNavigate(action.target)}>
            {action.cta}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sourcing metrics — four small charts, each with a table behind it
// ---------------------------------------------------------------------------

function SourcingMetrics({ input }: { input: HomeInput }) {
  const throughput = throughputSeries(input);
  const coverage = coverageByEvent(input).slice(0, 6);
  const categories = spendByCategory(input);
  const funnel = demandFunnel(input);
  const thin = coverage.filter((c) => c.coverage.responded < HEALTHY_RESPONSES).length;

  return (
    <Card title="Sourcing metrics" hint="Last 8 weeks · your events only">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 12,
        }}
      >
        <ChartPanel
          title="Events published vs awarded"
          note="per week"
          table={{
            head: ['Week', 'Published', 'Awarded'],
            rows: throughput.labels.map((label, i) => [
              label, String(throughput.published[i] ?? 0), String(throughput.awarded[i] ?? 0),
            ]),
          }}
        >
          <AreaChart
            labels={throughput.labels}
            height={130}
            formatValue={(value) => String(value)}
            caption="Journeys published and awarded per week over the last eight weeks"
            series={[
              { name: 'Published', tone: color.brandPrimary, points: throughput.published },
              { name: 'Awarded', tone: color.successText, points: throughput.awarded },
            ].filter((s) => s.points.length > 0)}
          />
        </ChartPanel>

        <ChartPanel
          title="Bid coverage by open event"
          note={thin > 0 ? `${thin} below ${HEALTHY_RESPONSES} responses` : 'thinnest first'}
          noteTone={thin > 0 ? 'warning' : undefined}
          table={{
            head: ['Event', 'Responded', 'Invited'],
            rows: coverage.map(({ event, coverage: c }) => [event.eventNumber, String(c.responded), String(c.invited)]),
          }}
        >
          <BarList
            empty="No open event has invited suppliers yet."
            rows={coverage.map(({ event, coverage: c }) => ({
              key: event.id,
              label: event.eventNumber,
              value: c.responded,
              max: c.invited,
              text: `${c.responded} of ${c.invited}`,
              tone: c.responded < HEALTHY_RESPONSES ? color.warningText : color.brandPrimary,
            }))}
          />
        </ChartPanel>

        <ChartPanel
          title="Open value by category"
          note="not yet awarded"
          table={{
            head: ['Category', 'Open value'],
            rows: categories.map((c) => [c.label, money(c.value, BASE_CURRENCY, { compact: true })]),
          }}
        >
          <BarList
            empty="No open value to break down yet."
            rows={categories.map((slice) => ({
              key: slice.label,
              label: slice.label,
              value: slice.value,
              max: Math.max(...categories.map((c) => c.value)),
              text: money(slice.value, BASE_CURRENCY, { compact: true }),
              tone: color.brandPrimary,
            }))}
          />
        </ChartPanel>

        <ChartPanel
          title="Demand to award"
          note="requisition lines"
          table={{
            head: ['Stage', 'Lines', 'Meaning'],
            rows: funnel.map((step) => [step.label, String(step.count), step.hint]),
          }}
        >
          <BarList
            empty="No requisition lines yet."
            rows={funnel.map((step) => ({
              key: step.label,
              label: step.label,
              value: step.count,
              max: Math.max(1, ...funnel.map((s) => s.count)),
              text: String(step.count),
              tone: TONE_FG[step.tone],
              title: step.hint,
            }))}
          />
        </ChartPanel>
      </div>
    </Card>
  );
}

function ChartPanel({
  title, note, noteTone, table, children,
}: {
  title: string; note: string; noteTone?: HomeTone;
  table: { head: string[]; rows: string[][] };
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: noteTone ? TONE_FG[noteTone] : color.textMuted }}>{note}</span>
      </div>
      {asTable ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              {table.head.map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i === 0 ? 'left' : 'right', fontWeight: 500, color: color.textSecondary,
                    padding: '4px 6px', borderBottom: `1px solid ${color.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    style={{
                      textAlign: i === 0 ? 'left' : 'right', padding: '4px 6px',
                      fontFamily: i === 0 ? undefined : font.mono,
                      borderBottom: `1px solid ${color.rowAlt}`,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : children}
      <button
        type="button"
        aria-pressed={asTable}
        onClick={() => setAsTable((v) => !v)}
        className="mt-2.5 rounded-sm text-[11.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {asTable ? '▸ Chart view' : '▸ Table view'}
      </button>
    </div>
  );
}

function BarList({
  rows, empty,
}: {
  rows: { key: string; label: string; value: number; max: number; text: string; tone: string; title?: string }[];
  empty: string;
}) {
  if (rows.length === 0) return <div style={{ fontSize: 12, color: color.textMuted, padding: '16px 0' }}>{empty}</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
      {rows.map((row) => (
        <li
          key={row.key}
          title={row.title}
          style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) 64px', alignItems: 'center', gap: 8, fontSize: 11.5 }}
        >
          <span style={{ color: color.textSecondary, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.label}
          </span>
          <span aria-hidden style={{ height: 10, borderRadius: 3, background: color.brandPrimarySoft, overflow: 'hidden' }}>
            <span
              style={{
                display: 'block', height: '100%', borderRadius: 3, background: row.tone,
                width: `${row.max === 0 ? 0 : Math.min(100, (row.value / row.max) * 100)}%`,
              }}
            />
          </span>
          <span style={{ fontFamily: font.mono, fontSize: 11, color: color.textPrimary, whiteSpace: 'nowrap' }}>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// My events
// ---------------------------------------------------------------------------

const KIND_TONE: Record<EventKind, 'info' | 'brand' | 'purple' | 'gold'> = {
  RFI: 'info', RFP: 'purple', RFQ: 'brand', 'e-Auction': 'gold',
};

function EventsTable({
  input, events, nextStep, onNavigate, onReset,
}: {
  input: HomeInput;
  events: SourcingEvent[];
  nextStep: Map<string, HomeAction>;
  onNavigate: (route: Route) => void;
  onReset: () => void;
}) {
  const now = input.now;
  const shortDate = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const columns: Column<SourcingEvent>[] = [
    {
      key: 'event', header: 'Event',
      render: (event) => (
        <div style={{ minWidth: 170 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: color.brandPrimary, fontFamily: font.mono }}>{event.eventNumber}</span>
          <div style={{ fontSize: 12, marginTop: 1, color: color.textPrimary }}>{event.title}</div>
        </div>
      ),
    },
    {
      key: 'type', header: 'Type', width: '90px',
      render: (event) => {
        const kind = eventKindOf(event);
        return <Chip tone={KIND_TONE[kind]}>{kind}</Chip>;
      },
    },
    {
      key: 'status', header: 'Status', width: '150px',
      render: (event) => {
        const progress = journeyProgress(event);
        return (
          <div>
            <Pill presentation={EVENT_STATUS_PRESENTATION[event.status]} size="small" />
            <div style={{ fontSize: 10.5, color: color.textMuted, marginTop: 3 }}>
              {progress.label} · step {progress.step} of {progress.total}
            </div>
          </div>
        );
      },
    },
    {
      key: 'bids', header: 'Bids received', width: '140px',
      render: (event) => {
        const c = coverageOf(input, event.id);
        if (c.invited === 0) return <span style={{ color: color.textMuted }}>No invitees</span>;
        const thin = isOpen(event) && c.responded < HEALTHY_RESPONSES;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36 }}>
              <Progress value={c.responded} max={c.invited} height={4} tone={thin ? color.warningText : color.brandPrimary} />
            </div>
            <span style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{c.responded} of {c.invited}</span>
          </div>
        );
      },
    },
    {
      key: 'value', header: 'Value', numeric: true, width: '90px',
      render: (event) => money(event.estimatedValue, event.currency, { compact: true }),
    },
    {
      key: 'closes', header: 'Closes', width: '130px',
      render: (event) => {
        if (event.awardedAt !== null) {
          return <span style={{ fontSize: 11.5, color: color.successText }}>Awarded {shortDate(event.awardedAt)}</span>;
        }
        if (event.closesAt === null) return <span style={{ fontSize: 11.5, color: color.textMuted }}>Not scheduled</span>;
        const delta = event.closesAt - now;
        const open = isOpen(event);
        const overdue = delta < 0 && open;
        const days = Math.round(delta / DAY);
        const relative = !open ? 'Closed'
          : overdue ? 'Overdue'
            : delta < DAY ? 'Today'
              : `In ${days} ${days === 1 ? 'day' : 'days'}`;
        const urgent = open && delta < 3 * DAY;
        return (
          <div style={{ fontSize: 11.5 }}>
            <div style={{ fontWeight: urgent ? 600 : 400, color: overdue ? color.dangerText : urgent ? color.warningText : color.textPrimary }}>
              {relative}
            </div>
            <div style={{ fontSize: 10.5, color: color.textMuted }}>{shortDate(event.closesAt)}</div>
          </div>
        );
      },
    },
    {
      key: 'next', header: 'Next step', width: '150px',
      render: (event) => {
        const action = nextStep.get(event.eventNumber);
        if (action) {
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate(routeOf(action.target)); }}
              className="rounded-sm text-left text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {action.cta}
            </button>
          );
        }
        const waitingOn = !isOpen(event) ? '—'
          : event.status === 'PUBLISHED' || event.status === 'OPEN' ? 'Waiting on suppliers'
            : 'No action from you';
        return <span style={{ fontSize: 11.5, color: color.textMuted }}>{waitingOn}</span>;
      },
    },
  ];

  return (
    <Table
      columns={columns}
      rows={events}
      rowKey={(event) => event.id}
      onRowClick={(event) => onNavigate({ name: 'event', eventId: event.id })}
      empty={
        <Empty
          icon="▤"
          title="No events match this view"
          hint="Try another filter or clear the search."
          action={<Button size="small" variant="secondary" onClick={onReset}>Reset filters</Button>}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Right rail
// ---------------------------------------------------------------------------

function ComingUp({
  now, agenda, onNavigate,
}: { now: number; agenda: AgendaItem[]; onNavigate: (target: HomeTarget) => void }) {
  return (
    <Card
      title="Coming up"
      hint={new Date(now).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
      padded={false}
    >
      {agenda.length === 0 ? (
        <div style={{ fontSize: 12, color: color.textMuted, padding: 16 }}>Nothing scheduled.</div>
      ) : (
        <ul style={{ margin: 0, padding: '4px 0', listStyle: 'none' }}>
          {agenda.map((item) => {
            const at = new Date(item.at);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.target)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    style={{
                      width: 34, flexShrink: 0, textAlign: 'center', lineHeight: 1.1,
                      color: item.tone === 'danger' || item.tone === 'warning' ? TONE_FG[item.tone] : color.textPrimary,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', color: color.textMuted }}>
                      {at.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{at.getDate()}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: color.textPrimary }}>{item.title}</span>
                    <span className="block truncate" style={{ fontSize: 11, color: color.textSecondary }}>{item.detail}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: TONE_FG[item.tone] }}>
                    {item.when}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Alerts({
  alerts, onNavigate,
}: { alerts: ReturnType<typeof homeAlerts>; onNavigate: (target: HomeTarget) => void }) {
  // Read state is the viewer's, for this visit. The condition behind an alert
  // stays until the record changes, so reading one dims it rather than hiding it.
  const [read, setRead] = React.useState<Set<string>>(() => new Set());
  const unread = alerts.filter((a) => !read.has(a.id)).length;
  const open = (id: string, target: HomeTarget) => {
    setRead((prev) => new Set(prev).add(id));
    onNavigate(target);
  };

  return (
    <Card
      title={<TitleWithCount title="Alerts" count={unread} tone={unread > 0 ? 'gold' : 'success'} />}
      action={unread > 0
        ? <LinkButton onClick={() => setRead(new Set(alerts.map((a) => a.id)))}>Mark all read</LinkButton>
        : undefined}
      padded={false}
    >
      {alerts.length === 0 ? (
        <div style={{ fontSize: 12, color: color.textMuted, padding: 16 }}>Nothing to flag.</div>
      ) : (
        <ul style={{ margin: 0, padding: '4px 0', listStyle: 'none' }}>
          {alerts.map((alert) => {
            const isRead = read.has(alert.id);
            return (
              <li key={alert.id} style={{ display: 'flex', gap: 10, padding: '8px 16px', opacity: isRead ? 0.6 : 1 }}>
                <span
                  aria-hidden
                  style={{
                    width: 7, height: 7, borderRadius: 999, marginTop: 5, flexShrink: 0,
                    background: isRead ? 'transparent' : TONE_FG[alert.tone],
                    border: `1.5px solid ${TONE_FG[alert.tone]}`,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: isRead ? 500 : 600, color: color.textPrimary }}>
                    {!isRead && <span className="sr-only">Unread: </span>}
                    {alert.title}
                  </div>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 1 }}>
                    {alert.detail}{' · '}
                    <button
                      type="button"
                      onClick={() => open(alert.id, alert.target)}
                      className="rounded-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * The assistant, as the agents that already exist.
 *
 * Every offer names the agent behind it and the first thing that agent is not
 * allowed to do. That is the honest shape of this feature: the work is drafted
 * by something that cannot publish, cannot award and cannot disqualify, and a
 * buyer supervising it needs the boundary on screen rather than in a manual.
 */
function AssistantPanel({
  input, offers, paused, onNavigate,
}: {
  input: HomeInput;
  offers: ReturnType<typeof assistantOffers>;
  paused: boolean;
  onNavigate: (target: HomeTarget) => void;
}) {
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState<HomeAnswer | null>(null);

  const ask = () => {
    if (!question.trim()) return;
    setAnswer(answerHomeQuestion(input, question));
  };

  return (
    <Card padded={false}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', borderBottom: `1px solid ${color.border}`,
        }}
      >
        <span aria-hidden style={{ color: color.accentPurple }}>✦</span>
        <strong style={{ fontSize: 13 }}>AI RFX Assistant</strong>
        <span style={{ flex: 1 }} />
        <Chip tone={paused ? 'danger' : 'success'} icon={paused ? '■' : '●'}>{paused ? 'Paused' : 'Online'}</Chip>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {paused ? (
          <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
            The tenant kill switch is engaged, so no agent is offering anything. The work waits for a human.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8 }}>
              Based on what is open now
            </div>
            {offers.length === 0 ? (
              <div style={{ fontSize: 12, color: color.textMuted }}>
                Nothing to offer: no demand waiting, no unanswered question, nothing to score.
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {offers.map((offer) => (
                  <li key={offer.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(offer.target)}
                      title={offer.detail}
                      className="w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: color.textPrimary }}>{offer.title}</span>
                      <span style={{ display: 'block', fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
                        {offer.agent} · {offer.agentName}
                      </span>
                      <span style={{ display: 'block', fontSize: 10.5, color: color.warningText, marginTop: 1 }}>
                        Cannot: {offer.limit.toLowerCase()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${color.border}`, padding: 12 }}>
        {answer && (
          <div
            role="status"
            style={{
              fontSize: 11.5, lineHeight: 1.6, color: color.textBody,
              background: color.neutralSoft, borderRadius: radius.control,
              padding: '8px 10px', marginBottom: 8,
            }}
          >
            {answer.answer}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: color.textMuted }}>Read from: {answer.basis}</span>
              {answer.target && (
                <Button size="small" variant="tertiary" onClick={() => onNavigate(answer.target!)}>
                  Open
                </Button>
              )}
            </div>
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(); }}
          style={{ display: 'flex', gap: 6 }}
        >
          <TextInput
            aria-label="Ask about your events, approvals or demand"
            placeholder="Ask about approvals, questions, value…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button size="small" variant="primary" type="submit" disabled={!question.trim()}>Ask</Button>
        </form>
        <div style={{ fontSize: 10, color: color.textMuted, marginTop: 6, lineHeight: 1.5 }}>
          Answers are arithmetic over this tenant's records, not a model — so they can be checked by opening what they cite.
        </div>
      </div>
    </Card>
  );
}
