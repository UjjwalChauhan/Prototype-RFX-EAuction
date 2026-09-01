/**
 * Pack 28, Deliverable 3 — the amendment banner and the editor under it.
 *
 * This is the single most important element in the pack. A buyer editing a
 * returned note must know, *before* submitting, whether re-submitting costs
 * them the approvals they have already spent a week collecting. So the banner
 * is persistent, states the current change class and its chain consequence, and
 * updates on every keystroke.
 *
 * The banner and the reducer both call `chainConsequence`, so what the buyer is
 * promised and what submission does cannot drift apart.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Field, NumberInput, TextInput, Textarea } from '../../design-system/components/primitives';
import { Card } from '../../design-system/components/layout';
import { Modal } from '../../design-system/components/domain';
import {
  classifyChange, chainConsequence, type ChainConsequence, type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';
import type { ApprovalStep, ChangeClass, NfaDocument } from '../../domain/types';

const CLASS_PRESENTATION: Record<ChangeClass, { label: string; icon: string; fg: string; bg: string; border: string }> = {
  NONE: { label: 'No change yet', icon: '○', fg: color.textSecondary, bg: color.neutralSoft, border: color.borderStrong },
  NON_MATERIAL: { label: 'Non-material', icon: '◔', fg: color.infoText, bg: color.infoSoft, border: color.info },
  MATERIAL: { label: 'Material', icon: '◆', fg: color.dangerText, bg: color.dangerSoft, border: color.danger },
};

/**
 * Persistent, sticky, and loud in proportion to the consequence. It never
 * collapses — a banner a buyer can dismiss is a banner they will discover
 * afterwards.
 */
