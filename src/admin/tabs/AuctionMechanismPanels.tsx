/**
 * The parts of the buyer cockpit that differ by mechanism.
 *
 * Everything an English auction needs — a ranking, a ledger, a countdown — is
 * in the cockpit already. What was missing is everything the other nine need,
 * and it is not decoration: a Japanese auction has no ranking and a round that
 * somebody has to advance; a Dutch auction has no bids at all until the one
 * that ends it; a sealed bid has submissions the controller is not allowed to
 * see yet, and opening them is an irreversible act.
 *
 * Each panel reads `domain/auctionMechanics`, which is also what the supplier
 * console reads. That is the point: the controller advancing a round and the
 * bidder confirming one are two views of a single rule, and a screen that made
 * its own copy of it would eventually contradict the other side.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Pill } from '../../design-system/components/primitives';
import { Card, Empty, Progress, type Column } from '../../design-system/components/layout';
import { Countdown, ValidationBanner } from '../../design-system/components/domain';
import { PARTICIPATION_STATUS_PRESENTATION } from '../../domain/statusMachine';
import {
  MECHANISM_PROFILE, availableActions, compositeScore, dropOutLadder, dutchClock,
  indexedPrice, japaneseClockPrice, turnOrder, vickreyAward, windowOpenedAt,
  type ActionSpec, type JapaneseState, type SealedState, type TurnState,
} from '../../domain/auctionMechanics';
import { rankLot } from '../../domain/auctionEngine';
import { boolParam, numberParam } from '../../domain/auctionRules';
import { improvementLabel } from '../../domain/comparator';
import { serverNow } from '../../server/clock';
import { MULTI_ATTRIBUTE_SCHEME, SEED_INDEX, COUNTERPARTY_NAMES } from '../../data/seed';
import type { AuctionState } from '../../server/auctionService';
import type { Id, SourcingEvent } from '../../domain/types';

// ---------------------------------------------------------------------------
// Reading the mechanism's live state out of the ledger
// ---------------------------------------------------------------------------

/**
 * A Japanese auction's standing, derived from the bid ledger.
 *
 * In this format a "bid" is a round accepted at the clock price, so the round
 * a bidder last accepted *is* their position, and a bidder whose last
 * acceptance is older than the current round has left. Derived rather than
 * stored: the ledger is the record, and a second copy of who is still in is a
 * second copy that can be wrong.
 */
export function japaneseStateOf(held: AuctionState, auctionLotId: Id): JapaneseState {
  const startingPrice = held.lots.find((l) => l.id === auctionLotId)?.startingPrice ?? 0;
  const onLot = held.bids.filter((b) => b.auctionLotId === auctionLotId && b.isValid);

  // The round is what the controller has advanced it to. Derived from the
  // control log rather than counted from bids, because round three with nobody
  // yet confirmed is a real and important state — it is the window in which a
  // bidder is about to be eliminated.
  const advanced = held.controlEvents.filter((e) => e.kind === 'ROUND_ADVANCED').length;
  const round = advanced + 1;
  const clockPrice = japaneseClockPrice(held.auction, startingPrice, round);
  const previousPrice = round === 1 ? clockPrice : japaneseClockPrice(held.auction, startingPrice, round - 1);

  const accepted = (price: number) =>
    new Set(onLot.filter((b) => Math.round(b.bidValue) === Math.round(price)).map((b) => b.bidderId));
  const confirmedNow = accepted(clockPrice);
  // Round one has no prior window, so everyone invited is still in.
  const carriedIn = round === 1
    ? new Set(held.bidders.map((b) => b.id))
    : accepted(previousPrice);

  const standing = held.bidders.filter((b) => carriedIn.has(b.id)).map((b) => b.id);
  const exited: JapaneseState['exited'] = [];
  for (const bidder of held.bidders) {
    if (carriedIn.has(bidder.id)) continue;
    const mine = onLot.filter((b) => b.bidderId === bidder.id);
    if (mine.length === 0) continue;
    const last = mine.reduce((a, b) => (b.sequenceNumber > a.sequenceNumber ? b : a));
    /**
     * The round they left in is the round whose price they last accepted —
     * worked back from the price, not from where the clock has since got to.
     * Reporting everyone as leaving in the same round would flatten the ladder
     * into a single rung, which is the one thing it exists not to do.
     */
    let leftIn = 1;
    for (let r = round; r >= 1; r -= 1) {
      if (Math.round(japaneseClockPrice(held.auction, startingPrice, r)) === Math.round(last.bidValue)) {
        leftIn = r;
        break;
      }
    }
    exited.push({
      bidderId: bidder.id,
      price: last.bidValue,
      round: leftIn,
      at: last.submittedAt,
    });
  }

  return {
    round,
    clockPrice,
    confirmed: [...confirmedNow],
    standing,
    exited,
    settled: standing.length <= 1,
    winnerId: standing.length === 1 ? standing[0] : null,
  };
}

