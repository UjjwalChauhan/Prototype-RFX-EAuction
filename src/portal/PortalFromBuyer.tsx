/**
 * What the buyer has asked this supplier, and where their prices stand.
 *
 * When a buyer's evaluator finds something only the supplier can settle — a
 * price left blank, a total that does not add up, an offer that expires before
 * the decision — the question lands here, in plain words, with a way to answer
 * it. Nothing on this page says how a price is being evaluated: the supplier
 * is told that their prices are received, being checked, or checked, and is
 * asked questions like a person would ask them. They never see a rank, an
 * adjustment, another supplier, or the word "evaluation" next to a number.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Chip, Field, NumberInput, Textarea } from '../design-system/components/primitives';
import { useStore } from '../store/store';
import { serverNow } from '../server/clock';
import {
  SIGNAL_TEXT, dueText, repliesTo, requestState, type BuyerRequest,
} from '../domain/buyerRequests';
import { PortalCard } from './PortalShell';

/** Requests addressed to this supplier, across every event they are invited to. */
export function requestsFor(
  state: ReturnType<typeof useStore>['state'], counterpartyId: string,
): BuyerRequest[] {
  const mine = new Set(state.bidders.filter((b) => b.counterpartyId === counterpartyId).map((b) => b.id));
  return state.buyerRequests.filter((r) => mine.has(r.bidderId));
}

/** How many are waiting on this supplier — the number on the rail and the home page. */
export function waitingOnSupplier(
  state: ReturnType<typeof useStore>['state'], counterpartyId: string,
): number {
  return requestsFor(state, counterpartyId)
    .filter((r) => requestState(r, state.buyerReplies) === 'WAITING_FOR_SUPPLIER').length;
}

export function PortalFromBuyer({ counterpartyId }: { counterpartyId: string }) {
  const { state } = useStore();
  const mine = requestsFor(state, counterpartyId);
  const waiting = mine.filter((r) => requestState(r, state.buyerReplies) === 'WAITING_FOR_SUPPLIER');
  const answered = mine.filter((r) => requestState(r, state.buyerReplies) === 'REPLIED');
  const closed = mine.filter((r) => r.status === 'CLOSED');
  const myBidderIds = new Set(state.bidders.filter((b) => b.counterpartyId === counterpartyId).map((b) => b.id));
  const signals = state.reviewSignals.filter((s) => myBidderIds.has(s.bidderId));
  const eventTitle = (id: string) => state.events.find((e) => e.id === id)?.title ?? 'An opportunity';

  return (
    <div className="rfx-stack" style={{ gap: 22, maxWidth: 820 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>From the buyer</h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: color.textSecondary, lineHeight: 1.6 }}>
          Questions the buyer needs you to answer, and where your prices stand.
        </p>
      </div>

      {signals.length > 0 && (
        <PortalCard title="Your prices" hint="We tell you when each stage is done. Outcomes come with the award decision.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            {signals.map((signal) => (
              <div
                key={signal.id}
                style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{eventTitle(signal.eventId)}</span>
                  <Chip tone={signal.stage === 'COMPLETE' ? 'brand' : 'gold'} icon={signal.stage === 'COMPLETE' ? '✓' : '…'}>
                    {SIGNAL_TEXT[signal.stage].label}
                  </Chip>
                </div>
                <div style={{ fontSize: 14, color: color.textSecondary, marginTop: 6, lineHeight: 1.6 }}>
                  {SIGNAL_TEXT[signal.stage].note}
                </div>
              </div>
            ))}
          </div>
        </PortalCard>
      )}

      <PortalCard
        title={waiting.length > 0 ? `Waiting for your reply (${waiting.length})` : 'Waiting for your reply'}
        tone={waiting.length > 0 ? 'urgent' : 'default'}
      >
        {waiting.length === 0 ? (
          <div style={{ fontSize: 14.5, color: color.textSecondary }}>
            Nothing right now. If the buyer needs something from you, it will appear here.
          </div>
        ) : (
          <div className="rfx-stack" style={{ gap: 14 }}>
            {waiting.map((request) => (
              <RequestCard key={request.id} request={request} eventTitle={eventTitle(request.eventId)} />
            ))}
          </div>
        )}
      </PortalCard>

      {answered.length > 0 && (
        <PortalCard title="Sent — waiting for the buyer" hint="You have answered these. The buyer will read your reply.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            {answered.map((request) => (
              <RequestCard key={request.id} request={request} eventTitle={eventTitle(request.eventId)} />
            ))}
          </div>
        </PortalCard>
      )}

      {closed.length > 0 && (
        <PortalCard title="Earlier">
          <div className="rfx-stack" style={{ gap: 12 }}>
            {closed.map((request) => (
              <RequestCard key={request.id} request={request} eventTitle={eventTitle(request.eventId)} />
            ))}
          </div>
        </PortalCard>
      )}
    </div>
  );
}

