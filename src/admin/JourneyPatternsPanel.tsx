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
 * The composer separates **stages** from **activities**. Evaluation, the Q&A
 * window and negotiation are not stages: they are work done inside one, so
 * they are switched on at the stage that hosts them rather than standing in
 * the sequence. What is left is genuinely sequential, and the buyer arranges
 * it — pick the stages, then drag them into the order the client's process
 * actually runs. Only intake and the award decision are pinned.
 *
 * Everything derivable is derived: the wizard, the workspace tabs, the
 * supplier task labels and the duration estimate all recompute as components
 * are picked, so what the studio shows is what the product will do.
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
  COMPOSABLE_STAGES, JOURNEY_CUSTOM_KEY, JOURNEY_ENABLED_KEY, STAGE_ACTIVITIES,
  STAGE_COMPONENTS, activitiesFromStages, activitiesOf, availableVendorPoints,
  componentFor, customSummary, deriveWizardSteps, estimateDuration, isMovable,
  isJourneyEnabled, masterSummaries, moveStage, nextJourneyId, orderStages,
  toggleEnabled, validateJourney,
  type ActivityKey, type CustomJourney, type JourneyActivities, type JourneyDraft,
  type JourneySummary,
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
  evaluateAt: [],
  negotiateAt: [],
  clarifications: false,
};

/** The draft's activities, never undefined once it is in the composer. */
function activitiesOfDraft(draft: JourneyDraft): JourneyActivities {
  return {
    evaluateAt: draft.evaluateAt ?? [],
    negotiateAt: draft.negotiateAt ?? [],
    clarifications: draft.clarifications ?? false,
  };
}

/** Flags in the shape the workspace-tab derivation reads. */
function tabFlags(activities: JourneyActivities) {
  return {
    evaluation: activities.evaluateAt.length > 0,
    negotiation: activities.negotiateAt.length > 0,
  };
}

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
      // A journey composed before activities existed carries them as stages.
      // It is read in the new vocabulary on the way in, so editing one does
      // not silently keep two models alive in the same list.
      const activities = activitiesOf(seed.stages, {
        evaluateAt: seed.evaluateAt,
        negotiateAt: seed.negotiateAt,
        clarifications: seed.clarifications,
      });
      setDraft({
        name: seed.name, description: seed.description, side: seed.side,
        stages: orderStages(seed.stages), vendorInputPoints: seed.vendorInputPoints,
        ...activities,
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
    const stages = orderStages(draft.stages);
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
        ...activitiesOfDraft(draft),
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
      // A master is shown exactly as it ships — it declares its evaluation and
      // negotiation as stages, and that is what its rail will render. Only a
      // composed journey is drawn in the activity model, because only a
      // composed journey is actually built that way.
      render: (row) =>
        row.origin === 'CUSTOM' ? (
          <div className="rfx-stack" style={{ gap: 4 }}>
            <StageStrip stages={row.stages} activities={row.activities} />
            <ActivityLine activities={row.activities} />
          </div>
        ) : (
          <StageStrip stages={row.stages} />
        ),
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
              // The master declares its evaluation, clarifications and
              // negotiation as stages; they arrive here as activities.
              stages: orderStages(pattern.stages),
              vendorInputPoints: [...pattern.vendorInputPoints],
              ...activitiesFromStages(pattern.stages),
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

function StageStrip({
  stages, activities, showOmitted = false,
}: { stages: Stage[]; activities?: JourneyActivities; showOmitted?: boolean }) {
  // Order is the journey's own now, so the strip renders what it is given
  // rather than sorting it. Omitted stages follow the sequence instead of
  // sitting inside it: a stage that does not run has no position.
  const included = stages.filter((s, i) => stages.indexOf(s) === i);
  const omitted = showOmitted ? COMPOSABLE_STAGES.filter((s) => !included.includes(s)) : [];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      {included.map((stage, i) => (
        <React.Fragment key={stage}>
          <StagePip stage={stage} activities={activities} />
          {i < included.length - 1 && (
            <span aria-hidden style={{ color: color.textMuted, fontSize: 9 }}>›</span>
          )}
        </React.Fragment>
      ))}
      {omitted.length > 0 && (
        <span style={{ color: color.textMuted, fontSize: 9, marginInline: 3 }} title="Not in this journey">
          ·
        </span>
      )}
      {omitted.map((stage) => (
        <span
          key={stage}
          style={{
            fontSize: 10.5, padding: '3px 7px', borderRadius: radius.pill, whiteSpace: 'nowrap',
            background: color.neutralSoft, color: color.textMuted, textDecoration: 'line-through',
          }}
        >
          {STAGE_LABELS[stage]}
        </span>
      ))}
    </div>
  );
}

/** One stage, marked with the activities that run inside it. */
function StagePip({ stage, activities }: { stage: Stage; activities?: JourneyActivities }) {
  const inside: string[] = [];
  if (activities?.evaluateAt.includes(stage)) inside.push('scored');
  if (activities?.negotiateAt.includes(stage)) inside.push('negotiated');
  return (
    <span
      title={inside.length > 0 ? `${STAGE_LABELS[stage]} — ${inside.join(' and ')} inside this stage` : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10.5, fontWeight: 600, padding: '3px 7px', borderRadius: radius.pill,
        whiteSpace: 'nowrap', background: color.brandPrimarySoft, color: color.brandPrimary,
      }}
    >
      {STAGE_LABELS[stage]}
      {inside.map((mark) => (
        <span
          key={mark}
          style={{
            fontSize: 8.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em',
            background: '#fff', borderRadius: radius.pill, padding: '1px 5px', color: color.textSecondary,
          }}
        >
          {mark}
        </span>
      ))}
    </span>
  );
}

