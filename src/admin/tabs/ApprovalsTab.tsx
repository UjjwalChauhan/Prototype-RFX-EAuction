/**
 * Pack 23 + Pack 28 — the approval stage of an event, whole.
 *
 * Pack 23 built the clean run: the decision at the top, three headline facts,
 * the full note collapsed, and a live chain tracker. That is still what an
 * approver on a phone with thirty seconds sees first, and it is unchanged.
 *
 * Pack 28 builds everything the clean run leaves out — what happens when the
 * note is returned, corrected, re-submitted, recalled or rejected, and what
 * happens when someone says "we also need this item" after the note has gone.
 * Those surfaces hang off the same screen because they are the same object's
 * life, not a separate feature:
 *
 *   D1/D2  Revision control → drawer → read a revision, or diff two
 *   D3     Amendment banner over the editor, live as the buyer types
 *   D4     Chain history across revisions, superseded approvals struck
 *   D5     Recall, before and after the first approval
 *   D6     Rejection and its aftermath — the buyer-facing state
 *   D7     Post-NFA scope change: the blocked action and its routing
 *   D8     Award-quantity adjustment within tolerance
 *   D9     Correction after final approval — errata or a new revision
 *   D10    The open-decision sheet, which flips the screens behind it
 *
 * The prototype-state rail at the right is scaffolding, not product: it seeds
 * the notes with history a live system would accumulate over a week, and it
 * exposes the loading, error and read-only states the pack requires.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import { Button, Chip, Segmented, Select, Textarea, Toggle } from '../../design-system/components/primitives';
import { Card, Empty, Progress } from '../../design-system/components/layout';
import { Modal, ValidationBanner } from '../../design-system/components/domain';
import { simulate, slaStatuses } from '../../domain/doa';
import {
  NFA_STATUS_PRESENTATION, applyDecision, applyRecall, addErratum, currentRevision,
  escalateStep, raiseSuccessor, rejectionAftermath, snapshotChain, submitRevision,
  type ScopeChangeContext, type ScopeDestinationId,
} from '../../domain/nfaLifecycle';
import { buyerView } from '../../server/auctionService';
import { serverNow } from '../../server/clock';
import { biddersForEvent, contractsForEvent, nfaForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES, DOA_RULES, LINE_ITEMS } from '../../data/seed';
import {
  AWARD_QUANTITY_TOLERANCE_PCT, DRIFTED_DOA_RULES, NFA_SCENARIO_HINTS,
  NFA_SCENARIO_LABELS, OUT_OF_SCOPE_ITEM, UNQUOTED_ITEM, buildScenarioNfa,
  type NfaScenarioId,
} from '../../data/nfaScenarios';
import { RevisionControl, RevisionDrawer } from '../nfa/RevisionDrawer';
import { AmendmentEditor } from '../nfa/Amendment';
import { ChainHistory } from '../nfa/ChainHistory';
import { RecallControl, RejectionAftermathPanel } from '../nfa/RecallAndRejection';
import { ScopeChangePanel } from '../nfa/ScopeChangePanel';
import { QuantityAdjustmentPanel } from '../nfa/QuantityAdjustment';
import { PostApprovalCorrection } from '../nfa/PostApprovalCorrection';
import { OpenDecisionSheet } from '../nfa/OpenDecisionSheet';
import type { ApprovalDecision, NfaDocument } from '../../domain/types';

type LoadState = 'READY' | 'LOADING' | 'ERROR';

export function ApprovalsTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const nfa = nfaForEvent(state, eventId);
  const bidders = biddersForEvent(state, eventId);
  const settings = state.nfaOptions;

  // -- Pack 23's original decision surface ----------------------------------
  const [fullOpen, setFullOpen] = React.useState(false);
  const [decisionModal, setDecisionModal] = React.useState<ApprovalDecision | null>(null);
  const [comment, setComment] = React.useState('');
  const [delegateTo, setDelegateTo] = React.useState('L. Fernandes');
  const [loaOpen, setLoaOpen] = React.useState(false);

  // -- Pack 28's surfaces ---------------------------------------------------
  /**
   * Which note the revision drawer is showing. Usually the live one — but a
   * successor raised under OD-04b has to be able to open the note it replaced,
   * or "a rejected revision with its successor linked" is a claim with no
   * screen behind it.
   */
  const [drawerNfaId, setDrawerNfaId] = React.useState<string | null>(null);
  const [decisionSheetOpen, setDecisionSheetOpen] = React.useState(false);
  const [scopeChange, setScopeChange] = React.useState<ScopeChangeContext | null>(null);
  const [handoffs, setHandoffs] = React.useState<{ id: string; destination: ScopeDestinationId; item: string }[]>([]);
  const [loadState, setLoadState] = React.useState<LoadState>('READY');
  const [doaEdited, setDoaEdited] = React.useState(false);

  const seedScenario = (scenario: NfaScenarioId) => {
    dispatch({ type: 'SET_EVENT_NFA', eventId, nfa: buildScenarioNfa(scenario, eventId) });
    dispatch({
      type: 'UPDATE_EVENT', eventId,
      patch: { status: 'PENDING_AWARD_APPROVAL', currentStage: 'APPROVAL' },
    });
  };

  // Read-only observers see every surface and can act on none of them.
  const readOnly = state.observerMode || state.currentUser.permissions.includes('view_only');
  const isApprover = state.currentUser.permissions.includes('approve_at_level');
  const isBuyer = state.currentUser.permissions.includes('recommend_award');

  const ranked = state.auction.auction.eventId === eventId
    ? buyerView(state.auction, 'al-1', COUNTERPARTY_NAMES).filter((r) => r.bidCount > 0)
    : [];
  const winner = ranked[0];

  // -- Loading and error ----------------------------------------------------
  if (loadState !== 'READY') {
    return (
      <div className="rfx-split">
        {loadState === 'LOADING' ? (
          <Card title="Approval" hint="Loading the note and its revisions…">
            <div className="rfx-stack" style={{ gap: 10 }}>
              <div className="rfx-skeleton" style={{ height: 92 }} />
              <div className="rfx-skeleton" style={{ height: 150 }} />
              <div className="rfx-skeleton" style={{ height: 220 }} />
            </div>
          </Card>
        ) : (
          <Card>
            <ValidationBanner
              tone="error"
              title="The revision history could not be loaded"
              action={<Button size="small" variant="secondary" onClick={() => setLoadState('READY')}>Retry</Button>}
            >
              The note itself is intact — this is a read failure, not a lost revision. Nothing has been
              decided, submitted or discarded, and no approver has been notified. Retry, or open the
              audit pack, which reads from a different store.
            </ValidationBanner>
          </Card>
        )}
        <PrototypeRail
          nfa={nfa}
          loadState={loadState}
          onLoadState={setLoadState}
          onSeed={seedScenario}
          onClear={() => dispatch({ type: 'SET_EVENT_NFA', eventId, nfa: null })}
          doaEdited={doaEdited}
          onDoaEdited={setDoaEdited}
          readOnly={readOnly}
          onOpenDecisions={() => setDecisionSheetOpen(true)}
          onScopeChange={setScopeChange}
          event={event}
        />
      </div>
    );
  }

  if (!nfa) {
    return (
      <div className="rfx-split">
        <Card>
          <Empty
            icon="✓"
            title="No approval in flight"
            hint="An NFA raised from the Award tab appears here with its resolved DoA chain, its revision history and its amendment surfaces. Seed one from the panel on the right to see the lifecycle."
          />
        </Card>
        <PrototypeRail
          nfa={undefined}
          loadState={loadState}
          onLoadState={setLoadState}
          onSeed={seedScenario}
          onClear={() => dispatch({ type: 'SET_EVENT_NFA', eventId, nfa: null })}
          doaEdited={doaEdited}
          onDoaEdited={setDoaEdited}
          readOnly={readOnly}
          onOpenDecisions={() => setDecisionSheetOpen(true)}
          onScopeChange={setScopeChange}
          event={event}
        />
        <OpenDecisionSheet
          open={decisionSheetOpen}
          onClose={() => setDecisionSheetOpen(false)}
          settings={settings}
          onChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
        />
      </div>
    );
  }

  const live = currentRevision(nfa);
  const steps = live?.steps ?? nfa.steps;
  const statuses = slaStatuses(steps, serverNow());
  const currentIndex = steps.findIndex((_, i) => statuses[i].state === 'CURRENT');
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const approvedCount = steps.filter((s) => s.decision === 'APPROVED').length;
  const allApproved = steps.length > 0 && approvedCount === steps.length;

  const document_ = live?.document ?? nfa.draft;
  const awardValue = document_.totalValue;
  const baseline = event.estimatedValue;
  const saving = baseline - awardValue;

  // The matrix as it stands *today*. A decided revision never reads this — it
  // reads its own snapshot — but the drift notice needs both to compare.
  const liveDoa = simulate(
    doaEdited ? DRIFTED_DOA_RULES : DOA_RULES,
    { value: awardValue, category: event.category, businessUnit: event.businessUnit },
    { rankOverride: document_.rankOverride, upliftLevels: 1 },
  );

  const canDecide = isApprover && !readOnly && nfa.status === 'IN_APPROVAL' && currentStep !== undefined;
  const canAmend = isBuyer && !readOnly
    && (nfa.status === 'RETURNED' || nfa.status === 'RECALLED');

  const decide = (decision: ApprovalDecision) => {
    if (!currentStep || decision === 'PENDING') return;
    const next = applyDecision({
      nfa,
      level: currentStep.level,
      decision,
      comment,
      actorName: state.currentUser.name,
      delegateToName: decision === 'DELEGATED' ? delegateTo : undefined,
      at: Date.now(),
    });
    dispatch({ type: 'REPLACE_NFA', nfa: next });

    if (decision === 'APPROVED' && next.status === 'APPROVED') {
      const provisional = bidders.some((b) => b.isProvisional && b.id === winner?.bidderId);
      dispatch({
        type: 'UPDATE_EVENT', eventId,
        patch: {
          status: provisional ? 'AWARD_PENDING_ONBOARDING' : 'AWARDED',
          awardedAt: Date.now(),
        },
      });
    } else if (decision === 'REJECTED') {
      // OD-04 decides whether a rejection cancels the event or returns it.
      dispatch({
        type: 'UPDATE_EVENT', eventId,
        patch: { status: rejectionAftermath(settings).eventStatus, currentStage: 'AWARD' },
      });
    } else if (decision === 'RETURNED') {
      dispatch({
        type: 'UPDATE_EVENT', eventId,
        patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' },
      });
    }
    setDecisionModal(null);
    setComment('');
  };

  const resubmit = () => {
    const { nfa: next } = submitRevision({
      nfa,
      document: nfa.draft,
      chain: snapshotChain(liveDoa, Date.now()),
      actorId: state.currentUser.id,
      actorName: state.currentUser.name,
      at: Date.now(),
      settings,
    });
    dispatch({ type: 'REPLACE_NFA', nfa: next });
    dispatch({
      type: 'UPDATE_EVENT', eventId,
      patch: { status: 'PENDING_AWARD_APPROVAL', currentStage: 'APPROVAL' },
    });
  };

  const statusPresentation = NFA_STATUS_PRESENTATION[nfa.status];
  const awardedLine = LINE_ITEMS[0];

  return (
    <div className="rfx-split">
      {/* Single column, narrow: an approver decides from a phone. */}
      <div className="rfx-stack" style={{ gap: 14, maxWidth: 760 }}>
        {readOnly && (
          <ValidationBanner tone="info" title="Read-only — Observer">
            You can see every revision, the diff, the chain history and the reasons. You cannot decide,
            recall, amend or author an errata note. Nothing on this screen is hidden from an observer;
            the controls are simply inert.
          </ValidationBanner>
        )}

        {/* The decision, at the top. Pack 23's card, with Pack 28's revision control. */}
        <div
          style={{
            background: color.surface, border: `1px solid ${color.border}`,
            borderRadius: radius.card, padding: '16px 18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: statusPresentation.bg, color: statusPresentation.fg,
                borderRadius: radius.pill, padding: '2px 10px', fontSize: 11.5, fontWeight: 700,
              }}
            >
              <span aria-hidden>{statusPresentation.icon}</span>{statusPresentation.label}
            </span>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: color.textSecondary }}>
              {steps.length > 0
                ? `Level ${currentStep?.level ?? steps.length} of ${steps.length}`
                : 'Chain not yet resolved'}
            </span>
            <span style={{ flex: 1 }} />
            <RevisionControl nfa={nfa} onOpen={() => setDrawerNfaId(nfa.id)} />
          </div>

          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8, lineHeight: 1.3 }}>
            Award {money(awardValue, event.currency)} to{' '}
            {document_.allocations.map((a) => a.bidderName).join(' + ') || '—'}
          </div>
          <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
            {event.eventNumber} · {event.title}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: 10, marginTop: 14 }}>
            <Headline
              label="Saving vs baseline"
              value={`${signedMoney(saving, event.currency)} · ${((saving / baseline) * 100).toFixed(1)}%`}
              tone={savingsColor(saving)}
            />
            <Headline
              label="Bidders competing"
              value={`${ranked.length} bid of ${bidders.length} invited`}
              tone={bidders.length >= 3 ? color.textPrimary : color.warningText}
            />
            <Headline
              label="Deviation flags"
              value={document_.deviations.length === 0 ? 'None' : `${document_.deviations.length} flagged`}
              tone={document_.deviations.length === 0 ? color.successText : color.warningText}
            />
          </div>

          {nfa.doaUpliftApplied && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="warning" title="Rank override — DoA uplift applied">
                {nfa.overrideReason}
              </ValidationBanner>
            </div>
          )}

          {nfa.status === 'RETURNED' && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="warning" title="Returned to you — the pen is back with the buyer">
                {live?.steps.find((s) => s.decision === 'RETURNED')?.comment
                  ?? 'An approver returned the note with comments.'}
              </ValidationBanner>
            </div>
          )}

          {nfa.status === 'RECALLED' && (
            <div style={{ marginTop: 12 }}>
              <ValidationBanner tone="info" title="Recalled by the buyer">
                {nfa.recallReason} — the revision is frozen and retained. Amend below and re-submit as a
                new revision.
              </ValidationBanner>
            </div>
          )}

          {allApproved && nfa.status === 'APPROVED' ? (
            <div className="rfx-stack" style={{ marginTop: 14, gap: 10 }}>
              <ValidationBanner tone="success" title="Fully approved">
                Every level has approved. Award execution is now available — a letter of award, regret
                notifications and the PO or contract handoff. Not yet executed, so a correction is still
                cheap: see the correction panel below.
              </ValidationBanner>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" disabled={readOnly} onClick={() => setLoaOpen(true)}>
                  Issue letter of award
                </Button>
                <Button variant="secondary" disabled={readOnly}>Send regret notifications</Button>
                <Button variant="secondary" disabled={readOnly}>Generate PO</Button>
              </div>
            </div>
          ) : canDecide ? (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => setDecisionModal('APPROVED')}>Approve</Button>
              <Button variant="secondary" onClick={() => setDecisionModal('RETURNED')}>Return with comments</Button>
              <Button variant="destructive" onClick={() => setDecisionModal('REJECTED')}>Reject</Button>
              <Button variant="tertiary" onClick={() => setDecisionModal('DELEGATED')}>Delegate</Button>
              {currentStep && statuses[currentIndex]?.overdue && (
                <Button
                  variant="tertiary"
                  title="A breached SLA moves the step up a level. It stays in the history as an escalation."
                  onClick={() => dispatch({
                    type: 'REPLACE_NFA',
                    nfa: escalateStep(nfa, currentStep.level, 'V. Chandra'),
                  })}
                >
                  Escalate
                </Button>
              )}
            </div>
          ) : nfa.status === 'IN_APPROVAL' ? (
            <div style={{ marginTop: 14 }}>
              <ValidationBanner tone="info" title={`Awaiting ${currentStep?.holderName ?? 'the next approver'}`}>
                You are not the current approver. Switch to the Approver persona from the user menu to act
                on this step. Bulk approve is deliberately not offered for award NFAs.
              </ValidationBanner>
            </div>
          ) : null}
        </div>

        {/* A successor note raised under OD-04b has no revision yet: it carries
            its predecessor's content and its rejection reason, and revision 1
            is submitted from here. */}
        {nfa.predecessorNfaId && !live && (
          <Card
            title="Successor note — not yet submitted"
            hint={`Linked to ${nfa.predecessorNfaId.toUpperCase()}, which was rejected.`}
          >
            <div className="rfx-stack" style={{ gap: 12 }}>
              <ValidationBanner tone="warning" title="Why the predecessor was rejected">
                {predecessorReason(state.nfas, nfa.predecessorNfaId)
                  ?? 'The rejection reason is recorded on the predecessor note.'}
                {' '}This travels with the successor and is visible to the new chain — a second note that
                does not say why the first one failed asks the chain to decide blind.
              </ValidationBanner>
              <div style={{ fontSize: 12.5, color: color.textBody }}>
                The allocation, deviations and evidence carried over from the rejected note. Amend the
                award on the Award tab, then submit revision 1 here.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  onClick={() => setDrawerNfaId(nfa.predecessorNfaId)}
                >
                  Open the rejected note →
                </Button>
                <Button variant="primary" disabled={readOnly || !isBuyer} onClick={resubmit}>
                  Submit revision 1 for approval
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* D3 — the amendment banner and the editor under it. */}
        {(nfa.status === 'RETURNED' || nfa.status === 'RECALLED') && live && (
          canAmend ? (
            <AmendmentEditor
              base={live.document}
              draft={nfa.draft}
              onChange={(draft) => dispatch({ type: 'UPDATE_NFA', nfaId: nfa.id, patch: { draft } })}
              steps={live.steps}
              settings={settings}
              currency={event.currency}
              onSubmit={resubmit}
              canSubmit={!readOnly}
            />
          ) : (
            <ValidationBanner tone="info" title="Amendment is the buyer's">
              The note is with the buyer. Switch to the Category Manager persona to see the amendment
              banner update live as the note is edited.
            </ValidationBanner>
          )
        )}

        {/* Live chain tracker — Pack 23's, kept, for the revision in flight. */}
        {nfa.status === 'IN_APPROVAL' && (
          <Card title="Approval chain — this revision" hint={`${approvedCount} of ${steps.length} complete`}>
            <Progress value={approvedCount} max={steps.length} />
            <div className="rfx-stack" style={{ gap: 8, marginTop: 12 }}>
              {steps.map((step, i) => {
                const status = statuses[i];
                return (
                  <div
                    key={step.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      border: `1px solid ${status.state === 'CURRENT' ? color.brandPrimary : color.border}`,
                      background: status.state === 'CURRENT' ? '#F5F8FF' : '#fff',
                      borderRadius: radius.control, padding: '9px 12px',
                    }}
                  >
                    <span
                      style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background:
                          step.decision === 'APPROVED' ? color.success
                          : step.decision === 'REJECTED' ? color.danger
                          : status.state === 'CURRENT' ? color.brandPrimarySoft
                          : color.neutralSoft,
                        color:
                          step.decision === 'APPROVED' || step.decision === 'REJECTED' ? '#fff'
                          : status.state === 'CURRENT' ? color.brandPrimary
                          : color.textMuted,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10.5, fontWeight: 700,
                      }}
                    >
                      {step.decision === 'APPROVED' ? '✓' : step.decision === 'REJECTED' ? '✕' : `L${step.level}`}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: status.state === 'CURRENT' ? 600 : 400 }}>
                        {step.role}
                      </div>
                      <div style={{ fontSize: 11, color: color.textSecondary }}>
                        {step.holderName}
                        {step.comment && ` · "${step.comment}"`}
                      </div>
                    </div>
                    {step.carriedForward && <Chip tone="brand" icon="→">carried forward</Chip>}
                    {step.kind === 'ESCALATED' && step.escalatedFromName && (
                      <Chip tone="gold" icon="↑">escalated from {step.escalatedFromName}</Chip>
                    )}
                    {step.kind === 'DELEGATED' && step.delegatedToName && (
                      <Chip tone="purple" icon="⇢">delegated</Chip>
                    )}
                    {status.state === 'CURRENT' && status.hoursElapsed !== null && (
                      <Chip tone={status.overdue ? 'danger' : 'gold'} icon={status.overdue ? '⏰' : '◷'}>
                        {status.overdue
                          ? `overdue by ${(status.hoursElapsed - step.slaHours).toFixed(0)}h`
                          : `${(step.slaHours - status.hoursElapsed).toFixed(0)}h left`}
                      </Chip>
                    )}
                    {status.state === 'PENDING' && <Chip tone="neutral">{step.slaHours}h SLA</Chip>}
                    {step.decision === 'APPROVED' && <Chip tone="brand" icon="✓">approved</Chip>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* D6 — rejection and its aftermath. */}
        {nfa.status === 'REJECTED' && (
          <RejectionAftermathPanel
            nfa={nfa}
            settings={settings}
            onSettingsChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
            onRaiseSuccessor={() => {
              const { predecessor, successor } = raiseSuccessor(nfa, `nfa-${Date.now()}`, Date.now());
              dispatch({ type: 'REPLACE_NFA', nfa: predecessor });
              dispatch({ type: 'REPLACE_NFA', nfa: successor });
              dispatch({
                type: 'UPDATE_EVENT', eventId,
                patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' },
              });
            }}
            onCancelEvent={() =>
              dispatch({ type: 'UPDATE_EVENT', eventId, patch: { status: 'CANCELLED' } })
            }
          />
        )}

        {/* D9 — correction after final approval. */}
        {nfa.status === 'APPROVED' && (
          <PostApprovalCorrection
            nfa={nfa}
            settings={settings}
            onSettingsChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
            canAuthor={!readOnly && errataAuthorAllowed(settings.od08ErrataAuthor, isBuyer, isApprover)}
            authorName={state.currentUser.name}
            authorId={state.currentUser.id}
            onErratum={(erratum) => dispatch({ type: 'REPLACE_NFA', nfa: addErratum(nfa, erratum) })}
            onNewRevision={(corrected: NfaDocument) => {
              // Hand the corrected document to the amendment flow: the banner
              // names the consequence before anything is submitted.
              dispatch({
                type: 'UPDATE_NFA', nfaId: nfa.id,
                patch: { draft: corrected, status: 'RETURNED' },
              });
            }}
          />
        )}

        {/* D4 — the record, across every revision. */}
        <ChainHistory nfa={nfa} settings={settings} />

        {/* D5 — recall. */}
        {(nfa.status === 'IN_APPROVAL' || nfa.status === 'RETURNED') && (
          <RecallControl
            nfa={nfa}
            settings={settings}
            onSettingsChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
            disabledByRole={readOnly || !isBuyer}
            onRecall={(reason) => {
              dispatch({ type: 'REPLACE_NFA', nfa: applyRecall(nfa, reason, Date.now()) });
              dispatch({
                type: 'UPDATE_EVENT', eventId,
                patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' },
              });
            }}
          />
        )}

        {/* D8 — award-quantity adjustment within tolerance. A rejected note has
            no award to adjust, so the panel is absent rather than inert. */}
        {nfa.status !== 'REJECTED' && (
        <QuantityAdjustmentPanel
          awardedQuantity={document_.allocations[0]?.quantity ?? awardedLine.quantity}
          lineDescription={awardedLine.description}
          lineTotalQuantity={awardedLine.quantity + 2_000}
          prQuantity={awardedLine.quantity}
          unitPrice={awardedLine.baselinePrice ?? 10}
          currency={event.currency}
          tolerancePct={AWARD_QUANTITY_TOLERANCE_PCT}
          settings={settings}
          readOnly={readOnly || !isBuyer}
          onSettingsChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
          onRouteOutOfTolerance={(proposed) =>
            setScopeChange({
              kind: 'QUANTITY_CHANGE',
              eventStatus: event.status,
              origin: 'NFA',
              itemDescription: `${awardedLine.description} — ${proposed.toLocaleString()} against ${(document_.allocations[0]?.quantity ?? awardedLine.quantity).toLocaleString()} awarded`,
              itemCategory: event.category,
              itemValue: Math.abs(proposed - (document_.allocations[0]?.quantity ?? awardedLine.quantity))
                * (awardedLine.baselinePrice ?? 10),
              currency: event.currency,
              contract: contractsForEvent(state, eventId)[0] ?? null,
            })
          }
          onApply={(proposed, path) => {
            const allocations = document_.allocations.map((line, i) =>
              i === 0 ? { ...line, quantity: proposed } : line,
            );
            dispatch({
              type: 'UPDATE_NFA', nfaId: nfa.id,
              patch: { draft: { ...nfa.draft, allocations } },
            });
            if (path !== 'LOGGED_NO_APPROVAL') {
              dispatch({ type: 'UPDATE_NFA', nfaId: nfa.id, patch: { status: 'RETURNED' } });
            }
          }}
        />
        )}

        {/* The full note, collapsed by default. */}
        <Card
          title="Full note for approval"
          hint="Collapsed by default — the decision above is what the approver needs first. Pack 22 owns the twelve sections; this pack shows revisions of them."
          action={
            <Button size="small" variant="secondary" onClick={() => setFullOpen((v) => !v)}>
              {fullOpen ? 'Collapse' : 'Expand'}
            </Button>
          }
        >
          {fullOpen ? (
            <div className="rfx-stack" style={{ gap: 12, fontSize: 12.5, lineHeight: 1.65 }}>
              <div>
                <strong>Recommendation</strong>
                <div style={{ marginTop: 4 }}>{document_.recommendation}</div>
              </div>
              <div>
                <strong>Risk statement</strong>
                <div style={{ marginTop: 4 }}>{document_.riskStatement}</div>
              </div>
              <div>
                <strong>Deviations</strong>
                {document_.deviations.length === 0 ? (
                  <div style={{ marginTop: 4, color: color.successText }}>None.</div>
                ) : (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {document_.deviations.map((deviation) => <li key={deviation}>{deviation}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <strong>Attached comparison sheet</strong>
                <div style={{ marginTop: 4 }}>
                  Version {document_.comparisonSheetVersion} — immutable at this version, and reproducible.
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: color.textSecondary }}>
              {document_.deviations.length} deviation(s) · comparison sheet v{document_.comparisonSheetVersion} attached ·
              recommendation written by {nfa.recommendedBy}
            </div>
          )}
        </Card>

        {handoffs.length > 0 && (
          <Card
            title="Scope-change handoffs from this event"
            hint="Every event created from the blocked-action panel links back to its origin, and the origin shows the link."
          >
            <div className="rfx-stack" style={{ gap: 8 }}>
              {handoffs.map((h) => (
                <div key={h.id} className="rfx-defrow" style={{ fontSize: 12.5 }}>
                  <span style={{ color: color.textSecondary }}>
                    {h.destination === 'NEW_EVENT' ? 'New sourcing event'
                      : h.destination === 'CALL_OFF' ? 'Contract call-off'
                      : 'Corrigendum'}
                  </span>
                  <span>
                    {h.item}
                    <span style={{ color: color.textSecondary }}> · parent {event.eventNumber}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <PrototypeRail
        nfa={nfa}
        loadState={loadState}
        onLoadState={setLoadState}
        onSeed={seedScenario}
        onClear={() => dispatch({ type: 'SET_EVENT_NFA', eventId, nfa: null })}
        doaEdited={doaEdited}
        onDoaEdited={setDoaEdited}
        readOnly={readOnly}
        onOpenDecisions={() => setDecisionSheetOpen(true)}
        onScopeChange={setScopeChange}
        event={event}
      />

      {/* D1 / D2 */}
      {drawerNfaId && (
        <RevisionDrawer
          open
          nfa={state.nfas.find((n) => n.id === drawerNfaId) ?? nfa}
          onClose={() => setDrawerNfaId(null)}
          liveDoa={liveDoa}
          settings={settings}
          currency={event.currency}
        />
      )}

      {/* D10 */}
      <OpenDecisionSheet
        open={decisionSheetOpen}
        onClose={() => setDecisionSheetOpen(false)}
        settings={settings}
        onChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
      />

      {/* D7 */}
      {scopeChange && (
        <ScopeChangePanel
          open
          context={scopeChange}
          settings={settings}
          onSettingsChange={(patch) => dispatch({ type: 'SET_NFA_OPTION', patch })}
          onClose={() => setScopeChange(null)}
          onRoute={(destination) => {
            setHandoffs((prior) => [
              ...prior,
              { id: `ho-${Date.now()}`, destination, item: scopeChange.itemDescription },
            ]);
            setScopeChange(null);
          }}
        />
      )}

      <Modal
        open={decisionModal !== null}
        title={
          decisionModal === 'APPROVED' ? 'Approve this award'
          : decisionModal === 'RETURNED' ? 'Return with comments'
          : decisionModal === 'REJECTED' ? 'Reject this award'
          : 'Delegate this approval'
        }
        onClose={() => setDecisionModal(null)}
        onConfirm={() => decisionModal && decide(decisionModal)}
        confirmLabel={decisionModal === 'APPROVED' ? 'Approve' : decisionModal === 'DELEGATED' ? 'Delegate' : 'Confirm'}
        confirmTone={decisionModal === 'REJECTED' ? 'destructive' : 'primary'}
        // Comments are mandatory on Return and Reject.
        confirmDisabled={
          (decisionModal === 'RETURNED' || decisionModal === 'REJECTED') && comment.trim().length < 10
        }
      >
        <div className="rfx-stack" style={{ gap: 12 }}>
          <div>
            Award of <strong>{money(awardValue, event.currency)}</strong> to{' '}
            <strong>{document_.allocations.map((a) => a.bidderName).join(' + ')}</strong> at level{' '}
            {currentStep?.level}.
          </div>
          {decisionModal === 'REJECTED' && (
            <ValidationBanner tone="warning" title="What a rejection leaves behind">
              {rejectionAftermath(settings).consequence}
            </ValidationBanner>
          )}
          {decisionModal === 'DELEGATED' && (
            <div className="rfx-stack" style={{ gap: 6 }}>
              <div style={{ fontSize: 12, color: color.textSecondary }}>
                Delegating passes the step on. It is not a decision — the delegate still has to decide,
                and both names stay in the chain history.
              </div>
              <Select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
                {['L. Fernandes', 'V. Chandra', 'D. Okafor'].map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
            </div>
          )}
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              decisionModal === 'APPROVED'
                ? 'Optional comment.'
                : 'Comment is mandatory — tell the buyer what needs to change.'
            }
          />
          {(decisionModal === 'RETURNED' || decisionModal === 'REJECTED') && (
            <div style={{ fontSize: 11.5, color: color.textSecondary }}>
              A comment is mandatory on return and rejection. The buyer cannot act on a decision without
              knowing why, and on a rejection it is carried into any successor note.
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={loaOpen}
        title="Issue letter of award"
        onClose={() => setLoaOpen(false)}
        onConfirm={() => setLoaOpen(false)}
        confirmLabel="Issue LoA"
      >
        <p style={{ margin: '0 0 10px' }}>
          The letter of award goes to{' '}
          <strong>{document_.allocations.map((a) => a.bidderName).join(' + ')}</strong> through the vendor
          portal and by email, with acknowledgement tracking.
        </p>
        <p style={{ margin: 0, color: color.textSecondary }}>
          Once the LoA is issued the award is executed, and a correction stops being an errata note and
          starts being a contract amendment — which is the PO module's, not this one's.
        </p>
      </Modal>
    </div>
  );
}

/** The rejection reason a successor note carries, read off its predecessor. */
function predecessorReason(
  nfas: import('../../domain/types').Nfa[], predecessorId: string,
): string | null {
  return nfas.find((n) => n.id === predecessorId)?.rejectionReason ?? null;
}

function errataAuthorAllowed(
  option: 'BUYER' | 'BUYER_AND_APPROVER' | 'ADMIN_ONLY',
  isBuyer: boolean,
  isApprover: boolean,
): boolean {
  switch (option) {
    case 'BUYER': return isBuyer;
    case 'BUYER_AND_APPROVER': return isBuyer || isApprover;
    case 'ADMIN_ONLY': return false;
  }
}

// ---------------------------------------------------------------------------
// The rail — prototype scaffolding, plus the open-decision entry point
// ---------------------------------------------------------------------------

function PrototypeRail({
  nfa, loadState, onLoadState, onSeed, onClear, doaEdited, onDoaEdited, readOnly,
  onOpenDecisions, onScopeChange, event,
}: {
  nfa: import('../../domain/types').Nfa | undefined;
  loadState: LoadState;
  onLoadState: (state: LoadState) => void;
  onSeed: (scenario: NfaScenarioId) => void;
  onClear: () => void;
  doaEdited: boolean;
  onDoaEdited: (value: boolean) => void;
  readOnly: boolean;
  onOpenDecisions: () => void;
  onScopeChange: (context: ScopeChangeContext) => void;
  event: import('../../domain/types').SourcingEvent;
}) {
  const { state, dispatch } = useStore();
  const contract = contractsForEvent(state, event.id)[0] ?? null;

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <Card
        title="Open decisions"
        hint="Nine unresolved questions in §B14.8. Seven of them change what you are looking at."
        action={<Button size="small" variant="primary" onClick={onOpenDecisions}>Open the sheet</Button>}
      >
        <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
          Every variant the register lists is reachable from these screens. Choosing an option on the
          sheet changes the screens behind it, so the register can be settled by pointing rather than by
          reading a table.
        </div>
      </Card>

      <Card
        title="Post-NFA scope change"
        hint="The answer to “can I add this item?” — never a disabled control with no explanation."
      >
        <div className="rfx-stack" style={{ gap: 8 }}>
          <Button
            variant="secondary"
            size="small"
            onClick={() => onScopeChange({
              kind: 'ADD_LINE',
              eventStatus: event.status,
              origin: 'AWARD_SCENARIOS',
              itemDescription: UNQUOTED_ITEM.description,
              itemCategory: UNQUOTED_ITEM.category,
              itemValue: UNQUOTED_ITEM.estimatedValue,
              currency: event.currency,
              contract,
            })}
          >
            Add an unquoted line →
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => onScopeChange({
              kind: 'ADD_LINE',
              eventStatus: event.status,
              origin: 'ITEMS_AND_LOTS',
              itemDescription: OUT_OF_SCOPE_ITEM.description,
              itemCategory: OUT_OF_SCOPE_ITEM.category,
              itemValue: OUT_OF_SCOPE_ITEM.estimatedValue,
              currency: event.currency,
              contract,
            })}
          >
            Add a line no contract covers →
          </Button>
          {contract && (
            <div style={{ fontSize: 11, color: color.textSecondary }}>
              {contract.contractNumber} covers {contract.categoryScope.join(', ')} with{' '}
              {money(contract.ceilingValue - contract.committedValue, contract.currency)} of headroom.
              The second button asks for a category it does not cover, so the call-off destination is
              absent rather than disabled.
            </div>
          )}
        </div>
      </Card>

      <Card title="Prototype states" hint="Scaffolding, not product — it seeds the history a live system accrues over a week.">
        <div className="rfx-stack" style={{ gap: 10 }}>
          <div>
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 5 }}>Seed a note</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(Object.keys(NFA_SCENARIO_LABELS) as NfaScenarioId[]).map((scenario) => (
                <Button
                  key={scenario}
                  size="small"
                  variant="secondary"
                  title={NFA_SCENARIO_HINTS[scenario]}
                  onClick={() => onSeed(scenario)}
                >
                  {NFA_SCENARIO_LABELS[scenario]}
                </Button>
              ))}
              <Button size="small" variant="tertiary" onClick={onClear}>Clear</Button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 5 }}>Load state</div>
            <Segmented
              size="small"
              value={loadState}
              onChange={onLoadState}
              options={[
                { value: 'READY', label: 'Ready' },
                { value: 'LOADING', label: 'Loading' },
                { value: 'ERROR', label: 'Error' },
              ]}
            />
          </div>

          <Toggle
            checked={doaEdited}
            onChange={onDoaEdited}
            label="DoA matrix edited since"
            disabledReason={undefined}
          />
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: -4 }}>
            Turns the live matrix into the revised Q2 one. Open a decided revision in the drawer: it
            still renders the chain it was decided under, and says so. That is the whole defensibility
            claim, on one switch.
          </div>

          <Toggle
            checked={readOnly}
            onChange={() => dispatch({ type: 'TOGGLE_OBSERVER' })}
            label="Read-only observer"
          />

          {nfa && (
            <div style={{ fontSize: 11, color: color.textSecondary }}>
              Current note: {nfa.revisions.length} revision(s), status{' '}
              {NFA_STATUS_PRESENTATION[nfa.status].label.toLowerCase()}.
            </div>
          )}
        </div>
      </Card>

      <Card title="Why the snapshot exists">
        <div style={{ fontSize: 11.5, color: color.textBody, lineHeight: 1.65 }}>
          A decision has to be defensible years later, to an auditor who was not there. So a revision
          freezes both the document and the chain that was in force when it was submitted — never a
          pointer to a matrix that someone will edit next quarter. If the two disagree, the drawer shows
          both and says which one governed.
        </div>
      </Card>
    </div>
  );
}

function Headline({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, color: color.textSecondary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: tone, marginTop: 3 }}>{value}</div>
    </div>
  );
}