export function AmendmentBanner({
  consequence, changeCount,
}: {
  consequence: ChainConsequence;
  changeCount: number;
}) {
  const presentation = CLASS_PRESENTATION[consequence.changeClass];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky', top: 0, zIndex: 5,
        border: `1px solid ${presentation.border}`,
        borderLeft: `4px solid ${presentation.border}`,
        background: presentation.bg,
        borderRadius: radius.card,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden style={{ fontSize: 14, color: presentation.fg }}>{presentation.icon}</span>
        <strong style={{ fontSize: 13, color: presentation.fg }}>{presentation.label}</strong>
        {changeCount > 0 && (
          <Chip tone={consequence.changeClass === 'MATERIAL' ? 'danger' : 'neutral'}>
            {changeCount} edit{changeCount === 1 ? '' : 's'}
          </Chip>
        )}
        {consequence.restart
          ? <Chip tone="danger" icon="⟲">chain restarts at level {consequence.resumeAtLevel}</Chip>
          : <Chip tone="brand" icon="→">chain resumes at level {consequence.resumeAtLevel}</Chip>}
      </div>
      <div style={{ fontSize: 12.5, color: color.textBody, marginTop: 6, lineHeight: 1.55 }}>
        {consequence.sentence}
      </div>
      {consequence.supersededApprovals.length > 0 && (
        <div style={{ fontSize: 11.5, color: presentation.fg, marginTop: 6 }}>
          Approvals that would be discarded:{' '}
          {consequence.supersededApprovals
            .map((a) => `${a.holderName} — level ${a.level}, ${a.role}`)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor the banner sits above
// ---------------------------------------------------------------------------

export function AmendmentEditor({
  base, draft, onChange, steps, settings, currency, onSubmit, canSubmit,
}: {
  /** The last submitted revision's document — what the diff is against. */
  base: NfaDocument;
  draft: NfaDocument;
  onChange: (next: NfaDocument) => void;
  steps: ApprovalStep[];
  settings: OpenDecisionSettings;
  currency: string;
  onSubmit: (consequence: ChainConsequence) => void;
  canSubmit: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Recomputed on every keystroke. This is what makes the banner live.
  const assessment = React.useMemo(
    () => classifyChange(base, draft, settings),
    [base, draft, settings],
  );
  const consequence = React.useMemo(
    () => chainConsequence(assessment, steps, settings),
    [assessment, steps, settings],
  );

  const patch = (over: Partial<NfaDocument>) => onChange({ ...draft, ...over });

  const setShare = (lineId: string, sharePct: number) => {
    const allocations = draft.allocations.map((line) =>
      line.lineId === lineId
        ? {
            ...line,
            sharePct,
            // Value moves with the share: an allocation change is a value change.
            value: Math.round((line.value / Math.max(line.sharePct, 1)) * sharePct),
          }
        : line,
    );
    patch({
      allocations,
      totalValue: allocations.reduce((a, x) => a + x.value, 0),
    });
  };

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <AmendmentBanner consequence={consequence} changeCount={assessment.changes.length} />

      <Card
        title="Amend the note"
        hint="Every field here is diffed against the last submitted revision as you type. The banner above is the consequence."
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          <Field
            label="Recommendation — section 8"
            hint="Narrative. Re-wording it is non-material: the chain resumes where it was returned."
          >
            <Textarea
              rows={4}
              value={draft.recommendation}
              onChange={(e) => patch({ recommendation: e.target.value })}
            />
          </Field>

          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: color.textSecondary, marginBottom: 6 }}>
              Allocation — material. Changing a share restarts the chain.
            </div>
            <div className="rfx-stack" style={{ gap: 8 }}>
              {draft.allocations.map((line) => {
                const before = base.allocations.find((b) => b.lineId === line.lineId);
                const moved = before && before.sharePct !== line.sharePct;
                return (
                  <div
                    key={line.lineId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      border: `1px solid ${moved ? color.danger : color.border}`,
                      background: moved ? color.dangerSoft : '#fff',
                      borderRadius: radius.control, padding: '9px 11px',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 140, fontSize: 12.5 }}>
                      <strong>{line.bidderName}</strong>
                      <span style={{ color: color.textSecondary }}> · {line.lotName}</span>
                      <span style={{ display: 'block', fontSize: 10.5, color: color.textSecondary }}>
                        traces to bid {line.bidId || '—'}
                      </span>
                    </span>
                    <span style={{ width: 96 }}>
                      <NumberInput
                        value={line.sharePct}
                        min={0}
                        max={100}
                        onChange={(e) => setShare(line.lineId, Number(e.target.value))}
                        aria-label={`Share for ${line.bidderName}`}
                      />
                    </span>
                    <span style={{ width: 110, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                      {money(line.value, currency)}
                    </span>
                  </div>
                );
              })}
              <div className="rfx-defrow" style={{ fontSize: 12.5 }}>
                <span style={{ color: color.textSecondary }}>Total award value</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {money(draft.totalValue, currency)}
                  {draft.totalValue !== base.totalValue && (
                    <span style={{ color: color.dangerText, marginLeft: 8, fontWeight: 400, fontSize: 11.5 }}>
                      was {money(base.totalValue, currency)}
                    </span>
                  )}
                </strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
            <Field label="Cost centre" hint="Administrative. Non-material.">
              <TextInput
                value={draft.costCentre ?? ''}
                onChange={(e) => patch({ costCentre: e.target.value || null })}
              />
            </Field>
            <Field label="Required by" hint="Administrative. Non-material.">
              <TextInput
                value={draft.requiredByDate ?? ''}
                onChange={(e) => patch({ requiredByDate: e.target.value || null })}
              />
            </Field>
            <Field
              label="Comparison sheet version"
              hint="Material — the attached sheet is the evidence the decision rests on."
            >
              <NumberInput
                value={draft.comparisonSheetVersion}
                min={1}
                onChange={(e) => patch({ comparisonSheetVersion: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => onChange({ ...base })}>
            Discard edits
          </Button>
          <Button
            variant={consequence.restart ? 'destructive' : 'primary'}
            disabled={!canSubmit || assessment.changeClass === 'NONE'}
            onClick={() => setConfirmOpen(true)}
          >
            {consequence.restart ? 'Re-submit — restarts the chain' : 'Re-submit for approval'}
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        title={consequence.restart ? 'Re-submitting restarts the chain' : 'Re-submit this note'}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onSubmit(consequence); }}
        confirmLabel={consequence.restart ? 'Restart the chain' : 'Re-submit'}
        confirmTone={consequence.restart ? 'destructive' : 'primary'}
      >
        <div className="rfx-stack" style={{ gap: 12 }}>
          <div>{consequence.sentence}</div>
          {assessment.materialChanges.length > 0 && (
            <div>
              <strong>Material changes</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {assessment.materialChanges.map((c) => (
                  <li key={c.field}>{c.label}: {c.from} → {c.to}</li>
                ))}
              </ul>
            </div>
          )}
          {assessment.nonMaterialChanges.length > 0 && (
            <div style={{ color: color.textSecondary }}>
              {assessment.nonMaterialChanges.length} non-material edit(s) also submitted.
            </div>
          )}
          {consequence.supersededApprovals.length > 0 && (
            <div style={{ color: color.dangerText }}>
              These approvals will be struck and re-solicited:{' '}
              {consequence.supersededApprovals.map((a) => `${a.holderName} (L${a.level})`).join(', ')}.
              They stay visible in the chain history.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
