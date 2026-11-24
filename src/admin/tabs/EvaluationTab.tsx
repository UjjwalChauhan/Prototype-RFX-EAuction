/**
 * Packs 13–15 — evaluation home, technical workspace, commercial evaluation
 * with bid transformation, and the comparison & ranking sheet.
 *
 * Two things carry the design:
 *   - The award-score model validates that price appears in exactly one
 *     component, which is the fix for the 64%-effective-weight bug.
 *   - Bid transformation shows the full calculation trail per bidder, not a
 *     freight column bolted onto a table.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import { Button, Chip, NumberInput, Segmented, Toggle } from '../../design-system/components/primitives';
import { Card, Progress, Table, type Column } from '../../design-system/components/layout';
import { AgentCard, ValidationBanner } from '../../design-system/components/domain';
import {
  DEFAULT_AWARD_COMPONENTS, awardScore, formulaText, priceScore,
  technicalScore, validateAwardScoreModel,
} from '../../domain/evaluation';
import { transformBid } from '../../domain/transformation';
import { bestFirst } from '../../domain/comparator';
import { rankLot } from '../../domain/auctionEngine';
import { CommercialReview } from './CommercialReview';
import { taskFor, useCommercialModel, type CommercialModel } from '../../store/commercialModel';
import { assignmentOf, type StageAssignment } from '../../domain/employeePortal';
import { SEEDED_EVALUATION } from '../../data/employees';
import type { TrailEntry } from '../../domain/commercialEvaluation';
import {
  auctionFor, biddersForEvent, costComponentsFor, lineItemsForEvent, useStore,
} from '../../store/store';
import { COUNTERPARTY_NAMES, LINE_ITEMS, QUESTIONNAIRE } from '../../data/seed';
import type { AwardScoreComponent, PriceScoreMethod } from '../../domain/types';

type Pane = 'home' | 'technical' | 'commercial' | 'comparison';

/**
 * Finds the ask's evaluation setup and, where there is one, assembles its
 * commercial model once, so the commercial pane and the comparison sheet read
 * the same evaluated totals rather than each working out their own.
 */
export function EvaluationTab({ eventId }: { eventId: string }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const found = assignmentOf(event, SEEDED_EVALUATION as Record<string, StageAssignment[]>);
  if (!found) return <EvaluationBody eventId={eventId} model={null} />;
  return <WithModel eventId={eventId} found={found} />;
}

function WithModel({ eventId, found }: { eventId: string; found: NonNullable<ReturnType<typeof assignmentOf>> }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const model = useCommercialModel(taskFor(event, found.assignment, found.rules), 'LANDED');
  return <EvaluationBody eventId={eventId} model={model} />;
}

