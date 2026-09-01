/**
 * Pack 04 — Create Event wizard.
 *
 * The stepper reshapes per journey pattern (4 steps to 9) without losing work:
 * `draft` is one object, and switching patterns only changes which steps are
 * shown, never what has been entered.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import {
  Button, Chip, Field, NumberInput, Radio, ReadOnlyValue, Segmented, Select,
  TextInput, Textarea, Toggle,
} from '../design-system/components/primitives';
import { Card, Stepper, Table, type Column } from '../design-system/components/layout';
import { AgentCard, Modal, ValidationList, type ValidationItem } from '../design-system/components/domain';
import { ALL_PATTERNS, JOURNEY_PATTERNS, patternsForSide } from '../domain/journeyPatterns';
import { mechanismGuidance } from '../domain/auctionEngine';
import { DEFAULT_ANTI_GAMING } from '../domain/auctionEngine';
import { directionLabel } from '../domain/comparator';
import {
  linesOfRequisition, sourcingRequisition, useStore, type AppState,
} from '../store/store';
import { suggestedTitle, toConsolidatedLines } from '../domain/sourcingRequisition';
import { categoriesOf } from '../domain/purchaseRequests';
import { COUNTERPARTIES } from '../data/seed';
import type {
  AuctionMechanism, FeedbackPolicy, JourneyPatternId, Lot, Side, SourcingEvent,
  SourcingRequisition,
} from '../domain/types';
import type { Route } from './AdminShell';

interface DraftLine {
  id: string;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  baselinePrice: number | null;
  lotName: string;
  /** Set when the line came from a requisition. PR line -> event line -> bid. */
  sourcePrLineId?: string;
  sourceRequestNumber?: string;
}

interface Draft {
  side: Side;
  pattern: JourneyPatternId;
  title: string;
  description: string;
  category: string;
  businessUnit: string;
  currency: string;
  /**
   * The consolidated demand this event is raised against. System-assigned and
   * read-only — a typed requisition reference cannot be walked back to lines.
   */
  sourceReference: string;
  sourceRequestNumbers: string[];
  lines: DraftLine[];
  bidderIds: string[];
  questionnaireTemplate: string;
  envelopeMode: 'SINGLE' | 'TWO_ENVELOPE';
  technicalGate: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
  minTechnicalScore: number;
  mechanism: AuctionMechanism;
  feedbackPolicy: FeedbackPolicy;
  minDecrement: number;
  softClose: boolean;
  closesInHours: number;
  termsAttached: boolean;
}

const INITIAL_DRAFT: Draft = {
  side: 'BUY',
  pattern: 'JP-02',
  title: '',
  description: '',
  category: 'Indirect',
  businessUnit: 'Corporate Services',
  currency: 'USD',
  sourceReference: '',
  sourceRequestNumbers: [],
  lines: [
    { id: 'dl-1', itemCode: 'PPR-A4-80', description: 'A4 copier paper, 80gsm, ream of 500', quantity: 12_000, uom: 'ream', baselinePrice: 8.67, lotName: 'Lot 1 · Paper' },
    { id: 'dl-2', itemCode: 'PEN-BLU-BX', description: 'Ballpoint pen, blue, box of 50', quantity: 900, uom: 'box', baselinePrice: 18.5, lotName: 'Lot 2 · Writing' },
  ],
  bidderIds: ['cp-abc', 'cp-global', 'cp-prime', 'cp-metro'],
  questionnaireTemplate: 'Office supplies — standard',
  envelopeMode: 'TWO_ENVELOPE',
  technicalGate: 'MIN_SCORE',
  minTechnicalScore: 60,
  mechanism: 'ENGLISH',
  feedbackPolicy: 'RANK_GAP',
  minDecrement: 1,
  softClose: true,
  closesInHours: 72,
  termsAttached: true,
};

/**
 * Build the opening draft from a consolidated demand. Everything the
 * requisitions already answered is answered here — category, business unit,
 * currency, the lines and their lotting — so the buyer is asked only for what
 * a requisition cannot know: the journey pattern, the bidders and the timings.
 */