export function sealedStateOf(held: AuctionState, auctionLotId: Id): SealedState {
  const submitted = held.bids.filter((b) => b.auctionLotId === auctionLotId && b.isValid);
  return {
    submitted: new Set(submitted.map((b) => b.bidderId)).size,
    invited: held.bidders.length,
    revealAt: held.auction.endsAt,
    // The reveal is an act, and the act is recorded in the control log.
    revealed: held.controlEvents.some((e) => e.kind === 'ENVELOPES_OPENED')
      || held.auction.status === 'CLOSED'
      || held.auction.status === 'RESULTS_PUBLISHED',
    submittedBy: [...new Set(submitted.map((b) => b.bidderId))],
  };
}

export function turnStateOf(held: AuctionState, auctionLotId: Id): TurnState {
  const rows = rankLot(held.bids, auctionLotId, held.auction.side, held.auction.antiGaming.tieBidPolicy);
  const order = turnOrder(
    held.bidders.map((b) => ({
      bidderId: b.id,
      transformedValue: rows.find((r) => r.bidderId === b.id)?.transformedValue
        // A bidder with no bid is furthest behind, so they move first.
        ?? (held.auction.side === 'BUY' ? Number.MAX_SAFE_INTEGER : 0),
    })),
    held.auction.side,
  );
  // Turns handed over, in the order the controller handed them.
  const handovers = held.controlEvents.filter(
    (e) => e.kind === 'TURN_CALLED' || e.kind === 'TURN_SKIPPED',
  );
  const position = handovers.length % Math.max(1, order.length);
  const lastCall = handovers[0]?.at ?? serverNow();
  return {
    order,
    activeBidderId: order[position] ?? null,
    turnEndsAt: lastCall + 120_000,
    round: Math.floor(handovers.length / Math.max(1, order.length)) + 1,
    passed: held.controlEvents.filter((e) => e.kind === 'TURN_SKIPPED').map((e) => e.actorId),
  };
}

// ---------------------------------------------------------------------------
// The controller's actions, decided by the mechanism
// ---------------------------------------------------------------------------

