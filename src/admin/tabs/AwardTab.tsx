/**
 * Pack 22 — Award scenarios and the NFA.
 *
 * The NFA is auto-populated from the whole event, not a blank form. Section 8,
 * the recommendation, is the one section a human always writes.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import {
  Button, Chip, NumberInput, Segmented, Textarea, Toggle,
} from '../../design-system/components/primitives';
import { Card, Empty, Table, type Column } from '../../design-system/components/layout';
import { AgentCard, Modal, ValidationBanner } from '../../design-system/components/domain';
import { buyerView } from '../../server/auctionService';
import { buildApprovalSteps, separationOfDutiesBreach, simulate } from '../../domain/doa';
import { computeSavingsLine, totalSavings, BASELINE_LABELS } from '../../domain/savings';
import { JOURNEY_PATTERNS } from '../../domain/journeyPatterns';
import { auctionFor, biddersForEvent, lineItemsForEvent, lotsForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES, DOA_RULES } from '../../data/seed';
import { forbiddenReason } from '../../domain/agents';
import type { AwardScenarioKind, Nfa, SavingsLine } from '../../domain/types';

interface Allocation {
  lotId: string;
  lotName: string;
  bidderId: string;
  bidderName: string;
  sharePct: number;
  value: number;
  bidId: string;
}

export function AwardTab({ eventId, onGoTab }: { eventId: string; onGoTab: (tab: string) => void }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const bidders = biddersForEvent(state, eventId);
  const lots = lotsForEvent(state, eventId);
  const eventLines = lineItemsForEvent(state, eventId);
  const pattern = JOURNEY_PATTERNS[event.journeyPattern];

  const [scenario, setScenario] = React.useState<AwardScenarioKind>('RECOMMENDED');
  const [recommendation, setRecommendation] = React.useState('');
  const [overrideReason, setOverrideReason] = React.useState('');
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [maxSharePct, setMaxSharePct] = React.useState(100);
  const [dualSource, setDualSource] = React.useState(false);

  const held = auctionFor(state, eventId);
  const ranked = held !== null
    ? buyerView(held, held.lots[0]?.id ?? '', COUNTERPARTY_NAMES).filter((r) => r.bidCount > 0)
    : [];

  const nfa = state.nfas.find((n) => n.eventId === eventId);

  // Allocation depends on the scenario chosen.
  const allocations: Allocation[] = React.useMemo(() => {
    if (ranked.length === 0) return [];
    const lotName = held!.lotDetails['lot-1']?.name ?? 'Lot 1';
    const winnerBid = held!.bids
      .filter((b) => b.bidderId === ranked[0].bidderId && b.isValid)
      .sort((a, b) => a.transformedValue - b.transformedValue)[0];

    switch (scenario) {
      case 'DUAL_SOURCE': {
        if (ranked.length < 2) return [];
        const second = ranked[1];
        const secondBid = held!.bids
          .filter((b) => b.bidderId === second.bidderId && b.isValid)
          .sort((a, b) => a.transformedValue - b.transformedValue)[0];
        return [
          { lotId: 'lot-1', lotName, bidderId: ranked[0].bidderId, bidderName: ranked[0].displayName, sharePct: 70, value: ranked[0].transformedValue * 0.7, bidId: winnerBid?.id ?? '' },
          { lotId: 'lot-1', lotName, bidderId: second.bidderId, bidderName: second.displayName, sharePct: 30, value: second.transformedValue * 0.3, bidId: secondBid?.id ?? '' },
        ];
      }
      case 'BEST_TECHNICAL': {
        // Best technical here is the highest onboarding+performance composite.
        const best = [...ranked].sort((a, b) => {
          const bidderA = bidders.find((x) => x.id === a.bidderId)!;
          const bidderB = bidders.find((x) => x.id === b.bidderId)!;
          return (bidderB.qualificationSnapshot + bidderB.performanceRatingSnapshot)
            - (bidderA.qualificationSnapshot + bidderA.performanceRatingSnapshot);
        })[0];
        const bestBid = held!.bids
          .filter((b) => b.bidderId === best.bidderId && b.isValid)
          .sort((a, b) => a.transformedValue - b.transformedValue)[0];
        return [{ lotId: 'lot-1', lotName, bidderId: best.bidderId, bidderName: best.displayName, sharePct: 100, value: best.transformedValue, bidId: bestBid?.id ?? '' }];
      }
      default:
        return [{ lotId: 'lot-1', lotName, bidderId: ranked[0].bidderId, bidderName: ranked[0].displayName, sharePct: 100, value: ranked[0].transformedValue, bidId: winnerBid?.id ?? '' }];
    }
  }, [scenario, ranked, held, bidders]);

  const totalValue = allocations.reduce((a, x) => a + x.value, 0);
  const rankOneAwarded = allocations.some((a) => a.bidderId === ranked[0]?.bidderId && a.sharePct === 100);
  const isOverride = ranked.length > 0 && !rankOneAwarded;

  const awardedBidders = [...new Set(allocations.map((a) => a.bidderId))];
  const provisionalAwarded = awardedBidders.filter(
    (id) => bidders.find((b) => b.id === id)?.isProvisional,
  );

  // The DoA chain, resolved and simulated. Awarding off rank 1 applies the uplift.
  const doa = simulate(
    DOA_RULES,
    { value: totalValue, category: event.category, businessUnit: event.businessUnit },
    { rankOverride: isOverride, upliftLevels: 1 },
  );

  const savingsLines: SavingsLine[] = eventLines.map((item) => {
    const winner = allocations[0];
    const response = state.responses.find((r) => r.bidderId === winner?.bidderId);
    const priceLine = response?.priceLines.find((l) => l.lineItemId === item.id);
    return computeSavingsLine({
      lineItemId: item.id,
      lotName: lots.find((l) => l.id === item.lotId)?.name ?? '',
      description: item.description,
      quantity: item.quantity,
      awardedUnitPrice: priceLine?.unitPrice ?? item.baselinePrice ?? 0,
      baselineUnitPrice: item.baselinePrice,
      baselineSource: item.baselineSource,
    });
  });
  const savings = totalSavings(savingsLines);

  const deviations: string[] = [
    ...(isOverride ? [`Award to other than rank 1 — DoA uplift of one level applied. Reason: ${overrideReason || 'not yet given'}`] : []),
    ...(ranked.length === 1 ? ['Single-bid award — competition was not achieved.'] : []),
    ...(bidders.length < 3 ? [`Below-minimum competition — ${bidders.length} bidders invited against a minimum of 3.`] : []),
    ...(savings.negativeLines.length > 0 ? [`${savings.negativeLines.length} line(s) show a negative saving against baseline.`] : []),
    ...(provisionalAwarded.length > 0 ? ['A provisional counterparty is in the allocation and must be onboarded before award executes.'] : []),
  ];

  const skippedStages = (['RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'] as const).filter(
    (stage) => !event.stagesEnabled.includes(stage),
  );

  const separation = nfa ? separationOfDutiesBreach(state.currentUser.id, nfa.steps) : { breach: false, message: null };

  const submitNfa = () => {
    const created: Nfa = {
      id: `nfa-${Date.now()}`,
      eventId,
      scenarioId: scenario,
      comparisonSheetVersion: 3,
      recommendation,
      recommendedBy: state.currentUser.id,
      deviations,
      riskStatement:
        'AG-08 records no statutory or compliance blocker. One counterparty in the field is provisional; supply continuity risk is rated low given two qualified alternates.',
      doaUpliftApplied: doa.upliftApplied,
      overrideReason: isOverride ? overrideReason : null,
      steps: buildApprovalSteps(`nfa-${Date.now()}`, doa.chain),
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_NFA', nfa: created });
    dispatch({ type: 'UPDATE_EVENT', eventId, patch: { status: 'PENDING_AWARD_APPROVAL', currentStage: 'APPROVAL' } });
    setSubmitOpen(false);
    onGoTab('Approvals');
  };

  if (ranked.length === 0 && !nfa) {
    return (
      <Card>
        <Empty
          icon="◆"
          title="No commercial result to award from yet"
          hint="An award needs a completed auction or a comparison sheet. Run the auction, or complete evaluation first."
        />
      </Card>
    );
  }

  const allocationColumns: Column<Allocation>[] = [
    { key: 'lot', header: 'Lot', render: (a) => a.lotName },
    { key: 'bidder', header: 'Awarded to', render: (a) => <strong>{a.bidderName}</strong> },
    { key: 'share', header: 'Share', numeric: true, render: (a) => `${a.sharePct}%` },
    { key: 'value', header: 'Value', numeric: true, render: (a) => money(a.value, event.currency) },
    {
      key: 'trace', header: 'Traces to',
      render: (a) => (
        <span style={{ fontSize: 10.5, color: color.textSecondary }} title="Every award line traces to a bid and to a source PR line">
          bid {a.bidId || '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="rfx-split">
      <div className="rfx-stack" style={{ gap: 14 }}>
        {nfa && (
          <ValidationBanner
            tone="info"
            title="An NFA has been raised for this event"
            action={<Button size="small" variant="secondary" onClick={() => onGoTab('Approvals')}>View approvals →</Button>}
          >
            Raised {new Date(nfa.createdAt).toLocaleString()} with {nfa.steps.length} approval levels.
          </ValidationBanner>
        )}

        <Card
          title="Award scenarios"
          hint="Compare allocations before committing. The auction result is a recommendation, not an award."
        >
          <Segmented
            value={scenario}
            onChange={setScenario}
            options={[
              { value: 'RECOMMENDED', label: 'Recommended' },
              { value: 'LOWEST_TOTAL_COST', label: 'Lowest total cost' },
              { value: 'BEST_TECHNICAL', label: 'Best technical' },
              { value: 'DUAL_SOURCE', label: 'Dual source', disabled: ranked.length < 2 },
            ]}
          />

          <div style={{ marginTop: 14 }}>
            <Table columns={allocationColumns} rows={allocations} rowKey={(a) => `${a.lotId}-${a.bidderId}`} />
          </div>

          <div
            style={{
              marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: color.neutralSoft, borderRadius: radius.control,
            }}
          >
            <span style={{ fontSize: 12, color: color.textSecondary }}>Total award value</span>
            <strong style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
              {money(totalValue, event.currency)}
            </strong>
          </div>

          {isOverride && (
            <div className="rfx-stack" style={{ marginTop: 12, gap: 9 }}>
              <ValidationBanner tone="warning" title="This is a rank override">
                Awarding other than the top-ranked bidder applies a DoA uplift of one level automatically,
                and the override plus its reason appear prominently on the NFA.
              </ValidationBanner>
              <Textarea
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Justification for awarding other than rank 1 — required."
              />
            </div>
          )}

          {provisionalAwarded.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="error" title="Provisional counterparty in the allocation">
                <code>config.counterparty.provisional_award_allowed</code> is false. The award will hold
                at <strong>Award pending onboarding</strong> until onboarding completes.
              </ValidationBanner>
            </div>
          )}
        </Card>

        <Card title="Constraints" hint="AG-11 explains which constraints bound the solution and what each costs.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 5 }}>Max share per supplier (%)</div>
              <NumberInput value={maxSharePct} onChange={(e) => setMaxSharePct(Number(e.target.value))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Toggle checked={dualSource} onChange={setDualSource} label="Mandatory dual source" />
            </div>
          </div>
          {maxSharePct < 100 && allocations.some((a) => a.sharePct > maxSharePct) && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="warning" title="Max-share constraint is binding">
                The chosen scenario allocates {Math.max(...allocations.map((a) => a.sharePct))}% to one
                supplier, above the {maxSharePct}% cap. Switch to a split scenario or relax the cap.
              </ValidationBanner>
            </div>
          )}
        </Card>

        {/* The NFA — auto-populated from the whole event. */}
        <Card title="Note for Approval" hint="Twelve sections, populated from the event. Section 8 is written by a human, always.">
          <div className="rfx-stack" style={{ gap: 14 }}>
            <NfaSection n={1} title="Header">
              <Grid
                rows={[
                  ['Event', `${event.eventNumber} · ${event.title}`],
                  ['Category / BU', `${event.category} · ${event.businessUnit}`],
                  ['Value', money(totalValue, event.currency)],
                  ['Buyer', state.currentUser.name],
                ]}
              />
            </NfaSection>

            <NfaSection n={2} title="Requirement summary">
              {event.description || 'No description recorded.'}
              {event.sourceReference && ` Source requisition ${event.sourceReference}.`}
              {' '}
              {eventLines.length} lines across {lots.length} lot(s).
            </NfaSection>

            <NfaSection n={3} title="Process summary — including stages skipped and why">
              <div>
                Pattern followed: <strong>{pattern.id} · {pattern.name}</strong>.
                Stages executed: {event.stagesEnabled.join(' → ')}.
              </div>
              {skippedStages.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                  {skippedStages.map((stage) => (
                    <li key={stage}>
                      <strong>{stage}</strong> not executed — not part of {pattern.name}.
                    </li>
                  ))}
                </ul>
              )}
            </NfaSection>

            <NfaSection n={4} title="Competition summary">
              {bidders.length} invited · {bidders.filter((b) => b.invitationStatus === 'ACCEPTED').length} accepted ·{' '}
              {ranked.length} placed a valid bid ·{' '}
              {bidders.filter((b) => b.disqualified).length} disqualified.
              {bidders.length < 3 && (
                <div style={{ color: color.warningText, marginTop: 5 }}>
                  Below the minimum competition threshold of three bidders.
                </div>
              )}
            </NfaSection>

            <NfaSection n={5} title="Evaluation summary">
              Comparison &amp; ranking sheet <strong>version 3</strong> is attached and immutable at this
              version. {ranked.length} bidders ranked on transformed landed value.
            </NfaSection>

            <NfaSection n={6} title="Negotiation summary">
              {state.negotiationRounds.filter((r) => r.eventId === eventId).length === 0
                ? 'No negotiation rounds were run on this event.'
                : `${state.negotiationRounds.filter((r) => r.eventId === eventId).length} round(s) run.`}
            </NfaSection>

            <NfaSection n={7} title="Auction summary">
              {held !== null ? (
                <>
                  {held!.auction.mechanism} auction,{' '}
                  {held!.auction.feedbackPolicy} feedback,{' '}
                  {held!.bids.filter((b) => b.isValid).length} valid bids from {ranked.length} bidders.
                  Opening {money(held!.lots[0]?.startingPrice ?? 0, event.currency)} →
                  closing {money(ranked[0]?.transformedValue ?? 0, event.currency)}.
                  {held!.auction.extensionsUsed > 0 && ` ${held!.auction.extensionsUsed} soft-close extension(s).`}
                </>
              ) : (
                'No auction was run on this event.'
              )}
            </NfaSection>

            <NfaSection n={8} title="Recommendation — written by a human">
              <Textarea
                rows={4}
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                placeholder={`Recommend award to ${allocations[0]?.bidderName ?? '—'} at ${money(totalValue, event.currency)}. State why: price, technical fit, capacity, continuity.`}
              />
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 5 }}>
                AG-12 drafts sections 2–9 and 11. It never writes this section, and nothing is submitted
                without a human.
              </div>
            </NfaSection>

            <NfaSection n={9} title="Savings statement">
              <Grid
                rows={[
                  ['Baseline value', money(savings.baselineValue, event.currency)],
                  ['Awarded value', money(savings.awardedValue, event.currency)],
                  [
                    'Negotiated saving',
                    <span style={{ color: savingsColor(savings.negotiatedSavings), fontWeight: 700 }}>
                      {signedMoney(savings.negotiatedSavings, event.currency)} ({savings.negotiatedSavingsPct.toFixed(1)}%)
                    </span>,
                  ],
                  ['Realised saving', <em style={{ color: color.textMuted }}>pending — known only post-GRN</em>],
                  ['Baseline sources', [...new Set(savingsLines.map((l) => l.baselineSource))].filter(Boolean).map((s) => BASELINE_LABELS[s!]).join(', ')],
                ]}
              />
              {savings.negativeLines.length > 0 && (
                <div style={{ marginTop: 9 }}>
                  <ValidationBanner tone="error" title={`${savings.negativeLines.length} line(s) with a negative saving`}>
                    Shown in full, never suppressed:{' '}
                    {savings.negativeLines.map((l) => l.description).join('; ')}.
                  </ValidationBanner>
                </div>
              )}
            </NfaSection>

            <NfaSection n={10} title="Deviations and exceptions">
              {deviations.length === 0 ? (
                <span style={{ color: color.successText }}>No deviations.</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  {deviations.map((deviation) => <li key={deviation}>{deviation}</li>)}
                </ul>
              )}
            </NfaSection>

            <NfaSection n={11} title="Risk statement — from AG-08">
              AG-08 records no statutory or compliance blocker. One counterparty in the field is
              provisional; supply-continuity risk is rated low given two qualified alternates.
            </NfaSection>

            <NfaSection n={12} title="Approval chain — resolved from the DoA matrix">
              {doa.matchedRule === null ? (
                <span style={{ color: color.dangerText }}>
                  No DoA rule matches a value of {money(totalValue, event.currency)} in {event.category}.
                </span>
              ) : (
                <>
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 8 }}>
                    Matched rule: <strong>{doa.matchedRule.name}</strong> ·{' '}
                    {doa.matchedRule.chainMode.toLowerCase()} · total SLA {doa.totalSlaHours}h
                    {doa.upliftApplied && ' · one uplift level added for the rank override'}
                  </div>
                  <div className="rfx-stack" style={{ gap: 6 }}>
                    {doa.chain.map((level) => (
                      <div
                        key={level.level}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '8px 11px',
                        }}
                      >
                        <span
                          style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: color.neutralSoft, color: color.textSecondary,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10.5, fontWeight: 700,
                          }}
                        >
                          L{level.level}
                        </span>
                        <span style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{level.role}</span>
                        <span style={{ fontSize: 12, color: color.textSecondary }}>{level.holderName}</span>
                        <Chip tone="neutral">{level.slaHours}h SLA</Chip>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </NfaSection>
          </div>

          {separation.breach && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="error" title="Separation of duties">{separation.message}</ValidationBanner>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary">Save draft</Button>
            <Button
              variant="primary"
              disabled={
                recommendation.trim().length < 20 ||
                (isOverride && overrideReason.trim().length < 10) ||
                doa.matchedRule === null ||
                nfa !== undefined
              }
              onClick={() => setSubmitOpen(true)}
            >
              Submit for approval
            </Button>
          </div>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Savings by line" hint="Computed at line level, aggregated upward.">
          <div className="rfx-stack" style={{ gap: 8 }}>
            {savingsLines.map((line) => (
              <div key={line.lineItemId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {line.description}
                  </span>
                  <strong style={{ color: savingsColor(line.negotiatedSavings), flexShrink: 0 }}>
                    {signedMoney(line.negotiatedSavings, event.currency)}
                  </strong>
                </div>
                <div style={{ fontSize: 10, color: color.textSecondary }}>
                  baseline {line.baselineSource ? BASELINE_LABELS[line.baselineSource] : 'none'}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <AgentCard
          code="AG-11"
          name="Award Optimisation"
          autonomy="SUGGEST"
          confidence={0.84}
          summary={
            dualSource
              ? 'With mandatory dual source, a 70/30 split to the top two bidders costs roughly 1.4% against a single award. The dual-source constraint is the binding one.'
              : 'A single award to the leading bidder is the optimum under the current constraints. No constraint is binding.'
          }
          evidence={[
            { label: 'Transformed values', detail: ranked.map((r) => `${r.displayName.split(' ')[0]} ${money(r.transformedValue, event.currency)}`).join(', ') },
            { label: 'Constraints', detail: `max share ${maxSharePct}%, dual source ${dualSource ? 'on' : 'off'}` },
          ]}
          breaches={[forbiddenReason('FINAL_AWARD')]}
        />

        <AgentCard
          code="AG-13"
          name="Savings Validation"
          autonomy="AUTONOMOUS"
          confidence={null}
          summary={
            savings.negativeLines.length > 0
              ? `${savings.negativeLines.length} line(s) show a negative saving. The baselines look sound; the prices are simply above them.`
              : 'No baseline anomalies. No baseline was changed within 30 days of award.'
          }
          evidence={[
            { label: 'Baseline change log', detail: 'No changes in the 30 days before award' },
            { label: 'Market reference', detail: 'Baselines within tolerance of market median' },
          ]}
        />
      </div>

      <Modal
        open={submitOpen}
        title="Submit the NFA for approval"
        onClose={() => setSubmitOpen(false)}
        onConfirm={submitNfa}
        confirmLabel="Submit for approval"
      >
        <p style={{ margin: '0 0 10px' }}>
          This routes the NFA through {doa.chain.length} approval levels with a total SLA of{' '}
          {doa.totalSlaHours} hours.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Award to <strong>{allocations.map((a) => `${a.bidderName} (${a.sharePct}%)`).join(', ')}</strong></li>
          <li>Value <strong>{money(totalValue, event.currency)}</strong></li>
          <li>{deviations.length} deviation(s) recorded</li>
          {doa.upliftApplied && <li>DoA uplift applied for the rank override</li>}
        </ul>
      </Modal>
    </div>
  );
}

function NfaSection({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: `2px solid ${color.border}`, paddingLeft: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 20, height: 20, borderRadius: 5, flexShrink: 0,
            background: color.neutralSoft, color: color.textSecondary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10.5, fontWeight: 700,
          }}
        >
          {n}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ fontSize: 12.5, color: color.textBody, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Grid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="rfx-stack" style={{ gap: 5 }}>
      {rows.map(([label, value]) => (
        <div key={label} className="rfx-defrow">
          <span style={{ color: color.textSecondary }}>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
