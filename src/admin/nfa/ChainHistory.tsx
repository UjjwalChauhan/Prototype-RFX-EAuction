/**
 * Pack 28, Deliverable 4 — the chain history across every revision.
 *
 * Pack 23 owns the live tracker; this is the record. Every level, decision,
 * comment, delegation and escalation, in order, across all revisions of the
 * note.
 *
 * The rule that matters: **superseded approvals are struck, not hidden** — the
 * same treatment a withdrawn line item gets in Pack 05. An approver who
 * approved v1 and is being asked again on v2 must be able to see their own
 * earlier decision and what changed since.
 */
import { color, radius } from '../../design-system/tokens';
import { Chip } from '../../design-system/components/primitives';
import { Card, Empty } from '../../design-system/components/layout';
import {
  REVISION_OUTCOME_PRESENTATION, buildChainHistory, type ChainHistoryEntry,
  type OpenDecisionSettings,
} from '../../domain/nfaLifecycle';
import type { Nfa } from '../../domain/types';

const DECISION_MARK: Record<ChainHistoryEntry['decision'], { mark: string; bg: string; fg: string; label: string }> = {
  APPROVED: { mark: '✓', bg: color.success, fg: '#fff', label: 'approved' },
  REJECTED: { mark: '✕', bg: color.danger, fg: '#fff', label: 'rejected' },
  RETURNED: { mark: '↩', bg: color.warning, fg: '#fff', label: 'returned' },
  DELEGATED: { mark: '⇢', bg: color.accentPurple, fg: '#fff', label: 'delegated' },
  PENDING: { mark: '◷', bg: color.neutralSoft, fg: color.textMuted, label: 'awaiting decision' },
};

export function ChainHistory({ nfa, settings }: { nfa: Nfa; settings: OpenDecisionSettings }) {
  const entries = buildChainHistory(nfa);
  const byRevision = new Map<number, ChainHistoryEntry[]>();
  for (const entry of entries) {
    const list = byRevision.get(entry.revisionNumber) ?? [];
    list.push(entry);
    byRevision.set(entry.revisionNumber, list);
  }

  const supersededCount = entries.filter((e) => e.superseded).length;

  return (
    <Card
      title="Chain history — across every revision"
      hint={
        supersededCount === 0
          ? 'Every level, decision, comment, delegation and escalation, in order.'
          : `${supersededCount} superseded decision(s), shown struck. Nothing is ever deleted from this list.`
      }
    >
      {entries.length === 0 ? (
        <Empty
          icon="◷"
          title="Nothing decided yet"
          hint="The history fills as the chain moves. Until then, the live tracker on the decision card is the whole story."
        />
      ) : (
        <div className="rfx-stack" style={{ gap: 14 }}>
          {[...byRevision.entries()].map(([number, rows]) => {
            const revision = nfa.revisions.find((r) => r.number === number)!;
            const outcome = REVISION_OUTCOME_PRESENTATION[revision.outcome];
            return (
              <div key={number}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
                  <strong style={{ fontSize: 12.5 }}>Revision {number}</strong>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: outcome.bg, color: outcome.fg,
                      borderRadius: radius.pill, padding: '1px 8px', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    <span aria-hidden>{outcome.icon}</span>{outcome.label}
                  </span>
                  <span style={{ fontSize: 11, color: color.textSecondary }}>
                    {revision.changeSummary}
                  </span>
                </div>
                <div className="rfx-stack" style={{ gap: 7 }}>
                  {rows.map((entry, i) => (
                    <HistoryRow
                      key={`${number}-${entry.level}-${i}`}
                      entry={entry}
                      settings={settings}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function HistoryRow({
  entry, settings,
}: { entry: ChainHistoryEntry; settings: OpenDecisionSettings }) {
  const mark = DECISION_MARK[entry.decision];
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        border: `1px solid ${entry.superseded ? color.borderStrong : color.border}`,
        background: entry.superseded ? color.surfacePage : '#fff',
        borderRadius: radius.control, padding: '9px 11px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700,
          background: mark.bg, color: mark.fg,
          filter: entry.superseded ? 'grayscale(1)' : 'none',
        }}
      >
        {mark.mark}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className={entry.superseded ? 'rfx-superseded' : undefined}
          style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
        >
          <strong>Level {entry.level}</strong>
          <span>{entry.role}</span>
          <span style={{ color: color.textSecondary }}>· {entry.holderName}</span>
          <span className="rfx-sr-only">{mark.label}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <Chip
            tone={
              entry.decision === 'APPROVED' ? 'brand'
              : entry.decision === 'REJECTED' ? 'danger'
              : entry.decision === 'RETURNED' ? 'gold'
              : 'neutral'
            }
            icon={mark.mark}
          >
            {mark.label}
          </Chip>
          {entry.kind === 'DELEGATED' && entry.delegatedToName && (
            <Chip tone="purple" icon="⇢" title="A delegation is not a decision — the delegate still has to decide.">
              delegated to {entry.delegatedToName}
            </Chip>
          )}
          {entry.kind === 'ESCALATED' && entry.escalatedFromName && (
            <Chip tone="gold" icon="↑" title="The SLA was breached and the step moved up.">
              escalated from {entry.escalatedFromName}
            </Chip>
          )}
          {entry.kind === 'UPLIFT' && (
            <Chip tone="purple" icon="＋">DoA uplift level</Chip>
          )}
          {entry.carriedForward && !entry.superseded && (
            <Chip tone="brand" icon="→" title="A non-material amendment kept this approval.">
              carried forward
            </Chip>
          )}
          {entry.at && (
            <span style={{ fontSize: 11, color: color.textSecondary }}>
              {new Date(entry.at).toLocaleString()}
            </span>
          )}
        </div>

        {entry.comment && (
          <div
            className={entry.superseded ? 'rfx-superseded' : undefined}
            style={{ fontSize: 11.5, color: color.textBody, marginTop: 5, lineHeight: 1.5 }}
          >
            “{entry.comment}”
          </div>
        )}

        {entry.superseded && (
          <div style={{ fontSize: 11, color: color.warningText, marginTop: 5 }}>
            {entry.supersededReason ?? 'Superseded by a later revision.'}
            {' '}
            {settings.od09SupersededApprover === 'AUTO_RESOLICIT'
              ? 'Re-solicited automatically on the new revision (OD-09).'
              : 'Notified; nothing is asked of them until the chain reaches them again (OD-09).'}
          </div>
        )}
      </div>
    </div>
  );
}
