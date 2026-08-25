/**
 * Pack 09 — Responses review.
 *
 * The point of this screen: a sealed envelope is *genuinely absent content*.
 * The commercial projection throws while sealed, and the sealed state is
 * rendered from that failure rather than from a blurred or greyed value. There
 * is no code path here that could show a sealed number.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Pill } from '../../design-system/components/primitives';
import { Card, Table, type Column } from '../../design-system/components/layout';
import { Modal, ValidationBanner } from '../../design-system/components/domain';
import { ENVELOPE_STATUS_PRESENTATION } from '../../domain/statusMachine';
import {
  SealedEnvelopeError, projectCommercial, projectTechnical,
  unlockCommercial, type ViewerContext,
} from '../../server/envelopeGuard';
import { useStore, biddersForEvent } from '../../store/store';
import { COUNTERPARTY_NAMES, LINE_ITEMS, QUESTIONNAIRE } from '../../data/seed';
import type { Envelope, EventBidder } from '../../domain/types';

export function ResponsesTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bidders = biddersForEvent(state, eventId);
  const responses = state.responses.filter((r) => r.eventId === eventId);

  /**
   * Envelopes live locally here so the unlock can be demonstrated end to end.
   * In production they are rows, and the seal is enforced at the data layer.
   */
  const [envelopes, setEnvelopes] = React.useState<Envelope[]>(() =>
    bidders.flatMap((bidder) => [
      {
        id: `env-tech-${bidder.id}`, eventId, bidderId: bidder.id, kind: 'TECHNICAL' as const,
        status: 'SUBMITTED' as const, sealed: false,
        submittedAt: Date.now() - 5 * 86_400_000, unlockedAt: null, unlockedBy: null, witnesses: [],
      },
      {
        id: `env-comm-${bidder.id}`, eventId, bidderId: bidder.id, kind: 'COMMERCIAL' as const,
        status: 'SEALED' as const,
        // Sealed while the event runs two envelopes.
        sealed: event.envelopeMode === 'TWO_ENVELOPE',
        submittedAt: Date.now() - 5 * 86_400_000, unlockedAt: null, unlockedBy: null, witnesses: [],
      },
    ]),
  );

  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [selectedBidderId, setSelectedBidderId] = React.useState(bidders[0]?.id ?? '');

  const viewer: ViewerContext = {
    userId: state.currentUser.id,
    permissions: state.currentUser.permissions,
    envelopeMode: event.envelopeMode,
    // Evaluators see "Bidder A", not the company name, to reduce incumbency bias.
    blindTechnical: true,
  };

  const commercialSealed = envelopes.some((e) => e.kind === 'COMMERCIAL' && e.sealed);
  const canUnlock = state.currentUser.permissions.includes('unlock_commercial');

  const doUnlock = () => {
    setEnvelopes((current) =>
      current.map((envelope) => {
        if (envelope.kind !== 'COMMERCIAL' || !envelope.sealed) return envelope;
        const result = unlockCommercial({
          envelope,
          // Witnessed unlock: two authorised users confirm, and both are recorded.
          mode: 'MANUAL_WITH_WITNESS',
          actorId: state.currentUser.id,
          witnessIds: ['user-mp'],
          permissions: state.currentUser.permissions,
          eventId,
        });
        return result.envelope;
      }),
    );
    setUnlockOpen(false);
  };

  const summaryColumns: Column<EventBidder>[] = [
    {
      key: 'bidder', header: 'Bidder', width: '200px',
      render: (bidder) => (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{bidder.maskedLabel}</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
            {viewer.blindTechnical ? 'identity concealed for technical evaluation' : COUNTERPARTY_NAMES[bidder.counterpartyId]}
          </div>
        </div>
      ),
    },
    {
      key: 'technical', header: 'Technical envelope',
      render: (bidder) => {
        const envelope = envelopes.find((e) => e.bidderId === bidder.id && e.kind === 'TECHNICAL')!;
        return <Pill presentation={ENVELOPE_STATUS_PRESENTATION[envelope.status]} size="small" />;
      },
    },
    {
      key: 'commercial', header: 'Commercial envelope',
      render: (bidder) => {
        const envelope = envelopes.find((e) => e.bidderId === bidder.id && e.kind === 'COMMERCIAL')!;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Pill presentation={ENVELOPE_STATUS_PRESENTATION[envelope.status]} size="small" />
            {envelope.witnesses.length > 0 && (
              <Chip tone="neutral" title={`Witnessed by ${envelope.witnesses.join(', ')}`}>witnessed</Chip>
            )}
          </span>
        );
      },
    },
    {
      key: 'submitted', header: 'Submitted', width: '150px',
      render: (bidder) => {
        const response = responses.find((r) => r.bidderId === bidder.id);
        return response?.submittedAt ? (
          <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(response.submittedAt).toLocaleString()}
          </span>
        ) : (
          <span style={{ fontSize: 11.5, color: color.textMuted }}>not submitted</span>
        );
      },
    },
    {
      key: 'actions', header: '', width: '110px',
      render: (bidder) => (
        <Button size="small" variant="secondary" onClick={() => setSelectedBidderId(bidder.id)}>
          Open
        </Button>
      ),
    },
  ];

  const selectedBidder = bidders.find((b) => b.id === selectedBidderId);
  const selectedResponse = responses.find((r) => r.bidderId === selectedBidderId);
  const commercialEnvelope = envelopes.find(
    (e) => e.bidderId === selectedBidderId && e.kind === 'COMMERCIAL',
  );

  const technicalProjection = selectedResponse && selectedBidder
    ? projectTechnical(
        selectedResponse, QUESTIONNAIRE.questions,
        COUNTERPARTY_NAMES[selectedBidder.counterpartyId], selectedBidder.maskedLabel, viewer,
      )
    : null;

  // The read is attempted; the sealed state is rendered from the refusal.
  let commercialProjection: ReturnType<typeof projectCommercial> | null = null;
  let commercialRefusal: string | null = null;
  if (selectedResponse && selectedBidder && commercialEnvelope) {
    try {
      commercialProjection = projectCommercial(
        selectedResponse, QUESTIONNAIRE.questions, commercialEnvelope,
        COUNTERPARTY_NAMES[selectedBidder.counterpartyId], viewer,
      );
    } catch (error) {
      commercialRefusal = error instanceof SealedEnvelopeError
        ? error.message
        : 'The commercial envelope is not readable by this user.';
    }
  }

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {commercialSealed && (
        <ValidationBanner
          tone="info"
          title="Commercial envelopes are sealed"
          action={
            canUnlock ? (
              <Button size="small" variant="primary" onClick={() => setUnlockOpen(true)}>Unlock commercial</Button>
            ) : undefined
          }
        >
          Sealed envelopes are encrypted at rest and the key is released only by the unlock event. No
          user — including a platform administrator — can read a sealed bid before reveal.
          {!canUnlock && ' Your role does not hold unlock_commercial.'}
        </ValidationBanner>
      )}

      {technicalProjection && technicalProjection.attachmentIdentityWarnings.length > 0 && (
        <ValidationBanner tone="warning" title="An attachment filename would break blind evaluation">
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {technicalProjection.attachmentIdentityWarnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </ValidationBanner>
      )}

      <Card padded={false} title="Responses" hint="Envelope status per bidder. Technical and commercial move independently.">
        <Table columns={summaryColumns} rows={bidders} rowKey={(b) => b.id} />
      </Card>

      {selectedBidder && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 14 }}>
          <Card
            title={`Technical — ${selectedBidder.maskedLabel}`}
            hint="Identity concealed across the list, the answers and attachment metadata."
          >
            {technicalProjection === null ? (
              <div style={{ fontSize: 12, color: color.textSecondary }}>No response submitted.</div>
            ) : (
              <div className="rfx-stack" style={{ gap: 11 }}>
                {technicalProjection.answers.map((answer) => {
                  const question = QUESTIONNAIRE.questions.find((q) => q.id === answer.questionId);
                  if (!question) return null;
                  return (
                    <div key={answer.questionId} style={{ borderBottom: `1px solid ${color.border}`, paddingBottom: 9 }}>
                      <div style={{ fontSize: 11.5, color: color.textSecondary }}>{question.title}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3 }}>
                        {String(answer.value)}
                      </div>
                      {answer.attachmentName && (
                        <div style={{ fontSize: 11, color: color.brandPrimary, marginTop: 3 }}>
                          📎 {answer.attachmentName}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title={`Commercial — ${commercialRefusal ? 'sealed' : COUNTERPARTY_NAMES[selectedBidder.counterpartyId]}`}
            hint={commercialRefusal ? 'Content is absent, not hidden.' : 'Unlocked. Prices are readable.'}
          >
            {commercialRefusal ? (
              /* Nothing numeric is rendered here, because nothing numeric was
                 returned. This is the difference between sealed and blurred. */
              <div
                style={{
                  padding: '30px 18px', textAlign: 'center',
                  background: color.neutralSoft, borderRadius: radius.control,
                }}
              >
                <div aria-hidden style={{ fontSize: 26 }}>🔒</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Sealed commercial envelope</div>
                <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 6, lineHeight: 1.6, maxWidth: 320, marginInline: 'auto' }}>
                  {commercialRefusal}
                </div>
              </div>
            ) : commercialProjection ? (
              <div className="rfx-stack" style={{ gap: 10 }}>
                <div className="rfx-scroll-x">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: color.textSecondary, fontSize: 11 }}>Line</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: color.textSecondary, fontSize: 11 }}>Unit</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: color.textSecondary, fontSize: 11 }}>Extended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commercialProjection.priceLines.map((line) => {
                        const item = LINE_ITEMS.find((l) => l.id === line.lineItemId);
                        return (
                          <tr key={line.lineItemId} style={{ borderTop: `1px solid ${color.border}` }}>
                            <td style={{ padding: '6px 8px' }}>{item?.description ?? line.lineItemId}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {money(line.unitPrice, line.currency)}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                              {money(line.unitPrice * (item?.quantity ?? 1), line.currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {commercialProjection.answers.map((answer) => {
                  const question = QUESTIONNAIRE.questions.find((q) => q.id === answer.questionId);
                  return (
                    <div key={answer.questionId} style={{ fontSize: 12 }}>
                      <span style={{ color: color.textSecondary }}>{question?.title}: </span>
                      <strong>{String(answer.value)}</strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: color.textSecondary }}>No commercial response.</div>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={unlockOpen}
        title="Unlock commercial envelopes"
        onClose={() => setUnlockOpen(false)}
        onConfirm={doUnlock}
        confirmLabel="Unlock with witness"
      >
        <p style={{ margin: '0 0 10px' }}>
          This releases the decryption key for {envelopes.filter((e) => e.kind === 'COMMERCIAL' && e.sealed).length}{' '}
          sealed commercial envelopes. <strong>It is irreversible.</strong>
        </p>
        <p style={{ margin: '0 0 10px' }}>
          Unlock mode is <code>MANUAL_WITH_WITNESS</code>: a second authorised user confirms, and both
          names are recorded in the audit log alongside the timestamp.
        </p>
        <div
          style={{
            background: color.neutralSoft, borderRadius: radius.control,
            padding: '9px 11px', fontSize: 12,
          }}
        >
          Actor: <strong>{state.currentUser.name}</strong><br />
          Witness: <strong>M. Prasad</strong>
        </div>
      </Modal>
    </div>
  );
}