function draftFromRequisition(
  requisition: SourcingRequisition,
  state: AppState,
): Draft {
  const lines = linesOfRequisition(state, requisition);
  const requests = state.purchaseRequests;
  const consolidated = toConsolidatedLines(lines, requests);

  return {
    ...INITIAL_DRAFT,
    title: suggestedTitle(lines, requests),
    description:
      `Raised against ${requisition.prdNumber}, consolidating ${lines.length} `
      + `${lines.length === 1 ? 'line' : 'lines'} from ${requisition.requestNumbers.join(', ')}.`,
    category: requisition.category,
    businessUnit: requisition.businessUnits[0] ?? INITIAL_DRAFT.businessUnit,
    currency: requisition.currency,
    sourceReference: requisition.prdNumber,
    sourceRequestNumbers: requisition.requestNumbers,
    lines: consolidated.map((l) => ({
      id: l.id, itemCode: l.itemCode, description: l.description,
      quantity: l.quantity, uom: l.uom, baselinePrice: l.baselinePrice,
      lotName: l.lotName, sourcePrLineId: l.sourcePrLineId,
      sourceRequestNumber: l.sourceRequestNumber,
    })),
  };
}

export function CreateEventWizard({
  onNavigate, prdId,
}: { onNavigate: (route: Route) => void; prdId?: string }) {
  const { state, dispatch } = useStore();
  const requisition = sourcingRequisition(state, prdId);

  const [draft, setDraft] = React.useState<Draft>(() =>
    requisition ? draftFromRequisition(requisition, state) : INITIAL_DRAFT,
  );
  const [step, setStep] = React.useState(0);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [switchWarning, setSwitchWarning] = React.useState<JourneyPatternId | null>(null);

  const pattern = JOURNEY_PATTERNS[draft.pattern];
  const steps = pattern.wizardSteps;
  const currentStep = Math.min(step, steps.length - 1);
  const stepName = steps[currentStep];

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  /**
   * Switching pattern keeps everything entered. Only the visible steps change,
   * so a warning is needed solely when a step's data would stop being used.
   */
  const applyPattern = (next: JourneyPatternId) => {
    const nextSteps = JOURNEY_PATTERNS[next].wizardSteps;
    const losesAuction = steps.includes('Auction') && !nextSteps.includes('Auction');
    const losesQuestionnaire = steps.includes('Questionnaire') && !nextSteps.includes('Questionnaire');
    if (losesAuction || losesQuestionnaire) {
      setSwitchWarning(next);
      return;
    }
    patch({ pattern: next, side: JOURNEY_PATTERNS[next].side === 'SELL' ? 'SELL' : draft.side });
    setStep(0);
  };

  const lotNames = [...new Set(draft.lines.map((l) => l.lotName))];
  const estimatedValue = draft.lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);

  const guidance = mechanismGuidance(draft.mechanism, draft.bidderIds.length, draft.lines.length);

  const validation: ValidationItem[] = [
    { tone: draft.title.trim() ? 'success' : 'info', text: draft.title.trim() ? `Title set — "${draft.title}"` : 'Event title is required' },
    { tone: 'success', text: `Pattern ${pattern.id} · ${pattern.name} · side ${draft.side} (${directionLabel(draft.side)})` },
    { tone: draft.lines.length > 0 ? 'success' : 'error', text: draft.lines.length > 0 ? `${draft.lines.length} lines across ${lotNames.length} lot(s)` : 'At least one lot with lines is required', blocking: draft.lines.length === 0 },
    {
      tone: draft.bidderIds.length >= 3 ? 'success' : 'warning',
      text: draft.bidderIds.length >= 3
        ? `${draft.bidderIds.length} bidders selected`
        : `Only ${draft.bidderIds.length} bidders — fewer than 3 yields no real competition`,
    },
    {
      tone: draft.closesInHours >= 48 ? 'success' : 'warning',
      text: draft.closesInHours >= 48
        ? `Responses close in ${draft.closesInHours}h`
        : `Deadline is only ${draft.closesInHours}h away — suppliers may not have time to price properly`,
    },
    {
      tone: draft.termsAttached ? 'success' : 'error',
      text: draft.termsAttached ? 'Terms & conditions attached' : 'Terms & conditions not attached',
      blocking: !draft.termsAttached,
    },
  ];

  const provisionalSelected = draft.bidderIds.filter(
    (id) => COUNTERPARTIES.find((c) => c.id === id)?.isProvisional,
  );

  const blocked = validation.some((v) => v.blocking);

  const publish = () => {
    const eventId = `evt-${Date.now()}`;
    const lots: Lot[] = lotNames.map((name, i) => ({
      id: `${eventId}-lot-${i + 1}`, eventId, lotNumber: i + 1, name,
      description: '', sequence: i + 1,
      biddingOpenAt: null, biddingCloseAt: Date.now() + draft.closesInHours * 3_600_000,
      awardMode: 'SINGLE', minSuppliers: 1, maxSuppliers: null,
      reservePrice: null, targetPrice: null, ceilingPrice: null, floorPrice: null,
      status: 'LOT_PENDING',
    }));
    const event: SourcingEvent = {
      id: eventId, tenantId: 'tenant-udaan',
      eventNumber: `${draft.pattern === 'JP-01' ? 'AUC' : 'RFQ'}-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      title: draft.title || 'Untitled event',
      description: draft.description,
      side: draft.side, templateId: null, journeyPattern: draft.pattern,
      businessUnit: draft.businessUnit, category: draft.category,
      project: null, costCentre: null, currency: draft.currency,
      estimatedValue, ownerId: state.currentUser.id,
      status: 'PUBLISHED', createdFrom: draft.sourceReference ? 'PR' : 'MANUAL',
      sourceReference: draft.sourceReference || null,
      stagesEnabled: pattern.stages, currentStage: pattern.stages[0],
      envelopeMode: draft.envelopeMode, vendorInputPoints: pattern.vendorInputPoints,
      publishedAt: Date.now(), closesAt: Date.now() + draft.closesInHours * 3_600_000,
      awardedAt: null, parentEventId: null, version: 1,
      // The resolved configuration is frozen at publish so a historical event
      // stays reconstructable after config changes.
      configSnapshotAtPublish: {
        feedbackPolicy: draft.feedbackPolicy,
        mechanism: draft.mechanism,
        envelopeMode: draft.envelopeMode,
        minDecrement: draft.minDecrement,
      },
    };
    dispatch({
      type: 'CREATE_EVENT', event, lots,
      // The lines this event was raised for leave the sourceable pool in the
      // same dispatch that creates it.
      sourcedLineIds: draft.lines
        .map((l) => l.sourcePrLineId)
        .filter((id): id is string => id !== undefined),
      sourcingRequisitionId: requisition?.id,
    });
    setPublishOpen(false);
    onNavigate({ name: 'event', eventId });
  };

  return (
    <div className="rfx-side" style={{ gap: 16 }}>
      <div className="rfx-stack" style={{ gap: 14 }}>
        <Card padded={false}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${color.border}` }}>
            <Stepper steps={steps} current={currentStep} onGo={setStep} />
          </div>
          <div style={{ padding: 18 }}>
            {stepName === 'Basics' && (
              <BasicsStep
                draft={draft}
                patch={patch}
                applyPattern={applyPattern}
                requisition={requisition}
              />
            )}
            {stepName === 'Items & Lots' && (
              <ItemsStep draft={draft} patch={patch} estimatedValue={estimatedValue} />
            )}
            {stepName === 'Bidders' && (
              <BiddersStep draft={draft} patch={patch} provisionalSelected={provisionalSelected} />
            )}
            {stepName === 'Questionnaire' && <QuestionnaireStep draft={draft} patch={patch} />}
            {stepName === 'Terms' && <TermsStep draft={draft} patch={patch} />}
            {stepName === 'Evaluation' && <EvaluationStep draft={draft} patch={patch} />}
            {stepName === 'Auction' && (
              <AuctionStep draft={draft} patch={patch} guidance={guidance} />
            )}
            {stepName === 'Timeline' && <TimelineStep draft={draft} patch={patch} />}
            {stepName === 'Review' && (
              <ReviewStep draft={draft} pattern={pattern.name} estimatedValue={estimatedValue} lotNames={lotNames} />
            )}
          </div>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              padding: '12px 16px', borderTop: `1px solid ${color.border}`,
            }}
          >
            <Button variant="tertiary" onClick={() => onNavigate({ name: 'board' })}>Cancel</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" disabled={currentStep === 0} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              {currentStep < steps.length - 1 ? (
                <Button variant="primary" onClick={() => setStep((s) => s + 1)}>Next</Button>
              ) : (
                <Button variant="primary" disabled={blocked} onClick={() => setPublishOpen(true)}>
                  Publish event
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <Card title="Readiness" hint="Blocking items must clear before publish.">
          <ValidationList items={validation} />
        </Card>

        <Card title="Pattern shape">
          <div className="rfx-stack" style={{ gap: 7 }}>
            {pattern.stages.map((stage, i) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span
                  aria-hidden
                  style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    background: color.brandPrimarySoft, color: color.brandPrimary,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                {stage}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
              Suppliers give input at: {pattern.vendorInputPoints.join(', ') || 'no stage'}.
              Typical duration {pattern.typicalDuration}.
            </div>
          </div>
        </Card>

        <AgentCard
          code="AG-01"
          name="Intake & Event Setup"
          autonomy="DRAFT"
          confidence={0.82}
          summary={`This requisition matches 6 prior events in ${draft.category}. Simple RFQ (JP-02) closed those in 3 days at a 4.1% average saving; the pattern here is a reasonable default.`}
          evidence={[
            { label: 'PR-2024-0125', detail: '2 lines, 12,900 units, indicative $150,000' },
            { label: '6 prior events', detail: 'Indirect / office supplies, last 18 months' },
            { label: 'Category default', detail: 'Simple RFQ set at category scope' },
          ]}
          onAccept={() => applyPattern('JP-02')}
          onReject={() => undefined}
        />
      </div>

      <Modal
        open={publishOpen}
        title="Publish this event?"
        onClose={() => setPublishOpen(false)}
        onConfirm={publish}
        confirmLabel="Publish"
      >
        <p style={{ margin: '0 0 10px' }}>
          Publishing sends invitations to {draft.bidderIds.length} bidders and freezes the resolved
          configuration onto the event.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><strong>{draft.title || 'Untitled event'}</strong> — {pattern.name}</li>
          <li>Side <strong>{draft.side}</strong> — {directionLabel(draft.side)}. This cannot be changed later.</li>
          <li>{draft.lines.length} lines across {lotNames.length} lot(s), est. {money(estimatedValue)}</li>
          <li>Responses close in {draft.closesInHours}h</li>
        </ul>
      </Modal>

      <Modal
        open={switchWarning !== null}
        title="Change journey pattern?"
        onClose={() => setSwitchWarning(null)}
        onConfirm={() => {
          if (switchWarning) {
            patch({
              pattern: switchWarning,
              side: JOURNEY_PATTERNS[switchWarning].side === 'SELL' ? 'SELL' : draft.side,
            });
            setStep(0);
          }
          setSwitchWarning(null);
        }}
        confirmLabel="Change pattern"
      >
        <p style={{ margin: 0 }}>
          {switchWarning && JOURNEY_PATTERNS[switchWarning].name} has fewer steps than{' '}
          {pattern.name}. Nothing you have entered is deleted — the steps that no longer apply
          are simply not shown, and their values are kept in case you switch back.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function BasicsStep({
  draft, patch, applyPattern, requisition,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  applyPattern: (p: JourneyPatternId) => void;
  requisition?: SourcingRequisition;
}) {
  const { state } = useStore();

  // A prefilled category or business unit must be selectable, so the option
  // lists are the union of the standard set and whatever the demand carries.
  const categories = [...new Set([
    ...categoriesOf(state.purchaseRequests),
    'Indirect', 'IT', 'Facilities', 'Services', 'Fleet',
    draft.category,
  ])].sort();
  const businessUnits = [...new Set([
    ...state.purchaseRequests.map((r) => r.businessUnit),
    'Corporate Services', 'Technology', 'Marketing', 'Fleet',
    draft.businessUnit,
  ])].sort();

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      {requisition && (
        <div
          style={{
            border: `1px solid ${color.brandPrimary}`, background: color.brandPrimarySoft,
            borderRadius: radius.control, padding: '11px 13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12.5, color: color.brandPrimary }}>
              {requisition.prdNumber}
            </strong>
            <span style={{ fontSize: 11.5, color: color.textSecondary }}>
              consolidates {requisition.lineIds.length} lines from{' '}
              {requisition.requestNumbers.length} requisitions
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
            {requisition.requestNumbers.map((number) => (
              <Chip key={number} tone="brand">{number}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 8, lineHeight: 1.55 }}>
            Category, business unit, currency and every line below came from these requisitions.
            The event carries one source reference — the PRD — and the PRD carries the RQ numbers,
            so an award line can be walked back to the requisition line that asked for it.
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Side</div>
        <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 8 }}>
          Set once, immutable after creation. It drives every comparator in the system.
        </div>
        <Segmented
          value={draft.side}
          onChange={(side) => patch({ side, pattern: side === 'SELL' ? 'JP-12' : 'JP-02' })}
          options={[
            { value: 'BUY', label: 'Buy — lowest wins' },
            { value: 'SELL', label: 'Sell — highest wins' },
          ]}
        />
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Journey pattern</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(215px, 100%), 1fr))', gap: 9 }}>
          {patternsForSide(draft.side).map((p) => (
            <Radio
              key={p.id}
              checked={draft.pattern === p.id}
              onChange={() => applyPattern(p.id)}
              label={`${p.name} (${p.wizardSteps.length} steps)`}
              hint={`${p.description} · ${p.typicalDuration}`}
            />
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: color.textSecondary }}>
          {ALL_PATTERNS.length} patterns configured. Patterns for the other side are hidden rather than disabled.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 12 }}>
        <Field label="Event title" required>
          <TextInput
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Office Supplies Annual Contract"
          />
        </Field>
        <Field
          label="Category"
          hint={requisition ? `Populated from ${requisition.prdNumber}.` : undefined}
        >
          <Select value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field
          label="Business unit"
          hint={
            requisition && requisition.businessUnits.length > 1
              ? `${requisition.businessUnits.length} units in the demand — the DoA chain resolves against this one.`
              : requisition ? `Populated from ${requisition.prdNumber}.` : undefined
          }
        >
          <Select value={draft.businessUnit} onChange={(e) => patch({ businessUnit: e.target.value })}>
            {businessUnits.map((b) => <option key={b}>{b}</option>)}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={draft.currency} onChange={(e) => patch({ currency: e.target.value })}>
            {['USD', 'EUR', 'GBP', 'INR', 'AED'].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field
          label="Source requisition"
          hint={
            draft.sourceReference
              ? 'System-assigned. Every award line ties back through it to a requisition line.'
              : 'Assigned when the event is raised from a requisition basket.'
          }
          lockedBy={draft.sourceReference ? 'system' : undefined}
        >
          <ReadOnlyValue mono>
            {draft.sourceReference || 'Not raised against a requisition'}
          </ReadOnlyValue>
        </Field>
      </div>

      <Field label="Description">
        <Textarea rows={3} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
      </Field>
    </div>
  );
}

function ItemsStep({
  draft, patch, estimatedValue,
}: { draft: Draft; patch: (p: Partial<Draft>) => void; estimatedValue: number }) {
  const sourced = draft.lines.filter((l) => l.sourcePrLineId !== undefined).length;

  const columns: Column<DraftLine>[] = [
    { key: 'code', header: 'Code', render: (l) => <span style={{ fontSize: 11.5, color: color.textSecondary }}>{l.itemCode}</span> },
    { key: 'desc', header: 'Description', render: (l) => l.description },
    {
      key: 'from', header: 'From', width: '150px',
      render: (l) =>
        l.sourceRequestNumber
          ? <Chip tone="neutral" title="The requisition this line came from">{l.sourceRequestNumber}</Chip>
          : <span style={{ color: color.textMuted, fontSize: 11.5 }}>added here</span>,
    },
    { key: 'qty', header: 'Qty', numeric: true, render: (l) => l.quantity.toLocaleString() },
    { key: 'uom', header: 'UoM', render: (l) => l.uom },
    {
      key: 'baseline', header: 'Baseline', numeric: true,
      render: (l) => (l.baselinePrice === null ? <span style={{ color: color.textMuted }}>—</span> : money(l.baselinePrice)),
    },
    {
      key: 'lot', header: 'Lot',
      render: (l) => (
        <Select
          value={l.lotName}
          onChange={(e) =>
            patch({ lines: draft.lines.map((x) => (x.id === l.id ? { ...x, lotName: e.target.value } : x)) })
          }
          style={{ width: 150, fontSize: 12 }}
        >
          {[...new Set(draft.lines.map((x) => x.lotName))].sort().map((n) => (
            <option key={n}>{n}</option>
          ))}
        </Select>
      ),
    },
    {
      key: 'extended', header: 'Extended', numeric: true,
      render: (l) => <strong>{money((l.baselinePrice ?? 0) * l.quantity)}</strong>,
    },
    {
      key: 'remove', header: '', width: '44px',
      render: (l) => (
        <Button
          variant="icon"
          aria-label={`Remove ${l.description}`}
          onClick={() => patch({ lines: draft.lines.filter((x) => x.id !== l.id) })}
        >
          ✕
        </Button>
      ),
    },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <div style={{ fontSize: 12.5, color: color.textSecondary }}>
        A lot is a group of lines bid, ranked and awarded as a unit. Lines carry their baseline and
        its source, which is what the savings engine later reports against.
      </div>
      {sourced > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            border: `1px solid ${color.border}`, borderRadius: radius.control,
            padding: '9px 12px', fontSize: 12, background: color.surface,
          }}
        >
          <strong>{sourced} of {draft.lines.length} lines came from requisitions</strong>
          <span style={{ color: color.textMuted }}>·</span>
          <span style={{ color: color.textSecondary }}>
            lotted by item family, so like competes with like
          </span>
          <span style={{ flex: 1 }} />
          {[...new Set(draft.lines.map((l) => l.lotName))].sort().map((name) => (
            <Chip key={name} tone="brand">
              {name} ({draft.lines.filter((l) => l.lotName === name).length})
            </Chip>
          ))}
        </div>
      )}
      <Table columns={columns} rows={draft.lines} rowKey={(l) => l.id} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Button
          variant="secondary"
          onClick={() =>
            patch({
              lines: [
                ...draft.lines,
                {
                  id: `dl-${Date.now()}`, itemCode: 'NEW-000', description: 'New line',
                  quantity: 1, uom: 'each', baselinePrice: null, lotName: draft.lines[0]?.lotName ?? 'Lot 1',
                },
              ],
            })
          }
        >
          ＋ Add line
        </Button>
        <div style={{ fontSize: 13 }}>
          Estimated value <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(estimatedValue)}</strong>
        </div>
      </div>
    </div>
  );
}

