/**
 * Pack 06 — Form builder.
 *
 * Two things carry the design: `price_schedule` is its own question type that
 * binds to the event's line items rather than being a text field, and envelope
 * assignment is presented as a permissions boundary.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import { Chip, NumberInput, Segmented, Select } from '../../design-system/components/primitives';
import { Card } from '../../design-system/components/layout';
import { AgentCard, ValidationBanner } from '../../design-system/components/domain';
import { lineItemsForEvent, useStore } from '../../store/store';
import { QUESTION_SECTIONS, QUESTIONNAIRE } from '../../data/seed';
import type { Question, QuestionEnvelope } from '../../domain/types';

const ENVELOPE_TONE: Record<QuestionEnvelope, { fg: string; bg: string; label: string; icon: string }> = {
  TECHNICAL: { fg: color.infoText, bg: color.infoSoft, label: 'Technical', icon: '⚙' },
  COMMERCIAL: { fg: color.accentPurpleText, bg: color.accentPurpleSoft, label: 'Commercial', icon: '🔒' },
  GENERAL: { fg: color.textBody, bg: color.neutralSoft, label: 'General', icon: '▤' },
};

export function QuestionnaireTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  // A price schedule is bound to this event's lines, not to a fixed list.
  const lineCount = lineItemsForEvent(state, eventId).length;
  const [questions, setQuestions] = React.useState<Question[]>(QUESTIONNAIRE.questions);
  const [selectedId, setSelectedId] = React.useState<string>(questions[0]?.id ?? '');

  const selected = questions.find((q) => q.id === selectedId);
  const technicalWeight = questions
    .filter((q) => q.envelope === 'TECHNICAL' && q.weight > 0)
    .reduce((a, q) => a + q.weight, 0);
  const commercialWeight = questions
    .filter((q) => q.envelope === 'COMMERCIAL' && q.weight > 0)
    .reduce((a, q) => a + q.weight, 0);

  const patchQuestion = (id: string, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {event.envelopeMode === 'TWO_ENVELOPE' && (
          <ValidationBanner tone="info" title="Envelope assignment is a permissions boundary">
            A question marked Commercial sits inside the sealed envelope. Until unlock, no technical
            evaluator can reach its answer by any route — including export and a direct URL.
          </ValidationBanner>
        )}

        {technicalWeight !== 70 && (
          <ValidationBanner tone="warning" title={`Technical weights total ${technicalWeight}`}>
            Weights need not sum to 100 at question level — they are normalised — but a large total
            makes a single question's influence hard to read.
          </ValidationBanner>
        )}

        {QUESTION_SECTIONS.map((section) => {
          const sectionQuestions = questions.filter((q) => q.sectionId === section.id);
          if (sectionQuestions.length === 0) return null;
          return (
            <Card key={section.id} padded={false} title={section.name} hint={`${sectionQuestions.length} question(s)`}>
              <div>
                {sectionQuestions.map((question, i) => {
                  const tone = ENVELOPE_TONE[question.envelope];
                  const active = question.id === selectedId;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => setSelectedId(question.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                        border: 'none', borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                        borderLeft: `3px solid ${active ? color.brandPrimary : 'transparent'}`,
                        background: active ? '#F5F8FF' : '#fff', padding: '11px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                          {question.sequence}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{question.title}</span>
                        {question.isRequired && <span style={{ color: color.danger, fontSize: 12 }}>*</span>}
                        <span
                          style={{
                            background: tone.bg, color: tone.fg, borderRadius: 5,
                            padding: '2px 7px', fontSize: 10.5, fontWeight: 700,
                          }}
                        >
                          {tone.icon} {tone.label}
                        </span>
                        <Chip tone="neutral">{question.type}</Chip>
                        {question.isKnockout && <Chip tone="danger" icon="✕" title="Failing this disqualifies the bidder">knockout</Chip>}
                        {question.weight > 0 && <Chip tone="brand">weight {question.weight}</Chip>}
                      </div>
                      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 4 }}>
                        <code style={{ fontSize: 10.5 }}>{question.code}</code>
                        {question.helpText && ` · ${question.helpText}`}
                      </div>

                      {question.type === 'price_schedule' && (
                        <div
                          style={{
                            marginTop: 9, padding: '9px 11px', background: '#FCFCFD',
                            border: `1px dashed ${color.borderStrong}`, borderRadius: radius.control,
                          }}
                        >
                          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>
                            Bound to {lineCount} event line items
                          </div>
                          <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.5 }}>
                            This renders as a price grid, not a scalar answer. The supplier prices each
                            line; extended values are calculated and the total is confirmed before submit.
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Weight summary">
          <div className="rfx-stack" style={{ gap: 9, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.textSecondary }}>Technical questions</span>
              <strong>{technicalWeight}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.textSecondary }}>Commercial (non-price) questions</span>
              <strong>{commercialWeight}</strong>
            </div>
            <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.55, marginTop: 4 }}>
              Price itself never carries a question weight — it enters the award score through the price
              component only, which is what keeps price out of two places at once.
            </div>
          </div>
        </Card>

        {selected && (
          <Card title="Question settings" hint={selected.code}>
            <div className="rfx-stack" style={{ gap: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Envelope</div>
                <Segmented
                  size="small"
                  value={selected.envelope}
                  onChange={(envelope) => patchQuestion(selected.id, { envelope })}
                  options={[
                    { value: 'TECHNICAL', label: 'Technical' },
                    { value: 'COMMERCIAL', label: 'Commercial' },
                    { value: 'GENERAL', label: 'General' },
                  ]}
                />
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Scoring method</div>
                <Select
                  value={selected.scoringMethod}
                  onChange={(e) => patchQuestion(selected.id, { scoringMethod: e.target.value as Question['scoringMethod'] })}
                >
                  <option value="NONE">Not scored</option>
                  <option value="MANUAL">Manual — evaluator scores against the rubric</option>
                  <option value="RULE">Rule — auto-computed, read only</option>
                  <option value="AI_ASSISTED">AI assisted — agent proposes, human decides</option>
                  <option value="AI_AUTO">AI auto — agent writes, degrades below confidence</option>
                </Select>
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Weight</div>
                <NumberInput
                  value={selected.weight}
                  onChange={(e) => patchQuestion(selected.id, { weight: Number(e.target.value) })}
                />
              </div>

              {selected.rubric && (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>
                    Rubric — always visible to the evaluator
                  </div>
                  <div
                    style={{
                      fontSize: 11.5, color: color.textBody, background: color.neutralSoft,
                      borderRadius: radius.control, padding: '8px 10px', lineHeight: 1.55,
                    }}
                  >
                    {selected.rubric}
                  </div>
                </div>
              )}

              {(selected.scoringMethod === 'AI_ASSISTED' || selected.scoringMethod === 'AI_AUTO') && (
                <ValidationBanner tone="info" title="Suppliers are told when a response is AI-scored">
                  <code>config.agents.disclose_ai_scoring_to_suppliers</code> is true at tenant scope.
                </ValidationBanner>
              )}
            </div>
          </Card>
        )}

        <AgentCard
          code="AG-03"
          name="Questionnaire Builder"
          autonomy="DRAFT"
          confidence={0.79}
          summary="Two questions are missing that appear in every comparable office-supplies event: a substitution policy and a stock-availability commitment. Drafts are ready to review."
          evidence={[
            { label: 'Template library', detail: 'Office supplies — standard, v4' },
            { label: '6 prior events', detail: 'Both questions present in all six' },
          ]}
          onAccept={() => undefined}
          onReject={() => undefined}
        />
      </div>
    </div>
  );
}
