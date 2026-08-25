/**
 * Pack 07 — Bidders and invitations.
 *
 * Two invariants the table enforces:
 *   - Invitation status and participation status are separate columns.
 *   - Onboarding rating and performance rating are visually distinct.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import { Button, Chip, Pill } from '../../design-system/components/primitives';
import { Card, Table, type Column } from '../../design-system/components/layout';
import { Drawer, ValidationBanner } from '../../design-system/components/domain';
import {
  INVITATION_STATUS_PRESENTATION, PARTICIPATION_STATUS_PRESENTATION,
} from '../../domain/statusMachine';
import { biddersForEvent, useStore } from '../../store/store';
import { COUNTERPARTIES, COUNTERPARTY_NAMES } from '../../data/seed';
import type { EventBidder } from '../../domain/types';

export function BiddersTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const bidders = biddersForEvent(state, eventId);
  const [drawerBidder, setDrawerBidder] = React.useState<EventBidder | null>(null);

  const provisional = bidders.filter((b) => b.isProvisional);
  const accepted = bidders.filter((b) => b.invitationStatus === 'ACCEPTED');
  const joined = bidders.filter(
    (b) => b.participationStatus === 'JOINED' || b.participationStatus === 'BIDDING',
  );

  const columns: Column<EventBidder>[] = [
    {
      key: 'name', header: 'Counterparty', width: '230px',
      render: (bidder) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{COUNTERPARTY_NAMES[bidder.counterpartyId]}</span>
            {bidder.isProvisional && <Chip tone="gold" icon="⚑" title="Not on the vendor master">provisional</Chip>}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
            {bidder.maskedLabel} · masked label used under blind evaluation
          </div>
        </div>
      ),
    },
    {
      // Axis 1.
      key: 'invitation', header: 'Invitation',
      render: (bidder) => (
        <Pill presentation={INVITATION_STATUS_PRESENTATION[bidder.invitationStatus]} size="small" />
      ),
    },
    {
      // Axis 2 — never merged with axis 1.
      key: 'participation', header: 'Participation',
      render: (bidder) => (
        <Pill
          presentation={PARTICIPATION_STATUS_PRESENTATION[bidder.participationStatus]}
          size="small"
          live={bidder.participationStatus === 'BIDDING'}
        />
      ),
    },
    {
      key: 'onboarding', header: 'Onboarding', numeric: true,
      render: (bidder) => (
        <span
          title="Compliance, categories served, locations served"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: color.infoSoft, color: color.infoText,
            borderRadius: radius.pill, padding: '2px 8px', fontSize: 11.5, fontWeight: 700,
          }}
        >
          ◔ {bidder.qualificationSnapshot}
        </span>
      ),
    },
    {
      key: 'performance', header: 'Performance', numeric: true,
      render: (bidder) =>
        bidder.performanceRatingSnapshot === 0 ? (
          <span style={{ fontSize: 11, color: color.textMuted }}>no history</span>
        ) : (
          <span
            title="RFx, auction, award, fulfilment and commercial parameters"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: color.accentPurpleSoft, color: color.accentPurpleText,
              borderRadius: radius.pill, padding: '2px 8px', fontSize: 11.5, fontWeight: 700,
            }}
          >
            ★ {bidder.performanceRatingSnapshot}
          </span>
        ),
    },
    {
      key: 'nda', header: 'Gating',
      render: (bidder) =>
        bidder.ndaAcceptedAt ? (
          <Chip tone="brand" icon="✓">NDA accepted</Chip>
        ) : (
          <Chip tone="gold" icon="◷">NDA pending</Chip>
        ),
    },
    {
      key: 'onbehalf', header: 'On behalf',
      render: (bidder) =>
        bidder.bidOnBehalfAllowed ? (
          <Chip tone="danger" icon="!" title="A bid placed on their behalf always writes an audit marker visible to the supplier">
            permitted
          </Chip>
        ) : (
          <span style={{ fontSize: 11, color: color.textMuted }}>—</span>
        ),
    },
    {
      key: 'actions', header: '', width: '90px',
      render: (bidder) => (
        <Button size="small" variant="secondary" onClick={() => setDrawerBidder(bidder)}>Details</Button>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {bidders.length < 3 && (
        <ValidationBanner tone="warning" title="Fewer than three bidders">
          With fewer than three qualified bidders an auction is not the right instrument. Negotiate
          instead, or run a sealed bid to establish a record.
        </ValidationBanner>
      )}

      {provisional.length > 0 && (
        <ValidationBanner tone="info" title={`${provisional.length} provisional counterparty on this event`}>
          A provisional counterparty can bid. It cannot be awarded until onboarding completes — the
          award holds at <strong>Award pending onboarding</strong>.
        </ValidationBanner>
      )}

      <Card
        padded={false}
        title="Bidders"
        hint={`${bidders.length} invited · ${accepted.length} accepted · ${joined.length} in the live room. Accepting an invitation and joining a room are different things.`}
        action={<Button size="small" variant="primary">＋ Invite bidder</Button>}
      >
        <Table columns={columns} rows={bidders} rowKey={(b) => b.id} />
      </Card>

      <Card title="Not yet invited" hint="From the vendor master, filtered to this category.">
        <div className="rfx-stack" style={{ gap: 8 }}>
          {COUNTERPARTIES.filter((cp) => !bidders.some((b) => b.counterpartyId === cp.id)).length === 0 ? (
            <div style={{ fontSize: 12, color: color.textSecondary }}>
              Every registered counterparty in this category is already invited.
            </div>
          ) : (
            COUNTERPARTIES.filter((cp) => !bidders.some((b) => b.counterpartyId === cp.id)).map((cp) => (
              <div
                key={cp.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '9px 12px',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{cp.name}</span>
                <Button size="small" variant="secondary">Invite</Button>
              </div>
            ))
          )}
        </div>
      </Card>

      <Drawer
        open={drawerBidder !== null}
        title={drawerBidder ? COUNTERPARTY_NAMES[drawerBidder.counterpartyId] : ''}
        subtitle={drawerBidder ? `${drawerBidder.maskedLabel} · invited ${drawerBidder.invitedAt ? new Date(drawerBidder.invitedAt).toLocaleDateString() : '—'}` : ''}
        onClose={() => setDrawerBidder(null)}
        footer={
          drawerBidder && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  dispatch({
                    type: 'UPDATE_BIDDER',
                    bidderId: drawerBidder.id,
                    patch: { qualificationStatus: 'SHORTLISTED' },
                  });
                  setDrawerBidder(null);
                }}
              >
                Shortlist
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  dispatch({
                    type: 'UPDATE_BIDDER',
                    bidderId: drawerBidder.id,
                    patch: {
                      disqualified: true,
                      qualificationStatus: 'DISQUALIFIED',
                      disqualificationReason: 'Manual disqualification by the buyer.',
                    },
                  });
                  setDrawerBidder(null);
                }}
              >
                Disqualify
              </Button>
            </div>
          )
        }
      >
        {drawerBidder && (
          <div className="rfx-stack" style={{ gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Two ratings, deliberately separate</div>
              <div className="rfx-stack" style={{ gap: 8 }}>
                <RatingRow
                  label="Onboarding rating"
                  value={drawerBidder.qualificationSnapshot}
                  hint="Compliance, categories served, locations served. Frozen at invite."
                  tone="info"
                />
                <RatingRow
                  label="Performance rating"
                  value={drawerBidder.performanceRatingSnapshot}
                  hint="RFx, auction, award, fulfilment and commercial parameters. Recurring."
                  tone="purple"
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Status</div>
              <div className="rfx-stack" style={{ gap: 7, fontSize: 12 }}>
                <Row label="Invitation">
                  <Pill presentation={INVITATION_STATUS_PRESENTATION[drawerBidder.invitationStatus]} size="small" />
                </Row>
                <Row label="Participation">
                  <Pill presentation={PARTICIPATION_STATUS_PRESENTATION[drawerBidder.participationStatus]} size="small" />
                </Row>
                <Row label="Qualification">{drawerBidder.qualificationStatus}</Row>
                <Row label="Award">{drawerBidder.awardStatus}</Row>
              </div>
            </div>

            {drawerBidder.disqualified && (
              <ValidationBanner tone="error" title="Disqualified">
                {drawerBidder.disqualificationReason} — reversible with a reason.
              </ValidationBanner>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function RatingRow({
  label, value, hint, tone,
}: { label: string; value: number; hint: string; tone: 'info' | 'purple' }) {
  const fg = tone === 'info' ? color.infoText : color.accentPurpleText;
  const bg = tone === 'info' ? color.infoSoft : color.accentPurpleSoft;
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            background: bg, color: fg, borderRadius: radius.pill,
            padding: '2px 10px', fontSize: 13, fontWeight: 700,
          }}
        >
          {value === 0 ? 'no history' : value}
        </span>
      </div>
      <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: color.textSecondary }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}
