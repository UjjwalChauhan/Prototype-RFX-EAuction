/**
 * Pack 08 — Terms and Clarifications, plus the activity log.
 *
 * The fairness rule is hard-coded, not configurable: an answer on scope,
 * specification or commercial terms is broadcast to every bidder. "Publish to
 * all bidders" is the default action in the composer; a private reply is
 * secondary, labelled, and restricted to administrative matters.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import { Button, Chip, Radio, Textarea, Toggle } from '../../design-system/components/primitives';
import { Card, Empty, Table, type Column } from '../../design-system/components/layout';
import { AgentCard, Modal, ValidationBanner } from '../../design-system/components/domain';
import { useStore } from '../../store/store';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import { auditTrail } from '../../server/audit';
import type { Clarification, ClarificationVisibility } from '../../domain/types';

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export function ClarificationsTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const clarifications = state.clarifications.filter((c) => c.eventId === eventId);
  const [composing, setComposing] = React.useState<Clarification | null>(null);
  const [draftAnswer, setDraftAnswer] = React.useState('');
  // Broadcast is the default. A private reply must be chosen deliberately.
  const [visibility, setVisibility] = React.useState<ClarificationVisibility>('BROADCAST');
  const [revealAsker, setRevealAsker] = React.useState(false);
  const [corrigendumOpen, setCorrigendumOpen] = React.useState(false);

  const open = clarifications.filter((c) => c.answer === null);
  const answered = clarifications.filter((c) => c.answer !== null);

  const startComposing = (clarification: Clarification) => {
    setComposing(clarification);
    setDraftAnswer(
      clarification.agentDrafted
        ? 'Draft prepared by AG-05 from the tender documents. Review before publishing.'
        : '',
    );
    // Reset to the safe default every time the composer opens.
    setVisibility('BROADCAST');
  };

  const publish = () => {
    if (!composing) return;
    dispatch({
      type: 'ANSWER_CLARIFICATION',
      id: composing.id,
      answer: draftAnswer,
      visibility,
      userId: state.currentUser.id,
    });
    setComposing(null);
    setDraftAnswer('');
  };

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner tone="info" title="The fairness rule is not configurable">
        A clarification answer on scope, specification or commercial terms is broadcast to every bidder
        on this event. There is no mechanism to answer one bidder privately on a substantive matter.
        Private replies exist only for administrative questions, are labelled, and are logged.
      </ValidationBanner>

      <Card
        padded={false}
        title={`Awaiting an answer · ${open.length}`}
        hint="Answering is the default action. Not broadcasting is a common audit finding."
        action={<Button size="small" variant="secondary" onClick={() => setCorrigendumOpen(true)}>Publish corrigendum</Button>}
      >
        {open.length === 0 ? (
          <Empty icon="✓" title="Nothing awaiting an answer" hint="Every question raised has been answered." />
        ) : (
          <div>
            {open.map((clarification, i) => (
              <div
                key={clarification.id}
                style={{
                  padding: '13px 15px',
                  borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{clarification.subject}</span>
                  {clarification.visibility === 'PRIVATE_ADMINISTRATIVE' && (
                    <Chip tone="neutral" icon="✉" title="Administrative only — a private reply is permitted">
                      administrative
                    </Chip>
                  )}
                  {clarification.agentDrafted && <Chip tone="purple" icon="✦">AG-05 draft ready</Chip>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: color.textSecondary }}>
                    {new Date(clarification.askedAt).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: color.textBody, marginTop: 6, lineHeight: 1.6 }}>
                  {clarification.question}
                </div>
                <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 6 }}>
                  Asked by {clarification.revealAsker
                    ? COUNTERPARTY_NAMES[state.bidders.find((b) => b.id === clarification.askedByBidderId)?.counterpartyId ?? '']
                    : 'a bidder'}
                  {' · '}
                  <code style={{ fontSize: 10.5 }}>config.clarification.reveal_asker = false</code>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button size="small" variant="primary" onClick={() => startComposing(clarification)}>
                    Answer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padded={false} title={`Q&A register · ${answered.length} published`} hint="The register every bidder sees.">
        {answered.length === 0 ? (
          <Empty icon="▤" title="Nothing published yet" />
        ) : (
          <div>
            {answered.map((clarification, i) => (
              <div
                key={clarification.id}
                style={{ padding: '13px 15px', borderTop: i === 0 ? 'none' : `1px solid ${color.border}` }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{clarification.subject}</span>
                  <Chip tone={clarification.visibility === 'BROADCAST' ? 'brand' : 'neutral'} icon={clarification.visibility === 'BROADCAST' ? '◈' : '✉'}>
                    {clarification.visibility === 'BROADCAST' ? 'published to all bidders' : 'private · administrative'}
                  </Chip>
                </div>
                <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6 }}>
                  <strong>Q</strong> {clarification.question}
                </div>
                <div style={{ fontSize: 12.5, color: color.textPrimary, marginTop: 5, lineHeight: 1.6 }}>
                  <strong>A</strong> {clarification.answer}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AgentCard
        code="AG-05"
        name="Clarification"
        autonomy="DRAFT"
        confidence={0.71}
        summary="A draft answer to the index-linkage question is ready, citing clause 7.3 of the terms. AG-05 cannot publish it, and cannot answer privately on a substantive matter."
        evidence={[
          { label: 'Terms clause 7.3', detail: 'Price validity and index adjustment' },
          { label: 'RFP-2024-018', detail: 'Comparable answer given 4 months ago' },
        ]}
      />

      {/* Composer */}
      <Modal
        open={composing !== null}
        title="Answer clarification"
        width={560}
        onClose={() => setComposing(null)}
        onConfirm={publish}
        confirmLabel={visibility === 'BROADCAST' ? 'Publish to all bidders' : 'Send private reply'}
        confirmDisabled={draftAnswer.trim().length < 5}
      >
        {composing && (
          <div className="rfx-stack" style={{ gap: 14 }}>
            <div
              style={{
                background: color.neutralSoft, borderRadius: radius.control,
                padding: '9px 11px', fontSize: 12, lineHeight: 1.6,
              }}
            >
              <strong>{composing.subject}</strong>
              <div style={{ marginTop: 4, color: color.textBody }}>{composing.question}</div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Answer</div>
              <Textarea rows={5} value={draftAnswer} onChange={(e) => setDraftAnswer(e.target.value)} />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Visibility</div>
              <div className="rfx-stack" style={{ gap: 7 }}>
                <Radio
                  checked={visibility === 'BROADCAST'}
                  onChange={() => setVisibility('BROADCAST')}
                  label="Publish to all bidders (default)"
                  hint="Every bidder on the event receives the answer and it enters the Q&A register."
                />
                <Radio
                  checked={visibility === 'PRIVATE_ADMINISTRATIVE'}
                  onChange={() => setVisibility('PRIVATE_ADMINISTRATIVE')}
                  label="Private reply — administrative matters only"
                  hint="Permitted for portal access, contact details and similar. Never for scope, specification or commercial terms. Logged either way."
                />
              </div>
            </div>

            {visibility === 'PRIVATE_ADMINISTRATIVE' && (
              <ValidationBanner tone="warning" title="Private replies are logged and reviewable">
                If this question touches scope, specification or commercial terms, it must be broadcast.
                Answering it privately is the finding auditors look for.
              </ValidationBanner>
            )}

            <Toggle
              checked={revealAsker}
              onChange={setRevealAsker}
              label="Reveal which bidder asked"
            />
          </div>
        )}
      </Modal>

      <Modal
        open={corrigendumOpen}
        title="Publish a corrigendum"
        onClose={() => setCorrigendumOpen(false)}
        onConfirm={() => setCorrigendumOpen(false)}
        confirmLabel="Publish corrigendum"
      >
        <p style={{ margin: '0 0 10px' }}>
          A corrigendum republishes the amendment to every bidder on email, in-app <strong>and SMS</strong>.
        </p>
        <p style={{ margin: 0, color: color.textSecondary }}>
          By default it also reopens the response deadline
          (<code>config.event.corrigendum_reopens_deadline = true</code>), because bidders who already
          priced against the old documents need time to reprice.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export function TermsTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;

  const clauses = [
    { id: 'c1', ref: '3.1', title: 'Payment terms', body: 'Net 60 days from receipt of a valid invoice.', deviations: 1 },
    { id: 'c2', ref: '4.2', title: 'Delivery and lead time', body: 'Delivery to the named location within the quoted lead time; late delivery attracts the service credit at 5.4.', deviations: 0 },
    { id: 'c3', ref: '7.3', title: 'Price validity and index adjustment', body: 'Prices are firm for 12 months. Index adjustment applies only where explicitly agreed at award.', deviations: 2 },
    { id: 'c4', ref: '9.1', title: 'Liability cap', body: 'Liability capped at the contract value in the preceding 12 months.', deviations: 1 },
    { id: 'c5', ref: '11.4', title: 'Termination for convenience', body: '30 days written notice, no compensation beyond delivered goods.', deviations: 0 },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner tone="info" title="Deviations surface on the NFA">
        A deviation a bidder proposes is captured against its clause, not buried in an attachment, so it
        appears in the NFA's deviations section where an approver will see it.
      </ValidationBanner>

      <Card padded={false} title="Terms & conditions" hint={`Standard terms for ${event.category}. ${clauses.reduce((a, c) => a + c.deviations, 0)} deviations proposed across all bidders.`}>
        <div>
          {clauses.map((clause, i) => (
            <div
              key={clause.id}
              style={{
                display: 'flex', gap: 14, padding: '12px 15px',
                borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
              }}
            >
              <span
                style={{
                  fontSize: 11.5, fontWeight: 700, color: color.textSecondary,
                  fontFamily: 'ui-monospace, Menlo, monospace', width: 40, flexShrink: 0,
                }}
              >
                {clause.ref}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{clause.title}</div>
                <div style={{ fontSize: 12, color: color.textBody, marginTop: 3, lineHeight: 1.6 }}>{clause.body}</div>
              </div>
              {clause.deviations > 0 ? (
                <Chip tone="gold" icon="⚑">{clause.deviations} deviation{clause.deviations > 1 ? 's' : ''}</Chip>
              ) : (
                <Chip tone="brand" icon="✓">accepted by all</Chip>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  at: number;
  actor: string;
  action: string;
  object: string;
  reason: string | null;
}

export function ActivityTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const entries = auditTrail(eventId);

  const rows: ActivityRow[] = [
    ...entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      actor: entry.actorId,
      action: entry.action,
      object: `${entry.objectType} ${entry.objectId}`,
      reason: entry.reason,
    })),
    ...state.auction.controlEvents
      .filter(() => state.auction.auction.eventId === eventId)
      .map((event) => ({
        id: event.id,
        at: event.at,
        actor: event.actorId,
        action: `AUCTION_${event.kind}`,
        object: `Auction ${event.auctionId}`,
        reason: event.reason,
      })),
  ].sort((a, b) => b.at - a.at);

  const columns: Column<ActivityRow>[] = [
    {
      key: 'at', header: 'When', width: '160px',
      render: (row) => (
        <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
          {new Date(row.at).toLocaleString()}
        </span>
      ),
    },
    { key: 'actor', header: 'Actor', width: '120px', render: (row) => row.actor },
    {
      key: 'action', header: 'Action', width: '190px',
      render: (row) => <Chip tone={row.action.includes('REJECT') ? 'danger' : 'neutral'}>{row.action}</Chip>,
    },
    { key: 'object', header: 'Object', render: (row) => <span style={{ fontSize: 11.5 }}>{row.object}</span> },
    {
      key: 'reason', header: 'Reason',
      render: (row) => <span style={{ fontSize: 11.5, color: color.textSecondary }}>{row.reason ?? '—'}</span>,
    },
  ];

  return (
    <Card
      padded={false}
      title="Activity"
      hint="Append-only. Every state change records actor, timestamp, before/after and reason; controller actions are written before they take effect."
    >
      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        dense
        empty={
          <Empty
            icon="▤"
            title="No activity recorded yet in this session"
            hint="Place a bid or run a controller action and it appears here immediately — the ledger is written before the effect."
          />
        }
      />
    </Card>
  );
}
