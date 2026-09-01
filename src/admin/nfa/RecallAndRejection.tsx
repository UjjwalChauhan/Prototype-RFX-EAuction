/**
 * Pack 28, Deliverables 5 and 6 — recall, and rejection's aftermath.
 *
 * Recall (OD-03): Pack 22 built recall before the first approval. This builds
 * the rest — the confirmation, the mandatory reason, the notification to the
 * approver holding a pending step, and both halves of the open decision. Under
 * (a) the control is **present, disabled, and explains itself**; a disabled
 * control with no reason is the defect this pack exists to remove. Under (b) it
 * is permitted, and the modal names exactly whose approvals are being discarded
 * before the buyer can confirm.
 *
 * Rejection (OD-04): the buyer-facing rejection state Pack 23 never showed.
 * Both variants render, and the three invariants hold either way — the reason
 * is mandatory, the revision is frozen and retained, and the buyer is notified.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import { Button, Chip, Segmented, Textarea } from '../../design-system/components/primitives';
import { Card } from '../../design-system/components/layout';
import { Modal, ValidationBanner } from '../../design-system/components/domain';
import {
  recallAvailability, rejectionAftermath, type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';
import type { Nfa } from '../../domain/types';

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

export function RecallControl({
  nfa, settings, onSettingsChange, onRecall, disabledByRole,
}: {
  nfa: Nfa;
  settings: OpenDecisionSettings;
  onSettingsChange: (patch: Partial<OpenDecisionSettings>) => void;
  onRecall: (reason: string) => void;
  disabledByRole: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const availability = recallAvailability(nfa, settings);

  return (
    <Card
      title="Recall this note"
      hint="Withdraws the note from the chain and returns the pen to the buyer."
      action={
        <Segmented
          size="small"
          value={settings.od03RecallAfterApproval}
          onChange={(value) => onSettingsChange({ od03RecallAfterApproval: value })}
          options={[
            { value: 'BLOCKED_AFTER_FIRST_APPROVAL', label: 'OD-03a · blocked' },
            { value: 'PERMITTED_WITH_REASON', label: 'OD-03b · permitted' },
          ]}
        />
      }
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <ValidationBanner
          tone={availability.available ? 'info' : 'warning'}
          title={availability.available ? 'Recall is available' : 'Recall is not available'}
        >
          {availability.explanation}
        </ValidationBanner>

        {availability.pendingHolder && (
          <div style={{ fontSize: 12, color: color.textSecondary }}>
            {availability.pendingHolder.holderName} is holding level {availability.pendingHolder.level}.
            A recall notifies them immediately and removes the note from their inbox — a pending step
            never simply disappears without a message.
          </div>
        )}

        {availability.invalidates.length > 0 && (
          <div
            style={{
              border: `1px solid ${color.warning}`, background: color.warningSoft,
              borderRadius: radius.control, padding: '9px 11px', fontSize: 12,
            }}
          >
            <strong>Approvals already given:</strong>{' '}
            {availability.invalidates.map((a) => `${a.holderName} — level ${a.level}`).join(' · ')}
            <div style={{ marginTop: 4, color: color.warningText }}>
              {settings.od03RecallAfterApproval === 'PERMITTED_WITH_REASON'
                ? 'A recall discards these. They stay in the chain history, struck.'
                : 'These are what closes recall under the current setting.'}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="destructive"
            disabled={!availability.available || disabledByRole}
            title={
              disabledByRole
                ? 'Only the buyer who raised the note may recall it.'
                : availability.explanation
            }
            onClick={() => { setReason(''); setOpen(true); }}
          >
            Recall the note
          </Button>
        </div>
      </div>

      <Modal
        open={open}
        title="Recall this note for approval"
        onClose={() => setOpen(false)}
        onConfirm={() => { onRecall(reason); setOpen(false); }}
        confirmLabel="Recall"
        confirmTone="destructive"
        confirmDisabled={reason.trim().length < 10}
      >
        <div className="rfx-stack" style={{ gap: 12 }}>
          {availability.invalidates.length > 0 && (
            <div style={{ color: color.dangerText }}>
              <strong>This discards {availability.invalidates.length} approval(s):</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {availability.invalidates.map((a) => (
                  <li key={a.level}>{a.holderName} — level {a.level}, {a.role}</li>
                ))}
              </ul>
            </div>
          )}
          {availability.pendingHolder && (
            <div>
              {availability.pendingHolder.holderName} is notified that level{' '}
              {availability.pendingHolder.level} has been withdrawn.
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: color.textSecondary, marginBottom: 4 }}>
              Reason — mandatory, written to the audit log and shown on the revision
            </div>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the note being pulled back?"
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

export function RejectionAftermathPanel({
  nfa, settings, onSettingsChange, onRaiseSuccessor, onCancelEvent,
}: {
  nfa: Nfa;
  settings: OpenDecisionSettings;
  onSettingsChange: (patch: Partial<OpenDecisionSettings>) => void;
  onRaiseSuccessor: () => void;
  onCancelEvent: () => void;
}) {
  const aftermath = rejectionAftermath(settings);
  const rejected = nfa.revisions.find((r) => r.outcome === 'REJECTED');
  const rejectingStep = rejected?.steps.find((s) => s.decision === 'REJECTED');

  return (
    <Card
      title="Rejected — what happens now"
      hint="The buyer-facing rejection state. Pack 23 showed the approver's side of this and never the buyer's."
      action={
        <Segmented
          size="small"
          value={settings.od04Rejection}
          onChange={(value) => onSettingsChange({ od04Rejection: value })}
          options={[
            { value: 'TERMINAL', label: 'OD-04a · terminal' },
            { value: 'RETURN_TO_AWARD', label: 'OD-04b · return to award' },
          ]}
        />
      }
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <ValidationBanner tone="error" title={aftermath.headline}>
          {aftermath.consequence}
        </ValidationBanner>

        {nfa.rejectionReason && (
          <div
            style={{
              border: `1px solid ${color.danger}`, borderLeft: `4px solid ${color.danger}`,
              background: color.dangerSoft, borderRadius: radius.control, padding: '11px 13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>Rejection reason</strong>
              {rejectingStep && (
                <Chip tone="danger" icon="✕">
                  level {rejectingStep.level} · {rejectingStep.holderName}
                </Chip>
              )}
              <Chip tone="neutral">revision {rejected?.number}</Chip>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>
              “{nfa.rejectionReason}”
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            True under either option
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.75, color: color.textBody }}>
            {aftermath.invariants.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {aftermath.successorAllowed ? (
            <>
              <Button variant="secondary" onClick={onCancelEvent}>Close the event instead</Button>
              <Button variant="primary" onClick={onRaiseSuccessor}>
                Raise a successor note
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled title="A re-award requires a new event under OD-04a.">
                Raise a successor note
              </Button>
              <Button variant="primary" onClick={onCancelEvent}>
                Acknowledge — the event is cancelled
              </Button>
            </>
          )}
        </div>

        {!aftermath.successorAllowed && (
          <div style={{ fontSize: 11.5, color: color.textSecondary }}>
            The successor control is present and disabled rather than hidden, so the buyer can see that
            the route exists in the product and that this tenant has closed it — and can ask for the
            setting to change rather than improvising around it.
          </div>
        )}

        {nfa.supersededByNfaId && (
          <ValidationBanner tone="info" title="A successor note has been raised">
            {nfa.supersededByNfaId.toUpperCase()} carries this rejection reason into its context, and the
            new chain sees it. The rejected revision stays frozen and linked.
          </ValidationBanner>
        )}
      </div>
    </Card>
  );
}
