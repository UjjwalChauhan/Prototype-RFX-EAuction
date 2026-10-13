/**
 * The E-Auction section — every auction in the tenant, with its mechanism.
 *
 * The section used to be a filter over the events list: events whose current
 * stage is AUCTION. That was right as far as it went and wrong in one important
 * way. A controller opening this screen is not asking "which events are at the
 * auction stage"; they are asking "what is running, on what rules, and does
 * anything need me right now". A Japanese auction three rounds in and a sealed
 * bid waiting to be opened are both "at the auction stage" and have nothing
 * else in common — different screens, different actions, different ways to
 * lose.
 *
 * So the mechanism is a column, not a detail found by opening the event, and
 * the rows sort by whether the auction needs a human in the next few minutes.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import { Chip, Pill, Segmented, TextInput } from '../design-system/components/primitives';
import { Card, Empty, KpiRow, Table, type Column, type Kpi } from '../design-system/components/layout';
import { ValidationBanner } from '../design-system/components/domain';
import { AUCTION_STATUS_PRESENTATION } from '../domain/statusMachine';
import { MECHANISM_PROFILE, mechanismIssues } from '../domain/auctionMechanics';
import { VISIBILITY_MANIFEST } from '../domain/feedbackPolicy';
import { directionLabel } from '../domain/comparator';
import { formatCountdown, serverNow } from '../server/clock';
import { auctionSummaries, useStore, type AuctionSummary } from '../store/store';
import type { Route } from './AdminShell';

type Filter = 'All' | 'Needs me' | 'Live' | 'Scheduled' | 'Closed';

/** Whether this auction is waiting on a human decision right now. */
function needsController(row: AuctionSummary): string | null {
  const profile = MECHANISM_PROFILE[row.auction.mechanism];
  const { status } = row.auction;
  if (status === 'PAUSED') return 'Paused — nobody can bid until you resume it';
  if (status !== 'LIVE' && status !== 'EXTENDED') return null;
  if (mechanismIssues(row.auction).some((i) => i.blocking)) {
    return 'The configuration contradicts the mechanism';
  }
  if (profile.bidEntry === 'ONE_SHOT') return 'Envelopes are closed and the deadline is approaching';
  if (profile.bidEntry === 'STAY_IN') return 'A round is waiting to be advanced';
  if (profile.bidEntry === 'TURN_BASED') return 'A turn is waiting to be called';
  if (row.closesAt !== null && row.closesAt - serverNow() < 5 * 60_000) {
    return 'Closing within five minutes';
  }
  return null;
}

