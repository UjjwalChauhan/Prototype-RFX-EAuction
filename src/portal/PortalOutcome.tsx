/**
 * Pack 24 — portal outcome.
 *
 * Every outcome explains itself and offers a next action. Regret disclosure
 * follows config.award.regret_disclosure, which is RANK_ONLY by default —
 * a regretted bidder is told their rank, not the winning price.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import { Button, Chip, Segmented } from '../design-system/components/primitives';
import { ValidationBanner } from '../design-system/components/domain';
import { bidderView } from '../server/auctionService';
import { useStore } from '../store/store';
import { COUNTERPARTY_NAMES, PORTAL_BIDDER_ID, PRIMARY_EVENT_ID } from '../data/seed';
import { PortalCard } from './PortalShell';

type RegretDisclosure = 'NONE' | 'RANK_ONLY' | 'RANK_AND_GAP' | 'FULL';

export function PortalOutcome() {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === PRIMARY_EVENT_ID)!;
  const view = bidderView(state.auction, 'al-1', PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);

  // Demonstration control: the buyer's configured disclosure level shapes what
  // a regretted bidder is told.
  const [disclosure, setDisclosure] = React.useState<RegretDisclosure>('RANK_ONLY');
  const [outcome, setOutcome] = React.useState<'awarded' | 'regretted' | 'pending'>('pending');

  const decided = event.status === 'AWARDED' || event.status === 'AWARD_PENDING_ONBOARDING';
  const effectiveOutcome = decided ? outcome : 'pending';

  return (
    <div className="rfx-stack" style={{ gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Outcomes</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14.5, color: color.textSecondary }}>
          What happened on the opportunities you took part in.
        </p>
      </div>

      {/* Demo affordance so both outcome paths are reachable. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: '#FBFCFD', border: `1px dashed ${color.border}`,
          borderRadius: radius.control, padding: '10px 14px',
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 700, color: color.textMuted, letterSpacing: '.05em' }}>
          PREVIEW
        </span>
        <Segmented
          size="small"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'pending', label: 'Decision pending' },
            { value: 'awarded', label: 'Awarded to you' },
            { value: 'regretted', label: 'Not selected' },
          ]}
        />
        <span style={{ fontSize: 11.5, color: color.textSecondary }}>Buyer's disclosure setting</span>
        <Segmented
          size="small"
          value={disclosure}
          onChange={setDisclosure}
          options={[
            { value: 'NONE', label: 'None' },
            { value: 'RANK_ONLY', label: 'Rank only' },
            { value: 'RANK_AND_GAP', label: 'Rank + gap' },
            { value: 'FULL', label: 'Full' },
          ]}
        />
      </div>

      {effectiveOutcome === 'pending' && (
        <PortalCard title={event.title} hint={`${event.eventNumber} · your bid is with the buyer`}>
          <ValidationBanner tone="info" title="A decision has not been made yet">
            Your bid is complete and under consideration. Winning the auction is not the same as being
            awarded — the buyer's own approvals come next, and we will tell you either way.
          </ValidationBanner>
          <div className="rfx-stack" style={{ gap: 12, marginTop: 16 }}>
            <Row label="Your final bid" value={view.myBestBid === null ? '—' : money(view.myBestBid, event.currency)} />
            <Row label="Bids you placed" value={String(view.myBidHistory.length)} />
            <Row label="Expected decision" value="Within 10 working days of the auction closing" />
          </div>
        </PortalCard>
      )}

      {effectiveOutcome === 'awarded' && (
        <PortalCard title="You have been awarded this contract" tone="urgent">
          <div
            style={{
              background: color.successSoft, border: '1px solid #86EFAC',
              borderRadius: radius.card, padding: '18px 20px',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: color.successText }}>
              🏆 {event.title}
            </div>
            <div style={{ fontSize: 14.5, marginTop: 6, lineHeight: 1.7 }}>
              Awarded at <strong>{view.myBestBid === null ? '—' : money(view.myBestBid, event.currency)}</strong>.
              A letter of award is attached below and has also been emailed to you.
            </div>
          </div>

          <div className="rfx-stack" style={{ gap: 12, marginTop: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>What happens next</div>
            {[
              { step: '1', label: 'Acknowledge the letter of award', detail: 'We need your acknowledgement within 5 working days.' },
              { step: '2', label: 'A purchase order follows', detail: 'Issued once the award is executed on the buyer\'s side.' },
              { step: '3', label: 'Deliver against the schedule', detail: 'Lead times as quoted, to the locations in the specification.' },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: 'flex', gap: 14, alignItems: 'flex-start',
                  border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: color.brandPrimarySoft, color: color.brandPrimary,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                  }}
                >
                  {item.step}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ display: 'block', fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
                    {item.detail}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <Button variant="primary">Acknowledge letter of award</Button>
            <Button variant="secondary">Download LoA (PDF)</Button>
          </div>
        </PortalCard>
      )}

      {effectiveOutcome === 'regretted' && (
        <PortalCard title="You were not selected this time">
          <div style={{ fontSize: 14.5, lineHeight: 1.75 }}>
            Thank you for bidding on <strong>{event.title}</strong>. The contract has been awarded to
            another supplier.
          </div>

          <div className="rfx-stack" style={{ marginTop: 16, gap: 12 }}>
            {/* Exactly what the buyer's disclosure setting permits, no more. */}
            {disclosure === 'NONE' && (
              <ValidationBanner tone="info" title="No competitive detail is shared for this event">
                This buyer does not disclose ranking information on regretted bids.
              </ValidationBanner>
            )}
            {disclosure !== 'NONE' && (
              <Row
                label="Your final position"
                value={view.projection.ownRank !== undefined ? `Rank ${view.projection.ownRank}` : 'Rank 2'}
              />
            )}
            {(disclosure === 'RANK_AND_GAP' || disclosure === 'FULL') && (
              <Row
                label="How far behind the winner"
                value={view.projection.gapPctBehind !== undefined ? `${view.projection.gapPctBehind.toFixed(1)}%` : '1.8%'}
              />
            )}
            {disclosure === 'FULL' && (
              <Row label="Winning value" value={money(147_200, event.currency)} />
            )}
            <Row label="Your final bid" value={view.myBestBid === null ? '—' : money(view.myBestBid, event.currency)} />
          </div>

          <div
            style={{
              marginTop: 18, background: color.brandPrimarySoft, borderRadius: radius.card,
              padding: '16px 18px',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>What you can do next</div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.8 }}>
              <li>Keep your certificates current — an expired document costs you eligibility, not price.</li>
              <li>Two similar opportunities in your categories are open now.</li>
              <li>Ask the sourcing desk for feedback; they will tell you what they can.</li>
            </ul>
            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="primary">See open opportunities</Button>
              <Button variant="secondary">Request feedback</Button>
            </div>
          </div>
        </PortalCard>
      )}

      <PortalCard title="Your history with this buyer">
        <div className="rfx-stack" style={{ gap: 12 }}>
          {[
            { name: 'Catering Supplies', reference: 'RFQ-2024-044', result: 'Awarded', tone: 'brand' as const, value: '$18,900' },
            { name: 'Janitorial Supplies', reference: 'RFQ-2024-041', result: 'Not selected', tone: 'neutral' as const, value: '—' },
            { name: 'IT Hardware Refresh', reference: 'RFP-2024-018', result: 'In progress', tone: 'gold' as const, value: 'pending' },
          ].map((row) => (
            <div
              key={row.reference}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ flex: 1, minWidth: 160 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{row.name}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: color.textSecondary }}>
                  {row.reference}
                </span>
              </span>
              <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
              <Chip tone={row.tone}>{row.result}</Chip>
            </div>
          ))}
        </div>
      </PortalCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingBottom: 10, borderBottom: `1px solid ${color.border}`,
      }}
    >
      <span style={{ fontSize: 14, color: color.textSecondary }}>{label}</span>
      <strong style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );
}
