/**
 * Pack 04 — Create Event wizard.
 *
 * The stepper reshapes per journey pattern (4 steps to 9) without losing work:
 * `draft` is one object, and switching patterns only changes which steps are
 * shown, never what has been entered.
 */
import React from 'react';
import { BASE_CURRENCY, color, money, radius } from '../design-system/tokens';
import {
  Button, Checkbox, Chip, Field, NumberInput, Radio, ReadOnlyValue, SectionHeading, Segmented, Select, TextInput, Textarea, Toggle,
} from '../design-system/components/primitives';
import { Card, Stepper, Table, type Column } from '../design-system/components/layout';
import {
  AgentCard, Modal, ValidationBanner, ValidationList, type ValidationItem,
} from '../design-system/components/domain';
import { resolveAccumulated } from '../domain/config';
import { QUESTION_TYPES_BY_GROUP, typeLabel } from '../domain/questionTypes';
import {
  POINT_PURPOSE, PRICED_QUESTION_TYPES, TEMPLATE_CUSTOM_KEY, addDraftQuestion,
  blankQuestionnaire, draftAsTemplate, instantiateTemplate, isScored, moveDraftQuestion,
  normalise, pointLabel, removeDraftQuestion, removeDraftSection, renameDraftSection,
  addDraftSection, seedQuestionnaires, setDraftScored, setDraftType, templateWeight,
  templatesFor, validateTemplate, type DraftQuestionnaire,
} from '../domain/questionnaireTemplates';
import {
  ALL_PATTERNS, JOURNEY_PATTERNS, STAGE_LABELS, patternsForSide,
} from '../domain/journeyPatterns';
import { mechanismGuidance } from '../domain/auctionEngine';
import { DEFAULT_ANTI_GAMING } from '../domain/auctionEngine';
import { directionLabel } from '../domain/comparator';
import {
  auctionRecords, linesOfRequisition, sourcingRequisition, useStore, type AppState,
} from '../store/store';
import { ApiError, sourcingApi } from '../api/client';
import {
  solicitationStagesOf, stageWindows, type SolicitationStage, type SourcingEventInput,
} from '../domain/stageEvents';
import {
  DEFAULT_TIMELINE_RULES, EXTENSION_REASON_LABEL, NOTIFY_AUDIENCE_LABEL, NOTIFY_CHANNEL_LABEL,
  daysBetween, describeRules, roundToNextHour, validateSchedule,
  type NotifyAudience, type NotifyChannel, type TimelineRules,
} from '../domain/eventTimeline';
import {
  ACKNOWLEDGEMENT_LABEL, DEFAULT_PAYMENT_TERMS, PAYMENT_TRIGGER_LABEL,
  TERMS_CATEGORIES, TERMS_CATEGORY_LABEL, TERMS_CATEGORY_PURPOSE, alignTermsToJourney,
  blankTerms, describeTerms, instantiateTerms, paymentSummary, validateTerms,
  type Acknowledgement, type PaymentTerms, type TermsCategory, type TermsDocumentInput,
} from '../domain/terms';
import { TERMS_TEMPLATES } from '../data/termsTemplates';
import { suggestedTitle, toConsolidatedLines } from '../domain/sourcingRequisition';
import { categoriesOf } from '../domain/purchaseRequests';
import {
  MIN_BIDDERS_PER_CATEGORY, defaultShortlist, suggestBidders, validateCoverage,
} from '../domain/bidders';
import { COUNTERPARTIES, SCOPE_LINEAGE } from '../data/seed';
import type {
  AuctionMechanism, FeedbackPolicy, JourneyPatternId, QuestionEnvelope, QuestionnaireTemplate,
  Side, SourcingRequisition, VendorInputPoint,
} from '../domain/types';
import type { Counterparty } from '../domain/types';
import type { Route } from './AdminShell';

interface DraftLine {
  id: string;
  itemCode: string;
  description: string;
  /** What the line asks for beyond its description. Empty on a typed line. */
  specification: string;
  quantity: number;
  uom: string;
  deliveryLocation: string;
  /** ISO date the requisition needs it by, or '' when nobody has said. */
  needBy: string;
  baselinePrice: number | null;
  lotName: string;
  /**
   * The category this line was requisitioned under. A consolidated event can
   * span several, and the bidder shortlist is built per category — so the
   * category has to travel with the line, not just sit on the event.
   */
  category: string;
  superCategory: string | null;
  /** Set when the line came from a requisition. PR line -> event line -> bid. */
  sourcePrLineId?: string;
  sourceRequestNumber?: string;
}

export interface Draft {
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
  /**
   * Bidders per category. One flat list across a consolidated event would ask
   * a laptop supplier to price hydraulic pumps, so the shortlist is scoped to
   * the lines it can actually bid on.
   */
  bidderIdsByCategory: Record<string, string[]>;
  /**
   * One questionnaire per point in the journey where the supplier is asked for
   * something. Held on the draft rather than fetched at publish so edits made
   * here survive stepping backwards and forwards through the wizard.
   */
  questionnaires: DraftQuestionnaire[];
  envelopeMode: 'SINGLE' | 'TWO_ENVELOPE';
  technicalGate: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
  minTechnicalScore: number;
  mechanism: AuctionMechanism;
  feedbackPolicy: FeedbackPolicy;
  minDecrement: number;
  softClose: boolean;
  /** The default window each ask stays open for, before any per-ask override. */
  closesInHours: number;
  /** When the first ask opens. Every other window is derived from it. */
  startAt: number;
  /** Per-ask window lengths, where the buyer wanted one different from the rest. */
  stageHours: Partial<Record<SolicitationStage, number>>;
  /** Windows the buyer set by hand, which are used verbatim. */
  stageWindowOverrides: Partial<Record<SolicitationStage, { opensAt: number; closesAt: number }>>;
  /** The time rules, applied to every ask this event creates. */
  timelineRules: TimelineRules;
  /**
   * The terms this event goes out with. Several documents, each applied at the
   * points market practice applies it — general conditions everywhere, payment
   * terms where a price is asked.
   */
  terms: TermsDocumentInput[];
}

/** The pattern a draft opens on before the buyer chooses one. */
const OPENING_PATTERN: JourneyPatternId = 'JP-02';

export const INITIAL_DRAFT: Draft = {
  side: 'BUY',
  pattern: OPENING_PATTERN,
  title: '',
  description: '',
  category: 'Office & Administrative',
  businessUnit: 'Corporate Services',
  currency: BASE_CURRENCY,
  sourceReference: '',
  sourceRequestNumbers: [],
  lines: [
    { id: 'dl-1', itemCode: 'PPR-A4-80', description: 'A4 copier paper, 80gsm, ream of 500', specification: 'ISO brightness 96+, FSC certified', quantity: 12_000, uom: 'ream', deliveryLocation: 'Dubai DC', needBy: '', baselinePrice: 8.67, lotName: 'Lot 1 · Paper', category: 'Office & Administrative', superCategory: null },
    { id: 'dl-2', itemCode: 'PEN-BLU-BX', description: 'Ballpoint pen, blue, box of 50', specification: '0.7mm, retractable', quantity: 900, uom: 'box', deliveryLocation: 'Dubai DC', needBy: '', baselinePrice: 18.5, lotName: 'Lot 2 · Writing', category: 'Office & Administrative', superCategory: null },
  ],
  // Seeded when the Bidders step is first opened, from the vendor master.
  bidderIdsByCategory: {},
  // Populated when the Questionnaire step is first opened, from the library
  // templates that apply at this journey's points.
  questionnaires: [],
  envelopeMode: 'TWO_ENVELOPE',
  technicalGate: 'MIN_SCORE',
  minTechnicalScore: 60,
  mechanism: 'ENGLISH',
  feedbackPolicy: 'RANK_GAP',
  minDecrement: 1,
  softClose: true,
  closesInHours: 72,
  startAt: roundToNextHour(Date.now()),
  stageHours: {},
  stageWindowOverrides: {},
  timelineRules: DEFAULT_TIMELINE_RULES,
  // The two a buyer is asked for first, pointed at the asks this pattern runs
  // rather than at the ones the library template was written for.
  terms: alignTermsToJourney(
    [instantiateTerms(TERMS_TEMPLATES[0], 'draft'), instantiateTerms(TERMS_TEMPLATES[1], 'draft')],
    JOURNEY_PATTERNS[OPENING_PATTERN].vendorInputPoints,
  ),
};

/**
 * The draft's timeline, in the shape the API takes.
 *
 * One function so the preview on the Timeline step, the readiness list, the
 * publish dialog and the publish itself cannot disagree about the dates.
 */