function RequestCard({ request, eventTitle }: { request: BuyerRequest; eventTitle: string }) {
  const { state, dispatch } = useStore();
  const replies = repliesTo(request.id, state.buyerReplies);
  const status = requestState(request, state.buyerReplies);
  const [text, setText] = React.useState('');
  const [days, setDays] = React.useState<number | null>(request.askValidityDays);
  const [file, setFile] = React.useState<string | null>(null);
  const last = replies[replies.length - 1];

  const send = () => {
    dispatch({
      type: 'REPLY_BUYER_REQUEST',
      reply: {
        id: `brp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        requestId: request.id, eventId: request.eventId, bidderId: request.bidderId,
        text: text.trim(), revisedValidityDays: request.askValidityDays !== null ? days : null,
        attachmentName: file, repliedAt: Date.now(),
      },
    });
    setText('');
  };

  return (
    <div
      style={{
        border: `1px solid ${status === 'WAITING_FOR_SUPPLIER' ? '#FCD34D' : color.border}`,
        borderRadius: radius.card, padding: '16px 18px', background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{request.subject}</span>
        <Chip tone={status === 'CLOSED' ? 'brand' : status === 'REPLIED' ? 'neutral' : 'gold'}>
          {status === 'CLOSED' ? 'Settled' : status === 'REPLIED' ? 'Sent' : 'Needs your reply'}
        </Chip>
      </div>
      <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 3 }}>
        About {eventTitle}
        {status === 'WAITING_FOR_SUPPLIER' && ` · ${dueText(request.dueAt, serverNow())}`}
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.7, marginTop: 10 }}>{request.message}</div>

      {last && (
        <div
          style={{
            marginTop: 12, paddingTop: 12, borderTop: `1px solid ${color.border}`,
            fontSize: 14, lineHeight: 1.65,
          }}
        >
          <strong>Your reply</strong>
          <div>{last.text}</div>
          {last.revisedValidityDays !== null && <div>You offered to keep your prices valid for {last.revisedValidityDays} days.</div>}
          {last.attachmentName && <div style={{ color: color.brandPrimary }}>📎 {last.attachmentName}</div>}
        </div>
      )}
      {status === 'CLOSED' && (
        <div style={{ marginTop: 10, fontSize: 14, color: color.textSecondary }}>
          {request.accepted ? 'The buyer has taken your reply into account. Thank you.' : 'The buyer no longer needs this answered.'}
        </div>
      )}

      {status === 'WAITING_FOR_SUPPLIER' && (
        <div className="rfx-stack" style={{ gap: 12, marginTop: 14 }}>
          {request.askValidityDays !== null && (
            <Field label="Keep my prices valid for (days)" hint={`The buyer needs at least ${request.askValidityDays} days.`}>
              <NumberInput
                value={days ?? ''}
                onChange={(e) => setDays(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Days my prices stay valid"
              />
            </Field>
          )}
          <Field label="Your reply">
            <Textarea
              rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your reply"
              placeholder="Write your answer here"
            />
          </Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13.5, color: color.brandPrimary, cursor: 'pointer' }}>
              📎 {file ?? 'Attach a document'}
              <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
            </label>
            <span style={{ flex: 1 }} />
            <Button
              variant="primary"
              disabled={text.trim().length < 3 || (request.askValidityDays !== null && (days === null || days <= 0))}
              onClick={send}
            >
              Send reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
