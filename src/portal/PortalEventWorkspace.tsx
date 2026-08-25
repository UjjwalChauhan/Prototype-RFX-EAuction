/**
 * Packs 11–12 — portal event workspace, questionnaire and price submission.
 *
 * A 400-line price grid becomes cards on mobile, not a scrolling table, and the
 * total value is confirmed before submit. No weights or rubrics are shown; the
 * disclosed scoring formula is the one exception, and it is mandatory.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import {
  Button, Chip, CurrencyInput, Field, NumberInput, Segmented, Textarea, TextInput, Toggle,
} from '../design-system/components/primitives';
import { Modal, ValidationBanner } from '../design-system/components/domain';
import { formatCountdown, serverNow } from '../server/clock';
import { useStore } from '../store/store';
import {
  LINE_ITEMS, PORTAL_BIDDER_ID, PRIMARY_EVENT_ID, QUESTIONNAIRE, QUESTION_SECTIONS,
} from '../data/seed';
import { PortalCard } from './PortalShell';
import type { PortalRoute } from './PortalShell';

type Section = 'documents' | 'questions' | 'prices' | 'questions-to-buyer';

export function PortalEventWorkspace({ onNavigate }: { onNavigate: (route: PortalRoute) => void }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === PRIMARY_EVENT_ID)!;
  const bidder = state.bidders.find((b) => b.id === PORTAL_BIDDER_ID)!;
  const response = state.responses.find((r) => r.bidderId === PORTAL_BIDDER_ID);

  const [section, setSection] = React.useState<Section>('questions');
  const [answers, setAnswers] = React.useState<Record<string, string>>(() =>
    Object.fromEntries((response?.answers ?? []).map((a) => [a.questionId, String(a.value ?? '')])),
  );
  const [prices, setPrices] = React.useState<Record<string, number>>(() =>
    Object.fromEntries((response?.priceLines ?? []).map((l) => [l.lineItemId, l.unitPrice])),
  );
  const [mobilePreview, setMobilePreview] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [receipt, setReceipt] = React.useState<{ at: number; reference: string } | null>(null);
  const [askOpen, setAskOpen] = React.useState(false);
  const [question, setQuestion] = React.useState('');
  const [saved, setSaved] = React.useState<number | null>(null);

  const auctionLive =
    state.auction.auction.status === 'LIVE' || state.auction.auction.status === 'EXTENDED';
  const submitted = bidder.participationStatus === 'SUBMITTED' || receipt !== null;

  // Autosave: the supplier never loses work to a closed tab.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSaved(Date.now()), 600);
    return () => window.clearTimeout(timer);
  }, [answers, prices]);

  const total = LINE_ITEMS.reduce((a, item) => a + (prices[item.id] ?? 0) * item.quantity, 0);
  const priced = LINE_ITEMS.filter((item) => (prices[item.id] ?? 0) > 0).length;
  const complete = priced === LINE_ITEMS.length;

  const remaining = event.closesAt === null ? null : event.closesAt - serverNow();

  // Suppliers see the questions and their own answers — never a weight or rubric.
  const visibleQuestions = QUESTIONNAIRE.questions.filter((q) => q.type !== 'price_schedule');

  const clarifications = state.clarifications.filter(
    (c) => c.eventId === PRIMARY_EVENT_ID && c.visibility === 'BROADCAST' && c.answer !== null,
  );

  return (
    <div className="rfx-stack" style={{ gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{event.title}</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: color.textSecondary }}>
            Reference {event.eventNumber} · {LINE_ITEMS.length} lines across 3 lots
          </p>
        </div>
        {submitted && <Chip tone="brand" icon="✓">your response is in</Chip>}
        {remaining !== null && (
          <div
            style={{
              background: remaining < 24 * 3_600_000 ? color.warningSoft : '#fff',
              border: `1px solid ${remaining < 24 * 3_600_000 ? '#FCD34D' : color.border}`,
              borderRadius: 10, padding: '12px 18px', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11.5, color: color.textSecondary }}>Responses close in</div>
            <div
              style={{
                fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: remaining < 24 * 3_600_000 ? color.warningText : color.textPrimary,
              }}
            >
              {remaining < 0 ? 'Closed' : formatCountdown(remaining)}
            </div>
          </div>
        )}
      </div>

      {auctionLive && (
        <PortalCard tone="urgent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span aria-hidden style={{ fontSize: 20, animation: 'rfx-pulse 1.2s infinite' }}>●</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>The live auction is open</div>
              <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 3 }}>
                Your prices below are your starting position. Improve on them in the auction room.
              </div>
            </div>
            <Button variant="primary" onClick={() => onNavigate('bidding')}>Go to bidding →</Button>
          </div>
        </PortalCard>
      )}

      {receipt && (
        <PortalCard>
          <ValidationBanner tone="success" title="Your response has been received">
            Submitted {new Date(receipt.at).toLocaleString()} · reference{' '}
            <strong>{receipt.reference}</strong>. Keep this reference — quote it if you contact us. You
            can still resubmit before the deadline; we keep every version.
          </ValidationBanner>
        </PortalCard>
      )}

      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'documents', label: 'Documents' },
          { value: 'questions', label: 'Answer questions' },
          { value: 'prices', label: 'Enter prices' },
          { value: 'questions-to-buyer', label: 'Ask us a question' },
        ]}
      />

      {section === 'documents' && (
        <PortalCard title="Tender documents" hint="Unlocked when you accepted the invitation.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            {[
              { name: 'Invitation to quote', size: '184 KB', kind: 'PDF' },
              { name: 'Specification — office supplies', size: '512 KB', kind: 'PDF' },
              { name: 'Terms & conditions', size: '246 KB', kind: 'PDF' },
              { name: 'Bid sheet (Excel)', size: '38 KB', kind: 'XLSX' },
            ].map((document) => (
              <div
                key={document.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px',
                }}
              >
                <span aria-hidden style={{ fontSize: 18 }}>📄</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{document.name}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: color.textSecondary }}>
                    {document.kind} · {document.size}
                  </span>
                </span>
                <Button variant="secondary">Download</Button>
              </div>
            ))}
          </div>
        </PortalCard>
      )}

      {section === 'questions' && (
        <div className="rfx-stack" style={{ gap: 14 }}>
          {saved && (
            <div style={{ fontSize: 12.5, color: color.successText }}>
              ✓ Saved automatically at {new Date(saved).toLocaleTimeString()}
            </div>
          )}
          {QUESTION_SECTIONS.filter((s) => visibleQuestions.some((q) => q.sectionId === s.id)).map((sectionDef) => (
            <PortalCard key={sectionDef.id} title={sectionDef.name}>
              <div className="rfx-stack" style={{ gap: 18 }}>
                {visibleQuestions
                  .filter((q) => q.sectionId === sectionDef.id)
                  .map((q) => (
                    <div key={q.id}>
                      <label style={{ display: 'block' }}>
                        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
                          {q.title}
                          {q.isRequired && <span style={{ color: color.danger, marginLeft: 4 }}>*</span>}
                        </span>
                        {q.helpText && (
                          <span style={{ display: 'block', fontSize: 13, color: color.textSecondary, marginBottom: 7 }}>
                            {q.helpText}
                          </span>
                        )}
                        {q.type === 'yes_no' ? (
                          <Segmented
                            value={answers[q.id] === 'true' ? 'yes' : 'no'}
                            onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v === 'yes' ? 'true' : 'false' }))}
                            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                          />
                        ) : q.type === 'number' || q.type === 'lead_time' || q.type === 'capacity_declaration' || q.type === 'currency_payment_terms' ? (
                          <NumberInput
                            value={answers[q.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            style={{ maxWidth: 200, fontSize: 15, padding: '10px 12px' }}
                          />
                        ) : (
                          <TextInput
                            value={answers[q.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            style={{ fontSize: 15, padding: '10px 12px' }}
                          />
                        )}
                      </label>
                      {q.allowAttachment && (
                        <div style={{ marginTop: 8 }}>
                          <Button variant="secondary" size="small">📎 Attach a file</Button>
                          <span style={{ fontSize: 12, color: color.textSecondary, marginLeft: 10 }}>
                            Please avoid putting your company name in the filename — evaluation is done
                            without names attached.
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </PortalCard>
          ))}

          {clarifications.length > 0 && (
            <PortalCard title="Answers sent to everyone" hint="Every bidder gets the same answers.">
              <div className="rfx-stack" style={{ gap: 14 }}>
                {clarifications.map((clarification) => (
                  <div key={clarification.id}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{clarification.subject}</div>
                    <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 4, lineHeight: 1.65 }}>
                      <strong>Q</strong> {clarification.question}
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.65 }}>
                      <strong>A</strong> {clarification.answer}
                    </div>
                  </div>
                ))}
              </div>
            </PortalCard>
          )}
        </div>
      )}

      {section === 'prices' && (
        <div className="rfx-stack" style={{ gap: 14 }}>
          <PortalCard
            title="Your prices"
            hint={`${priced} of ${LINE_ITEMS.length} lines priced. Enter them here, or download the bid sheet and upload it back.`}
            action={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Toggle checked={mobilePreview} onChange={setMobilePreview} label="Card view" />
                <Button variant="secondary">Download bid sheet</Button>
              </div>
            }
          >
            {mobilePreview ? (
              /* On a narrow screen a 400-line grid becomes cards. */
              <div className="rfx-stack" style={{ gap: 12, maxWidth: 390 }}>
                {LINE_ITEMS.map((item) => (
                  <div
                    key={item.id}
                    style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px' }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{item.description}</div>
                    <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 3 }}>
                      {item.itemCode} · {item.quantity.toLocaleString()} {item.uom} · to {item.deliveryLocation}
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Field label={`Your price per ${item.uom}`}>
                        <CurrencyInput
                          value={prices[item.id] ?? ''}
                          onChange={(e) => setPrices((p) => ({ ...p, [item.id]: Number(e.target.value) }))}
                          style={{ fontSize: 16, padding: '11px 12px' }}
                        />
                      </Field>
                    </div>
                    <div
                      style={{
                        marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color.border}`,
                        display: 'flex', justifyContent: 'space-between', fontSize: 14,
                      }}
                    >
                      <span style={{ color: color.textSecondary }}>Line total</span>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money((prices[item.id] ?? 0) * item.quantity, item.currency)}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rfx-scroll-x">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr>
                      {['Item', 'Quantity', 'Deliver to', 'Your price', 'Line total'].map((header) => (
                        <th
                          key={header}
                          style={{
                            textAlign: header === 'Your price' || header === 'Line total' || header === 'Quantity' ? 'right' : 'left',
                            padding: '10px 12px', fontSize: 12.5, color: color.textSecondary,
                            borderBottom: `1px solid ${color.border}`,
                          }}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {LINE_ITEMS.map((item) => (
                      <tr key={item.id} style={{ borderBottom: `1px solid ${color.border}`, height: 56 }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 500 }}>{item.description}</div>
                          <div style={{ fontSize: 12, color: color.textSecondary }}>{item.itemCode}</div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {item.quantity.toLocaleString()} {item.uom}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{item.deliveryLocation}</td>
                        <td style={{ padding: '10px 12px', width: 150 }}>
                          <CurrencyInput
                            value={prices[item.id] ?? ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [item.id]: Number(e.target.value) }))}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {money((prices[item.id] ?? 0) * item.quantity, item.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div
              style={{
                marginTop: 16, padding: '16px 18px', background: color.brandPrimarySoft,
                borderRadius: radius.card, display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: color.textSecondary }}>Your total</div>
                <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(total, event.currency)}
                </div>
              </div>
              <Button variant="primary" disabled={!complete} onClick={() => setConfirmOpen(true)}>
                {complete ? 'Review and submit' : `${LINE_ITEMS.length - priced} line(s) still to price`}
              </Button>
            </div>
          </PortalCard>
        </div>
      )}

      {section === 'questions-to-buyer' && (
        <PortalCard
          title="Ask us a question"
          hint="Answers about scope, specification or commercial terms go to every bidder — that keeps the process fair for you too."
          action={<Button variant="primary" onClick={() => setAskOpen(true)}>Ask a question</Button>}
        >
          <div className="rfx-stack" style={{ gap: 14 }}>
            {state.clarifications
              .filter((c) => c.askedByBidderId === PORTAL_BIDDER_ID)
              .map((clarification) => (
                <div
                  key={clarification.id}
                  style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{clarification.subject}</span>
                    <Chip tone={clarification.answer ? 'brand' : 'gold'}>
                      {clarification.answer ? 'answered' : 'waiting for an answer'}
                    </Chip>
                  </div>
                  <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 6, lineHeight: 1.65 }}>
                    {clarification.question}
                  </div>
                  {clarification.answer && (
                    <div
                      style={{
                        fontSize: 13.5, marginTop: 10, paddingTop: 10,
                        borderTop: `1px solid ${color.border}`, lineHeight: 1.65,
                      }}
                    >
                      {clarification.answer}
                    </div>
                  )}
                </div>
              ))}
            {state.clarifications.filter((c) => c.askedByBidderId === PORTAL_BIDDER_ID).length === 0 && (
              <div style={{ fontSize: 14, color: color.textSecondary }}>
                You have not asked anything yet.
              </div>
            )}
          </div>
        </PortalCard>
      )}

      <Modal
        open={confirmOpen}
        title="Confirm your submission"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setReceipt({ at: Date.now(), reference: `SUB-${Math.floor(Math.random() * 900_000) + 100_000}` });
          dispatch({
            type: 'UPDATE_BIDDER',
            bidderId: PORTAL_BIDDER_ID,
            patch: { participationStatus: 'SUBMITTED' },
          });
          setConfirmOpen(false);
          setSection('prices');
        }}
        confirmLabel="Submit my response"
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          {/* Total-value confirmation before submit. */}
          <div
            style={{
              background: color.brandPrimarySoft, borderRadius: radius.card,
              padding: '16px 18px', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, color: color.textSecondary }}>You are submitting a total of</div>
            <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
              {money(total, event.currency)}
            </div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
              across {LINE_ITEMS.length} lines
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            Check the total carefully. You can resubmit before the deadline — we keep every version and
            assess the latest one.
          </p>
        </div>
      </Modal>

      <Modal
        open={askOpen}
        title="Ask a question"
        onClose={() => setAskOpen(false)}
        onConfirm={() => {
          dispatch({
            type: 'ADD_CLARIFICATION',
            clarification: {
              id: `clar-${Date.now()}`, eventId: PRIMARY_EVENT_ID,
              askedByBidderId: PORTAL_BIDDER_ID,
              subject: question.slice(0, 40),
              question, askedAt: Date.now(),
              answer: null, answeredAt: null, answeredBy: null,
              visibility: 'BROADCAST', agentDrafted: false, revealAsker: false,
            },
          });
          setAskOpen(false);
          setQuestion('');
        }}
        confirmLabel="Send question"
        confirmDisabled={question.trim().length < 10}
      >
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.7 }}>
          If your question is about scope, specification or commercial terms, the answer goes to every
          bidder — without saying who asked. That is how we keep the process fair.
        </p>
        <Textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </Modal>
    </div>
  );
}
