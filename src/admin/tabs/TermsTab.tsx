/**
 * Event workspace — Terms.
 *
 * What this ask actually sends a supplier, and what they have to do about it.
 *
 * Opened on an ask, the tab shows the documents applied at that point: the
 * general conditions, and — where a price is asked — the payment terms.
 * Opened on the sourcing event, it shows every document with the asks each one
 * reaches, because from the board the question is what the event goes out with.
 *
 * A deviation a bidder proposes is shown against the clause it is about rather
 * than buried in an attachment, which is what lets it appear in the NFA's
 * deviations section where an approver will see it.
 */
import React from 'react';
import { color } from '../../design-system/tokens';
import { Chip } from '../../design-system/components/primitives';
import { Card, Empty } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import { stageEventsOf, termsForEvent, useStore } from '../../store/store';
import {
  ACKNOWLEDGEMENT_LABEL, PRICED_POINTS, TERMS_CATEGORY_LABEL, TERMS_CATEGORY_PURPOSE,
  describeTerms, mustAcknowledge, paymentSummary, termsForPoint,
  type TermsDocument,
} from '../../domain/terms';
import { isStageEvent } from '../../domain/stageEvents';
import type { VendorInputPoint } from '../../domain/types';

export function TermsTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const isAsk = isStageEvent(event);
  const documents = termsForEvent(state, eventId);

  if (documents.length === 0) {
    return (
      <Card padded={false}>
        <Empty
          icon="▤"
          title={isAsk ? 'No terms are applied at this ask' : 'This event has no terms attached'}
          hint={
            isAsk
              ? 'Terms belong to the sourcing event and name the asks they apply at. Open the event to attach a document here.'
              : 'Events published before the terms library, and seeded demonstration events, carry their terms as an attachment rather than as clauses.'
          }
        />
      </Card>
    );
  }

  const acknowledged = mustAcknowledge(documents);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner tone="info" title="Deviations surface on the NFA">
        A deviation a bidder proposes is captured against its clause, not buried in an attachment, so
        it appears in the NFA's deviations section where an approver will see it. A clause marked
        non-negotiable is a rejection rather than a negotiation.
      </ValidationBanner>

      <Card
        title={isAsk ? `Applied at ${pointName(event.currentStage as VendorInputPoint)}` : 'Terms attached to this event'}
        hint={describeTerms(documents)}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>
            <strong>{documents.length}</strong> document{documents.length === 1 ? '' : 's'}
          </span>
          <span>
            <strong>{documents.reduce((sum, d) => sum + d.clauses.length, 0)}</strong> clauses
          </span>
          <span>
            <strong>{acknowledged.length}</strong> the supplier must confirm
          </span>
          <span>
            <strong>{documents.filter((d) => !d.allowDeviation).length}</strong> closed to deviation
          </span>
        </div>
      </Card>

      {!isAsk && <Coverage eventId={eventId} documents={documents} />}

      {documents.map((document) => (
        <TermsCard key={document.id} document={document} />
      ))}
    </div>
  );
}

const pointName = (point: VendorInputPoint) => ({
  INTAKE: 'intake', RFI: 'the RFI', RFP: 'the RFP', RFQ: 'the RFQ',
  NEGOTIATION: 'negotiation', AUCTION: 'the auction',
}[point] ?? point);