function timelineInput(draft: Draft) {
  return {
    opensAt: draft.startAt,
    closesInHours: draft.closesInHours,
    stageHours: draft.stageHours,
    windows: draft.stageWindowOverrides,
    rules: draft.timelineRules,
  };
}

export interface CategoryGroup {
  category: string;
  superCategory: string | null;
  lines: DraftLine[];
}

/**
 * The event's lines grouped by the category they were requisitioned under, in
 * order of weight so the first group is the category the event is raised under.
 */
export function categoryGroupsOf(draft: Draft): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const line of draft.lines) {
    const category = line.category || draft.category;
    const existing = groups.get(category);
    if (existing) existing.lines.push(line);
    else groups.set(category, { category, superCategory: line.superCategory, lines: [line] });
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.lines.length - a.lines.length || a.category.localeCompare(b.category),
  );
}

/** Bidder counts per category, for the review table. */
function bidderSummary(draft: Draft): React.ReactNode {
  const groups = categoryGroupsOf(draft);
  if (groups.length === 0) return <em style={{ color: color.textMuted }}>no lines</em>;
  return groups
    .map((g) => `${g.category} · ${(draft.bidderIdsByCategory[g.category] ?? []).length}`)
    .join('  ·  ');
}

/**
 * Questionnaire readiness, surfaced on the review rail rather than only inside
 * the step. The rules are the library's own — the wizard must not enforce a
 * second, weaker copy of "RFI is pre-commercial".
 */
