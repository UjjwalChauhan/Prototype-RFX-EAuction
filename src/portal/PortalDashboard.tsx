/**
 * Pack 10 — portal dashboard and invitation.
 *
 * The task list is named by what the supplier does. Expiry warnings are
 * impossible to miss, and every task offers a next action.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import { Button, Chip, Textarea } from '../design-system/components/primitives';
import { Modal } from '../design-system/components/domain';
import { formatCountdown, serverNow } from '../server/clock';
import { vendorTaskLabel } from '../domain/journeyPatterns';
import { useStore } from '../store/store';
import { PORTAL_BIDDER_ID, PRIMARY_EVENT_ID } from '../data/seed';
import { PortalCard } from './PortalShell';
import type { PortalRoute } from './PortalShell';

interface Task {
  id: string;
  label: string;
  detail: string;
  deadline: number | null;
  done: boolean;
  route: PortalRoute;
  urgent?: boolean;
}

export function PortalDashboard({ onNavigate }: { onNavigate: (route: PortalRoute) => void }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === PRIMARY_EVENT_ID)!;
  const bidder = state.bidders.find((b) => b.id === PORTAL_BIDDER_ID)!;
  const auctionLot = state.auction.lots[0];
  const auctionLive = state.auction.auction.status === 'LIVE' || state.auction.auction.status === 'EXTENDED';

  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState('');

  const invited = bidder.invitationStatus === 'SENT' || bidder.invitationStatus === 'VIEWED';

  const tasks: Task[] = [
    {
      id: 'accept',
      label: 'Accept the invitation',
      detail: 'Tell us whether you will take part. You can decline with a reason.',
      deadline: null,
      done: bidder.invitationStatus === 'ACCEPTED',
      route: 'event',
    },
    {
      id: 'questionnaire',
      label: vendorTaskLabel('RFP'),
      detail: 'Company details, capability and certificates. Saved as you type.',
      deadline: event.closesAt,
      done: bidder.participationStatus !== 'NOT_STARTED',
      route: 'event',
    },
    {
      id: 'prices',
      label: vendorTaskLabel('RFQ'),
      detail: '6 lines across 3 lots. Enter online, or download the bid sheet and upload it back.',
      deadline: event.closesAt,
      done: true,
      route: 'event',
    },
    {
      id: 'bid',
      label: vendorTaskLabel('AUCTION'),
      detail: auctionLive
        ? 'The auction is open now. Every bid must improve on the leading position.'
        : 'The live auction has not opened yet. We will email and text you before it does.',
      deadline: auctionLot?.closesAt ?? null,
      done: false,
      route: 'bidding',
      urgent: auctionLive,
    },
  ];

  const outstanding = tasks.filter((t) => !t.done);

  return (
    <div className="rfx-stack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>My tasks</h1>
        <p style={{ margin: '6px 0 0', fontSize: 15, color: color.textSecondary }}>
          {outstanding.length === 0
            ? 'Nothing outstanding. We will let you know when something needs you.'
            : `${outstanding.length} thing${outstanding.length > 1 ? 's' : ''} need${outstanding.length > 1 ? '' : 's'} your attention.`}
        </p>
      </div>

      {auctionLive && (
        <div
          style={{
            background: '#450A0A', color: '#fff', borderRadius: 10, padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}
        >
          <span aria-hidden style={{ fontSize: 22, animation: 'rfx-pulse 1.2s infinite' }}>●</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>The auction is open now</div>
            <div style={{ fontSize: 13.5, color: '#FCA5A5', marginTop: 3 }}>
              {event.title} — you can place bids until the clock runs out.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11.5, color: '#FCA5A5' }}>Time left</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {auctionLot?.closesAt ? formatCountdown(auctionLot.closesAt - serverNow()) : '—'}
            </div>
          </div>
          <Button variant="primary" onClick={() => onNavigate('bidding')}>Go to bidding →</Button>
        </div>
      )}

      {invited && (
        <PortalCard tone="urgent" title="You have been invited to quote">
          <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>
            <strong>{event.title}</strong> — {event.eventNumber}.
            Estimated value {money(event.estimatedValue, event.currency)}.
            Responses close {event.closesAt ? new Date(event.closesAt).toLocaleString() : 'shortly'}.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={() =>
                dispatch({
                  type: 'UPDATE_BIDDER',
                  bidderId: PORTAL_BIDDER_ID,
                  patch: { invitationStatus: 'ACCEPTED', ndaAcceptedAt: Date.now() },
                })
              }
            >
              Accept and continue
            </Button>
            <Button variant="secondary" onClick={() => setDeclineOpen(true)}>Decline</Button>
          </div>
          <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 12 }}>
            Accepting means agreeing to the confidentiality terms. The full tender documents unlock once
            you accept.
          </div>
        </PortalCard>
      )}

      <div className="rfx-stack" style={{ gap: 12 }}>
        {tasks.map((task) => {
          const remaining = task.deadline === null ? null : task.deadline - serverNow();
          const soon = remaining !== null && remaining < 24 * 3_600_000;
          return (
            <div
              key={task.id}
              style={{
                background: '#fff',
                border: `1px solid ${task.urgent ? '#FCA5A5' : task.done ? color.border : soon ? '#FCD34D' : color.border}`,
                borderRadius: 10, padding: '16px 20px',
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: task.done ? color.successSoft : task.urgent ? color.dangerSoft : color.neutralSoft,
                  color: task.done ? color.successText : task.urgent ? color.dangerText : color.textMuted,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}
              >
                {task.done ? '✓' : task.urgent ? '●' : '○'}
              </span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: task.done ? color.textSecondary : color.textPrimary }}>
                  {task.label}
                </div>
                <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 3, lineHeight: 1.6 }}>
                  {task.detail}
                </div>
              </div>
              {remaining !== null && !task.done && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11.5, color: color.textSecondary }}>
                    {remaining < 0 ? 'Closed' : 'Time left'}
                  </div>
                  <div
                    style={{
                      fontSize: 15, fontWeight: 700,
                      color: remaining < 0 ? color.dangerText : soon ? color.warningText : color.textPrimary,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {remaining < 0 ? '—' : formatCountdown(remaining)}
                  </div>
                </div>
              )}
              {task.done ? (
                <Chip tone="brand" icon="✓">done</Chip>
              ) : (
                <Button variant={task.urgent ? 'primary' : 'secondary'} onClick={() => onNavigate(task.route)}>
                  {task.urgent ? 'Bid now' : 'Open'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <PortalCard title="How your bid will be assessed" hint="We publish this because you are entitled to know.">
        <div
          style={{
            background: color.brandPrimarySoft, borderRadius: radius.control,
            padding: '14px 16px', fontSize: 14, lineHeight: 1.8,
          }}
        >
          <strong>Award score</strong> = Price × 45% + Technical × 35% + Commercial terms × 10%
          + Performance rating × 10%
          <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 8 }}>
            Price is normalised by ratio: the best price scores 100 and others score in proportion.
            Price is counted once, and once only.
          </div>
        </div>
        <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 12, lineHeight: 1.7 }}>
          Some answers are assessed with AI assistance. A person always makes the final decision on
          every score.
        </div>
      </PortalCard>

      <Modal
        open={declineOpen}
        title="Decline this invitation"
        onClose={() => setDeclineOpen(false)}
        onConfirm={() => {
          dispatch({
            type: 'UPDATE_BIDDER',
            bidderId: PORTAL_BIDDER_ID,
            patch: { invitationStatus: 'DECLINED', declineReason },
          });
          setDeclineOpen(false);
        }}
        confirmLabel="Decline"
        confirmDisabled={declineReason.trim().length < 4}
      >
        <p style={{ margin: '0 0 12px' }}>
          Telling us why helps us send you better-matched opportunities. It does not count against you.
        </p>
        <Textarea
          rows={3}
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          placeholder="e.g. capacity constraints this quarter, outside our range, timeline too short"
        />
      </Modal>
    </div>
  );
}
