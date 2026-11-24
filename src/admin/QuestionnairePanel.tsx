/**
 * Pack 25 — Configuration Studio, Questionnaire domain.
 *
 * Two things live here, and the second is the point.
 *
 * The **template library** is what a buyer picks from: reusable question sets,
 * each declaring the points in the journey where it may be put in front of a
 * supplier. A template is not owned by a stage — the same capability set is
 * routinely asked at RFI and re-confirmed at RFP.
 *
 * The **stage weighting** is what makes a multi-stage journey coherent. An
 * event that asks the supplier for information three times has to say what each
 * asking is worth, or the last one silently decides the technical ranking. The
 * weighting resolves narrowest-wins like any other setting; the templates
 * accumulate down the chain like custom journeys, because a category adding its
 * own should not hide the tenant library.
 *
 * Weights are entered as relative numbers, never percentages, and every screen
 * shows the normalised share beside the raw figure — the arithmetic is the
 * product's job, not the buyer's.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import {
  Button, Checkbox, Chip, Field, NumberInput, Segmented, Select, TextInput, Textarea, Toggle,
} from '../design-system/components/primitives';
import { Card, Table, type Column } from '../design-system/components/layout';
import { Drawer, Modal, ValidationBanner } from '../design-system/components/domain';
import {
  SCOPE_LABELS, SCOPE_ORDER, resolve, resolveAccumulated, type ScopeLineage,
} from '../domain/config';
import { JOURNEY_PATTERNS } from '../domain/journeyPatterns';
import {
  QUESTION_TYPES_BY_GROUP, QUESTION_TYPE_SPEC, appendOption, carryConfig, formatSummary,
  optionsFromPreset, presetsFor, typeLabel, type QuestionFacet,
} from '../domain/questionTypes';
import {
  POINT_PURPOSE, PRICED_QUESTION_TYPES, QUESTION_SCOPES, SCORE_SCALE_PRESETS, TEMPLATE_CUSTOM_KEY,
  TEMPLATE_STATUS_LABELS, TEMPLATE_WEIGHTING_KEY, VENDOR_INPUT_POINTS, deletionBlock,
  emptyTemplate, eventsUsing, inheritedCodes, newQuestion, nextTemplateId, normalise, pointLabel,
  errorsByQuestion, moveQuestion, moveSection, questionsInSection, removeQuestion, removeSection,
  scoredQuestions, sectionBudgets, suggestCode, templateUseIndex, weightAfterRemoving,
  templateWeight, templatesFor, validateTemplate, validateWeighting, weightCeilingFor,
  weightingForJourney, canAskPerLine, isScoredTemplate, scopeCounts, sectionWeightTotal,
  setSectionScope,
  type SectionBudget, type TemplateUse,
} from '../domain/questionnaireTemplates';
import { categoriesBySuper } from '../data/procurementCategories';
import { QuestionnaireAgentPanel } from './QuestionnaireAgentPanel';
import { QuestionnaireImportDrawer } from './QuestionnaireImport';
import { QuestionnairePreview } from './QuestionnairePreview';
import { serverNow } from '../server/clock';
import { useStore } from '../store/store';
import { TREATMENT_LABEL, TREATMENT_NOTE, treatmentOf } from '../domain/commercialEvaluation';
import type {
  ConfigScopeType, Id, JourneyPatternId, QuestionConfig, QuestionEvalType, QuestionOption, QuestionType,
  QuestionScope, QuestionnaireTemplate, ScoringMethod, StageWeight, TemplateQuestion,
  TemplateSection, TemplateStatus, VendorInputPoint,
} from '../domain/types';

const SCORING_LABELS: Record<ScoringMethod, string> = {
  NONE: 'Not scored',
  MANUAL: 'Manual — evaluator scores against the rubric',
  RULE: 'Rule — auto-computed, read only',
  AI_ASSISTED: 'AI assisted — agent proposes, human decides',
  AI_AUTO: 'AI auto — agent writes, degrades below confidence',
};

/**
 * Who a question is put to.
 *
 * Two radio-like options rather than a checkbox, because "per vendor" is a
 * real choice and not the absence of one — a buyer who never sees the second
 * option goes on attaching spreadsheets to question 14. The control disables
 * itself, with the reason showing, for the types that cannot be repeated per
 * line: a price schedule already spans the basket, and a section heading asks
 * for nothing to repeat.
 */
export function AskedPerControl({
  question, sections = [], onChange,
}: {
  question: Pick<TemplateQuestion, 'type' | 'askedPer'> & { sectionId?: Id | null };
  /** When the question sits in one of these, the section decides the grain. */
  sections?: TemplateSection[];
  onChange: (patch: { askedPer: QuestionScope }) => void;
}) {
  const possible = canAskPerLine(question.type);
  const section = sections.find((s) => s.id === question.sectionId);
  const scope: QuestionScope = !possible
    ? 'VENDOR'
    : section ? section.askedPer : question.askedPer;
  // Inside a section the grain belongs to the section, so this reads rather
  // than writes. Changing it on one question would split a block the supplier
  // meets as one thing.
  const locked = !possible || section !== undefined;
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Asked</div>
      {/* Shown rather than hidden when it cannot be changed here, so a buyer
          can see the boundary and read why, instead of wondering where the
          option went on this one question. */}
      <div style={locked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <Segmented
          size="small"
          value={scope}
          onChange={(askedPer) => !locked && onChange({ askedPer })}
          options={QUESTION_SCOPES.map((option) => ({ value: option.id, label: option.label }))}
        />
      </div>
      <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
        {!possible
          ? PRICED_QUESTION_TYPES.includes(question.type)
            ? 'A priced question already spans every line in the basket, so it is asked once.'
            : 'This type displays something rather than asking for it, so it is not repeated per line.'
          : section
            ? `Set on the section — every question in "${section.name}" is asked the same way.`
            : QUESTION_SCOPES.find((option) => option.id === scope)?.purpose}
      </div>
    </div>
  );
}