function activityLabel(key: ActivityKey): string {
  return STAGE_ACTIVITIES.find((a) => a.key === key)!.label;
}

function activityPurpose(key: ActivityKey): string {
  return STAGE_ACTIVITIES.find((a) => a.key === key)!.purpose;
}

/** The activities running inside one stage, as marks beside its name. */
function ActivityMarks({ stage, activities }: { stage: Stage; activities: JourneyActivities }) {
  const marks: string[] = [];
  if (activities.evaluateAt.includes(stage)) marks.push('scored');
  if (activities.negotiateAt.includes(stage)) marks.push('negotiated');
  if (marks.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {marks.map((mark) => (
        <Chip key={mark} tone="info" title={`Runs inside ${STAGE_LABELS[stage]}`}>{mark}</Chip>
      ))}
    </span>
  );
}

/** One line naming what runs inside the stages, rather than beside them. */
function ActivityLine({ activities }: { activities: JourneyActivities }) {
  const parts: string[] = [];
  if (activities.evaluateAt.length > 0) {
    parts.push(`Scored at ${activities.evaluateAt.map((s) => STAGE_LABELS[s]).join(', ')}`);
  }
  if (activities.negotiateAt.length > 0) {
    parts.push(`Negotiated inside ${activities.negotiateAt.map((s) => STAGE_LABELS[s]).join(', ')}`);
  }
  if (activities.clarifications) parts.push('Clarifications open throughout');
  if (parts.length === 0) {
    return (
      <span style={{ fontSize: 11, color: color.textMuted }}>
        Nothing runs inside a stage — no scoring, no negotiation, no Q&A window.
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.5 }}>
      {parts.join(' · ')}
    </span>
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

          <DetailBlock title="Stages" hint="In the order this journey runs them. Omitted stages are shown struck through after the sequence — the NFA records every stage that did not happen, and why.">
            <StageStrip
              stages={summary.stages}
              activities={summary.origin === 'CUSTOM' ? summary.activities : undefined}
              showOmitted
            />
          </DetailBlock>

          <DetailBlock
            title="Inside the stages"
            hint={
              summary.origin === 'CUSTOM'
                ? 'Scoring, negotiation and the Q&A window are work done within a stage rather than stages of their own.'
                : 'This master pattern declares them as stages of their own. Read in the vocabulary the composer uses, this is the same process.'
            }
          >
            <ActivityLine activities={summary.activities} />
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
              {workspaceTabs(summary.stages, {
                evaluation: summary.activities.evaluateAt.length > 0,
                negotiation: summary.activities.negotiateAt.length > 0,
              }).map((tab) => (
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

export function ComposerDrawer({
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
  const activities = activitiesOfDraft(draft);
  const stages = orderStages(draft.stages);
  const wizardSteps = deriveWizardSteps(stages, draft.vendorInputPoints, activities);
  const tabs = workspaceTabs(stages, tabFlags(activities));
  const vendorPoints = availableVendorPoints(stages, activities);

  /** The row being dragged, so a drop knows what it is receiving. */
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);

  const patchDraft = (next: Partial<JourneyDraft>) => onDraft({ ...draft, ...next });

  const prune = (next: Stage[], acts: JourneyActivities): Partial<JourneyDraft> => ({
    stages: next,
    // An activity whose host just left the journey goes with it, and so does a
    // touchpoint whose stage did. Leaving either behind to fail validation
    // makes the buyer fix something they did not do.
    evaluateAt: acts.evaluateAt.filter((s) => next.includes(s)),
    negotiateAt: acts.negotiateAt.filter((s) => next.includes(s)),
    vendorInputPoints: draft.vendorInputPoints.filter(
      (point) => next.includes(point as Stage) || (point === 'NEGOTIATION' && acts.negotiateAt.some((s) => next.includes(s))),
    ),
  });

  const toggleStage = (stage: Stage, on: boolean) => {
    // A newly picked stage lands at the end of the middle section, where the
    // buyer is most likely to want it, and is then dragged into place.
    const next = on
      ? orderStages([...draft.stages, stage])
      : orderStages(draft.stages.filter((s) => s !== stage));
    patchDraft(prune(next, activities));
  };

  const toggleActivity = (key: ActivityKey, stage: Stage | null, on: boolean) => {
    if (key === 'CLARIFICATION') {
      patchDraft({ clarifications: on });
      return;
    }
    if (stage === null) return;
    const field = key === 'EVALUATION' ? 'evaluateAt' : 'negotiateAt';
    const current = activities[field];
    const next = on
      ? stages.filter((s) => s === stage || current.includes(s))
      : current.filter((s) => s !== stage);
    patchDraft({
      [field]: next,
      // Negotiation is a supplier touchpoint in its own right; dropping the
      // last one takes the touchpoint with it.
      ...(key === 'NEGOTIATION' && next.length === 0
        ? { vendorInputPoints: draft.vendorInputPoints.filter((pt) => pt !== 'NEGOTIATION') }
        : {}),
    });
  };

  const reorder = (from: number, to: number) =>
    patchDraft({ stages: moveStage(stages, from, to) });

  const togglePoint = (point: VendorInputPoint, on: boolean) => {
    onDraft({
      ...draft,
      vendorInputPoints: on
        ? vendorPoints.filter((p) => p === point || draft.vendorInputPoints.includes(p))
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
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>1 · Pick the stages</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 9, lineHeight: 1.55 }}>
            Each one is independent of the others — pick what runs, then order them in step 2.
            Scoring, negotiation and the Q&amp;A window are not stages: they are work done{' '}
            <em>inside</em> one, and are switched on here against the stage that hosts them.
          </div>
          <div className="rfx-stack" style={{ gap: 7 }}>
            {STAGE_COMPONENTS.map((component) => {
              const on = stages.includes(component.stage);
              const hosted = STAGE_ACTIVITIES.filter((a) => a.hosts.includes(component.stage));
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
                      {component.anchor === 'OPENS' && <Chip tone="neutral" title="Demand arrives here, so it opens the journey">opens</Chip>}
                      {component.anchor === 'CLOSES' && <Chip tone="neutral" title="Sequenced last — an award cannot precede the work it decides">closes</Chip>}
                      {component.vendorFacing && <Chip tone="info">supplier-facing</Chip>}
                    </div>
                  </div>

                  {/* The activities this stage can host. Shown only once the
                      stage is in, because an activity with no host is not a
                      choice the buyer can meaningfully make. */}
                  {on && hosted.length > 0 && (
                    <div
                      style={{
                        marginTop: 9, paddingTop: 8, borderTop: `1px dashed ${color.border}`,
                        display: 'grid', gap: 7,
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: color.textMuted }}>
                        Runs inside {component.label}
                      </div>
                      {hosted.map((activity) => {
                        const field = activity.key === 'EVALUATION' ? 'evaluateAt' : 'negotiateAt';
                        return (
                          <div key={activity.key}>
                            <Checkbox
                              checked={activities[field].includes(component.stage)}
                              label={activity.label}
                              onChange={(next) => toggleActivity(activity.key, component.stage, next)}
                            />
                            <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 3, marginLeft: 22, lineHeight: 1.5 }}>
                              {activity.purpose}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Clarifications belong to no single stage, so they are not offered
              against one. The buyer opens the window for the journey. */}
          <div
            style={{
              marginTop: 9, border: `1px solid ${activities.clarifications ? color.brandPrimary : color.border}`,
              background: activities.clarifications ? color.brandPrimarySoft : '#fff',
              borderRadius: radius.control, padding: '9px 12px',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: color.textMuted, marginBottom: 6 }}>
              Runs across the whole journey
            </div>
            <Checkbox
              checked={activities.clarifications}
              label={activityLabel('CLARIFICATION')}
              onChange={(next) => toggleActivity('CLARIFICATION', null, next)}
            />
            <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4, marginLeft: 22, lineHeight: 1.55 }}>
              {activityPurpose('CLARIFICATION')} Substantive answers are broadcast to every bidder —
              that fairness rule is not configurable.
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>2 · Put them in order</div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 9, lineHeight: 1.55 }}>
            Drag to re-sequence, or use the arrows. Intake opens the journey because that is where
            demand arrives, and the award decision closes it — everything between is yours to arrange,
            including running the auction before a solicitation.
          </div>
          <div className="rfx-stack" style={{ gap: 5 }}>
            {stages.map((stage, index) => {
              const movable = isMovable(stage);
              const canUp = movable && index > 0 && isMovable(stages[index - 1]);
              const canDown = movable && index < stages.length - 1 && isMovable(stages[index + 1]);
              const dragging = dragFrom === index;
              return (
                <div
                  key={stage}
                  draggable={movable}
                  onDragStart={(e) => {
                    setDragFrom(index);
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox will not start a drag without payload.
                    e.dataTransfer.setData('text/plain', stage);
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  onDragOver={(e) => {
                    if (dragFrom !== null && dragFrom !== index) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) reorder(dragFrom, index);
                    setDragFrom(null);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    border: `1px solid ${dragging ? color.brandPrimary : color.border}`,
                    background: dragging ? color.brandPrimarySoft : '#fff',
                    borderRadius: radius.control, padding: '7px 10px',
                    opacity: dragging ? 0.6 : 1,
                    cursor: movable ? 'grab' : 'default',
                  }}
                >
                  <span
                    aria-hidden
                    title={movable ? 'Drag to re-sequence' : 'Fixed position'}
                    style={{ fontSize: 12, color: movable ? color.textMuted : color.borderStrong, width: 10 }}
                  >
                    {movable ? '⠿' : '•'}
                  </span>
                  <span style={{ fontSize: 11, color: color.textMuted, fontVariantNumeric: 'tabular-nums', width: 14 }}>
                    {index + 1}
                  </span>
                  <strong style={{ fontSize: 12.5 }}>{STAGE_LABELS[stage]}</strong>
                  <ActivityMarks stage={stage} activities={activities} />
                  <span style={{ flex: 1 }} />
                  {!movable && (
                    <Chip tone="neutral" title="Intake opens and the award closes — those two are structural">
                      fixed
                    </Chip>
                  )}
                  <Button
                    variant="icon" size="small" disabled={!canUp}
                    aria-label={`Move ${STAGE_LABELS[stage]} earlier`}
                    onClick={() => reorder(index, index - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="icon" size="small" disabled={!canDown}
                    aria-label={`Move ${STAGE_LABELS[stage]} later`}
                    onClick={() => reorder(index, index + 1)}
                  >
                    ↓
                  </Button>
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
            <DetailBlock title="Stage sequence" hint="The order you arranged, which is the order the rail and the workspace will walk.">
              <StageStrip stages={stages} activities={activities} showOmitted />
            </DetailBlock>

            <DetailBlock title="Inside the stages">
              <ActivityLine activities={activities} />
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
              <span style={{ fontSize: 12.5 }}>{estimateDuration(stages, activities)}</span>
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