export function MechanismControls({
  held, eventId, onAct,
}: {
  held: AuctionState;
  eventId: string;
  onAct: (action: ActionSpec) => void;
}) {
  const lotOpen = held.lots.find((l) => l.status === 'LOT_OPEN');
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  const actions = availableActions(held.auction, {
    hasPendingLot: held.lots.some((l) => l.status === 'LOT_PENDING'),
    revealed: sealedStateOf(held, lotOpen?.id ?? '').revealed,
    clockHeld: held.auction.status === 'PAUSED',
    windowOpen: profile.bidEntry === 'STAY_IN'
      ? japaneseStateOf(held, lotOpen?.id ?? '').confirmed.length
        < japaneseStateOf(held, lotOpen?.id ?? '').standing.length
      : profile.bidEntry === 'TURN_BASED',
  });

  if (actions.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-event={eventId}>
      {actions.map((action) => (
        <Button
          key={action.key}
          variant={action.tone === 'danger' ? 'destructive' : action.tone === 'primary' ? 'primary' : 'secondary'}
          title={action.hint}
          onClick={() => onAct(action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live state panel — one per mechanism family
// ---------------------------------------------------------------------------

export function MechanismState({
  held, event, auctionLotId,
}: {
  held: AuctionState;
  event: SourcingEvent;
  auctionLotId: Id;
}) {
  switch (MECHANISM_PROFILE[held.auction.mechanism].bidEntry) {
    case 'STAY_IN':
      return <JapanesePanel held={held} event={event} auctionLotId={auctionLotId} />;
    case 'ACCEPT_CLOCK':
      return <DutchPanel held={held} event={event} auctionLotId={auctionLotId} />;
    case 'ONE_SHOT':
      return <SealedPanel held={held} event={event} auctionLotId={auctionLotId} />;
    case 'TURN_BASED':
      return <TurnPanel held={held} event={event} auctionLotId={auctionLotId} />;
    case 'MULTI_FIELD':
      return <MultiAttributePanel held={held} event={event} auctionLotId={auctionLotId} />;
    default:
      return held.auction.mechanism === 'INDEX_LINKED'
        ? <IndexPanel held={held} event={event} auctionLotId={auctionLotId} />
        : null;
  }
}

const panelLabel: React.CSSProperties = { fontSize: 11, color: color.textSecondary };
const panelValue: React.CSSProperties = {
  fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
};

interface PanelProps {
  held: AuctionState;
  event: SourcingEvent;
  auctionLotId: Id;
}

const nameOf = (held: AuctionState, bidderId: Id, masked: boolean) => {
  const bidder = held.bidders.find((b) => b.id === bidderId);
  if (!bidder) return 'Unknown';
  return masked ? bidder.maskedLabel : COUNTERPARTY_NAMES[bidder.counterpartyId] ?? bidder.maskedLabel;
};

/** Japanese — the round, who is still in, and the ladder they left behind. */
function JapanesePanel({ held, event, auctionLotId }: PanelProps) {
  const state = japaneseStateOf(held, auctionLotId);
  const ladder = dropOutLadder(state);
  const roundClosesAt =
    windowOpenedAt(held.auction, held.controlEvents, 'ROUND_ADVANCED')
    + numberParam(held.auction, 'japanese.roundSeconds') * 1000;
  const nextPrice = japaneseClockPrice(
    held.auction,
    held.lots.find((l) => l.id === auctionLotId)?.startingPrice ?? 0,
    state.round + 1,
  );

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Card
        title={`Round ${state.round}`}
        hint="A bidder who does not confirm before the round closes is out permanently. There is no ranking in this format — only who is still in."
      >
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {/* The same countdown the bidders are watching, from the same two
              facts: when the round opened, and how long a round runs for. */}
          <Countdown closesAt={roundClosesAt} size={26} label="Round closes in" />
          <div>
            <div style={panelLabel}>Clock price this round</div>
            <div style={{ ...panelValue, color: color.brandPrimary }}>
              {money(state.clockPrice, event.currency)}
            </div>
          </div>
          <div>
            <div style={panelLabel}>Next round would be</div>
            <div style={{ ...panelValue, fontSize: 18, color: color.textSecondary }}>
              {money(nextPrice, event.currency)}
            </div>
          </div>
          <div>
            <div style={panelLabel}>Still in</div>
            <div style={panelValue}>
              {state.standing.length}
              <span style={{ fontSize: 13, fontWeight: 400, color: color.textSecondary }}>
                {' '}of {held.bidders.length}
              </span>
            </div>
          </div>
          <div>
            <div style={panelLabel}>Confirmed this round</div>
            <div style={panelValue}>
              {state.confirmed.length}/{state.standing.length}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Progress
            value={state.standing.length === 0 ? 0 : (state.confirmed.length / state.standing.length) * 100}
            label="Confirmations in"
          />
        </div>

        {state.settled && (
          <div style={{ marginTop: 12 }}>
            <ValidationBanner tone="success" title="One bidder left">
              {state.winnerId ? nameOf(held, state.winnerId, false) : 'Nobody'} is the last standing, at{' '}
              {money(state.clockPrice, event.currency)}. Closing now awards at that price.
            </ValidationBanner>
          </div>
        )}
      </Card>

      <Card padded={false} title="Who is still in" hint="Confirmed, waiting, or gone — the only three states this format has.">
        <div style={{ display: 'grid', gap: 1, background: color.border }}>
          {held.bidders.map((bidder) => {
            const out = state.exited.find((e) => e.bidderId === bidder.id);
            const confirmed = state.confirmed.includes(bidder.id);
            return (
              <div
                key={bidder.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  background: '#fff', padding: '11px 14px',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 180px' }}>
                  {COUNTERPARTY_NAMES[bidder.counterpartyId] ?? bidder.maskedLabel}
                  <span style={{ fontSize: 10.5, color: color.textSecondary, fontWeight: 400 }}>
                    {' '}· {bidder.maskedLabel}
                  </span>
                </span>
                {out ? (
                  <>
                    <Chip tone="danger" icon="✕">left in round {out.round}</Chip>
                    <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                      exited at {money(out.price, event.currency)}
                    </span>
                  </>
                ) : confirmed ? (
                  <Chip tone="info" icon="✓">confirmed round {state.round}</Chip>
                ) : (
                  <Chip tone="gold" icon="◷">waiting on them</Chip>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        padded={false}
        title="Drop-out ladder"
        hint="Every exit price in the order it happened. This is the format's real product — a map of where each supplier's floor actually sits, which no other mechanism gives you."
      >
        {ladder.length === 0 ? (
          <Empty icon="▤" title="Nobody has dropped out yet" hint="The ladder builds as bidders leave." />
        ) : (
          <div style={{ padding: '4px 0' }}>
            {ladder.map((exit) => {
              const opening = held.lots.find((l) => l.id === auctionLotId)?.startingPrice ?? exit.price;
              const depth = opening === 0 ? 0 : (1 - exit.price / opening) * 100;
              return (
                <div
                  key={exit.bidderId}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px' }}
                >
                  <span style={{ fontSize: 11, color: color.textSecondary, width: 18 }}>
                    {exit.position}
                  </span>
                  <span style={{ fontSize: 12.5, width: 170, flexShrink: 0 }}>
                    {nameOf(held, exit.bidderId, false)}
                  </span>
                  <span style={{ flex: 1, minWidth: 80, height: 8, background: color.neutralSoft, borderRadius: 4 }}>
                    <span
                      style={{
                        display: 'block', height: 8, borderRadius: 4,
                        width: `${Math.max(2, Math.min(100, depth * 4))}%`,
                        background: color.accentPurple,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', width: 110, textAlign: 'right' }}>
                    {money(exit.price, event.currency)}
                  </span>
                  <span style={{ fontSize: 11, color: color.textSecondary, width: 70, textAlign: 'right' }}>
                    round {exit.round}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Dutch — one number, moving, and nothing else until somebody takes it. */
function DutchPanel({ held, event, auctionLotId }: PanelProps) {
  const lot = held.lots.find((l) => l.id === auctionLotId);
  const detail = lot ? held.lotDetails[lot.lotId] : undefined;
  const [now, setNow] = React.useState(() => serverNow());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Both of these are the buyer's, set on the Setup pane. They used to be
  // constants here, which meant the two numbers that decide a Dutch auction
  // were the two nobody could change.
  const tickSeconds = numberParam(held.auction, 'dutch.tickSeconds');
  const limitPct = numberParam(held.auction, 'dutch.limitPct');
  const opening = lot?.startingPrice ?? 0;
  const limit = held.auction.side === 'BUY'
    ? detail?.ceilingPrice ?? opening * (1 + limitPct / 100)
    : detail?.floorPrice ?? opening * Math.max(0, 1 - limitPct / 100);
  const clock = dutchClock(held.auction, opening, limit, tickSeconds, now);
  const accepted = held.bids.filter((b) => b.auctionLotId === auctionLotId && b.isValid);

  return (
    <Card
      title="The clock"
      hint={`It moves on its own every ${tickSeconds} seconds. The first acceptance ends the auction for everybody — there is no second place and no ranking to watch.`}
    >
      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={panelLabel}>Price on the clock</div>
          <div style={{ ...panelValue, fontSize: 34, color: color.brandPrimary }}>
            {money(clock.price, event.currency)}
          </div>
        </div>
        <div>
          <div style={panelLabel}>Opened at</div>
          <div style={{ ...panelValue, fontSize: 16 }}>{money(lot?.startingPrice ?? 0, event.currency)}</div>
        </div>
        <div>
          <div style={panelLabel}>{held.auction.side === 'BUY' ? 'Ceiling' : 'Floor'} — it stops here</div>
          <div style={{ ...panelValue, fontSize: 16, color: clock.atLimit ? color.dangerText : color.textPrimary }}>
            {money(limit, event.currency)}
          </div>
        </div>
        <div>
          <div style={panelLabel}>Ticks elapsed</div>
          <div style={{ ...panelValue, fontSize: 16 }}>{clock.tick}</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {accepted.length > 0 ? (
          <ValidationBanner tone="success" title="Accepted — the auction is over">
            {nameOf(held, accepted[0].bidderId, false)} accepted at{' '}
            {money(accepted[0].bidValue, event.currency)}. Nothing further is taken on this lot.
          </ValidationBanner>
        ) : clock.atLimit ? (
          <ValidationBanner tone="error" title="The clock has reached its limit with no acceptance">
            Nobody took the price. This lot ends without a winner unless you restart it at a different
            opening — a Dutch auction cannot be extended past its limit, because the limit is the
            whole commitment.
          </ValidationBanner>
        ) : (
          <ValidationBanner tone="info" title="Nobody has accepted yet">
            In this format silence is the normal state and carries no information. Every bidder is
            watching the same number and waiting for someone else to blink.
          </ValidationBanner>
        )}
      </div>
    </Card>
  );
}

/** Sealed — a count, a clock, and a deliberate irreversible act. */
function SealedPanel({ held, event, auctionLotId }: PanelProps) {
  const state = sealedStateOf(held, auctionLotId);
  const submitted = held.bids.filter((b) => b.auctionLotId === auctionLotId && b.isValid);
  const vickrey = held.auction.mechanism === 'VICKREY' && state.revealed
    ? vickreyAward(
        submitted.map((b) => ({ bidderId: b.bidderId, value: b.transformedValue })),
        held.auction.side,
      )
    : null;

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Card
        title={state.revealed ? 'Envelopes opened' : 'Envelopes sealed'}
        hint={
          state.revealed
            ? 'Opened, logged with the actor and the moment. Nothing here can be unseen.'
            : 'Submissions are in the ledger and nobody can read them — including you. A count is not a disclosure; the values are.'
        }
      >
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
          <div>
            <div style={panelLabel}>Submitted</div>
            <div style={panelValue}>
              {state.submitted}
              <span style={{ fontSize: 13, fontWeight: 400, color: color.textSecondary }}>
                {' '}of {state.invited}
              </span>
            </div>
          </div>
          <div>
            <div style={panelLabel}>Still outstanding</div>
            <div style={panelValue}>{state.invited - state.submitted}</div>
          </div>
          <div>
            <div style={panelLabel}>Reveal</div>
            <div style={{ ...panelValue, fontSize: 16 }}>
              {state.revealAt ? new Date(state.revealAt).toLocaleString() : 'not set'}
            </div>
          </div>
        </div>

        {!state.revealed && (
          <div style={{ marginTop: 12 }}>
            <ValidationBanner tone="info" title="Why there is no ranking on this screen">
              A sealed bid that reports a position is not sealed. The cockpit shows you who has
              submitted so you can chase the ones who have not — and nothing else, because anything
              else would be a number you could act on before the reveal.
            </ValidationBanner>
          </div>
        )}

        {vickrey && (
          <div style={{ marginTop: 12 }}>
            <ValidationBanner tone="warning" title="Second-price award">
              {nameOf(held, vickrey.winnerId, false)} submitted the best bid at{' '}
              {money(vickrey.winningBid, event.currency)} and is awarded at the second-best price,{' '}
              <strong>{money(vickrey.awardPrice, event.currency)}</strong>. Those are different
              numbers and the order must carry the second.
            </ValidationBanner>
          </div>
        )}
      </Card>

      <Card padded={false} title="Who has submitted" hint="A name and a timestamp. No values until the reveal.">
        <div style={{ display: 'grid', gap: 1, background: color.border }}>
          {held.bidders.map((bidder) => {
            const mine = submitted.find((b) => b.bidderId === bidder.id);
            return (
              <div
                key={bidder.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  background: '#fff', padding: '11px 14px',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 180px' }}>
                  {COUNTERPARTY_NAMES[bidder.counterpartyId] ?? bidder.maskedLabel}
                </span>
                {mine ? (
                  <>
                    <Chip tone="info" icon="✓">submitted</Chip>
                    <span style={{ fontSize: 11.5, color: color.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(mine.submittedAt).toLocaleString()}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, width: 120, textAlign: 'right' }}>
                      {state.revealed
                        ? money(mine.bidValue, event.currency)
                        : <span style={{ color: color.textMuted, letterSpacing: 2 }}>sealed</span>}
                    </span>
                  </>
                ) : (
                  <Chip tone="neutral" icon="○">nothing yet</Chip>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Rank compression — whose turn, and what the order is. */
function TurnPanel({ held, event, auctionLotId }: PanelProps) {
  const state = turnStateOf(held, auctionLotId);
  const rows = rankLot(held.bids, auctionLotId, held.auction.side, held.auction.antiGaming.tieBidPolicy);
  const turnEndsAt = windowOpenedAt(held.auction, held.controlEvents, 'TURN_CALLED')
    + numberParam(held.auction, 'turn.turnSeconds') * 1000;

  return (
    <Card
      title={`Round ${state.round} — turn order`}
      hint="Worst position moves first. That is what compresses the field; letting the leader defend a small margin all event does not."
    >
      {state.activeBidderId !== null && (
        <div style={{ marginBottom: 12 }}>
          <Countdown closesAt={turnEndsAt} size={24} label="This turn ends in" />
        </div>
      )}
      <div style={{ display: 'grid', gap: 1, background: color.border, borderRadius: radius.control, overflow: 'hidden' }}>
        {state.order.map((bidderId, i) => {
          const active = bidderId === state.activeBidderId;
          const row = rows.find((r) => r.bidderId === bidderId);
          return (
            <div
              key={bidderId}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                background: active ? color.brandPrimarySoft : '#fff', padding: '11px 14px',
              }}
            >
              <span style={{ fontSize: 11, color: color.textSecondary, width: 18 }}>{i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, flex: '1 1 170px' }}>
                {nameOf(held, bidderId, false)}
              </span>
              {active && <Chip tone="brand" icon="▶">bidding now</Chip>}
              <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', width: 120, textAlign: 'right' }}>
                {row ? money(row.transformedValue, event.currency) : <span style={{ color: color.textMuted }}>no bid</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 10, lineHeight: 1.6 }}>
        A missed turn is this format's main failure. The bidder's console announces the turn loudly
        and a skipped turn is recorded rather than passed over quietly, so the ledger says whether
        somebody chose not to move or never knew they could.
      </div>
    </Card>
  );
}

/** Multi-attribute — the composite, and which attribute earned it. */
function MultiAttributePanel({ held, event, auctionLotId }: PanelProps) {
  const rows = rankLot(held.bids, auctionLotId, held.auction.side, held.auction.antiGaming.tieBidPolicy);

  // Price is real; the other attributes are the offer this prototype seeds
  // alongside it, which is what a live multi-attribute auction would carry on
  // the bid itself.
  const offerFor = (bidderId: Id, price: number) => ({
    price,
    leadTime: 10 + (bidderId.length % 4) * 3,
    warranty: 24 + (bidderId.length % 3) * 6,
    paymentDays: 45 + (bidderId.length % 3) * 15,
  });

  return (
    <Card
      title="Composite standing"
      hint={boolParam(held.auction, 'multiAttribute.publishWeights')
        ? 'Price is one input of four. The weights below are published to bidders before the event — which is what keeps the award defensible.'
        : 'Price is one input of four. These weights are NOT published — bidders are optimising without seeing the trade-off, and an award on them invites a dispute.'}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {MULTI_ATTRIBUTE_SCHEME.map((attribute) => (
          <Chip key={attribute.key} tone="neutral">
            {attribute.label} {attribute.weight}%
          </Chip>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 1, background: color.border, borderRadius: radius.control, overflow: 'hidden' }}>
        {rows.map((row) => {
          const score = compositeScore(offerFor(row.bidderId, row.transformedValue), MULTI_ATTRIBUTE_SCHEME);
          return (
            <div key={row.bidderId} style={{ background: '#fff', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 170px' }}>
                  {nameOf(held, row.bidderId, false)}
                </span>
                <span style={{ fontSize: 12.5, color: color.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {money(row.transformedValue, event.currency)}
                </span>
                <span style={{ fontSize: 17, fontWeight: 700, color: color.brandPrimary, fontVariantNumeric: 'tabular-nums' }}>
                  {score.total.toFixed(1)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                {score.contributions.map((c) => (
                  <span key={c.key} style={{ fontSize: 10.5, color: color.textSecondary }}>
                    {c.label} {c.score.toFixed(0)}/100 → {c.contribution.toFixed(1)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 10 }}>
        A bidder can beat a cheaper rival by shortening lead time. The console shows them the same
        arithmetic live as they type, so the trade-off is visible rather than guessed at.
      </div>
    </Card>
  );
}

/** Index-linked — the premium, the index, and the money it comes to. */
function IndexPanel({ held, event, auctionLotId }: PanelProps) {
  const rows = rankLot(held.bids, auctionLotId, held.auction.side, held.auction.antiGaming.tieBidPolicy);
  return (
    <Card
      title="Against the index"
      hint="Bidders quote a premium or discount, not a price. The absolute figure is computed here so nobody bids on arithmetic they cannot check."
    >
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={panelLabel}>{SEED_INDEX.name}</div>
          <div style={{ ...panelValue, fontSize: 20 }}>{money(SEED_INDEX.value, event.currency)}</div>
        </div>
        <div>
          <div style={panelLabel}>Source</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>{SEED_INDEX.source}</div>
        </div>
        <div>
          <div style={panelLabel}>As of</div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>{new Date(SEED_INDEX.asOf).toLocaleString()}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 1, background: color.border, borderRadius: radius.control, overflow: 'hidden' }}>
        {rows.map((row) => {
          const offset = ((row.transformedValue - SEED_INDEX.value) / SEED_INDEX.value) * 100;
          return (
            <div key={row.bidderId} style={{ display: 'flex', gap: 12, background: '#fff', padding: '11px 14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: '1 1 170px' }}>
                {nameOf(held, row.bidderId, false)}
              </span>
              <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                {offset >= 0 ? '+' : ''}{offset.toFixed(2)}%
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                = {money(indexedPrice(SEED_INDEX, offset), event.currency)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The ranking table, where the mechanism has one
// ---------------------------------------------------------------------------

/**
 * Whether the standing table should be shown at all, and what to say instead.
 *
 * Four of the ten mechanisms have no ranking while they run. Showing an empty
 * table for those reads as "nobody has bid"; saying so plainly reads as what it
 * is — the format does not produce that information.
 */
export function rankingNotice(held: AuctionState): string | null {
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  if (profile.liveRanking) return null;
  switch (profile.bidEntry) {
    case 'STAY_IN':
      return 'A Japanese auction has no ranking. Everyone still in is at the same price — the clock price — and the only question is who is left.';
    case 'ACCEPT_CLOCK':
      return 'A Dutch auction has no ranking. There is one price, and the first acceptance ends it.';
    case 'ONE_SHOT':
      return 'A sealed bid has no ranking until the envelopes are opened. That is the format.';
    default:
      return 'This mechanism produces no standing while it runs.';
  }
}

/** Bidder rows, with the columns this mechanism can actually fill. */
export function mechanismColumns<
  T extends {
    rank: number; bidderId: Id; displayName: string; maskedLabel: string;
    bidValue: number; transformedValue: number; bidCount: number;
    lastBidAt: number | null; movement: number;
    participationStatus: keyof typeof PARTICIPATION_STATUS_PRESENTATION;
  },
>(held: AuctionState, event: SourcingEvent, observer: boolean): Column<T>[] {
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  const columns: Column<T>[] = [
    {
      key: 'name', header: observer ? 'Bidder (masked)' : 'Bidder',
      render: (row) => (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: row.rank === 1 && row.bidCount > 0 ? 700 : 500 }}>
            {row.displayName}
          </div>
          {!observer && <div style={{ fontSize: 10.5, color: color.textSecondary }}>{row.maskedLabel}</div>}
        </div>
      ),
    },
  ];

  if (profile.liveRanking) {
    columns.unshift({
      key: 'rank', header: '#', width: '48px',
      render: (row) =>
        row.bidCount === 0 ? <span style={{ color: color.textMuted }}>—</span> : (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%',
              background: row.rank === 1 ? color.successSoft : color.neutralSoft,
              color: row.rank === 1 ? color.successText : color.textSecondary,
              fontSize: 11, fontWeight: 700,
            }}
          >
            {row.rank}
          </span>
        ),
    });
  }

  // A Japanese "bid" is a round accepted; calling the column "bid as placed"
  // would describe an act the bidder never performed.
  columns.push({
    key: 'bid',
    header: profile.bidEntry === 'STAY_IN' ? 'Accepted at'
      : profile.bidEntry === 'ONE_SHOT' ? 'Submission'
      : 'Bid as placed',
    numeric: true,
    render: (row) => {
      if (row.bidCount === 0) return <span style={{ color: color.textMuted }}>no bid</span>;
      if (profile.bidEntry === 'ONE_SHOT' && !sealedStateOf(held, '').revealed) {
        return <span style={{ color: color.textMuted, letterSpacing: 2 }}>sealed</span>;
      }
      return money(row.bidValue, event.currency);
    },
  });

  if (held.auction.transformation !== 'NONE') {
    columns.push({
      key: 'transformed', header: 'Transformed', numeric: true,
      render: (row) =>
        row.bidCount === 0
          ? <span style={{ color: color.textMuted }}>—</span>
          : <strong>{money(row.transformedValue, event.currency)}</strong>,
    });
  }

  if (profile.bidEntry === 'FREE_FORM' || profile.bidEntry === 'TURN_BASED' || profile.bidEntry === 'MULTI_FIELD') {
    columns.push({
      key: 'movement', header: 'Last move', numeric: true,
      render: (row) =>
        row.movement === 0
          ? <span style={{ color: color.textMuted }}>—</span>
          : (
            <span style={{ color: row.movement > 0 ? color.successText : color.dangerText }}>
              {money(row.movement, event.currency)}
            </span>
          ),
    });
  }

  columns.push({
    key: 'bids',
    header: profile.bidEntry === 'STAY_IN' ? 'Rounds' : profile.bidEntry === 'ONE_SHOT' ? 'Submitted' : 'Bids',
    numeric: true,
    render: (row) => (profile.bidEntry === 'ONE_SHOT' ? (row.bidCount > 0 ? '✓' : '—') : row.bidCount || '—'),
  });

  columns.push({
    key: 'last', header: 'Last seen', width: '110px',
    render: (row) =>
      row.lastBidAt === null
        ? <span style={{ fontSize: 11, color: color.textMuted }}>—</span>
        : (
          <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(row.lastBidAt).toLocaleTimeString()}
          </span>
        ),
  });

  columns.push({
    key: 'status', header: 'Status',
    render: (row) => <Pill presentation={PARTICIPATION_STATUS_PRESENTATION[row.participationStatus]} size="small" />,
  });

  return columns;
}

/** What the controller should understand about this mechanism, in three lines. */
export function MechanismBriefing({ held }: { held: AuctionState }) {
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  return (
    <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
      <strong style={{ color: color.textPrimary }}>{profile.label}</strong>
      {' · '}
      {profile.clockOwner === 'SYSTEM' ? 'system clock' : 'bidders move the price'}
      {' · '}
      {profile.liveRanking ? 'live ranking' : 'no ranking until it ends'}
      {profile.elimination ? ' · bidders can be eliminated' : ''}
      {' · improvement is '}
      {improvementLabel(held.auction.side)}
    </div>
  );
}