function questionnaireValidation(
  draft: Draft, points: VendorInputPoint[],
): ValidationItem[] {
  const items: ValidationItem[] = [];
  for (const point of points) {
    const questionnaire = draft.questionnaires.find((q) => q.point === point);
    if (!questionnaire || questionnaire.questions.length === 0) {
      items.push({
        tone: 'warning',
        text: `No questions asked at ${pointLabel(point)} — the supplier is asked for nothing at a point the journey runs.`,
      });
      continue;
    }
    const result = validateTemplate(draftAsTemplate(questionnaire));
    for (const issue of result.errors) {
      items.push({ tone: 'error', text: `${pointLabel(point)}: ${issue.message}`, blocking: true });
    }
    if (result.errors.length === 0) {
      const scored = questionnaire.questions.filter(isScored).length;
      items.push({
        tone: 'success',
        text: `${pointLabel(point)} questionnaire — ${questionnaire.questions.length} questions, ${scored > 0 ? `${scored} scored` : 'none scored'}`,
      });
    }
  }
  return items;
}

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
      specification: l.specification, quantity: l.quantity, uom: l.uom,
      deliveryLocation: l.deliveryLocation, needBy: l.needBy, baselinePrice: l.baselinePrice,
      lotName: l.lotName, category: l.category, superCategory: l.superCategory,
      sourcePrLineId: l.sourcePrLineId,
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
  const [publishError, setPublishError] = React.useState<string | null>(null);
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
  const switchTo = (next: JourneyPatternId) => {
    patch({
      pattern: next,
      side: JOURNEY_PATTERNS[next].side === 'SELL' ? 'SELL' : draft.side,
      // Terms follow the journey. A document applied at an ask the new pattern
      // does not run would otherwise stay applied there — invisible, since the
      // coverage grid only has a column per ask that runs — while the asks that
      // do run go out bare and block the publish.
      terms: alignTermsToJourney(draft.terms, JOURNEY_PATTERNS[next].vendorInputPoints),
    });
    setStep(0);
  };

  const applyPattern = (next: JourneyPatternId) => {
    const nextSteps = JOURNEY_PATTERNS[next].wizardSteps;
    const losesAuction = steps.includes('Auction') && !nextSteps.includes('Auction');
    const losesQuestionnaire = steps.includes('Questionnaire') && !nextSteps.includes('Questionnaire');
    if (losesAuction || losesQuestionnaire) {
      setSwitchWarning(next);
      return;
    }
    switchTo(next);
  };

  /**
   * Where this journey actually asks the supplier for structured information.
   * The auction is excluded on purpose: it takes a live bid, and anything not
   * asked before it opens cannot be asked during it.
   */
  const questionnairePoints = pattern.vendorInputPoints.filter(
    (p): p is VendorInputPoint => p !== 'AUCTION',
  );

  /**
   * The categories this event actually spans, in line order so the first is
   * the one the event is raised under, and the lines that sit in each.
   */
  const lineCategories = categoryGroupsOf(draft);
  const allBidderIds = Array.from(
    new Set(lineCategories.flatMap((g) => draft.bidderIdsByCategory[g.category] ?? [])),
  );
  const coverage = validateCoverage(
    lineCategories.map((g) => ({
      category: g.category, bidderIds: draft.bidderIdsByCategory[g.category] ?? [],
    })),
    COUNTERPARTIES,
  );

  const lotNames = [...new Set(draft.lines.map((l) => l.lotName))];
  const estimatedValue = draft.lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);

  const guidance = mechanismGuidance(draft.mechanism, allBidderIds.length, draft.lines.length);

  const createdStages = solicitationStagesOf(draft.pattern);
  const schedulePreview = stageWindows(createdStages, timelineInput(draft), draft.startAt);
  const scheduleIssues = validateSchedule(schedulePreview, draft.timelineRules, Date.now());
  const termsIssues = validateTerms(draft.terms, pattern.vendorInputPoints);

  const validation: ValidationItem[] = [
    { tone: draft.title.trim() ? 'success' : 'info', text: draft.title.trim() ? `Title set — "${draft.title}"` : 'Event title is required' },
    { tone: 'success', text: `Pattern ${pattern.id} · ${pattern.name} · side ${draft.side} (${directionLabel(draft.side)})` },
    { tone: draft.lines.length > 0 ? 'success' : 'error', text: draft.lines.length > 0 ? `${draft.lines.length} lines across ${lotNames.length} lot(s)` : 'At least one lot with lines is required', blocking: draft.lines.length === 0 },
    // Coverage is judged per category: a healthy total across a consolidated
    // event can still leave one category with a single supplier in it.
    ...coverage.map((issue) => ({
      tone: issue.tone, text: issue.message, blocking: issue.blocking,
    })),
    // The schedule is judged by the same rules the event will be governed by
    // after publish, so nothing passes here that the extend dialog would later
    // call impossible.
    ...(scheduleIssues.length === 0
      ? [{
        tone: 'success' as const,
        text: createdStages.length === 0
          ? 'No supplier-facing ask, so no response deadline'
          : `${createdStages.length === 1 ? 'The ask runs' : `${createdStages.length} asks run`} from ${new Date(schedulePreview[0].opensAt).toLocaleDateString()} to ${new Date(schedulePreview[schedulePreview.length - 1].closesAt).toLocaleDateString()}`,
      }]
      : scheduleIssues.map((issue) => ({
        tone: issue.blocking ? ('error' as const) : ('warning' as const),
        text: issue.message,
        blocking: issue.blocking,
      }))),
    {
      tone: 'success' as const,
      text: describeRules(draft.timelineRules),
    },
    // Terms are judged per ask: general conditions everywhere, payment terms
    // wherever a price is asked. Publishing without them is blocked, not warned.
    ...(termsIssues.length === 0
      ? [{ tone: 'success' as const, text: describeTerms(draft.terms) }]
      : termsIssues.map((issue) => ({
        tone: issue.blocking ? ('error' as const) : ('warning' as const),
        text: issue.message,
        blocking: issue.blocking,
      }))),
    ...questionnaireValidation(draft, questionnairePoints),
  ];

  const provisionalSelected = allBidderIds.filter(
    (id) => COUNTERPARTIES.find((c) => c.id === id)?.isProvisional,
  );

  const blocked = validation.some((v) => v.blocking);


  /**
   * Publish.
   *
   * The wizard does not build events any more. It builds the request the API
   * takes — the nine steps, as one object — and calls it. The same call goes
   * over HTTP when the app is pointed at the API server, and runs in the tab
   * when it is not, so what the buyer publishes here and what an integration
   * posts to `/api/sourcing-events` cannot mean two different things.
   */
  const toInput = (): SourcingEventInput => ({
    // 1 — Basics
    journeyPattern: draft.pattern,
    title: draft.title || 'Untitled event',
    description: draft.description,
    side: draft.side,
    category: draft.category,
    businessUnit: draft.businessUnit,
    currency: draft.currency,
    ownerId: state.currentUser.id,
    createdFrom: draft.sourceReference ? 'PR' : 'MANUAL',
    sourceReference: draft.sourceReference || null,
    sourcingRequisitionId: requisition?.id ?? null,
    // 2 — Items & Lots
    lines: draft.lines.map((line) => ({
      itemCode: line.itemCode,
      description: line.description,
      specification: line.specification,
      quantity: line.quantity,
      uom: line.uom,
      deliveryLocation: line.deliveryLocation,
      needBy: line.needBy,
      baselinePrice: line.baselinePrice,
      lotName: line.lotName,
      category: line.category,
      superCategory: line.superCategory,
      sourcePrLineId: line.sourcePrLineId ?? null,
    })),
    // 3 — Bidders, per category, flattened to the shortlist that was actually built
    bidders: lineCategories.flatMap((group) =>
      (draft.bidderIdsByCategory[group.category] ?? []).map((counterpartyId) => {
        const counterparty = COUNTERPARTIES.find((c) => c.id === counterpartyId);
        return {
          counterpartyId,
          category: group.category,
          isProvisional: counterparty?.isProvisional ?? false,
          qualificationSnapshot: counterparty?.onboardingRating ?? 0,
          performanceRatingSnapshot: counterparty?.performanceRating ?? 0,
        };
      }),
    ),
    // 4 — Questionnaire. Copies, not references: editing here never reached the
    // shared library, and it must not start doing so now.
    questionnaires: draft.questionnaires
      .filter((q) => questionnairePoints.includes(q.point) && q.questions.length > 0)
      .map((q) => ({
        point: q.point,
        name: q.templateName,
        questions: q.questions.slice().sort((a, b) => a.sequence - b.sequence).map((question) => ({
          sectionId: question.sectionId,
          sequence: question.sequence,
          code: question.code,
          type: question.type,
          title: question.title,
          helpText: question.helpText,
          isRequired: question.isRequired,
          envelope: question.envelope,
          weight: question.weight,
          scoringMethod: question.scoringMethod,
          maxScore: question.maxScore,
          rubric: question.rubric,
          isKnockout: question.isKnockout,
          allowAttachment: question.allowAttachment,
          config: question.config,
        })),
      })),
    // 5 — Terms: several documents, each applied where it belongs
    terms: draft.terms,
    // 6 — Evaluation
    evaluation: {
      envelopeMode: draft.envelopeMode,
      technicalGate: draft.technicalGate,
      minTechnicalScore: draft.minTechnicalScore,
    },
    // 7 — Auction
    auction: {
      mechanism: draft.mechanism,
      feedbackPolicy: draft.feedbackPolicy,
      minDecrement: draft.minDecrement,
      softClose: draft.softClose,
    },
    // 8 — Timeline: the dates, and the rules that govern moving them
    timeline: timelineInput(draft),
  });

  const publish = async () => {
    setPublishError(null);
    try {
      const family = await sourcingApi({
        events: state.events,
        auctions: auctionRecords(state),
      }).createSourcingEvent(toInput());
      dispatch({
        type: 'CREATE_EVENT',
        event: family.event,
        stageEvents: family.stageEvents,
        lots: family.lots,
        lineItems: family.lineItems,
        questionnaires: family.questionnaires,
        bidders: family.bidders,
        terms: family.terms,
        // The auction the journey implies, live in the same dispatch as the ask
        // it belongs to — so it is on the E-Auction board before the buyer has
        // finished reading the confirmation.
        auction: family.auction,
        // The lines this event was raised for leave the sourceable pool in the
        // same dispatch that creates it.
        sourcedLineIds: family.sourcedLineIds,
        sourcingRequisitionId: requisition?.id,
      });
      setPublishOpen(false);
      onNavigate({ name: 'event', eventId: family.event.id });
    } catch (error) {
      // A refusal is shown where the buyer is looking rather than thrown away.
      // The API validates the same things the Review step blocks on, so this
      // is a backstop — but a silent one would be the worst kind.
      setPublishError(
        error instanceof ApiError && error.details.length > 0
          ? error.details.map((d) => (d as { message: string }).message).join(' ')
          : error instanceof Error ? error.message : 'The event could not be published.',
      );
    }
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
              <BiddersStep
                draft={draft}
                patch={patch}
                provisionalSelected={provisionalSelected}
                groups={lineCategories}
              />
            )}
            {stepName === 'Questionnaire' && (
              <QuestionnaireStep
                draft={draft}
                patch={patch}
                points={questionnairePoints}
                category={draft.category}
              />
            )}
            {stepName === 'Terms' && (
              <TermsStep draft={draft} patch={patch} points={pattern.vendorInputPoints} />
            )}
            {stepName === 'Evaluation' && <EvaluationStep draft={draft} patch={patch} />}
            {stepName === 'Auction' && (
              <AuctionStep draft={draft} patch={patch} guidance={guidance} />
            )}
            {stepName === 'Timeline' && (
              <TimelineStep draft={draft} patch={patch} stages={createdStages} />
            )}
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
            { label: 'PR-2024-0125', detail: '2 lines, 12,900 units, indicative ₹1,50,000' },
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
          Publishing sends invitations to {allBidderIds.length} bidders and freezes the resolved
          configuration onto the event.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><strong>{draft.title || 'Untitled event'}</strong> — {pattern.name}</li>
          <li>Side <strong>{draft.side}</strong> — {directionLabel(draft.side)}. This cannot be changed later.</li>
          <li>{draft.lines.length} lines across {lotNames.length} lot(s), est. {money(estimatedValue)}</li>
          <li>{describeRules(draft.timelineRules)}</li>
        </ul>

        {/*
          What a journey actually produces is the part a buyer most often gets
          wrong, so it is shown before the button rather than discovered after.
        */}
        {createdStages.length > 0 && (
          <div
            style={{
              marginTop: 12, border: `1px solid ${color.border}`, borderRadius: radius.control,
              padding: '10px 12px', background: color.surface,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              This creates {createdStages.length} {createdStages.length === 1 ? 'ask' : 'asks'}, each
              in its own section
            </div>
            <div className="rfx-stack" style={{ gap: 4 }}>
              {schedulePreview.map((window, i) => (
                <div key={window.stage} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ width: 74, color: color.textSecondary }}>
                    {STAGE_LABELS[window.stage]}
                  </span>
                  <span>
                    {i === 0 ? 'issued now' : 'planned'} · closes{' '}
                    {new Date(window.closesAt).toLocaleString([], {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {publishError && (
          <div style={{ marginTop: 12 }}>
            <ValidationBanner tone="error" title="The event was not published">
              {publishError}
            </ValidationBanner>
          </div>
        )}
      </Modal>

      <Modal
        open={switchWarning !== null}
        title="Change journey pattern?"
        onClose={() => setSwitchWarning(null)}
        onConfirm={() => {
          if (switchWarning) switchTo(switchWarning);
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
            {['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <option key={c}>{c}</option>)}
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
                  specification: '', quantity: 1, uom: 'each', deliveryLocation: '', needBy: '',
                  baselinePrice: null, lotName: draft.lines[0]?.lotName ?? 'Lot 1',
                  category: draft.category, superCategory: null,
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

/**
 * The shortlist, built per category.
 *
 * A consolidated event carries lines from several categories, and one flat
 * bidder list across all of them is wrong in both directions: it asks a laptop
 * supplier to price hydraulic pumps, and it lets a healthy total hide a
 * category with a single supplier in it. So each category gets its own group —
 * the lines that sit in it, the suppliers the vendor master proposes for it,
 * and whoever else the buyer decides to add.
 *
 * The proposal is a starting point, not a restriction. A buyer who knows the
 * market can invite a supplier the master does not list against the category,
 * which is why every other supplier stays one click away rather than hidden.
 */
export function BiddersStep({
  draft, patch, provisionalSelected, groups,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  provisionalSelected: string[];
  groups: CategoryGroup[];
}) {
  // Each category opens on the strongest suppliers that serve it, so the buyer
  // starts from a real shortlist and edits it rather than building one.
  const seeded = React.useMemo(() => {
    const next: Record<string, string[]> = { ...draft.bidderIdsByCategory };
    let changed = false;
    for (const group of groups) {
      if (next[group.category] === undefined) {
        next[group.category] = defaultShortlist(
          COUNTERPARTIES, group.category, group.superCategory,
        );
        changed = true;
      }
    }
    return changed ? next : draft.bidderIdsByCategory;
  }, [draft.bidderIdsByCategory, groups]);

  React.useEffect(() => {
    if (seeded !== draft.bidderIdsByCategory) patch({ bidderIdsByCategory: seeded });
  });

  const selectedIn = (category: string) => seeded[category] ?? [];

  const toggle = (category: string, id: string) => {
    const current = selectedIn(category);
    patch({
      bidderIdsByCategory: {
        ...seeded,
        [category]: current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
      },
    });
  };

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: color.textSecondary }}>
        Add lines on the Items &amp; Lots step first — the shortlist is proposed from what the
        event is actually buying.
      </div>
    );
  }

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        {groups.length > 1
          ? `This event spans ${groups.length} categories. Each gets its own shortlist — a supplier is only asked to price the lines they can actually bid on.`
          : 'Onboarding rating and performance rating are two different things and are shown separately — a compliant new supplier can rate high on one and have no history on the other.'}
      </div>

      {groups.map((group) => (
        <BidderCategoryGroup
          key={group.category}
          group={group}
          currency={draft.currency}
          selected={selectedIn(group.category)}
          onToggle={(id) => toggle(group.category, id)}
        />
      ))}

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

function BidderCategoryGroup({
  group, currency, selected, onToggle,
}: {
  group: CategoryGroup;
  currency: string;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [showOthers, setShowOthers] = React.useState(false);
  const { suggested, others } = suggestBidders(
    COUNTERPARTIES, group.category, group.superCategory,
  );
  // A supplier the buyer added despite the master not listing them belongs in
  // the visible list, not buried behind "add another".
  const addedFromOthers = others.filter((c) => selected.includes(c.id));
  const remaining = others.filter((c) => !selected.includes(c.id));

  const value = group.lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);
  const thin = selected.length < MIN_BIDDERS_PER_CATEGORY;

  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control }}>
      <div
        style={{
          padding: '10px 13px', borderBottom: `1px solid ${color.border}`,
          background: color.surfacePage, display: 'flex', alignItems: 'center',
          gap: 8, flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 13 }}>{group.category}</strong>
        <span style={{ color: color.textMuted }}>·</span>
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'} ·{' '}
          {money(value, currency)}
        </span>
        <span style={{ flex: 1 }} />
        <Chip tone={thin ? 'gold' : 'brand'}>
          {selected.length} {selected.length === 1 ? 'bidder' : 'bidders'}
        </Chip>
      </div>

      <div style={{ padding: '8px 13px', borderBottom: `1px solid ${color.border}` }}>
        <div style={{ fontSize: 10.5, color: color.textSecondary, marginBottom: 4 }}>
          LINES IN THIS CATEGORY
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {group.lines.slice(0, 8).map((line) => (
            <Chip key={line.id} tone="neutral" title={`${line.quantity} ${line.uom} · ${line.lotName}`}>
              {line.description}
            </Chip>
          ))}
          {group.lines.length > 8 && (
            <Chip tone="neutral">+{group.lines.length - 8} more</Chip>
          )}
        </div>
      </div>

      <div className="rfx-stack" style={{ gap: 6, padding: 10 }}>
        {[...suggested, ...addedFromOthers].map((cp) => (
          <BidderRow
            key={cp.id}
            counterparty={cp}
            category={group.category}
            selected={selected.includes(cp.id)}
            offMaster={!suggested.some((s) => s.id === cp.id)}
            onToggle={() => onToggle(cp.id)}
          />
        ))}

        {suggested.length === 0 && addedFromOthers.length === 0 && (
          <div style={{ fontSize: 12, color: color.warningText }}>
            No supplier on the master serves {group.category}. Add one below — they can still be
            invited, and onboarding catches up before award.
          </div>
        )}

        {thin && (
          <div style={{ fontSize: 11.5, color: color.warningText }}>
            {selected.length === 0
              ? `Nobody invited for ${group.category} — these lines would go out with nobody to price them.`
              : `Only ${selected.length} of a recommended ${MIN_BIDDERS_PER_CATEGORY} — add more to get real competition on these lines.`}
          </div>
        )}

        {remaining.length > 0 && (
          showOthers ? (
            <div className="rfx-stack" style={{ gap: 6, marginTop: 4 }}>
              <div style={{ fontSize: 10.5, color: color.textSecondary }}>
                NOT LISTED AGAINST {group.category.toUpperCase()} — INVITE ANYWAY
              </div>
              {remaining.map((cp) => (
                <BidderRow
                  key={cp.id}
                  counterparty={cp}
                  category={group.category}
                  selected={false}
                  offMaster
                  onToggle={() => onToggle(cp.id)}
                />
              ))}
              <div>
                <Button variant="tertiary" size="small" onClick={() => setShowOthers(false)}>
                  Done adding
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="secondary" size="small" onClick={() => setShowOthers(true)}>
                + Add another supplier ({remaining.length} available)
              </Button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function BidderRow({
  counterparty: cp, category, selected, offMaster, onToggle,
}: {
  counterparty: Counterparty;
  category: string;
  selected: boolean;
  offMaster: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        border: `1px solid ${selected ? color.brandPrimary : color.border}`,
        background: selected ? '#F5F8FF' : '#fff',
        borderRadius: radius.control, padding: '9px 12px',
      }}
    >
      <Toggle checked={selected} onChange={onToggle} label="" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{cp.name}</span>
          {cp.isProvisional && (
            <Chip tone="gold" icon="⚑" title="Not yet on the vendor master">provisional</Chip>
          )}
          {offMaster && (
            <Chip
              tone="neutral"
              title={`The vendor master does not list ${cp.name} against ${category}`}
            >
              off-category
            </Chip>
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
}

/**
 * The questionnaire, shaped before the event exists.
 *
 * A template is a starting point, not a contract: the buyer picks one, then
 * adds, removes and reweights against the demand actually in front of them.
 * Those edits belong to the event — the library template is a shared asset and
 * one event's needs must not rewrite it for everybody else.
 *
 * Weight is deliberately optional. A pure RFI qualifies the market and may
 * score nothing at all; an RFP that scores nothing is a mistake. Rather than
 * pick one of those for the buyer, the editor lets weight be absent and lets
 * the library's own rules say what that means at this point in the journey.
 */
export function QuestionnaireStep({
  draft, patch, points, category,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  points: VendorInputPoint[];
  category: string;
}) {
  const { state } = useStore();
  const [activePoint, setActivePoint] = React.useState<VendorInputPoint>(points[0] ?? 'RFI');

  // Templates accumulate down the scope chain, so a category library adds to
  // the tenant one rather than hiding it.
  const library = React.useMemo(
    () =>
      resolveAccumulated<QuestionnaireTemplate>(TEMPLATE_CUSTOM_KEY, state.configSettings, {
        tenantId: SCOPE_LINEAGE.tenantId,
        categoryId: category,
        templateId: null,
        eventId: null,
      }).items,
    [state.configSettings, category],
  );

  const point = points.includes(activePoint) ? activePoint : points[0];
  const options = React.useMemo(
    () => (point ? templatesFor(library, point, category) : []),
    [library, point, category],
  );

  const write = (next: DraftQuestionnaire) =>
    patch({
      questionnaires: [...draft.questionnaires.filter((q) => q.point !== next.point), next],
    });

  // Every point the journey asks at starts from the library template that
  // applies there, so the buyer edits a real questionnaire rather than filling
  // a blank page. Points already shaped are left exactly as they are.
  const seeded = seedQuestionnaires({
    existing: draft.questionnaires, points, library, category, idSeed: 'draft',
  });
  React.useEffect(() => {
    if (seeded.length !== draft.questionnaires.length
        || seeded.some((q, i) => q !== draft.questionnaires[i])) {
      patch({ questionnaires: seeded });
    }
  });

  const current = seeded.find((q) => q.point === point) ?? null;

  if (!point) {
    return (
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        This journey never puts a questionnaire in front of a supplier — the auction takes a live
        bid and nothing else. Anything you need asked has to be asked before it opens.
      </div>
    );
  }

  if (!current) return null;

  const validation = validateTemplate(draftAsTemplate(current));
  const issuesByQuestion = new Map<string, string[]>();
  for (const issue of [...validation.errors, ...validation.warnings]) {
    if (!issue.questionId) continue;
    issuesByQuestion.set(issue.questionId, [
      ...(issuesByQuestion.get(issue.questionId) ?? []),
      issue.message,
    ]);
  }

  const ordered = [...current.questions].sort((a, b) => a.sequence - b.sequence);
  const shares = normalise(ordered.filter(isScored));
  const shareOf = (id: string) => shares.find((s) => s.item.id === id)?.effectivePct ?? null;
  const totalWeight = templateWeight(draftAsTemplate(current));
  const scoredCount = ordered.filter(isScored).length;

  const groups = [
    ...[...current.sections]
      .sort((a, b) => a.sequence - b.sequence)
      .map((section) => ({
        section,
        questions: ordered.filter((q) => q.sectionId === section.id),
      })),
    { section: null, questions: ordered.filter((q) => q.sectionId === null) },
  ].filter((g) => g.section !== null || g.questions.length > 0);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {points.length > 1 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Asked at</div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 8 }}>
            This journey asks the supplier for information more than once. Each point gets its own
            questionnaire — a code asked twice carries the first answer forward rather than asking
            again.
          </div>
          <Segmented
            value={point}
            onChange={setActivePoint}
            options={points.map((p) => {
              const q = draft.questionnaires.find((x) => x.point === p);
              return {
                value: p,
                label: q ? `${pointLabel(p)} · ${q.questions.length}` : pointLabel(p),
              };
            })}
          />
        </div>
      )}

      <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
        <strong style={{ color: color.textBody }}>{pointLabel(point)}</strong> — {POINT_PURPOSE[point]}
      </div>

      <Field
        label="Questionnaire template"
        hint="Picking a template copies its questions here. Editing them changes this event only."
      >
        <Select
          value={current.templateId ?? 'BLANK'}
          onChange={(e) => {
            const id = e.target.value;
            const template = options.find((t) => t.id === id);
            write(
              template
                ? instantiateTemplate(template, point, `${point.toLowerCase()}-${Date.now()}`)
                : blankQuestionnaire(point, `${point.toLowerCase()}-${Date.now()}`),
            );
          }}
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.questions.length} questions
            </option>
          ))}
          <option value="BLANK">Blank — start from nothing</option>
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

      <div
        style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${color.border}`, paddingTop: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {ordered.length} question{ordered.length === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 11.5, color: color.textSecondary }}>
          {scoredCount === 0
            ? 'Nothing scored — this questionnaire gathers information only'
            : `${scoredCount} scored · total weight ${totalWeight}`}
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.section?.id ?? 'ungrouped'} className="rfx-stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {group.section ? (
              <>
                <TextInput
                  value={group.section.name}
                  aria-label="Section name"
                  onChange={(e) =>
                    write(renameDraftSection(current, group.section!.id, e.target.value))
                  }
                  style={{ fontWeight: 600, maxWidth: 280 }}
                />
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => write(removeDraftSection(current, group.section!.id))}
                >
                  Remove section
                </Button>
              </>
            ) : (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: color.textSecondary }}>
                Ungrouped
              </div>
            )}
          </div>

          {group.questions.length === 0 && (
            <div style={{ fontSize: 12, color: color.textMuted, paddingLeft: 2 }}>
              No questions in this section yet.
            </div>
          )}

          {group.questions.map((question) => {
            const priced = PRICED_QUESTION_TYPES.includes(question.type);
            const scored = isScored(question);
            const share = shareOf(question.id);
            const issues = issuesByQuestion.get(question.id) ?? [];
            return (
              <div
                key={question.id}
                style={{
                  border: `1px solid ${issues.length > 0 ? color.warning : color.border}`,
                  borderRadius: radius.control,
                  padding: 10,
                  background: '#fff',
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11, color: color.textMuted, fontVariantNumeric: 'tabular-nums',
                      minWidth: 18,
                    }}
                  >
                    {question.sequence}
                  </span>
                  <TextInput
                    value={question.title}
                    placeholder="What are you asking the supplier?"
                    aria-label="Question title"
                    onChange={(e) =>
                      write({
                        ...current,
                        questions: current.questions.map((q) =>
                          q.id === question.id ? { ...q, title: e.target.value } : q,
                        ),
                      })
                    }
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="tertiary"
                    size="small"
                    aria-label="Move up"
                    onClick={() => write(moveDraftQuestion(current, question.id, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="tertiary"
                    size="small"
                    aria-label="Move down"
                    onClick={() => write(moveDraftQuestion(current, question.id, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="tertiary"
                    size="small"
                    aria-label="Delete question"
                    onClick={() => write(removeDraftQuestion(current, question.id))}
                  >
                    ×
                  </Button>
                </div>

                <div
                  style={{
                    display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                    paddingLeft: 26,
                  }}
                >
                  <Select
                    value={question.type}
                    aria-label="Answer type"
                    onChange={(e) =>
                      write(setDraftType(current, question.id, e.target.value as typeof question.type))
                    }
                    style={{ maxWidth: 190 }}
                  >
                    {QUESTION_TYPES_BY_GROUP.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.types.map((type) => (
                          <option key={type} value={type}>{typeLabel(type)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>

                  <Select
                    value={question.envelope}
                    aria-label="Envelope"
                    onChange={(e) =>
                      write({
                        ...current,
                        questions: current.questions.map((q) =>
                          q.id === question.id
                            ? { ...q, envelope: e.target.value as QuestionEnvelope }
                            : q,
                        ),
                      })
                    }
                    style={{ maxWidth: 140 }}
                  >
                    <option value="TECHNICAL">Technical</option>
                    <option value="COMMERCIAL">Commercial</option>
                    <option value="GENERAL">General</option>
                  </Select>

                  <Checkbox
                    checked={question.isRequired}
                    label="Required"
                    onChange={(isRequired) =>
                      write({
                        ...current,
                        questions: current.questions.map((q) =>
                          q.id === question.id ? { ...q, isRequired } : q,
                        ),
                      })
                    }
                  />

                  <Checkbox
                    checked={question.isKnockout}
                    label="Knockout"
                    onChange={(isKnockout) =>
                      write({
                        ...current,
                        questions: current.questions.map((q) =>
                          q.id === question.id ? { ...q, isKnockout } : q,
                        ),
                      })
                    }
                  />

                  <Checkbox
                    checked={scored}
                    label="Scored"
                    disabled={priced}
                    onChange={(next) => write(setDraftScored(current, question.id, next))}
                  />

                  {scored ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <NumberInput
                        value={question.weight}
                        min={0}
                        aria-label="Weight"
                        onChange={(e) =>
                          write({
                            ...current,
                            questions: current.questions.map((q) =>
                              q.id === question.id
                                ? { ...q, weight: Math.max(0, Number(e.target.value)) }
                                : q,
                            ),
                          })
                        }
                        style={{ width: 66 }}
                      />
                      <span
                        style={{
                          fontSize: 11.5, color: color.textSecondary,
                          fontVariantNumeric: 'tabular-nums', minWidth: 44,
                        }}
                      >
                        {share === null ? '—' : `${share.toFixed(1)}%`}
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11.5, color: color.textMuted }}>
                      {priced ? 'Priced — scored through the price component' : 'Not weighted'}
                    </span>
                  )}
                </div>

                {issues.length > 0 && (
                  <div style={{ paddingLeft: 26, display: 'grid', gap: 4 }}>
                    {issues.map((message) => (
                      <div key={message} style={{ fontSize: 11.5, color: color.warningText }}>
                        {message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div>
            <Button
              variant="secondary"
              size="small"
              onClick={() => write(addDraftQuestion(current, group.section?.id ?? null))}
            >
              + Add question
            </Button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="tertiary"
          size="small"
          onClick={() => write(addDraftSection(current, 'New section'))}
        >
          + Add section
        </Button>
      </div>

      {validation.errors.filter((e) => !e.questionId).map((issue) => (
        <ValidationBanner key={issue.code} tone="error" title={issue.message} />
      ))}
      {validation.warnings.filter((w) => !w.questionId).map((issue) => (
        <ValidationBanner key={issue.code} tone="warning" title={issue.message} />
      ))}
    </div>
  );
}

/**
 * The Terms step.
 *
 * An event does not go out with one set of terms. It goes out with several —
 * general conditions everywhere, payment terms where a price is asked, and
 * whatever else the category needs — and they do not all apply at the same
 * point in the journey. So this is a list of documents, each naming the asks it
 * applies at, rather than a tick box.
 *
 * A document starts from the library and is then owned by this event: editing
 * the payment terms here never reaches back into the library.
 */
export function TermsStep({
  draft, patch, points,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  /** The points this journey asks the supplier at. */
  points: VendorInputPoint[];
}) {
  const [openId, setOpenId] = React.useState<string | null>(draft.terms[0]?.id ?? null);
  const [adding, setAdding] = React.useState(false);
  const issues = validateTerms(draft.terms, points);

  const setDocument = (id: string, next: Partial<TermsDocumentInput>) =>
    patch({ terms: draft.terms.map((d) => (d.id === id ? { ...d, ...next } : d)) });

  const add = (document: TermsDocumentInput) => {
    patch({ terms: [...draft.terms, document] });
    setOpenId(document.id);
    setAdding(false);
  };

  const remove = (id: string) => {
    patch({ terms: draft.terms.filter((d) => d.id !== id) });
    if (openId === id) setOpenId(null);
  };

  /** Templates not already on the event, so the library does not offer duplicates. */
  const used = new Set(draft.terms.map((d) => d.templateId).filter(Boolean));
  const available = TERMS_TEMPLATES.filter((template) => !used.has(template.id));

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        Publishing without terms is blocked, not warned. A deviation a bidder proposes is captured
        against the clause it is about and surfaces on the NFA, so an approver sees it.
      </div>

      {issues.filter((i) => i.blocking).length > 0 && (
        <ValidationBanner tone="error" title="These must be settled before publish">
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {issues.filter((i) => i.blocking).map((issue) => (
              <li key={`${issue.documentId}-${issue.point}-${issue.field}`}>{issue.message}</li>
            ))}
          </ul>
        </ValidationBanner>
      )}
      {issues.filter((i) => !i.blocking).length > 0 && (
        <ValidationBanner tone="warning" title="Worth a look">
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {issues.filter((i) => !i.blocking).map((issue) => (
              <li key={`${issue.documentId}-${issue.point}-${issue.field}`}>{issue.message}</li>
            ))}
          </ul>
        </ValidationBanner>
      )}

      {/*
        The coverage grid answers the question the buyer actually has — "what
        does a supplier see at the RFQ" — which a list of documents does not.
      */}
      <Card
        padded={false}
        title="What each ask carries"
        hint="A document applied at several asks is one document, not a copy per ask."
      >
        <div className="rfx-scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={headCell}>Terms</th>
                {points.map((point) => (
                  <th key={point} style={{ ...headCell, textAlign: 'center', width: 92 }}>
                    {pointLabel(point)}
                  </th>
                ))}
                <th style={{ ...headCell, width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {draft.terms.map((document) => (
                <tr key={document.id} style={{ borderTop: `1px solid ${color.border}` }}>
                  <td style={{ padding: '9px 11px' }}>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === document.id ? null : document.id)}
                      style={{
                        border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                        textAlign: 'left', font: 'inherit', color: color.textPrimary,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{document.title}</span>
                      <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                        {TERMS_CATEGORY_LABEL[document.category]} · v{document.version} ·{' '}
                        {document.clauses.length} clause{document.clauses.length === 1 ? '' : 's'}
                        {document.payment && ` · ${paymentSummary(document.payment)}`}
                      </div>
                    </button>
                  </td>
                  {points.map((point) => {
                    const on = document.appliesTo.includes(point);
                    return (
                      <td key={point} style={{ padding: '9px 11px', textAlign: 'center' }}>
                        <button
                          type="button"
                          aria-label={`${document.title} at ${pointLabel(point)}`}
                          aria-pressed={on}
                          onClick={() => setDocument(document.id, {
                            appliesTo: on
                              ? document.appliesTo.filter((p) => p !== point)
                              : [...document.appliesTo, point],
                          })}
                          style={{
                            width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                            border: `1px solid ${on ? color.brandPrimary : color.border}`,
                            background: on ? color.brandPrimary : '#fff',
                            color: on ? '#fff' : color.textMuted, fontSize: 13, lineHeight: 1,
                          }}
                        >
                          {on ? '✓' : ''}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ padding: '9px 11px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => remove(document.id)}
                      title="Remove these terms from the event"
                      style={{
                        border: 'none', background: 'none', color: color.dangerText,
                        cursor: 'pointer', fontSize: 15, padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {draft.terms.length === 0 && (
                <tr>
                  <td
                    colSpan={points.length + 2}
                    style={{ padding: '16px 11px', color: color.textSecondary, borderTop: `1px solid ${color.border}` }}
                  >
                    No terms attached yet. Add the general conditions first — every ask needs them.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '11px 14px', borderTop: `1px solid ${color.border}`, flexWrap: 'wrap' }}>
          <Button size="small" variant="secondary" onClick={() => setAdding(!adding)}>
            {adding ? 'Close library' : 'Add from library'}
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => add(blankTerms('SPECIAL', `draft-${Date.now()}`, points.slice(0, 1)))}
          >
            Write my own
          </Button>
        </div>
      </Card>

      {adding && (
        <Card
          title="Terms library"
          hint="Added as a copy. Editing it here never changes the library."
        >
          {available.length === 0 ? (
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>
              Every library document is already on this event.
            </div>
          ) : (
            <div className="rfx-stack" style={{ gap: 8 }}>
              {available.map((template) => (
                <div
                  key={template.id}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
                    border: `1px solid ${color.border}`, borderRadius: radius.control,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {template.title}
                      <Chip tone="neutral">v{template.version}</Chip>
                    </div>
                    <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>
                      {TERMS_CATEGORY_PURPOSE[template.category]}
                    </div>
                    <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>
                      Normally applied at{' '}
                      {template.defaultAppliesTo.map((p) => pointLabel(p)).join(', ')} ·{' '}
                      {template.clauses.length} clauses
                      {template.payment && ` · ${paymentSummary(template.payment)}`}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => add(instantiateTerms(
                      template,
                      `draft-${Date.now()}`,
                      // Only the points this journey actually runs.
                      template.defaultAppliesTo.filter((p) => points.includes(p)),
                    ))}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {draft.terms
        .filter((document) => document.id === openId)
        .map((document) => (
          <TermsEditor
            key={document.id}
            document={document}
            issues={issues.filter((issue) => issue.documentId === document.id)}
            onChange={(next) => setDocument(document.id, next)}
          />
        ))}
    </div>
  );
}

const headCell: React.CSSProperties = {
  textAlign: 'left', padding: '9px 11px', fontSize: 11, color: color.textSecondary,
  borderBottom: `1px solid ${color.border}`, whiteSpace: 'nowrap',
};

/** One document, opened for editing. */
function TermsEditor({
  document, issues, onChange,
}: {
  document: TermsDocumentInput;
  issues: { field: string; message: string; blocking: boolean }[];
  onChange: (next: Partial<TermsDocumentInput>) => void;
}) {
  const errorFor = (field: string) =>
    issues.find((issue) => issue.field === field && issue.blocking)?.message;

  const setClause = (id: string, next: Partial<TermsDocumentInput['clauses'][number]>) =>
    onChange({ clauses: document.clauses.map((c) => (c.id === id ? { ...c, ...next } : c)) });

  return (
    <Card
      title={document.title}
      hint={TERMS_CATEGORY_PURPOSE[document.category]}
      action={
        <Chip tone="brand">{TERMS_CATEGORY_LABEL[document.category]}</Chip>
      }
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 12 }}>
          <Field label="Title">
            <TextInput value={document.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select
              value={document.category}
              onChange={(e) => {
                const category = e.target.value as TermsCategory;
                onChange({
                  category,
                  // Payment figures exist on a payment document and nowhere else.
                  payment: category === 'PAYMENT'
                    ? document.payment ?? { ...DEFAULT_PAYMENT_TERMS }
                    : null,
                });
              }}
            >
              {TERMS_CATEGORIES.map((category) => (
                <option key={category} value={category}>{TERMS_CATEGORY_LABEL[category]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Version">
            <TextInput value={document.version} onChange={(e) => onChange({ version: e.target.value })} />
          </Field>
          <Field
            label="What the supplier must do"
            error={errorFor('acknowledgement')}
          >
            <Select
              value={document.acknowledgement}
              onChange={(e) => onChange({ acknowledgement: e.target.value as Acknowledgement })}
            >
              {(Object.keys(ACKNOWLEDGEMENT_LABEL) as Acknowledgement[]).map((key) => (
                <option key={key} value={key}>{ACKNOWLEDGEMENT_LABEL[key]}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Toggle
          checked={document.allowDeviation}
          onChange={(allowDeviation) => onChange({ allowDeviation })}
          label="A supplier may propose a deviation on these terms"
        />

        {document.payment && (
          <PaymentFields
            payment={document.payment}
            error={issues.find((i) => i.field.startsWith('payment') && i.blocking)?.message}
            onChange={(payment) => onChange({ payment: { ...document.payment!, ...payment } })}
          />
        )}

        <div>
          <SectionHeading
            hint="The reference a supplier and an approver will both cite when they disagree."
            action={
              <Button
                size="small"
                variant="secondary"
                onClick={() => onChange({
                  clauses: [...document.clauses, {
                    id: `cl-${Date.now()}`,
                    code: nextClauseCode(document.clauses),
                    title: 'New clause',
                    text: '',
                    nonNegotiable: false,
                  }],
                })}
              >
                Add a clause
              </Button>
            }
          >
            Clauses
          </SectionHeading>

          {errorFor('clauses') && (
            <div style={{ fontSize: 12, color: color.dangerText, marginTop: 6 }}>
              {errorFor('clauses')}
            </div>
          )}

          <div className="rfx-stack" style={{ gap: 10, marginTop: 10 }}>
            {document.clauses.map((clause) => (
              <div
                key={clause.id}
                style={{
                  border: `1px solid ${color.border}`, borderRadius: radius.control,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={clause.code}
                    onChange={(e) => setClause(clause.id, { code: e.target.value })}
                    aria-label="Clause reference"
                    style={{
                      width: 64, border: `1px solid ${color.border}`, borderRadius: radius.control,
                      padding: '6px 8px', fontSize: 12,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                    }}
                  />
                  <input
                    value={clause.title}
                    onChange={(e) => setClause(clause.id, { title: e.target.value })}
                    aria-label="Clause title"
                    style={{
                      flex: 1, minWidth: 160, border: `1px solid ${color.border}`,
                      borderRadius: radius.control, padding: '6px 9px', fontSize: 13,
                      fontWeight: 600, fontFamily: 'inherit',
                    }}
                  />
                  <Checkbox
                    checked={clause.nonNegotiable}
                    onChange={(nonNegotiable) => setClause(clause.id, { nonNegotiable })}
                    label="Non-negotiable"
                  />
                  <button
                    type="button"
                    onClick={() => onChange({
                      clauses: document.clauses.filter((c) => c.id !== clause.id),
                    })}
                    title="Remove this clause"
                    style={{
                      border: 'none', background: 'none', color: color.dangerText,
                      cursor: 'pointer', fontSize: 15, padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                <Textarea
                  rows={2}
                  value={clause.text}
                  onChange={(e) => setClause(clause.id, { text: e.target.value })}
                  placeholder="The clause, in the words a supplier will be held to."
                  style={{ marginTop: 8 }}
                />
              </div>
            ))}
            {document.clauses.length === 0 && (
              <div style={{ fontSize: 12.5, color: color.textSecondary }}>
                No clauses yet. Add one, or name the document a supplier is sent instead.
              </div>
            )}
          </div>
        </div>

        <Field
          label="Attached document"
          hint="Where the terms are a file. A supplier sees both the file and any clauses above."
        >
          <TextInput
            value={document.attachmentName ?? ''}
            placeholder="general-conditions-v3.2.pdf"
            onChange={(e) => onChange({ attachmentName: e.target.value.trim() === '' ? null : e.target.value })}
          />
        </Field>
      </div>
    </Card>
  );
}

/** The structured half of a payment document — the part that gets compared. */
function PaymentFields({
  payment, error, onChange,
}: {
  payment: PaymentTerms;
  error?: string;
  onChange: (next: Partial<PaymentTerms>) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.control,
        padding: '11px 13px', background: color.surface,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        Payment figures
        <span style={{ fontWeight: 400, color: color.textSecondary }}>
          {' '}— held as fields, not prose, because these are what a supplier prices against
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: 12 }}>
        <Field label="Credit period (days)">
          <NumberInput
            value={payment.creditDays}
            onChange={(e) => onChange({ creditDays: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Counted from">
          <Select
            value={payment.trigger}
            onChange={(e) => onChange({ trigger: e.target.value as PaymentTerms['trigger'] })}
          >
            {(Object.keys(PAYMENT_TRIGGER_LABEL) as PaymentTerms['trigger'][]).map((key) => (
              <option key={key} value={key}>{PAYMENT_TRIGGER_LABEL[key]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Advance (%)">
          <NumberInput
            value={payment.advancePct}
            onChange={(e) => onChange({ advancePct: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Retention (%)">
          <NumberInput
            value={payment.retentionPct}
            onChange={(e) => onChange({ retentionPct: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Retention released after (days)">
          <NumberInput
            value={payment.retentionReleaseDays}
            onChange={(e) => onChange({ retentionReleaseDays: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Price basis">
          <Select
            value={payment.priceBasis}
            onChange={(e) => onChange({ priceBasis: e.target.value as PaymentTerms['priceBasis'] })}
          >
            <option value="FIRM">Firm for the term</option>
            <option value="INDEXED">Indexed</option>
            <option value="VARIABLE">Variable</option>
          </Select>
        </Field>
      </div>
      <div style={{ fontSize: 12, color: error ? color.dangerText : color.textSecondary, marginTop: 8 }}>
        {error ?? paymentSummary(payment)}
      </div>
    </div>
  );
}

/** The next reference in the document's own numbering. */
function nextClauseCode(clauses: { code: string }[]): string {
  const last = clauses[clauses.length - 1]?.code ?? '1.0';
  const [major, minor] = last.split('.');
  const next = Number.parseInt(minor ?? '0', 10);
  return Number.isFinite(next) ? `${major}.${next + 1}` : `${clauses.length + 1}.1`;
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

/**
 * The Timeline step.
 *
 * Two halves, and the second is the one that matters. The first is the
 * schedule: when each ask opens and closes, derived back to back from a single
 * start and editable per ask. The second is the **rules that govern moving
 * those dates**, which apply to every ask this event creates.
 *
 * One set of rules per event, not one per stage. An RFQ that may be extended
 * twice while the RFI beside it may be extended five times is not a policy, it
 * is an accident — and it is the kind of accident nobody notices until a
 * supplier points at it.
 */
export function TimelineStep({
  draft, patch, stages,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  /** The asks this journey creates. Empty for a journey that solicits nobody. */
  stages: SolicitationStage[];
}) {
  const rules = draft.timelineRules;
  const setRules = (next: Partial<TimelineRules>) =>
    patch({ timelineRules: { ...rules, ...next } });

  const schedule = stageWindows(
    stages,
    {
      opensAt: draft.startAt,
      closesInHours: draft.closesInHours,
      stageHours: draft.stageHours,
      windows: draft.stageWindowOverrides,
      rules,
    },
    draft.startAt,
  );
  const issues = validateSchedule(schedule, rules, Date.now());

  const setWindow = (stage: SolicitationStage, patchWindow: { opensAt?: number; closesAt?: number }) => {
    const current = schedule.find((w) => w.stage === stage)!;
    patch({
      stageWindowOverrides: {
        ...draft.stageWindowOverrides,
        [stage]: {
          opensAt: patchWindow.opensAt ?? current.opensAt,
          closesAt: patchWindow.closesAt ?? current.closesAt,
        },
      },
    });
  };

  const toggleChannel = (channel: NotifyChannel) => {
    const on = rules.notifyChannels.includes(channel);
    setRules({
      notifyChannels: on
        ? rules.notifyChannels.filter((c) => c !== channel)
        : [...rules.notifyChannels, channel],
    });
  };

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      <div>
        <SectionHeading hint="Every ask runs in sequence. Change the start and the rest follow.">
          Schedule
        </SectionHeading>
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
            gap: 12, marginTop: 10,
          }}
        >
          <Field label="Event start" hint={`Times are in ${rules.timezone}.`}>
            <DateTimeInput
              value={draft.startAt}
              onChange={(next) => patch({ startAt: next, stageWindowOverrides: {} })}
            />
          </Field>
          <Field
            label="Default window per ask (hours)"
            hint="Applied to any ask you have not given a window of its own."
          >
            <NumberInput
              value={draft.closesInHours}
              onChange={(e) => patch({
                closesInHours: Number(e.target.value) || 0,
                stageWindowOverrides: {},
              })}
            />
          </Field>
          <Field label="Gap between asks (hours)" hint="Quiet time to evaluate before the next ask opens.">
            <NumberInput
              value={rules.gapHoursBetweenStages}
              onChange={(e) => setRules({ gapHoursBetweenStages: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
      </div>

      {stages.length === 0 ? (
        <ValidationBanner tone="info" title="This journey asks suppliers for nothing">
          {JOURNEY_PATTERNS[draft.pattern].name} runs no RFI, RFP, RFQ or auction, so there is no
          response deadline to set. The rules below still record how the event is governed if a
          solicitation is added later.
        </ValidationBanner>
      ) : (
        <Card
          padded={false}
          title="Each ask, and when it runs"
          hint="Derived from the start. Edit any date and the ones after it carry on from there."
        >
          <div className="rfx-scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['Ask', 'Opens', 'Closes', 'Open for', 'Clarifications close', ''].map((head) => (
                    <th
                      key={head}
                      style={{
                        textAlign: 'left', padding: '9px 11px', fontSize: 11,
                        color: color.textSecondary, borderBottom: `1px solid ${color.border}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.map((window) => {
                  const edited = draft.stageWindowOverrides[window.stage] !== undefined;
                  const rowIssues = issues.filter((i) => i.stage === window.stage);
                  return (
                    <tr key={window.stage} style={{ borderTop: `1px solid ${color.border}` }}>
                      <td style={{ padding: '9px 11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {STAGE_LABELS[window.stage]}
                        {edited && (
                          <Chip tone="info" title="Set by hand rather than derived from the start">
                            edited
                          </Chip>
                        )}
                      </td>
                      <td style={{ padding: '7px 11px' }}>
                        <DateTimeInput
                          value={window.opensAt}
                          onChange={(next) => setWindow(window.stage, { opensAt: next })}
                        />
                      </td>
                      <td style={{ padding: '7px 11px' }}>
                        <DateTimeInput
                          value={window.closesAt}
                          onChange={(next) => setWindow(window.stage, { closesAt: next })}
                        />
                      </td>
                      <td style={{ padding: '9px 11px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {window.durationHours}h
                        <div style={{ fontSize: 10.5, color: color.textSecondary }}>
                          {daysBetween(window.opensAt, window.closesAt)} days
                        </div>
                      </td>
                      <td style={{ padding: '9px 11px', whiteSpace: 'nowrap', color: color.textSecondary }}>
                        {window.stage === 'AUCTION'
                          ? '—'
                          : new Date(window.clarificationsCloseAt).toLocaleString([], DATE_FORMAT)}
                      </td>
                      <td style={{ padding: '9px 11px' }}>
                        {edited && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...draft.stageWindowOverrides };
                              delete next[window.stage];
                              patch({ stageWindowOverrides: next });
                            }}
                            style={{
                              border: 'none', background: 'none', color: color.brandPrimary,
                              cursor: 'pointer', fontSize: 11.5, padding: 0,
                            }}
                          >
                            Reset
                          </button>
                        )}
                        {rowIssues.length > 0 && (
                          <div style={{ fontSize: 10.5, color: rowIssues.some((i) => i.blocking) ? color.dangerText : color.warningText }}>
                            {rowIssues.map((i) => i.message).join(' ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div>
        <SectionHeading hint="Set once, applied to every ask this event creates — and frozen onto them at publish.">
          Rules for moving a date
        </SectionHeading>

        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))',
            gap: 12, marginTop: 10,
          }}
        >
          <Field
            label="Extensions allowed per ask"
            hint="Zero forbids extension outright."
          >
            <NumberInput
              value={rules.maxExtensions}
              onChange={(e) => setRules({ maxExtensions: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <Field label="Most one extension may add (hours)">
            <NumberInput
              value={rules.maxExtensionHoursEach}
              onChange={(e) => setRules({ maxExtensionHoursEach: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Most all extensions may add (hours)" hint="The total budget across an ask.">
            <NumberInput
              value={rules.maxTotalExtensionHours}
              onChange={(e) => setRules({ maxTotalExtensionHours: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field
            label="Second approver needed beyond (hours)"
            hint="A long extension is a commercial decision, not an administrative one."
          >
            <NumberInput
              value={rules.approvalRequiredBeyondHours}
              onChange={(e) => setRules({ approvalRequiredBeyondHours: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Minimum window per ask (hours)" hint="A floor the schedule is checked against.">
            <NumberInput
              value={rules.minResponseWindowHours}
              onChange={(e) => setRules({ minResponseWindowHours: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Clarifications close before each deadline (hours)">
            <NumberInput
              value={rules.clarificationCutoffHours}
              onChange={(e) => setRules({ clarificationCutoffHours: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="rfx-stack" style={{ gap: 10, marginTop: 12 }}>
          <Field
            label="When an ask is extended"
            hint="An extension either pushes everything behind it, or is absorbed so the event still ends when it always did."
          >
            <Segmented
              value={rules.cascade}
              onChange={(cascade) => setRules({ cascade })}
              options={[
                { value: 'SHIFT', label: 'Shift the asks behind it' },
                { value: 'ABSORB', label: 'Absorb it — keep the end date' },
              ]}
            />
          </Field>

          <Toggle
            checked={rules.allowReopenAfterClose}
            onChange={(allowReopenAfterClose) => setRules({ allowReopenAfterClose })}
            label="Allow a closed ask to be reopened"
          />
          {rules.allowReopenAfterClose && (
            <Field
              label="Reopening allowed for (hours after close)"
              hint="Reopening after suppliers have seen the field close is a fairness question. Keep the window short."
            >
              <NumberInput
                value={rules.reopenWithinHours}
                onChange={(e) => setRules({ reopenWithinHours: Number(e.target.value) || 0 })}
              />
            </Field>
          )}

          {stages.includes('AUCTION') && (
            <>
              <Toggle
                checked={rules.autoExtendAuction}
                onChange={(autoExtendAuction) => setRules({ autoExtendAuction })}
                label="Soft close: a late bid extends the live auction"
              />
              {rules.autoExtendAuction && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
                  <Field label="Extend by (minutes)" hint="Applied to every bidder, not just the late one.">
                    <NumberInput
                      value={rules.autoExtendMinutes}
                      onChange={(e) => setRules({ autoExtendMinutes: Number(e.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="Most automatic extensions" hint="A cap, so an auction cannot run all night.">
                    <NumberInput
                      value={rules.maxAutoExtensions}
                      onChange={(e) => setRules({ maxAutoExtensions: Number(e.target.value) || 0 })}
                    />
                  </Field>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <Field
            label="Tell suppliers on"
            hint="A date that moved without a notification is a date suppliers did not hear about."
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['EMAIL', 'IN_APP', 'SMS'] as NotifyChannel[]).map((channel) => {
                const on = rules.notifyChannels.includes(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => toggleChannel(channel)}
                    style={{
                      border: `1px solid ${on ? color.brandPrimary : color.border}`,
                      background: on ? '#F5F8FF' : '#fff',
                      color: on ? color.brandPrimary : color.textSecondary,
                      borderRadius: radius.control, padding: '7px 13px', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: on ? 600 : 400,
                    }}
                  >
                    {NOTIFY_CHANNEL_LABEL[channel]}
                  </button>
                );
              })}
            </div>
          </Field>
          <div style={{ marginTop: 10, maxWidth: 340 }}>
            <Field label="Who is told">
              <Select
                value={rules.notifyAudience}
                onChange={(e) => setRules({ notifyAudience: e.target.value as NotifyAudience })}
              >
                {(Object.keys(NOTIFY_AUDIENCE_LABEL) as NotifyAudience[]).map((audience) => (
                  <option key={audience} value={audience}>{NOTIFY_AUDIENCE_LABEL[audience]}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </div>

      <ValidationBanner tone="info" title="What a buyer will have to give when they extend">
        A reason from a fixed list ({Object.values(EXTENSION_REASON_LABEL).slice(0, 3).join(', ')} and
        others), a narrative of at least {rules.minReasonLength} characters that is sent to suppliers
        verbatim, the new deadline, a corrigendum reference when one accompanies it, and a second
        approver past {rules.approvalRequiredBeyondHours}h. Every extension is kept against the ask
        with who asked, who approved and when.
      </ValidationBanner>

      {issues.filter((i) => !i.blocking).length > 0 && (
        <ValidationBanner tone="warning" title="Worth a look before you publish">
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {issues.filter((i) => !i.blocking).map((issue) => (
              <li key={`${issue.stage}-${issue.field}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </ValidationBanner>
      )}
    </div>
  );
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
};

/**
 * A date and time, edited as one field.
 *
 * `datetime-local` reads and writes local wall-clock time, which is what a
 * buyer means by "closes on Thursday at five" — the conversion to and from an
 * instant happens here so nothing downstream deals in strings.
 */
function DateTimeInput({
  value, onChange,
}: { value: number; onChange: (next: number) => void }) {
  return (
    <input
      type="datetime-local"
      value={toLocalInput(value)}
      onChange={(e) => {
        const next = new Date(e.target.value).getTime();
        if (Number.isFinite(next)) onChange(next);
      }}
      style={{
        width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
        padding: '8px 10px', fontSize: 13, background: '#fff', color: color.textPrimary,
        fontFamily: 'inherit',
      }}
    />
  );
}

function toLocalInput(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

/** One line per point the supplier is asked something, for the review table. */
function questionnaireSummary(draft: Draft): React.ReactNode {
  const asked = draft.questionnaires.filter((q) => q.questions.length > 0);
  if (asked.length === 0) return <em style={{ color: color.textMuted }}>nothing asked</em>;
  return asked
    .map((q) => {
      const scored = q.questions.filter(isScored).length;
      return `${pointLabel(q.point)} · ${q.questions.length}q${scored > 0 ? ` · ${scored} scored` : ' · gathers only'}`;
    })
    .join('  ·  ');
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
    ['Bidders', bidderSummary(draft)],
    ['Envelope mode', draft.envelopeMode],
    ['Questionnaire', questionnaireSummary(draft)],
    // Terms are on the review because publish is blocked without them: seeing
    // what is attached here is what makes a blocking line on the right legible.
    ['Terms', describeTerms(draft.terms)],
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