function BiddersStep({
  draft, patch, provisionalSelected,
}: { draft: Draft; patch: (p: Partial<Draft>) => void; provisionalSelected: string[] }) {
  const toggle = (id: string) =>
    patch({
      bidderIds: draft.bidderIds.includes(id)
        ? draft.bidderIds.filter((x) => x !== id)
        : [...draft.bidderIds, id],
    });

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <div style={{ fontSize: 12.5, color: color.textSecondary }}>
        Onboarding rating and performance rating are two different things and are shown separately —
        a compliant new supplier can rate high on one and have no history on the other.
      </div>
      <div className="rfx-stack" style={{ gap: 8 }}>
        {COUNTERPARTIES.map((cp) => {
          const selected = draft.bidderIds.includes(cp.id);
          return (
            <div
              key={cp.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                border: `1px solid ${selected ? color.brandPrimary : color.border}`,
                background: selected ? '#F5F8FF' : '#fff',
                borderRadius: radius.control, padding: '10px 13px',
              }}
            >
              <Toggle checked={selected} onChange={() => toggle(cp.id)} label="" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{cp.name}</span>
                  {cp.isProvisional && (
                    <Chip tone="gold" icon="⚑" title="Not yet on the vendor master">provisional</Chip>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                  {cp.categoriesServed.join(', ')} · {cp.locationsServed.join(', ')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, textAlign: 'right' }}>
                <div>
                  <div style={{ fontSize: 10, color: color.textSecondary }}>Onboarding</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: color.infoText }}>{cp.onboardingRating}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: color.textSecondary }}>Performance</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: cp.performanceRating === 0 ? color.textMuted : color.accentPurpleText }}>
                    {cp.performanceRating === 0 ? 'no history' : cp.performanceRating}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {provisionalSelected.length > 0 && (
        <div
          style={{
            background: color.warningSoft, border: '1px solid #FCD34D',
            borderRadius: radius.control, padding: '9px 12px', fontSize: 12, color: color.warningText,
          }}
        >
          <strong>{provisionalSelected.length} provisional counterparty selected.</strong>{' '}
          A provisional supplier can bid, but cannot be awarded until onboarding completes — the award
          will hold at <em>Award pending onboarding</em>.
        </div>
      )}
    </div>
  );
}

function QuestionnaireStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Field label="Questionnaire template">
        <Select value={draft.questionnaireTemplate} onChange={(e) => patch({ questionnaireTemplate: e.target.value })}>
          {['Office supplies — standard', 'IT hardware — two envelope', 'Services — capability led', 'Blank'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Field>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Envelope mode</div>
        <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 8 }}>
          Envelopes are a permissions boundary, not a layout preference. Under two-envelope mode a
          technical evaluator cannot hold commercial visibility on the same event.
        </div>
        <Segmented
          value={draft.envelopeMode}
          onChange={(envelopeMode) => patch({ envelopeMode })}
          options={[
            { value: 'TWO_ENVELOPE', label: 'Two envelope' },
            { value: 'SINGLE', label: 'Single' },
          ]}
        />
      </div>
      <div style={{ fontSize: 12, color: color.textSecondary }}>
        The full question set — types, weights, envelope assignment and scoring rules — is built in the
        form builder on the event workspace once the event exists.
      </div>
    </div>
  );
}

function TermsStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <Toggle
        checked={draft.termsAttached}
        onChange={(termsAttached) => patch({ termsAttached })}
        label="Standard terms & conditions attached"
      />
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        Publishing without terms is blocked, not warned. Deviations a bidder proposes are captured
        against the clause and surface on the NFA as a deviation, so an approver sees them.
      </div>
    </div>
  );
}

function EvaluationStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
        <Field label="Technical gate">
          <Select
            value={draft.technicalGate}
            onChange={(e) => patch({ technicalGate: e.target.value as Draft['technicalGate'] })}
          >
            <option value="NONE">None</option>
            <option value="MIN_SCORE">Minimum score</option>
            <option value="PASS_FAIL">Pass / fail</option>
            <option value="BOTH">Both</option>
          </Select>
        </Field>
        <Field label="Minimum technical score" hint="Bidders below this do not reach commercial comparison.">
          <NumberInput
            value={draft.minTechnicalScore}
            onChange={(e) => patch({ minTechnicalScore: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        Award-score weights are set on the event's evaluation tab, where the UI validates that price
        contributes to exactly one component. A model that lets price appear twice is rejected.
      </div>
    </div>
  );
}

function AuctionStep({
  draft, patch, guidance,
}: {
  draft: Draft; patch: (p: Partial<Draft>) => void;
  guidance: { recommendation: string | null; warnings: string[] };
}) {
  const mechanisms: { key: AuctionMechanism; name: string; desc: string; off?: boolean }[] = [
    { key: 'ENGLISH', name: 'English', desc: `Open bidding until no one improves — ${directionLabel(draft.side)}.` },
    { key: 'JAPANESE', name: 'Japanese', desc: 'System clock moves in steps; bidders stay in or drop.' },
    { key: 'DUTCH', name: 'Dutch', desc: `System clock ${draft.side === 'BUY' ? 'rises' : 'falls'} until a bidder accepts.` },
    { key: 'SEALED_BID', name: 'Sealed bid', desc: 'All bids hidden until the reveal time.' },
    { key: 'RANK_COMPRESSION', name: 'Rank compression', desc: 'Only rank is shown; gaps compress as the field converges.' },
    { key: 'MULTI_ATTRIBUTE', name: 'Multi-attribute', desc: 'Price and non-price attributes on published weights.' },
    { key: 'PORTFOLIO', name: 'Portfolio', desc: 'Bidders bid across lots; the best combination wins.' },
    { key: 'INDEX_LINKED', name: 'Index-linked', desc: 'Bids expressed as an offset to a market index.' },
    { key: 'TRAFFIC_LIGHT', name: 'Traffic light', desc: 'A feedback policy expressed as a mechanism.' },
    { key: 'VICKREY', name: 'Vickrey', desc: 'Sealed; the winner pays the second price. Off by default.', off: true },
  ];

  const policies: { key: FeedbackPolicy; name: string; desc: string }[] = [
    { key: 'FULL_PRICE', name: 'Full price', desc: "Every competitor's exact number." },
    { key: 'BEST_PRICE', name: 'Best price', desc: 'Only the current leading price.' },
    { key: 'RANK_ONLY', name: 'Rank only', desc: 'Their position, no numbers.' },
    { key: 'RANK_GAP', name: 'Rank + gap %', desc: 'Position and how far behind, as a percentage.' },
    { key: 'TRAFFIC_LIGHT', name: 'Traffic light', desc: 'Colour against your target — no numbers.' },
    { key: 'BLIND', name: 'Blind', desc: 'Nothing until reveal.' },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Mechanism</div>
        <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 9 }}>
          Direction is derived from side and clock owner, never typed. On a {draft.side} event this
          means {directionLabel(draft.side)}.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(205px, 100%), 1fr))', gap: 8 }}>
          {mechanisms.map((m) => (
            <Radio
              key={m.key}
              checked={draft.mechanism === m.key}
              onChange={() => patch({ mechanism: m.key })}
              label={m.name}
              hint={m.desc}
              disabled={m.off && draft.mechanism !== m.key}
            />
          ))}
        </div>
      </div>

      {guidance.warnings.length > 0 && (
        <div
          style={{
            background: color.warningSoft, border: '1px solid #FCD34D',
            borderRadius: radius.control, padding: '9px 12px',
          }}
        >
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: color.warningText, lineHeight: 1.6 }}>
            {guidance.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Feedback policy</div>
        <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 9 }}>
          The single biggest determinant of bidder behaviour, and a data boundary: the server sends a
          bidder only what the policy permits.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(205px, 100%), 1fr))', gap: 8 }}>
          {policies.map((p) => (
            <Radio
              key={p.key}
              checked={draft.feedbackPolicy === p.key}
              onChange={() => patch({ feedbackPolicy: p.key })}
              label={p.name}
              hint={p.desc}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12 }}>
        <Field label={`Minimum ${draft.side === 'BUY' ? 'decrement' : 'increment'} (%)`} hint="Prevents penny bidding.">
          <NumberInput value={draft.minDecrement} step="0.1" onChange={(e) => patch({ minDecrement: Number(e.target.value) })} />
        </Field>
        <Field label="Soft close" hint={`Any bid in the last ${DEFAULT_ANTI_GAMING.softCloseTriggerSec}s extends the clock.`}>
          <Toggle checked={draft.softClose} onChange={(softClose) => patch({ softClose })} label={draft.softClose ? 'On' : 'Off — sniping is possible'} />
        </Field>
      </div>
    </div>
  );
}

function TimelineStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  return (
    <div className="rfx-stack" style={{ gap: 12, maxWidth: 420 }}>
      <Field
        label="Responses close in (hours)"
        warning={draft.closesInHours < 48 ? 'Under 48 hours leaves little time to price properly.' : undefined}
      >
        <NumberInput value={draft.closesInHours} onChange={(e) => patch({ closesInHours: Number(e.target.value) })} />
      </Field>
      <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
        A corrigendum published later reopens this deadline by default and notifies every bidder on
        email, in-app and SMS.
      </div>
    </div>
  );
}

function ReviewStep({
  draft, pattern, estimatedValue, lotNames,
}: { draft: Draft; pattern: string; estimatedValue: number; lotNames: string[] }) {
  const rows: [string, React.ReactNode][] = [
    ['Title', draft.title || <em style={{ color: color.textMuted }}>not set</em>],
    ['Pattern', pattern],
    ['Side', `${draft.side} — ${directionLabel(draft.side)}`],
    ['Category / BU', `${draft.category} · ${draft.businessUnit}`],
    ['Lines / lots', `${draft.lines.length} lines across ${lotNames.length} lot(s)`],
    ['Estimated value', money(estimatedValue, draft.currency)],
    ['Bidders', `${draft.bidderIds.length} invited`],
    ['Envelope mode', draft.envelopeMode],
    ['Auction mechanism', draft.mechanism],
    ['Feedback policy', draft.feedbackPolicy],
    ['Source requisition', draft.sourceReference || '—'],
  ];
  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <div style={{ fontSize: 12.5, color: color.textSecondary }}>
        On publish, the resolved configuration is snapshotted onto the event so this event stays
        reconstructable even after tenant configuration changes.
      </div>
      <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className="rfx-defrow-wide"
            style={{
              padding: '9px 13px', fontSize: 12.5,
              borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
              background: i % 2 === 0 ? '#fff' : '#FCFCFD',
            }}
          >
            <span style={{ color: color.textSecondary }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
