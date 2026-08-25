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
import { bidderView } from '../server/auctionService';
import { VISIBILITY_MANIFEST } from '../domain/feedbackPolicy';
import { improvementLabel } from '../domain/comparator';
import { useStore } from '../store/store';
import { COUNTERPARTY_NAMES, PORTAL_BIDDER_ID } from '../data/seed';
import { PortalCard } from './PortalShell';

export function BiddingConsole() {
  const { state, dispatch } = useStore();
  const auction = state.auction.auction;
  const [lotId, setLotId] = React.useState(state.auction.lots[0]?.id ?? '');
  const [bidValue, setBidValue] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);
  const [proxyCeiling, setProxyCeiling] = React.useState('');
  const [proxyStep, setProxyStep] = React.useState('500');
  const [mobile, setMobile] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // The only source of competitive information on this screen.
  const view = bidderView(state.auction, lotId, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
  const manifest = VISIBILITY_MANIFEST[auction.feedbackPolicy];

  const lot = state.auction.lots.find((l) => l.id === lotId);
  const lotName = lot ? state.auction.lotDetails[lot.lotId]?.name : '';
  const live = auction.status === 'LIVE' || auction.status === 'EXTENDED';
  const paused = auction.status === 'PAUSED';
  const closed = auction.status === 'CLOSED' || auction.status === 'ABORTED';

  const result = state.lastBidResult;
  const myResult = result && result.bidderId === PORTAL_BIDDER_ID ? result : null;

  const place = (confirmed = false) => {
    dispatch({
      type: 'SUBMIT_BID',
      auctionLotId: lotId,
      bidderId: PORTAL_BIDDER_ID,
      bidValue: Number(bidValue),
      userId: `portal-${PORTAL_BIDDER_ID}`,
      source: 'PORTAL',
      confirmed,
    });
  };

  React.useEffect(() => {
    if (myResult?.requiresConfirmation) setConfirmOpen(true);
    if (myResult?.accepted) setBidValue('');
  }, [myResult]);

  const quickSteps = [500, 1_000, 2_500];
  const currentBid = view.myBestBid ?? lot?.startingPrice ?? 0;

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
            background: closed ? '#9CA3AF' : paused ? '#FBBF24' : '#EF4444',
            animation: live ? 'rfx-pulse 1.2s infinite' : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em' }}>
            {closed ? 'BIDDING CLOSED' : paused ? 'BIDDING PAUSED' : 'BIDDING IS OPEN'}
          </div>
          <div style={{ fontSize: 14, marginTop: 4, opacity: 0.85 }}>
            {/* Plain language. No mechanism jargon. */}
            {auction.mechanism === 'ENGLISH' && 'Bid whenever you like. Each bid must beat the current leading position.'}
            {auction.mechanism === 'JAPANESE' && 'Each round, confirm you are staying in — or drop out.'}
            {auction.mechanism === 'DUTCH' && 'The price moves until someone accepts. The first acceptance ends it.'}
            {auction.mechanism === 'SEALED_BID' && 'Submit one price. Nothing is revealed until the reveal time.'}
            {!['ENGLISH', 'JAPANESE', 'DUTCH', 'SEALED_BID'].includes(auction.mechanism) && 'Follow the guidance below to place your bid.'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Countdown closesAt={view.closesAt} size={mobile ? 26 : 30} label="Time left" paused={paused} />
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

      {myResult && !myResult.requiresConfirmation && (
        <ValidationBanner
          tone={myResult.accepted ? 'success' : 'error'}
          title={myResult.accepted ? 'Your bid was accepted' : 'Your bid was not accepted'}
          action={<Button size="small" variant="secondary" onClick={() => dispatch({ type: 'CLEAR_BID_RESULT' })}>Dismiss</Button>}
        >
          {myResult.message ?? 'It is now in the ledger with a server timestamp.'}
        </ValidationBanner>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {state.auction.lots.map((auctionLot) => {
          const detail = state.auction.lotDetails[auctionLot.lotId];
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
          {/* ============ Position panel — manifest-driven ============ */}
          <PortalCard title="Where you stand" hint={`The buyer has chosen to show you: ${manifest.label.toLowerCase()}.`}>
            <PositionPanel view={view} amberBandPct={auction.trafficAmberBandPct} />
          </PortalCard>

          {/* ============ Bid entry ============ */}
          <PortalCard
            title={`Place a bid on ${lotName}`}
            hint={
              auction.transformation !== 'NONE' && view.bidToBeat !== null
                ? 'The figure to beat is shown in your own terms.'
                : undefined
            }
          >
            {lot?.status !== 'LOT_OPEN' ? (
              <div style={{ fontSize: 14.5, color: color.textSecondary }}>
                This lot is not open yet. It opens{' '}
                {lot?.opensAt ? new Date(lot.opensAt).toLocaleTimeString() : 'shortly'} — we will
                alert you.
              </div>
            ) : (
              <div className="rfx-stack" style={{ gap: 14 }}>
                {view.bidToBeat !== null && (
                  <div
                    style={{
                      background: color.brandPrimarySoft, borderRadius: radius.card,
                      padding: '14px 16px', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12.5, color: color.textSecondary }}>To take the lead, bid</div>
                      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: color.brandPrimary }}>
                        {money(view.bidToBeat, 'USD')} or better
                      </div>
                    </div>
                    {view.requiredImprovement !== null && view.requiredImprovement > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12.5, color: color.textSecondary }}>
                          That is a {improvementLabel(auction.side)} of
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {money(view.requiredImprovement, 'USD')}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Field
                  label="Your bid"
                  hint={`Minimum ${improvementLabel(auction.side)} is ${auction.antiGaming.minDecrement}${auction.antiGaming.minDecrementType === 'PCT' ? '%' : ''} on the leading position.`}
                >
                  <NumberInput
                    value={bidValue}
                    onChange={(e) => setBidValue(e.target.value)}
                    disabled={state.connectionLost || paused || !live}
                    placeholder={view.bidToBeat !== null ? String(Math.round(view.bidToBeat)) : ''}
                    style={{ fontSize: 22, padding: '14px 14px', fontWeight: 700 }}
                  />
                </Field>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {quickSteps.map((step) => (
                    <Button
                      key={step}
                      variant="secondary"
                      disabled={state.connectionLost || paused || !live}
                      onClick={() =>
                        setBidValue(String(auction.side === 'BUY' ? currentBid - step : currentBid + step))
                      }
                    >
                      {auction.side === 'BUY' ? '−' : '+'}{money(step, 'USD')}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={state.connectionLost || paused || !live}
                    onClick={() =>
                      setBidValue(String(Math.round(auction.side === 'BUY' ? currentBid * 0.99 : currentBid * 1.01)))
                    }
                  >
                    {auction.side === 'BUY' ? '−' : '+'}1%
                  </Button>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    disabled={!bidValue || state.connectionLost || paused || !live}
                    onClick={() => place(false)}
                    style={{ fontSize: 15, padding: '12px 22px' }}
                  >
                    Place bid
                  </Button>
                  {auction.proxyBidding && (
                    <Button variant="secondary" onClick={() => setProxyOpen(true)}>
                      Set up automatic bidding
                    </Button>
                  )}
                </div>

                <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.7 }}>
                  A bid cannot be withdrawn, and you cannot bid against your own leading bid. Bids in the
                  last {auction.antiGaming.softCloseTriggerSec / 60} minutes extend the clock for everyone.
                </div>
              </div>
            )}
          </PortalCard>
        </div>

        <div className="rfx-stack" style={{ gap: 16 }}>
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
                      {money(bid.value, 'USD')}
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
        onConfirm={() => { place(true); setConfirmOpen(false); }}
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
          Bidding <strong>{money(Number(bidValue) || 0, 'USD')}</strong> is a large improvement on your
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
          {view.myBestBid === null ? 'You have not bid yet' : `Your bid: ${money(view.myBestBid, 'USD')}`}
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
              {money(p.bestPrice, 'USD')}
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
              {money(view.myBestBid, 'USD')}
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
            {p.targetPrice !== undefined && ` Their stated target is ${money(p.targetPrice, 'USD')}.`}
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
                  {money(entry.value, 'USD')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
