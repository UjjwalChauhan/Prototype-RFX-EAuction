/**
 * Pack 28, Deliverable 9 — correction after final approval.
 *
 * The case that occurs most often and is specified least: an approved,
 * not-yet-executed award with a wrong cost centre or a mistyped date.
 *
 * Two halves under OD-07. An **errata note** against the approved revision for
 * a non-material correction — authored, reasoned, visible in the revision
 * history and the audit pack, no re-approval. Or a **new revision re-entering
 * approval** for anything material, with Deliverable 3's amendment banner
 * naming the consequence.
 *
 * The boundary case is the point of the screen: a buyer attempting an errata on
 * something the material list catches is *told why*, not stopped by a greyed
 * button.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import { Button, Chip, Field, Segmented, TextInput, Textarea } from '../../design-system/components/primitives';
import { Card } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import {
  classifyChange, errataEligibility, type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';
import type { Nfa, NfaDocument, NfaErratum } from '../../domain/types';

type CorrectableField = 'costCentre' | 'requiredByDate' | 'paymentTerms' | 'comparisonSheetVersion';

const FIELD_LABELS: Record<CorrectableField, { label: string; material: boolean; note: string }> = {
  costCentre: { label: 'Cost centre', material: false, note: 'Administrative — an errata note covers it.' },
  requiredByDate: { label: 'Required-by date', material: false, note: 'Administrative — an errata note covers it.' },
  paymentTerms: { label: 'Payment terms', material: false, note: 'Administrative on the current material list.' },
  comparisonSheetVersion: {
    label: 'Attached comparison sheet',
    material: true,
    note: 'On the material list — the attached sheet is the evidence the decision rests on.',
  },
};

export function PostApprovalCorrection({
  nfa, settings, onSettingsChange, onErratum, onNewRevision, canAuthor, authorName, authorId,
}: {
  nfa: Nfa;
  settings: OpenDecisionSettings;
  onSettingsChange: (patch: Partial<OpenDecisionSettings>) => void;
  onErratum: (erratum: NfaErratum) => void;
  /** Hands the corrected document to the amendment flow, banner and all. */
  onNewRevision: (document: NfaDocument) => void;
  canAuthor: boolean;
  authorName: string;
  authorId: string;
}) {
  const approved = [...nfa.revisions].reverse().find((r) => r.outcome === 'APPROVED');
  const [field, setField] = React.useState<CorrectableField>('costCentre');
  const [value, setValue] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!approved) return;
    setValue(String(approved.document[field] ?? ''));
  }, [field, approved?.id]);

  if (!approved) {
    return null;
  }

  const currentValue = String(approved.document[field] ?? '');
  const proposed: NfaDocument = {
    ...approved.document,
    ...(field === 'comparisonSheetVersion'
      ? { comparisonSheetVersion: Number(value) || approved.document.comparisonSheetVersion }
      : { [field]: value || null }),
  } as NfaDocument;

  const assessment = classifyChange(approved.document, proposed, settings);
  const eligibility = errataEligibility(assessment, settings);
  const changed = currentValue !== value;

  return (
    <Card
      title="Correct an approved award"
      hint={`Revision ${approved.number} is approved and not yet executed. This is the commonest correction there is.`}
      action={
        <Segmented
          size="small"
          value={settings.od07PostApproval}
          onChange={(next) => onSettingsChange({ od07PostApproval: next })}
          options={[
            { value: 'ERRATA_ONLY', label: 'OD-07 · errata only' },
            { value: 'MATERIALITY_DECIDES', label: 'materiality decides' },
            { value: 'ALWAYS_NEW_REVISION', label: 'always a revision' },
          ]}
        />
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
          <Field label="What is wrong" hint={FIELD_LABELS[field].note}>
            <select
              value={field}
              onChange={(e) => setField(e.target.value as CorrectableField)}
              style={{
                width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
                padding: '7px 10px', fontSize: 13, background: '#fff',
              }}
            >
              {(Object.keys(FIELD_LABELS) as CorrectableField[]).map((key) => (
                <option key={key} value={key}>
                  {FIELD_LABELS[key].label}{FIELD_LABELS[key].material ? ' — material' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="As approved" hint={`Frozen on revision ${approved.number}.`}>
            <div
              style={{
                padding: '7px 10px', background: color.neutralSoft,
                borderRadius: radius.control, fontSize: 13,
              }}
            >
              {currentValue || '—'}
            </div>
          </Field>
          <Field label="Corrected to">
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} disabled={!canAuthor} />
          </Field>
        </div>

        <Field
          label="Reason — mandatory"
          hint="An errata note with no reason is not an errata note. It appears in the revision history and in the audit pack."
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canAuthor}
            placeholder="Why was it wrong, and what makes the correction right?"
          />
        </Field>

        {!changed ? (
          <ValidationBanner tone="info" title="Nothing corrected yet">
            Change a value above and this panel will say whether it takes an errata note or a new revision.
          </ValidationBanner>
        ) : eligibility.allowed ? (
          <ValidationBanner tone="success" title="Errata note — no re-approval">
            {eligibility.explanation}
          </ValidationBanner>
        ) : (
          <ValidationBanner
            tone="warning"
            title={
              eligibility.requiresNewRevision
                ? 'This needs a new revision, not an errata note'
                : 'This cannot be corrected on this note'
            }
          >
            <div>{eligibility.explanation}</div>
            {eligibility.blockingChanges.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {eligibility.blockingChanges.map((c) => (
                  <li key={c.field}>
                    <strong>{c.label}</strong> — {c.rule}
                  </li>
                ))}
              </ul>
            )}
          </ValidationBanner>
        )}

        {!canAuthor && (
          <div style={{ fontSize: 11.5, color: color.textSecondary }}>
            OD-08: errata authoring is restricted to{' '}
            {settings.od08ErrataAuthor === 'BUYER' ? 'the buyer who raised the note'
              : settings.od08ErrataAuthor === 'BUYER_AND_APPROVER' ? 'the buyer or an approver on the chain'
              : 'a platform administrator'}
            . The control is disabled and says who holds it, rather than vanishing.
          </div>
        )}

        {approved.errata.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Errata already recorded against revision {approved.number}
            </div>
            <div className="rfx-stack" style={{ gap: 7 }}>
              {approved.errata.map((e) => (
                <div
                  key={e.id}
                  style={{
                    border: `1px solid ${color.border}`, borderLeft: `3px solid ${color.info}`,
                    borderRadius: radius.control, padding: '8px 10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 12.5 }}>{e.label}</strong>
                    <Chip tone="info" icon="✎">errata</Chip>
                    <span style={{ fontSize: 11, color: color.textSecondary }}>
                      {e.from} → {e.to}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>
                    {e.reason} — {e.authoredByName}, {new Date(e.authoredAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            disabled={!changed || !eligibility.requiresNewRevision}
            title={
              eligibility.requiresNewRevision
                ? 'Opens the amendment editor, which names the chain consequence before you submit.'
                : 'Only offered when the correction is material.'
            }
            onClick={() => onNewRevision(proposed)}
          >
            Raise a new revision
          </Button>
          <Button
            variant="primary"
            disabled={!changed || !eligibility.allowed || !canAuthor || reason.trim().length < 10}
            title={eligibility.allowed ? undefined : eligibility.explanation}
            onClick={() =>
              onErratum({
                id: `err-${Date.now()}`,
                revisionNumber: approved.number,
                field,
                label: FIELD_LABELS[field].label,
                from: currentValue || '—',
                to: value || '—',
                reason,
                authoredBy: authorId,
                authoredByName: authorName,
                authoredAt: Date.now(),
              })
            }
          >
            Author the errata note
          </Button>
        </div>
      </div>
    </Card>
  );
}