function EvaluationBody({ eventId, model }: { eventId: string; model: CommercialModel | null }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bidders = biddersForEvent(state, eventId);
  const [pane, setPane] = React.useState<Pane>('home');
  const [components, setComponents] = React.useState<AwardScoreComponent[]>(DEFAULT_AWARD_COMPONENTS);
  const [priceMethod, setPriceMethod] = React.useState<PriceScoreMethod>('RATIO');
  const [showTransformed, setShowTransformed] = React.useState(true);

  const validation = validateAwardScoreModel(components);

  // Technical results, gated at the configured minimum.
  const technicalResults = bidders.map((bidder) =>
    technicalScore(
      bidder.id, QUESTIONNAIRE.questions,
      state.scores.filter((s) => s.eventId === eventId),
      'MIN_SCORE', 60,
    ),
  );

  // Commercial values: the auction's transformed values where an auction ran,
  // otherwise the submitted price schedule.
  const held = auctionFor(state, eventId);
  const isPrimaryAuction = held !== null;
  const auctionRank = isPrimaryAuction
    ? rankLot(held!.bids, held!.lots[0]?.id ?? '', event.side, held!.auction.antiGaming.tieBidPolicy)
    : [];

  // Once the envelope is open, the evaluated totals come from the commercial evaluation itself — the
  // same figures the evaluators and the buyer's commercial view read. Before then (or on an event with
  // no evaluation set up) the schedule is summed as it always was.
  const live = model !== null && model.unlocked ? model : null;
  const sealed = model !== null && model.twoEnvelope && !model.unlocked;

  const commercialRows = bidders.map((bidder) => {
    const fromAuction = auctionRank.find((r) => r.bidderId === bidder.id);
    const evaluated = live?.result.bids.find((b) => b.bidderId === bidder.id);
    if (evaluated) {
      return {
        bidderId: bidder.id,
        name: COUNTERPARTY_NAMES[bidder.counterpartyId],
        masked: bidder.maskedLabel,
        rawBid: evaluated.quotedTotal,
        transformed: evaluated.transformed,
        adjustment: evaluated.transformed - evaluated.quotedTotal,
        trace: [],
        trail: evaluated.trail as TrailEntry[],
        rankable: evaluated.rankable,
        commercialTerms: evaluated.commercialScore.score,
      };
    }
    const response = state.responses.find((r) => r.bidderId === bidder.id);
    const scheduleTotal = (response?.priceLines ?? []).filter((line) => !line.alternateOf).reduce((a, line) => {
      const item = LINE_ITEMS.find((l) => l.id === line.lineItemId);
      return a + line.unitPrice * (item?.quantity ?? 0);
    }, 0);
    const rawBid = fromAuction?.bidValue ?? scheduleTotal;
    const transform = transformBid(
      { bidderId: bidder.id, bidValue: rawBid, quantity: 1, lineCount: LINE_ITEMS.length },
      costComponentsFor(state, eventId),
      'SUPPLIER_SPECIFIC',
    );
    return {
      bidderId: bidder.id,
      name: COUNTERPARTY_NAMES[bidder.counterpartyId],
      masked: bidder.maskedLabel,
      rawBid,
      transformed: transform.transformedValue,
      adjustment: transform.totalAdjustment,
      trace: transform.trace,
      trail: undefined as TrailEntry[] | undefined,
      rankable: true,
      commercialTerms: null as number | null,
    };
  });

  const allTransformed = commercialRows.filter((r) => r.rankable).map((r) => r.transformed);

  const scoreRows = commercialRows
    .map((row) => {
      const technical = technicalResults.find((t) => t.bidderId === row.bidderId);
      const bidder = bidders.find((b) => b.id === row.bidderId)!;
      const priceComponent = row.rankable
        ? priceScore(row.transformed, allTransformed, priceMethod, event.side, 138_000)
        : 0;
      const breakdown = awardScore(
        {
          price_score: priceComponent,
          technical_score: technical?.score ?? 0,
          // Commercial terms exclude price by construction.
          commercial_terms_score: live ? row.commercialTerms ?? 0 : [86, 62, 48, 44][bidders.indexOf(bidder)] ?? 50,
          performance_rating: bidder.performanceRatingSnapshot,
          qualification_rating: bidder.qualificationSnapshot,
        },
        components,
      );
      return {
        ...row,
        technical: technical?.score ?? 0,
        passesGate: technical?.passesGate ?? false,
        knockoutFailed: technical?.knockoutFailed ?? [],
        priceComponent,
        rankable: row.rankable,
        total: breakdown.total,
        contributions: breakdown.contributions,
      };
    })
    // A bid that fails a commercial knockout or is only part priced is shown, but not ranked.
    .sort((a, b) => Number(b.rankable) - Number(a.rankable) || b.total - a.total)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          { value: 'home', label: 'Evaluation home' },
          { value: 'technical', label: 'Technical workspace' },
          { value: 'commercial', label: 'Commercial & transformation' },
          { value: 'comparison', label: 'Comparison & ranking' },
        ]}
      />

      {pane === 'home' && (
        <>
          {!validation.valid && (
            <ValidationBanner tone="error" title="The award-score model is invalid">
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.6 }}>
                {validation.errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </ValidationBanner>
          )}
          {validation.warnings.map((warning) => (
            <ValidationBanner key={warning} tone="warning" title="Check this configuration">
              {warning}
            </ValidationBanner>
          ))}

          <Card
            title="Award score model"
            hint="Weights must total 100, and price must appear in exactly one component."
          >
            <div className="rfx-stack" style={{ gap: 10 }}>
              {components.map((component) => (
                <div
                  key={component.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{component.label}</span>
                      {component.containsPrice && (
                        <Chip tone="danger" icon="$" title="This component carries price">carries price</Chip>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                      {component.key === 'technical_score' && 'Price-free by construction.'}
                      {component.key === 'commercial_terms_score' && 'Scored commercial questions, excluding price.'}
                      {component.key === 'price_score' && `Normalised from the transformed commercial value by ${priceMethod}.`}
                      {component.key === 'performance_rating' && 'Recurring vendor performance.'}
                      {component.key === 'qualification_rating' && 'Onboarding rating.'}
                    </div>
                  </div>
                  <Toggle
                    checked={component.containsPrice}
                    onChange={(containsPrice) =>
                      setComponents((cs) =>
                        cs.map((c) => (c.key === component.key ? { ...c, containsPrice } : c)),
                      )
                    }
                    label="price"
                  />
                  <div style={{ width: 90 }}>
                    <NumberInput
                      value={component.weight}
                      onChange={(e) =>
                        setComponents((cs) =>
                          cs.map((c) =>
                            c.key === component.key ? { ...c, weight: Number(e.target.value) } : c,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: color.textSecondary }}>Price normalisation</span>
              <Segmented
                size="small"
                value={priceMethod}
                onChange={setPriceMethod}
                options={[
                  { value: 'RATIO', label: 'Ratio' },
                  { value: 'LINEAR', label: 'Linear' },
                  { value: 'TARGET_RELATIVE', label: 'Target relative' },
                ]}
              />
            </div>

            <div
              style={{
                marginTop: 12, padding: '10px 12px', background: color.brandPrimarySoft,
                borderRadius: radius.control, fontSize: 12, lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Disclosed formula</div>
              <code style={{ fontSize: 11.5 }}>{formulaText(components, priceMethod)}</code>
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 6 }}>
                This block renders identically in the vendor portal. Undisclosed weights invite disputes
                and are treated as a configuration error.
              </div>
            </div>
          </Card>

          <Card title="Evaluation progress">
            <div className="rfx-stack" style={{ gap: 12 }}>
              {technicalResults.map((result) => {
                const bidder = bidders.find((b) => b.id === result.bidderId)!;
                return (
                  <div key={result.bidderId}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5 }}>
                        {bidder.maskedLabel}
                        {result.knockoutFailed.length > 0 && (
                          <Chip
                            tone="danger"
                            icon="✕"
                            title={result.knockoutFailed.map((k: { title: string }) => k.title).join(', ')}
                          >
                            knockout
                          </Chip>
                        )}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: result.passesGate ? color.successText : color.dangerText }}>
                        {result.score.toFixed(1)} / 100 {result.passesGate ? '· passes' : '· below gate'}
                      </span>
                    </div>
                    <Progress
                      value={result.score}
                      tone={result.passesGate ? color.success : color.danger}
                    />
                    <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>
                      {result.answered} of {result.total} scored questions complete
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {pane === 'technical' && <TechnicalWorkspace eventId={eventId} />}

      {pane === 'commercial' && (
        <CommercialReview eventId={eventId} onGoTechnical={() => setPane('technical')} />
      )}

      {pane === 'comparison' && sealed && (
        <ValidationBanner tone="info" title="The commercial envelope is sealed">
          There is no comparison to show until the technical result is published and the commercial envelope is
          unlocked. Prices are not readable here before then — by anyone.
        </ValidationBanner>
      )}
      {pane === 'comparison' && live && !live.completed && (
        <ValidationBanner tone="warning" title="Provisional — the commercial evaluation is not complete">
          These evaluated totals are live and will move as the evaluators work. The sheet is final once the
          commercial evaluation is completed.
        </ValidationBanner>
      )}
      {pane === 'comparison' && !sealed && (
        <ComparisonSheet
          eventId={eventId}
          rows={scoreRows}
          components={components}
          priceMethod={priceMethod}
          showTransformed={showTransformed}
          onToggleTransformed={setShowTransformed}
          formulaValid={validation.valid}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technical workspace — three panes
// ---------------------------------------------------------------------------

function TechnicalWorkspace({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const bidders = biddersForEvent(state, eventId);
  // The basket, so a question asked per line can be read line by line rather
  // than as whichever answer happened to come back first.
  const lineItems = lineItemsForEvent(state, eventId);
  const [activeBidderId, setActiveBidderId] = React.useState(bidders[0]?.id ?? '');
  const technical = QUESTIONNAIRE.questions.filter(
    (q) => q.envelope === 'TECHNICAL' && q.scoringMethod !== 'NONE',
  );
  const response = state.responses.find((r) => r.bidderId === activeBidderId);
  const scores = state.scores.filter((s) => s.eventId === eventId && s.bidderId === activeBidderId);

  const canScore = state.currentUser.permissions.includes('score_technical');
  const holdsCommercial = state.currentUser.permissions.includes('view_commercial');

  return (
    <div className="rfx-triple">
      <Card title="Bidders" padded={false} hint="Masked">
        <div>
          {bidders.map((bidder) => (
            <button
              key={bidder.id}
              type="button"
              onClick={() => setActiveBidderId(bidder.id)}
              className="rfx-navrow"
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                borderLeft: `3px solid ${bidder.id === activeBidderId ? color.brandPrimary : 'transparent'}`,
                background: bidder.id === activeBidderId ? color.brandPrimarySoft : '#fff',
                padding: '10px 12px', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: bidder.id === activeBidderId ? 600 : 400 }}>
                {bidder.maskedLabel}
              </div>
              <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>
                {scores.filter((s) => s.bidderId === bidder.id).length} of {technical.length} scored
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="rfx-stack" style={{ gap: 12 }}>
        {holdsCommercial && (
          <ValidationBanner tone="error" title="Separation of duties breach">
            This user holds both <code>score_technical</code> and <code>view_commercial</code>. Under
            two-envelope mode that combination is not permitted on the same event. Switch to the
            Technical Evaluator persona to score.
          </ValidationBanner>
        )}
        {!canScore && (
          <ValidationBanner tone="warning" title="Read-only">
            Your role does not hold <code>score_technical</code>. Switch to the Technical Evaluator
            persona from the user menu to enter scores.
          </ValidationBanner>
        )}

        {technical.map((question) => {
          const given = (response?.answers ?? []).filter((a) => a.questionId === question.id);
          const existing = scores.find((s) => s.questionId === question.id);
          return (
            <Card key={question.id} title={question.title} hint={question.code}>
              <div className="rfx-stack" style={{ gap: 10 }}>
                {/*
                  A question asked per line comes back with one answer per
                  line, and the evaluator needs all of them before scoring —
                  the score itself stays one per question, because what is
                  being judged is the supplier's answer to the question, not
                  each line separately.
                */}
                <div
                  style={{
                    background: color.neutralSoft, borderRadius: radius.control,
                    padding: '9px 11px', fontSize: 12.5,
                  }}
                >
                  <div style={{ fontSize: 10.5, color: color.textSecondary, marginBottom: 3 }}>
                    {question.askedPer === 'LINE'
                      ? `Response · ${given.length} of ${lineItems.length} lines answered`
                      : 'Response'}
                  </div>
                  {given.length === 0 && <em style={{ color: color.textMuted }}>no answer</em>}
                  {question.askedPer === 'LINE' ? (
                    <div className="rfx-stack" style={{ gap: 5 }}>
                      {lineItems.map((lineItem) => {
                        const answer = given.find((a) => a.lineItemId === lineItem.id);
                        return (
                          <div key={lineItem.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 10.5, color: color.textSecondary, minWidth: 92 }}>
                              {lineItem.itemCode}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {answer
                                ? String(answer.value)
                                : <em style={{ color: color.textMuted }}>not answered</em>}
                              {answer?.attachmentName && (
                                <span style={{ fontSize: 11, color: color.brandPrimary, marginLeft: 6 }}>
                                  📎 {answer.attachmentName}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : given[0] ? (
                    <>
                      {String(given[0].value)}
                      {given[0].attachmentName && (
                        <div style={{ fontSize: 11, color: color.brandPrimary, marginTop: 4 }}>
                          📎 {given[0].attachmentName}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>

                {question.rubric && (
                  <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.55 }}>
                    <strong>Rubric</strong> · {question.rubric}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {question.scoringMethod === 'RULE' ? (
                    <Chip tone="info" icon="⚙" title="Auto-computed; the rule that fired is shown">
                      rule score — read only
                    </Chip>
                  ) : (
                    <>
                      <span style={{ fontSize: 11.5, color: color.textSecondary }}>
                        Score (0–{question.maxScore})
                      </span>
                      {Array.from({ length: question.maxScore + 1 }).map((_, value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={!canScore || holdsCommercial}
                          onClick={() =>
                            dispatch({
                              type: 'ADD_SCORE',
                              score: {
                                id: `score-${Date.now()}-${question.id}`,
                                eventId, bidderId: activeBidderId, questionId: question.id,
                                evaluatorId: state.currentUser.id, value,
                                comment: '', method: question.scoringMethod,
                                agentConfidence: null, citedEvidence: null,
                                // An override is a new row referencing the original.
                                overridesScoreId: existing?.id ?? null,
                                overrideReason: existing ? 'Revised after review' : null,
                                createdAt: Date.now(),
                              },
                            })
                          }
                          style={{
                            width: 26, height: 26, borderRadius: radius.control,
                            border: `1px solid ${existing?.value === value ? color.brandPrimary : color.border}`,
                            background: existing?.value === value ? color.brandPrimary : '#fff',
                            color: existing?.value === value ? '#fff' : color.textBody,
                            fontSize: 11, fontWeight: 600,
                            cursor: canScore && !holdsCommercial ? 'pointer' : 'not-allowed',
                            opacity: canScore && !holdsCommercial ? 1 : 0.5,
                          }}
                        >
                          {value}
                        </button>
                      ))}
                    </>
                  )}
                  {question.isKnockout && (
                    <Chip tone="danger" icon="✕" title="A zero here disqualifies the bidder, citing this question">
                      knockout
                    </Chip>
                  )}
                </div>

                {existing && (
                  <div style={{ fontSize: 11, color: color.textSecondary }}>
                    Latest: <strong>{existing.value}</strong> by {existing.evaluatorId}
                    {existing.overridesScoreId && ' · this row overrides an earlier score, which is retained'}
                  </div>
                )}

                {question.scoringMethod === 'AI_ASSISTED' && (() => {
                  /**
                   * The agent reads every answer the question produced. On a
                   * question asked per line that is one figure per line, and
                   * a summary quoting only the first would be the agent
                   * citing evidence it did not use.
                   */
                  const quoted = given.length === 0
                    ? '—'
                    : given
                      .map((a) => {
                        const lineItem = lineItems.find((l) => l.id === a.lineItemId);
                        return lineItem ? `${lineItem.itemCode} ${String(a.value)}` : String(a.value);
                      })
                      .join(' · ');
                  return (
                  <AgentCard
                    code="AG-06"
                    name="Technical Evaluation"
                    autonomy="SUGGEST"
                    confidence={0.81}
                    summary={question.askedPer === 'LINE'
                      ? `Proposed score 8 of 10. Declared capacity covers ${given.length} of ${lineItems.length} lines and clears the quantity on each, but no third-party verification was attached.`
                      : `Proposed score 8 of 10. Declared capacity of ${quoted} exceeds the requirement with headroom, but no third-party verification was attached.`}
                    evidence={[
                      { label: 'Answer text', detail: quoted },
                      { label: 'capacity-*.xlsx, sheet 2', detail: 'Monthly output table' },
                      { label: 'Requirement', detail: 'The quantity on each line item' },
                    ]}
                    onAccept={() =>
                      dispatch({
                        type: 'ADD_SCORE',
                        score: {
                          id: `score-ai-${Date.now()}`, eventId, bidderId: activeBidderId,
                          questionId: question.id, evaluatorId: state.currentUser.id, value: 8,
                          comment: 'Accepted AG-06 proposal.', method: 'AI_ASSISTED',
                          agentConfidence: 0.81,
                          citedEvidence: 'capacity spreadsheet, sheet 2',
                          overridesScoreId: existing?.id ?? null, overrideReason: null,
                          createdAt: Date.now(),
                        },
                      })
                    }
                    onModify={() => undefined}
                    onReject={() => undefined}
                  />
                  );
                })()}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Criteria tree" hint="Running score">
        <div className="rfx-stack" style={{ gap: 9 }}>
          {technical.map((question) => {
            const score = scores.find((s) => s.questionId === question.id);
            return (
              <div key={question.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {question.title}
                  </span>
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>
                    {score ? `${score.value}/${question.maxScore}` : '—'}
                  </span>
                </div>
                <Progress
                  value={score?.value ?? 0}
                  max={question.maxScore}
                  height={4}
                  tone={score ? color.brandPrimary : color.border}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison & ranking sheet — Pack 15
// ---------------------------------------------------------------------------

interface ScoreRow {
  rank: number;
  bidderId: string;
  name: string;
  masked: string;
  rawBid: number;
  transformed: number;
  technical: number;
  passesGate: boolean;
  priceComponent: number;
  /** False for a bid that fails a commercial knockout or is part priced — shown, not ranked. */
  rankable: boolean;
  trail?: TrailEntry[];
  total: number;
  contributions: { key: string; label: string; weight: number; score: number; contribution: number }[];
}

function ComparisonSheet({
  eventId, rows, components, priceMethod, showTransformed, onToggleTransformed, formulaValid,
}: {
  eventId: string;
  rows: ScoreRow[];
  components: AwardScoreComponent[];
  priceMethod: PriceScoreMethod;
  showTransformed: boolean;
  onToggleTransformed: (next: boolean) => void;
  formulaValid: boolean;
}) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const [trailFor, setTrailFor] = React.useState<string | null>(null);
  const trailRow = rows.find((r) => r.bidderId === trailFor);

  // Graceful degradation: sections whose stage did not run are hidden, not
  // rendered empty.
  const hasTechnical = event.stagesEnabled.includes('RFP') || event.stagesEnabled.includes('RFI');
  const hasCommercial = rows.some((r) => r.transformed > 0);

  const rankingColumns: Column<ScoreRow>[] = [
    {
      key: 'rank', header: '#', width: '54px',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: '50%',
            background: row.rank === 1 ? color.successSoft : color.neutralSoft,
            color: row.rank === 1 ? color.successText : color.textSecondary,
            fontSize: 11, fontWeight: 700,
          }}
        >
          {row.rank}
        </span>
      ),
    },
    {
      key: 'name', header: 'Bidder',
      render: (row) => (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: row.rank === 1 ? 700 : 500 }}>{row.name}</div>
          <div style={{ fontSize: 10.5, color: color.textSecondary }}>{row.masked}</div>
        </div>
      ),
    },
    {
      key: 'quoted', header: 'Quoted', numeric: true,
      render: (row) => money(row.rawBid, event.currency),
    },
    {
      key: 'transformed', header: 'Transformed', numeric: true,
      render: (row) => <strong>{money(row.transformed, event.currency)}</strong>,
    },
    ...(hasTechnical
      ? [{
          key: 'technical', header: 'Technical', numeric: true,
          render: (row: ScoreRow) => (
            <span style={{ color: row.passesGate ? color.textPrimary : color.dangerText }}>
              {row.technical.toFixed(1)}
              {!row.passesGate && <span style={{ fontSize: 10, marginLeft: 4 }}>gate</span>}
            </span>
          ),
        } as Column<ScoreRow>]
      : []),
    {
      key: 'price', header: 'Price score', numeric: true,
      render: (row) => row.priceComponent.toFixed(1),
    },
    {
      key: 'total', header: 'Overall', numeric: true,
      render: (row) => (
        <strong style={{ color: row.rank === 1 ? color.successText : color.textPrimary }}>
          {row.total.toFixed(1)}
        </strong>
      ),
    },
    {
      key: 'flags', header: '', width: '190px',
      render: (row) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {row.rank === 1 && row.rankable && <Chip tone="gold" icon="★">recommended</Chip>}
          {!row.rankable && <Chip tone="danger" icon="✕" title="Fails a commercial knockout or is only part priced, so it is not ranked on price">not ranked</Chip>}
          {!row.passesGate && <Chip tone="danger" icon="✕">below gate</Chip>}
          {row.trail && (
            <Button size="small" variant="secondary" onClick={() => setTrailFor(trailFor === row.bidderId ? null : row.bidderId)}>
              {trailFor === row.bidderId ? 'Hide trail' : 'Trail'}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {!formulaValid && (
        <ValidationBanner tone="error" title="Rankings below use an invalid score model">
          Fix the award-score weights on Evaluation home before relying on these rankings.
        </ValidationBanner>
      )}

      {/* Section 1 — bidder score cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: 10 }}>
        {rows.map((row) => (
          <div
            key={row.bidderId}
            style={{
              background: '#fff',
              border: `1px solid ${row.rank === 1 ? '#86EFAC' : color.border}`,
              borderRadius: radius.card, padding: '13px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: row.rank === 1 ? color.successSoft : color.neutralSoft,
                  color: row.rank === 1 ? color.successText : color.textSecondary,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {row.rank}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.name}
              </span>
              {row.rank === 1 && <Chip tone="gold" icon="★">recommended</Chip>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 9, fontVariantNumeric: 'tabular-nums' }}>
              {money(row.transformed, event.currency)}
            </div>
            <div style={{ fontSize: 11, color: color.textSecondary }}>
              transformed · quoted {money(row.rawBid, event.currency)}
            </div>
            <div className="rfx-stack" style={{ marginTop: 10, gap: 5 }}>
              {row.contributions.map((contribution) => (
                <div key={contribution.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: color.textSecondary }}>
                    <span>{contribution.label}</span>
                    <span>{contribution.contribution.toFixed(1)}</span>
                  </div>
                  <Progress value={contribution.contribution} max={contribution.weight} height={3} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${color.border}`, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: color.textSecondary }}>Overall</span>
              <strong style={{ fontSize: 14 }}>{row.total.toFixed(1)}</strong>
            </div>
          </div>
        ))}
      </div>

      {/* Section 2 — ranking table */}
      <Card
        padded={false}
        title="Ranking"
        hint={hasTechnical ? 'Technical, commercial and performance combined.' : 'RFQ-only event: no technical scores, so that column is hidden rather than empty.'}
      >
        <Table
          columns={rankingColumns}
          rows={rows}
          rowKey={(row) => row.bidderId}
          rowStyle={(row) => (row.rank === 1 ? { background: '#F0FDF4' } : undefined)}
        />
      </Card>

      {trailRow?.trail && (
        <Card title={`Calculation trail — ${trailRow.name}`} hint="Every component that moved this bidder’s number, carried from the commercial evaluation.">
          <div className="rfx-stack" style={{ gap: 4 }}>
            {trailRow.trail.map((entry) => {
              const strong = entry.kind === 'QUOTED' || entry.kind === 'RESULT';
              return (
                <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) minmax(0,1.6fr) 150px', gap: 10, fontSize: 12, fontWeight: strong ? 700 : 400 }}>
                  <span>{entry.label}</span>
                  <span style={{ color: color.textSecondary, fontWeight: 400 }}>{entry.detail}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {strong ? money(entry.amount, event.currency) : signedMoney(entry.amount, event.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Section 3 — line-item comparison grid */}
      {hasCommercial && (
        <Card
          padded={false}
          title="Line-item comparison"
          hint="Best value per row is tinted. Toggle between quoted and transformed values."
          action={
            <Segmented
              size="small"
              value={showTransformed ? 'transformed' : 'quoted'}
              onChange={(v) => onToggleTransformed(v === 'transformed')}
              options={[{ value: 'quoted', label: 'Quoted' }, { value: 'transformed', label: 'Transformed' }]}
            />
          }
        >
          <LineComparisonGrid eventId={eventId} showTransformed={showTransformed} />
        </Card>
      )}

      {/* Section 4 — the formula, mandatory */}
      <Card title="Disclosed formula" hint="Mandatory. Rendered identically in the vendor portal.">
        <code style={{ fontSize: 12, lineHeight: 1.8, display: 'block' }}>
          {formulaText(components, priceMethod)}
        </code>
        <div className="rfx-stack" style={{ marginTop: 10, gap: 5 }}>
          {components.filter((c) => c.weight > 0).map((component) => (
            <div key={component.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: color.textSecondary }}>
                {component.label}
                {component.containsPrice && <span style={{ marginLeft: 6 }}>· carries price</span>}
              </span>
              <strong>{component.weight}%</strong>
            </div>
          ))}
        </div>
      </Card>

      {/* Section 5 — savings */}
      <SavingsSection eventId={eventId} best={rows[0]} />
    </div>
  );
}

function LineComparisonGrid({ eventId, showTransformed }: { eventId: string; showTransformed: boolean }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bidders = biddersForEvent(state, eventId);
  const cmp = bestFirst(event.side);

  return (
    <div className="rfx-scroll-x">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, background: '#fff', textAlign: 'left', padding: '8px 10px', fontSize: 11, color: color.textSecondary, minWidth: 220 }}>
              Line
            </th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, color: color.textSecondary }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, color: color.textSecondary }}>Baseline</th>
            {bidders.map((bidder) => (
              <th key={bidder.id} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, color: color.textSecondary, minWidth: 110 }}>
                {COUNTERPARTY_NAMES[bidder.counterpartyId].split(' ')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LINE_ITEMS.map((item) => {
            const values = bidders.map((bidder) => {
              const response = state.responses.find((r) => r.bidderId === bidder.id);
              const line = response?.priceLines.find((l) => l.lineItemId === item.id);
              const unit = line?.unitPrice ?? 0;
              // Under "transformed" the line carries its share of the bidder's
              // adjustment, so the grid and the ranking agree.
              const factor = showTransformed
                ? 1 + (costComponentsFor(state, eventId)
                    .filter((c) => c.basis === 'PERCENTAGE')
                    .reduce((a, c) => a + (c.valueByBidder[bidder.id] ?? 0), 0)) / 100
                : 1;
              return { bidderId: bidder.id, value: unit * factor };
            });
            const best = values.length > 0
              ? [...values].sort((a, b) => cmp(a.value, b.value))[0]
              : null;

            return (
              <tr key={item.id} style={{ borderTop: `1px solid ${color.border}` }}>
                <td style={{ position: 'sticky', left: 0, background: '#fff', padding: '8px 10px' }}>
                  <div>{item.description}</div>
                  <div style={{ fontSize: 10.5, color: color.textSecondary }}>{item.itemCode}</div>
                </td>
                <td style={{ textAlign: 'right', padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                  {item.quantity.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 10px', fontVariantNumeric: 'tabular-nums', color: color.textSecondary }}>
                  {item.baselinePrice === null ? '—' : money(item.baselinePrice, item.currency)}
                </td>
                {values.map((entry) => {
                  const isBest = best !== null && entry.bidderId === best.bidderId && entry.value > 0;
                  return (
                    <td
                      key={entry.bidderId}
                      style={{
                        textAlign: 'right', padding: '8px 10px',
                        fontVariantNumeric: 'tabular-nums',
                        background: isBest ? color.successSoft : 'transparent',
                        fontWeight: isBest ? 700 : 400,
                        color: isBest ? color.successText : color.textPrimary,
                      }}
                    >
                      {entry.value === 0 ? '—' : `$${entry.value.toFixed(2)}`}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SavingsSection({ eventId, best }: { eventId: string; best: ScoreRow | undefined }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  if (!best) return null;

  const baselineTotal = LINE_ITEMS.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);
  const saving = baselineTotal - best.transformed;
  const savingPct = baselineTotal === 0 ? 0 : (saving / baselineTotal) * 100;

  return (
    <Card title="Savings" hint="Negotiated savings are known at award. Realised savings are only known post-GRN.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 12 }}>
        {[
          { label: 'Baseline value', value: money(baselineTotal, event.currency), tone: color.textPrimary, note: 'LPP and should-cost' },
          { label: 'Recommended value', value: money(best.transformed, event.currency), tone: color.textPrimary, note: `${best.name}, transformed` },
          {
            label: 'Negotiated saving', value: signedMoney(saving, event.currency),
            tone: savingsColor(saving), note: 'Known at award',
          },
          {
            label: 'Saving %', value: `${saving < 0 ? '−' : '+'}${Math.abs(savingPct).toFixed(1)}%`,
            tone: savingsColor(saving), note: 'Against baseline',
          },
          { label: 'Realised saving', value: 'pending', tone: color.textMuted, note: 'Known only post-GRN' },
        ].map((cell) => (
          <div key={cell.label} style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '11px 13px' }}>
            <div style={{ fontSize: 11, color: color.textSecondary }}>{cell.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: cell.tone, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              {cell.value}
            </div>
            <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>{cell.note}</div>
          </div>
        ))}
      </div>
      {saving < 0 && (
        <div style={{ marginTop: 12 }}>
          <ValidationBanner tone="error" title="Negative saving">
            The recommended value is above the baseline. This is shown, never suppressed, and appears on
            the NFA savings statement as it stands.
          </ValidationBanner>
        </div>
      )}
    </Card>
  );
}
