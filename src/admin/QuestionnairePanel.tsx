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
  POINT_PURPOSE, PRICED_QUESTION_TYPES, TEMPLATE_CUSTOM_KEY, TEMPLATE_STATUS_LABELS,
  TEMPLATE_WEIGHTING_KEY, VENDOR_INPUT_POINTS, emptyTemplate, inheritedCodes, newQuestion,
  nextTemplateId, normalise, pointLabel, questionsInSection, scoredQuestions, suggestCode,
  templateWeight, templatesFor, validateTemplate, validateWeighting, weightingForJourney,
} from '../domain/questionnaireTemplates';
import { serverNow } from '../server/clock';
import { useStore } from '../store/store';
import type {
  ConfigScopeType, Id, JourneyPatternId, QuestionConfig, QuestionOption, QuestionType,
  QuestionnaireTemplate, ScoringMethod, StageWeight, TemplateQuestion, TemplateStatus,
  VendorInputPoint,
} from '../domain/types';

const SCORING_LABELS: Record<ScoringMethod, string> = {
  NONE: 'Not scored',
  MANUAL: 'Manual — evaluator scores against the rubric',
  RULE: 'Rule — auto-computed, read only',
  AI_ASSISTED: 'AI assisted — agent proposes, human decides',
  AI_AUTO: 'AI auto — agent writes, degrades below confidence',
};

export function QuestionnairePanel({
  scope, lineage,
}: { scope: ConfigScopeType; lineage: ScopeLineage }) {
  const { state, dispatch } = useStore();

  const [pane, setPane] = React.useState<'weighting' | 'library'>('weighting');
  const [editing, setEditing] = React.useState<QuestionnaireTemplate | null>(null);
  const [inspecting, setInspecting] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
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

  const startNew = () => {
    if (scopeId === null) return;
    setEditing(emptyTemplate({
      id: nextTemplateId(templates), scopeType: scope, scopeId,
      userId: state.currentUser.id, now: serverNow(),
    }));
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
          templates={templates}
          canAuthor={scopeId !== null}
          onNew={startNew}
          onEdit={setEditing}
          onDuplicate={duplicate}
          onInspect={setInspecting}
          onDelete={setDeleteId}
        />
      )}

      <TemplateInspector template={inspected} onClose={() => setInspecting(null)} />

      {editing && (
        <TemplateBuilder
          template={editing}
          takenNames={templates.filter((t) => t.id !== editing.id).map((t) => t.name)}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={saveTemplate}
        />
      )}

      <Modal
        open={deleteId !== null}
        title="Delete this template?"
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          writeTemplates(authoredHere.filter((t) => t.id !== deleteId));
          setDeleteId(null);
        }}
        confirmLabel="Delete template"
        confirmTone="destructive"
      >
        Events already using it keep the questionnaire they were created with — a template is copied
        onto the event, not referenced. Deleting it only stops new events from selecting it. Retiring
        it instead keeps it visible in the library and out of new events.
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

function TemplateLibrary({
  scope, templates, canAuthor, onNew, onEdit, onDuplicate, onInspect, onDelete,
}: {
  scope: ConfigScopeType;
  templates: QuestionnaireTemplate[];
  canAuthor: boolean;
  onNew: () => void;
  onEdit: (t: QuestionnaireTemplate) => void;
  onDuplicate: (t: QuestionnaireTemplate) => void;
  onInspect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
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
        <Chip tone={t.scopeType === scope ? 'brand' : 'neutral'}>
          {SCOPE_LABELS[t.scopeType]}
        </Chip>
      ),
    },
    {
      key: 'actions', header: '', width: '190px',
      render: (t) => (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
          <Button variant="tertiary" size="small" onClick={() => onInspect(t.id)}>Inspect</Button>
          <Button
            variant="tertiary"
            size="small"
            disabled={t.scopeType !== scope}
            onClick={() => onEdit(t)}
          >
            Edit
          </Button>
          <Button variant="tertiary" size="small" disabled={!canAuthor} onClick={() => onDuplicate(t)}>
            Copy
          </Button>
          {t.scopeType === scope && (
            <Button variant="icon" size="small" aria-label={`Delete ${t.name}`} onClick={() => onDelete(t.id)}>
              🗑
            </Button>
          )}
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
        <Button variant="primary" size="small" disabled={!canAuthor} onClick={onNew}>
          New template
        </Button>
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
  template, onClose,
}: { template: QuestionnaireTemplate | null; onClose: () => void }) {
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
      </div>
    </div>
  );
}

