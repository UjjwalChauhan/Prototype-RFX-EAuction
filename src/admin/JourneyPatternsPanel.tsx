/**
 * Pack 25 — Configuration Studio, Journey patterns domain.
 *
 * Two things live here. The **journey master** is the thirteen patterns the
 * module ships with, read-only, which a tenant enables a subset of. The
 * **composer** builds a custom journey out of stage components for the process
 * no master pattern describes.
 *
 * Both obey the studio's scope model: enablement resolves narrowest-wins with
 * locking, and custom journeys *accumulate* down the chain rather than
 * overriding, because a journey authored at tenant scope should still be
 * available to a category rather than be replaced by it.
 *
 * The composer offers inclusion, never re-ordering. `buildStageRail` and
 * `workspaceTabs` both walk the canonical stage order, so a journey claiming
 * AUCTION before RFQ would render in canonical order anyway — the configuration
 * would be a lie. Everything derivable is derived: the wizard, the workspace
 * tabs, the supplier task labels and the duration estimate all recompute as
 * components are picked, so what the studio shows is what the product will do.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import {
  Button, Checkbox, Chip, Field, Segmented, Select, TextInput, Textarea, Toggle,
} from '../design-system/components/primitives';
import { Card, Table, type Column } from '../design-system/components/layout';
import { Drawer, Modal, ValidationBanner } from '../design-system/components/domain';
import { SCOPE_LABELS, SCOPE_ORDER, resolve, resolveAccumulated, type ScopeLineage } from '../domain/config';
import {
  ALL_PATTERNS, JOURNEY_PATTERNS, STAGE_LABELS, patternsForSide, vendorTaskLabel, workspaceTabs,
} from '../domain/journeyPatterns';
import {
  JOURNEY_CUSTOM_KEY, JOURNEY_ENABLED_KEY, STAGE_COMPONENTS, availableVendorPoints,
  componentFor, customSummary, deriveWizardSteps, estimateDuration, isJourneyEnabled,
  masterSummaries, nextJourneyId, normaliseStages, toggleEnabled, validateJourney,
  type CustomJourney, type JourneyDraft, type JourneySummary,
} from '../domain/journeyComposer';
import { serverNow } from '../server/clock';
import { useStore } from '../store/store';
import type {
  ConfigScopeType, Id, JourneyPatternId, Side, Stage, VendorInputPoint,
} from '../domain/types';

const EMPTY_DRAFT: JourneyDraft = {
  name: '',
  description: '',
  side: 'BUY',
  stages: ['INTAKE', 'AWARD'],
  vendorInputPoints: ['INTAKE'],
};

export function JourneyPatternsPanel({
  scope, lineage,
}: { scope: ConfigScopeType; lineage: ScopeLineage }) {
  const { state, dispatch } = useStore();

  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<JourneyDraft>(EMPTY_DRAFT);
  const [basedOn, setBasedOn] = React.useState<JourneyPatternId | ''>('');
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const scopeId = scopeIdFor(scope, lineage);

  // Custom journeys accumulate down the chain; enablement resolves narrowest-wins.
  const custom = resolveAccumulated<CustomJourney>(JOURNEY_CUSTOM_KEY, state.configSettings, lineage);
  const enabled = resolve<string[] | undefined>(
    JOURNEY_ENABLED_KEY, state.configSettings, lineage, undefined,
  );

  const summaries: JourneySummary[] = [
    ...masterSummaries(),
    ...custom.items.map(customSummary),
  ];
  const allIds = summaries.map((s) => s.id);
  const detail = summaries.find((s) => s.id === detailId) ?? null;

  // A lock at a broader scope makes enablement read-only here.
  const enablementEditable =
    !enabled.isLocked ||
    SCOPE_ORDER.indexOf(enabled.lockedBy ?? 'TENANT') >= SCOPE_ORDER.indexOf(scope);

  // Only journeys authored at the scope being viewed can be changed from here.
  const authoredHere = custom.byScope.find((s) => s.scopeType === scope)?.items ?? [];
  const canAuthor = scopeId !== null;

  const enabledCount = allIds.filter((id) => isJourneyEnabled(enabled.value, id)).length;

  const writeEnabled = (next: string[]) => {
    if (scopeId === null) return;
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key: JOURNEY_ENABLED_KEY, scopeType: scope, scopeId, value: next,
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
  };

  const writeCustom = (next: CustomJourney[]) => {
    if (scopeId === null) return;
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key: JOURNEY_CUSTOM_KEY, scopeType: scope, scopeId, value: next,
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
  };

  const openComposer = (seed?: CustomJourney) => {
    if (seed) {
      setEditingId(seed.id);
      setBasedOn(seed.basedOn ?? '');
      setDraft({
        name: seed.name, description: seed.description, side: seed.side,
        stages: seed.stages, vendorInputPoints: seed.vendorInputPoints,
      });
    } else {
      setEditingId(null);
      setBasedOn('');
      setDraft(EMPTY_DRAFT);
    }
    setComposerOpen(true);
  };

  // A name is taken if any *other* journey visible at this scope already uses it.
  const takenNames = summaries.filter((s) => s.id !== editingId).map((s) => s.name);
  const validation = validateJourney(draft, takenNames);

  const save = () => {
    if (!validation.valid || scopeId === null) return;
    const stages = normaliseStages(draft.stages);
    if (editingId) {
      writeCustom(authoredHere.map((j) =>
        j.id === editingId
          ? { ...j, ...draft, stages, basedOn: basedOn === '' ? null : basedOn }
          : j,
      ));
    } else {
      const journey: CustomJourney = {
        id: nextJourneyId(custom.items),
        name: draft.name.trim(),
        description: draft.description.trim(),
        side: draft.side,
        stages,
        vendorInputPoints: draft.vendorInputPoints,
        basedOn: basedOn === '' ? null : basedOn,
        scopeType: scope,
        scopeId,
        createdBy: state.currentUser.id,
        createdAt: serverNow(),
      };
      writeCustom([...authoredHere, journey]);
    }
    setComposerOpen(false);
  };

  const confirmDelete = () => {
    if (deleteId === null) return;
    writeCustom(authoredHere.filter((j) => j.id !== deleteId));
    // Leave no dangling id behind in the enablement list.
    if (enabled.value !== undefined) writeEnabled(enabled.value.filter((id) => id !== deleteId));
    setDeleteId(null);
  };

  const columns: Column<JourneySummary>[] = [
    {
      key: 'name', header: 'Journey', width: '260px',
      render: (row) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
              {row.id}
            </span>
            <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>{row.serves}</div>
        </div>
      ),
    },
    {
      key: 'side', header: 'Side', width: '76px',
      render: (row) => (
        <Chip tone={row.side === 'SELL' ? 'purple' : 'neutral'}>{row.side}</Chip>
      ),
    },
    {
      key: 'stages', header: 'Stages',
      render: (row) => <StageStrip stages={row.stages} />,
    },
    {
      key: 'touchpoints', header: 'Supplier touchpoints', numeric: true, width: '150px',
      render: (row) => row.vendorInputPoints.length,
    },
    {
      key: 'steps', header: 'Wizard steps', numeric: true, width: '110px',
      render: (row) => row.wizardSteps.length,
    },
    {
      key: 'duration', header: 'Typical', width: '90px',
      render: (row) => <span style={{ fontSize: 12 }}>{row.duration}</span>,
    },
    {
      key: 'enabled', header: 'Available', width: '120px',
      render: (row) => (
        <Toggle
          checked={isJourneyEnabled(enabled.value, row.id)}
          disabled={!enablementEditable}
          disabledReason={
            enablementEditable ? undefined : `Locked at ${SCOPE_LABELS[enabled.lockedBy ?? 'TENANT']} scope.`
          }
          onChange={() => writeEnabled(toggleEnabled(enabled.value, allIds, row.id))}
          label={isJourneyEnabled(enabled.value, row.id) ? 'On' : 'Off'}
        />
      ),
    },
    {
      key: 'open', header: '', width: '132px',
      render: (row) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button variant="tertiary" size="small" onClick={() => setDetailId(row.id)}>
            Inspect
          </Button>
          {row.origin === 'CUSTOM' && row.scopeType === scope && (
            <Button
              variant="tertiary"
              size="small"
              onClick={() => openComposer(custom.items.find((j) => j.id === row.id))}
            >
              Edit
            </Button>
          )}
        </div>
      ),
    },
  ];

  const customSummaries = summaries.filter((s) => s.origin === 'CUSTOM');

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner
        tone={enabled.isLocked ? 'warning' : 'info'}
        title={
          enabled.isLocked
            ? `Availability is locked at ${SCOPE_LABELS[enabled.lockedBy ?? 'TENANT']} scope`
            : `${enabledCount} of ${allIds.length} journeys available at ${SCOPE_LABELS[scope]} scope`
        }
      >
        {enabled.isLocked ? (
          <>A broader scope fixed which journeys may be used, so the availability toggles are read-only
          here. Custom journeys can still be composed — they simply will not be selectable until the
          lock is released.</>
        ) : (
          <>Availability resolves narrowest-wins from <strong>{SCOPE_LABELS[enabled.resolvedFrom]}</strong>,
          the same rule as every other setting in the studio. Custom journeys behave differently on
          purpose: they <strong>accumulate</strong> down the chain, so one authored at tenant scope stays
          available to every category rather than being replaced by whatever a category defines.</>
        )}
      </ValidationBanner>

      <Card
        padded={false}
        title="Journey master"
        hint={`The ${ALL_PATTERNS.length} patterns the module ships with. Read-only — a tenant chooses which are available, and composes its own for anything they do not describe.`}
      >
        <Table
          columns={columns}
          rows={summaries.filter((s) => s.origin === 'MASTER')}
          rowKey={(row) => row.id}
          rowStyle={(row) =>
            isJourneyEnabled(enabled.value, row.id) ? undefined : { opacity: 0.5 }
          }
        />
      </Card>

      <Card
        padded={false}
        title="Custom journeys"
        hint={
          canAuthor
            ? `Composed from stage components. Authored here at ${SCOPE_LABELS[scope]} scope, and inherited by every narrower scope.`
            : 'This scope has no id in the current lineage, so nothing can be authored against it.'
        }
        action={
          <Button variant="primary" size="small" disabled={!canAuthor} onClick={() => openComposer()}>
            New custom journey
          </Button>
        }
      >
        {customSummaries.length === 0 ? (
          <div style={{ padding: '30px 20px', textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 22 }}>◇</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              No custom journeys at {SCOPE_LABELS[scope]} scope
            </div>
            <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6, maxWidth: 460, marginInline: 'auto', lineHeight: 1.6 }}>
              Compose one when a client's process is not one of the thirteen — a two-stage RFI into a
              sealed RFP, say, or an RFQ that skips approval for tail spend. Start from a master pattern
              and add or remove components.
            </div>
          </div>
        ) : (
          <Table
            columns={[
              ...columns.slice(0, 6),
              {
                key: 'scope', header: 'Authored at', width: '150px',
                render: (row) => (
                  <Chip tone={row.scopeType === scope ? 'brand' : 'neutral'}>
                    {SCOPE_LABELS[row.scopeType ?? 'TENANT']}
                  </Chip>
                ),
              },
              ...columns.slice(6),
              {
                key: 'delete', header: '', width: '40px',
                render: (row) =>
                  row.scopeType === scope ? (
                    <Button
                      variant="icon"
                      size="small"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => setDeleteId(row.id)}
                    >
                      🗑
                    </Button>
                  ) : null,
              },
            ]}
            rows={customSummaries}
            rowKey={(row) => row.id}
            rowStyle={(row) =>
              isJourneyEnabled(enabled.value, row.id) ? undefined : { opacity: 0.5 }
            }
          />
        )}
      </Card>

      <JourneyDetailDrawer
        summary={detail}
        onClose={() => setDetailId(null)}
      />

      <ComposerDrawer
        open={composerOpen}
        editing={editingId !== null}
        scope={scope}
        draft={draft}
        basedOn={basedOn}
        validation={validation}
        onBasedOn={(id) => {
          setBasedOn(id);
          if (id !== '') {
            const pattern = JOURNEY_PATTERNS[id];
            setDraft((d) => ({
              ...d,
              side: pattern.side === 'SELL' ? 'SELL' : 'BUY',
              stages: [...pattern.stages],
              vendorInputPoints: [...pattern.vendorInputPoints],
            }));
          }
        }}
        onDraft={setDraft}
        onClose={() => setComposerOpen(false)}
        onSave={save}
      />

      <Modal
        open={deleteId !== null}
        title="Delete this custom journey?"
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        confirmLabel="Delete journey"
        confirmTone="destructive"
      >
        Events already created against it keep the stage set they were created with — a journey is
        copied onto the event at creation, not referenced. Removing it only stops new events from
        selecting it.
      </Modal>
    </div>
  );
}

function scopeIdFor(scope: ConfigScopeType, lineage: ScopeLineage): Id | null {
  switch (scope) {
    case 'TENANT': return lineage.tenantId;
    case 'CATEGORY': return lineage.categoryId;
    case 'TEMPLATE': return lineage.templateId;
    case 'EVENT': return lineage.eventId;
  }
}

// ---------------------------------------------------------------------------
// The stage strip — included stages solid, omitted stages struck through
// ---------------------------------------------------------------------------

function StageStrip({ stages, showOmitted = false }: { stages: Stage[]; showOmitted?: boolean }) {
  const included = normaliseStages(stages);
  const shown = showOmitted ? STAGE_COMPONENTS.map((c) => c.stage) : included;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      {shown.map((stage, i) => {
        const on = included.includes(stage);
        return (
          <React.Fragment key={stage}>
            <span
              style={{
                fontSize: 10.5, fontWeight: on ? 600 : 400,
                padding: '3px 7px', borderRadius: radius.pill, whiteSpace: 'nowrap',
                background: on ? color.brandPrimarySoft : color.neutralSoft,
                color: on ? color.brandPrimary : color.textMuted,
                textDecoration: on ? 'none' : 'line-through',
              }}
            >
              {STAGE_LABELS[stage]}
            </span>
            {i < shown.length - 1 && (
              <span aria-hidden style={{ color: color.textMuted, fontSize: 9 }}>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspect — what this journey actually produces when it runs
// ---------------------------------------------------------------------------

function JourneyDetailDrawer({
  summary, onClose,
}: { summary: JourneySummary | null; onClose: () => void }) {
  return (
    <Drawer
      open={summary !== null}
      title={summary?.name ?? ''}
      subtitle={summary ? `${summary.id} · ${summary.origin === 'MASTER' ? 'Master pattern' : 'Custom journey'}` : ''}
      onClose={onClose}
      width={520}
    >
      {summary && (
        <div className="rfx-stack" style={{ gap: 14 }}>
          <div style={{ fontSize: 12.5, color: color.textBody, lineHeight: 1.65 }}>
            {summary.description}
          </div>

          <DetailBlock title="Stages" hint="Omitted stages are shown struck through — the NFA records every stage that did not happen, and why.">
            <StageStrip stages={summary.stages} showOmitted />
          </DetailBlock>

          <DetailBlock
            title="What the supplier is asked to do"
            hint="The portal names a task by what the supplier does, never by the buyer's stage name."
          >
            {summary.vendorInputPoints.length === 0 ? (
              <div style={{ fontSize: 12, color: color.textSecondary }}>
                Nothing. This journey never puts anything in front of a supplier.
              </div>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8, color: color.textBody }}>
                {summary.vendorInputPoints.map((point) => (
                  <li key={point}>
                    {vendorTaskLabel(point)}
                    <span style={{ color: color.textMuted }}> — at {STAGE_LABELS[point as Stage]}</span>
                  </li>
                ))}
              </ol>
            )}
          </DetailBlock>

          <DetailBlock
            title={`Create-event wizard — ${summary.wizardSteps.length} steps`}
            hint="The stepper reshapes to this when the journey is chosen, and nothing already entered is lost."
          >
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {summary.wizardSteps.map((step, i) => (
                <Chip key={step} tone="neutral">{i + 1}. {step}</Chip>
              ))}
            </div>
          </DetailBlock>

          <DetailBlock
            title="Event workspace tabs"
            hint="Derived from the stage set, not hard-coded — a tab whose stage never runs is never rendered."
          >
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {workspaceTabs(summary.stages).map((tab) => (
                <Chip key={tab} tone="info">{tab}</Chip>
              ))}
            </div>
          </DetailBlock>

          <DetailBlock title="Typical duration">
            <span style={{ fontSize: 12.5 }}>
              {summary.duration}
              {summary.origin === 'CUSTOM' && (
                <span style={{ color: color.textMuted }}> — estimated from the stage set, not observed</span>
              )}
            </span>
          </DetailBlock>
        </div>
      )}
    </Drawer>
  );
}

function DetailBlock({
  title, hint, children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: color.textSecondary }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: color.textMuted, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>
      )}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

function ComposerDrawer({
  open, editing, scope, draft, basedOn, validation, onBasedOn, onDraft, onClose, onSave,
}: {
  open: boolean;
  editing: boolean;
  scope: ConfigScopeType;
  draft: JourneyDraft;
  basedOn: JourneyPatternId | '';
  validation: ReturnType<typeof validateJourney>;
  onBasedOn: (id: JourneyPatternId | '') => void;
  onDraft: (next: JourneyDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const stages = normaliseStages(draft.stages);
  const wizardSteps = deriveWizardSteps(stages);
  const tabs = workspaceTabs(stages);
  const vendorPoints = availableVendorPoints(stages);

  const toggleStage = (stage: Stage, on: boolean) => {
    const next = on
      ? normaliseStages([...draft.stages, stage])
      : draft.stages.filter((s) => s !== stage);
    // A touchpoint whose stage just left the journey goes with it, rather than
    // being left behind to fail validation.
    onDraft({
      ...draft,
      stages: next,
      vendorInputPoints: draft.vendorInputPoints.filter((p) => next.includes(p as Stage)),
    });
  };

  const togglePoint = (point: VendorInputPoint, on: boolean) => {
    onDraft({
      ...draft,
      vendorInputPoints: on
        ? availableVendorPoints(stages).filter(
            (p) => p === point || draft.vendorInputPoints.includes(p),
          )
        : draft.vendorInputPoints.filter((p) => p !== point),
    });
  };

  return (
    <Drawer
      open={open}
      title={editing ? 'Edit custom journey' : 'Compose a custom journey'}
      subtitle={`Authored at ${SCOPE_LABELS[scope]} scope`}
      onClose={onClose}
      width={620}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!validation.valid} onClick={onSave}>
            {editing ? 'Save changes' : 'Create journey'}
          </Button>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {validation.errors.map((issue, i) => (
          <ValidationBanner key={`${issue.code}-${i}`} tone="error" title={issue.message}>
            {''}
          </ValidationBanner>
        ))}
        {validation.warnings.map((issue, i) => (
          <ValidationBanner key={`${issue.code}-${i}`} tone="warning" title={issue.message}>
            {''}
          </ValidationBanner>
        ))}

        <Field label="Name" required hint="What a buyer will pick in the create-event wizard.">
          <TextInput
            value={draft.name}
            invalid={validation.errors.some((e) => e.code.startsWith('NAME'))}
            placeholder="e.g. Sealed RFP with negotiation"
            onChange={(e) => onDraft({ ...draft, name: e.target.value })}
          />
        </Field>

        <Field label="Description" hint="One line on when this journey is the right instrument.">
          <Textarea
            rows={2}
            value={draft.description}
            placeholder="e.g. High-value services where price is sealed until the technical panel has scored."
            onChange={(e) => onDraft({ ...draft, description: e.target.value })}
          />
        </Field>

        <Field
          label="Side"
          hint="Set once and immutable on any event created from this journey. Every comparison inverts on it — nothing hard-codes lowest-wins."
        >
          <Segmented
            value={draft.side}
            onChange={(side: Side) => onDraft({ ...draft, side })}
            options={[
              { value: 'BUY' as Side, label: 'Buy — lowest wins' },
              { value: 'SELL' as Side, label: 'Sell — highest wins' },
            ]}
          />
        </Field>

        <Field
          label="Start from a master pattern"
          hint="Optional. Seeds the components below, which you then add to or trim."
        >
          <Select
            value={basedOn}
            onChange={(e) => onBasedOn(e.target.value as JourneyPatternId | '')}
          >
            <option value="">Start from an empty journey</option>
            {patternsForSide(draft.side).map((p) => (
              <option key={p.id} value={p.id}>{p.id} — {p.name}</option>
            ))}
          </Select>
        </Field>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Stage components</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 9, lineHeight: 1.55 }}>
            A journey is a subset of the canonical stage order, never a re-ordering — the stage rail and
            the workspace tabs both walk that order, so a re-ordered journey would render in canonical
            order anyway. Pick what runs; the sequence follows.
          </div>
          <div className="rfx-stack" style={{ gap: 7 }}>
            {STAGE_COMPONENTS.map((component) => {
              const on = stages.includes(component.stage);
              const unmet =
                component.requiresOneOf.length > 0 &&
                !component.requiresOneOf.some((s) => stages.includes(s));
              return (
                <div
                  key={component.stage}
                  style={{
                    border: `1px solid ${on ? color.brandPrimary : color.border}`,
                    background: on ? color.brandPrimarySoft : '#fff',
                    borderRadius: radius.control, padding: '9px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <Checkbox
                        checked={on}
                        disabled={component.mandatory}
                        label={component.label}
                        onChange={(next) => toggleStage(component.stage, next)}
                      />
                      <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4, lineHeight: 1.55 }}>
                        {component.purpose}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end' }}>
                      {component.mandatory && <Chip tone="neutral" title="Every journey carries this">required</Chip>}
                      {component.vendorFacing && <Chip tone="info">supplier-facing</Chip>}
                      {on && unmet && <Chip tone="danger">needs a solicitation</Chip>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Supplier touchpoints</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 9, lineHeight: 1.55 }}>
            Which of the supplier-facing stages actually ask the supplier for something. A stage can run
            without one — an auction the buyer bids into on behalf of suppliers, for instance.
          </div>
          {vendorPoints.length === 0 ? (
            <div style={{ fontSize: 12, color: color.textMuted }}>
              No supplier-facing stage is in the journey yet.
            </div>
          ) : (
            <div className="rfx-stack" style={{ gap: 7 }}>
              {vendorPoints.map((point) => (
                <div
                  key={point}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '8px 12px',
                  }}
                >
                  <Checkbox
                    checked={draft.vendorInputPoints.includes(point)}
                    label={STAGE_LABELS[point as Stage]}
                    onChange={(next) => togglePoint(point, next)}
                  />
                  <span style={{ fontSize: 11.5, color: color.textSecondary }}>
                    “{vendorTaskLabel(point)}”
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Card title="What this produces" hint="Recomputed as you pick components — nothing here is hand-entered.">
          <div className="rfx-stack" style={{ gap: 12 }}>
            <DetailBlock title="Stage sequence">
              <StageStrip stages={stages} showOmitted />
            </DetailBlock>

            <DetailBlock
              title={`Create-event wizard — ${wizardSteps.length} steps`}
              hint="Derived from the stage set. The two speed-optimised master patterns, JP-10 and JP-11, trim steps by hand; the composer derives rather than guessing at that intent."
            >
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {wizardSteps.map((step, i) => (
                  <Chip key={step} tone="neutral">{i + 1}. {step}</Chip>
                ))}
              </div>
            </DetailBlock>

            <DetailBlock title={`Workspace tabs — ${tabs.length}`}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {tabs.map((tab) => <Chip key={tab} tone="info">{tab}</Chip>)}
              </div>
            </DetailBlock>

            <DetailBlock title="Estimated duration">
              <span style={{ fontSize: 12.5 }}>{estimateDuration(stages)}</span>
            </DetailBlock>
          </div>
        </Card>
      </div>
    </Drawer>
  );
}

/** Total journeys visible at a lineage — the rail badge in the studio. */
export function journeyCount(
  settings: Parameters<typeof resolveAccumulated>[1],
  lineage: ScopeLineage,
): number {
  return ALL_PATTERNS.length
    + resolveAccumulated<CustomJourney>(JOURNEY_CUSTOM_KEY, settings, lineage).items.length;
}

export { componentFor };
