/**
 * Pack 19 — supplier live bidding console.
 *
 * This screen is built *from* Pack 18's visibility manifest, and it can only
 * render what `bidderView` returns. Everything the feedback policy forbids is
 * absent from that payload, so there is no field here that could accidentally
 * display a competitor's price — the code has nothing to display.
 *
 * Designed for a supplier who may be on a phone, on poor connectivity, using
 * the system for the first time.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import { Button, Chip, Field, NumberInput, Toggle } from '../design-system/components/primitives';
import { Countdown, Modal, TrafficLight, ValidationBanner } from '../design-system/components/domain';
import { bidderView, type AuctionState } from '../server/auctionService';
import type { AuctionLot, Bid, Lot } from '../domain/types';
import { VISIBILITY_MANIFEST } from '../domain/feedbackPolicy';
import {
  MECHANISM_PROFILE, bidderRules, biddingOpen, latestControlEvent,
} from '../domain/auctionMechanics';
import { rehearsalBriefing, rehearsalOpen } from '../domain/auctionRehearsal';
import { activityFeed, progressForBidder } from '../domain/auctionProgress';
import {
  ActivityFeed, PriceChart, Stat,
} from '../design-system/components/auctionProgress';
import { BidControl, MechanismCaption, MechanismFacts } from './BiddingModes';
import { auctionsForBidder, useStore } from '../store/store';
import { COUNTERPARTY_NAMES, PORTAL_BIDDER_ID, PORTAL_COUNTERPARTY_ID } from '../data/seed';
import { PortalCard } from './PortalShell';

export function BiddingConsole({
  counterpartyId, eventId,
}: { counterpartyId?: string; eventId?: string } = {}) {
  const { state, dispatch } = useStore();
  /**
   * The auction this supplier is actually in.
   *
   * The tenant runs several at once on different mechanisms, so "the auction"
   * is not a thing the console can assume — and landing a Japanese bidder in an
   * English console is exactly the failure this screen exists to avoid.
   */
  const me = counterpartyId ?? PORTAL_COUNTERPARTY_ID;
  const mine = auctionsForBidder(state, me);
  const [chosenEventId, setChosenEventId] = React.useState<string | null>(eventId ?? null);
  const wanted = chosenEventId ?? eventId;
  const matched = mine.find((h) => h.auction.eventId === wanted) ?? null;
  /**
   * A named room is that room or none.
   *
   * Falling back to `mine[0]` when the named auction is not one of theirs put
   * a supplier who followed a link to auction X inside auction Y — with a
   * live bid box, on a lot they were never invited to price. Falling back is
   * only right when no room was named at all.
   */
  const held = wanted ? matched : mine[0] ?? null;
  const auction = held?.auction;
  const [chosenLotId, setChosenLotId] = React.useState<string | null>(null);
  const lotId = chosenLotId
    ?? held?.lots.find((l) => l.status === 'LOT_OPEN')?.id
    ?? held?.lots[0]?.id
    ?? '';
  const setLotId = setChosenLotId;
  const [bidValue, setBidValue] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);
  const [proxyCeiling, setProxyCeiling] = React.useState('');
  const [proxyStep, setProxyStep] = React.useState('500');
  const [mobile, setMobile] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // The bidder record this supplier holds in *this* auction.
  const myBidderId = held?.bidders.find(
    (b) => b.counterpartyId === me,
  )?.id ?? PORTAL_BIDDER_ID;

  // The only source of competitive information on this screen.
  const view = held === null
    ? null
    : bidderView(held, lotId, myBidderId, COUNTERPARTY_NAMES);
  const manifest = auction ? VISIBILITY_MANIFEST[auction.feedbackPolicy] : null;

  const lot = held?.lots.find((l) => l.id === lotId);
  const lotDetail = lot ? held?.lotDetails[lot.lotId] : undefined;
  const lotName = lotDetail?.name ?? '';
  const live = auction?.status === 'LIVE' || auction?.status === 'EXTENDED';
  const paused = auction?.status === 'PAUSED';
  const closed = auction?.status === 'CLOSED' || auction?.status === 'ABORTED';

  const currency = state.events.find((e) => e.id === auction?.eventId)?.currency ?? 'INR';

  /**
   * Whether the buyer has the practice run open.
   *
   * Read from the control log rather than a flag, so it is the same fact the
   * controller's screen is showing. It closes itself once bidding starts —
   * there is nothing to rehearse in a room that is already running.
   */
  const practising = held !== null && !live && !closed && rehearsalOpen(held.controlEvents);

  /** The most recent change to what bidders may see, if there has been one. */
  const feedbackChange = held === null
    ? null
    : latestControlEvent(held.controlEvents, ['FEEDBACK_CHANGED']);

  const result = state.lastBidResult;
  const myResult = result && result.bidderId === myBidderId ? result : null;

  const place = (value: number, confirmed = false) => {
    if (!held) return;
    dispatch({
      type: 'SUBMIT_BID',
      eventId: held.auction.eventId,
      auctionLotId: lotId,
      bidderId: myBidderId,
      bidValue: value,
      userId: `portal-${myBidderId}`,
      source: 'PORTAL',
      confirmed,
    });
  };

  /**
   * A practice bid.
   *
   * The same control, the same validator, the same rejection wording — the
   * only difference is which ledger it lands in. A practice path with gentler
   * rules would teach the supplier that a bid will be accepted when it will
   * not, which is worse than no practice at all.
   */
  const rehearse = (value: number, confirmed = false) => {
    if (!held) return;
    dispatch({
      type: 'REHEARSE_BID',
      eventId: held.auction.eventId,
      auctionLotId: lotId,
      bidderId: myBidderId,
      bidValue: value,
      userId: `portal-${myBidderId}`,
      confirmed,
    });
  };

  /** Why the control is closed, in the supplier's words. */
  const gate = state.connectionLost
    ? 'You are offline. Nothing you send now will reach us — a bid placed offline is not a bid.'
    : auction
      ? biddingOpen(auction.status).reason
      : null;

  React.useEffect(() => {
    if (myResult?.requiresConfirmation) setConfirmOpen(true);
    if (myResult?.accepted) setBidValue('');
  }, [myResult]);

  if (held === null || auction === undefined || view === null || manifest === null) {
    return (
      <PortalCard title="No auction is open for you">
        <div style={{ fontSize: 14.5, color: color.textSecondary, lineHeight: 1.7 }}>
          You have not been invited to a live auction. When a buyer schedules one you will get an
          invitation, a practice run to try it out, and this room will open before it starts.
        </div>
      </PortalCard>
    );
  }

  return (
    <div className="rfx-stack" style={{ gap: 18, maxWidth: mobile ? 390 : undefined, marginInline: mobile ? 'auto' : undefined }}>
      {/* Live banner — dark, unmistakable, with the clock. */}
      <div
        style={{
          background: closed ? '#1F2937' : paused ? '#78350F' : '#450A0A',
          color: '#fff', borderRadius: 10, padding: '18px 20px',
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: closed ? '#9CA3AF' : paused ? '#FBBF24' : live ? '#EF4444' : '#818CF8',
            animation: live ? 'rfx-pulse 1.2s infinite' : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>
              {/* A room that has not opened must not announce that it has.
                  Rooms are now reachable before they start — that is where the
                  practice run lives — so "bidding is open" has to be earned. */}
              {closed ? 'BIDDING CLOSED'
                : paused ? 'BIDDING PAUSED'
                  : live ? 'BIDDING IS OPEN'
                    : practising ? 'PRACTICE RUN — BIDDING HAS NOT STARTED'
                      : 'BIDDING HAS NOT STARTED'}
            </div>
            {/* The reference. A supplier ringing about "the packaging one"
                gets nowhere; this is the string both sides can quote, and it
                is the auction's own rather than the ask that carries it. */}
            <span
              title="Auction reference — quote this in any correspondence"
              style={{
                fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em',
                padding: '2px 8px', borderRadius: 999,
                background: 'rgba(255,255,255,.16)', fontVariantNumeric: 'tabular-nums',
              }}
            >
              {auction.auctionNumber}
            </span>
          </div>
          <div style={{ fontSize: 14, marginTop: 4, opacity: 0.85 }}>
            {/* Plain language, generated from this auction's own rules — the
                supplier is never shown a caption for a different format. */}
            <MechanismCaption held={held} />
          </div>
          <div style={{ marginTop: 8 }}>
            <MechanismFacts held={held} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {live || paused || closed
            ? <Countdown closesAt={view.closesAt} size={mobile ? 26 : 30} label="Time left" paused={paused} />
            : (
              <Countdown
                closesAt={auction.startsAt}
                size={mobile ? 26 : 30}
                label="Starts in"
                paused={false}
              />
            )}
        </div>
        <Button variant="secondary" size="small" onClick={() => setHelpOpen(true)}>How this works</Button>
      </div>

      {paused && (
        <ValidationBanner tone="warning" title="The buyer has paused the auction">
          Nothing you submit will be accepted until it resumes. Your position is safe — the clock is
          stopped for everyone.
        </ValidationBanner>
      )}

      {state.connectionLost && (
        <ValidationBanner tone="error" title="You are offline">
          A bid placed while offline is not a bid. We will reconcile your position the moment you
          reconnect — nothing you already placed is lost.
        </ValidationBanner>
      )}

      {auction.extensionsUsed > 0 && live && (
        <ValidationBanner tone="info" title={`The clock was extended by ${auction.antiGaming.softCloseExtensionSec / 60} minutes`}>
          Someone bid in the final moments, so everyone gets more time. This can happen again.
        </ValidationBanner>
      )}

      {/* The buyer changed what this supplier can see, while they were
          bidding. Announced rather than left to be noticed: the panel beside
          it simply starts showing more, or less, and a supplier who works out
          for themselves that the rules moved has been treated badly. */}
      {feedbackChange && (
        <ValidationBanner tone="warning" title="The buyer changed what you can see">
          You are now shown <strong>{manifest.label.toLowerCase()}</strong>.{' '}
          {feedbackChange.reason} Changed at{' '}
          {new Date(feedbackChange.at).toLocaleTimeString()}.
        </ValidationBanner>
      )}

      {myResult && !myResult.requiresConfirmation && (
        <ValidationBanner
          tone={myResult.accepted ? 'success' : 'error'}
          title={myResult.accepted ? 'Your bid was accepted' : 'Your bid was not accepted'}
          action={<Button size="small" variant="secondary" onClick={() => dispatch({ type: 'CLEAR_BID_RESULT' })}>Dismiss</Button>}
        >
          {myResult.message ?? 'It is now in the ledger with a server timestamp.'}
        </ValidationBanner>
      )}

      {mine.length > 1 && (
        <PortalCard
          title={`You are in ${mine.length} auctions`}
          hint="They run on different rules. This room is showing one of them — switch with the buttons below."
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {mine.map((other) => {
              const otherEvent = state.events.find((e) => e.id === other.auction.eventId);
              const active = other.auction.eventId === held.auction.eventId;
              const reference = other.auction.auctionNumber;
              return (
                <button
                  key={other.auction.id}
                  type="button"
                  onClick={() => { setChosenEventId(other.auction.eventId); setChosenLotId(null); }}
                  style={{
                    border: `1px solid ${active ? color.brandPrimary : color.border}`,
                    background: active ? color.brandPrimarySoft : '#fff',
                    color: active ? color.brandPrimary : color.textBody,
                    borderRadius: radius.card, padding: '11px 15px', cursor: 'pointer',
                    textAlign: 'left', minWidth: 200,
                  }}
                >
                  <div style={{ fontSize: 14.5, fontWeight: active ? 700 : 500 }}>
                    {otherEvent?.title ?? other.auction.eventId}
                  </div>
                  <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 3 }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {reference}
                    </span>
                    {' · '}
                    {MECHANISM_PROFILE[other.auction.mechanism].label}
                    {' · '}
                    {other.auction.status === 'LIVE' || other.auction.status === 'EXTENDED'
                      ? 'open now'
                      : other.auction.status.toLowerCase().replace('_', ' ')}
                  </div>
                </button>
              );
            })}
          </div>
        </PortalCard>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {held.lots.map((auctionLot) => {
          const detail = held.lotDetails[auctionLot.lotId];
          const open = auctionLot.status === 'LOT_OPEN';
          return (
            <button
              key={auctionLot.id}
              type="button"
              onClick={() => setLotId(auctionLot.id)}
              style={{
                border: `1px solid ${auctionLot.id === lotId ? color.brandPrimary : color.border}`,
                background: auctionLot.id === lotId ? color.brandPrimarySoft : '#fff',
                color: auctionLot.id === lotId ? color.brandPrimary : color.textBody,
                borderRadius: radius.pill, padding: '8px 16px', cursor: 'pointer',
                fontSize: 14, fontWeight: auctionLot.id === lotId ? 600 : 400,
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              {detail?.name ?? auctionLot.lotId}
              {open ? <Chip tone="danger" icon="●">open</Chip> : <Chip tone="neutral">not yet open</Chip>}
            </button>
          );
        })}
        <Toggle checked={mobile} onChange={setMobile} label="Phone width" />
      </div>

      <div className={mobile ? 'rfx-stack' : 'rfx-side'} style={{ gap: 16 }}>
        <div className="rfx-stack" style={{ gap: 16 }}>
          {/* The practice run, while the buyer has it open and the room is
              not yet live. It replaces nothing: it sits above the real
              controls so what is practice and what is not is never in doubt. */}
          {practising && lot && (
            <RehearsalPanel
              held={held}
              lot={lot}
              lotDetail={lotDetail}
              bidderId={myBidderId}
              currency={currency}
              practiceBids={state.practiceBids.filter(
                (b) => b.auctionLotId === lotId && b.bidderId === myBidderId,
              )}
              rehearse={rehearse}
            />
          )}

          {/* ============ Position panel — manifest-driven ============ */}
          <PortalCard title="Where you stand" hint={`The buyer has chosen to show you: ${manifest.label.toLowerCase()}.`}>
            <PositionPanel view={view} amberBandPct={auction.trafficAmberBandPct} />
          </PortalCard>

          {/* ============ Bid entry — chosen by the mechanism ============ */}
          {lot?.status !== 'LOT_OPEN' ? (
            <PortalCard title={`Bidding on ${lotName}`}>
              <div style={{ fontSize: 14.5, color: color.textSecondary }}>
                This lot is not open yet. It opens{' '}
                {lot?.opensAt ? new Date(lot.opensAt).toLocaleTimeString() : 'shortly'} — we will
                alert you, so you do not have to watch this page.
              </div>
            </PortalCard>
          ) : (
            <BidControl
              held={held}
              view={view}
              lot={lot}
              lotDetail={lotDetail}
              bidderId={myBidderId}
              currency={currency}
              place={place}
              enabled={live === true && gate === null}
              disabledReason={gate}
            />
          )}

          {auction.proxyBidding && MECHANISM_PROFILE[auction.mechanism].proxySupported
            && lot?.status === 'LOT_OPEN' && (
            <PortalCard
              title="Let us bid for you"
              hint="Set the best price you are willing to reach. We bid in the smallest steps needed to hold your position, and stop at your limit."
            >
              <Button variant="secondary" onClick={() => setProxyOpen(true)}>
                Set up automatic bidding
              </Button>
            </PortalCard>
          )}

          <PortalCard title="The rules of this auction" hint="Generated from how the buyer configured it — the same words their own screen shows.">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.8 }}>
              {bidderRules(auction).map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </PortalCard>
        </div>

        <div className="rfx-stack" style={{ gap: 16 }}>
          {/* The auction over time, cut to what this policy permits. Absent
              before the room opens — there is nothing to plot yet. */}
          {(live || paused || closed) && (
            <BidderProgressPanel
              held={held}
              lotId={lotId}
              bidderId={myBidderId}
              currency={currency}
            />
          )}

          {/* Your own bids — always permitted, whatever the policy. */}
          <PortalCard title="Your bids">
            {view.myBidHistory.length === 0 ? (
              <div style={{ fontSize: 14, color: color.textSecondary }}>
                You have not bid on this lot yet.
              </div>
            ) : (
              <div className="rfx-stack" style={{ gap: 10 }}>
                {view.myBidHistory.map((bid, i) => (
                  <div
                    key={`${bid.at}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, paddingBottom: 9,
                      borderBottom: i === view.myBidHistory.length - 1 ? 'none' : `1px solid ${color.border}`,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: i === 0 ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>
                      {money(bid.value)}
                    </span>
                    <span style={{ fontSize: 12.5, color: color.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(bid.at).toLocaleTimeString()}
                    </span>
                    {i === 0 && <Chip tone="brand">latest</Chip>}
                  </div>
                ))}
              </div>
            )}
          </PortalCard>

          <PortalCard title="What the buyer shows you">
            <div className="rfx-stack" style={{ gap: 8, fontSize: 13.5 }}>
              {[
                ['Your rank', manifest.ownRank],
                ['The leading price', manifest.bestPrice],
                ['Every bid in the room', manifest.allBids],
                ['Who your competitors are', manifest.competitorIdentity],
                ['How far behind you are', manifest.gapPct],
                ['Colour against their target', manifest.trafficLight],
                ['How many are bidding', manifest.participantCount],
              ].map(([label, permitted]) => (
                <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ color: color.textSecondary }}>{label}</span>
                  <span style={{ color: permitted ? color.successText : color.textMuted, fontWeight: 600 }}>
                    {permitted ? 'Shown' : 'Not shown'}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 12, lineHeight: 1.65 }}>
              Anything marked "not shown" is not sent to your browser at all — it is not hidden from you
              on this page, it never arrives.
            </div>
          </PortalCard>

          <PortalCard title="Connection">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                aria-hidden
                style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: state.connectionLost ? '#EF4444' : '#22C55E',
                  animation: state.connectionLost ? 'rfx-pulse 1s infinite' : undefined,
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {state.connectionLost ? 'Offline' : 'Connected'}
              </span>
              <Button size="small" variant="secondary" onClick={() => dispatch({ type: 'TOGGLE_CONNECTION' })}>
                {state.connectionLost ? 'Reconnect' : 'Simulate loss'}
              </Button>
            </div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 10, lineHeight: 1.65 }}>
              The clock you see is corrected against our server continuously, so it always shows the real
              time remaining — not your device's idea of it.
            </div>
          </PortalCard>
        </div>
      </div>

      {/* Typed confirmation for a large improvement — fat-finger protection. */}
      <Modal
        open={confirmOpen}
        title="That is a big move — confirm it"
        onClose={() => { setConfirmOpen(false); dispatch({ type: 'CLEAR_BID_RESULT' }); }}
        onConfirm={() => { place(Number(bidValue) || 0, true); setConfirmOpen(false); }}
        confirmLabel="Yes, place this bid"
      >
        <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.7 }}>
          {myResult?.message}
        </p>
        <div
          style={{
            background: color.warningSoft, borderRadius: radius.card,
            padding: '14px 16px', fontSize: 14, lineHeight: 1.7,
          }}
        >
          Bidding <strong>{money(Number(bidValue) || 0)}</strong> is a large improvement on your
          current position. A bid cannot be withdrawn once placed — check the figure.
        </div>
      </Modal>

      <Modal
        open={proxyOpen}
        title="Set up automatic bidding"
        onClose={() => setProxyOpen(false)}
        onConfirm={() => setProxyOpen(false)}
        confirmLabel="Turn on automatic bidding"
        confirmDisabled={!proxyCeiling}
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7 }}>
            We will bid for you whenever you lose the lead, improving by your chosen step — and we will
            never go past your limit.
          </p>
          <Field
            label="Your limit — we will never bid past this"
            hint="Required. Automatic bidding cannot be set up without a limit."
          >
            <NumberInput
              value={proxyCeiling}
              onChange={(e) => setProxyCeiling(e.target.value)}
              style={{ fontSize: 17, padding: '11px 12px' }}
            />
          </Field>
          <Field label="Step size">
            <NumberInput value={proxyStep} onChange={(e) => setProxyStep(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal open={helpOpen} title="How this auction works" onClose={() => setHelpOpen(false)} width={560}>
        <div className="rfx-stack" style={{ gap: 12, fontSize: 14.5, lineHeight: 1.75 }}>
          <p style={{ margin: 0 }}>
            <strong>Placing a bid.</strong> Type a figure and press Place bid. Every bid must improve on
            the current leading position by at least {auction.antiGaming.minDecrement}
            {auction.antiGaming.minDecrementType === 'PCT' ? '%' : ''}.
          </p>
          <p style={{ margin: 0 }}>
            <strong>You cannot take a bid back.</strong> Once placed, a bid stands. If you already hold
            the lead, you cannot bid against yourself.
          </p>
          <p style={{ margin: 0 }}>
            <strong>The clock can extend.</strong> If anyone bids in the last{' '}
            {auction.antiGaming.softCloseTriggerSec / 60} minutes, everyone gets another{' '}
            {auction.antiGaming.softCloseExtensionSec / 60} minutes. Nobody can win by bidding at the
            last second.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Timing is ours, not your device's.</strong> The clock is checked against our server
            constantly, so what you see is the real time left.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Winning the auction is not the award.</strong> The buyer decides the award separately,
            and it goes through their own approvals.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Renders only the fields present on the projection. Each branch is guarded by
 * the value actually being there, so a policy change cannot leak a number
 * through a stale render path.
 */
/**
 * The practice room.
 *
 * A supplier invited to their first Japanese auction currently learns the
 * format while real money is on the clock. Here they learn it against the
 * same configuration, the same minimum improvement and the same bounds, with
 * the one difference that nothing counts.
 *
 * It deliberately uses `BidControl` — the very control they will use for
 * real — rather than a simplified stand-in. The point is not to explain the
 * mechanism, it is to have already used it.
 */
function RehearsalPanel({
  held, lot, lotDetail, bidderId, currency, practiceBids, rehearse,
}: {
  held: AuctionState;
  lot: AuctionLot;
  lotDetail: Lot | undefined;
  bidderId: string;
  currency: string;
  practiceBids: Bid[];
  rehearse: (value: number, confirmed?: boolean) => void;
}) {
  const briefing = rehearsalBriefing(held.auction);
  const accepted = practiceBids.filter((bid) => bid.isValid);

  /**
   * The rehearsal presents the auction as running, because that is the state
   * the controls belong to. Only `status` moves — every bound the supplier is
   * about to meet is the real one.
   */
  const asIfLive: AuctionState = {
    ...held,
    auction: { ...held.auction, status: 'LIVE' },
    lots: held.lots.map((l) => (l.id === lot.id ? { ...l, status: 'LOT_OPEN' as const } : l)),
    bids: practiceBids,
  };
  const practiceView = bidderView(asIfLive, lot.id, bidderId, COUNTERPARTY_NAMES);

  return (
    <div
      style={{
        border: `2px dashed ${color.accentPurple}`,
        borderRadius: 12,
        padding: 2,
        background: color.accentPurpleSoft,
      }}
    >
      <PortalCard
        title={briefing.headline}
        hint="A practice run. Nothing here counts, and nothing here is seen by the buyer."
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          <div
            style={{
              fontSize: 13.5, lineHeight: 1.7, padding: '10px 12px',
              background: color.surface, borderRadius: radius.control,
            }}
          >
            {briefing.assurance}
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Try this</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.8 }}>
              {briefing.tryThis.map((item) => <li key={item}>{item}</li>)}
            </ol>
          </div>

          <BidControl
            held={asIfLive}
            view={practiceView}
            lot={{ ...lot, status: 'LOT_OPEN' }}
            lotDetail={lotDetail}
            bidderId={bidderId}
            currency={currency}
            place={rehearse}
            enabled
            disabledReason={null}
          />

          <div style={{ fontSize: 13, color: color.textSecondary }}>
            {practiceBids.length === 0
              ? 'You have not tried anything yet.'
              : `${practiceBids.length} practice ${practiceBids.length === 1 ? 'attempt' : 'attempts'}, `
                + `${accepted.length} accepted. All of it is discarded when bidding opens.`}
          </div>

          {practiceBids.length > 0 && (
            <div className="rfx-stack" style={{ gap: 4 }}>
              {[...practiceBids].reverse().slice(0, 6).map((bid) => (
                <div
                  key={bid.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13,
                    color: bid.isValid ? color.textPrimary : color.dangerText,
                  }}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 96 }}>
                    {money(bid.bidValue, currency)}
                  </span>
                  <span style={{ flex: 1 }}>
                    {bid.isValid ? 'accepted' : bid.rejectionReason ?? 'not accepted'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PortalCard>
    </div>
  );
}

/**
 * The auction over time, as this supplier is permitted to see it.
 *
 * Every line here comes from `progressForBidder`, which builds by whitelist
 * from the same visibility manifest the bid payload uses. A line the policy
 * does not grant is not passed to the chart at all, so there is nothing here
 * that could leak by being rendered — under BLIND the supplier sees their own
 * history and nothing else, which is exactly right.
 */
function BidderProgressPanel({
  held, lotId, bidderId, currency,
}: { held: AuctionState; lotId: string; bidderId: string; currency: string }) {
  const auction = held.auction;
  const lot = held.lots.find((l) => l.id === lotId);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const progress = progressForBidder(
    auction, bidderId, lotId, held.bids, held.controlEvents,
    lot?.startingPrice ?? 0,
    lot ? held.lotDetails[lot.lotId]?.targetPrice ?? null : null,
    now,
  );
  const feed = activityFeed({
    auction,
    bids: held.bids,
    controlEvents: held.controlEvents,
    auctionLotId: lotId,
    nameOf: (id) => {
      const bidder = held.bidders.find((b) => b.id === id);
      return bidder ? COUNTERPARTY_NAMES[bidder.counterpartyId] : id;
    },
    audience: 'BIDDER',
    bidderId,
  });

  const times = [
    ...progress.mine.map((point) => point.at),
    ...(progress.lead ?? []).map((point) => point.at),
  ];
  const from = times.length > 0 ? Math.min(...times) : auction.startsAt ?? now - 60_000;
  const to = Math.max(now, ...times, from + 60_000);

  const lines = [
    {
      label: 'Your bids',
      stroke: color.brandPrimary,
      points: progress.mine.map((point) => ({ at: point.at, value: point.value })),
    },
    // Present only when the policy grants a competitor's number.
    ...(progress.lead
      ? [{
        label: 'Leading bid',
        stroke: color.accentPurple,
        dashed: true,
        dots: false,
        points: progress.lead.map((point) => ({ at: point.at, value: point.value })),
      }]
      : []),
  ];

  const rank = progress.rankOverTime?.[progress.rankOverTime.length - 1]?.rank ?? null;

  return (
    <PortalCard
      title="How it is going"
      hint={`The buyer shows you: ${progress.policyLabel.toLowerCase()}.`}
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Stat label="Your bids" value={String(progress.mine.length)} />
          {rank !== null && <Stat label="Your rank" value={`#${rank}`} tone={rank === 1 ? 'good' : 'plain'} />}
          {progress.fieldSize !== null && (
            <Stat label="Bidders in" value={String(progress.fieldSize)} hint="have bid" />
          )}
        </div>

        <PriceChart
          side={auction.side}
          startingPrice={progress.startingPrice}
          from={from}
          to={to}
          format={(value) => money(value, currency, { compact: true })}
          markers={progress.markers.map((marker) => ({ at: marker.at, label: marker.label }))}
          lines={lines}
          emptyNote="Your bids will appear here as you place them."
        />

        {progress.bandOverTime !== null && progress.bandOverTime.length > 0 && (
          <div style={{ fontSize: 13, color: color.textSecondary }}>
            Your colour against the buyer’s target, most recent last:{' '}
            {progress.bandOverTime.map((point) => point.band.toLowerCase()).join(' → ')}.
          </div>
        )}

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>What has happened</div>
          <ActivityFeed
            rows={feed}
            emptyNote="Nothing yet."
            height={200}
          />
        </div>
      </div>
    </PortalCard>
  );
}

function PositionPanel({
  view, amberBandPct,
}: { view: ReturnType<typeof bidderView>; amberBandPct: number }) {
  const p = view.projection;

  const nothingShown =
    p.ownRank === undefined && p.bestPrice === undefined &&
    p.gapPctBehind === undefined && p.allBids === undefined && p.trafficBand === undefined;

  if (nothingShown) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div aria-hidden style={{ fontSize: 30 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>
          {view.myBestBid === null ? 'You have not bid yet' : `Your bid: ${money(view.myBestBid)}`}
        </div>
        <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 6, lineHeight: 1.65, maxWidth: 380, marginInline: 'auto' }}>
          This buyer has chosen not to share competitive information during bidding. Bid the price you
          are genuinely willing to honour.
        </div>
      </div>
    );
  }

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {p.ownRank !== undefined && (
          <div>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>Your position</div>
            <div
              style={{
                fontSize: 30, fontWeight: 700,
                color: p.isLeading ? color.successText : color.textPrimary,
              }}
            >
              {p.isLeading ? 'Leading' : `Rank ${p.ownRank}`}
              {p.fieldCount !== undefined && (
                <span style={{ fontSize: 15, fontWeight: 400, color: color.textSecondary }}>
                  {' '}of {p.fieldCount}
                </span>
              )}
            </div>
          </div>
        )}

        {p.bestPrice !== undefined && (
          <div>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>Current leading price</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: color.brandPrimary, fontVariantNumeric: 'tabular-nums' }}>
              {money(p.bestPrice)}
            </div>
          </div>
        )}

        {p.gapPctBehind !== undefined && (
          <div>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>How far behind</div>
            <div
              style={{
                fontSize: 26, fontWeight: 700,
                color: p.gapPctBehind === 0 ? color.successText : color.warningText,
              }}
            >
              {p.gapPctBehind === 0 ? 'In front' : `${p.gapPctBehind.toFixed(1)}%`}
            </div>
          </div>
        )}

        {view.myBestBid !== null && (
          <div>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>Your current bid</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {money(view.myBestBid)}
            </div>
          </div>
        )}
      </div>

      {p.trafficBand !== undefined && (
        <div>
          <TrafficLight band={p.trafficBand} />
          <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 8, lineHeight: 1.65 }}>
            {p.trafficBand === 'GREEN' && 'You are at or better than the level the buyer is aiming for.'}
            {p.trafficBand === 'AMBER' && `You are within ${amberBandPct}% of the level the buyer is aiming for. A modest improvement turns this green.`}
            {p.trafficBand === 'RED' && 'You are some way from the level the buyer is aiming for.'}
            {p.targetPrice !== undefined && ` Their stated target is ${money(p.targetPrice)}.`}
          </div>
        </div>
      )}

      {p.allBids !== undefined && (
        <div>
          <div style={{ fontSize: 12.5, color: color.textSecondary, marginBottom: 8 }}>
            Every bid in the room
          </div>
          <div className="rfx-stack" style={{ gap: 7 }}>
            {p.allBids.map((entry, i) => (
              <div
                key={`${entry.label}-${i}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  padding: '9px 12px', borderRadius: radius.control,
                  background: i === 0 ? color.successSoft : color.neutralSoft,
                  fontSize: 14,
                }}
              >
                <span style={{ fontWeight: i === 0 ? 700 : 400 }}>{entry.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: i === 0 ? 700 : 400 }}>
                  {money(entry.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