export function AuctionBoard({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { state } = useStore();
  const [filter, setFilter] = React.useState<Filter>('All');
  const [query, setQuery] = React.useState('');

  const all = auctionSummaries(state);

  const rows = all.filter((row) => {
    // Searchable by the reference a supplier would quote, as well as by the
    // ask's number and the title.
    const text = `${row.auction.auctionNumber} ${row.event.eventNumber} ${row.event.title} `
      + MECHANISM_PROFILE[row.auction.mechanism].label;
    if (query.trim() !== '' && !text.toLowerCase().includes(query.trim().toLowerCase())) return false;
    switch (filter) {
      case 'Needs me': return needsController(row) !== null;
      case 'Live': return row.auction.status === 'LIVE' || row.auction.status === 'EXTENDED'
        || row.auction.status === 'PAUSED';
      case 'Scheduled': return row.auction.status === 'SCHEDULED' || row.auction.status === 'LOBBY_OPEN';
      case 'Closed': return ['CLOSED', 'RESULTS_PUBLISHED', 'ABORTED', 'CANCELLED'].includes(row.auction.status);
      default: return true;
    }
  });

  const live = all.filter((r) => r.auction.status === 'LIVE' || r.auction.status === 'EXTENDED');
  const attention = all.filter((r) => needsController(r) !== null);
  const mechanismsInPlay = new Set(all.map((r) => r.auction.mechanism));

  const kpis: Kpi[] = [
    {
      icon: '●', value: String(live.length), label: 'Live now',
      iconBg: color.dangerSoft, iconFg: color.dangerText, live: live.length > 0,
    },
    {
      icon: '!', value: String(attention.length), label: 'Waiting on you',
      iconBg: color.warningSoft, iconFg: color.warningText,
    },
    {
      icon: '◈', value: String(mechanismsInPlay.size), label: 'Mechanisms in play',
      iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary,
    },
    {
      icon: '₹',
      value: money(all.reduce((sum, r) => sum + r.startingValue, 0), undefined, { compact: true }),
      label: 'Opening value', iconBg: color.infoSoft, iconFg: color.infoText,
    },
    {
      icon: '◷', value: String(all.filter((r) => r.auction.status === 'SCHEDULED').length),
      label: 'Scheduled', iconBg: color.neutralSoft, iconFg: color.textSecondary,
    },
  ];

  const columns: Column<AuctionSummary>[] = [
    {
      key: 'event', header: 'Auction', width: '250px',
      render: (row) => (
        <div>
          {/* The auction's own reference leads, because this section lists
              auctions. The ask that raised it follows, so the row still
              joins back to the sourcing event a buyer came from. */}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: color.brandPrimary, fontVariantNumeric: 'tabular-nums' }}>
            {row.auction.auctionNumber}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 2 }}>{row.event.title}</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
            under {row.event.eventNumber} · {row.lots} lot{row.lots === 1 ? '' : 's'}
            {' · '}{row.event.businessUnit}
          </div>
        </div>
      ),
    },
    {
      key: 'mechanism', header: 'Mechanism', width: '230px',
      render: (row) => {
        const profile = MECHANISM_PROFILE[row.auction.mechanism];
        return (
          <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip tone="brand">{profile.label}</Chip>
              {row.auction.side === 'SELL' && <Chip tone="gold">sell-side</Chip>}
            </div>
            <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3, lineHeight: 1.45 }}>
              {profile.summary(row.auction.side)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'rules', header: 'Bidders are told', width: '150px',
      render: (row) => (
        <div style={{ fontSize: 11.5 }}>
          <div>{VISIBILITY_MANIFEST[row.auction.feedbackPolicy].label}</div>
          <div style={{ color: color.textSecondary, marginTop: 2 }}>
            {row.auction.identityPolicy === 'MASKED' ? 'Masked labels' : 'Named'}
          </div>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (row) => (
        <div>
          <Pill
            presentation={AUCTION_STATUS_PRESENTATION[row.auction.status]}
            size="small"
            live={row.auction.status === 'LIVE' || row.auction.status === 'EXTENDED'}
          />
          {needsController(row) && (
            <div style={{ fontSize: 10.5, color: color.warningText, marginTop: 4, maxWidth: 160 }}>
              {needsController(row)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'bidders', header: 'Bidders', numeric: true,
      render: (row) => (
        <div style={{ fontSize: 12.5 }}>
          <div>{row.bidders}</div>
          <div style={{ fontSize: 10.5, color: color.textSecondary }}>
            {row.bids} bid{row.bids === 1 ? '' : 's'}
          </div>
        </div>
      ),
    },
    {
      key: 'standing', header: 'Standing', numeric: true,
      render: (row) => {
        // A sealed format has no standing to report, and inventing one from the
        // submissions already in would be the leak the format exists to prevent.
        if (!MECHANISM_PROFILE[row.auction.mechanism].liveRanking) {
          return (
            <span style={{ fontSize: 11, color: color.textMuted }}>
              {MECHANISM_PROFILE[row.auction.mechanism].bidEntry === 'ONE_SHOT' ? 'sealed' : 'no ranking'}
            </span>
          );
        }
        if (row.bestValue === null) {
          return <span style={{ fontSize: 11, color: color.textMuted }}>no bids yet</span>;
        }
        return (
          <div style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            <div style={{ fontWeight: 600 }}>{money(row.bestValue, row.event.currency)}</div>
            <div style={{ fontSize: 10.5, color: color.textSecondary }}>
              from {money(row.startingValue, row.event.currency, { compact: true })}
            </div>
          </div>
        );
      },
    },
    {
      key: 'clock', header: 'Closes',
      render: (row) => {
        if (row.closesAt === null) return <span style={{ fontSize: 11, color: color.textMuted }}>—</span>;
        const remaining = row.closesAt - serverNow();
        const running = row.auction.status === 'LIVE' || row.auction.status === 'EXTENDED';
        return (
          <span
            style={{
              fontSize: 12, fontVariantNumeric: 'tabular-nums',
              color: !running ? color.textSecondary
                : remaining < 0 ? color.dangerText
                : remaining < 300_000 ? color.warningText : color.textPrimary,
              fontWeight: running && remaining < 300_000 ? 700 : 400,
            }}
          >
            {remaining < 0 ? 'past' : formatCountdown(remaining)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <KpiRow kpis={kpis} />

      {attention.length > 0 && (
        <ValidationBanner tone="warning" title={`${attention.length} auction${attention.length === 1 ? '' : 's'} waiting on you`}>
          A Japanese round does not advance itself and a sealed envelope does not open itself. These
          formats hand the controller the clock on purpose — nothing moves until you move it.
        </ValidationBanner>
      )}

      <Card
        padded={false}
        title="E-Auctions"
        hint="Every auction in the tenant. The mechanism decides what the screen behind each row does, so it is on the row."
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextInput
              value={query}
              placeholder="Find an auction"
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 180 }}
            />
            <Segmented
              size="small"
              value={filter}
              onChange={setFilter}
              options={(['All', 'Needs me', 'Live', 'Scheduled', 'Closed'] as Filter[]).map((f) => ({
                value: f, label: f,
              }))}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            icon="◈"
            title="No auction here"
            hint={
              filter === 'All'
                ? 'Auctions appear once an event’s journey reaches its auction stage and one is configured.'
                : `Nothing matches ${filter.toLowerCase()}. Clear the filter to see the rest.`
            }
          />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(row) => row.eventId}
            onRowClick={(row) => onNavigate({ name: 'event', eventId: row.eventId, tab: 'Auction' })}
          />
        )}
      </Card>

      <MechanismLegend />
    </div>
  );
}

/**
 * What each mechanism does, in one line.
 *
 * Here rather than behind a help link because the whole point of the attribute
 * model is that a buyer picks a mechanism deliberately; a list of ten names
 * with no explanation gets picked by familiarity.
 */
function MechanismLegend() {
  const { state } = useStore();
  const inPlay = new Set(auctionSummaries(state).map((r) => r.auction.mechanism));

  return (
    <Card
      title="The ten mechanisms"
      hint="Names are shortcuts. What actually differs is who owns the clock, how a bid arrives, and whether there is a ranking at all while it runs."
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
          gap: 10,
        }}
      >
        {Object.values(MECHANISM_PROFILE).map((profile) => (
          <div
            key={profile.mechanism}
            style={{
              border: `1px solid ${inPlay.has(profile.mechanism) ? color.brandPrimary : color.border}`,
              background: inPlay.has(profile.mechanism) ? color.brandPrimarySoft : '#fff',
              borderRadius: radius.control, padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{profile.label}</span>
              {inPlay.has(profile.mechanism) && <Chip tone="brand">running</Chip>}
              {!profile.enabledByDefault && (
                <Chip tone="neutral" title="Enable only where a regime mandates second-price awards">
                  off by default
                </Chip>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: color.textBody, marginTop: 4, lineHeight: 1.5 }}>
              {profile.summary('BUY')}
            </div>
            <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 6 }}>
              {profile.clockOwner === 'SYSTEM' ? 'System clock' : 'Bidders move the price'}
              {' · '}
              {profile.liveRanking ? 'live ranking' : 'no ranking until it ends'}
              {profile.elimination ? ' · elimination' : ''}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 12, lineHeight: 1.6 }}>
        Direction is never a setting. It derives from the event’s side: on a buy-side event{' '}
        {directionLabel('BUY')}, on a sell-side event {directionLabel('SELL')}. Naming a mechanism
        “reverse” or “forward” would put the same fact in two places.
      </div>
    </Card>
  );
}
