/**
 * Packs 16–18 and 20 — auction setup, lobby, the buyer live cockpit and results.
 *
 * The buyer sees everything, always. The cockpit therefore also carries the
 * visibility manifest, which is the contract the supplier console is built
 * from — publishing it here is what stops a leak downstream.
 */
import React from 'react';
import { color, money, pct, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import {
  Button, Chip, CurrencyInput, Field, NumberInput, Pill, Radio, Segmented, Toggle,
} from '../../design-system/components/primitives';
import { Card, Empty, KpiRow, Progress, Table, type Column, type Kpi } from '../../design-system/components/layout';
import {
  AgentCard, Countdown, Modal, TypedConfirmModal, TrafficLight, ValidationBanner,
} from '../../design-system/components/domain';
import { AUCTION_STATUS_PRESENTATION, PARTICIPATION_STATUS_PRESENTATION } from '../../domain/statusMachine';
import { VISIBILITY_MANIFEST } from '../../domain/feedbackPolicy';
import {
  checkCanStart, mechanismGuidance, MECHANISM_DURATION_DEFAULTS,
} from '../../domain/auctionEngine';
import { deriveDirection, directionLabel, improvementLabel } from '../../domain/comparator';
import { buyerView } from '../../server/auctionService';
import { formatCountdown, serverNow } from '../../server/clock';
import { biddersForEvent, lotsForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import { forbiddenReason } from '../../domain/agents';
import type {
  AuctionMechanism, ClosePolicy, FeedbackPolicy, IdentityPolicy, LotStrategy,
} from '../../domain/types';

type Pane = 'setup' | 'lobby' | 'cockpit' | 'results';

export function AuctionTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const auction = state.auction.auction;
  const isThisEvent = auction.eventId === eventId;

  const initialPane: Pane =
    !isThisEvent ? 'setup'
    : auction.status === 'LIVE' || auction.status === 'PAUSED' || auction.status === 'EXTENDED' ? 'cockpit'
    : auction.status === 'CLOSED' || auction.status === 'ABORTED' || auction.status === 'RESULTS_PUBLISHED' ? 'results'
    : auction.status === 'LOBBY_OPEN' || auction.status === 'SCHEDULED' ? 'lobby'
    : 'setup';

  const [pane, setPane] = React.useState<Pane>(initialPane);

  if (!isThisEvent) {
    return (
      <Card>
        <Empty
          icon="◈"
          title="No auction configured for this event"
          hint="Configure one from the setup pane, or run the demo auction on RFQ-2026-0142."
          action={<Button variant="primary">Configure auction</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Segmented
          value={pane}
          onChange={setPane}
          options={[
            { value: 'setup', label: 'Setup' },
            { value: 'lobby', label: 'Lobby & dry run' },
            { value: 'cockpit', label: 'Live cockpit' },
            { value: 'results', label: 'Results' },
          ]}
        />
        <Pill
          presentation={AUCTION_STATUS_PRESENTATION[auction.status]}
          live={auction.status === 'LIVE' || auction.status === 'EXTENDED'}
        />
      </div>

      {pane === 'setup' && <AuctionSetup eventId={eventId} />}
      {pane === 'lobby' && <AuctionLobby eventId={eventId} />}
      {pane === 'cockpit' && <BuyerCockpit eventId={eventId} />}
      {pane === 'results' && <AuctionResults eventId={eventId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack 16 — setup
// ---------------------------------------------------------------------------

function AuctionSetup({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const auction = state.auction.auction;
  const bidders = biddersForEvent(state, eventId);
  const lots = lotsForEvent(state, eventId);

  const direction = deriveDirection(auction.side, auction.clockOwner);
  const guidance = mechanismGuidance(auction.mechanism, bidders.length, 6);
  const durations = MECHANISM_DURATION_DEFAULTS[auction.mechanism];

  const mechanisms: { key: AuctionMechanism; name: string; desc: string; off?: boolean }[] = [
    { key: 'ENGLISH', name: 'English', desc: `Open bidding until no one improves — ${directionLabel(auction.side)}.` },
    { key: 'JAPANESE', name: 'Japanese', desc: 'System clock moves in fixed steps; bidders confirm to stay.' },
    { key: 'DUTCH', name: 'Dutch', desc: `System clock ${auction.side === 'BUY' ? 'rises' : 'falls'} until a bidder accepts.` },
    { key: 'SEALED_BID', name: 'Sealed bid', desc: 'All bids hidden until the reveal time.' },
    { key: 'RANK_COMPRESSION', name: 'Rank compression', desc: 'Turn-based; gaps compress as the field converges.' },
    { key: 'MULTI_ATTRIBUTE', name: 'Multi-attribute', desc: 'Price and non-price attributes on published weights.' },
    { key: 'PORTFOLIO', name: 'Portfolio', desc: 'Bids across lots; the best combination wins.' },
    { key: 'INDEX_LINKED', name: 'Index-linked', desc: 'Bids as an offset to a market index.' },
    { key: 'TRAFFIC_LIGHT', name: 'Traffic light', desc: 'A feedback policy expressed as a mechanism.' },
    { key: 'VICKREY', name: 'Vickrey', desc: 'Sealed; the winner pays the second price. Off by default.', off: true },
  ];

  const policies: { key: FeedbackPolicy; name: string; desc: string }[] = [
    { key: 'FULL_PRICE', name: 'Full price', desc: 'Every bid, every bidder. Maximum pressure, maximum disclosure.' },
    { key: 'BEST_PRICE', name: 'Best price', desc: 'The leading price only. Strong momentum, no field mapping.' },
    { key: 'RANK_ONLY', name: 'Rank only', desc: 'Their rank. Builds momentum with mature suppliers.' },
    { key: 'RANK_GAP', name: 'Rank + gap %', desc: 'Actionable without revealing prices.' },
    { key: 'TRAFFIC_LIGHT', name: 'Traffic light', desc: 'Competition against your target, not against each other.' },
    { key: 'BLIND', name: 'Blind', desc: 'Nothing. Thin markets and relationship-sensitive categories.' },
  ];

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        <ValidationBanner tone="info" title={`Direction is derived, not entered — this auction is ${direction.toLowerCase()}`}>
          Side <strong>{auction.side}</strong> with a <strong>{auction.clockOwner.toLowerCase()}</strong> clock
          yields a {direction.toLowerCase()} clock and means {directionLabel(auction.side)}. "Dutch reverse"
          is not a mechanism — it is Dutch with side BUY.
        </ValidationBanner>

        <Card title="Mechanism" hint={`Every mechanism is defined by its parameters, not its name. Typical duration ${durations[0]}–${durations[1]} minutes.`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 8 }}>
            {mechanisms.map((m) => (
              <Radio
                key={m.key}
                checked={auction.mechanism === m.key}
                onChange={() => dispatch({ type: 'UPDATE_AUCTION', patch: { mechanism: m.key } })}
                label={m.name}
                hint={m.desc}
                disabled={m.off && auction.mechanism !== m.key}
              />
            ))}
          </div>
          {guidance.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="warning" title="Mechanism guidance">
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.6 }}>
                  {guidance.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </ValidationBanner>
            </div>
          )}
        </Card>

        <Card
          title="Feedback policy"
          hint="A first-class lever, and a data boundary — the server sends a bidder only what the policy permits."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 8 }}>
            {policies.map((p) => (
              <Radio
                key={p.key}
                checked={auction.feedbackPolicy === p.key}
                onChange={() => dispatch({ type: 'UPDATE_AUCTION', patch: { feedbackPolicy: p.key } })}
                label={p.name}
                hint={p.desc}
              />
            ))}
          </div>

          <div
            style={{
              marginTop: 14, padding: '12px 14px', background: '#0F172A',
              borderRadius: radius.control, color: '#E2E8F0',
            }}
          >
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94A3B8', marginBottom: 8 }}>
              What a bidder will see
            </div>
            <BidderPreview policy={auction.feedbackPolicy} amberBandPct={auction.trafficAmberBandPct} />
          </div>
        </Card>

        <Card title="Lot strategy & timing">
          <div className="rfx-stack" style={{ gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Strategy</div>
              <Segmented
                value={auction.lotStrategy}
                onChange={(lotStrategy: LotStrategy) => dispatch({ type: 'UPDATE_AUCTION', patch: { lotStrategy } })}
                options={[
                  { value: 'INDEPENDENT', label: 'Independent' },
                  { value: 'SERIAL', label: 'Serial' },
                  { value: 'PARALLEL', label: 'Parallel' },
                  { value: 'STAGGERED', label: 'Staggered' },
                ]}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Close policy</div>
              <Segmented
                value={auction.closePolicy}
                onChange={(closePolicy: ClosePolicy) => dispatch({ type: 'UPDATE_AUCTION', patch: { closePolicy } })}
                options={[
                  { value: 'HARD', label: 'Hard' },
                  { value: 'SOFT_EXTENSION', label: 'Soft extension' },
                  { value: 'FIRST_ACCEPT', label: 'First accept' },
                  { value: 'LAST_STANDING', label: 'Last standing' },
                ]}
              />
              {auction.closePolicy === 'HARD' && (
                <div style={{ marginTop: 8 }}>
                  <ValidationBanner tone="warning" title="A hard close permits sniping">
                    Without auto-extension a bidder can place a winning bid in the final second and no
                    one can respond.
                  </ValidationBanner>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Identity policy</div>
              <Segmented
                value={auction.identityPolicy}
                onChange={(identityPolicy: IdentityPolicy) => dispatch({ type: 'UPDATE_AUCTION', patch: { identityPolicy } })}
                options={[
                  { value: 'MASKED', label: 'Masked — Bidder A, B, C' },
                  { value: 'NAMED', label: 'Named' },
                ]}
              />
            </div>
          </div>
        </Card>

        <Card title="Anti-gaming controls" hint="Standard equipment, not optional extras.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12 }}>
            <Field label={`Minimum ${improvementLabel(auction.side)}`} hint="Prevents penny bidding.">
              <div style={{ display: 'flex', gap: 6 }}>
                <NumberInput
                  value={auction.antiGaming.minDecrement}
                  step="0.1"
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_AUCTION',
                      patch: { antiGaming: { ...auction.antiGaming, minDecrement: Number(e.target.value) } },
                    })
                  }
                />
                <Segmented
                  size="small"
                  value={auction.antiGaming.minDecrementType}
                  onChange={(minDecrementType) =>
                    dispatch({
                      type: 'UPDATE_AUCTION',
                      patch: { antiGaming: { ...auction.antiGaming, minDecrementType } },
                    })
                  }
                  options={[{ value: 'PCT', label: '%' }, { value: 'ABSOLUTE', label: '$' }]}
                />
              </div>
            </Field>
            <Field label="Maximum improvement guard (%)" hint="Fat-finger and gaming protection.">
              <NumberInput
                value={auction.antiGaming.maxDecrementPct}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, maxDecrementPct: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Front buffer (%)" hint="A band ahead of the lead in which bids are rejected.">
              <NumberInput
                value={auction.antiGaming.frontBufferPct}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, frontBufferPct: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Soft close trigger (sec)">
              <NumberInput
                value={auction.antiGaming.softCloseTriggerSec}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, softCloseTriggerSec: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Extension length (sec)">
              <NumberInput
                value={auction.antiGaming.softCloseExtensionSec}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, softCloseExtensionSec: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Minimum bidders to start">
              <NumberInput
                value={auction.antiGaming.minBiddersToStart}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, minBiddersToStart: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Typed confirmation above (%)">
              <NumberInput
                value={auction.antiGaming.confirmThresholdPct}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, confirmThresholdPct: Number(e.target.value) } },
                  })
                }
              />
            </Field>
            <Field label="Tie-bid policy">
              <Segmented
                size="small"
                value={auction.antiGaming.tieBidPolicy}
                onChange={(tieBidPolicy) =>
                  dispatch({
                    type: 'UPDATE_AUCTION',
                    patch: { antiGaming: { ...auction.antiGaming, tieBidPolicy } },
                  })
                }
                options={[
                  { value: 'FIRST_IN_WINS', label: 'First in' },
                  { value: 'SPLIT', label: 'Split' },
                  { value: 'TIE_BREAK_ROUND', label: 'Tie-break' },
                  { value: 'BUYER_DECIDES', label: 'Buyer' },
                ]}
              />
            </Field>
          </div>

          <div className="rfx-stack" style={{ marginTop: 14, gap: 9 }}>
            {/* Permanently-disabled controls, shown so the boundary is visible. */}
            <Toggle
              checked={false}
              onChange={() => undefined}
              disabled
              disabledReason="Bid withdrawal is never permitted. The ledger is append-only; a correction is a new row."
              label="Allow bid withdrawal"
            />
            <Toggle
              checked={false}
              onChange={() => undefined}
              disabled
              disabledReason="Bidding against your own leading bid is never permitted."
              label="Allow rebid on own leading bid"
            />
            <Toggle
              checked={auction.antiGaming.requireDryRunFirstEvent}
              onChange={(requireDryRunFirstEvent) =>
                dispatch({
                  type: 'UPDATE_AUCTION',
                  patch: { antiGaming: { ...auction.antiGaming, requireDryRunFirstEvent } },
                })
              }
              label="Require a dry run before a supplier's first live auction"
            />
          </div>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Starting price & target" hint="The source used is recorded.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: color.textSecondary }}>Starting price</div>
              <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(state.auction.lots[0]?.startingPrice ?? 0, event.currency)}
              </div>
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>
                Source: {auction.startingPriceSource}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: color.textSecondary }}>Target price 🔒</div>
              <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {lots[0]?.targetPrice === null || lots[0]?.targetPrice === undefined
                  ? '—'
                  : money(lots[0].targetPrice, event.currency)}
              </div>
              <div style={{ fontSize: 11, color: auction.targetPriceDerivation ? color.textSecondary : color.warningText, marginTop: 3 }}>
                {auction.targetPriceDerivation
                  ? `Derivation: ${auction.targetPriceDerivation}`
                  : 'A target with no stated basis is flagged.'}
              </div>
            </div>
            <Toggle
              checked={auction.discloseTarget}
              onChange={(discloseTarget) => dispatch({ type: 'UPDATE_AUCTION', patch: { discloseTarget } })}
              label="Disclose the target number to bidders"
            />
          </div>
        </Card>

        <Card title="Bid transformation">
          <div className="rfx-stack" style={{ gap: 10 }}>
            <Segmented
              size="small"
              value={auction.transformation}
              onChange={(transformation) => dispatch({ type: 'UPDATE_AUCTION', patch: { transformation } })}
              options={[
                { value: 'NONE', label: 'None' },
                { value: 'SUPPLIER_SPECIFIC', label: 'Supplier specific' },
                { value: 'TOTAL_COST_FORMULA', label: 'Total cost' },
              ]}
            />
            <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
              With transformation on, each bidder sees a different bid-to-beat, because the required
              value is transformed back into their own terms. The adjustment itself is never shown.
            </div>
            <div className="rfx-stack" style={{ gap: 5 }}>
              {state.auction.costComponents.map((component) => (
                <div key={component.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                  <span style={{ color: color.textSecondary }}>{component.name}</span>
                  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    <Chip tone="neutral">{component.basis.toLowerCase().replace('_', ' ')}</Chip>
                    {component.agentProposed && <Chip tone="purple" icon="✦">AG-07</Chip>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Proxy bidding">
          <Toggle
            checked={auction.proxyBidding}
            onChange={(proxyBidding) => dispatch({ type: 'UPDATE_AUCTION', patch: { proxyBidding } })}
            disabled={auction.clockOwner !== 'BIDDER'}
            disabledReason={auction.clockOwner !== 'BIDDER' ? 'Proxy bidding only applies where the bidder owns the clock.' : undefined}
            label={auction.proxyBidding ? 'Enabled — a ceiling is mandatory' : 'Disabled'}
          />
        </Card>
      </div>
    </div>
  );
}

function BidderPreview({ policy, amberBandPct }: { policy: FeedbackPolicy; amberBandPct: number }) {
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 };
  switch (policy) {
    case 'FULL_PRICE':
      return (
        <div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
            Every number is exposed — including yours, to everyone else.
          </div>
          {['Bidder A  $148,350', 'Bidder C  $147,200', 'Bidder B  $148,900', 'You       $149,850'].map((line) => (
            <div key={line} style={mono}>{line}</div>
          ))}
        </div>
      );
    case 'BEST_PRICE':
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>Current best bid</div>
          <div style={{ ...mono, fontSize: 24, fontWeight: 700, color: '#93C5FD' }}>$147,200</div>
        </div>
      );
    case 'RANK_ONLY':
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Rank 2 of 4</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>no numbers shown</div>
        </div>
      );
    case 'RANK_GAP':
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Rank 2 · 1.8% behind</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>gap as a percentage, no prices</div>
        </div>
      );
    case 'TRAFFIC_LIGHT':
      return (
        <div style={{ textAlign: 'center' }}>
          <TrafficLight band="AMBER" />
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
            Within {amberBandPct}% of our target. The target number itself is not sent.
          </div>
        </div>
      );
    case 'BLIND':
      return (
        <div style={{ textAlign: 'center', color: '#94A3B8' }}>
          <div style={{ fontSize: 22 }}>🔒</div>
          <div style={{ fontSize: 12 }}>Nothing shown until reveal</div>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Pack 17 — lobby and dry run
// ---------------------------------------------------------------------------

function AuctionLobby({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const auction = state.auction.auction;
  const bidders = biddersForEvent(state, eventId);
  const joined = bidders.filter(
    (b) => b.participationStatus === 'JOINED' || b.participationStatus === 'BIDDING',
  );
  const [startOpen, setStartOpen] = React.useState(false);
  const [justification, setJustification] = React.useState('');

  const check = checkCanStart(auction, joined.length, bidders.length, false);

  const rulesByMechanism: Record<string, string[]> = {
    ENGLISH: [
      `Bid whenever you like. Each bid must improve on the leading bid by at least ${auction.antiGaming.minDecrement}%.`,
      'You cannot bid against your own leading bid.',
      'A bid in the final two minutes extends the clock by two minutes.',
    ],
    JAPANESE: [
      'The system moves the price one step each round.',
      'Each round you confirm you will stay in, or you drop out.',
      'Dropping out is final. The last bidder standing wins.',
    ],
    DUTCH: [
      'The system moves the clock against you until someone accepts.',
      'The first acceptance ends the auction immediately.',
      'There is no second chance — accept when the price is one you will honour.',
    ],
    SEALED_BID: [
      'Submit one price. You will not see any competitor information.',
      'All bids are revealed together at the reveal time.',
      'You cannot revise after submission.',
    ],
  };
  const rules = rulesByMechanism[auction.mechanism] ?? rulesByMechanism.ENGLISH;

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {check.blockers.map((blocker) => (
          <ValidationBanner key={blocker} tone="error" title="Cannot start">{blocker}</ValidationBanner>
        ))}
        {check.warnings.map((warning) => (
          <ValidationBanner key={warning} tone="warning" title="Before you start">{warning}</ValidationBanner>
        ))}

        <Card title="Participants" hint="Registered, joined and dry-run status are separate facts.">
          <div className="rfx-stack" style={{ gap: 8 }}>
            {bidders.map((bidder) => (
              <div
                key={bidder.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                  {COUNTERPARTY_NAMES[bidder.counterpartyId]}
                  <span style={{ color: color.textSecondary, marginLeft: 6, fontSize: 11 }}>
                    {bidder.maskedLabel}
                  </span>
                </span>
                <Pill presentation={PARTICIPATION_STATUS_PRESENTATION[bidder.participationStatus]} size="small" />
                {bidder.performanceRatingSnapshot === 0 ? (
                  <Chip tone="gold" icon="◷">dry run outstanding</Chip>
                ) : (
                  <Chip tone="brand" icon="✓">dry run done</Chip>
                )}
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    dispatch({ type: 'UPDATE_BIDDER', bidderId: bidder.id, patch: { participationStatus: 'JOINED' } })
                  }
                >
                  Mark joined
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Rules as the bidder reads them — ${auction.mechanism}`} hint="Each mechanism reads differently. Plain language, no internal jargon.">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
            {rules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Start the auction">
          <div className="rfx-stack" style={{ gap: 12 }}>
            <div style={{ fontSize: 12, color: color.textSecondary }}>
              {joined.length} of {bidders.length} bidders have joined the room.
            </div>
            <Progress value={joined.length} max={Math.max(1, bidders.length)} />
            <Button
              variant="primary"
              disabled={!check.canStart}
              onClick={() => setStartOpen(true)}
            >
              Open bidding
            </Button>
            {check.requiresJustification && (
              <div style={{ fontSize: 11, color: color.warningText }}>
                Below the minimum bidder count — a justification is required and recorded.
              </div>
            )}
          </div>
        </Card>

        <AgentCard
          code="AG-10"
          name="Auction Orchestration"
          autonomy="SUGGEST"
          confidence={0.68}
          summary={`${bidders.length - joined.length} registered bidders have not joined. Suggest holding the start for five minutes and sending a reminder.`}
          evidence={[
            { label: 'Participation records', detail: `${joined.length} joined of ${bidders.length}` },
            { label: 'Prior events', detail: 'Late joiners placed a bid in 4 of 5 comparable auctions' },
          ]}
          breaches={[forbiddenReason('CONTROL_AUCTION_UNCONFIRMED')]}
        />
      </div>

      <Modal
        open={startOpen}
        title="Open bidding"
        onClose={() => setStartOpen(false)}
        onConfirm={() => {
          dispatch({ type: 'CONTROLLER_ACTION', action: 'RESUME', reason: justification || 'Auction opened by the controller.' });
          dispatch({ type: 'OPEN_LOT', auctionLotId: 'al-1' });
          dispatch({ type: 'UPDATE_EVENT', eventId, patch: { status: 'AUCTION_LIVE' } });
          setStartOpen(false);
        }}
        confirmLabel="Open bidding"
      >
        <p style={{ margin: '0 0 10px' }}>
          Bidding opens for {bidders.length} bidders on {auction.mechanism} with{' '}
          {VISIBILITY_MANIFEST[auction.feedbackPolicy].label} feedback.
        </p>
        {check.requiresJustification && (
          <Field label="Justification — recorded on the event" required>
            <CurrencyInput
              currency="›"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why start below the minimum bidder count?"
              style={{ textAlign: 'left', fontFamily: 'inherit' }}
            />
          </Field>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack 18 — buyer live cockpit
// ---------------------------------------------------------------------------

function BuyerCockpit({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const auction = state.auction.auction;
  const [selectedLotId, setSelectedLotId] = React.useState(state.auction.lots[0]?.id ?? '');
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [extendOpen, setExtendOpen] = React.useState(false);
  const [forceCloseOpen, setForceCloseOpen] = React.useState(false);
  const [abortOpen, setAbortOpen] = React.useState(false);
  const [pauseReason, setPauseReason] = React.useState('');

  // The buyer sees everything: real names, raw bids and transformed values.
  const rows = buyerView(state.auction, selectedLotId, COUNTERPARTY_NAMES, {
    observer: state.observerMode,
  });
  const bidding = rows.filter((r) => r.bidCount > 0);
  const leader = bidding[0];
  const lot = state.auction.lots.find((l) => l.id === selectedLotId);
  const lotDetail = lot ? state.auction.lotDetails[lot.lotId] : undefined;
  const paused = auction.status === 'PAUSED';

  const startingPrice = lot?.startingPrice ?? 0;
  const savings = leader ? startingPrice - leader.transformedValue : 0;

  const kpis: Kpi[] = [
    { icon: '$', value: money(startingPrice, event.currency), label: 'Starting', iconBg: color.neutralSoft, iconFg: color.textSecondary, valueSize: 16 },
    {
      icon: '$', value: leader ? money(leader.transformedValue, event.currency) : '—',
      label: 'Current best (transformed)', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary,
      valueColor: color.brandPrimary, valueSize: 19,
    },
    {
      icon: '↓', value: `${signedMoney(savings, event.currency)} · ${startingPrice ? pct((savings / startingPrice) * 100) : '0.0%'}`,
      label: 'Movement so far', iconBg: savings >= 0 ? color.successSoft : color.dangerSoft,
      iconFg: savingsColor(savings), valueColor: savingsColor(savings), valueSize: 14,
    },
    {
      icon: '◱', value: `${rows.filter((r) => r.participationStatus === 'BIDDING' || r.participationStatus === 'JOINED').length}/${rows.length}`,
      label: 'Joined', iconBg: color.accentPurpleSoft, iconFg: color.accentPurpleText,
    },
    {
      icon: '▤', value: String(state.auction.bids.filter((b) => b.auctionLotId === selectedLotId && b.isValid).length),
      label: 'Valid bids', iconBg: color.infoSoft, iconFg: color.infoText,
    },
  ];

  const rankColumns: Column<typeof rows[number]>[] = [
    {
      key: 'rank', header: '#', width: '48px',
      render: (row) =>
        row.bidCount === 0 ? (
          <span style={{ color: color.textMuted }}>—</span>
        ) : (
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
    },
    {
      key: 'name', header: state.observerMode ? 'Bidder (masked)' : 'Bidder',
      render: (row) => (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: row.rank === 1 && row.bidCount > 0 ? 700 : 500 }}>
            {row.displayName}
          </div>
          {!state.observerMode && (
            <div style={{ fontSize: 10.5, color: color.textSecondary }}>{row.maskedLabel}</div>
          )}
        </div>
      ),
    },
    {
      key: 'bid', header: 'Bid as placed', numeric: true,
      render: (row) => (row.bidCount === 0 ? <span style={{ color: color.textMuted }}>no bid</span> : money(row.bidValue, event.currency)),
    },
    {
      key: 'transformed', header: 'Transformed', numeric: true,
      render: (row) =>
        row.bidCount === 0 ? (
          <span style={{ color: color.textMuted }}>—</span>
        ) : (
          <strong>{money(row.transformedValue, event.currency)}</strong>
        ),
    },
    {
      key: 'movement', header: 'Last move', numeric: true,
      render: (row) =>
        row.movement === 0 ? (
          <span style={{ color: color.textMuted }}>—</span>
        ) : (
          <span style={{ color: row.movement > 0 ? color.successText : color.dangerText }}>
            {signedMoney(row.movement, event.currency)}
          </span>
        ),
    },
    { key: 'bids', header: 'Bids', numeric: true, render: (row) => row.bidCount || '—' },
    {
      key: 'last', header: 'Last bid at', width: '110px',
      render: (row) =>
        row.lastBidAt === null ? (
          <span style={{ fontSize: 11, color: color.textMuted }}>—</span>
        ) : (
          <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(row.lastBidAt).toLocaleTimeString()}
          </span>
        ),
    },
    {
      key: 'status', header: 'Status',
      render: (row) => <Pill presentation={PARTICIPATION_STATUS_PRESENTATION[row.participationStatus]} size="small" />,
    },
  ];

  const bidHistory = [...state.auction.bids]
    .filter((b) => b.auctionLotId === selectedLotId)
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {paused && (
        <ValidationBanner
          tone="warning"
          title="Auction paused — bid acceptance is blocked server-side"
          action={
            <Button
              size="small"
              variant="primary"
              onClick={() => dispatch({ type: 'CONTROLLER_ACTION', action: 'RESUME', reason: 'Controller resumed bidding.' })}
            >
              Resume
            </Button>
          }
        >
          A pause is not cosmetic: the bid validator rejects while paused, so a bid submitted from a
          stale client is refused rather than silently accepted.
        </ValidationBanner>
      )}

      {state.auction.integrityFlags.length > 0 && (
        <ValidationBanner tone="error" title={`${state.auction.integrityFlags.length} integrity flag(s)`}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.6 }}>
            {state.auction.integrityFlags.map((flag, i) => (
              <li key={i}>
                <strong>{flag.kind.replace('_', ' ').toLowerCase()}</strong> — {flag.detail}
              </li>
            ))}
          </ul>
        </ValidationBanner>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            background: '#0F172A', color: '#fff', borderRadius: radius.card, padding: '11px 16px',
            // Takes its own line rather than being crushed beside the controls.
            flex: '1 1 440px', minWidth: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: paused ? '#FBBF24' : '#EF4444',
              animation: paused ? undefined : 'rfx-pulse 1.2s infinite',
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', flexShrink: 0 }}>
            {paused ? 'PAUSED' : 'AUCTION LIVE'}
          </span>
          <span style={{ fontSize: 12, color: '#94A3B8', minWidth: 0 }}>
            {auction.mechanism} · {VISIBILITY_MANIFEST[auction.feedbackPolicy].label} feedback · {directionLabel(auction.side)}
          </span>
          <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <Countdown closesAt={lot?.closesAt ?? null} size={24} label="Time remaining" paused={paused} onDark />
          </span>
          {auction.extensionsUsed > 0 && (
            <Chip tone="gold" icon="⟳">{auction.extensionsUsed} extension{auction.extensionsUsed > 1 ? 's' : ''}</Chip>
          )}
        </div>

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setManifestOpen(true)}>Visibility manifest</Button>
          <Button variant="secondary" onClick={() => setExtendOpen(true)}>Extend</Button>
          <Button
            variant="secondary"
            onClick={() => (paused
              ? dispatch({ type: 'CONTROLLER_ACTION', action: 'RESUME', reason: 'Controller resumed bidding.' })
              : setPauseOpen(true))}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="secondary" onClick={() => setForceCloseOpen(true)}>Force close</Button>
          <Button variant="destructive" onClick={() => setAbortOpen(true)}>Abort</Button>
        </div>
      </div>

      <KpiRow kpis={kpis} />

      <div className="rfx-split">
        <div className="rfx-stack" style={{ gap: 14 }}>
          <Card padded={false} title="Lots" hint="Per-lot states run in parallel.">
            <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
              {state.auction.lots.map((auctionLot) => {
                const detail = state.auction.lotDetails[auctionLot.lotId];
                const lotRows = buyerView(state.auction, auctionLot.id, COUNTERPARTY_NAMES);
                const lotLeader = lotRows.find((r) => r.bidCount > 0);
                return (
                  <button
                    key={auctionLot.id}
                    type="button"
                    onClick={() => setSelectedLotId(auctionLot.id)}
                    style={{
                      textAlign: 'left', cursor: 'pointer', minWidth: 175,
                      border: `1px solid ${auctionLot.id === selectedLotId ? color.brandPrimary : color.border}`,
                      background: auctionLot.id === selectedLotId ? '#F5F8FF' : '#fff',
                      borderRadius: radius.control, padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{detail?.name ?? auctionLot.lotId}</span>
                      <Chip tone={auctionLot.status === 'LOT_OPEN' ? 'danger' : 'neutral'}>
                        {auctionLot.status.replace('LOT_', '').toLowerCase()}
                      </Chip>
                    </div>
                    <div style={{ fontSize: 11.5, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>
                      {lotLeader ? money(lotLeader.transformedValue, event.currency) : '—'}
                    </div>
                    <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>
                      {auctionLot.closesAt
                        ? auctionLot.status === 'LOT_OPEN'
                          ? `${formatCountdown(auctionLot.closesAt - serverNow())} left`
                          : `opens ${new Date(auctionLot.opensAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card
            padded={false}
            title="Live standing"
            hint="Ranked on the transformed value. The buyer always sees both the raw bid and the transformed value."
            action={
              <Toggle
                checked={state.observerMode}
                onChange={() => dispatch({ type: 'TOGGLE_OBSERVER' })}
                label="Observer view (masked)"
              />
            }
          >
            <Table
              columns={rankColumns}
              rows={rows}
              rowKey={(row) => row.bidderId}
              rowStyle={(row) => (row.rank === 1 && row.bidCount > 0 ? { background: '#F0FDF4' } : undefined)}
            />
          </Card>

          <Card padded={false} title="Bid ledger" hint="Append-only. A rejected attempt is recorded as invalid with its reason.">
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {bidHistory.length === 0 ? (
                <Empty icon="▤" title="No bids yet on this lot" />
              ) : (
                bidHistory.map((bid, i) => {
                  const bidder = state.bidders.find((b) => b.id === bid.bidderId);
                  return (
                    <div
                      key={bid.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 14px',
                        borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                        background: bid.isValid ? (i === 0 ? '#F0FDF4' : '#fff') : color.dangerSoft,
                      }}
                    >
                      <span style={{ fontSize: 10.5, color: color.textSecondary, width: 28, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        #{bid.sequenceNumber}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                        {bidder ? COUNTERPARTY_NAMES[bidder.counterpartyId] : bid.bidderId}
                        <span style={{ color: color.textSecondary, fontSize: 10.5, marginLeft: 5 }}>
                          {bidder?.maskedLabel}
                        </span>
                        {bid.source !== 'PORTAL' && (
                          <Chip tone="danger" title="Not placed by the supplier themselves">{bid.source.toLowerCase()}</Chip>
                        )}
                      </span>
                      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {money(bid.bidValue, bid.currency)}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', width: 90, textAlign: 'right', flexShrink: 0 }}>
                        {money(bid.transformedValue, bid.currency)}
                      </span>
                      <span style={{ fontSize: 10.5, color: color.textSecondary, width: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {new Date(bid.submittedAt).toLocaleTimeString()}
                      </span>
                      {!bid.isValid && (
                        <Chip tone="danger" icon="✕" title={bid.rejectionReason ?? ''}>rejected</Chip>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        <div className="rfx-stack" style={{ gap: 12 }}>
          <Card title="Bid on behalf" hint="Always writes an audit marker visible to the supplier.">
            <BidOnBehalf eventId={eventId} auctionLotId={selectedLotId} />
          </Card>

          <Card title="Price controls in force" hint="Internal-only values, shown to the controller.">
            <div className="rfx-stack" style={{ gap: 8, fontSize: 12 }}>
              {[
                ['Starting', lot?.startingPrice ?? null, 'Bidders see this'],
                ['Ceiling', lotDetail?.ceilingPrice ?? null, 'Bid rejected above'],
                ['Floor', lotDetail?.floorPrice ?? null, 'Bid rejected below'],
                ['Target 🔒', lotDetail?.targetPrice ?? null, 'Drives traffic light only'],
                ['Reserve 🔒', lotDetail?.reservePrice ?? null, 'Constrains the award, not bidding'],
              ].map(([label, value, note]) => (
                <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: color.textSecondary }}>{label}</span>
                  <span style={{ textAlign: 'right' }}>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {value === null ? '—' : money(value as number, event.currency)}
                    </strong>
                    <span style={{ display: 'block', fontSize: 10, color: color.textSecondary }}>{note}</span>
                  </span>
                </div>
              ))}
            </div>
            {leader && lotDetail?.reservePrice !== null && lotDetail?.reservePrice !== undefined && (
              <div style={{ marginTop: 10 }}>
                {leader.transformedValue <= lotDetail.reservePrice ? (
                  <ValidationBanner tone="success" title="Leading bid is inside reserve">
                    An award at this value is permitted.
                  </ValidationBanner>
                ) : (
                  <ValidationBanner tone="warning" title="Leading bid is outside reserve">
                    Bidding may continue, but an award at this value would breach the reserve.
                  </ValidationBanner>
                )}
              </div>
            )}
          </Card>

          <AgentCard
            code="AG-10"
            name="Auction Orchestration"
            autonomy="SUGGEST"
            confidence={0.72}
            summary={
              bidding.length < rows.length
                ? `${rows.length - bidding.length} bidder(s) have joined but not bid. Suggest a broadcast nudge before the close window.`
                : 'Bidding is active across the field. No intervention suggested.'
            }
            evidence={[
              { label: 'Participation records', detail: `${bidding.length} of ${rows.length} have bid` },
              { label: 'Bid ledger', detail: `${state.auction.bids.filter((b) => b.isValid).length} valid bids` },
            ]}
            breaches={[forbiddenReason('CONTROL_AUCTION_UNCONFIRMED')]}
          />
        </div>
      </div>

      {/* The visibility manifest — the contract Pack 19 is built from. */}
      <Modal
        open={manifestOpen}
        title="Visibility manifest"
        width={720}
        onClose={() => setManifestOpen(false)}
      >
        <p style={{ margin: '0 0 12px' }}>
          What a bidder may see under each feedback policy. The supplier console is built from this
          table, and the server projection is built by whitelist — a field a policy forbids is absent
          from the payload, not hidden in the UI.
        </p>
        <div className="rfx-scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Policy', 'Own rank', 'Best price', 'All bids', 'Competitor identity', 'Gap %', 'Traffic band', 'Field count'].map((header) => (
                  <th key={header} style={{ textAlign: 'left', padding: '7px 9px', fontSize: 11, color: color.textSecondary, borderBottom: `1px solid ${color.border}` }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(VISIBILITY_MANIFEST).map((row) => (
                <tr
                  key={row.policy}
                  style={{
                    borderTop: `1px solid ${color.border}`,
                    background: row.policy === state.auction.auction.feedbackPolicy ? color.brandPrimarySoft : '#fff',
                  }}
                >
                  <td style={{ padding: '7px 9px', fontWeight: 600 }}>
                    {row.label}
                    {row.policy === state.auction.auction.feedbackPolicy && (
                      <Chip tone="brand">in force</Chip>
                    )}
                  </td>
                  {[row.ownRank, row.bestPrice, row.allBids, row.competitorIdentity, row.gapPct, row.trafficLight, row.participantCount].map((permitted, i) => (
                    <td key={i} style={{ padding: '7px 9px' }}>
                      <span style={{ color: permitted ? color.successText : color.textMuted, fontWeight: 700 }}>
                        {permitted ? '✓ sent' : '✕ absent'}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal
        open={pauseOpen}
        title="Pause the auction"
        onClose={() => setPauseOpen(false)}
        onConfirm={() => {
          dispatch({ type: 'CONTROLLER_ACTION', action: 'PAUSE', reason: pauseReason || 'Controller paused the auction.' });
          setPauseOpen(false);
          setPauseReason('');
        }}
        confirmLabel="Pause"
        confirmDisabled={pauseReason.trim().length < 4}
      >
        <p style={{ margin: '0 0 10px' }}>
          Pausing blocks bid acceptance server-side and is written to the audit log <em>before</em> it
          takes effect. Every bidder sees a paused banner.
        </p>
        <Field label="Reason" required>
          <input
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            style={{
              width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
              padding: '7px 10px', fontSize: 13,
            }}
          />
        </Field>
      </Modal>

      <Modal
        open={extendOpen}
        title="Extend the clock"
        onClose={() => setExtendOpen(false)}
        onConfirm={() => {
          dispatch({
            type: 'CONTROLLER_ACTION', action: 'EXTEND',
            reason: 'Controller extended the clock manually.',
            extendSec: auction.antiGaming.softCloseExtensionSec,
          });
          setExtendOpen(false);
        }}
        confirmLabel={`Extend by ${auction.antiGaming.softCloseExtensionSec}s`}
      >
        <p style={{ margin: 0 }}>
          A manual extension is logged with your name and the reason. Automatic soft-close extensions
          are logged separately as system actions — {auction.extensionsUsed} so far.
        </p>
      </Modal>

      <TypedConfirmModal
        open={forceCloseOpen}
        title="Force close the auction"
        phrase="CLOSE"
        confirmLabel="Force close"
        onClose={() => setForceCloseOpen(false)}
        onConfirm={(reason) => {
          dispatch({ type: 'CONTROLLER_ACTION', action: 'FORCE_CLOSE', reason });
          setForceCloseOpen(false);
        }}
        description={
          <>
            Closing ends bidding on every open lot immediately. The standing at close becomes the
            result, and the result is a <strong>recommendation</strong> — the award is a separate,
            governed step.
          </>
        }
      />

      <TypedConfirmModal
        open={abortOpen}
        title="Abort the auction"
        phrase="ABORT"
        confirmLabel="Abort auction"
        onClose={() => setAbortOpen(false)}
        onConfirm={(reason) => {
          dispatch({ type: 'CONTROLLER_ACTION', action: 'ABORT', reason });
          setAbortOpen(false);
        }}
        description={
          <>
            An abort discards the auction as a basis for award. The bid ledger is retained in full —
            nothing is deleted — and every bidder is notified with the reason you give.
          </>
        }
      />
    </div>
  );
}

function BidOnBehalf({ eventId, auctionLotId }: { eventId: string; auctionLotId: string }) {
  const { state, dispatch } = useStore();
  const eligible = biddersForEvent(state, eventId).filter((b) => b.bidOnBehalfAllowed);
  const [bidderId, setBidderId] = React.useState(eligible[0]?.id ?? '');
  const [value, setValue] = React.useState('');
  const [reason, setReason] = React.useState('');

  const result = state.lastBidResult;

  if (eligible.length === 0) {
    return (
      <div style={{ fontSize: 12, color: color.textSecondary }}>
        No bidder on this event has authorised bidding on their behalf.
      </div>
    );
  }

  return (
    <div className="rfx-stack" style={{ gap: 10 }}>
      <Field label="Bidder">
        <select
          value={bidderId}
          onChange={(e) => setBidderId(e.target.value)}
          style={{ width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '7px 10px', fontSize: 13 }}
        >
          {eligible.map((bidder) => (
            <option key={bidder.id} value={bidder.id}>
              {COUNTERPARTY_NAMES[bidder.counterpartyId]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Bid value">
        <CurrencyInput value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Reason — visible to the supplier" required>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. supplier phoned, portal unreachable"
          style={{ width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '7px 10px', fontSize: 13 }}
        />
      </Field>
      <Button
        variant="secondary"
        disabled={!value || reason.trim().length < 4}
        onClick={() =>
          dispatch({
            type: 'SUBMIT_BID',
            auctionLotId, bidderId, bidValue: Number(value),
            userId: state.currentUser.id, source: 'ON_BEHALF',
            onBehalfReason: reason, confirmed: true,
          })
        }
      >
        Place bid on behalf
      </Button>
      {result && result.bidderId === bidderId && (
        <ValidationBanner tone={result.accepted ? 'success' : 'error'} title={result.accepted ? 'Bid accepted' : 'Bid rejected'}>
          {result.message ?? 'The bid is in the ledger with an on-behalf marker.'}
        </ValidationBanner>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack 20 — results
// ---------------------------------------------------------------------------

function AuctionResults({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const [lotId, setLotId] = React.useState(state.auction.lots[0]?.id ?? '');

  const rows = buyerView(state.auction, lotId, COUNTERPARTY_NAMES).filter((r) => r.bidCount > 0);
  const lot = state.auction.lots.find((l) => l.id === lotId);
  const winner = rows[0];
  const startingPrice = lot?.startingPrice ?? 0;
  const savings = winner ? startingPrice - winner.transformedValue : 0;
  const lotDetail = lot ? state.auction.lotDetails[lot.lotId] : undefined;
  const insideReserve =
    winner && lotDetail?.reservePrice != null ? winner.transformedValue <= lotDetail.reservePrice : true;

  const bidCount = state.auction.bids.filter((b) => b.auctionLotId === lotId && b.isValid).length;
  const durationMs = lot?.closesAt && lot?.opensAt ? lot.closesAt - lot.opensAt : 0;

  const kpis: Kpi[] = [
    { icon: '🏆', value: winner ? winner.displayName.split(' ')[0] : '—', label: 'Winner', iconBg: color.warningSoft, iconFg: color.warningText, valueSize: 15 },
    { icon: '$', value: winner ? money(winner.bidValue, event.currency) : '—', label: 'Winning bid', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary, valueColor: color.brandPrimary },
    { icon: '$', value: winner ? money(winner.transformedValue, event.currency) : '—', label: 'Transformed value', iconBg: color.infoSoft, iconFg: color.infoText },
    {
      icon: '↓', value: signedMoney(savings, event.currency), label: 'Movement from start',
      iconBg: savings >= 0 ? color.successSoft : color.dangerSoft, iconFg: savingsColor(savings),
      valueColor: savingsColor(savings), valueSize: 15,
    },
    { icon: '▤', value: String(bidCount), label: 'Bids placed', iconBg: color.infoSoft, iconFg: color.infoText },
    {
      icon: '◷',
      value: durationMs ? `${Math.round(durationMs / 60_000)} min` : '—',
      label: `Duration${state.auction.auction.extensionsUsed ? ` +${state.auction.auction.extensionsUsed} ext` : ''}`,
      iconBg: color.warningSoft, iconFg: color.warningText, valueSize: 14,
    },
  ];

  const columns: Column<typeof rows[number]>[] = [
    {
      key: 'rank', header: '#', width: '54px',
      render: (row) => (
        <span style={{ fontSize: 15 }}>{['🥇', '🥈', '🥉'][row.rank - 1] ?? row.rank}</span>
      ),
    },
    { key: 'name', header: 'Bidder', render: (row) => <strong>{row.displayName}</strong> },
    { key: 'bid', header: 'Final bid', numeric: true, render: (row) => money(row.bidValue, event.currency) },
    {
      key: 'transformed', header: 'Transformed', numeric: true,
      render: (row) => <strong>{money(row.transformedValue, event.currency)}</strong>,
    },
    { key: 'bids', header: 'Bids', numeric: true, render: (row) => row.bidCount },
    {
      key: 'movement', header: 'Moved from start', numeric: true,
      render: (row) => (
        <span style={{ color: color.textSecondary }}>
          {signedMoney(startingPrice - row.transformedValue, event.currency)}
        </span>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {rows.length === 0 ? (
        <Card>
          <Empty
            icon="◈"
            title="No valid bids on this lot"
            hint="A failed auction is a result too. The event can go to negotiation, or the lot can be re-auctioned with a revised specification."
            action={<Button variant="secondary">Re-auction this lot</Button>}
          />
        </Card>
      ) : (
        <>
          <ValidationBanner tone="info" title="This result is a recommendation, not an award">
            The award and its approval are a separate, governed step. <em>Generate PO</em> appears only
            after award approval.
          </ValidationBanner>

          {!insideReserve && (
            <ValidationBanner tone="warning" title="Winning value is outside reserve">
              The reserve is the worst price at which we will award. Awarding at this value needs a
              justification and will show as a deviation on the NFA.
            </ValidationBanner>
          )}

          {rows.length === 1 && (
            <ValidationBanner tone="warning" title="Single-bid auction">
              Only one bidder placed a valid bid. A single-bid award is a deviation and carries a DoA
              uplift.
            </ValidationBanner>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state.auction.lots.map((auctionLot) => {
              const detail = state.auction.lotDetails[auctionLot.lotId];
              return (
                <Button
                  key={auctionLot.id}
                  variant={auctionLot.id === lotId ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => setLotId(auctionLot.id)}
                >
                  {detail?.name ?? auctionLot.lotId}
                </Button>
              );
            })}
          </div>

          <KpiRow kpis={kpis} />

          <Card padded={false} title="Final ranking" hint="Ranked on the transformed value.">
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.bidderId}
              rowStyle={(row) => (row.rank === 1 ? { background: '#FFFDF5' } : undefined)}
            />
          </Card>

          <Card title="Price movement" hint="Every valid bid on this lot, in sequence.">
            <PriceLadder eventId={eventId} lotId={lotId} startingPrice={startingPrice} />
          </Card>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary">Export result pack</Button>
            <Button
              variant="primary"
              onClick={() => dispatch({ type: 'UPDATE_EVENT', eventId, patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' } })}
            >
              Proceed to award →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PriceLadder({ eventId, lotId, startingPrice }: { eventId: string; lotId: string; startingPrice: number }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bids = state.auction.bids
    .filter((b) => b.auctionLotId === lotId && b.isValid)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  if (bids.length === 0) return <div style={{ fontSize: 12, color: color.textSecondary }}>No bids.</div>;

  const values = [startingPrice, ...bids.map((b) => b.transformedValue)];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  return (
    <div className="rfx-stack" style={{ gap: 6 }}>
      {bids.map((bid) => {
        const bidder = state.bidders.find((b) => b.id === bid.bidderId);
        const width = ((bid.transformedValue - min) / span) * 70 + 25;
        return (
          <div key={bid.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 165, fontSize: 11.5, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bidder ? COUNTERPARTY_NAMES[bidder.counterpartyId] : bid.bidderId}
            </span>
            <span style={{ flex: 1, minWidth: 0, height: 16, position: 'relative' }}>
              <span
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${width}%`,
                  background: color.accentPurple, opacity: 0.75, borderRadius: radius.pill,
                }}
              />
            </span>
            <span style={{ width: 90, fontSize: 11.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {money(bid.transformedValue, event.currency)}
            </span>
            <span style={{ width: 70, fontSize: 10.5, color: color.textSecondary, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {new Date(bid.submittedAt).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
