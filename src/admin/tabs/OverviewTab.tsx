/**
 * Event workspace — Overview.
 *
 * Renders correctly when the stages before it did not happen: sections for
 * stages the pattern excludes are hidden rather than shown empty.
 */
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip } from '../../design-system/components/primitives';
import { Card, Progress } from '../../design-system/components/layout';
import { AgentCard, ValidationBanner } from '../../design-system/components/domain';
import { JOURNEY_PATTERNS, STAGE_LABELS, evaluateTransition, vendorTaskLabel } from '../../domain/journeyPatterns';
import { AUCTION_STATUS_PRESENTATION } from '../../domain/statusMachine';
import { rankLot } from '../../domain/auctionEngine';
import { directionLabel } from '../../domain/comparator';
import { resolve } from '../../domain/config';
import { biddersForEvent, lotsForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES, SCOPE_LINEAGE } from '../../data/seed';

export function OverviewTab({ eventId, onGoTab }: { eventId: string; onGoTab: (tab: string) => void }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const pattern = JOURNEY_PATTERNS[event.journeyPattern];
  const lots = lotsForEvent(state, eventId);
  const bidders = biddersForEvent(state, eventId);

  const responded = bidders.filter(
    (b) => b.participationStatus === 'SUBMITTED' || b.participationStatus === 'BIDDING',
  );
  const isPrimaryAuction = state.auction.auction.eventId === eventId;
  const ranked = isPrimaryAuction
    ? rankLot(state.auction.bids, 'al-1', event.side, state.auction.auction.antiGaming.tieBidPolicy)
    : [];

  const feedbackPolicy = resolve(
    'auction.feedback_policy', state.configSettings,
    { ...SCOPE_LINEAGE, eventId }, 'BEST_PRICE' as string,
  );

  // A conditional auction only runs if its gate is met — show whether it is.
  const conditionalGate = event.journeyPattern === 'JP-04'
    ? evaluateTransition(
        { kind: 'BEST_BID_VS_TARGET', multiplier: 1.05 },
        {
          qualifiedBidderCount: bidders.filter((b) => b.qualificationStatus === 'QUALIFIED').length,
          estimatedValue: event.estimatedValue,
          bestBid: ranked[0]?.transformedValue ?? null,
          targetPrice: lots[0]?.targetPrice ?? null,
          technicalQualifiedCount: bidders.filter((b) => b.qualificationStatus === 'QUALIFIED').length,
        },
      )
    : null;

  const openClarifications = state.clarifications.filter((c) => c.eventId === eventId && c.answer === null);

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {conditionalGate && (
          <ValidationBanner
            tone={conditionalGate.met ? 'warning' : 'info'}
            title={conditionalGate.met ? 'Auction gate is met — the auction stage will run' : 'Auction gate is not met — the auction stage will be skipped'}
          >
            Condition: {conditionalGate.explanation}
          </ValidationBanner>
        )}

        {openClarifications.length > 0 && (
          <ValidationBanner
            tone="warning"
            title={`${openClarifications.length} clarification${openClarifications.length > 1 ? 's' : ''} awaiting an answer`}
            action={<Button size="small" variant="secondary" onClick={() => onGoTab('Clarifications')}>Answer</Button>}
          >
            An answer on scope, specification or commercial terms is broadcast to every bidder — that
            is not configurable, and not broadcasting is a common audit finding.
          </ValidationBanner>
        )}

        <Card title="Event details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 14 }}>
            {[
              ['Event number', event.eventNumber],
              ['Journey pattern', `${pattern.id} · ${pattern.name}`],
              ['Side', `${event.side} — ${directionLabel(event.side)}`],
              ['Category / BU', `${event.category} · ${event.businessUnit}`],
              ['Currency', event.currency],
              ['Estimated value', money(event.estimatedValue, event.currency)],
              ['Envelope mode', event.envelopeMode === 'TWO_ENVELOPE' ? 'Two envelope (sealed commercial)' : 'Single envelope'],
              ['Created from', `${event.createdFrom}${event.sourceReference ? ` · ${event.sourceReference}` : ''}`],
              ['Owner', event.ownerId.replace('user-', '').toUpperCase()],
              ['Version', `v${event.version}`],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: color.textSecondary }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>
          {event.description && (
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: color.textBody, lineHeight: 1.6 }}>
              {event.description}
            </p>
          )}
        </Card>

        <Card
          title="Lots"
          hint={`${lots.length} lot(s). Reserve and target prices are internal and never leave the buyer boundary.`}
          action={<Button size="small" variant="secondary" onClick={() => onGoTab('Items & Lots')}>Manage</Button>}
        >
          <div className="rfx-stack" style={{ gap: 9 }}>
            {lots.map((lot) => (
              <div
                key={lot.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{lot.name}</div>
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                    {lot.description || '—'} · award {lot.awardMode === 'SPLIT' ? 'split' : 'single winner'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11.5 }}>
                  <span title="Internal only — never shown to a bidder">
                    <span style={{ color: color.textSecondary }}>Target </span>
                    <strong>{lot.targetPrice === null ? '—' : money(lot.targetPrice, event.currency, { compact: true })}</strong>
                    <span style={{ marginLeft: 4 }}>🔒</span>
                  </span>
                  <span title="Constrains the award, not the bidding">
                    <span style={{ color: color.textSecondary }}>Reserve </span>
                    <strong>{lot.reservePrice === null ? '—' : money(lot.reservePrice, event.currency, { compact: true })}</strong>
                    <span style={{ marginLeft: 4 }}>🔒</span>
                  </span>
                </div>
                <Chip tone={lot.status === 'LOT_OPEN' ? 'danger' : 'neutral'}>{lot.status.replace('LOT_', '').toLowerCase()}</Chip>
              </div>
            ))}
          </div>
        </Card>

        {isPrimaryAuction && ranked.length > 0 && (
          <Card
            title="Live auction standing"
            hint="Ranked on the transformed value, never on the headline bid."
            action={<Button size="small" variant="primary" onClick={() => onGoTab('Auction')}>Open cockpit →</Button>}
          >
            <div className="rfx-stack" style={{ gap: 7 }}>
              {ranked.slice(0, 4).map((row) => {
                const bidder = state.bidders.find((b) => b.id === row.bidderId);
                return (
                  <div
                    key={row.bidderId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: row.rank === 1 ? '#F0FDF4' : '#fff',
                      border: `1px solid ${row.rank === 1 ? '#86EFAC' : color.border}`,
                      borderRadius: radius.control, padding: '8px 11px',
                    }}
                  >
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        background: row.rank === 1 ? color.successSoft : color.neutralSoft,
                        color: row.rank === 1 ? color.successText : color.textSecondary,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                      }}
                    >
                      {row.rank}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: row.rank === 1 ? 600 : 400 }}>
                      {bidder ? COUNTERPARTY_NAMES[bidder.counterpartyId] : row.bidderId}
                      <span style={{ color: color.textSecondary, marginLeft: 6, fontSize: 11 }}>
                        ({bidder?.maskedLabel})
                      </span>
                    </span>
                    <span style={{ fontSize: 11.5, color: color.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      bid {money(row.bidValue, event.currency)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {money(row.transformedValue, event.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Response progress">
          <Progress
            value={responded.length}
            max={Math.max(1, bidders.length)}
            label={`${responded.length} of ${bidders.length} bidders`}
          />
          <div className="rfx-stack" style={{ gap: 6, marginTop: 12 }}>
            {bidders.map((bidder) => (
              <div key={bidder.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {COUNTERPARTY_NAMES[bidder.counterpartyId]}
                </span>
                <Chip
                  tone={
                    bidder.participationStatus === 'BIDDING' || bidder.participationStatus === 'SUBMITTED' ? 'brand'
                    : bidder.participationStatus === 'REGISTERED' ? 'gold' : 'neutral'
                  }
                >
                  {bidder.participationStatus.toLowerCase().replace('_', ' ')}
                </Chip>
              </div>
            ))}
          </div>
        </Card>

        <Card title="What suppliers do" hint="The portal task rail is named by the supplier's action, never by our stage names.">
          <div className="rfx-stack" style={{ gap: 7 }}>
            {pattern.vendorInputPoints.length === 0 && (
              <div style={{ fontSize: 12, color: color.textSecondary }}>
                No supplier input on this pattern — it is a call-off against existing rates.
              </div>
            )}
            {pattern.vendorInputPoints.map((point) => (
              <div key={point} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span aria-hidden style={{ color: color.brandPrimary }}>▸</span>
                <span>{vendorTaskLabel(point)}</span>
                <Chip tone="neutral">{point}</Chip>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Configuration in force" hint="Effective value, and the scope it resolved from.">
          <div className="rfx-stack" style={{ gap: 9, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span style={{ color: color.textSecondary }}>Feedback policy</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <strong>{String(feedbackPolicy.value)}</strong>
                <Chip tone={feedbackPolicy.isLocked ? 'danger' : 'neutral'} icon={feedbackPolicy.isLocked ? '🔒' : '●'}>
                  {feedbackPolicy.resolvedFrom.toLowerCase()}
                </Chip>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: color.textSecondary }}>Auction status</span>
              <Chip tone="neutral">{AUCTION_STATUS_PRESENTATION[state.auction.auction.status].label}</Chip>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: color.textSecondary }}>Current stage</span>
              <strong>{STAGE_LABELS[event.currentStage]}</strong>
            </div>
          </div>
        </Card>

        <AgentCard
          code="AG-08"
          name="Compliance & Risk"
          autonomy="AUTONOMOUS"
          confidence={null}
          summary={
            bidders.some((b) => b.isProvisional)
              ? 'One invited counterparty is provisional and not on the vendor master. It may bid, but the award will hold at Award pending onboarding until onboarding completes.'
              : 'No compliance findings on this event.'
          }
          evidence={[
            { label: 'Vendor master', detail: 'Provisional flag on Metro Business Supplies' },
            { label: 'config.counterparty.provisional_award_allowed', detail: 'false at tenant scope' },
          ]}
        />
      </div>
    </div>
  );
}