export function QuestionnairePanel({
  scope, lineage,
}: { scope: ConfigScopeType; lineage: ScopeLineage }) {
  const { state, dispatch } = useStore();

  const [pane, setPane] = React.useState<'weighting' | 'library'>('weighting');
  const [editing, setEditing] = React.useState<QuestionnaireTemplate | null>(null);
  const [inspecting, setInspecting] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  /** Whether the builder about to open should land on the upload. */
  const [startImporting, setStartImporting] = React.useState(false);
  const [journey, setJourney] = React.useState<JourneyPatternId>('JP-05');

  const scopeId = scopeIdFor(scope, lineage);

  // Templates accumulate; the weighting resolves narrowest-wins with locking.
  const library = resolveAccumulated<QuestionnaireTemplate>(
    TEMPLATE_CUSTOM_KEY, state.configSettings, lineage,
  );
  const weighting = resolve<StageWeight[]>(
    TEMPLATE_WEIGHTING_KEY, state.configSettings, lineage,
    VENDOR_INPUT_POINTS.map((point) => ({ point, weight: 0 })),
  );

  const templates = library.items;
  const authoredHere = library.byScope.find((s) => s.scopeType === scope)?.items ?? [];

  // What has actually been asked from each template. The event keeps a copy of
  // the questions, so this is the only link back — and it is what decides
  // whether a template can leave the library at all.
  const uses = React.useMemo(
    () => templateUseIndex(templates, state.questionnaires, state.events),
    [templates, state.questionnaires, state.events],
  );
  const usesOf = (templateId: Id): TemplateUse[] => uses.get(templateId) ?? [];

  const weightingEditable =
    !weighting.isLocked ||
    SCOPE_ORDER.indexOf(weighting.lockedBy ?? 'TENANT') >= SCOPE_ORDER.indexOf(scope);

  const writeTemplates = (next: QuestionnaireTemplate[]) => {
    if (scopeId === null) return;
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key: TEMPLATE_CUSTOM_KEY, scopeType: scope, scopeId, value: next,
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
  };

  const writeWeighting = (next: StageWeight[]) => {
    if (scopeId === null) return;
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key: TEMPLATE_WEIGHTING_KEY, scopeType: scope, scopeId, value: next,
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
  };

  const saveTemplate = (template: QuestionnaireTemplate) => {
    const exists = authoredHere.some((t) => t.id === template.id);
    writeTemplates(
      exists
        ? authoredHere.map((t) => (t.id === template.id ? template : t))
        : [...authoredHere, template],
    );
    setEditing(null);
  };

  const startNew = (importing = false) => {
    if (scopeId === null) return;
    setEditing(emptyTemplate({
      id: nextTemplateId(templates), scopeType: scope, scopeId,
      userId: state.currentUser.id, now: serverNow(),
    }));
    setStartImporting(importing);
  };

  const duplicate = (source: QuestionnaireTemplate) => {
    if (scopeId === null) return;
    const id = nextTemplateId(templates);
    setEditing({
      ...source,
      id,
      name: `${source.name} (copy)`,
      code: `${source.code}-COPY`,
      status: 'DRAFT',
      version: 1,
      scopeType: scope,
      scopeId,
      createdBy: state.currentUser.id,
      createdAt: serverNow(),
      sections: source.sections.map((s) => ({ ...s, id: `${id}-${s.id}` })),
      questions: source.questions.map((q) => ({
        ...q, id: `${id}-${q.id}`, templateId: id,
        sectionId: q.sectionId === null ? null : `${id}-${q.sectionId}`,
      })),
    });
  };

  const inspected = templates.find((t) => t.id === inspecting) ?? null;

  // The guard is structural: when a template is in use the modal is given no
  // confirm handler at all, so there is no path from this screen to a delete —
  // not a disabled button that a re-render could re-enable.
  const deleting = templates.find((t) => t.id === deleteId) ?? null;
  const deleteBlockedBy = deleting === null ? null : deletionBlock(usesOf(deleting.id));

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          { value: 'weighting' as const, label: 'Journey weighting' },
          { value: 'library' as const, label: `Template library (${templates.length})` },
        ]}
      />

      {pane === 'weighting' ? (
        <JourneyWeighting
          scope={scope}
          journey={journey}
          onJourney={setJourney}
          weights={weighting.value}
          resolvedFrom={weighting.resolvedFrom}
          isLocked={weighting.isLocked}
          lockedBy={weighting.lockedBy}
          editable={weightingEditable}
          templates={templates}
          onChange={writeWeighting}
        />
      ) : (
        <TemplateLibrary
          scope={scope}
          scopeId={scopeId}
          templates={templates}
          uses={uses}
          canAuthor={scopeId !== null}
          onNew={() => startNew(false)}
          onUpload={() => startNew(true)}
          onEdit={(t) => { setStartImporting(false); setEditing(t); }}
          onDuplicate={duplicate}
          onInspect={setInspecting}
          onDelete={setDeleteId}
        />
      )}

      <TemplateInspector
        template={inspected}
        uses={inspected === null ? [] : usesOf(inspected.id)}
        onClose={() => setInspecting(null)}
      />

      {editing && (
        <TemplateBuilder
          template={editing}
          takenNames={templates.filter((t) => t.id !== editing.id).map((t) => t.name)}
          library={templates}
          startImporting={startImporting}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={saveTemplate}
        />
      )}

      <Modal
        open={deleteId !== null}
        title={deleteBlockedBy === null ? 'Delete this template?' : 'This template has been used'}
        onClose={() => setDeleteId(null)}
        onConfirm={
          deleteBlockedBy === null
            ? () => {
                writeTemplates(authoredHere.filter((t) => t.id !== deleteId));
                setDeleteId(null);
              }
            : undefined
        }
        confirmLabel="Delete template"
        confirmTone="destructive"
      >
        {deleteBlockedBy === null ? (
          <>
            Nothing has been asked from <strong>{deleting?.name}</strong> yet — no event was built
            from it, so removing it loses nothing. It goes from this library only; templates
            inherited from a broader scope are unaffected.
          </>
        ) : (
          <div className="rfx-stack" style={{ gap: 10 }}>
            <div>{deleteBlockedBy}</div>
            <UsedByList uses={usesOf(deleting?.id ?? '')} />
            <div style={{ fontSize: 11.5, color: color.textSecondary }}>
              Each event keeps its own copy of the questions, so deleting would not break them. It
              would lose the authored original — the one place the intent behind an asking survives
              in one piece, and what an evaluation challenged months later is answered from.
            </div>
          </div>
        )}
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
// Journey weighting — what each asking is worth
// ---------------------------------------------------------------------------