function QuestionRow({ question }: { question: TemplateQuestion }) {
  const priced = PRICED_QUESTION_TYPES.includes(question.type);
  const format = formatSummary(question);
  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '8px 11px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: color.textMuted }}>{question.sequence}</span>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{question.title}</span>
        {question.isRequired && <span style={{ color: color.danger, fontSize: 12 }}>*</span>}
        <Chip tone={question.envelope === 'COMMERCIAL' ? 'purple' : question.envelope === 'TECHNICAL' ? 'info' : 'neutral'}>
          {question.envelope.toLowerCase()}
        </Chip>
        <Chip tone="neutral">{typeLabel(question.type)}</Chip>
        {question.isKnockout && <Chip tone="danger" icon="✕">knockout</Chip>}
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

function TemplateBuilder({
  template, takenNames, onChange, onClose, onSave,
}: {
  template: QuestionnaireTemplate;
  takenNames: string[];
  onChange: (next: QuestionnaireTemplate) => void;
  onClose: () => void;
  onSave: (t: QuestionnaireTemplate) => void;
}) {
  const [selectedId, setSelectedId] = React.useState<Id | null>(null);
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

  const addSection = () => {
    const sequence = template.sections.length + 1;
    patch({
      sections: [
        ...template.sections,
        { id: `${template.id}-sec-${sequence}`, name: `Section ${sequence}`, sequence },
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!validation.valid} onClick={() => onSave(template)}>
            Save template
          </Button>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
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
          <Field label="Categories" hint="Comma separated. Empty means every category.">
            <TextInput
              value={template.categories.join(', ')}
              placeholder="Indirect, IT Hardware"
              onChange={(e) =>
                patch({
                  categories: e.target.value.split(',').map((c) => c.trim()).filter(Boolean),
                })
              }
            />
          </Field>
        </div>

        {/* Questions, grouped by section. */}
        {template.sections.map((section) => {
          const questions = questionsInSection(template, section.id);
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
              hint={`${questions.length} question(s)`}
              action={
                <Button variant="secondary" size="small" onClick={() => addQuestion(section.id)}>
                  ＋ Question
                </Button>
              }
            >
              {questions.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 12, color: color.textMuted }}>
                  No questions in this section yet.
                </div>
              ) : (
                <div>
                  {questions.map((question, i) => (
                    <div
                      key={question.id}
                      style={{
                        borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                        borderLeft: `3px solid ${selectedId === question.id ? color.brandPrimary : 'transparent'}`,
                        background: selectedId === question.id ? '#F5F8FF' : '#fff',
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
                          <QuestionRow question={question} />
                        </button>
                        <Button
                          variant="icon"
                          size="small"
                          aria-label={`Remove ${question.title}`}
                          onClick={() =>
                            patch({ questions: template.questions.filter((q) => q.id !== question.id) })
                          }
                        >
                          ✕
                        </Button>
                      </div>

                      {selectedId === question.id && (
                        <QuestionEditor
                          question={question}
                          sections={template.sections}
                          onChange={(next) => patchQuestion(question.id, next)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        <Button variant="secondary" onClick={addSection}>＋ Add section</Button>
      </div>
    </Drawer>
  );
}

function QuestionEditor({
  question, sections, onChange,
}: {
  question: TemplateQuestion;
  sections: QuestionnaireTemplate['sections'];
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 10 }}>
        <Field label="Title" required>
          <TextInput value={question.title} onChange={(e) => onChange({ title: e.target.value })} />
        </Field>
        <Field label="Code" hint="Reuse a code across stages to carry the answer forward.">
          <TextInput value={question.code} onChange={(e) => onChange({ code: e.target.value })} />
        </Field>
        <Field label="Type" hint={QUESTION_TYPE_SPEC[question.type].asks}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 10 }}>
        <Field
          label="Weight"
          hint={priced ? 'A priced question carries no weight, by rule.' : 'Relative, not a percentage.'}
          lockedBy={priced ? 'the price rule' : undefined}
        >
          <NumberInput
            value={question.weight}
            disabled={priced}
            onChange={(e) => onChange({ weight: Math.max(0, Number(e.target.value)) })}
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
