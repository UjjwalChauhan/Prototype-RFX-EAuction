/**
 * Pack 23 — Approvals and award execution.
 *
 * Designed for a senior user on a phone with thirty seconds: the decision at
 * the top, three headline facts, then the full NFA collapsed. Bulk approve is
 * deliberately not offered for award NFAs.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import { Button, Chip, Textarea } from '../../design-system/components/primitives';
import { Card, Empty, Progress } from '../../design-system/components/layout';
import { Modal, ValidationBanner } from '../../design-system/components/domain';
import { slaStatuses } from '../../domain/doa';
import { buyerView } from '../../server/auctionService';
import { serverNow } from '../../server/clock';
import { biddersForEvent, useStore } from '../../store/store';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import type { ApprovalDecision } from '../../domain/types';

export function ApprovalsTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const nfa = state.nfas.find((n) => n.eventId === eventId);
  const bidders = biddersForEvent(state, eventId);

  const [fullOpen, setFullOpen] = React.useState(false);
  const [decisionModal, setDecisionModal] = React.useState<ApprovalDecision | null>(null);
  const [comment, setComment] = React.useState('');
  const [loaOpen, setLoaOpen] = React.useState(false);

  if (!nfa) {
    return (
      <Card>
        <Empty
          icon="✓"
          title="No approval in flight"
          hint="An NFA raised from the Award tab appears here with its resolved DoA chain."
        />
      </Card>
    );
  }

  const statuses = slaStatuses(nfa.steps, serverNow());
  const currentIndex = nfa.steps.findIndex((_, i) => statuses[i].state === 'CURRENT');
  const currentStep = currentIndex >= 0 ? nfa.steps[currentIndex] : undefined;
  const approvedCount = nfa.steps.filter((s) => s.decision === 'APPROVED').length;
  const allApproved = approvedCount === nfa.steps.length;

  const ranked = state.auction.auction.eventId === eventId
    ? buyerView(state.auction, 'al-1', COUNTERPARTY_NAMES).filter((r) => r.bidCount > 0)
    : [];
  const winner = ranked[0];
  const awardValue = winner?.transformedValue ?? event.estimatedValue;
  const baseline = event.estimatedValue;
  const saving = baseline - awardValue;

  const iAmCurrentApprover =
    currentStep !== undefined && state.currentUser.permissions.includes('approve_at_level');

  const decide = (decision: ApprovalDecision) => {
    if (currentIndex < 0) return;
    const steps = nfa.steps.map((step, i) =>
      i === currentIndex
        ? { ...step, decision, comment: comment || null, decidedAt: Date.now() }
        : step,
    );
    dispatch({ type: 'UPDATE_NFA', nfaId: nfa.id, patch: { steps } });

    const isLast = currentIndex === nfa.steps.length - 1;
    if (decision === 'APPROVED' && isLast) {
      const provisional = bidders.some((b) => b.isProvisional && b.id === winner?.bidderId);
      dispatch({
        type: 'UPDATE_EVENT',
        eventId,
        patch: {
          status: provisional ? 'AWARD_PENDING_ONBOARDING' : 'AWARDED',
          awardedAt: Date.now(),
        },
      });
    } else if (decision === 'REJECTED' || decision === 'RETURNED') {
      dispatch({ type: 'UPDATE_EVENT', eventId, patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' } });
    }
    setDecisionModal(null);
    setComment('');
  };

  return (
    /* Single column, narrow: this must be usable at 375px because approvers
       approve from phones. */
    <div className="rfx-stack" style={{ gap: 14, maxWidth: 720 }}>
      {/* The decision, at the top. */}
      <div
        style={{
          background: color.surface, border: `1px solid ${color.border}`,
          borderRadius: radius.card, padding: '16px 18px',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: color.textSecondary }}>
          Award approval · level {currentStep?.level ?? nfa.steps.length} of {nfa.steps.length}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, lineHeight: 1.3 }}>
          Award {money(awardValue, event.currency)} to {winner?.displayName ?? '—'}
        </div>
        <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
          {event.eventNumber} · {event.title}
        </div>

        {/* Three headline facts. */}
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
            value={nfa.deviations.length === 0 ? 'None' : `${nfa.deviations.length} flagged`}
            tone={nfa.deviations.length === 0 ? color.successText : color.warningText}
          />
        </div>

        {nfa.doaUpliftApplied && (
          <div style={{ marginTop: 12 }}>
            <ValidationBanner tone="warning" title="Rank override — DoA uplift applied">
              {nfa.overrideReason}
            </ValidationBanner>
          </div>
        )}

        {allApproved ? (
          <div className="rfx-stack" style={{ marginTop: 14, gap: 10 }}>
            <ValidationBanner tone="success" title="Fully approved">
              Every level has approved. Award execution is now available — a letter of award, regret
              notifications and the PO or contract handoff.
            </ValidationBanner>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => setLoaOpen(true)}>Issue letter of award</Button>
              <Button variant="secondary">Send regret notifications</Button>
              {/* Generate PO appears only after award approval. */}
              <Button variant="secondary">Generate PO</Button>
            </div>
          </div>
        ) : iAmCurrentApprover ? (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => setDecisionModal('APPROVED')}>Approve</Button>
            <Button variant="secondary" onClick={() => setDecisionModal('RETURNED')}>Return with comments</Button>
            <Button variant="destructive" onClick={() => setDecisionModal('REJECTED')}>Reject</Button>
            <Button variant="tertiary" onClick={() => setDecisionModal('DELEGATED')}>Delegate</Button>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <ValidationBanner tone="info" title={`Awaiting ${currentStep?.holderName ?? 'the next approver'}`}>
              You are not the current approver. Switch to the Approver persona from the user menu to act
              on this step. Bulk approve is deliberately not offered for award NFAs.
            </ValidationBanner>
          </div>
        )}
      </div>

      {/* Chain tracker. */}
      <Card title="Approval chain" hint={`${approvedCount} of ${nfa.steps.length} complete`}>
        <Progress value={approvedCount} max={nfa.steps.length} />
        <div className="rfx-stack" style={{ gap: 8, marginTop: 12 }}>
          {nfa.steps.map((step, i) => {
            const status = statuses[i];
            return (
              <div
                key={step.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
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

      {/* The full NFA, collapsed by default. */}
      <Card
        title="Full note for approval"
        hint="Collapsed by default — the decision above is what the approver needs first."
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
              <div style={{ marginTop: 4 }}>{nfa.recommendation}</div>
            </div>
            <div>
              <strong>Risk statement</strong>
              <div style={{ marginTop: 4 }}>{nfa.riskStatement}</div>
            </div>
            <div>
              <strong>Deviations</strong>
              {nfa.deviations.length === 0 ? (
                <div style={{ marginTop: 4, color: color.successText }}>None.</div>
              ) : (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {nfa.deviations.map((deviation) => <li key={deviation}>{deviation}</li>)}
                </ul>
              )}
            </div>
            <div>
              <strong>Attached comparison sheet</strong>
              <div style={{ marginTop: 4 }}>
                Version {nfa.comparisonSheetVersion} — immutable at this version, and reproducible.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: color.textSecondary }}>
            {nfa.deviations.length} deviation(s) · comparison sheet v{nfa.comparisonSheetVersion} attached ·
            recommendation written by {nfa.recommendedBy}
          </div>
        )}
      </Card>

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
            <strong>{winner?.displayName}</strong> at level {currentStep?.level}.
          </div>
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
              knowing why.
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
          The letter of award goes to <strong>{winner?.displayName}</strong> through the vendor portal
          and by email, with acknowledgement tracking.
        </p>
        <p style={{ margin: 0, color: color.textSecondary }}>
          Regret notifications to the other {ranked.length - 1} bidders disclose{' '}
          <strong>rank only</strong> by default
          (<code>config.award.regret_disclosure = RANK_ONLY</code>).
        </p>
      </Modal>
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