function JourneyWeighting({
  scope, journey, onJourney, weights, resolvedFrom, isLocked, lockedBy, editable,
  templates, onChange,
}: {
  scope: ConfigScopeType;
  journey: JourneyPatternId;
  onJourney: (id: JourneyPatternId) => void;
  weights: StageWeight[];
  resolvedFrom: ConfigScopeType;
  isLocked: boolean;
  lockedBy: ConfigScopeType | null;
  editable: boolean;
  templates: QuestionnaireTemplate[];
  onChange: (next: StageWeight[]) => void;
}) {
  const pattern = JOURNEY_PATTERNS[journey];
  const inForce = weightingForJourney(weights, pattern.vendorInputPoints);
  const validation = validateWeighting(weights, templates, pattern.vendorInputPoints);
  const shared = inheritedCodes(templates).filter((c) => c.reAsked);

  const setWeight = (point: VendorInputPoint, weight: number) => {
    const next = VENDOR_INPUT_POINTS.map((p) => ({
      point: p,
      weight: p === point ? Math.max(0, weight) : (weights.find((w) => w.point === p)?.weight ?? 0),
    }));
    onChange(next);
  };

  const total = weights.reduce((sum, w) => sum + Math.max(0, w.weight), 0);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner
        tone={isLocked ? 'warning' : 'info'}
        title={
          isLocked
            ? `Weighting is locked at ${SCOPE_LABELS[lockedBy ?? 'TENANT']} scope`
            : 'What each asking is worth'
        }
      >
        A journey that asks the supplier for information more than once has to say what each asking
        contributes to the technical score, or the last one silently decides the ranking. Weights are
        relative — enter 20, 60, 20 or 1, 3, 1 — and the effective share is shown beside each.
        Resolved from <strong>{SCOPE_LABELS[resolvedFrom]}</strong>.
      </ValidationBanner>

      <Card
        title="Preview against a journey"
        hint="Only the points a journey actually runs are weighted; the rest are renormalised away."
      >
        <div className="rfx-stack" style={{ gap: 10 }}>
          <Field label="Journey pattern">
            <Select value={journey} onChange={(e) => onJourney(e.target.value as JourneyPatternId)}>
              {Object.values(JOURNEY_PATTERNS).map((p) => (
                <option key={p.id} value={p.id}>{p.id} — {p.name}</option>
              ))}
            </Select>
          </Field>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: color.textSecondary }}>Asks the supplier at:</span>
            {pattern.vendorInputPoints.length === 0
              ? <Chip tone="neutral">nothing is asked</Chip>
              : pattern.vendorInputPoints.map((p) => <Chip key={p} tone="brand">{pointLabel(p)}</Chip>)}
          </div>
        </div>
      </Card>

      {validation.errors.map((issue) => (
        <ValidationBanner key={issue.code} tone="error" title={issue.message}>{''}</ValidationBanner>
      ))}
      {validation.warnings.map((issue) => (
        <ValidationBanner key={issue.code} tone="warning" title={issue.message}>{''}</ValidationBanner>
      ))}

      <Card
        title="Weight per point"
        hint={`Raw total ${total}. Shares are normalised, so they need not sum to 100.`}
      >
        <div className="rfx-stack" style={{ gap: 8 }}>
          {VENDOR_INPUT_POINTS.map((point) => {
            const raw = weights.find((w) => w.point === point)?.weight ?? 0;
            const applies = pattern.vendorInputPoints.includes(point);
            const entry = inForce.find((w) => w.item.point === point);
            const available = templatesFor(templates, point);

            return (
              <div
                key={point}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  border: `1px solid ${color.border}`,
                  background: applies ? '#fff' : color.surfacePage,
                  opacity: applies ? 1 : 0.62,
                  borderRadius: radius.control, padding: '10px 12px',
                }}
              >
                <div style={{ minWidth: 168 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{pointLabel(point)}</div>
                  <div style={{ fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
                    {available.length} template{available.length === 1 ? '' : 's'}
                    {!applies && ' · not in this journey'}
                  </div>
                </div>

                <div style={{ width: 92 }}>
                  <NumberInput
                    value={raw}
                    disabled={!editable}
                    onChange={(e) => setWeight(point, Number(e.target.value))}
                  />
                </div>

                {/* The share is the number that actually matters. */}
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div
                    style={{
                      height: 8, borderRadius: radius.pill, background: color.neutralSoft,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${entry?.effectivePct ?? 0}%`, height: '100%',
                        background: applies ? color.brandPrimary : color.textMuted,
                      }}
                    />
                  </div>
                </div>

                <div style={{ width: 76, textAlign: 'right' }}>
                  <strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {applies ? `${(entry?.effectivePct ?? 0).toFixed(1)}%` : '—'}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 11, lineHeight: 1.6 }}>
          {POINT_PURPOSE.RFI}
          {!editable && (
            <span style={{ display: 'block', marginTop: 5, color: color.warningText }}>
              Locked at {SCOPE_LABELS[lockedBy ?? 'TENANT']} scope — read-only at {SCOPE_LABELS[scope]}.
            </span>
          )}
        </div>
      </Card>

      {shared.length > 0 && (
        <Card
          title="Asked at more than one point"
          hint="A stable question code is what lets an answer be carried forward rather than asked twice."
        >
          <div className="rfx-stack" style={{ gap: 7 }}>
            {shared.map((entry) => (
              <div
                key={entry.code}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  border: `1px solid ${color.border}`, borderRadius: radius.control,
                  padding: '8px 11px',
                }}
              >
                <code style={{ fontSize: 11, color: color.accentPurpleText }}>{entry.code}</code>
                <span style={{ fontSize: 12, flex: 1, minWidth: 150 }}>{entry.title}</span>
                {entry.points.map((p) => <Chip key={p} tone="info">{pointLabel(p)}</Chip>)}
                <Chip tone="gold" title="Two different templates ask this">
                  {entry.templateIds.length} templates
                </Chip>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 10, lineHeight: 1.6 }}>
            A supplier who declared ISO 9001 at RFI should see it carried into RFP, not be asked for
            it again. Only codes asked by two <em>different</em> templates are listed — one template
            reused at two points is a single asking that happens to be available twice.
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/** Exported for the library tests, which paint the pane without a click. */
export function TemplateLibrary({
  scope, scopeId, templates, uses, canAuthor, onNew, onUpload, onEdit, onDuplicate, onInspect,
  onDelete,
}: {
  scope: ConfigScopeType;
  /**
   * The scope being viewed, not just its kind. Two categories are both
   * CATEGORY scope and are not the same library — comparing only the kind
   * would offer an edit here that writes somewhere else.
   */
  scopeId: Id | null;
  templates: QuestionnaireTemplate[];
  uses: Map<Id, TemplateUse[]>;
  canAuthor: boolean;
  onNew: () => void;
  /** New template, opened straight into the spreadsheet upload. */
  onUpload: () => void;
  onEdit: (t: QuestionnaireTemplate) => void;
  onDuplicate: (t: QuestionnaireTemplate) => void;
  onInspect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  /**
   * Why this row's delete is unavailable, or null when it is offered.
   *
   * Rendered disabled rather than hidden. The button used to be omitted unless
   * the template was authored at the scope being viewed, which meant that on
   * the studio's opening scope there was no delete anywhere and no hint that
   * one existed — the buyer's conclusion was that the product has no delete,
   * which is the correct conclusion from what was on screen.
   */
  const authoredHere = (t: QuestionnaireTemplate): boolean =>
    t.scopeType === scope && (scopeId === null || t.scopeId === scopeId);

  const deleteBlock = (t: QuestionnaireTemplate): string | null => {
    if (!authoredHere(t)) {
      const where = t.scopeType === 'CATEGORY' || t.scopeType === 'TEMPLATE'
        ? `${SCOPE_LABELS[t.scopeType]} scope, under ${t.scopeId}`
        : `${SCOPE_LABELS[t.scopeType]} scope`;
      return `${t.name} is authored at ${where}. Open that scope to delete it — deleting it here would only hide it from one branch of the chain.`;
    }
    return deletionBlock(uses.get(t.id) ?? []);
  };

  const columns: Column<QuestionnaireTemplate>[] = [
    {
      key: 'name', header: 'Template', width: '280px',
      render: (t) => {
        const validation = validateTemplate(t);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>{t.name}</strong>
              {!validation.valid && (
                <Chip tone="danger" icon="✕" title={validation.errors.map((e) => e.message).join(' ')}>
                  {validation.errors.length} error{validation.errors.length === 1 ? '' : 's'}
                </Chip>
              )}
            </div>
            <code style={{ fontSize: 10.5, color: color.textMuted }}>{t.code} · v{t.version}</code>
          </div>
        );
      },
    },
    {
      key: 'applies', header: 'Applied at',
      render: (t) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {t.appliesTo.map((p) => <Chip key={p} tone="brand">{pointLabel(p)}</Chip>)}
        </div>
      ),
    },
    {
      key: 'categories', header: 'Categories', width: '150px',
      render: (t) =>
        t.categories.length === 0
          ? <span style={{ fontSize: 11.5, color: color.textMuted }}>any</span>
          : <span style={{ fontSize: 11.5 }}>{t.categories.join(', ')}</span>,
    },
    {
      key: 'questions', header: 'Questions', numeric: true, width: '92px',
      render: (t) => t.questions.length,
    },
    {
      key: 'scored', header: 'Scored', numeric: true, width: '80px',
      render: (t) => scoredQuestions(t).length,
    },
    {
      key: 'weight', header: 'Weight', numeric: true, width: '80px',
      render: (t) => templateWeight(t),
    },
    {
      key: 'status', header: 'Status', width: '100px',
      render: (t) => (
        <Chip tone={t.status === 'PUBLISHED' ? 'brand' : t.status === 'DRAFT' ? 'gold' : 'neutral'}>
          {TEMPLATE_STATUS_LABELS[t.status]}
        </Chip>
      ),
    },
    {
      key: 'scope', header: 'Authored at', width: '140px',
      render: (t) => (
        <Chip tone={authoredHere(t) ? 'brand' : 'neutral'} title={t.scopeId}>
          {SCOPE_LABELS[t.scopeType]}
        </Chip>
      ),
    },
    {
      key: 'used', header: 'Used by', width: '130px',
      render: (t) => {
        const events = eventsUsing(uses.get(t.id) ?? []);
        if (events.length === 0) {
          return <span style={{ fontSize: 11.5, color: color.textMuted }}>not yet used</span>;
        }
        return (
          <Chip tone="neutral" title={events.join(', ')}>
            {events.length} event{events.length === 1 ? '' : 's'}
          </Chip>
        );
      },
    },
    {
      key: 'actions', header: '', width: '190px',
      render: (t) => (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
          <Button variant="tertiary" size="small" onClick={() => onInspect(t.id)}>Inspect</Button>
          <Button
            variant="tertiary"
            size="small"
            disabled={!authoredHere(t)}
            onClick={() => onEdit(t)}
          >
            Edit
          </Button>
          <Button variant="tertiary" size="small" disabled={!canAuthor} onClick={() => onDuplicate(t)}>
            Copy
          </Button>
          <Button
            variant="icon"
            size="small"
            aria-label={`Delete ${t.name}`}
            disabled={deleteBlock(t) !== null}
            title={deleteBlock(t) ?? `Delete ${t.name}`}
            onClick={() => onDelete(t.id)}
          >
            🗑
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      padded={false}
      title="Template library"
      hint={`Question sets a buyer picks from. Authored at ${SCOPE_LABELS[scope]} scope and inherited by every narrower scope; a template from a broader scope can be copied but not edited here.`}
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Upload sits beside New rather than inside it. A buyer arriving
              with the sheet already written should not have to open an empty
              builder and go looking for the way in. */}
          <Button
            variant="secondary"
            size="small"
            disabled={!canAuthor}
            onClick={onUpload}
            title="Build a template from an Excel or CSV questionnaire"
          >
            ⬆ Upload Excel / CSV
          </Button>
          <Button variant="primary" size="small" disabled={!canAuthor} onClick={onNew}>
            New template
          </Button>
        </div>
      }
    >
      <Table
        columns={columns}
        rows={templates}
        rowKey={(t) => t.id}
        rowStyle={(t) => (t.status === 'RETIRED' ? { opacity: 0.5 } : undefined)}
        empty={
          <div style={{ padding: '30px 20px', textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 22 }}>▤</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>No templates yet</div>
            <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6, maxWidth: 440, marginInline: 'auto', lineHeight: 1.6 }}>
              Create one for each point in the journey where you ask the supplier for something —
              qualification at RFI, the scored proposal at RFP, prices at RFQ.
            </div>
          </div>
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function TemplateInspector({
  template, uses, onClose,
}: { template: QuestionnaireTemplate | null; uses: TemplateUse[]; onClose: () => void }) {
  return (
    <Drawer
      open={template !== null}
      title={template?.name ?? ''}
      subtitle={template ? `${template.code} · v${template.version}` : ''}
      onClose={onClose}
      width={620}
    >
      {template && (
        <div className="rfx-stack" style={{ gap: 14 }}>
          <div style={{ fontSize: 12.5, color: color.textBody, lineHeight: 1.65 }}>
            {template.description}
          </div>

          <Issues validation={validateTemplate(template)} />

          <Block
            title="Used by"
            hint={
              uses.length === 0
                ? 'Nothing has been asked from this template, so it can still be deleted.'
                : 'Events built from this template. It stays in the library — retire it to keep it out of new events.'
            }
          >
            <UsedByList uses={uses} />
          </Block>

          <Block title="Applied at" hint="The points in a journey where this is put in front of a supplier.">
            <div className="rfx-stack" style={{ gap: 6 }}>
              {template.appliesTo.map((point) => (
                <div key={point} style={{ fontSize: 11.5 }}>
                  <strong>{pointLabel(point)}</strong>
                  <span style={{ color: color.textSecondary }}> — {POINT_PURPOSE[point]}</span>
                </div>
              ))}
            </div>
          </Block>

          <Block
            title="Weight by section"
            hint="Only scored questions count. A priced question never contributes."
          >
            <SectionWeights template={template} />
          </Block>

          {template.sections.map((section) => (
            <Block key={section.id} title={section.name}>
              <div className="rfx-stack" style={{ gap: 6 }}>
                {questionsInSection(template, section.id).map((q) => (
                  <QuestionRow key={q.id} question={q} />
                ))}
              </div>
            </Block>
          ))}
        </div>
      )}
    </Drawer>
  );
}

/**
 * Where a template has actually been asked. Shown by reference and point rather
 * than as a bare count, because "used by 2 events" leaves a buyer who wants it
 * gone with nowhere to go next.
 */
function UsedByList({ uses }: { uses: TemplateUse[] }) {
  if (uses.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: color.textMuted }}>
        No event has been built from this template yet.
      </div>
    );
  }
  return (
    <div className="rfx-stack" style={{ gap: 5 }}>
      {uses.map((use) => (
        <div
          key={`${use.eventId}-${use.stage}`}
          style={{ display: 'flex', gap: 7, alignItems: 'baseline', fontSize: 11.5 }}
        >
          <code style={{ color: color.textSecondary }}>{use.eventNumber}</code>
          <span style={{ flex: 1, minWidth: 0 }}>{use.title}</span>
          <Chip tone="brand">{pointLabel(use.stage as VendorInputPoint)}</Chip>
        </div>
      ))}
    </div>
  );
}

function SectionWeights({ template }: { template: QuestionnaireTemplate }) {
  const scored = scoredQuestions(template);
  const bySection = template.sections.map((section) => ({
    section,
    weight: scored.filter((q) => q.sectionId === section.id).reduce((sum, q) => sum + q.weight, 0),
  }));
  const normalised = normalise(bySection);

  return (
    <div className="rfx-stack" style={{ gap: 6 }}>
      {normalised.map((entry) => (
        <div key={entry.item.section.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{entry.item.section.name}</span>
          <span style={{ fontSize: 11, color: color.textMuted }}>{entry.weight}</span>
          <div style={{ width: 120, height: 7, borderRadius: radius.pill, background: color.neutralSoft, overflow: 'hidden' }}>
            <div style={{ width: `${entry.effectivePct}%`, height: '100%', background: color.brandPrimary }} />
          </div>
          <strong style={{ fontSize: 12, width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {entry.effectivePct.toFixed(1)}%
          </strong>
        </div>
      ))}
      <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>
        Total scored weight {templateWeight(template)} across {scored.length} question(s).
        {(() => {
          const split = scopeCounts(template.questions);
          return split.line === 0
            ? ' Every question is asked once of the vendor.'
            : ` ${split.line} of them ${split.line === 1 ? 'is' : 'are'} asked once per line in the basket.`;
        })()}
      </div>
    </div>
  );
}

function QuestionRow({
  question, invalid = false,
}: {
  question: TemplateQuestion;
  /** Carries a blocking error, so the row is outlined rather than only listed. */
  invalid?: boolean;
}) {
  const priced = PRICED_QUESTION_TYPES.includes(question.type);
  const format = formatSummary(question);
  return (
    <div
      style={{
        border: `1px solid ${invalid ? color.danger : color.border}`,
        background: invalid ? '#fff' : 'transparent',
        borderRadius: radius.control, padding: '8px 11px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: color.textMuted }}>{question.sequence}</span>
        {invalid && <Chip tone="danger" icon="✕">needs fixing</Chip>}
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{question.title}</span>
        {question.isRequired && <span style={{ color: color.danger, fontSize: 12 }}>*</span>}
        <Chip tone={question.envelope === 'COMMERCIAL' ? 'purple' : question.envelope === 'TECHNICAL' ? 'info' : 'neutral'}>
          {question.envelope.toLowerCase()}
        </Chip>
        <Chip tone="neutral">{typeLabel(question.type)}</Chip>
        {question.isKnockout && <Chip tone="danger" icon="✕">knockout</Chip>}
        {question.askedPer === 'LINE' && (
          <Chip tone="brand" icon="▤" title="Asked once for every line in the basket">
            per line item
          </Chip>
        )}
        {priced
          ? <Chip tone="gold" title="Price reaches the score through the price component only">unweighted by rule</Chip>
          : question.weight > 0 && <Chip tone="brand">weight {question.weight}</Chip>}
      </div>
      <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 3 }}>
        <code>{question.code}</code>
        {format && ` · ${format}`}
        {question.rubric && ` · ${question.rubric}`}
      </div>
    </div>
  );
}

function Block({
  title, hint, children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: color.textSecondary }}>
        {title}
      </div>
      {hint && <div style={{ fontSize: 11, color: color.textMuted, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Issues({ validation }: { validation: ReturnType<typeof validateTemplate> }) {
  if (validation.errors.length === 0 && validation.warnings.length === 0) return null;
  return (
    <div className="rfx-stack" style={{ gap: 8 }}>
      {validation.errors.map((issue, i) => (
        <ValidationBanner key={`e-${issue.code}-${i}`} tone="error" title={issue.message}>{''}</ValidationBanner>
      ))}
      {validation.warnings.map((issue, i) => (
        <ValidationBanner key={`w-${issue.code}-${i}`} tone="warning" title={issue.message}>{''}</ValidationBanner>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Exported for the builder tests, which open it without a click. */
export function TemplateBuilder({
  template, takenNames, library, startImporting = false, onChange, onClose, onSave,
}: {
  template: QuestionnaireTemplate;
  takenNames: string[];
  /** Everything visible at this scope — what the agent retrieves against. */
  library: QuestionnaireTemplate[];
  /**
   * Open straight into the upload. Set when the buyer came in by the library's
   * Upload button rather than by New template — the builder is still where
   * the import lands, but making them find the button again would be asking
   * the same question twice.
   */
  startImporting?: boolean;
  onChange: (next: QuestionnaireTemplate) => void;
  onClose: () => void;
  onSave: (t: QuestionnaireTemplate) => void;
}) {
  const [selectedId, setSelectedId] = React.useState<Id | null>(null);
  /**
   * The buyer's two readings of the same thing. Preview is a tab rather than
   * a separate screen because the question it answers — "is this askable?" —
   * comes up while editing, not after it.
   */
  const [view, setView] = React.useState<'edit' | 'preview'>('edit');
  const validation = validateTemplate(template, takenNames);

  const patch = (next: Partial<QuestionnaireTemplate>) => onChange({ ...template, ...next });

  const patchQuestion = (id: Id, next: Partial<TemplateQuestion>) =>
    patch({ questions: template.questions.map((q) => (q.id === id ? { ...q, ...next } : q)) });

  const addQuestion = (sectionId: Id) => {
    const question = newQuestion(template, sectionId);
    patch({ questions: [...template.questions, question] });
    setSelectedId(question.id);
  };

  const togglePoint = (point: VendorInputPoint) =>
    patch({
      appliesTo: template.appliesTo.includes(point)
        ? template.appliesTo.filter((p) => p !== point)
        : VENDOR_INPUT_POINTS.filter((p) => p === point || template.appliesTo.includes(p)),
    });

  const budgets = sectionBudgets(template);
  const questionErrors = errorsByQuestion(validation.errors);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(startImporting);
  /** The section awaiting confirmation, because removing it removes questions. */
  const [removingId, setRemovingId] = React.useState<Id | null>(null);
  const removing = template.sections.find((s) => s.id === removingId) ?? null;
  const removingQuestions = removing === null ? [] : questionsInSection(template, removing.id);

  const addSection = () => {
    const sequence = template.sections.length + 1;
    patch({
      sections: [
        ...template.sections,
        // Zero, not a guess: a new section holds nothing, and one that claimed
        // weight on creation would put the template over budget immediately.
        {
          id: `${template.id}-sec-${sequence}`, name: `Section ${sequence}`, sequence,
          weight: 0,
          // Per vendor until the buyer says otherwise: most of a questionnaire
          // is about the company, and the other grain is a decision.
          askedPer: 'VENDOR',
        },
      ],
    });
  };

  return (
    <Drawer
      open
      title={template.name.trim() === '' ? 'New questionnaire template' : `Edit — ${template.name}`}
      subtitle={`${SCOPE_LABELS[template.scopeType]} scope · ${template.questions.length} question(s)`}
      onClose={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            onClick={() => setImportOpen(true)}
            title="Bring the questions in from an Excel or CSV sheet"
          >
            ⬆ Upload
          </Button>
          <Button
            variant="secondary"
            onClick={() => setAgentOpen(true)}
            disabled={template.categories.length === 0}
            title={
              template.categories.length === 0
                ? 'Pick a category first — the agent drafts against one.'
                : `Ask AG-03 to draft questions for ${template.categories.join(', ')}`
            }
          >
            ✦ Ask the agent
          </Button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/*
              Why the button is off, beside the button.
              A disabled control carries `pointer-events: none`, so a `title`
              on it never appears — and the issue list is at the top of a form
              that is routinely several screens long. The first blocker is
              printed here so the answer to "why can I not save this?" is
              where the question gets asked.
            */}
            {!validation.valid && (
              <span
                style={{
                  fontSize: 11.5, color: color.dangerText, lineHeight: 1.45,
                  maxWidth: 360, textAlign: 'right',
                }}
              >
                <strong>✕ Cannot be saved yet — </strong>
                {validation.errors[0].message}
                {validation.errors.length > 1 && (
                  <> And {validation.errors.length - 1} other
                    {validation.errors.length === 2 ? '' : 's'}, listed at the top of the form.</>
                )}
              </span>
            )}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!validation.valid} onClick={() => onSave(template)}>
              Save template
            </Button>
          </div>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'edit' as const, label: 'Edit' },
            { value: 'preview' as const, label: 'Preview as a supplier' },
          ]}
        />

        {view === 'preview' ? (
          <QuestionnairePreview
            name={template.name}
            point={template.appliesTo[0] ?? null}
            sections={template.sections}
            questions={template.questions}
          />
        ) : (
        <>
        <Issues validation={validation} />

        <Field label="Name" required hint="What a buyer picks from the library.">
          <TextInput
            value={template.name}
            placeholder="e.g. Supplier qualification — RFI"
            onChange={(e) => {
              const name = e.target.value;
              patch({
                name,
                // The code follows the name until it has been published, then
                // it is frozen — a code that moves breaks answer inheritance.
                code: template.status === 'DRAFT' ? suggestCode(name, template.appliesTo) : template.code,
              });
            }}
          />
        </Field>

        <Field
          label="Code"
          hint={
            template.status === 'DRAFT'
              ? 'Derived from the name while the template is a draft. Frozen once published, because codes carry answers between stages.'
              : 'Frozen — this template is published and its code carries answers between stages.'
          }
          lockedBy={template.status === 'DRAFT' ? undefined : 'publication'}
        >
          <TextInput
            value={template.code}
            disabled={template.status !== 'DRAFT'}
            onChange={(e) => patch({ code: e.target.value })}
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={2}
            value={template.description}
            placeholder="When this template is the right thing to ask."
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
            Where in the journey it is asked
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginBottom: 9, lineHeight: 1.55 }}>
            A template is not owned by a stage. The same capability set is routinely asked at RFI and
            re-confirmed at RFP — pick every point where this belongs.
          </div>
          <div className="rfx-stack" style={{ gap: 7 }}>
            {VENDOR_INPUT_POINTS.map((point) => {
              const on = template.appliesTo.includes(point);
              return (
                <div
                  key={point}
                  style={{
                    border: `1px solid ${on ? color.brandPrimary : color.border}`,
                    background: on ? color.brandPrimarySoft : '#fff',
                    borderRadius: radius.control, padding: '9px 12px',
                  }}
                >
                  <Checkbox checked={on} label={pointLabel(point)} onChange={() => togglePoint(point)} />
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
                    {POINT_PURPOSE[point]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
          <Field label="Status" hint="A retired template stays readable and is never offered to a new event.">
            <Select
              value={template.status}
              onChange={(e) => patch({ status: e.target.value as TemplateStatus })}
            >
              {(['DRAFT', 'PUBLISHED', 'RETIRED'] as TemplateStatus[]).map((s) => (
                <option key={s} value={s}>{TEMPLATE_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Categories"
            hint="The categories this template serves. Empty means every category."
          >
            <CategoryPicker
              selected={template.categories}
              onChange={(categories) => patch({ categories })}
            />
          </Field>
          <Field
            label="Score scale"
            hint="What section and overall scores are reported out of. Chosen now, because a scale changed later rewrites what every committed score meant."
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 90 }}>
                <NumberInput
                  value={template.scoreScale}
                  aria-label="Score scale"
                  min={1}
                  invalid={!(template.scoreScale > 0)}
                  onChange={(e) => patch({ scoreScale: Number(e.target.value) })}
                />
              </div>
              {SCORE_SCALE_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant={template.scoreScale === preset ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => patch({ scoreScale: preset })}
                >
                  /{preset}
                </Button>
              ))}
            </div>
          </Field>
        </div>

        <SectionTotal template={template} />

        {/* Questions, grouped by section. Each section budgets its own. */}
        {template.sections.map((section, index) => {
          const questions = questionsInSection(template, section.id);
          const budget = budgets.find((b) => b.section.id === section.id);
          const first = index === 0;
          const last = index === template.sections.length - 1;
          const onlySection = template.sections.length === 1;
          return (
            <Card
              key={section.id}
              padded={false}
              title={
                <input
                  value={section.name}
                  aria-label={`Section name — ${section.name}`}
                  onChange={(e) =>
                    patch({
                      sections: template.sections.map((s) =>
                        s.id === section.id ? { ...s, name: e.target.value } : s,
                      ),
                    })
                  }
                  style={{
                    border: 'none', background: 'transparent', fontSize: 15, fontWeight: 600,
                    padding: 0, width: '100%',
                  }}
                />
              }
              hint={(() => {
                // How the section splits between the two scopes, because the
                // number a supplier actually owes is the line ones multiplied
                // by the basket, not the question count.
                const split = scopeCounts(questions);
                return split.line === 0
                  ? `${questions.length} question(s)`
                  : `${questions.length} question(s) · ${split.vendor} per vendor, ${split.line} per line item`;
              })()}
              action={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* The grain the whole section runs at. Its questions follow
                      it, so a supplier meets one coherent block rather than a
                      form that switches grain row by row. */}
                  <Segmented
                    size="small"
                    value={section.askedPer}
                    onChange={(askedPer) => onChange(setSectionScope(template, section.id, askedPer))}
                    options={QUESTION_SCOPES.map((o) => ({ value: o.id, label: o.label }))}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: color.textSecondary, whiteSpace: 'nowrap' }}>
                      Section weight
                    </span>
                    <div style={{ width: 74 }}>
                      <NumberInput
                        value={section.weight}
                        aria-label={`Section weight — ${section.name}`}
                        min={0}
                        invalid={budget?.overspent}
                        onChange={(e) =>
                          patch({
                            sections: template.sections.map((s) =>
                              s.id === section.id
                                ? { ...s, weight: Math.max(0, Number(e.target.value)) }
                                : s,
                            ),
                          })
                        }
                      />
                    </div>
                  </label>
                  <Button variant="secondary" size="small" onClick={() => addQuestion(section.id)}>
                    ＋ Question
                  </Button>
                  {/* Order and removal, grouped away from the settings so the
                      destructive one is not sitting next to the weight box. */}
                  <span style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
                    <Button
                      variant="icon"
                      size="small"
                      aria-label={`Move ${section.name} up`}
                      title={first ? 'Already the first section' : `Move "${section.name}" above "${template.sections[index - 1].name}"`}
                      disabled={first}
                      onClick={() => onChange(moveSection(template, section.id, -1))}
                    >
                      ▲
                    </Button>
                    <Button
                      variant="icon"
                      size="small"
                      aria-label={`Move ${section.name} down`}
                      title={last ? 'Already the last section' : `Move "${section.name}" below "${template.sections[index + 1].name}"`}
                      disabled={last}
                      onClick={() => onChange(moveSection(template, section.id, 1))}
                    >
                      ▼
                    </Button>
                    <Button
                      variant="icon"
                      size="small"
                      aria-label={`Remove section ${section.name}`}
                      title={
                        onlySection
                          ? 'The questions have to live somewhere — add another section before removing this one.'
                          : questions.length === 0
                            ? `Remove "${section.name}"`
                            : `Remove "${section.name}" and the ${questions.length} question(s) in it`
                      }
                      disabled={onlySection}
                      onClick={() => {
                        // An empty section goes without ceremony; one holding
                        // questions asks, because the questions go with it.
                        if (questions.length === 0) onChange(removeSection(template, section.id));
                        else setRemovingId(section.id);
                      }}
                    >
                      🗑
                    </Button>
                  </span>
                </div>
              }
            >
              {budget && <BudgetMeter budget={budget} />}
              {questions.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 12, color: color.textMuted }}>
                  No questions in this section yet.
                </div>
              ) : (
                <div>
                  {questions.map((question, i) => {
                  /**
                   * Which question is stopping the save, marked on the
                   * question.
                   *
                   * The error list at the top of the form says what is wrong;
                   * it cannot say *where* in a thirty-question import. A red
                   * edge and the reason in place is the difference between
                   * reading an error and finding it.
                   */
                  const faults = questionErrors.get(question.id) ?? [];
                  const broken = faults.length > 0;
                  return (
                    <div
                      key={question.id}
                      style={{
                        borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                        borderLeft: `3px solid ${
                          broken ? color.dangerText
                            : selectedId === question.id ? color.brandPrimary : 'transparent'
                        }`,
                        background: broken
                          ? color.dangerSoft
                          : selectedId === question.id ? '#F5F8FF' : '#fff',
                        padding: '9px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(selectedId === question.id ? null : question.id)}
                          style={{
                            flex: 1, minWidth: 0, textAlign: 'left', border: 'none',
                            background: 'none', cursor: 'pointer', padding: 0,
                          }}
                        >
                          <QuestionRow question={question} invalid={broken} />
                        </button>
                        {/* The order the supplier meets them in. An uploaded
                            sheet arrives in the order it was written, which is
                            usually right and occasionally not. */}
                        <Button
                          variant="icon"
                          size="small"
                          aria-label={`Move ${question.code} up`}
                          title={i === 0 ? 'Already first in this section' : 'Ask this earlier'}
                          disabled={i === 0}
                          onClick={() => onChange(moveQuestion(template, question.id, -1))}
                        >
                          ▲
                        </Button>
                        <Button
                          variant="icon"
                          size="small"
                          aria-label={`Move ${question.code} down`}
                          title={i === questions.length - 1 ? 'Already last in this section' : 'Ask this later'}
                          disabled={i === questions.length - 1}
                          onClick={() => onChange(moveQuestion(template, question.id, 1))}
                        >
                          ▼
                        </Button>
                        <Button
                          variant="icon"
                          size="small"
                          aria-label={`Remove ${question.title}`}
                          // Says in advance what removing it does to the
                          // section, because the weight moving is the part
                          // nobody expects.
                          title={(() => {
                            const shift = weightAfterRemoving(template, question.id);
                            return shift === null
                              ? `Remove ${question.code}`
                              : `Remove ${question.code} — "${shift.section.name}" drops from ${shift.from}% to ${shift.to}%, since the section can no longer award what this question carried`;
                          })()}
                          onClick={() => {
                            if (selectedId === question.id) setSelectedId(null);
                            onChange(removeQuestion(template, question.id));
                          }}
                        >
                          ✕
                        </Button>
                      </div>

                      {broken && (
                        <div className="rfx-stack" style={{ gap: 3, marginTop: 6 }}>
                          {faults.map((fault, f) => (
                            <div
                              key={f}
                              style={{
                                fontSize: 11.5, color: color.dangerText, lineHeight: 1.5,
                                display: 'flex', gap: 6,
                              }}
                            >
                              <span aria-hidden style={{ fontWeight: 700 }}>✕</span>
                              <span>{fault.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {selectedId === question.id && (
                        <QuestionEditor
                          question={question}
                          sections={template.sections}
                          ceiling={weightCeilingFor(template, question.id)}
                          onChange={(next) => patchQuestion(question.id, next)}
                        />
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        <Button variant="secondary" onClick={addSection}>＋ Add section</Button>
        </>
        )}
      </div>

      <QuestionnaireAgentPanel
        open={agentOpen}
        template={template}
        library={library}
        onClose={() => setAgentOpen(false)}
        onApply={onChange}
      />

      <Modal
        open={removing !== null}
        title={removing === null ? '' : `Remove "${removing.name}"?`}
        onClose={() => setRemovingId(null)}
        onConfirm={() => {
          if (removing !== null) onChange(removeSection(template, removing.id));
          setRemovingId(null);
        }}
        confirmLabel="Remove the section"
        confirmTone="destructive"
      >
        <div style={{ fontSize: 12.5, lineHeight: 1.65, color: color.textBody }}>
          The {removingQuestions.length} question(s) in it go too
          {removingQuestions.length > 0 && (
            <> — {removingQuestions.map((q) => q.code).join(', ')}</>
          )}
          . To keep any of them, close this and move them to another section
          first: each question's own <strong>Section</strong> field does that
          without losing what has been written.
          {removing !== null && removing.weight > 0 && (
            <> Its {removing.weight}% goes back on the table, so the remaining sections will
            need to be raised to total 100% again.</>
          )}
        </div>
      </Modal>

      <QuestionnaireImportDrawer
        open={importOpen}
        template={template}
        takenNames={takenNames}
        onClose={() => setImportOpen(false)}
        onApply={(next) => {
          onChange(next);
          setImportOpen(false);
          // Back to the edit tab rather than the preview: the first thing
          // anyone does after an upload is look at what arrived.
          setView('edit');
          setSelectedId(null);
        }}
      />
    </Drawer>
  );
}

/**
 * Choosing the categories a template serves.
 *
 * A closed list, not free text. "IT Hardware" and "IT hardware" are two
 * different categories as far as every lookup in this system is concerned —
 * the shortlist, the questionnaire and the spend report would each resolve a
 * different one and none of them would say so. The picker also makes the
 * question answerable: a buyer who has to type a category has to already know
 * what this organisation calls it.
 */
function CategoryPicker({
  selected, onChange,
}: { selected: string[]; onChange: (next: string[]) => void }) {
  const groups = categoriesBySuper();
  const unpicked = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !selected.includes(item.id)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="rfx-stack" style={{ gap: 7 }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {selected.length === 0 ? (
          <span style={{ fontSize: 11.5, color: color.textMuted }}>
            Every category — this template is offered wherever it applies.
          </span>
        ) : (
          selected.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={`Remove category ${id}`}
              onClick={() => onChange(selected.filter((each) => each !== id))}
              style={{
                border: `1px solid ${color.brandPrimaryTint}`, background: color.brandPrimarySoft,
                color: color.brandPrimary, borderRadius: radius.pill, cursor: 'pointer',
                padding: '3px 9px', fontSize: 11.5, fontWeight: 600,
              }}
            >
              {id} ✕
            </button>
          ))
        )}
      </div>
      <Select
        value=""
        aria-label="Add a category"
        onChange={(e) => {
          if (e.target.value === '') return;
          onChange([...selected, e.target.value]);
        }}
      >
        <option value="">Add a category…</option>
        {unpicked.map((group) => (
          <optgroup key={group.superCategory} label={group.superCategory}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>{item.id} — {item.description}</option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

/**
 * The shares, added up.
 *
 * Sections are percentages of one technical score, so the only interesting
 * number is the distance from 100. Shown above the sections rather than
 * beneath them, because it is the constraint a buyer is working inside while
 * they type the individual figures, not a verdict delivered afterwards.
 */
function SectionTotal({ template }: { template: QuestionnaireTemplate }) {
  if (!isScoredTemplate(template)) {
    return (
      <div style={{ fontSize: 11.5, color: color.textSecondary }}>
        Nothing is weighted, so this template gathers information without contributing to the
        ranking. Give a section a share to start scoring with it.
      </div>
    );
  }
  const total = sectionWeightTotal(template);
  const off = total - 100;
  const tone = off === 0 ? color.successText : off > 0 ? color.dangerText : color.warningText;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        border: `1px solid ${off === 0 ? color.border : tone}`,
        background: off === 0 ? color.successSoft : off > 0 ? color.dangerSoft : color.warningSoft,
        borderRadius: radius.control, padding: '8px 12px',
      }}
    >
      <strong style={{ fontSize: 12.5, color: tone }}>
        Sections total {total}% of 100%
      </strong>
      <span style={{ fontSize: 11.5, color: color.textSecondary, flex: 1, minWidth: 180 }}>
        {off === 0
          ? 'Every share is accounted for. A section\u2019s weight is the share of the technical score it carries.'
          : off > 0
            ? `${off}% more score than there is to give — lower a section.`
            : `${-off}% is unaccounted for — raise a section, or add the one that is missing.`}
      </span>
      <div
        aria-hidden
        style={{
          width: 140, height: 6, borderRadius: 3, background: color.border, overflow: 'hidden',
        }}
      >
        <div style={{ width: `${Math.min(100, total)}%`, height: '100%', background: tone }} />
      </div>
    </div>
  );
}

/**
 * How much of a section's budget its questions have spent.
 *
 * A bar rather than two numbers because the question a buyer is actually
 * asking is "have I got room for another question here", and a bar answers it
 * without arithmetic. Over budget is drawn past the end in red rather than
 * clipped at full — a meter that pins at 100% hides exactly the state that
 * needs fixing.
 */
function BudgetMeter({ budget }: { budget: SectionBudget }) {
  const pct = budget.declared === 0
    ? (budget.allocated > 0 ? 100 : 0)
    : Math.min(100, (budget.allocated / budget.declared) * 100);
  const tone = budget.overspent ? color.danger
    : budget.remaining > 0 ? color.warning
    : color.success;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        borderBottom: `1px solid ${color.border}`, background: color.rowAlt,
      }}
    >
      <div
        style={{
          flex: 1, height: 6, borderRadius: radius.pill, background: color.neutralSoft,
          overflow: 'hidden', minWidth: 60,
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
      </div>
      <span style={{ fontSize: 11.5, color: color.textSecondary, whiteSpace: 'nowrap' }}>
        {budget.allocated} of {budget.declared} allocated
      </span>
      {budget.overspent ? (
        <Chip tone="danger" icon="✕">{-budget.remaining} over</Chip>
      ) : budget.declared === 0 ? (
        <Chip tone="neutral">not scored</Chip>
      ) : budget.remaining > 0 ? (
        <Chip tone="gold">{budget.remaining} unspent</Chip>
      ) : (
        <Chip tone="brand">fully allocated</Chip>
      )}
    </div>
  );
}

export function QuestionEditor({
  question, sections, ceiling, onChange,
}: {
  question: TemplateQuestion;
  sections: QuestionnaireTemplate['sections'];
  /**
   * The most weight this question may take before its section is over budget.
   * Null when it belongs to no section, so no budget constrains it.
   */
  ceiling: number | null;
  onChange: (next: Partial<TemplateQuestion>) => void;
}) {
  const priced = PRICED_QUESTION_TYPES.includes(question.type);

  return (
    <div
      className="rfx-stack"
      style={{
        gap: 12, marginTop: 10, paddingTop: 11, borderTop: `1px dashed ${color.borderStrong}`,
      }}
    >
      {/*
        The code comes first and the question text is given the whole width.
        The code is the identifier a buyer works from — it is what the
        spreadsheet calls the row, what the evaluation screen cites and what
        carries an answer from RFI into RFP — so it reads first, short and
        exact. The question itself is prose and routinely runs past a line: on
        one line of a four-up grid it was being written to fit the box rather
        than to be understood by a supplier.
      */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 130 }}>
          <Field label="Code" hint="Reuse across stages to carry the answer forward.">
            <TextInput value={question.code} onChange={(e) => onChange({ code: e.target.value })} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Field label="Question" required hint="What the supplier reads, in full.">
            <Textarea
              rows={2}
              value={question.title}
              placeholder="e.g. Describe your quality management system and the standards it is certified to."
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 10 }}>
        <Field label="Response type" hint={QUESTION_TYPE_SPEC[question.type].asks}>
          <Select
            value={question.type}
            onChange={(e) => {
              const type = e.target.value as QuestionType;
              // Carry the answer format across: switching single choice to
              // multiple choice must not throw away the choices just typed.
              const config = carryConfig(question.type, type, question.config, question.id);
              // A priced question can never carry weight — drop it on switch
              // rather than letting the template save into an error state.
              onChange(
                PRICED_QUESTION_TYPES.includes(type)
                  ? { type, config, weight: 0, scoringMethod: 'NONE', maxScore: 0, envelope: 'COMMERCIAL' }
                  : { type, config },
              );
            }}
          >
            {QUESTION_TYPES_BY_GROUP.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Section">
          <Select
            value={question.sectionId ?? ''}
            onChange={(e) => onChange({ sectionId: e.target.value || null })}
          >
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Help text">
        <TextInput value={question.helpText} onChange={(e) => onChange({ helpText: e.target.value })} />
      </Field>

      <AnswerFormat question={question} onChange={onChange} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Envelope</div>
          <Segmented
            size="small"
            value={question.envelope}
            onChange={(envelope) => onChange({ envelope })}
            options={[
              { value: 'TECHNICAL' as const, label: 'Technical' },
              { value: 'COMMERCIAL' as const, label: 'Commercial' },
              { value: 'GENERAL' as const, label: 'General' },
            ]}
          />
        </div>
        <AskedPerControl question={question} sections={sections} onChange={onChange} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 10 }}>
        <Field
          label="Weight"
          hint={
            priced ? 'A priced question carries no weight, by rule.'
              : ceiling === null ? 'This question is in no section, so no budget caps it.'
              : `Allocated from this section. ${ceiling} available to this question.`
          }
          lockedBy={priced ? 'the price rule' : undefined}
        >
          <NumberInput
            value={question.weight}
            disabled={priced}
            max={ceiling ?? undefined}
            onChange={(e) =>
              // Clamped to the section's remaining budget rather than accepted
              // and then reported as an error: an over-budget section is a
              // state the buyer should not be able to author in the first
              // place. The validation still catches it, for templates that
              // arrive by any other door.
              onChange({
                weight: Math.min(
                  Math.max(0, Number(e.target.value)),
                  ceiling ?? Number.POSITIVE_INFINITY,
                ),
              })
            }
          />
        </Field>
        <Field label="Scoring method">
          <Select
            value={question.scoringMethod}
            disabled={priced}
            onChange={(e) => onChange({ scoringMethod: e.target.value as ScoringMethod })}
          >
            {(Object.keys(SCORING_LABELS) as ScoringMethod[]).map((m) => (
              <option key={m} value={m}>{SCORING_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Rubric" hint="Always visible to the evaluator.">
        <TextInput
          value={question.rubric ?? ''}
          placeholder="Valid = 10 · Expired = 4 · Absent = 0"
          onChange={(e) => onChange({ rubric: e.target.value || null })}
        />
      </Field>

      {question.envelope === 'COMMERCIAL' && !priced && (
        <Field
          label="How evaluation treats the answer"
          hint={TREATMENT_NOTE[treatmentOf(question)]}
        >
          <Select
            aria-label="Evaluation type"
            value={question.evalType ?? ''}
            onChange={(e) => {
              const evalType = (e.target.value || undefined) as QuestionEvalType | undefined;
              // A knockout is a gate, not a weight: the two settings may not disagree.
              onChange({
                evalType,
                ...(evalType === 'KO' ? { isKnockout: true } : question.evalType === 'KO' ? { isKnockout: false } : {}),
                ...(evalType === 'MONETISED' || evalType === 'INFO' || evalType === 'LOADING' ? { weight: 0 } : {}),
              });
            }}
          >
            <option value="">Automatic — worked out from the question</option>
            {(['SCORED', 'KO', 'MONETISED', 'LOADING', 'PREFERENCE', 'INFO'] as QuestionEvalType[]).map((t) => (
              <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>
            ))}
          </Select>
        </Field>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Toggle
          checked={question.isRequired}
          onChange={(isRequired) => onChange({ isRequired })}
          label="Required"
        />
        <Toggle
          checked={question.isKnockout}
          onChange={(isKnockout) => onChange({ isKnockout })}
          label="Knockout — failing disqualifies"
        />
        <Toggle
          checked={question.allowAttachment}
          onChange={(allowAttachment) => onChange({ allowAttachment })}
          label="Allow attachment"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answer format — the fields that only exist once a type is chosen
// ---------------------------------------------------------------------------

/**
 * A multiple choice without its choices is not a question, so the editor asks
 * for whatever the chosen type actually needs and nothing else. The facets come
 * from the domain, which means a new question type is configurable the moment
 * it declares what it asks for.
 */
function AnswerFormat({
  question, onChange,
}: {
  question: TemplateQuestion;
  onChange: (next: Partial<TemplateQuestion>) => void;
}) {
  const spec = QUESTION_TYPE_SPEC[question.type];
  if (spec.facets.length === 0) return null;

  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.control,
        padding: '11px 12px', background: color.surfacePage,
      }}
    >
      <div
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
          textTransform: 'uppercase', color: color.textSecondary,
        }}
      >
        Answer format
      </div>
      <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 3, lineHeight: 1.5 }}>
        {spec.asks}
      </div>
      <div className="rfx-stack" style={{ gap: 12, marginTop: 11 }}>
        {spec.facets.map((facet) => (
          <FacetEditor key={facet} facet={facet} question={question} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function FacetEditor({
  facet, question, onChange,
}: {
  facet: QuestionFacet;
  question: TemplateQuestion;
  onChange: (next: Partial<TemplateQuestion>) => void;
}) {
  const config = question.config;
  const set = (patch: Partial<QuestionConfig>) => onChange({ config: { ...config, ...patch } });
  const numberOrNull = (raw: string) => (raw.trim() === '' ? null : Number(raw));

  switch (facet) {
    case 'options':
      return <OptionsEditor question={question} onChange={onChange} />;

    case 'selection_limits':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10 }}>
          <Field label={`At least`} hint={SELECTION_NOUN[question.type] ?? 'answers'}>
            <NumberInput
              min={0}
              value={config.minSelections ?? ''}
              onChange={(e) => set({ minSelections: numberOrNull(e.target.value) })}
            />
          </Field>
          <Field label="At most" hint="Blank means no limit.">
            <NumberInput
              min={0}
              value={config.maxSelections ?? ''}
              onChange={(e) => set({ maxSelections: numberOrNull(e.target.value) })}
            />
          </Field>
        </div>
      );

    case 'numeric_range':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: 10 }}>
          <Field label="Minimum">
            <NumberInput
              value={config.min ?? ''}
              onChange={(e) => set({ min: numberOrNull(e.target.value) })}
            />
          </Field>
          <Field label="Maximum" hint="Blank means unbounded.">
            <NumberInput
              value={config.max ?? ''}
              onChange={(e) => set({ max: numberOrNull(e.target.value) })}
            />
          </Field>
          <Field label="Unit" hint="Fix it here so two answers compare.">
            <TextInput
              value={config.unit ?? ''}
              placeholder="days · tonnes · units / month"
              onChange={(e) => set({ unit: e.target.value })}
            />
          </Field>
          <Field label="Decimals">
            <NumberInput
              min={0}
              max={6}
              value={config.decimals ?? 0}
              onChange={(e) => set({ decimals: Math.max(0, Number(e.target.value)) })}
            />
          </Field>
        </div>
      );

    case 'text_limits':
      return (
        <Field label="Maximum length" hint="Characters. A cap is what keeps a method statement readable.">
          <NumberInput
            min={1}
            value={config.maxLength ?? ''}
            onChange={(e) => set({ maxLength: numberOrNull(e.target.value) })}
          />
        </Field>
      );

    case 'file_rules':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 10 }}>
          <Field label="Accepted formats" hint="Comma separated. Blank means any file.">
            <TextInput
              value={(config.acceptedFormats ?? []).join(', ')}
              placeholder="pdf, jpg, png"
              onChange={(e) =>
                set({
                  acceptedFormats: e.target.value
                    .split(',').map((part) => part.trim().replace(/^\./, '').toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Maximum size" hint="Megabytes.">
            <NumberInput
              min={1}
              value={config.maxFileSizeMb ?? ''}
              onChange={(e) => set({ maxFileSizeMb: numberOrNull(e.target.value) })}
            />
          </Field>
        </div>
      );

    case 'date_window':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 10 }}>
          <Field label="Not before" hint={question.type === 'certificate' ? 'Reject credentials issued before this.' : undefined}>
            <TextInput
              type="date"
              value={config.earliest ?? ''}
              onChange={(e) => set({ earliest: e.target.value || null })}
            />
          </Field>
          <Field label="Not after" hint="Blank means no bound.">
            <TextInput
              type="date"
              value={config.latest ?? ''}
              onChange={(e) => set({ latest: e.target.value || null })}
            />
          </Field>
        </div>
      );

    case 'grid':
      return (
        <div className="rfx-stack" style={{ gap: 10 }}>
          {question.type === 'price_schedule' ? (
            <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.5 }}>
              Rows are the event's line items — the price schedule follows the lots, so it never
              has to be typed twice.
            </div>
          ) : question.type === 'matrix_rating' ? (
            <StringListEditor
              label="Items to rate"
              addLabel="Add item"
              placeholder="On-time delivery"
              values={config.rows ?? []}
              onChange={(rows) => set({ rows })}
              hint="One row each. The columns are the scale you define below."
            />
          ) : null}

          {question.type !== 'matrix_rating' && (
            <StringListEditor
              label="Columns"
              addLabel="Add column"
              placeholder="Unit price"
              values={config.columns ?? []}
              onChange={(columns) => set({ columns })}
              hint={
                question.type === 'price_schedule'
                  ? 'What the supplier fills in against every line.'
                  : 'What the supplier fills in on every row.'
              }
            />
          )}
        </div>
      );

    case 'body_text':
      return (
        <Field label={BODY_LABEL[question.type] ?? 'Text'} hint={BODY_HINT[question.type]}>
          <Textarea
            rows={3}
            value={config.body ?? ''}
            onChange={(e) => set({ body: e.target.value })}
          />
        </Field>
      );

    case 'formula':
      return (
        <Field label="Formula" hint="Reference other questions by code.">
          <TextInput
            value={config.formula ?? ''}
            placeholder="{COM.PRICES.total} * (1 - {COM.DISCOUNT} / 100)"
            onChange={(e) => set({ formula: e.target.value })}
          />
        </Field>
      );

    default:
      return null;
  }
}

const SELECTION_NOUN: Partial<Record<QuestionType, string>> = {
  multiple_choice: 'choices the supplier must select',
  reference_submission: 'references',
  repeating_group: 'entries',
};

const BODY_LABEL: Partial<Record<QuestionType, string>> = {
  compliance_statement: 'Clause',
  instruction_block: 'Instructions',
  signature: 'Declaration',
  hidden_metadata: 'Value',
};

const BODY_HINT: Partial<Record<QuestionType, string>> = {
  compliance_statement: 'The exact wording the supplier is confirming against.',
  signature: 'What the named signatory is accepting.',
  hidden_metadata: 'Carried on the response. Never shown to the supplier.',
};

/**
 * The choice list.
 *
 * Two columns matter beyond the label: the score, which is what turns a rubric
 * written in prose into something rule scoring can compute, and the failing
 * flag, which is the only thing a knockout can actually fire on.
 */
function OptionsEditor({
  question, onChange,
}: {
  question: TemplateQuestion;
  onChange: (next: Partial<TemplateQuestion>) => void;
}) {
  const [applied, setApplied] = React.useState<string | null>(null);
  const options = question.config.options ?? [];
  const presets = presetsFor(question.type);
  const appliedPreset = presets.find((preset) => preset.id === applied) ?? null;

  const setOptions = (next: QuestionOption[]) =>
    onChange({ config: { ...question.config, options: next } });

  const patchOption = (id: Id, patch: Partial<QuestionOption>) =>
    setOptions(options.map((option) => (option.id === id ? { ...option, ...patch } : option)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    setOptions(next);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>
          Choices {options.length > 0 && <span style={{ color: color.textMuted }}>({options.length})</span>}
        </span>
        <span style={{ flex: 1 }} />
        {presets.length > 0 && (
          <Select
            value=""
            style={{ width: 210, fontSize: 12 }}
            onChange={(e) => {
              const preset = presets.find((candidate) => candidate.id === e.target.value);
              if (!preset) return;
              setOptions(optionsFromPreset(preset, question.id));
              setApplied(preset.id);
            }}
          >
            <option value="">
              {options.length === 0 ? 'Use a suggested set…' : 'Replace with a suggested set…'}
            </option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
        )}
        <Button variant="secondary" size="small" onClick={() => setOptions(appendOption(question))}>
          ＋ Choice
        </Button>
      </div>

      {appliedPreset && (
        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 5, lineHeight: 1.5 }}>
          {appliedPreset.hint}
        </div>
      )}

      {options.length === 0 ? (
        <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 8, lineHeight: 1.5 }}>
          No choices yet. A supplier cannot pick from an empty list — start from a suggested set
          or add them one at a time.
        </div>
      ) : (
        <div className="rfx-stack" style={{ gap: 8, marginTop: 9 }}>
          <div
            style={{
              display: 'grid', gridTemplateColumns: '20px 1fr 76px 92px',
              gap: 8, fontSize: 10.5, color: color.textMuted, letterSpacing: '.03em',
              textTransform: 'uppercase', fontWeight: 700,
            }}
          >
            <span />
            <span>Choice the supplier sees</span>
            <span title="Points under rule scoring">Score</span>
            <span />
          </div>

          {options.map((option, index) => (
            <div key={option.id}>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 76px 92px', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: color.textMuted, textAlign: 'right' }}>{index + 1}</span>
                <TextInput
                  value={option.label}
                  placeholder="Wording the supplier reads"
                  invalid={option.label.trim() === ''}
                  onChange={(e) => patchOption(option.id, { label: e.target.value })}
                />
                <NumberInput
                  value={option.score ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    patchOption(option.id, {
                      score: e.target.value.trim() === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <span style={{ display: 'inline-flex', gap: 2, justifyContent: 'flex-end' }}>
                  <Button variant="icon" size="small" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>▲</Button>
                  <Button variant="icon" size="small" aria-label="Move down" disabled={index === options.length - 1} onClick={() => move(index, 1)}>▼</Button>
                  <Button
                    variant="icon"
                    size="small"
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => setOptions(options.filter((candidate) => candidate.id !== option.id))}
                  >
                    ✕
                  </Button>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '5px 0 0 28px' }}>
                <Checkbox
                  checked={option.isDisqualifying}
                  onChange={(isDisqualifying) => patchOption(option.id, { isDisqualifying })}
                  label="Fails the question"
                />
                <Checkbox
                  checked={option.requiresDetail}
                  onChange={(requiresDetail) => patchOption(option.id, { requiresDetail })}
                  label="Must be explained"
                />
              </div>
            </div>
          ))}

          <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.5 }}>
            {question.scoringMethod === 'RULE'
              ? 'Scores drive the rule — the highest choice sets the top of the scale.'
              : `Scored ${SCORING_LABELS[question.scoringMethod].split(' —')[0].toLowerCase()}, so choice scores are not read. Switch to rule scoring to use them.`}
            {question.isKnockout && ' A knockout fires only on the choices marked as failing.'}
          </div>
        </div>
      )}
    </div>
  );
}

/** A short editable list — grid columns, matrix rows. */
function StringListEditor({
  label, hint, addLabel, placeholder, values, onChange,
}: {
  label: string;
  hint?: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="small" onClick={() => onChange([...values, ''])}>
          ＋ {addLabel}
        </Button>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: color.textMuted, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>
      )}
      {values.length === 0 ? (
        <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 7 }}>None yet.</div>
      ) : (
        <div className="rfx-stack" style={{ gap: 6, marginTop: 8 }}>
          {values.map((value, index) => (
            <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <TextInput
                value={value}
                placeholder={placeholder}
                invalid={value.trim() === ''}
                onChange={(e) =>
                  onChange(values.map((existing, i) => (i === index ? e.target.value : existing)))
                }
              />
              <Button
                variant="icon"
                size="small"
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Templates visible at a lineage — the rail badge in the studio. */
export function templateCount(
  settings: Parameters<typeof resolveAccumulated>[1],
  lineage: ScopeLineage,
): number {
  return resolveAccumulated<QuestionnaireTemplate>(
    TEMPLATE_CUSTOM_KEY, settings, lineage,
  ).items.length;
}