/** Which ask carries which document — the question a buyer opens this tab with. */
function Coverage({ eventId, documents }: { eventId: string; documents: TermsDocument[] }) {
  const { state } = useStore();
  const asks = stageEventsOf(state, eventId);
  if (asks.length === 0) return null;

  const head: React.CSSProperties = {
    textAlign: 'left', padding: '9px 11px', fontSize: 11, color: color.textSecondary,
    borderBottom: `1px solid ${color.border}`, whiteSpace: 'nowrap',
  };

  return (
    <Card
      padded={false}
      title="What each ask carries"
      hint="One document applied at several asks is one document, not a copy per ask."
    >
      <div className="rfx-scroll-x">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={head}>Terms</th>
              {asks.map((ask) => (
                <th key={ask.id} style={{ ...head, textAlign: 'center', width: 110 }}>
                  {ask.currentStage}
                  <div style={{ fontWeight: 400, textTransform: 'none' }}>{ask.eventNumber}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} style={{ borderTop: `1px solid ${color.border}` }}>
                <td style={{ padding: '9px 11px' }}>
                  <span style={{ fontWeight: 600 }}>{document.title}</span>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                    {TERMS_CATEGORY_LABEL[document.category]} · v{document.version}
                  </div>
                </td>
                {asks.map((ask) => {
                  const on = document.appliesTo.includes(ask.currentStage as VendorInputPoint);
                  return (
                    <td key={ask.id} style={{ padding: '9px 11px', textAlign: 'center' }}>
                      {on
                        ? <span style={{ color: color.brandPrimary, fontWeight: 700 }}>✓</span>
                        : <span style={{ color: color.textMuted }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* A priced ask with no payment terms is the hole worth naming. */}
            {asks
              .filter((ask) => PRICED_POINTS.includes(ask.currentStage as VendorInputPoint))
              .filter((ask) => termsForPoint(documents, ask.currentStage as VendorInputPoint)
                .every((document) => document.category !== 'PAYMENT'))
              .map((ask) => (
                <tr key={`gap-${ask.id}`} style={{ borderTop: `1px solid ${color.border}` }}>
                  <td colSpan={asks.length + 1} style={{ padding: '9px 11px', color: color.warningText }}>
                    {ask.eventNumber} asks for a price with no payment terms applied.
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** One document, with its clauses and any deviations against them. */
function TermsCard({ document }: { document: TermsDocument }) {
  const { state } = useStore();
  // Deviations are proposed by bidders against a clause. None are recorded in
  // this prototype's data, so the count is honest rather than decorative.
  const deviationsFor = (clauseId: string) =>
    state.clarifications.filter((c) => c.eventId === document.eventId && c.subject === clauseId).length;

  return (
    <Card
      padded={false}
      title={document.title}
      hint={TERMS_CATEGORY_PURPOSE[document.category]}
      action={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone="brand">{TERMS_CATEGORY_LABEL[document.category]}</Chip>
          <Chip tone="neutral">v{document.version}</Chip>
        </div>
      }
    >
      <div
        style={{
          display: 'flex', gap: 14, flexWrap: 'wrap', padding: '11px 15px',
          borderBottom: `1px solid ${color.border}`, fontSize: 12, color: color.textSecondary,
        }}
      >
        <span>{ACKNOWLEDGEMENT_LABEL[document.acknowledgement]}</span>
        <span>·</span>
        <span>
          {document.allowDeviation
            ? 'Deviations may be proposed'
            : 'Closed to deviation — accept as written'}
        </span>
        {document.attachmentName && (
          <>
            <span>·</span>
            <span>📎 {document.attachmentName}</span>
          </>
        )}
        <span>·</span>
        <span>
          Applied at {document.appliesTo.length === 0
            ? 'no ask'
            : document.appliesTo.map((point) => pointName(point)).join(', ')}
        </span>
      </div>

      {document.payment && (
        <div
          style={{
            padding: '11px 15px', borderBottom: `1px solid ${color.border}`,
            background: color.surface,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>Payment figures</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>{paymentSummary(document.payment)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <Chip tone="neutral">Credit {document.payment.creditDays} days</Chip>
            {document.payment.advancePct > 0 && (
              <Chip tone="gold">Advance {document.payment.advancePct}%</Chip>
            )}
            {document.payment.retentionPct > 0 && (
              <Chip tone="gold">Retention {document.payment.retentionPct}%</Chip>
            )}
            <Chip tone="neutral">{document.payment.priceBasis.toLowerCase()} price</Chip>
          </div>
        </div>
      )}

      {document.clauses.length === 0 ? (
        <div style={{ padding: '14px 15px', fontSize: 12.5, color: color.textSecondary }}>
          Sent as the attached document rather than as clauses here.
        </div>
      ) : (
        <div>
          {document.clauses.map((clause, i) => {
            const deviations = deviationsFor(clause.id);
            return (
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
                  {clause.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {clause.title}
                    {clause.nonNegotiable && (
                      <Chip tone="danger" title="A deviation here is a rejection, not a negotiation">
                        non-negotiable
                      </Chip>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: color.textBody, marginTop: 3, lineHeight: 1.6 }}>
                    {clause.text}
                  </div>
                </div>
                {deviations > 0
                  ? <Chip tone="gold" icon="⚑">{deviations} deviation{deviations > 1 ? 's' : ''}</Chip>
                  : (
                    <span style={{ fontSize: 11, color: color.textMuted, whiteSpace: 'nowrap' }}>
                      no deviation
                    </span>
                  )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
