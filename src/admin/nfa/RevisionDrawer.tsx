/**
 * Pack 28, Deliverables 1 and 2 — the revision drawer and the diff.
 *
 * Deliberately the same component shape as the terms version history in
 * `13_rfp_terms.png`: a list on the left, the selected thing on the right, and
 * a compare mode that puts two versions side by side. A buyer who has used the
 * terms history should not have to learn this one.
 *
 * The right-hand pane renders a revision **from its own snapshot**, never from
 * the live DoA matrix. When the matrix has moved since, the drift notice
 * explains the difference rather than resolving it away.
 */
import React from 'react';
import { color, money, radius } from '../../design-system/tokens';
import { Button, Chip, Segmented, Select } from '../../design-system/components/primitives';
import { Drawer, ValidationBanner } from '../../design-system/components/domain';
import {
  REVISION_OUTCOME_PRESENTATION, chainDrift, chainSignature, diffRevisions,
  type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';
import type { SimulationResult } from '../../domain/doa';
import type { FieldChange } from '../../domain/nfaLifecycle';
import type { Nfa, NfaRevision } from '../../domain/types';

export function RevisionControl({ nfa, onOpen }: { nfa: Nfa; onOpen: () => void }) {
  const total = nfa.revisions.length;
  const current = nfa.revisions[total - 1]?.number ?? 0;
  const returned = nfa.revisions.filter((r) => r.outcome === 'RETURNED').length;
  return (
    <Button
      size="small"
      variant="secondary"
      onClick={onOpen}
      title="Every submitted revision, with the chain snapshot that was in force at the time"
    >
      Revision {current} of {total}
      {returned > 0 && ` · ${returned} returned`}
    </Button>
  );
}

export function RevisionDrawer({
  open, nfa, onClose, liveDoa, settings, currency,
}: {
  open: boolean;
  nfa: Nfa;
  onClose: () => void;
  /** The matrix as it stands today, used only to detect drift. */
  liveDoa: SimulationResult;
  settings: OpenDecisionSettings;
  currency: string;
}) {
  const revisions = nfa.revisions;
  const latest = revisions[revisions.length - 1];
  const [mode, setMode] = React.useState<'READ' | 'DIFF'>('READ');
  const [selected, setSelected] = React.useState<number>(latest?.number ?? 1);
  const [diffFrom, setDiffFrom] = React.useState<number>(Math.max(1, (latest?.number ?? 1) - 1));
  const [diffTo, setDiffTo] = React.useState<number>(latest?.number ?? 1);

  React.useEffect(() => {
    if (!open) return;
    const last = revisions[revisions.length - 1];
    setSelected(last?.number ?? 1);
    setDiffTo(last?.number ?? 1);
    setDiffFrom(Math.max(1, (last?.number ?? 1) - 1));
  }, [open, revisions.length]);

  const revision = revisions.find((r) => r.number === selected);

  return (
    <Drawer
      open={open}
      title="Revision history"
      subtitle={`${revisions.length} revision(s) of ${nfa.id.toUpperCase()} — every one reproducible exactly as its approver saw it`}
      onClose={onClose}
      width={880}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'READ', label: 'Read a revision' },
            { value: 'DIFF', label: 'Compare two', disabled: revisions.length < 2 },
          ]}
        />

        {mode === 'READ' ? (
          <div className="rfx-revision-split">
            <RevisionList
              revisions={revisions}
              selected={selected}
              onSelect={setSelected}
              nfa={nfa}
            />
            {revision ? (
              <RevisionReadPane
                revision={revision}
                nfa={nfa}
                liveDoa={liveDoa}
                currency={currency}
              />
            ) : (
              <div style={{ fontSize: 12.5, color: color.textSecondary }}>Select a revision.</div>
            )}
          </div>
        ) : (
          <DiffPane
            nfa={nfa}
            from={diffFrom}
            to={diffTo}
            onFrom={setDiffFrom}
            onTo={setDiffTo}
            settings={settings}
          />
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Left — the revision list
// ---------------------------------------------------------------------------

function RevisionList({
  revisions, selected, onSelect, nfa,
}: {
  revisions: NfaRevision[]; selected: number; onSelect: (n: number) => void; nfa: Nfa;
}) {
  return (
    <div className="rfx-stack" style={{ gap: 8 }}>
      {revisions.map((revision) => {
        const outcome = REVISION_OUTCOME_PRESENTATION[revision.outcome];
        const active = revision.number === selected;
        // A rejected revision names its successor, when the tenant allows one.
        const successor = revision.outcome === 'REJECTED' && nfa.supersededByNfaId
          ? nfa.supersededByNfaId
          : null;
        return (
          <button
            key={revision.id}
            type="button"
            onClick={() => onSelect(revision.number)}
            style={{
              textAlign: 'left', cursor: 'pointer', width: '100%',
              border: `1px solid ${active ? color.brandPrimary : color.border}`,
              background: active ? '#F5F8FF' : '#fff',
              borderRadius: radius.control, padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>Revision {revision.number}</strong>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: outcome.bg, color: outcome.fg,
                  borderRadius: radius.pill, padding: '1px 8px', fontSize: 11, fontWeight: 600,
                }}
              >
                <span aria-hidden>{outcome.icon}</span>
                {outcome.label}
              </span>
              {revision.changeClass === 'MATERIAL' && <Chip tone="danger" icon="◆">material</Chip>}
              {revision.changeClass === 'NON_MATERIAL' && <Chip tone="neutral">non-material</Chip>}
              {revision.errata.length > 0 && (
                <Chip tone="info" icon="✎">{revision.errata.length} errata</Chip>
              )}
            </div>
            <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4 }}>
              {revision.submittedByName} · {new Date(revision.submittedAt).toLocaleString()}
            </div>
            {revision.outcomeDetail && (
              <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                {revision.outcomeDetail}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: color.textBody, marginTop: 5 }}>
              {revision.changeSummary}
            </div>
            {successor && (
              <div style={{ fontSize: 11, color: color.brandPrimary, marginTop: 4 }}>
                → superseded by {successor.toUpperCase()}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right — one revision, as its approver saw it
// ---------------------------------------------------------------------------

function RevisionReadPane({
  revision, nfa, liveDoa, currency,
}: {
  revision: NfaRevision; nfa: Nfa; liveDoa: SimulationResult; currency: string;
}) {
  const drift = chainDrift(revision.chainSnapshot, liveDoa);
  const doc = revision.document;

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <div
        style={{
          border: `1px solid ${color.border}`, borderRadius: radius.control,
          padding: '10px 12px', background: color.surfacePage,
          fontSize: 11.5, color: color.textSecondary,
        }}
      >
        Read-only. This is revision {revision.number} exactly as its approver saw it —
        the document and the chain that was in force at{' '}
        {new Date(revision.chainSnapshot.capturedAt).toLocaleString()}.
      </div>

      <Section title="Allocation">
        <div className="rfx-stack" style={{ gap: 6 }}>
          {doc.allocations.map((line) => (
            <div key={line.lineId} className="rfx-defrow">
              <span>
                {line.bidderName} · {line.lotName}
                <span style={{ color: color.textSecondary, fontSize: 11, marginLeft: 6 }}>
                  traces to {line.bidId}
                </span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {line.sharePct}% · {line.quantity.toLocaleString()} · {money(line.value, currency)}
              </span>
            </div>
          ))}
          <div className="rfx-defrow">
            <strong>Total award value</strong>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(doc.totalValue, currency)}</strong>
          </div>
        </div>
      </Section>

      <Section title="Recommendation (section 8)">{doc.recommendation}</Section>
      <Section title="Risk statement (section 11)">{doc.riskStatement}</Section>

      <Section title="Deviations (section 10)">
        {doc.deviations.length === 0 ? (
          <span style={{ color: color.successText }}>None.</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {doc.deviations.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Administrative">
        <div className="rfx-stack" style={{ gap: 4 }}>
          <Row label="Cost centre" value={doc.costCentre ?? '—'} />
          <Row label="Required by" value={doc.requiredByDate ?? '—'} />
          <Row label="Payment terms" value={doc.paymentTerms} />
          <Row label="Comparison sheet" value={`v${doc.comparisonSheetVersion} — immutable at this version`} />
        </div>
      </Section>

      <Section title={`Chain snapshot — ${revision.chainSnapshot.ruleName}`}>
        <div className="rfx-stack" style={{ gap: 6 }}>
          {revision.steps.map((step) => (
            <div
              key={step.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                border: `1px solid ${color.border}`, borderRadius: radius.control,
                padding: '7px 10px',
                opacity: step.superseded ? 0.75 : 1,
              }}
            >
              <span
                style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10.5, fontWeight: 700,
                  background:
                    step.decision === 'APPROVED' ? color.success
                    : step.decision === 'REJECTED' ? color.danger
                    : step.decision === 'RETURNED' ? color.warning
                    : color.neutralSoft,
                  color: step.decision === 'PENDING' ? color.textMuted : '#fff',
                }}
              >
                {step.decision === 'APPROVED' ? '✓'
                  : step.decision === 'REJECTED' ? '✕'
                  : step.decision === 'RETURNED' ? '↩'
                  : `L${step.level}`}
              </span>
              <span
                style={{
                  flex: 1, minWidth: 0, fontSize: 12,
                  textDecoration: step.superseded ? 'line-through' : 'none',
                }}
              >
                <strong>L{step.level}</strong> {step.role} · {step.holderName}
                {step.comment && (
                  <span style={{ color: color.textSecondary }}> — “{step.comment}”</span>
                )}
              </span>
              <Chip tone="neutral">{step.slaHours}h SLA</Chip>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 8 }}>
          Signature at submission: {chainSignature(revision.chainSnapshot.levels)}
        </div>
      </Section>

      {drift.drifted && (
        <ValidationBanner tone="info" title="The DoA matrix has changed since this revision was decided">
          <div>{drift.note}</div>
          <div style={{ marginTop: 6, fontSize: 11.5 }}>
            <div><strong>As decided:</strong> {drift.snapshotSignature}</div>
            <div style={{ marginTop: 2 }}><strong>Live matrix today:</strong> {drift.liveSignature}</div>
          </div>
        </ValidationBanner>
      )}

      {revision.supersededApprovals.length > 0 && (
        <ValidationBanner tone="warning" title="Approvals this revision invalidated">
          {revision.supersededApprovals
            .map((a) => `${a.holderName} at level ${a.level} (${a.role})`)
            .join(', ')}
          . They are struck in the chain history, never removed.
        </ValidationBanner>
      )}

      {revision.errata.length > 0 && (
        <Section title="Errata against this revision">
          <div className="rfx-stack" style={{ gap: 8 }}>
            {revision.errata.map((e) => (
              <div key={e.id} style={{ borderLeft: `2px solid ${color.info}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 12.5 }}>
                  <strong>{e.label}</strong>: {e.from} → {e.to}
                </div>
                <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                  {e.reason} — {e.authoredByName}, {new Date(e.authoredAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {nfa.status === 'REJECTED' && revision.outcome === 'REJECTED' && nfa.rejectionReason && (
        <ValidationBanner tone="error" title="Rejection reason — carried into any successor note">
          {nfa.rejectionReason}
        </ValidationBanner>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The diff — material and non-material are never rendered alike
// ---------------------------------------------------------------------------

function DiffPane({
  nfa, from, to, onFrom, onTo, settings,
}: {
  nfa: Nfa; from: number; to: number;
  onFrom: (n: number) => void; onTo: (n: number) => void;
  settings: OpenDecisionSettings;
}) {
  const diff = diffRevisions(nfa.revisions, from, to, settings);
  const numbers = nfa.revisions.map((r) => r.number);

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: color.textSecondary }}>Compare</span>
        <Select value={String(from)} onChange={(e) => onFrom(Number(e.target.value))} style={{ width: 130 }}>
          {numbers.map((n) => <option key={n} value={n}>Revision {n}</option>)}
        </Select>
        <span aria-hidden style={{ color: color.textMuted }}>→</span>
        <Select value={String(to)} onChange={(e) => onTo(Number(e.target.value))} style={{ width: 130 }}>
          {numbers.map((n) => <option key={n} value={n}>Revision {n}</option>)}
        </Select>
        {diff && diff.spansRevisions.length > 2 && (
          <Chip tone="info" icon="⤳">
            spans {diff.spansRevisions.length} revisions
          </Chip>
        )}
      </div>

      {!diff ? (
        <ValidationBanner tone="error" title="Those revisions do not exist">
          Pick two revisions from the list.
        </ValidationBanner>
      ) : diff.assessment.changes.length === 0 ? (
        <ValidationBanner tone="info" title="No difference">
          Revisions {from} and {to} are identical section by section.
        </ValidationBanner>
      ) : (
        <>
          <ValidationBanner
            tone={diff.assessment.changeClass === 'MATERIAL' ? 'warning' : 'info'}
            title={
              diff.assessment.changeClass === 'MATERIAL'
                ? `${diff.assessment.materialChanges.length} material change(s), ${diff.assessment.nonMaterialChanges.length} non-material`
                : `${diff.assessment.nonMaterialChanges.length} non-material change(s), nothing material`
            }
          >
            {diff.assessment.summary} Material changes carry a red rule and a reason; non-material ones
            are shown plain. The two are never rendered alike.
          </ValidationBanner>

          {diff.sections.map((section) => (
            <div key={section.section}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
                Section {section.section} · {section.sectionTitle}
              </div>
              <div className="rfx-stack" style={{ gap: 8 }}>
                {section.changes.map((change) => (
                  <ChangeRow key={change.field} change={change} from={from} to={to} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ChangeRow({
  change, from, to,
}: { change: FieldChange; from: number; to: number }) {
  return (
    <div
      style={{
        border: `1px solid ${change.material ? color.danger : color.border}`,
        borderLeft: `3px solid ${change.material ? color.danger : color.borderStrong}`,
        borderRadius: radius.control,
        background: change.material ? color.dangerSoft : '#fff',
        padding: '9px 11px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5 }}>{change.label}</strong>
        {change.material
          ? <Chip tone="danger" icon="◆">material</Chip>
          : <Chip tone="neutral" icon="○">non-material</Chip>}
      </div>
      <div className="rfx-diff-grid" style={{ marginTop: 7 }}>
        <div>
          <div style={{ fontSize: 10.5, color: color.textSecondary, marginBottom: 2 }}>Revision {from}</div>
          <div style={{ fontSize: 12, background: '#fff', border: `1px solid ${color.border}`, borderRadius: 5, padding: '6px 8px' }}>
            {change.from}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: color.textSecondary, marginBottom: 2 }}>Revision {to}</div>
          <div
            style={{
              fontSize: 12, background: '#fff', borderRadius: 5, padding: '6px 8px',
              border: `1px solid ${change.material ? color.danger : color.border}`,
              fontWeight: change.material ? 600 : 400,
            }}
          >
            {change.to}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: change.material ? color.dangerText : color.textSecondary, marginTop: 6 }}>
        {change.rule}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: `2px solid ${color.border}`, paddingLeft: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: color.textBody, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rfx-defrow">
      <span style={{ color: color.textSecondary }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
