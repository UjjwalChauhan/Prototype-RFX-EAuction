/**
 * Pack 04 — Create Event wizard.
 *
 * The stepper reshapes per journey pattern (4 steps to 9) without losing work:
 * `draft` is one object, and switching patterns only changes which steps are
 * shown, never what has been entered.
 */
import React from 'react';
import { BASE_CURRENCY, color, font, money, radius, type } from '../design-system/tokens';
import {
  Button, Checkbox, Chip, Field, NumberInput, Radio, SectionHeading, Segmented, Select, TextInput, Textarea, Toggle,
} from '../design-system/components/primitives';
import { Card, Empty, Table, type Column } from '../design-system/components/layout';
import {
  Drawer, Modal, ValidationBanner, type ValidationItem,
} from '../design-system/components/domain';
import { SCOPE_LABELS, TENANT_DEFAULTS, resolve, resolveAccumulated } from '../domain/config';
import {
  QUESTION_TYPES_BY_GROUP, QUESTION_TYPE_SPEC, typeLabel, usesFacet,
} from '../domain/questionTypes';
import {
  POINT_PURPOSE, PRICED_QUESTION_TYPES, QUESTION_SCOPE_LABEL, STRUCTURAL_TYPES,
  TEMPLATE_CUSTOM_KEY,
  addDraftQuestion, blankQuestionnaire, categorySlug, draftFromTemplate, effectiveScope,
  nextTemplateId, pointsAsking, templateFromDraft,
  removeDraftSection, renameDraftSection, sectionBudgets, setAskedAtPoints, weightCeilingFor,
  type SectionBudget, draftAsTemplate, instantiateTemplate, isScored, moveDraftQuestion,
  normalise, pointLabel, removeDraftQuestion,
  addDraftSection, seedQuestionnaires, setDraftScored, setDraftType,
  templatesFor, validateTemplate, type DraftQuestionnaire,
} from '../domain/questionnaireTemplates';
import {
  answerLoad, audienceIssues, audienceOf, audienceSummary, commonAudience, narrowedQuestions,
  pruneAudience, resolveAudience, setAudienceOnAll, type AudienceRoster,
} from '../domain/questionAudience';
import {
  ALL_PATTERNS, JOURNEY_PATTERNS, STAGE_LABELS, patternsForSide,
} from '../domain/journeyPatterns';
import { invitesVendors } from '../domain/journeyComposer';
import { mechanismGuidance } from '../domain/auctionEngine';
import { DEFAULT_ANTI_GAMING } from '../domain/auctionEngine';
import { directionLabel } from '../domain/comparator';
import { mechanismLabel } from '../domain/auctionRules';
import {
  auctionRecords, linesOfRequisition, sourcingRequisition, useStore, type AppState,
} from '../store/store';
import { ApiError, sourcingApi } from '../api/client';
import { QuestionnaireImportDrawer } from './QuestionnaireImport';
import { QuestionnaireDesignerDrawer } from './QuestionnaireDesigner';
import { serverNow } from '../server/clock';
import {
  solicitationStagesOf, stageWindows, type SolicitationStage, type SourcingEventInput,
} from '../domain/stageEvents';
import {
  DEFAULT_TIMELINE_RULES, EXTENSION_REASON_LABEL, NOTIFY_AUDIENCE_LABEL, NOTIFY_CHANNEL_LABEL,
  daysBetween, describeRules, roundToNextHour, validateSchedule,
  type NotifyAudience, type NotifyChannel, type TimelineRules,
} from '../domain/eventTimeline';
import {
  ACKNOWLEDGEMENT_LABEL, ACKNOWLEDGEMENT_SHORT, DEFAULT_PAYMENT_TERMS, PAYMENT_TRIGGER_LABEL,
  TERMS_CATEGORIES, TERMS_CATEGORY_LABEL, TERMS_CATEGORY_PURPOSE, alignTermsToJourney,
  blankTerms, describeTerms, instantiateTerms, paymentClauseText, paymentSummary, syncPaymentClauses,
  termsForPoint, validateTerms,
  type Acknowledgement, type PaymentTerms, type TermsCategory, type TermsClause, type TermsDocumentInput,
  type TermsTemplate,
} from '../domain/terms';
import { TERMS_TEMPLATES } from '../data/termsTemplates';
import { PURCHASE_REQUESTS, PURCHASE_REQUEST_LINES } from '../data/purchaseRequests';
import { suggestedTitle, toConsolidatedLines } from '../domain/sourcingRequisition';
import { categoriesOf } from '../domain/purchaseRequests';
import {
  MIN_BIDDERS_PER_CATEGORY, biddersByCategory, defaultShortlist, servesCategory,
  suggestBidders, validateCoverage, validateLineCoverage, validateRoster,
} from '../domain/bidders';
import { QuestionnairePreview } from './QuestionnairePreview';
import { CATEGORY_IDS } from '../data/procurementCategories';
import { COUNTERPARTIES, DOA_RULES, SCOPE_LINEAGE } from '../data/seed';
import { simulate } from '../domain/doa';
import { eventApprovalSteps } from '../domain/employeePortal';
import {
  EVALUATORS, GATE_HISTORY, RUBRIC_SCALES, evaluatorById, evaluatorName, rubricName,
  type EvaluatorProfile,
} from '../data/evaluators';
import {
  candidatesFor, combinedFormula, commercialNeeded, decisiveGate, evaluatedStages, evaluationGaps,
  fillEvaluatorGaps, gateOf, judgesMerit, opensPrice, stageKind, stageQuestions, technicalNeeded,
  usesKnockouts, usesScore, withEvaluators, wouldQualify,
  type EvaluatedStage, type EvaluationGap, type EvaluationSetup, type EvaluatorRole, type GapTarget,
  type GateKind, type StageFacts, type StageKind,
} from '../domain/evaluationSetup';
import {
  BUDGET_LINES, DEFAULT_ENTITY, ENTITIES, costCentresOf, entityById,
} from '../data/sourcingFields';
import { Icon, type AdminIconName } from './AdminIcons';
import { autoFix, canAutoFix, type AutoFixChange, type AutoFixContext } from './wizardAutoFix';
import type {
  AuctionMechanism, ConfigSetting, FeedbackPolicy, JourneyPatternId, QuestionAudience, QuestionEnvelope,
  QuestionScope,
  QuestionnaireTemplate, TemplateQuestion,
  Side, SourcingRequisition, VendorInputPoint,
} from '../domain/types';
import type { Counterparty, EnvelopeMode } from '../domain/types';
import {
  ENVELOPE_EXPLAINER, ENVELOPE_OPTIONS, ENVELOPE_SHORT, ENVELOPE_STAGES, envelopeFor, envelopeWarning,
  eventEnvelope,
} from '../domain/envelope';
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
   * The vendors on the event, in the order they were added. A vendor can sit
   * here with nothing ticked against them — that is a roster, not an
   * invitation, and publishing says so rather than inventing an ask.
   */
  vendorIds: string[];
  /**
   * Who is invited to price which line, keyed by line id.
   *
   * One flat bidder list across a consolidated event asks a laptop supplier to
   * price hydraulic pumps, and a list per category still cannot say that one
   * vendor prices the monitors but not the switch. The invitation is recorded
   * at the grain it is made at; the shortlist per category is derived from it.
   */
  invitedByLine: Record<string, string[]>;
  /**
   * Categories whose opening roster has already been proposed from the vendor
   * master. Remembered so a vendor the buyer removed is never put back, and a
   * line added later in a new category still gets a proposal.
   */
  seededCategories: string[];
  /**
   * One questionnaire per point in the journey where the supplier is asked for
   * something. Held on the draft rather than fetched at publish so edits made
   * here survive stepping backwards and forwards through the wizard.
   */
  questionnaires: DraftQuestionnaire[];
  /** Envelope mode per RFI / RFP / RFQ stage; unset stages use the stage default. */
  envelopeByStage: Partial<Record<string, EnvelopeMode>>;
  /**
   * Per stage: the gate, the rubric and who judges it, plus the rules every
   * stage runs under. See `domain/evaluationSetup`.
   */
  evaluation: EvaluationSetup;
  /**
   * Hold the event for its DoA chain before any supplier sees it. The chain
   * itself is not chosen here — it resolves from value, category and BU.
   */
  routeForApproval: boolean;
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
  /** The legal entity the event is raised under. It decides the currency. */
  entity: string;
  /** Decides the business unit, and with it the DoA chain. */
  costCentre: string;
  /** What the award is committed against. Required alongside the cost centre. */
  budgetLine: string;
  projectCode: string;
  internalReference: string;
  /**
   * Documents attached at Basics. Public ones go out with the invitation;
   * private ones stay with the buying team whatever the event's visibility.
   */
  documents: EventDocument[];
}

export interface EventDocument {
  id: string;
  name: string;
  /** In bytes, as the browser reported it. */
  size: number;
  visibility: 'PUBLIC' | 'PRIVATE';
}

/** The pattern a draft opens on before the buyer chooses one. */
const OPENING_PATTERN: JourneyPatternId = 'JP-02';

const BLANK_DRAFT: Draft = {
  side: 'BUY',
  pattern: OPENING_PATTERN,
  title: '',
  description: '',
  category: 'Indirect',
  businessUnit: 'Corporate Services',
  currency: BASE_CURRENCY,
  sourceReference: '',
  sourceRequestNumbers: [],
  lines: [
    { id: 'dl-1', itemCode: 'PPR-A4-80', description: 'A4 copier paper, 80gsm, ream of 500', specification: 'ISO brightness 96+, FSC certified', quantity: 12_000, uom: 'ream', deliveryLocation: 'Dubai DC', needBy: '', baselinePrice: 8.67, lotName: 'Lot 1 · Paper', category: 'Indirect', superCategory: 'Office & Administrative' },
    { id: 'dl-2', itemCode: 'PEN-BLU-BX', description: 'Ballpoint pen, blue, box of 50', specification: '0.7mm, retractable', quantity: 900, uom: 'box', deliveryLocation: 'Dubai DC', needBy: '', baselinePrice: 18.5, lotName: 'Lot 2 · Writing', category: 'Indirect', superCategory: 'Office & Administrative' },
  ],
  // Seeded per category when the Items & Vendors step is first opened, from
  // the vendor master.
  vendorIds: [],
  invitedByLine: {},
  seededCategories: [],
  // Populated when the Questionnaire step is first opened, from the library
  // templates that apply at this journey's points.
  questionnaires: [],
  envelopeByStage: {},
  evaluation: {
    // Gates follow each stage's kind until the buyer sets one.
    gates: {},
    // The category lead is on the standing panel, so is named to begin with.
    // The second technical evaluator and the commercial one are the buyer's
    // to choose — the step says so rather than guessing on their behalf.
    technicalEvaluators: { RFI: ['user-ar'], RFP: ['user-ar'] },
    commercialEvaluators: {},
    technicalWeight: 40,
    blindTechnical: TENANT_DEFAULTS['evaluation.blind_technical'] as boolean,
    consensus: 'MODERATED',
    divergenceThreshold: TENANT_DEFAULTS['evaluation.divergence_threshold'] as number,
    unlockWitness: false,
    notifyResult: 'AT_AWARD',
    negotiationShortlist: 3,
  },
  routeForApproval: true,
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
  entity: DEFAULT_ENTITY.id,
  costCentre: 'CC-1104',
  budgetLine: 'OPEX · Office consumables',
  projectCode: '',
  internalReference: '',
  // Demonstration attachments, so the two audiences read as two from the start.
  documents: [
    { id: 'doc-1', name: 'Technical_specification_v3.pdf', size: 1_200_000, visibility: 'PUBLIC' },
    { id: 'doc-2', name: 'Site_layout_BlockC.dwg', size: 840_000, visibility: 'PUBLIC' },
    { id: 'doc-3', name: 'Budget_approval_NFA-882.pdf', size: 320_000, visibility: 'PRIVATE' },
  ],
};

/**
 * The draft a buyer actually opens on, roster included.
 *
 * The proposal is applied here rather than waited for on the Items step, so
 * the readiness rail is telling the truth from the first screen instead of
 * reporting an empty event until the buyer walks far enough to be told who is
 * on it.
 */
export const INITIAL_DRAFT: Draft = {
  ...BLANK_DRAFT,
  ...seedRoster(BLANK_DRAFT, categoryGroupsOf(BLANK_DRAFT)),
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
  const byCategory = invitedByCategoryOf(draft);
  return groups
    .map((g) => `${g.category} · ${(byCategory[g.category] ?? []).length}`)
    .join('  ·  ');
}

/**
 * The opening roster, proposed per category from the vendor master.
 *
 * Each category opens on the strongest suppliers that serve it, already ticked
 * against the lines in that category, so the buyer starts from a real grid and
 * edits it rather than building one from nothing. Seeding is remembered per
 * category: a line added later in a new category still gets a proposal, and a
 * vendor the buyer removed is never silently put back.
 *
 * It runs at the wizard rather than inside the step, because the readiness
 * rail is visible from the first screen and an empty roster is a blocking
 * item. A buyer on Basics should not be told the event has nobody on it only
 * because they have not walked to the step that would have said who.
 */
function seedRoster(draft: Draft, groups: CategoryGroup[]): Partial<Draft> | null {
  const pending = groups.filter((g) => !draft.seededCategories.includes(g.category));
  if (pending.length === 0) return null;
  const vendorIds = [...draft.vendorIds];
  const invitedByLine: Record<string, string[]> = { ...draft.invitedByLine };
  for (const group of pending) {
    const shortlist = defaultShortlist(COUNTERPARTIES, group.category, group.superCategory);
    for (const id of shortlist) if (!vendorIds.includes(id)) vendorIds.push(id);
    for (const line of group.lines) {
      invitedByLine[line.id] = [...new Set([...(invitedByLine[line.id] ?? []), ...shortlist])];
    }
  }
  return {
    vendorIds,
    invitedByLine,
    seededCategories: [...draft.seededCategories, ...pending.map((g) => g.category)],
  };
}

/**
 * The shortlist per category, read back out of the per-line invitations. A
 * line with no category of its own sits in the event's, which is the same
 * reading `categoryGroupsOf` takes.
 */
export function invitedByCategoryOf(draft: Draft): Record<string, string[]> {
  return biddersByCategory(
    draft.lines.map((l) => ({ id: l.id, category: l.category || draft.category })),
    draft.invitedByLine,
  );
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
function costCentreOfRequisition(requisition: SourcingRequisition, state: AppState): string {
  const requestIds = new Set(linesOfRequisition(state, requisition).map((l) => l.requestId));
  const centres = new Set(
    state.purchaseRequests
      .filter((r) => requestIds.has(r.id))
      .map((r) => r.costCentre)
      .filter(Boolean),
  );
  return centres.size === 1 ? [...centres][0] : '';
}

function draftFromRequisition(
  requisition: SourcingRequisition,
  state: AppState,
): Draft {
  const lines = linesOfRequisition(state, requisition);
  const requests = state.purchaseRequests;
  const consolidated = toConsolidatedLines(lines, requests);

  const seeded: Draft = {
    ...INITIAL_DRAFT,
    title: suggestedTitle(lines, requests),
    description:
      `Raised against ${requisition.prdNumber}, consolidating ${lines.length} `
      + `${lines.length === 1 ? 'line' : 'lines'} from ${requisition.requestNumbers.join(', ')}.`,
    category: requisition.category,
    businessUnit: requisition.businessUnits[0] ?? INITIAL_DRAFT.businessUnit,
    currency: requisition.currency,
    entity: ENTITIES.find((e) => e.currency === requisition.currency)?.id ?? INITIAL_DRAFT.entity,
    // The requisitions' own cost centre where they agree on one; otherwise the
    // buyer picks, and the budget line is always theirs to confirm.
    costCentre: costCentreOfRequisition(requisition, state),
    budgetLine: '',
    documents: [],
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
    // The opening roster belongs to these lines, not to the blank draft's.
    vendorIds: [], invitedByLine: {}, seededCategories: [],
  };
  return { ...seeded, ...seedRoster(seeded, categoryGroupsOf(seeded)) };
}

export function CreateEventWizard({
  onNavigate, prdId,
}: { onNavigate: (route: Route) => void; prdId?: string }) {
  const { state, dispatch } = useStore();

  // A draft saved earlier is picked up again — unless the buyer came here from
  // a requisition, which is a new event by definition.
  const [restored] = React.useState(() => (prdId ? null : readSavedDraft()));
  const [requisitionId, setRequisitionId] = React.useState<string | undefined>(
    prdId ?? restored?.requisitionId ?? undefined,
  );
  const requisition = sourcingRequisition(state, requisitionId);

  const [draft, setDraft] = React.useState<Draft>(() => {
    if (restored) return { ...INITIAL_DRAFT, ...restored.draft };
    const from = sourcingRequisition(state, prdId);
    return from ? draftFromRequisition(from, state) : INITIAL_DRAFT;
  });
  const [step, setStep] = React.useState(restored?.step ?? 0);
  const [savedAt, setSavedAt] = React.useState<number | null>(restored?.savedAt ?? null);
  const [restoredNotice, setRestoredNotice] = React.useState(Boolean(restored));
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [switchWarning, setSwitchWarning] = React.useState<JourneyPatternId | null>(null);

  const pattern = JOURNEY_PATTERNS[draft.pattern];
  const steps = pattern.wizardSteps;
  const currentStep = Math.min(step, steps.length - 1);
  const stepName = steps[currentStep];

  /** Whether the buyer has changed anything — only then does discarding need to ask. */
  const [edited, setEdited] = React.useState(Boolean(restored));
  const patch = (next: Partial<Draft>) => {
    setEdited(true);
    setDraft((d) => ({ ...d, ...next }));
  };

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

  /**
   * The pattern a recommendation replaced, kept so the banner can offer to put
   * it back. Any choice the buyer makes by hand forgets it.
   */
  const [patternBefore, setPatternBefore] = React.useState<JourneyPatternId | null>(null);
  const recommended = recommendedPattern(draft.side);
  const choosePattern = (next: JourneyPatternId) => {
    setPatternBefore(null);
    applyPattern(next);
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
  /** Whether this journey puts anything in front of a supplier to compete for. */
  const showVendors = invitesVendors(pattern.stages);
  const seeding = showVendors ? seedRoster(draft, lineCategories) : null;
  React.useEffect(() => {
    // The system's own seeding is not an edit the buyer would lose.
    if (seeding) setDraft((d) => ({ ...d, ...seeding }));
  });

  const invitedByCategory = invitedByCategoryOf(draft);
  const allBidderIds = Array.from(
    new Set(lineCategories.flatMap((g) => invitedByCategory[g.category] ?? [])),
  );
  /**
   * Coverage is judged twice, because the two failures are different. A line
   * nobody was ticked against goes out and comes back empty; a category with
   * two vendors in it comes back, and comes back uncompetitive. The per-line
   * check reports the first; only the warnings from the per-category check are
   * kept, since an empty category is already an empty line said twice.
   */
  const coverage = showVendors
    ? [
      ...validateRoster(draft.vendorIds, allBidderIds, COUNTERPARTIES),
      ...validateLineCoverage(
        draft.lines.map((l) => ({
          id: l.id,
          itemCode: l.itemCode,
          description: l.description,
          invitedIds: draft.invitedByLine[l.id] ?? [],
        })),
        COUNTERPARTIES,
      ),
      ...validateCoverage(
        lineCategories.map((g) => ({
          category: g.category, bidderIds: invitedByCategory[g.category] ?? [],
        })),
        COUNTERPARTIES,
      ).filter((issue) => issue.tone === 'warning'),
    ]
    : [];

  const lotNames = [...new Set(draft.lines.map((l) => l.lotName))];
  const estimatedValue = draft.lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);

  const guidance = mechanismGuidance(draft.mechanism, allBidderIds.length, draft.lines.length);

  const createdStages = solicitationStagesOf(draft.pattern);
  const schedulePreview = stageWindows(createdStages, timelineInput(draft), draft.startAt);
  const scheduleIssues = validateSchedule(schedulePreview, draft.timelineRules, Date.now());
  const termsIssues = validateTerms(draft.terms, pattern.vendorInputPoints);

  /** The step a check is fixed on, so every readiness line can take the buyer there. */
  const on = (name: string) => (steps.includes(name) ? name : undefined);

  /**
   * What evaluation has to work with at each stage. The questions are the
   * questionnaire as the buyer has shaped it — or, at a point not opened yet,
   * as the Questionnaire step would seed it — so a gate is judged against the
   * questions suppliers will actually be asked.
   */
  const hasEvaluation = steps.includes('Evaluation');
  const factsOf = (d: Draft): StageFacts[] => {
    const names = categoryGroupsOf(d).map((g) => g.category);
    const asked = seedQuestionnaires({
      existing: d.questionnaires,
      points: questionnairePoints,
      library: questionnaireLibrary(names.length === 0 ? [null] : names, state.configSettings),
      categories: names,
      idSeed: 'draft',
    });
    return evaluatedStages(pattern.stages).map((stage) => ({
      stage,
      kind: stageKind(stage, pattern.stages),
      questions: stageQuestions(asked.filter((q) => q.point === stage).flatMap((q) => q.questions)),
    }));
  };
  const evaluationFacts: StageFacts[] = factsOf(draft);
  const evaluationIssues = hasEvaluation
    ? evaluationGaps(draft.evaluation, evaluationFacts, draftEnvelope(draft), evaluatorName)
    : [];

  /**
   * Where the Evaluation step should look. Set from the readiness rail and the
   * assistant as well as the step itself, so "add" next to a gap lands on the
   * control that closes it, from wherever the buyer is.
   */
  const [evaluationFocus, setEvaluationFocus] = React.useState<{
    stage: EvaluatedStage | null; target: GapTarget | null; nonce: number;
  }>({ stage: null, target: null, nonce: 0 });
  const [evaluationOverlay, setEvaluationOverlay] = React.useState<'preview' | 'history' | null>(null);
  const focusEvaluation = (stage: EvaluatedStage | null, target: GapTarget | null) => {
    setEvaluationFocus((f) => ({ stage, target, nonce: f.nonce + 1 }));
    if (stepName !== 'Evaluation') goToStep('Evaluation');
  };

  const meritFacts = evaluationFacts.filter((f) => judgesMerit(f.kind));
  const judgedOn = new Set(
    meritFacts.flatMap((f) => [...f.questions.scored, ...f.questions.knockouts].map((q) => q.id)),
  ).size;
  const evaluationChecks: StepCheck[] = !hasEvaluation ? [] : [
    ...(meritFacts.length > 0 && !evaluationIssues.some((g) => g.target === 'GATE')
      ? [{
        tone: 'success' as const,
        step: 'Evaluation',
        text: `Every scored stage has a real gate — ${meritFacts
          .map((f) => `${STAGE_LABELS[f.stage]} ${gateSummary(gateOf(draft.evaluation, f.stage, f.kind).gate, gateOf(draft.evaluation, f.stage, f.kind).minScore)}`)
          .join(', ')}`,
      }]
      : []),
    ...(judgedOn > 0
      ? [{ tone: 'success' as const, step: 'Evaluation', text: `Knockouts and scores come from ${judgedOn} questionnaire questions` }]
      : []),
    ...evaluationIssues.map((gap) => ({
      tone: gap.tone,
      text: gap.text,
      blocking: gap.blocking,
      step: 'Evaluation',
      fix: gap.target ? { label: GAP_FIX_LABEL[gap.target], run: () => focusEvaluation(gap.stage, gap.target) } : undefined,
    })),
  ];

  const validation: StepCheck[] = [
    // The field carries a required marker, so the check holds publish to it.
    // An event that goes out as "Untitled event" is one no supplier can find.
    draft.title.trim()
      ? { tone: 'success', text: `Title set — "${draft.title}"`, step: 'Basics' }
      : { tone: 'error', text: 'Give the event a title', blocking: true, step: 'Basics' },
    { tone: 'success', text: `${pattern.name} · ${directionLabel(draft.side)}`, step: 'Basics' },
    // An award has to be committed against something, and the DoA chain has
    // to resolve against a unit — both come from these two.
    draft.costCentre && draft.budgetLine
      ? { tone: 'success', text: `${draft.costCentre} · ${draft.budgetLine}`, step: 'Basics' }
      : {
        tone: 'error', blocking: true, step: 'Basics',
        text: !draft.costCentre && !draft.budgetLine ? 'Choose a cost centre and a budget line'
          : !draft.costCentre ? 'Choose a cost centre' : 'Choose a budget line',
      },
    { tone: draft.lines.length > 0 ? 'success' : 'error', text: draft.lines.length > 0 ? `${draft.lines.length} lines across ${lotNames.length} lot(s)` : 'Add at least one line to source', blocking: draft.lines.length === 0, step: on('Items & Vendors') },
    // Coverage is judged per category: a healthy total across a consolidated
    // event can still leave one category with a single supplier in it.
    ...coverage.map((issue) => ({
      tone: issue.tone, text: issue.message, blocking: issue.blocking, step: on('Items & Vendors'),
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
        step: on('Timeline'),
      }]
      : scheduleIssues.map((issue) => ({
        tone: issue.blocking ? ('error' as const) : ('warning' as const),
        text: issue.message,
        blocking: issue.blocking,
        step: on('Timeline'),
      }))),
    {
      tone: 'success' as const,
      text: describeRules(draft.timelineRules),
      step: on('Timeline'),
    },
    // Terms are judged per ask: general conditions everywhere, payment terms
    // wherever a price is asked. Publishing without them is blocked, not warned.
    ...(termsIssues.length === 0
      ? [{ tone: 'success' as const, text: describeTerms(draft.terms), step: on('Terms') }]
      : termsIssues.map((issue) => ({
        tone: issue.blocking ? ('error' as const) : ('warning' as const),
        text: issue.message,
        blocking: issue.blocking,
        step: on('Terms'),
      }))),
    ...questionnaireValidation(draft, questionnairePoints).map((item) => ({
      ...item, step: on('Questionnaire'),
    })),
    ...evaluationChecks,
  ];

  const blocked = validation.some((v) => v.blocking);
  const blockers = validation.filter((v) => v.blocking);

  /**
   * Which steps have been opened. A step's problems are only flagged in the
   * stepper once the buyer has been there — red marks on steps nobody has
   * reached yet read as "you already got this wrong".
   */
  const [visited, setVisited] = React.useState<Set<string>>(() => new Set(['Basics']));
  const goTo = (index: number) => {
    const target = Math.max(0, Math.min(index, steps.length - 1));
    setVisited((v) => new Set(v).add(stepName).add(steps[target]));
    setStep(target);
    window.scrollTo?.({ top: 0 });
  };
  const goToStep = (name: string) => goTo(steps.indexOf(name));
  const isLast = currentStep === steps.length - 1;
  // Reaching Review means everything is about to be judged at once.
  const showAllIssues = isLast || visited.has('Review');
  const stepStatus = (name: string): StepState => {
    if (name === stepName) return 'current';
    const own = validation.filter((v) => v.step === name);
    const seen = visited.has(name) || showAllIssues;
    if (seen && own.some((v) => v.blocking)) return 'blocked';
    if (seen && own.some((v) => v.tone === 'warning')) return 'warning';
    return visited.has(name) ? 'done' : 'todo';
  };

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const leave = () => onNavigate({ name: 'board' });

  // The draft is kept in this browser as it changes, so leaving — to link a
  // PR, or for the day — loses nothing. Untouched drafts are not saved.
  React.useEffect(() => {
    if (!edited) return;
    const timer = window.setTimeout(() => {
      const at = Date.now();
      if (writeSavedDraft({ draft, step: currentStep, savedAt: at, requisitionId: requisitionId ?? null })) {
        setSavedAt(at);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, currentStep, edited, requisitionId]);

  const saveAndClose = () => {
    writeSavedDraft({ draft, step: currentStep, savedAt: Date.now(), requisitionId: requisitionId ?? null });
    leave();
  };
  const discard = () => {
    clearSavedDraft();
    leave();
  };

  /**
   * Linking a requisition takes its lines, category, cost centre and currency,
   * and keeps everything the buyer has already decided here.
   */
  const [linkOpen, setLinkOpen] = React.useState(false);
  const linkRequisition = (picked: SourcingRequisition) => {
    const from = draftFromRequisition(picked, state);
    setEdited(true);
    setDraft((d) => ({
      ...from,
      title: d.title.trim() ? d.title : from.title,
      description: d.description.trim() ? d.description : from.description,
      side: d.side, pattern: d.pattern, terms: d.terms, documents: d.documents,
      projectCode: d.projectCode, internalReference: d.internalReference,
      budgetLine: d.budgetLine,
      costCentre: from.costCentre || d.costCentre,
    }));
    setRequisitionId(picked.id);
    setLinkOpen(false);
  };

  const showPatternPicker = () => {
    if (stepName !== 'Basics') goToStep('Basics');
    window.setTimeout(() => {
      document.getElementById('journey-pattern')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  /** Required fields on Basics, in the order they sit on the page. */
  const basicsFields = [
    { label: 'Event title', done: Boolean(draft.title.trim()), required: true },
    { label: 'Category', done: Boolean(draft.category), required: true },
    { label: 'Entity & currency', done: Boolean(draft.entity && draft.currency), required: true },
    { label: 'Cost centre & budget line', done: Boolean(draft.costCentre && draft.budgetLine), required: true },
    { label: 'Journey pattern', done: true, required: true },
    { label: 'Description — optional, helps suppliers', done: Boolean(draft.description.trim()), required: false },
  ];
  const movedOn = visited.size > 1;


  /**
   * Auto-fix. The fixes are applied straight away and listed, with the draft
   * they replaced kept so one click puts everything back.
   */
  const [fixReport, setFixReport] = React.useState<{
    changes: AutoFixChange[]; before: Draft; scope: string;
  } | null>(null);
  const fixContext: AutoFixContext = {
    questionnairePoints,
    inputPoints: pattern.vendorInputPoints,
    stages: createdStages,
    showVendors,
    hasEvaluation,
    factsOf,
    costCentres: costCentresOf(state.purchaseRequests),
    now: Date.now(),
  };
  // A report belongs to the step it was run on; moving on clears it.
  React.useEffect(() => { setFixReport(null); }, [stepName]);
  const fixableSteps = steps.filter((name) => canAutoFix(name) && validation.some((v) => v.step === name && v.blocking));
  const runAutoFix = (only?: string[]) => {
    const before = draft;
    const result = autoFix(draft, fixContext, only);
    if (result.changes.length > 0) {
      setEdited(true);
      setDraft(result.draft);
      setVisited((v) => new Set([...v, ...result.changes.map((c) => c.step)]));
    }
    setFixReport({ changes: result.changes, before, scope: only?.length === 1 ? only[0] : 'all steps' });
  };

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
    // 2 — Items & Vendors
    lines: draft.lines.map((line) => ({
      // Carried so that anything recorded against a draft line — which lines a
      // question is asked about, above all — can be remapped onto the id the
      // published line item gets, rather than silently dropped.
      clientId: line.id,
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
      (invitedByCategory[group.category] ?? []).map((counterpartyId) => {
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
        category: q.category,
        sourceTemplateId: q.templateId,
        // The sections and the scale go with the questions: the event has to
        // be able to report a score per section, and it cannot do that from
        // section ids alone.
        sections: q.sections,
        scoreScale: q.scoreScale,
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
          askedPer: question.askedPer,
          config: question.config,
          // Who it is put to, where the buyer narrowed it. Absent means
          // everyone, which is what most questions are.
          askedOf: q.audience?.[question.id],
        })),
      })),
    // 5 — Terms: several documents, each applied where it belongs
    terms: draft.terms,
    // 6 — Evaluation. The single gate is the one that decides who reaches
    // price; the stages behind it travel only when the buyer set them here.
    evaluation: {
      envelopeMode: draftEnvelope(draft),
      envelopeByStage: Object.fromEntries(
        solicitationStagesOf(draft.pattern)
          .filter((st) => ENVELOPE_STAGES.includes(st as never))
          .map((st) => [st, envelopeFor(draft.envelopeByStage, st)]),
      ),
      ...decisiveGate(draft.evaluation, pattern.stages),
      technicalWeight: draft.evaluation.technicalWeight,
      commercialWeight: 100 - draft.evaluation.technicalWeight,
      ...(hasEvaluation ? {
        stages: evaluationFacts.map((f) => {
          const gate = gateOf(draft.evaluation, f.stage, f.kind);
          return {
            stage: f.stage,
            gate: gate.gate,
            minScore: gate.minScore,
            rubricId: gate.rubricId,
            technicalEvaluatorIds: draft.evaluation.technicalEvaluators[f.stage] ?? [],
            commercialEvaluatorIds: draft.evaluation.commercialEvaluators[f.stage] ?? [],
          };
        }),
        blindTechnical: draft.evaluation.blindTechnical,
        consensusMode: draft.evaluation.consensus,
        divergenceThreshold: draft.evaluation.divergenceThreshold,
        unlockWitness: draft.evaluation.unlockWitness,
        notifyTechnicalResult: draft.evaluation.notifyResult,
      } : {}),
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

  /** Who signs the event off before it goes out, from the DoA matrix. */
  const approvalChain = simulate(DOA_RULES, {
    value: estimatedValue, category: draft.category, businessUnit: draft.businessUnit,
  }).chain;
  const holdForApproval = draft.routeForApproval && approvalChain.length > 0;

  const publish = async () => {
    setPublishError(null);
    try {
      // Held for approval, the family is created as drafts — nothing reaches a
      // supplier until the last approver signs on the Employee Portal.
      const family = await sourcingApi({
        events: state.events,
        auctions: auctionRecords(state),
      }).createSourcingEvent({ ...toInput(), publish: !holdForApproval });
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
      if (holdForApproval) {
        const at = Date.now();
        dispatch({
          type: 'REQUEST_EVENT_APPROVAL',
          request: {
            id: `apr-${family.event.id}`,
            eventId: family.event.id,
            raisedById: state.currentUser.id,
            raisedByName: state.currentUser.name,
            raisedAt: at,
            amount: estimatedValue,
            currency: draft.currency,
            steps: eventApprovalSteps(approvalChain),
            status: 'PENDING',
          },
        });
      }
      // Published, so the saved draft has done its job.
      clearSavedDraft();
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

  const firstBlockerStep = blockers.find((v) => v.step)?.step;
  const stepBlockers = blockers.filter((v) => v.step === stepName);
  const missingOnBasics = basicsFields.filter((f) => f.required && !f.done).length;
  const stepSummary = stepName === 'Basics'
    ? (missingOnBasics === 0
      ? 'All required fields complete'
      : `${missingOnBasics} required ${missingOnBasics === 1 ? 'field' : 'fields'} missing`)
    : stepBlockers.length > 0
      ? `${stepBlockers.length} to fix on this step`
      : isLast ? (blocked ? `${blockers.length} ${blockers.length === 1 ? 'item blocks' : 'items block'} publishing` : 'Ready to publish')
        : 'Nothing on this step blocks publishing';
  const savedLabel = savedAt ? `Draft saved ${clockTime(savedAt)}` : null;

  const stepBody = (
    <>
      {stepName === 'Items & Vendors' && (
        <ItemsAndVendorsStep
          draft={draft}
          patch={patch}
          estimatedValue={estimatedValue}
          groups={lineCategories}
          showVendors={showVendors}
          onImportPr={() => setLinkOpen(true)}
        />
      )}
      {stepName === 'Questionnaire' && (
        <QuestionnaireStep
          draft={draft}
          patch={patch}
          points={questionnairePoints}
          categories={lineCategories.map((g) => g.category)}
        />
      )}
      {stepName === 'Terms' && (
        <TermsStep
          draft={draft}
          patch={patch}
          points={pattern.vendorInputPoints}
          patternName={pattern.name}
          questionnaireStep={steps.includes('Questionnaire') ? steps.indexOf('Questionnaire') + 1 : undefined}
          onOpenQuestionnaire={steps.includes('Questionnaire') ? () => goToStep('Questionnaire') : undefined}
        />
      )}
      {stepName === 'Evaluation' && (
        <EvaluationStep
          draft={draft}
          patch={patch}
          facts={evaluationFacts}
          gaps={evaluationIssues}
          focus={evaluationFocus}
          onFocus={focusEvaluation}
          overlay={evaluationOverlay}
          onOverlay={setEvaluationOverlay}
          stepNumber={(name) => steps.indexOf(name) + 1}
          onGoToStep={goToStep}
          auctionReady={steps.includes('Auction') && stepStatus('Auction') === 'done'}
          ownerName={state.currentUser.name}
          bidderIds={allBidderIds}
        />
      )}
      {stepName === 'Auction' && (
        <AuctionStep draft={draft} patch={patch} guidance={guidance} />
      )}
      {stepName === 'Timeline' && (
        <TimelineStep draft={draft} patch={patch} stages={createdStages} />
      )}
      {stepName === 'Review' && (
        <ReviewStep
          draft={draft}
          pattern={pattern.name}
          steps={steps}
          estimatedValue={estimatedValue}
          lotNames={lotNames}
          schedule={schedulePreview}
          blockers={blockers}
          evaluationRows={evaluationReview(draft, evaluationFacts)}
          approvalChain={approvalChain}
          onRouteForApproval={(routeForApproval) => patch({ routeForApproval })}
          onEdit={goToStep}
        />
      )}
    </>
  );

  return (
    <div className="rfx-side" style={{ gap: 16 }}>
      <div className="rfx-stack-flow" style={{ gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 24 }}>
            {savedLabel && <Chip tone="success" icon="✓">{savedLabel}</Chip>}
            {restoredNotice && (
              <span role="status" style={{ fontSize: 12, color: color.textSecondary }}>
                Picked up where you left off.{' '}
                <LinkButton
                  onClick={() => {
                    clearSavedDraft();
                    setDraft(INITIAL_DRAFT);
                    setStep(0);
                    setSavedAt(null);
                    setEdited(false);
                    setRequisitionId(undefined);
                    setRestoredNotice(false);
                  }}
                >
                  Start a new event instead
                </LinkButton>
              </span>
            )}
          </div>
          <Button variant="tertiary" onClick={() => (edited || savedAt ? setCancelOpen(true) : leave())}>
            Discard draft
          </Button>
        </div>

        <Card padded={false}>
          <WizardProgress
            steps={steps}
            status={stepStatus}
            issueCount={(name) => validation.filter((v) => v.step === name && v.blocking).length}
            onGo={goTo}
            note={`${steps.length} steps for ${pattern.name}.${steps.includes('Auction') ? '' : ' An Auction step is added only when you choose an auction pattern.'}`}
          />
        </Card>

        <AutoFixBar
          report={fixReport}
          stepName={stepName}
          stepIssues={canAutoFix(stepName) && (stepName !== 'Basics' || movedOn) ? stepBlockers.length : 0}
          showAll={isLast}
          allIssues={validation.filter((v) => v.blocking && v.step && canAutoFix(v.step)).length}
          fixableSteps={fixableSteps}
          remaining={blockers}
          onFixStep={() => runAutoFix([stepName])}
          onFixAll={() => runAutoFix()}
          onUndo={() => {
            if (fixReport) setDraft(fixReport.before);
            setFixReport(null);
          }}
          onDismiss={() => setFixReport(null)}
          onGo={goToStep}
        />

        {stepName === 'Basics' ? (
          <BasicsStep
            draft={draft}
            patch={patch}
            applyPattern={choosePattern}
            requisition={requisition}
            errors={{
              title: movedOn && !draft.title.trim()
                ? 'Give the event a title — suppliers see it in their invitation.' : undefined,
              costCentre: movedOn && !draft.costCentre ? 'Choose the cost centre this is raised under.' : undefined,
              budgetLine: movedOn && !draft.budgetLine ? 'Choose the budget line the award is committed against.' : undefined,
            }}
            patternBefore={patternBefore}
            onApplyRecommended={recommended ? () => {
              setPatternBefore(draft.pattern);
              applyPattern(recommended);
            } : undefined}
            onUndoRecommended={() => {
              if (patternBefore) applyPattern(patternBefore);
              setPatternBefore(null);
            }}
            onLinkPr={() => setLinkOpen(true)}
          />
        ) : stepName === 'Items & Vendors' || stepName === 'Evaluation' ? (
          // Its own sections carry the headings, as Basics' do.
          stepBody
        ) : (
          <Card padded={false}>
            <div style={{ padding: '14px 18px 0' }}>
              <h2 style={{ ...type.sectionHeading, margin: 0 }}>{stepName}</h2>
              {STEP_PURPOSE[stepName] && (
                <p style={{ margin: '3px 0 0', fontSize: 12, color: color.textSecondary }}>{STEP_PURPOSE[stepName]}</p>
              )}
            </div>
            <div style={{ padding: 18 }}>{stepBody}</div>
          </Card>
        )}

        {/*
          The actions stay in reach. Several steps run to a few screens, and a
          Continue button that has to be scrolled to is one the buyer has to
          remember is there.
        */}
        <div
          style={{
            position: 'sticky', bottom: 0, zIndex: 5,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
            padding: '12px 16px', background: color.surface,
            border: `1px solid ${color.border}`, borderRadius: radius.card,
            boxShadow: '0 -4px 12px -6px rgb(0 0 0 / 0.08)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Step {currentStep + 1} of {steps.length} · {stepName}</div>
            <div
              role="status"
              style={{
                fontSize: 12, marginTop: 1,
                color: (stepName === 'Basics' ? missingOnBasics : stepBlockers.length) > 0 || (isLast && blocked)
                  ? color.dangerText : color.textSecondary,
              }}
            >
              {stepSummary}{savedLabel ? ` · ${savedLabel}` : ''}
              {isLast && blocked && firstBlockerStep && (
                <>
                  {' · '}
                  <LinkButton onClick={() => goToStep(firstBlockerStep)}>Fix on {firstBlockerStep}</LinkButton>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {currentStep > 0 && (
              <Button variant="tertiary" onClick={() => goTo(currentStep - 1)}>← Back</Button>
            )}
            {(isLast ? fixableSteps.length > 0 : canAutoFix(stepName) && stepBlockers.length > 0) && (
              <Button variant="secondary" onClick={() => runAutoFix(isLast ? undefined : [stepName])}>
                ✦ {isLast ? 'Auto-fix all' : 'Auto-fix this step'}
              </Button>
            )}
            <Button variant="secondary" onClick={saveAndClose}>Save &amp; close</Button>
            {!isLast ? (
              <Button variant="primary" onClick={() => goTo(currentStep + 1)}>
                Continue to {steps[currentStep + 1]} →
              </Button>
            ) : (
              <Button variant="primary" disabled={blocked} onClick={() => setPublishOpen(true)}>
                {holdForApproval ? 'Submit for approval' : 'Publish event'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rfx-stack" style={{ gap: 12 }}>
        <SelectedPatternCard
          name={pattern.name}
          description={pattern.description}
          stages={pattern.stages}
          inputPoints={pattern.vendorInputPoints}
          stepCount={steps.length}
          duration={pattern.typicalDuration}
          side={draft.side}
          onChange={showPatternPicker}
        />

        <StepReadinessCard
          steps={steps}
          current={currentStep}
          fields={stepName === 'Basics' ? basicsFields : null}
          checks={validation.filter((v) => v.step === stepName)}
          status={stepStatus}
          issueCount={(name) => validation.filter((v) => v.step === name && v.blocking).length}
          onGo={goToStep}
        />

        {stepName === 'Basics' && (
          <AssistantCard
            pattern={pattern.name}
            recommended={recommended ? JOURNEY_PATTERNS[recommended].name : null}
            category={draft.category}
            actions={[
              {
                icon: 'pencil',
                label: 'Draft the description from the title and category',
                disabledReason: draft.description.trim() ? 'The description is already written' : undefined,
                run: () => patch({ description: draftDescription(draft) }),
              },
              {
                icon: 'users',
                label: `Suggest suppliers for ${draft.category}`,
                run: () => goToStep('Items & Vendors'),
              },
            ]}
          />
        )}

        {stepName === 'Evaluation' && (() => {
          const filled = fillEvaluatorGaps(draft.evaluation, evaluationFacts, draftEnvelope(draft), EVALUATORS);
          const short = evaluationIssues.some((g) => g.target === 'TECHNICAL' || g.target === 'COMMERCIAL');
          const decisive = decisiveGate(draft.evaluation, pattern.stages);
          const lastMerit = meritFacts[meritFacts.length - 1];
          const lead = lastMerit ? draft.evaluation.technicalEvaluators[lastMerit.stage]?.[0] : undefined;
          return (
            <AssistantCard
              pattern={pattern.name}
              recommended={null}
              category={draft.category}
              insight={gateInsight(evaluationFacts, draft.evaluation, eventCategoryOf(draft))}
              actions={[
                {
                  icon: 'users',
                  label: filled.added.length > 0
                    ? describeAdded(filled.added, draft.evaluation)
                    : 'Name the evaluators each stage still needs',
                  disabledReason: filled.added.length > 0 ? undefined
                    : short ? 'Nobody eligible is left to suggest — choose someone on the step'
                      : 'Every stage has the evaluators it needs',
                  run: () => patch({ evaluation: filled.setup }),
                },
                {
                  icon: 'chart',
                  label: `Show how past ${eventCategoryOf(draft)} bidders would have fared under a ${decisive.minTechnicalScore} gate`,
                  disabledReason: usesScore(decisive.technicalGate) ? undefined : 'No stage gates on a minimum score',
                  run: () => setEvaluationOverlay('history'),
                },
                {
                  icon: 'eye',
                  label: lead
                    ? `Preview the scoring sheet as ${evaluatorName(lead)} will see it`
                    : 'Preview the scoring sheet an evaluator will see',
                  disabledReason: lastMerit ? undefined : 'No stage on this journey is scored',
                  run: () => setEvaluationOverlay('preview'),
                },
              ]}
            />
          );
        })()}
      </div>

      <LinkRequisitionDrawer
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onPick={linkRequisition}
        onOpenWorkbench={() => {
          writeSavedDraft({ draft, step: currentStep, savedAt: Date.now(), requisitionId: requisitionId ?? null });
          onNavigate({ name: 'intake' });
        }}
        linkedId={requisitionId}
      />

      <Modal
        open={cancelOpen}
        title="Discard this draft?"
        onClose={() => setCancelOpen(false)}
        onConfirm={discard}
        confirmLabel="Discard draft"
        confirmTone="destructive"
      >
        <p style={{ margin: 0 }}>
          Nothing has been published or sent to suppliers. Everything entered in this draft
          {draft.title.trim() ? <> for <strong>{draft.title}</strong></> : null} will be lost.
          To keep it for later, use Save &amp; close instead.
        </p>
      </Modal>

      <Modal
        open={publishOpen}
        title={holdForApproval ? 'Submit this event for approval?' : 'Publish this event?'}
        onClose={() => setPublishOpen(false)}
        onConfirm={publish}
        confirmLabel={holdForApproval ? 'Submit for approval' : 'Publish'}
      >
        <p style={{ margin: '0 0 10px' }}>
          {holdForApproval
            ? <>The event is saved as Pending Approval and goes to {approvalChain.map((c) => c.holderName).join(' → ')} on the Employee Portal. Invitations to {allBidderIds.length} bidders go out only when the last level approves.</>
            : <>Publishing sends invitations to {allBidderIds.length} bidders and freezes the resolved configuration onto the event.</>}
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

/**
 * What the pattern picker says about each pattern beyond its own description:
 * who it suits, and the filters it answers to.
 */
const PATTERN_META: Record<JourneyPatternId, { bestFor: string; tags: PatternTag[] }> = {
  'JP-01': { bestFor: 'catalogue items with a trusted PR price', tags: ['Auction'] },
  'JP-02': { bestFor: 'routine buys with clear specifications', tags: ['Common', 'RFQ'] },
  'JP-03': { bestFor: 'commodities with several qualified suppliers', tags: ['Common', 'RFQ', 'Auction'] },
  'JP-04': { bestFor: 'competitive categories with three or more bidders', tags: ['Common', 'RFQ', 'Negotiation', 'Auction'] },
  'JP-05': { bestFor: 'high-value strategic tenders', tags: ['RFQ', 'Negotiation', 'Auction'] },
  'JP-06': { bestFor: 'public-sector style, sealed commercial bids', tags: ['RFQ'] },
  'JP-07': { bestFor: 'single-source or urgent buys', tags: ['Common'] },
  'JP-08': { bestFor: 'items already on contract', tags: ['Rate contract'] },
  'JP-09': { bestFor: 'quantity left over after a short close', tags: ['Auction'] },
  'JP-10': { bestFor: 'contracts near expiry or index drift', tags: ['Rate contract'] },
  'JP-11': { bestFor: 'low-value tail spend', tags: ['Common'] },
  'JP-12': { bestFor: 'scrap and surplus disposal', tags: ['Auction'] },
  'JP-13': { bestFor: 'selling to known buyers', tags: ['RFQ', 'Auction'] },
};

type PatternTag = 'Common' | 'Auction' | 'RFQ' | 'Negotiation' | 'Rate contract';
const PATTERN_TAGS: PatternTag[] = ['Common', 'Auction', 'RFQ', 'Negotiation', 'Rate contract'];

export const DESCRIPTION_LIMIT = 2000;

/** The pattern the intake agent proposes for this draft, if it proposes one. */
export function recommendedPattern(side: Side): JourneyPatternId | null {
  return side === 'BUY' ? 'JP-02' : null;
}

export function BasicsStep({
  draft, patch, applyPattern, requisition, errors = {},
  patternBefore = null, onApplyRecommended, onUndoRecommended, onLinkPr,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  applyPattern: (p: JourneyPatternId) => void;
  requisition?: SourcingRequisition;
  /** Shown once the buyer has moved on with a required field empty, not before. */
  errors?: { title?: string; costCentre?: string; budgetLine?: string };
  /** The pattern the recommendation replaced, while it can still be undone. */
  patternBefore?: JourneyPatternId | null;
  onApplyRecommended?: () => void;
  onUndoRecommended?: () => void;
  onLinkPr?: () => void;
}) {
  const { state } = useStore();

  // A prefilled category must be selectable, so the option list is the union
  // of the taxonomy and whatever the demand carries.
  /**
   * The taxonomy, plus whatever the requisitions in flight actually say.
   *
   * One list rather than a hand-kept set per screen. A category the wizard
   * offers but the template library has never heard of resolves to no
   * questionnaire and no shortlist, and neither of them says why — so the
   * event picker and the template picker read from the same table.
   */
  const categories = [...new Set([
    ...CATEGORY_IDS,
    ...categoriesOf(state.purchaseRequests),
    draft.category,
  ])].filter(Boolean).sort();
  /** Every category the lines actually carry, biggest group first. */
  const basketCategories = categoryGroupsOf(draft);
  const costCentres = costCentresOf(state.purchaseRequests);
  const entity = entityById(draft.entity);

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      {requisition && (
        <div
          style={{
            border: `1px solid ${color.brandPrimary}`, background: color.brandPrimarySoft,
            borderRadius: radius.card, padding: '11px 13px',
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
            Category, cost centre, currency and every line came from these requisitions.
            The event carries one source reference — the PRD — and the PRD carries the RQ numbers,
            so an award line can be walked back to the requisition line that asked for it.
          </div>
        </div>
      )}

      <Card
        title="Basics"
        hint="Suppliers see the title and description on the invitation. Fields marked * are required."
      >
        <div className="rfx-stack" style={{ gap: 16 }}>
          <div style={{ maxWidth: 520 }}>
            <Field label="Event title" required error={errors.title}>
              <TextInput
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Office Supplies Annual Contract"
                aria-invalid={errors.title ? true : undefined}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: 14 }}>
            <Field
              label="Category"
              required
              hint={
                basketCategories.length > 1
                  ? `${basketCategories.length} categories in the demand — each gets its own shortlist and questionnaire.`
                  : requisition ? `Populated from ${requisition.prdNumber}.`
                    : 'Drives the pattern recommendation and supplier shortlist.'
              }
            >
              <Select value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </Select>
              {/* A consolidated basket routinely spans categories, and the select
                  can only hold one. Showing just that one reads as though the rest
                  were dropped — they are not: the lines keep their own category all
                  the way to the shortlist and the questionnaire. So name every one
                  here, and mark which the event header is raised under. */}
              {basketCategories.length > 1 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {basketCategories.map((group) => {
                    const lead = group.category === draft.category;
                    return (
                      <Chip
                        key={group.category}
                        tone={lead ? 'brand' : 'neutral'}
                        title={
                          lead
                            ? `The event header is raised under ${group.category}`
                            : `${group.lines.length} of these lines are ${group.category}, and stay ${group.category}`
                        }
                      >
                        {group.category} · {group.lines.length}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </Field>
            <Field label="Entity" required hint={`Event currency: ${draft.currency}`}>
              <Select
                value={draft.entity}
                onChange={(e) => patch({
                  entity: e.target.value,
                  currency: entityById(e.target.value)?.currency ?? draft.currency,
                })}
              >
                {ENTITIES.map((each) => <option key={each.id} value={each.id}>{each.name}</option>)}
                {!entity && <option value={draft.entity}>{draft.entity}</option>}
              </Select>
            </Field>
            <Field
              label="Source requisition"
              hint={
                draft.sourceReference
                  ? 'Lines and budget came from it. Every award line ties back through it.'
                  : 'Linking a PR copies its lines and budget.'
              }
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
                {onLinkPr && (
                  <Button variant="secondary" onClick={onLinkPr}>
                    <Icon name="link" size={13} />
                    {draft.sourceReference ? 'Change' : 'Link a PR'}
                  </Button>
                )}
                {draft.sourceReference
                  ? <Chip tone="brand">{draft.sourceReference}</Chip>
                  : <span style={{ fontSize: 12, color: color.textSecondary }}>None linked</span>}
              </div>
            </Field>
          </div>

          <Field
            label="Description"
            hint={`Optional · ${draft.description.length.toLocaleString()} of ${DESCRIPTION_LIMIT.toLocaleString()} characters`}
          >
            <Textarea
              rows={3}
              maxLength={DESCRIPTION_LIMIT}
              value={draft.description}
              placeholder="What are we buying, for which sites, and by when? Suppliers will read this."
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <PatternPicker
        draft={draft}
        patch={patch}
        applyPattern={applyPattern}
        patternBefore={patternBefore}
        onApplyRecommended={onApplyRecommended}
        onUndoRecommended={onUndoRecommended}
      />

      <Card
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Additional details <Chip>4 fields</Chip></span>}
        hint="Fields your organisation configured for sourcing events."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
          <Field label="Cost centre" required error={errors.costCentre}>
            <Select
              value={draft.costCentre}
              aria-invalid={errors.costCentre ? true : undefined}
              onChange={(e) => patch({
                costCentre: e.target.value,
                // The DoA chain resolves against the unit the cost centre sits in.
                businessUnit: costCentres.find((c) => c.code === e.target.value)?.businessUnit ?? draft.businessUnit,
              })}
            >
              <option value="">Choose a cost centre</option>
              {costCentres.map((c) => (
                <option key={c.code} value={c.code}>{c.code} · {c.businessUnit}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project code" hint="Optional">
            <TextInput
              value={draft.projectCode}
              placeholder="PRJ-2026-014"
              onChange={(e) => patch({ projectCode: e.target.value })}
            />
          </Field>
          <Field label="Budget line" required error={errors.budgetLine}>
            <Select
              value={draft.budgetLine}
              aria-invalid={errors.budgetLine ? true : undefined}
              onChange={(e) => patch({ budgetLine: e.target.value })}
            >
              <option value="">Choose a budget line</option>
              {BUDGET_LINES.map((b) => <option key={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Internal reference" hint="Optional">
            <TextInput
              value={draft.internalReference}
              onChange={(e) => patch({ internalReference: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <DocumentsCard documents={draft.documents} onChange={(documents) => patch({ documents })} />
    </div>
  );
}

/**
 * Side and journey, in one card, because the side decides which journeys
 * exist. The recommendation is applied rather than merely suggested, and says
 * so — with an undo — so the buyer is never left wondering what changed.
 */
function PatternPicker({
  draft, patch, applyPattern, patternBefore, onApplyRecommended, onUndoRecommended,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  applyPattern: (p: JourneyPatternId) => void;
  patternBefore: JourneyPatternId | null;
  onApplyRecommended?: () => void;
  onUndoRecommended?: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [tag, setTag] = React.useState<PatternTag | null>(null);
  const [whyOpen, setWhyOpen] = React.useState(false);

  const recommended = recommendedPattern(draft.side);
  const forSide = patternsForSide(draft.side);
  // The recommendation leads. The current choice is not moved to the front, so
  // a card never jumps away from under the pointer that just chose it.
  const ordered = [...forSide].sort((a, b) => Number(b.id === recommended) - Number(a.id === recommended));
  const listRef = React.useRef<HTMLDivElement>(null);
  // Keep the chosen pattern in view inside the scrolling list, e.g. after Undo.
  React.useEffect(() => {
    const list = listRef.current;
    const card = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!list || !card) return;
    const top = card.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + card.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - 8);
    }
  }, [draft.pattern]);
  const q = query.trim().toLowerCase();
  const matching = ordered.filter((p) =>
    (!tag || PATTERN_META[p.id].tags.includes(tag))
    && (!q || `${p.name} ${p.description} ${PATTERN_META[p.id].bestFor}`.toLowerCase().includes(q)));
  const filtering = Boolean(tag || q);
  const tags = PATTERN_TAGS.filter((t) => forSide.some((p) => PATTERN_META[p.id].tags.includes(t)));

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <FilterChip key={label} label={label} active={active} onClick={onClick} />
  );

  return (
    <section id="journey-pattern" className="rounded-lg border border-border bg-card shadow-sm" style={{ scrollMarginTop: 90 }}>
      <header
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
          padding: '14px 16px', borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div>
          <div style={{ ...type.sectionHeading }}>Journey pattern</div>
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 4 }}>
            Sets the remaining steps. You can change it any time before the event is published.
          </div>
        </div>
        <div role="radiogroup" aria-label="Event side" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ fontSize: 12, color: color.textSecondary }}>Event side</span>
          {([['BUY', 'Buy — we purchase'], ['SELL', 'Sell — disposal or scrap']] as const).map(([side, label]) => (
            <label key={side} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="event-side"
                checked={draft.side === side}
                onChange={() => patch({ side, pattern: side === 'SELL' ? 'JP-12' : 'JP-02' })}
                style={{ accentColor: color.brandPrimary, width: 15, height: 15, margin: 0 }}
              />
              {label}
            </label>
          ))}
        </div>
      </header>

      <div className="rfx-stack" style={{ gap: 14, padding: 16 }}>
        {recommended && (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
              background: color.brandPrimarySoft, border: `1px solid ${color.brandPrimaryTint}`,
              borderRadius: radius.card, padding: '11px 14px',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 28, height: 28, borderRadius: 7, background: color.surface, color: color.brandPrimary,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <Icon name="sparkle" size={15} />
            </span>
            <div style={{ flex: '1 1 320px', minWidth: 0, fontSize: 12.5 }}>
              <div style={{ fontWeight: 600 }}>
                Recommended for this event: {JOURNEY_PATTERNS[recommended].name}
                {draft.pattern === recommended ? ' — applied' : ''}
              </div>
              <div style={{ color: color.textBody, marginTop: 2, lineHeight: 1.5 }}>
                Matches 6 earlier {draft.category} events. {JOURNEY_PATTERNS[recommended].name} closed
                them in about 3 days with a 4.1% average saving and no auction overhead.{' '}
                <button
                  type="button"
                  aria-expanded={whyOpen}
                  onClick={() => setWhyOpen((v) => !v)}
                  className="rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ color: color.brandPrimaryStrong }}
                >
                  Why this suggestion
                </button>
              </div>
              {whyOpen && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 16, color: color.textBody, lineHeight: 1.6 }}>
                  <li>6 prior events in {draft.category} over the last 18 months</li>
                  <li>Those events closed in a median of 3 days at a 4.1% average saving</li>
                  <li>{JOURNEY_PATTERNS[recommended].name} is the category default set in Configuration Studio</li>
                </ul>
              )}
            </div>
            <div style={{ fontSize: 12, color: color.textSecondary, alignSelf: 'center' }}>
              {draft.pattern === recommended ? (
                patternBefore && patternBefore !== recommended && onUndoRecommended && (
                  <>
                    Was {JOURNEY_PATTERNS[patternBefore].name} ·{' '}
                    <LinkButton onClick={onUndoRecommended}>Undo</LinkButton>
                  </>
                )
              ) : onApplyRecommended && (
                <Button variant="primary" size="small" onClick={onApplyRecommended}>
                  Apply {JOURNEY_PATTERNS[recommended].name}
                </Button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FilterSearch label="Search patterns" value={query} onChange={setQuery} />
          {chip(`All · ${forSide.length}`, tag === null, () => setTag(null))}
          {tags.map((t) => chip(t, tag === t, () => setTag(tag === t ? null : t)))}
        </div>

        <div
          ref={listRef}
          role="radiogroup"
          aria-label="Journey pattern"
          className="rfx-pattern-list"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 8,
            alignContent: 'start', maxHeight: 236, overflowY: 'auto', overscrollBehavior: 'contain',
            position: 'relative', padding: 3, margin: -3,
          }}
        >
          {matching.map((p) => (
            <PatternCard
              key={p.id}
              pattern={p}
              selected={draft.pattern === p.id}
              recommended={p.id === recommended}
              onChoose={() => applyPattern(p.id)}
            />
          ))}
        </div>
        {matching.length === 0 && (
          <div style={{ fontSize: 12.5, color: color.textSecondary }}>
            No pattern matches “{query}”.{' '}
            <LinkButton onClick={() => { setQuery(''); setTag(null); }}>Clear the search</LinkButton>
          </div>
        )}

        <div style={{ fontSize: 12, color: color.textSecondary }}>
          {filtering ? `${matching.length} of ${forSide.length} patterns match` : `${forSide.length} patterns`}
          {matching.length > 4 && ' · scroll the list to see them all'}
          {' · '}<Icon name="info" size={12} /> shows each pattern's stages and details
          {draft.side === 'BUY' ? '. Selling scrap or surplus? Switch the event side.' : '.'}
        </div>
      </div>
    </section>
  );
}

/** A toggle in a row of filters: "All · 11", "Auction", "Lot 2 · Monitor (3)". */
function FilterChip({ label, active, onClick, title }: {
  label: React.ReactNode; active: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className="rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        borderColor: active ? color.brandPrimaryTint : color.border,
        background: active ? color.brandPrimarySoft : color.surface,
        color: active ? color.brandPrimaryStrong : color.textBody,
      }}
    >
      {label}
    </button>
  );
}

/** A search box sized to sit at the head of a row of filter chips. */
function FilterSearch({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  return (
    <label style={{ position: 'relative', flex: '0 1 290px', minWidth: 180 }}>
      <span className="rfx-visually-hidden">{label}</span>
      <span aria-hidden style={{ position: 'absolute', left: 10, top: 9, color: color.textMuted }}>
        <Icon name="search" size={14} />
      </span>
      <TextInput
        value={value}
        placeholder={label}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: 30 }}
      />
    </label>
  );
}

/**
 * One pattern, at a glance: its name, how long it runs and how many steps it
 * adds. Everything else — what it is for and the stages it runs through —
 * sits behind the "i", so the list stays short enough to scan.
 */
function PatternCard({ pattern, selected, recommended, onChoose }: {
  pattern: (typeof ALL_PATTERNS)[number];
  selected: boolean;
  recommended: boolean;
  onChoose: () => void;
}) {
  const [infoOpen, setInfoOpen] = React.useState(false);
  const infoRef = React.useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onChoose}
        className="flex w-full rounded-lg text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        style={{
          alignItems: 'flex-start', gap: 10, height: '100%',
          padding: '10px 40px 10px 12px',
          border: selected ? `2px solid ${color.brandPrimary}` : `1px solid ${color.border}`,
          margin: selected ? 0 : 1,
          background: selected ? color.brandPrimarySoft : color.surface,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: selected ? 'none' : `1.5px solid ${color.borderStrong}`,
            background: selected ? color.brandPrimary : color.surface, color: '#fff',
          }}
        >
          {selected && <Icon name="check" size={10} stroke={3} />}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{pattern.name}</span>
            {recommended && <Chip tone="brand">Recommended</Chip>}
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>
            {pattern.wizardSteps.length} steps · ~{pattern.typicalDuration}
          </span>
        </span>
      </button>
      <button
        ref={infoRef}
        type="button"
        aria-label={`About ${pattern.name}`}
        aria-expanded={infoOpen}
        aria-haspopup="dialog"
        onClick={() => setInfoOpen((v) => !v)}
        className="rounded-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          position: 'absolute', top: 7, right: 7, width: 26, height: 26,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: infoOpen ? color.brandPrimary : color.textMuted,
        }}
      >
        <Icon name="info" size={15} />
      </button>
      {infoOpen && (
        <PatternInfo
          pattern={pattern}
          anchor={infoRef}
          selected={selected}
          onChoose={() => { onChoose(); setInfoOpen(false); }}
          onClose={() => setInfoOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The detail behind a pattern card's "i". It floats over the page rather than
 * inside the scrolling list, so it is never clipped by the list's edge, and it
 * closes on Escape, on a click elsewhere, or when the page scrolls under it.
 */
function PatternInfo({ pattern, anchor, selected, onChoose, onClose }: {
  pattern: (typeof ALL_PATTERNS)[number];
  anchor: React.RefObject<HTMLButtonElement | null>;
  selected: boolean;
  onChoose: () => void;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [place, setPlace] = React.useState<{ top: number; left: number } | null>(null);
  const WIDTH = 340;

  React.useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const height = panelRef.current?.offsetHeight ?? 320;
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 6 - height) : below;
    const left = Math.min(Math.max(8, rect.right - WIDTH), window.innerWidth - WIDTH - 8);
    setPlace({ top, left });
  }, [anchor]);

  React.useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); anchor.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${pattern.name} details`}
      tabIndex={-1}
      className="rounded-lg border border-border bg-card shadow-lg focus-visible:outline-none"
      style={{
        position: 'fixed', zIndex: 60, width: WIDTH, maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
        top: place?.top ?? -9999, left: place?.left ?? -9999, padding: 14,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{pattern.name}</div>
      <div style={{ fontSize: 12, color: color.textBody, marginTop: 4, lineHeight: 1.5 }}>{pattern.description}</div>
      <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
        <strong style={{ color: color.textBody, fontWeight: 600 }}>Best for</strong> {PATTERN_META[pattern.id].bestFor}.
      </div>
      <div style={{ ...eyebrow, marginTop: 12 }}>Stages</div>
      <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {pattern.stages.map((stage, i) => (
          <li key={stage} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingBottom: 6 }}>
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
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, fontWeight: 600 }}>
                {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage}
                {(pattern.vendorInputPoints as readonly string[]).includes(stage) && <Chip tone="brand">suppliers respond</Chip>}
              </span>
              {STAGE_PURPOSE[stage] && (
                <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary }}>{STAGE_PURPOSE[stage]}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div style={{ ...eyebrow, marginTop: 6 }}>Steps in this wizard</div>
      <div style={{ fontSize: 12, color: color.textBody, marginTop: 4, lineHeight: 1.5 }}>
        {pattern.wizardSteps.join(' → ')}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <Chip>{pattern.wizardSteps.length} steps</Chip>
        <Chip>~{pattern.typicalDuration}</Chip>
        <Chip>{pattern.side === 'BUY' ? 'Buy side' : 'Sell side'}</Chip>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <Button variant="tertiary" size="small" onClick={onClose}>Close</Button>
        {selected
          ? <Chip tone="success" icon="✓">Selected</Chip>
          : <Button variant="primary" size="small" onClick={onChoose}>Use this pattern</Button>}
      </div>
    </div>
  );
}

function fileSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Formats a supplier's portal cannot preview, and what to add alongside them. */
const NO_PREVIEW = /\.(dwg|dxf|rvt|skp)$/i;

/**
 * Two audiences, side by side, so where a file lands is never a guess:
 * everything on the left goes to every invited supplier, nothing on the right
 * ever does. A removal can be undone until the next one.
 */
function DocumentsCard({ documents, onChange }: {
  documents: EventDocument[];
  onChange: (documents: EventDocument[]) => void;
}) {
  const [removed, setRemoved] = React.useState<{ doc: EventDocument; index: number } | null>(null);

  const add = (files: FileList | null, visibility: EventDocument['visibility']) => {
    if (!files || files.length === 0) return;
    const added = [...files].map((file, i) => ({
      id: `doc-${Date.now()}-${i}`, name: file.name, size: file.size, visibility,
    }));
    onChange([...documents, ...added]);
  };
  const remove = (doc: EventDocument) => {
    setRemoved({ doc, index: documents.indexOf(doc) });
    onChange(documents.filter((d) => d.id !== doc.id));
  };
  const undo = () => {
    if (!removed) return;
    const next = [...documents];
    next.splice(Math.min(removed.index, next.length), 0, removed.doc);
    onChange(next);
    setRemoved(null);
  };

  const panel = (visibility: EventDocument['visibility']) => {
    const isPublic = visibility === 'PUBLIC';
    const own = documents.filter((d) => d.visibility === visibility);
    const inputId = `doc-input-${visibility}`;
    return (
      <div
        style={{
          border: `1px solid ${isPublic ? color.border : '#FDE68A'}`, borderRadius: radius.card,
          background: isPublic ? color.surface : color.warningSoft, padding: 12, minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 10 }}>
          <span aria-hidden style={{ color: isPublic ? color.brandPrimary : color.warningText, marginTop: 2 }}>
            <Icon name={isPublic ? 'eye' : 'lock'} size={15} />
          </span>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>
              {isPublic ? 'Public — shared with suppliers' : 'Private — internal only'}
            </div>
            <div style={{ fontSize: 11.5, color: color.textSecondary }}>
              {isPublic ? 'Specifications, drawings, scope of work' : 'Budget approvals, internal notes, prior quotes'}
            </div>
          </div>
        </div>
        <ul className="rfx-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
          {own.map((doc) => (
            <li
              key={doc.id}
              style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.surface, padding: '8px 10px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{ color: color.textSecondary }}><Icon name="doc" size={14} /></span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.name}
                </span>
                <span style={{ fontSize: 11.5, color: color.textSecondary }}>{fileSize(doc.size)}</span>
                <Button size="small" onClick={() => remove(doc)} aria-label={`Remove ${doc.name}`}>Remove</Button>
              </div>
              {isPublic && NO_PREVIEW.test(doc.name) && (
                <div style={{ fontSize: 11.5, color: color.warningText, marginTop: 6 }}>
                  {doc.name.split('.').pop()!.toUpperCase()} files don’t preview in the supplier portal — add a PDF export too.
                </div>
              )}
            </li>
          ))}
          {removed && removed.doc.visibility === visibility && (
            <li
              role="status"
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12,
                background: color.rowAlt, borderRadius: radius.control, padding: '8px 10px', color: color.textSecondary,
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Removed {removed.doc.name}
              </span>
              <LinkButton onClick={undo}>Undo</LinkButton>
            </li>
          )}
          {own.length === 0 && !(removed && removed.doc.visibility === visibility) && (
            <li style={{ fontSize: 12, color: color.textSecondary }}>
              {isPublic ? 'Nothing shared yet.' : 'Nothing kept internally yet.'}
            </li>
          )}
        </ul>
        <input
          id={inputId}
          type="file"
          multiple
          className="rfx-visually-hidden"
          onChange={(e) => { add(e.target.files, visibility); e.target.value = ''; }}
        />
        <label
          htmlFor={inputId}
          className="mt-2.5 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent"
        >
          <Icon name="plus" size={13} />
          {isPublic ? 'Add public document' : 'Add private document'}
        </label>
      </div>
    );
  };

  return (
    <Card
      title="Documents"
      hint="Public documents go out with the invitation and every invited supplier can read them. Private documents stay internal and are never shared."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
        {panel('PUBLIC')}
        {panel('PRIVATE')}
      </div>
    </Card>
  );
}

/**
 * Items, lots and the suppliers asked to price them — one step, two sections.
 *
 * The basket and the shortlist used to be two steps, and the split made the
 * buyer tick vendor names against a basket they could no longer see. Now the
 * line table says who is shortlisted on every line and what the policy still
 * wants, and the supplier table below shortlists against whatever is picked
 * above — one line, a lot, or a bulk selection.
 *
 * Invitations are recorded per line, not per event. One vendor prices the
 * laptops and the monitors but not the network switch, and a roster that
 * cannot say so sends every supplier an ask full of things they do not sell.
 */
export function ItemsAndVendorsStep({
  draft, patch, estimatedValue, groups, showVendors, onImportPr,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  estimatedValue: number;
  groups: CategoryGroup[];
  showVendors: boolean;
  /** Opens the requisition picker; absent where there is none to open. */
  onImportPr?: () => void;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [catalogueOpen, setCatalogueOpen] = React.useState(false);
  const [tipDismissed, setTipDismissed] = React.useState(false);
  const [groupBy, setGroupBy] = React.useState<LineGrouping>('lot');
  const [view, setView] = React.useState<'table' | 'cards'>('table');
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [focus, setFocus] = React.useState<{ label: string; lineIds: string[] } | null>(null);
  const [tab, setTab] = React.useState<SupplierTab>('shortlisted');
  const [query, setQuery] = React.useState('');
  const [itemsCollapsed, setItemsCollapsed] = React.useState(false);
  const [suppliersCollapsed, setSuppliersCollapsed] = React.useState(false);

  const lotNames = [...new Set(draft.lines.map((l) => l.lotName))].sort();
  const lineIds = new Set(draft.lines.map((l) => l.id));
  // Selections and focus outlive the lines they name only until the next render.
  const selected = picked.filter((id) => lineIds.has(id));
  const focusIds = focus ? focus.lineIds.filter((id) => lineIds.has(id)) : [];
  const activeFocus = focus && focusIds.length > 0 ? { ...focus, lineIds: focusIds } : null;

  const vendors = draft.vendorIds
    .map((id) => COUNTERPARTIES.find((c) => c.id === id))
    .filter((c): c is Counterparty => c !== undefined);
  const counterparty = (id: string) => COUNTERPARTIES.find((c) => c.id === id);

  const categoryOf = (l: DraftLine) => l.category || draft.category;
  const shortName = (l: DraftLine) => l.description.split(',')[0];
  const invitedTo = (lineId: string) => draft.invitedByLine[lineId] ?? [];
  const linesFor = (vendorId: string) => draft.lines.filter((l) => invitedTo(l.id).includes(vendorId));
  // A provisional supplier may bid but cannot be awarded, so it does not count.
  const qualifiedOn = (l: DraftLine) =>
    invitedTo(l.id).filter((id) => counterparty(id)?.isProvisional === false).length;
  const shortBy = (l: DraftLine) => Math.max(0, MIN_BIDDERS_PER_CATEGORY - qualifiedOn(l));

  const lineValue = (lines: DraftLine[]) => lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);
  const covered = draft.lines.filter((l) => invitedTo(l.id).length > 0).length;
  const competitive = draft.lines.filter((l) => invitedTo(l.id).length > 1).length;
  const shortLines = draft.lines.filter((l) => shortBy(l) > 0);

  // ---- mutations ---------------------------------------------------------

  const setInvitedOn = (vendorId: string, ids: string[], on: boolean) => {
    const next: Record<string, string[]> = { ...draft.invitedByLine };
    for (const id of ids) {
      const current = next[id] ?? [];
      next[id] = on ? [...new Set([...current, vendorId])] : current.filter((x) => x !== vendorId);
    }
    patch({
      vendorIds: on && !draft.vendorIds.includes(vendorId) ? [...draft.vendorIds, vendorId] : draft.vendorIds,
      invitedByLine: next,
    });
  };

  /** Onto every line the vendor master lists the supplier against. */
  const shortlistWhereServed = (vendor: Counterparty) =>
    setInvitedOn(
      vendor.id,
      draft.lines.filter((l) => servesCategory(vendor, categoryOf(l), l.superCategory)).map((l) => l.id),
      true,
    );

  const addVendor = (vendorId: string, category: string | null) => {
    const next: Record<string, string[]> = { ...draft.invitedByLine };
    if (category !== null) {
      for (const line of draft.lines.filter((l) => categoryOf(l) === category)) {
        next[line.id] = [...new Set([...(next[line.id] ?? []), vendorId])];
      }
    }
    patch({
      vendorIds: draft.vendorIds.includes(vendorId) ? draft.vendorIds : [...draft.vendorIds, vendorId],
      invitedByLine: next,
    });
  };

  const removeVendor = (vendorId: string) => {
    const next: Record<string, string[]> = {};
    for (const [lineId, ids] of Object.entries(draft.invitedByLine)) {
      next[lineId] = ids.filter((x) => x !== vendorId);
    }
    patch({ vendorIds: draft.vendorIds.filter((x) => x !== vendorId), invitedByLine: next });
  };

  const removeLines = (ids: string[]) => {
    const next = { ...draft.invitedByLine };
    for (const id of ids) delete next[id];
    patch({ lines: draft.lines.filter((x) => !ids.includes(x.id)), invitedByLine: next });
    setPicked((p) => p.filter((id) => !ids.includes(id)));
  };

  const moveLines = (ids: string[], target: string) => {
    const first = draft.lines.find((l) => ids.includes(l.id));
    const lotName = target === NEW_LOT && first ? `Lot ${lotNames.length + 1} · ${shortName(first)}` : target;
    patch({ lines: draft.lines.map((x) => (ids.includes(x.id) ? { ...x, lotName } : x)) });
  };

  const addLines = (lines: DraftLine[]) => patch({ lines: [...draft.lines, ...lines] });

  const addBlankLine = () => addLines([{
    id: `dl-${Date.now()}`, itemCode: 'NEW-000', description: 'New line',
    specification: '', quantity: 1, uom: 'each', deliveryLocation: '', needBy: '',
    baselinePrice: null, lotName: draft.lines[0]?.lotName ?? 'Lot 1',
    category: draft.category, superCategory: null,
  }]);

  /** Opens the side panel that shortlists against just these lines. */
  const shortlistFor = (label: string, ids: string[]) => setFocus({ label, lineIds: ids });

  const togglePicked = (ids: string[], on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, ...ids])] : p.filter((id) => !ids.includes(id))));

  // ---- the line table ----------------------------------------------------

  const groupKey = (l: DraftLine) =>
    groupBy === 'lot' ? l.lotName : groupBy === 'site' ? (l.deliveryLocation || 'No delivery site') : '';
  const lineGroups = groupBy === 'none'
    ? [{ key: '', lines: draft.lines }]
    : [...new Set(draft.lines.map(groupKey))].sort().map((key) => ({
      key, lines: draft.lines.filter((l) => groupKey(l) === key),
    }));
  const allCollapsed = groupBy !== 'none' && lineGroups.every((g) => collapsed.includes(`${groupBy}:${g.key}`));

  const supplierSummary = (l: DraftLine) => {
    const names = invitedTo(l.id)
      .map((id) => counterparty(id))
      .filter((c): c is Counterparty => c !== undefined)
      .map((c) => shortVendorName(c.name));
    const short = shortBy(l);
    return (
      <div style={{ minWidth: 0 }}>
        {names.length === 0
          ? <span style={{ color: color.dangerText, fontWeight: 500 }}>Nobody shortlisted</span>
          : (
            <span>
              {names.slice(0, 4).join(', ')}
              {names.length > 4 && <span style={{ color: color.brandPrimary, fontWeight: 600 }}> +{names.length - 4}</span>}
            </span>
          )}
        {short > 0 && (
          <div style={{ color: color.warningText, fontWeight: 600, fontSize: 12, marginTop: 2 }}>
            {qualifiedOn(l)} of {MIN_BIDDERS_PER_CATEGORY} needed
          </div>
        )}
      </div>
    );
  };

  const groupStatus = (lines: DraftLine[]) => {
    const short = lines.filter((l) => shortBy(l) > 0);
    if (short.length === 0) {
      return <Chip tone="success" icon="✓">{MIN_BIDDERS_PER_CATEGORY}-supplier rule met</Chip>;
    }
    const most = Math.max(...short.map(shortBy));
    return (
      <Chip tone="gold" icon="⚠">
        Needs {most} more supplier{most === 1 ? '' : 's'} on {short.length} line{short.length === 1 ? '' : 's'}
      </Chip>
    );
  };

  const lineMenu = (l: DraftLine) => (
    <RowMenu
      label={`More for ${l.description}`}
      items={[
        ...(showVendors ? [{ label: 'Shortlist suppliers', onSelect: () => shortlistFor(l.description, [l.id]) }] : []),
        ...lotNames.filter((n) => n !== l.lotName).map((n) => ({ label: `Move to ${n}`, onSelect: () => moveLines([l.id], n) })),
        { label: 'Move to a new lot', onSelect: () => moveLines([l.id], NEW_LOT) },
        { label: 'Remove line', danger: true, onSelect: () => removeLines([l.id]) },
      ]}
    />
  );

  const itemCell = (l: DraftLine) => (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 600 }}>{l.description}</div>
      <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
        <span style={{ fontFamily: font.mono, fontSize: 11.5 }}>{l.itemCode}</span>
        {' · '}{categoryOf(l)}
        <span style={{ color: color.textMuted }}>
          {l.sourceRequestNumber ? ` · from ${l.sourceRequestNumber}` : ' · added here'}
        </span>
      </div>
    </div>
  );

  const targetCell = (l: DraftLine) => (l.baselinePrice === null
    ? <span style={{ color: color.textMuted }} title="No target — savings cannot be reported on this line">—</span>
    : (
      <>
        <div style={{ whiteSpace: 'nowrap' }}>{money(l.baselinePrice, draft.currency)} / {l.uom}</div>
        <div style={{ fontSize: 12, color: color.textSecondary }}>{money(l.baselinePrice * l.quantity, draft.currency)}</div>
      </>
    ));

  const allPicked = draft.lines.length > 0 && selected.length === draft.lines.length;
  const colCount = showVendors ? 8 : 7;

  const lineTable = (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 40 }}>
              <TickBox
                checked={allPicked}
                indeterminate={selected.length > 0 && !allPicked}
                onChange={() => setPicked(allPicked ? [] : draft.lines.map((l) => l.id))}
                label="Select every line"
              />
            </th>
            <th style={{ ...TH, width: 32 }}>#</th>
            <th style={TH}>Item</th>
            <th style={TH}>Delivery site</th>
            <th style={TH}>Qty</th>
            <th style={TH}>Target</th>
            {showVendors && <th style={TH}>Shortlisted suppliers</th>}
            <th style={{ ...TH, width: 44 }}><span className="rfx-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {lineGroups.map((group) => {
            const key = `${groupBy}:${group.key}`;
            const isCollapsed = collapsed.includes(key);
            const groupIds = group.lines.map((l) => l.id);
            const groupPicked = groupIds.every((id) => selected.includes(id));
            const noun = groupBy === 'lot' ? 'lot' : 'site';
            return (
              <React.Fragment key={key}>
                {groupBy !== 'none' && (
                  <tr style={{ background: color.rowAlt }}>
                    <td style={TD}>
                      <TickBox
                        checked={groupPicked}
                        indeterminate={!groupPicked && groupIds.some((id) => selected.includes(id))}
                        onChange={() => togglePicked(groupIds, !groupPicked)}
                        label={`Select every line in ${group.key}`}
                      />
                    </td>
                    <td style={TD} colSpan={showVendors ? 5 : 5}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.key}`}
                          onClick={() => setCollapsed((c) => (isCollapsed ? c.filter((x) => x !== key) : [...c, key]))}
                          className="rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{ display: 'inline-flex', padding: 2, color: color.textSecondary }}
                        >
                          <Icon name={isCollapsed ? 'chevRight' : 'chevDown'} size={15} />
                        </button>
                        <strong style={{ fontSize: 13.5 }}>{group.key}</strong>
                        <span style={{ color: color.textSecondary, fontSize: 12.5 }}>
                          {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'} · {money(lineValue(group.lines), draft.currency)}
                        </span>
                        {showVendors && groupStatus(group.lines)}
                      </div>
                    </td>
                    {showVendors && (
                      <td style={TD}>
                        <Button size="small" onClick={() => shortlistFor(group.key, groupIds)}>
                          Shortlist for {noun}
                        </Button>
                      </td>
                    )}
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <RowMenu
                        label={`More for ${group.key}`}
                        items={[
                          { label: `Select lines in this ${noun}`, onSelect: () => togglePicked(groupIds, true) },
                          { label: `Remove this ${noun}'s lines`, danger: true, onSelect: () => removeLines(groupIds) },
                        ]}
                      />
                    </td>
                  </tr>
                )}
                {!isCollapsed && group.lines.map((l) => {
                  const isPicked = selected.includes(l.id);
                  return (
                    <tr key={l.id} style={{ background: isPicked ? color.brandPrimarySoft : undefined }}>
                      <td style={TD}>
                        <TickBox checked={isPicked} onChange={() => togglePicked([l.id], !isPicked)} label={`Select ${l.description}`} />
                      </td>
                      <td style={{ ...TD, color: color.textSecondary }}>{draft.lines.indexOf(l) + 1}</td>
                      <td style={TD}>{itemCell(l)}</td>
                      <td style={TD}>
                        {l.deliveryLocation || <span style={{ color: color.textMuted }}>Not set</span>}
                        {l.needBy && (
                          <div style={{ fontSize: 12, color: color.textSecondary }}>by {new Date(l.needBy).toLocaleDateString()}</div>
                        )}
                      </td>
                      <td style={{ ...TD, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {l.quantity.toLocaleString()} {l.uom}
                      </td>
                      <td style={{ ...TD, fontVariantNumeric: 'tabular-nums' }}>{targetCell(l)}</td>
                      {showVendors && <td style={TD}>{supplierSummary(l)}</td>}
                      <td style={{ ...TD, textAlign: 'right' }}>{lineMenu(l)}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
          {draft.lines.length === 0 && (
            <tr>
              <td colSpan={colCount}>
                <Empty icon="▤" title="No lines yet" hint="Import them from a requisition, pick from the catalogue, or add one by hand." />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const lineCards = (
    <div className="rfx-stack" style={{ gap: 14, padding: '0 16px' }}>
      {lineGroups.map((group) => (
        <div key={group.key} className="rfx-stack" style={{ gap: 8 }}>
          {groupBy !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13.5 }}>{group.key}</strong>
              <span style={{ color: color.textSecondary, fontSize: 12.5 }}>
                {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'} · {money(lineValue(group.lines), draft.currency)}
              </span>
              {showVendors && groupStatus(group.lines)}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 10 }}>
            {group.lines.map((l) => {
              const isPicked = selected.includes(l.id);
              return (
                <div
                  key={l.id}
                  className="rounded-lg"
                  style={{
                    border: `1px solid ${isPicked ? color.brandPrimaryTint : color.border}`,
                    background: isPicked ? color.brandPrimarySoft : color.surface,
                    padding: 12, display: 'grid', gap: 8, fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ paddingTop: 2 }}>
                      <TickBox checked={isPicked} onChange={() => togglePicked([l.id], !isPicked)} label={`Select ${l.description}`} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>{itemCell(l)}</div>
                    {lineMenu(l)}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <span>{l.deliveryLocation || 'No delivery site'}</span>
                    <span>{l.quantity.toLocaleString()} {l.uom}</span>
                    <span>{targetCell(l)}</span>
                  </div>
                  {showVendors && <div style={{ fontSize: 12.5 }}>{supplierSummary(l)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {draft.lines.length === 0 && <Empty icon="▤" title="No lines yet" hint="Add the items this event is buying." />}
    </div>
  );

  const pickedLines = draft.lines.filter((l) => selected.includes(l.id));

  const itemsSection = (
    <Card
      padded={false}
      title="Line items"
      collapsed={itemsCollapsed}
      onToggle={() => setItemsCollapsed((v) => !v)}
      hint={`${draft.lines.length} ${draft.lines.length === 1 ? 'line' : 'lines'} in ${lotNames.length} ${lotNames.length === 1 ? 'lot' : 'lots'} · ${money(estimatedValue, draft.currency)} estimated`}
      action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onImportPr && (
            <Button size="small" onClick={onImportPr}><Icon name="upload" size={13} /> Import from PR</Button>
          )}
          <Button size="small" onClick={() => setCatalogueOpen(true)}><Icon name="book" size={13} /> Add from catalogue</Button>
          <Button variant="primary" size="small" onClick={addBlankLine}><Icon name="plus" size={13} /> Add item</Button>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 12, padding: '14px 16px 12px' }}>
        {showVendors && !tipDismissed && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
              border: `1px solid ${color.border}`, background: color.rowAlt,
              borderRadius: radius.control, padding: '9px 12px', color: color.textBody,
            }}
          >
            <span aria-hidden style={{ color: color.textSecondary }}><Icon name="info" size={15} /></span>
            <span style={{ flex: 1 }}>
              Suppliers are shortlisted per line, so a requirement that spans categories goes to the right
              shortlist on each line. Select lines to shortlist in bulk.
            </span>
            <LinkButton onClick={() => setTipDismissed(true)}>Got it</LinkButton>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: color.textSecondary }}>Group by</span>
          <Segmented<LineGrouping>
            size="small"
            value={groupBy}
            onChange={setGroupBy}
            options={[{ value: 'lot', label: 'Lot' }, { value: 'site', label: 'Site' }, { value: 'none', label: 'None' }]}
          />
          <span style={{ color: color.textSecondary, marginLeft: 8 }}>View</span>
          <Segmented<'table' | 'cards'>
            size="small"
            value={view}
            onChange={setView}
            options={[{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cards' }]}
          />
          <span style={{ flex: 1 }} />
          {groupBy !== 'none' && view === 'table' && draft.lines.length > 0 && (
            <LinkButton
              onClick={() => setCollapsed(allCollapsed ? [] : lineGroups.map((g) => `${groupBy}:${g.key}`))}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </LinkButton>
          )}
        </div>

        {selected.length > 0 && (
          <div
            role="region"
            aria-label="Selected lines"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              background: color.brandPrimarySoft, border: `1px solid ${color.brandPrimaryTint}`,
              borderRadius: radius.control, padding: '8px 12px', fontSize: 12.5,
            }}
          >
            <strong style={{ color: color.brandPrimaryStrong }}>
              {selected.length} {selected.length === 1 ? 'line' : 'lines'} selected
            </strong>
            <span style={{ flex: 1, minWidth: 120, color: color.textBody, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pickedLines.slice(0, 2).map((l) => l.description).join(', ')}
              {pickedLines.length > 2 && ` +${pickedLines.length - 2} more`}
            </span>
            {showVendors && (
              <Button
                variant="primary"
                size="small"
                onClick={() => shortlistFor(
                  selected.length === 1 ? pickedLines[0].description : `${selected.length} lines`, selected,
                )}
              >
                Shortlist suppliers
              </Button>
            )}
            <div style={{ width: 140 }}>
              <Select
                aria-label="Move the selected lines to a lot"
                value=""
                onChange={(e) => { if (e.target.value) moveLines(selected, e.target.value); }}
                className="w-full"
                style={{ fontSize: 12 }}
              >
                <option value="">Move to lot</option>
                {lotNames.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value={NEW_LOT}>＋ New lot…</option>
              </Select>
            </div>
            <Button size="small" onClick={() => removeLines(selected)}>Remove</Button>
            <LinkButton onClick={() => setPicked([])}>Clear</LinkButton>
          </div>
        )}
      </div>

      {view === 'table' ? lineTable : lineCards}

      <div
        style={{
          display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '12px 16px', fontSize: 12.5, color: color.textSecondary,
        }}
      >
        <span>{draft.lines.length} lines · {lotNames.length} {lotNames.length === 1 ? 'lot' : 'lots'}</span>
        <span>
          Estimated value{' '}
          <strong style={{ color: color.textPrimary, fontVariantNumeric: 'tabular-nums' }}>{money(estimatedValue, draft.currency)}</strong>
        </span>
      </div>
    </Card>
  );

  // ---- the supplier table ------------------------------------------------

  const relevantCategories = [...new Set(draft.lines.map(categoryOf))];
  const servesAny = (c: Counterparty) =>
    draft.lines.some((l) => servesCategory(c, categoryOf(l), l.superCategory));
  const byRating = (a: Counterparty, b: Counterparty) => b.onboardingRating - a.onboardingRating;
  const eligible = COUNTERPARTIES.filter(servesAny).sort(byRating);
  const offCategory = COUNTERPARTIES.filter((c) => !servesAny(c)).sort(byRating);
  const tabRows = tab === 'shortlisted' ? vendors : tab === 'eligible' ? eligible : offCategory;
  const q = query.trim().toLowerCase();
  const rows = tabRows.filter((c) => !q
    || `${c.name} ${c.code} ${c.categoriesServed.join(' ')} ${c.locationsServed.join(' ')}`.toLowerCase().includes(q));

  const eligibility = (c: Counterparty) => {
    if (!servesAny(c)) {
      return (
        <>
          <Chip tone="neutral">Off-category</Chip>
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 4 }}>
            The vendor master does not list {c.name} against {relevantCategories.join(', ')}
          </div>
        </>
      );
    }
    const offLines = linesFor(c.id).filter((l) => !servesCategory(c, categoryOf(l), l.superCategory));
    if (offLines.length > 0) {
      const cats = [...new Set(offLines.map(categoryOf))];
      return (
        <>
          <Chip tone="gold">Eligible, off-category on {offLines.length} {offLines.length === 1 ? 'line' : 'lines'}</Chip>
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 4 }}>
            The vendor master does not list {c.name} against {cats.join(', ')}
          </div>
        </>
      );
    }
    if (c.isProvisional) {
      return (
        <>
          <Chip tone="gold">Eligible, with condition</Chip>
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 4 }}>
            Can be shortlisted; can't be awarded until onboarding completes. Doesn't count toward
            the {MIN_BIDDERS_PER_CATEGORY}-supplier rule.
          </div>
        </>
      );
    }
    return <Chip tone="success">Eligible</Chip>;
  };

  const shortlistedFor = (c: Counterparty) => {
    const lines = linesFor(c.id);
    if (lines.length === 0) return <span style={{ color: color.textMuted }}>—</span>;
    if (lines.length === draft.lines.length && lines.length > 1) return `All ${lines.length} lines`;
    return lines.map(shortName).join(', ');
  };

  const status = (c: Counterparty) => {
    if (!draft.vendorIds.includes(c.id)) return <Chip tone="neutral">Not shortlisted</Chip>;
    return linesFor(c.id).length > 0
      ? <Chip tone="brand">Shortlisted</Chip>
      : <Chip tone="gold" title="On the event but asked to price nothing">No lines yet</Chip>;
  };

  const shortlistBox = (c: Counterparty) => {
    const on = draft.vendorIds.includes(c.id);
    return (
      <TickBox
        checked={on}
        onChange={() => (on ? removeVendor(c.id) : shortlistWhereServed(c))}
        label={`Shortlist ${c.name}`}
      />
    );
  };

  const policyBanner = draft.lines.length > 0 && (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5,
        background: shortLines.length > 0 ? color.warningSoft : color.successSoft,
        border: `1px solid ${shortLines.length > 0 ? '#FDE68A' : '#BBF7D0'}`,
        borderRadius: radius.control, padding: '9px 12px',
      }}
    >
      <span aria-hidden style={{ color: shortLines.length > 0 ? color.warningText : color.successText, display: 'inline-flex' }}>
        <Icon name="shield" size={16} />
      </span>
      <strong>Policy: each line needs {MIN_BIDDERS_PER_CATEGORY} qualified suppliers before publish.</strong>
      {draft.lines.map((l) => {
        const short = shortBy(l);
        return (
          <Chip key={l.id} tone={short > 0 ? 'gold' : 'success'}>
            {shortName(l)} · {qualifiedOn(l)}{short > 0 ? `, needs ${short} more` : ''}
          </Chip>
        );
      })}
      <span style={{ flex: 1 }} />
      {shortLines.length > 0 && (
        <LinkButton onClick={() => { setTab('eligible'); setQuery(''); }}>Find more suppliers</LinkButton>
      )}
      <div style={{ flexBasis: '100%', fontSize: 12, color: color.textSecondary, paddingLeft: 26 }}>
        {covered} of {draft.lines.length} lines covered · {competitive} with two or more vendors
      </div>
    </div>
  );

  const suppliersSection = showVendors && (
      <Card
        padded={false}
        title="Suppliers & bidders"
        collapsed={suppliersCollapsed}
        onToggle={() => setSuppliersCollapsed((v) => !v)}
        hint={suppliersCollapsed
          ? `${vendors.length} shortlisted · ${shortLines.length > 0
            ? `${shortLines.length} ${shortLines.length === 1 ? 'line needs' : 'lines need'} more qualified suppliers`
            : `every line meets the ${MIN_BIDDERS_PER_CATEGORY}-supplier rule`}`
          : `${vendors.length} shortlisted · Invitations go out when you publish, not before.`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!suppliersCollapsed && (
              <div style={{ width: 240, display: 'flex' }}>
                <FilterSearch label="Search suppliers" value={query} onChange={setQuery} />
              </div>
            )}
            <Button variant="primary" size="small" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={13} /> Add suppliers
            </Button>
          </div>
        }
      >
        <div className="rfx-stack" style={{ gap: 12, padding: '14px 16px 12px' }}>
          {policyBanner}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <FilterChip label={`Shortlisted · ${vendors.length}`} active={tab === 'shortlisted'} onClick={() => setTab('shortlisted')} />
            <FilterChip label={`All eligible · ${eligible.length}`} active={tab === 'eligible'} onClick={() => setTab('eligible')} />
            <FilterChip label={`Off-category · ${offCategory.length}`} active={tab === 'off'} onClick={() => setTab('off')} />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: color.textSecondary }}>
              Ticking shortlists a supplier for every line they serve. To shortlist for particular lines,
              use Shortlist on a line or lot.
            </span>
          </div>
        </div>

        {tab === 'shortlisted' && vendors.length === 0 ? (
          <Empty
            icon="◎"
            tone="permission"
            title="No vendors on the event"
            hint="The vendor master proposes the strongest suppliers for each category in the basket."
            action={<Button variant="primary" size="small" onClick={() => setTab('eligible')}>See eligible suppliers</Button>}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width: 72 }}>Shortlist</th>
                  <th style={TH}>Supplier</th>
                  <th style={TH}>Categories</th>
                  <th style={TH}>Eligibility</th>
                  <th style={TH}>Shortlisted for</th>
                  <th style={TH}>Status</th>
                  <th style={{ ...TH, width: 44 }}><span className="rfx-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const on = draft.vendorIds.includes(c.id);
                  return (
                    <tr key={c.id}>
                      <td style={TD}>{shortlistBox(c)}</td>
                      <td style={{ ...TD, minWidth: 200 }}>
                        <div style={{ fontWeight: 600 }} title={c.contactEmail}>{c.name}</div>
                        <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
                          {c.locationsServed.join(', ')} · {c.isProvisional ? `Onboarding ${c.onboardingRating}%, provisional` : 'Onboarded'}
                        </div>
                        <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 1 }}>
                          <span style={{ fontFamily: font.mono }}>{c.code}</span>
                          {!c.isProvisional && ` · Onboarding ${c.onboardingRating}`}
                          {' · '}{c.performanceRating === 0 ? 'no performance history' : `Performance ${c.performanceRating}`}
                        </div>
                      </td>
                      <td style={{ ...TD, minWidth: 140 }} title={c.categoriesServed.join(', ')}>
                        {c.categoriesServed[0]}
                        {c.categoriesServed.length > 1 && (
                          <span style={{ color: color.brandPrimary, fontWeight: 600 }}> +{c.categoriesServed.length - 1}</span>
                        )}
                      </td>
                      <td style={{ ...TD, minWidth: 200, maxWidth: 360 }}>{eligibility(c)}</td>
                      <td style={{ ...TD, minWidth: 140 }}>{shortlistedFor(c)}</td>
                      <td style={TD}>{status(c)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <RowMenu
                          label={`More for ${c.name}`}
                          items={[
                            { label: 'Shortlist for every line they serve', onSelect: () => shortlistWhereServed(c) },
                            ...(on ? [
                              { label: 'Shortlist for every line', onSelect: () => setInvitedOn(c.id, draft.lines.map((l) => l.id), true) },
                              { label: 'Clear from every line', onSelect: () => setInvitedOn(c.id, draft.lines.map((l) => l.id), false) },
                              { label: 'Remove from event', danger: true, onSelect: () => removeVendor(c.id) },
                            ] : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...TD, color: color.textSecondary }}>
                      No supplier matches.{' '}
                      <LinkButton onClick={() => { setQuery(''); setTab('shortlisted'); }}>Clear the search</LinkButton>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab !== 'off' && offCategory.length > 0 && (
          <div style={{ padding: '12px 16px', fontSize: 12.5, color: color.textSecondary }}>
            {offCategory.length} off-category {offCategory.length === 1 ? 'supplier' : 'suppliers'} hidden —{' '}
            {offCategory.slice(0, 3).map((c) => `${c.name} (${c.categoriesServed.join(', ')})`).join(', ')}
            {offCategory.length > 3 && ` and ${offCategory.length - 3} more`}.{' '}
            <LinkButton onClick={() => setTab('off')}>Show</LinkButton>
          </div>
        )}
      </Card>
  );

  return (
    <div className="rfx-stack" style={{ gap: 16 }}>
      {itemsSection}
      {suppliersSection}
      <AddVendorPanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        groups={groups}
        onAdd={addVendor}
        alreadyOn={draft.vendorIds}
      />
      {showVendors && activeFocus && (
        <ShortlistPanel
          label={activeFocus.label}
          lines={draft.lines.filter((l) => activeFocus.lineIds.includes(l.id))}
          draft={draft}
          onSetInvited={setInvitedOn}
          onClose={() => setFocus(null)}
        />
      )}
      <CataloguePanel
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        draft={draft}
        onAdd={(line) => addLines([line])}
      />
    </div>
  );
}

/**
 * Shortlisting against particular lines — one line, a lot, or a bulk pick —
 * in a side panel, so the buyer chooses suppliers without losing sight of the
 * lines they are choosing for. A tick applies to every line in the panel at
 * once; a supplier already on only some of them shows half-ticked.
 */
function ShortlistPanel({ label, lines, draft, onSetInvited, onClose }: {
  label: string;
  lines: DraftLine[];
  draft: Draft;
  onSetInvited: (vendorId: string, lineIds: string[], on: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<'eligible' | 'off'>('eligible');
  const [query, setQuery] = React.useState('');
  const ids = lines.map((l) => l.id);
  const categoryOf = (l: DraftLine) => l.category || draft.category;
  const invitedTo = (id: string) => draft.invitedByLine[id] ?? [];
  const qualifiedOn = (l: DraftLine) =>
    invitedTo(l.id).filter((v) => COUNTERPARTIES.find((c) => c.id === v)?.isProvisional === false).length;
  const servedBy = (c: Counterparty) => lines.filter((l) => servesCategory(c, categoryOf(l), l.superCategory));
  const onCount = (c: Counterparty) => ids.filter((id) => invitedTo(id).includes(c.id)).length;
  // Ranked, not re-sorted by what is ticked, so a row never jumps from under the pointer.
  const byRating = (a: Counterparty, b: Counterparty) => b.onboardingRating - a.onboardingRating;
  const eligible = COUNTERPARTIES.filter((c) => servedBy(c).length > 0).sort(byRating);
  const off = COUNTERPARTIES.filter((c) => servedBy(c).length === 0).sort(byRating);
  const q = query.trim().toLowerCase();
  const rows = (tab === 'eligible' ? eligible : off).filter((c) => !q
    || `${c.name} ${c.code} ${c.categoriesServed.join(' ')} ${c.locationsServed.join(' ')}`.toLowerCase().includes(q));
  const short = lines.filter((l) => qualifiedOn(l) < MIN_BIDDERS_PER_CATEGORY);
  const LINES_SHOWN = 6;

  const eligibilityChip = (c: Counterparty) => {
    const served = servedBy(c).length;
    if (served === 0) return <Chip tone="neutral">Off-category</Chip>;
    if (served < lines.length) return <Chip tone="gold">Serves {served} of {lines.length} lines</Chip>;
    if (c.isProvisional) return <Chip tone="gold">Eligible, with condition</Chip>;
    return <Chip tone="success">Eligible</Chip>;
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Shortlist suppliers"
      subtitle={`For ${label} · ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}. A tick shortlists the supplier on every line here.`}
      width={560}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: short.length > 0 ? color.warningText : color.successText }}>
            {short.length > 0
              ? `${short.length} ${short.length === 1 ? 'line is' : 'lines are'} still short of ${MIN_BIDDERS_PER_CATEGORY} qualified suppliers`
              : `Every line here meets the ${MIN_BIDDERS_PER_CATEGORY}-supplier rule`}
          </span>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
          {lines.slice(0, LINES_SHOWN).map((l, i) => {
            const qualified = qualifiedOn(l);
            return (
              <div
                key={l.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 12.5,
                  borderTop: i === 0 ? undefined : `1px solid ${color.border}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</div>
                  <div style={{ fontSize: 11.5, color: color.textSecondary }}>
                    {categoryOf(l)} · {l.quantity.toLocaleString()} {l.uom}
                  </div>
                </div>
                <Chip tone={qualified >= MIN_BIDDERS_PER_CATEGORY ? 'success' : 'gold'}>
                  {qualified} of {MIN_BIDDERS_PER_CATEGORY} qualified
                </Chip>
              </div>
            );
          })}
          {lines.length > LINES_SHOWN && (
            <div style={{ padding: '6px 12px', fontSize: 12, color: color.textSecondary, borderTop: `1px solid ${color.border}` }}>
              and {lines.length - LINES_SHOWN} more {lines.length - LINES_SHOWN === 1 ? 'line' : 'lines'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FilterSearch label="Search suppliers" value={query} onChange={setQuery} />
          <FilterChip label={`Eligible · ${eligible.length}`} active={tab === 'eligible'} onClick={() => setTab('eligible')} />
          <FilterChip label={`Off-category · ${off.length}`} active={tab === 'off'} onClick={() => setTab('off')} />
        </div>

        <div className="rfx-stack" style={{ gap: 8 }}>
          {rows.map((c) => {
            const count = onCount(c);
            const all = count === lines.length;
            const served = servedBy(c);
            const unserved = [...new Set(lines.filter((l) => !served.includes(l)).map(categoryOf))];
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                  border: `1px solid ${all ? color.brandPrimaryTint : color.border}`,
                  background: all ? color.brandPrimarySoft : color.surface,
                  borderRadius: radius.control, padding: '10px 12px',
                }}
              >
                <span style={{ paddingTop: 2 }}>
                  <TickBox
                    checked={all}
                    indeterminate={count > 0}
                    onChange={() => onSetInvited(c.id, ids, !all)}
                    label={`Shortlist ${c.name} for ${label}`}
                  />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                    {eligibilityChip(c)}
                  </div>
                  <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
                    {c.locationsServed.join(', ')} · {c.isProvisional ? `Onboarding ${c.onboardingRating}%, provisional` : 'Onboarded'}
                    {' · '}{c.categoriesServed.join(', ')}
                  </div>
                  {unserved.length > 0 && (
                    <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 2 }}>
                      The vendor master does not list {c.name} against {unserved.join(', ')}
                    </div>
                  )}
                  {c.isProvisional && (
                    <div style={{ fontSize: 11.5, color: color.textMuted, marginTop: 2 }}>
                      Can't be awarded until onboarding completes; doesn't count toward the {MIN_BIDDERS_PER_CATEGORY}-supplier rule.
                    </div>
                  )}
                  {count > 0 && !all && (
                    <div style={{ fontSize: 11.5, color: color.brandPrimaryStrong, marginTop: 2 }}>
                      Already on {count} of {lines.length} lines — tick to add the rest
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontSize: 11.5, color: color.textSecondary, whiteSpace: 'nowrap' }}>
                  <div style={{ fontFamily: font.mono }}>{c.code}</div>
                  <div>
                    {c.isProvisional ? '' : `Onb ${c.onboardingRating} · `}
                    {c.performanceRating === 0 ? 'no history' : `Perf ${c.performanceRating}`}
                  </div>
                </div>
              </label>
            );
          })}
          {rows.length === 0 && (
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>
              {q ? 'No supplier matches.' : tab === 'eligible' ? 'The vendor master lists nobody against these lines.' : 'Every supplier serves these lines.'}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

type LineGrouping = 'lot' | 'site' | 'none';
type SupplierTab = 'shortlisted' | 'eligible' | 'off';

const TH: React.CSSProperties = {
  textAlign: 'left', fontSize: 12, fontWeight: 500, color: color.textSecondary,
  padding: '10px 12px', borderBottom: `1px solid ${color.border}`, whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  padding: '11px 12px', borderBottom: `1px solid ${color.border}`, verticalAlign: 'middle',
};

/** A bare checkbox with an accessible name, and a third "some of them" state. */
function TickBox({ checked, indeterminate, onChange, label }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void; label: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate && !checked);
  });
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      title={label}
      className="size-4 cursor-pointer rounded-sm accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    />
  );
}

/**
 * The "⋮" on a row. The list is placed against the viewport rather than inside
 * the row, so a table that scrolls sideways cannot clip it.
 */
function RowMenu({ label, items }: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const [place, setPlace] = React.useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const WIDTH = 220;

  React.useEffect(() => {
    if (!place) return;
    const close = () => setPlace(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [place]);

  const toggle = () => {
    if (place) { setPlace(null); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = items.length * 32 + 10;
    const top = rect.bottom + 4 + height > window.innerHeight - 8 ? rect.top - 4 - height : rect.bottom + 4;
    setPlace({ top, left: Math.max(8, rect.right - WIDTH) });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={place !== null}
        onClick={toggle}
        className="rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: color.textSecondary,
        }}
      >
        <Icon name="more" size={16} stroke={2.6} />
      </button>
      {place && (
        <div
          ref={menuRef}
          role="menu"
          className="rounded-md border border-border bg-card shadow-lg"
          style={{ position: 'fixed', zIndex: 60, top: place.top, left: place.left, width: WIDTH, padding: 4 }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setPlace(null); item.onSelect(); }}
              className="block w-full rounded-sm px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              style={{ color: item.danger ? color.dangerText : color.textPrimary }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Items the catalogue already knows, for the categories this event buys. A
 * catalogue line arrives with its code, unit and indicative price as the
 * target, and joins the lot its category already sits in.
 */
function CataloguePanel({ open, onClose, draft, onAdd }: {
  open: boolean;
  onClose: () => void;
  draft: Draft;
  onAdd: (line: DraftLine) => void;
}) {
  const [query, setQuery] = React.useState('');
  const categories = new Set([draft.category, ...draft.lines.map((l) => l.category)].filter(Boolean));
  const items = React.useMemo(() => {
    const seen = new Set<string>();
    return PURCHASE_REQUEST_LINES.flatMap((line) => {
      const request = PURCHASE_REQUESTS.find((r) => r.id === line.requestId);
      if (!line.isCatalogItem || !request || seen.has(line.itemCode)) return [];
      seen.add(line.itemCode);
      return [{ line, category: request.category, superCategory: request.superCategory ?? null }];
    });
  }, []);
  const q = query.trim().toLowerCase();
  const inScope = items.filter((i) => categories.size === 0 || categories.has(i.category));
  const shown = (q
    ? items.filter((i) => `${i.line.description} ${i.line.itemCode} ${i.category}`.toLowerCase().includes(q))
    : inScope).slice(0, 40);
  const onEvent = new Set(draft.lines.map((l) => l.itemCode));

  const add = ({ line, category, superCategory }: (typeof items)[number]) => {
    const sameCategory = draft.lines.find((l) => l.category === category);
    const lotCount = new Set(draft.lines.map((l) => l.lotName)).size;
    onAdd({
      id: `dl-${Date.now()}`, itemCode: line.itemCode, description: line.description,
      specification: line.specification, quantity: 1, uom: line.uom,
      deliveryLocation: line.deliveryLocation, needBy: '', baselinePrice: line.indicativePrice,
      lotName: sameCategory?.lotName ?? `Lot ${lotCount + 1} · ${line.description.split(',')[0]}`,
      category, superCategory,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add from catalogue"
      subtitle={`Catalogue items for ${[...categories].join(', ') || 'every category'}. The indicative price becomes the target.`}
      width={520}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="rfx-stack" style={{ gap: 10 }}>
        <FilterSearch label="Search the catalogue" value={query} onChange={setQuery} />
        {shown.map((item) => {
          const added = onEvent.has(item.line.itemCode);
          return (
            <div
              key={item.line.itemCode}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '8px 11px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.line.description}</div>
                <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                  <span style={{ fontFamily: font.mono }}>{item.line.itemCode}</span> · {item.category} · per {item.line.uom}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {item.line.indicativePrice === null ? '—' : money(item.line.indicativePrice, draft.currency)}
              </div>
              <Button size="small" disabled={added} onClick={() => add(item)}>{added ? 'Added' : 'Add'}</Button>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div style={{ fontSize: 12.5, color: color.textSecondary }}>
            {q ? `Nothing in the catalogue matches “${query}”.` : 'The catalogue has nothing for these categories yet — search across every category.'}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** The sentinel the lot select uses to mean "make me another one". */
const NEW_LOT = '__new-lot__';

/** "Northstar IT Solutions" in a 96px column head is "Northstar IT". */
function shortVendorName(name: string): string {
  const words = name.split(' ');
  return words.length <= 2 ? name : words.slice(0, 2).join(' ');
}

/**
 * Adding a vendor, proposed per category.
 *
 * A consolidated event spans several categories and one flat list across all
 * of them is wrong in both directions: it offers a laptop supplier for
 * hydraulic pumps, and it lets a healthy total hide a category with a single
 * supplier in it. So the panel opens on the suppliers the master lists against
 * each category in the basket, and keeps everyone else one click away rather
 * than hidden — a buyer who knows the market has reasons the master does not.
 */
export function AddVendorPanel({
  open, onClose, groups, onAdd, alreadyOn,
}: {
  open: boolean;
  onClose: () => void;
  groups: CategoryGroup[];
  onAdd: (vendorId: string, category: string | null) => void;
  alreadyOn: string[];
}) {
  const [showOthers, setShowOthers] = React.useState<string | null>(null);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add a vendor"
      subtitle={`Proposed per category from the vendor master. ${MIN_BIDDERS_PER_CATEGORY} per category is where competitive tension starts.`}
      width={520}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {groups.map((group) => {
          const { suggested, others } = suggestBidders(
            COUNTERPARTIES, group.category, group.superCategory,
          );
          const open_ = showOthers === group.category;
          const offered = (open_ ? [...suggested, ...others] : suggested)
            .filter((c) => !alreadyOn.includes(c.id));
          return (
            <div key={group.category} className="rfx-stack" style={{ gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{group.category}</strong>
                <span style={{ fontSize: 11.5, color: color.textSecondary }}>
                  {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'} in the basket
                </span>
              </div>
              {offered.length === 0 ? (
                <div style={{ fontSize: 11.5, color: color.textSecondary }}>
                  Everyone the master lists against {group.category} is already on the event.
                </div>
              ) : offered.map((cp) => (
                <AddVendorRow
                  key={cp.id}
                  counterparty={cp}
                  category={group.category}
                  offMaster={!suggested.some((s) => s.id === cp.id)}
                  onAdd={() => onAdd(cp.id, group.category)}
                />
              ))}
              {!open_ && others.filter((c) => !alreadyOn.includes(c.id)).length > 0 && (
                <div>
                  <Button variant="tertiary" size="small" onClick={() => setShowOthers(group.category)}>
                    + Add another supplier ({others.filter((c) => !alreadyOn.includes(c.id)).length} available)
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div style={{ fontSize: 12.5, color: color.textSecondary }}>
            Add lines first — the shortlist is proposed from what the event is actually buying.
          </div>
        )}
      </div>
    </Drawer>
  );
}

function AddVendorRow({
  counterparty: cp, category, offMaster, onAdd,
}: { counterparty: Counterparty; category: string; offMaster: boolean; onAdd: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        border: `1px solid ${color.border}`, background: color.surface,
        borderRadius: radius.control, padding: '8px 11px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{cp.name}</span>
          <span style={{ fontSize: 10.5, color: color.textMuted, fontFamily: font.mono }}>{cp.code}</span>
          {cp.isProvisional && (
            <Chip tone="gold" icon="⚑" title="Not yet on the vendor master">provisional</Chip>
          )}
          {offMaster && (
            <Chip tone="neutral" title={`The vendor master does not list ${cp.name} against ${category}`}>
              off-category
            </Chip>
          )}
        </div>
        <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
          {cp.categoriesServed.join(', ')} · {cp.locationsServed.join(', ')}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9.5, color: color.textSecondary }}>Onboard / Perf</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {cp.onboardingRating} / {cp.performanceRating === 0 ? '—' : cp.performanceRating}
        </div>
      </div>
      <Button variant="secondary" size="small" onClick={onAdd}>Add</Button>
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
/**
 * Whether a section has room left, in one chip.
 *
 * The wizard has no space for a meter beside every heading, and the number a
 * buyer needs while editing is the one that answers "can I add another scored
 * question here".
 */
/**
 * What a knockout actually tests, in the words the rule is written in.
 *
 * "Knockout" on its own tells a buyer the question gates and nothing about
 * what passes it, which is the only part anyone reviewing the form wants to
 * check. Read off the answer format rather than restated, so it cannot drift
 * from the rule the supplier's form will enforce.
 */
function knockoutRule(question: TemplateQuestion): string {
  if (question.type === 'certificate') return 'valid on bid date';
  const { min, unit, options } = question.config;
  if (typeof min === 'number' && min > 0) {
    return `at least ${min}${unit ? ` ${unit}` : ''}`;
  }
  const failing = (options ?? []).filter((option) => option.isDisqualifying);
  if (failing.length > 0) return `fails on ${failing.map((option) => option.label).join(', ')}`;
  return 'pass / fail';
}

/** The two grains, and how each is introduced. */
const SCOPE_CARDS: {
  scope: QuestionScope; title: string; icon: string; addLabel: string; empty: string;
}[] = [
  {
    scope: 'VENDOR', title: 'About the supplier', icon: '☖',
    addLabel: 'Add supplier question',
    empty: 'Nothing is asked about the company yet — credentials, capacity, compliance.',
  },
  {
    scope: 'LINE', title: 'Per line item', icon: '▤',
    addLabel: 'Add line-item question',
    empty: 'Nothing is asked per item yet — price, lead time, the brand offered.',
  },
];

/**
 * How the technical score is made up, before the rows that make it up.
 *
 * Split by grain rather than by section, because the grain is what decides how
 * much a supplier is actually asked: five line-level questions against a
 * six-line basket is thirty answers, and a buyer reading a section list has no
 * way to see that.
 */
function ScoreSplit({
  supplier, line, supplierCount, lineCount, knockouts, priced, lines,
}: {
  supplier: { declared: number; allocated: number };
  line: { declared: number; allocated: number };
  supplierCount: number;
  lineCount: number;
  knockouts: TemplateQuestion[];
  priced: TemplateQuestion[];
  lines: number;
}) {
  const total = supplier.declared + line.declared;
  const pct = (part: number) => (total === 0 ? 0 : (part / total) * 100);
  // Declared weight with nothing scored under it earns nobody anything, so
  // the bar would be drawing a split of a score that cannot be awarded.
  const earnable = supplier.allocated + line.allocated;

  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.card,
        background: '#fff', padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          gap: 10, flexWrap: 'wrap', marginBottom: 9,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>How suppliers are scored</div>
        <div style={{ fontSize: 11, color: color.textSecondary }}>
          The technical / commercial split of the award score is set on the event's evaluation tab
        </div>
      </div>

      {earnable === 0 ? (
        <div style={{ fontSize: 11.5, color: color.textMuted, marginBottom: 9 }}>
          Nothing is scored — this questionnaire gathers information only, without contributing to
          the ranking. That is right for a pure RFI and wrong for an RFP.
        </div>
      ) : (
        <div
          role="img"
          aria-label={`Technical score: ${supplier.declared}% supplier-level, ${line.declared}% line-level`}
          style={{
            display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden',
            background: color.neutralSoft, marginBottom: 10,
          }}
        >
          <div style={{ width: `${pct(supplier.declared)}%`, background: color.brandPrimary }} />
          <div style={{ width: `${pct(line.declared)}%`, background: color.infoText }} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
          gap: 12,
        }}
      >
        <Legend
          swatch={color.brandPrimary}
          label={`Asked once per supplier · ${supplier.declared}%`}
          detail={`${supplierCount} question${supplierCount === 1 ? '' : 's'}, ${supplier.allocated} of ${supplier.declared}% allocated`}
        />
        <Legend
          swatch={color.infoText}
          label={`Asked per line item · ${line.declared}%`}
          detail={`${lineCount} question${lineCount === 1 ? '' : 's'} × ${lines} line${lines === 1 ? '' : 's'} = ${lineCount * lines} answers`}
        />
        <Legend
          swatch={null}
          label={`Knockouts · ${knockouts.length}`}
          detail={knockouts.length === 0
            ? 'Nothing gates this stage — every supplier reaches scoring.'
            : 'Pass / fail. They carry no weight.'}
        />
        {priced.length > 0 && (
          <Legend
            swatch={null}
            label={`Price · ${priced.length}`}
            detail="From the price schedule, compared per line. It carries no question weight, by rule."
          />
        )}
      </div>
    </div>
  );
}

function Legend({
  swatch, label, detail,
}: { swatch: string | null; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 9, height: 9, borderRadius: 2, marginTop: 4, flexShrink: 0,
          background: swatch ?? 'transparent',
          border: swatch ? 'none' : `1.5px solid ${color.textMuted}`,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.5, marginTop: 2 }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function SectionBudgetChip({ budget }: { budget: SectionBudget | undefined }) {
  if (budget === undefined) return null;
  if (budget.overspent) return <Chip tone="danger" icon="✕">{-budget.remaining} over</Chip>;
  if (budget.declared === 0) return <Chip tone="neutral">not scored</Chip>;
  if (budget.remaining > 0) return <Chip tone="gold">{budget.remaining} of {budget.declared} unspent</Chip>;
  return <Chip tone="brand">{budget.declared} allocated</Chip>;
}

/**
 * One line of the "who is asked" block: what it is set to now, and the way to
 * change it. Reads as a statement rather than a control, because for most
 * questions it is one — the buyer is meant to pass over it, not fill it in.
 */
function AudienceLine({
  icon, label, value, narrowed, empty, onChoose,
}: {
  icon: string;
  label: string;
  value: string;
  narrowed: boolean;
  empty: boolean;
  onChoose: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span aria-hidden style={{ color: color.textMuted, fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 11.5, color: color.textSecondary, minWidth: 68 }}>{label}</span>
      <span
        style={{
          fontSize: 12, fontWeight: narrowed ? 600 : 400,
          color: empty ? color.dangerText : narrowed ? color.brandPrimaryStrong : color.textBody,
        }}
      >
        {value}
      </span>
      <Button variant="tertiary" size="small" onClick={onChoose}>
        {narrowed ? 'Change' : 'Choose…'}
      </Button>
      {narrowed && (
        <Chip tone="info">narrowed</Chip>
      )}
    </div>
  );
}

/**
 * Putting the event's questionnaire into the library.
 *
 * The library is not meant to be written only in the abstract. The shape a
 * question set ends up in on a real event — after the uploads, the edits and
 * the arguments about weight — is the best starting point the next event
 * could have, and losing it because there was no way back to the library is
 * how two buyers end up writing the same twenty questions twice.
 *
 * Replacing is not hidden behind the same button as creating. Saving under a
 * name the library already holds says so, in the dialog, before anything is
 * written — because the two are different acts and only one of them can be
 * undone by deleting something.
 */
export function SaveToLibrary({
  initialName, points, point, category, authoredNames, blocked, onClose, onSave,
}: {
  initialName: string;
  /** The points this event asks at — the ones worth offering to tick. */
  points: VendorInputPoint[];
  point: VendorInputPoint;
  /** The category this questionnaire serves, where the event splits by one. */
  category: string | null;
  /** Template names already authored at each scope, to spot a replacement. */
  authoredNames: Record<'TENANT' | 'CATEGORY', string[]>;
  /** Why it cannot be saved, when it cannot. */
  blocked: string | null;
  onClose: () => void;
  onSave: (next: {
    name: string; appliesTo: VendorInputPoint[]; scopeType: 'TENANT' | 'CATEGORY';
  }) => void;
}) {
  const [name, setName] = React.useState(initialName);
  const [appliesTo, setAppliesTo] = React.useState<VendorInputPoint[]>([point]);
  const [scopeType, setScopeType] = React.useState<'TENANT' | 'CATEGORY'>(
    category === null ? 'TENANT' : 'CATEGORY',
  );

  const trimmed = name.trim();
  const replaces = authoredNames[scopeType].find(
    (each) => each.trim().toLowerCase() === trimmed.toLowerCase(),
  ) ?? null;

  return (
    <Modal
      open
      title="Save this questionnaire to the library"
      width={560}
      onClose={onClose}
      onConfirm={() => { onSave({ name: trimmed, appliesTo, scopeType }); onClose(); }}
      confirmLabel={replaces === null ? 'Create template' : 'Replace template'}
      confirmDisabled={trimmed === '' || appliesTo.length === 0 || blocked !== null}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        {blocked !== null && (
          <div
            style={{
              fontSize: 11.5, lineHeight: 1.55, color: color.dangerText,
              background: color.dangerSoft, border: `1px solid ${color.danger}`,
              borderRadius: radius.control, padding: '7px 10px',
            }}
          >
            ✕ {blocked}
          </div>
        )}

        <Field label="Name" required hint="What the next buyer will pick it by.">
          <TextInput
            value={name}
            aria-label="Template name"
            placeholder="e.g. IT software — RFP"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="Offered at"
          hint="The points in a journey where this template may be chosen."
        >
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {points.map((p) => (
              <Checkbox
                key={p}
                checked={appliesTo.includes(p)}
                label={pointLabel(p)}
                onChange={(on) => setAppliesTo(on
                  ? [...appliesTo, p]
                  : appliesTo.filter((x) => x !== p))}
              />
            ))}
          </div>
        </Field>

        {category !== null && (
          <Field
            label="Where it lives"
            hint="A category library is offered on events buying in that category. The tenant library is offered everywhere."
          >
            <Segmented
              value={scopeType}
              onChange={(next) => setScopeType(next as 'TENANT' | 'CATEGORY')}
              options={[
                { value: 'CATEGORY', label: `${category} library` },
                { value: 'TENANT', label: 'Tenant library' },
              ]}
            />
          </Field>
        )}

        <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
          {replaces === null
            ? 'This creates a new template. The event keeps its own copy, so editing either'
              + ' one afterwards leaves the other alone.'
            : `There is already a template called "${replaces}" here. Saving writes over it as a`
              + ' new version. Events that already asked it keep the questions they asked.'}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Tagging several questions at once.
 *
 * Appears only once something is ticked, which means a buyer who is writing
 * questions never sees it at all. Who a question goes to is a decision taken
 * after the questions exist and about a handful of them together — so it gets
 * one bar, holding every control for that one decision, applied to everything
 * selected. The alternative is the same choice made four times in four
 * editors, which is four chances to make it differently by accident.
 *
 * Exported so it can be rendered on its own: the bar is the part of this step
 * that a first paint never reaches.
 */
export function BulkTagBar({
  count, scope, onPickVendors, onPickLines, onEveryone, onClear,
}: {
  count: number;
  /** Lines can only be narrowed where the question is asked per line. */
  scope: QuestionScope;
  onPickVendors: () => void;
  onPickLines: () => void;
  onEveryone: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 12px', borderBottom: `1px solid ${color.border}`,
        background: color.brandPrimarySoft,
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>
        {count} question{count === 1 ? '' : 's'} selected
      </span>
      <Button variant="secondary" size="small" onClick={onPickVendors}>
        ☖ Ask of suppliers…
      </Button>
      {scope === 'LINE' && (
        <Button variant="secondary" size="small" onClick={onPickLines}>
          ▤ Ask about lines…
        </Button>
      )}
      <Button
        variant="tertiary"
        size="small"
        title="Put these questions back to every supplier and every line"
        onClick={onEveryone}
      >
        Ask everyone
      </Button>
      <Button variant="tertiary" size="small" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

/**
 * One row in the audience picker — a supplier or a line, described the same
 * way so the two pickers behave identically. A buyer who has narrowed one has
 * learned how to narrow the other.
 */
interface AudienceRow {
  id: string;
  title: string;
  subtitle: string;
  chips: { label: string; tone?: React.ComponentProps<typeof Chip>['tone'] }[];
}

/**
 * Narrowing a question to some of the suppliers, or some of the lines.
 *
 * Built around one choice rather than a list of checkboxes, because that is
 * what the buyer is actually deciding: everyone, or not everyone. The list
 * only appears once they have said "not everyone", so the common case — which
 * is almost every question — costs a glance and no clicks at all.
 *
 * Ticking the last box collapses the selection back to "everyone" rather than
 * leaving a full list behind. The two look identical on screen and behave
 * differently the next time a supplier is invited, and a state the buyer
 * cannot see is a state they cannot have meant.
 */
function AudiencePicker({
  title, noun, everyoneLabel, everyoneHint, mixedNote, rows, groups, selected, onClose, onApply,
}: {
  title: string;
  /** "supplier" / "line" — the word the counts and the empty state use. */
  noun: string;
  everyoneLabel: string;
  everyoneHint: string;
  /**
   * Said when several questions are being narrowed together and they do not
   * currently agree. The picker then opens on nothing, because there is no
   * honest starting point, and this is the sentence that explains why.
   */
  mixedNote?: string;
  rows: AudienceRow[];
  /** One-click narrowings worth having: a category, a lot, the unproven ones. */
  groups: { label: string; ids: string[] }[];
  /** Null means everyone. */
  selected: string[] | null;
  onClose: () => void;
  onApply: (next: string[] | null) => void;
}) {
  const [picked, setPicked] = React.useState<string[] | null>(selected);
  const [query, setQuery] = React.useState('');
  const everyone = picked === null;
  const chosen = picked ?? rows.map((r) => r.id);

  const set = (ids: string[]) =>
    // A selection covering everything is "everyone", stored as the rule it is
    // rather than as a list that goes stale the next time one is added.
    setPicked(ids.length === rows.length ? null : ids);

  const toggle = (id: string) =>
    set(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  const needle = query.trim().toLowerCase();
  const shown = needle === ''
    ? rows
    : rows.filter((r) => `${r.title} ${r.subtitle}`.toLowerCase().includes(needle));

  return (
    <Modal
      open
      title={title}
      width={600}
      onClose={onClose}
      onConfirm={() => { onApply(picked); onClose(); }}
      confirmLabel="Apply"
      confirmDisabled={!everyone && chosen.length === 0}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        {mixedNote !== undefined && (
          <div
            style={{
              fontSize: 11.5, lineHeight: 1.55, color: color.warningText,
              background: color.warningSoft, border: `1px solid ${color.warning}`,
              borderRadius: radius.control, padding: '7px 10px',
            }}
          >
            ⚠ {mixedNote}
          </div>
        )}
        <Segmented
          value={everyone ? 'ALL' : 'SOME'}
          onChange={(next) => setPicked(next === 'ALL' ? null : chosen)}
          options={[
            { value: 'ALL', label: `${everyoneLabel} (${rows.length})` },
            { value: 'SOME', label: 'Only some' },
          ]}
        />

        {everyone ? (
          <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
            {everyoneHint}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="tertiary" size="small" onClick={() => set(rows.map((r) => r.id))}>
                Select all
              </Button>
              <Button variant="tertiary" size="small" onClick={() => setPicked([])}>
                Clear
              </Button>
              {groups.map((group) => (
                <Button
                  key={group.label}
                  variant="tertiary"
                  size="small"
                  onClick={() => set(group.ids)}
                  title={`Ask only the ${group.ids.length} in ${group.label}`}
                >
                  {group.label} ({group.ids.length})
                </Button>
              ))}
            </div>

            {rows.length > 8 && (
              <TextInput
                value={query}
                aria-label={`Search ${noun}s`}
                placeholder={`Search ${noun}s`}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}

            <div
              style={{
                border: `1px solid ${color.border}`, borderRadius: radius.control,
                maxHeight: 300, overflowY: 'auto',
              }}
            >
              {shown.length === 0 ? (
                <div style={{ padding: '16px 12px', fontSize: 12, color: color.textMuted }}>
                  No {noun} matches "{query}".
                </div>
              ) : shown.map((row, i) => (
                <label
                  key={row.id}
                  style={{
                    display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer',
                    padding: '8px 11px',
                    borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                    background: chosen.includes(row.id) ? color.brandPrimarySoft : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(row.id)}
                    aria-label={row.title}
                    onChange={() => toggle(row.id)}
                    style={{ marginTop: 2, accentColor: color.brandPrimary }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                        fontSize: 12.5, fontWeight: 500,
                      }}
                    >
                      {row.title}
                      {row.chips.map((chip) => (
                        <Chip key={chip.label} tone={chip.tone}>{chip.label}</Chip>
                      ))}
                    </span>
                    <span
                      style={{
                        display: 'block', fontSize: 11, color: color.textMuted, marginTop: 2,
                      }}
                    >
                      {row.subtitle}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div
              style={{
                fontSize: 11.5,
                color: chosen.length === 0 ? color.dangerText : color.textSecondary,
                lineHeight: 1.5,
              }}
            >
              {chosen.length === 0
                ? `Nothing selected — a question asked of no ${noun} collects no answers.`
                : `Asked of ${chosen.length} of ${rows.length} ${noun}s.`
                  + ` ${rows.length - chosen.length} will not see it.`}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * The questionnaire library, resolved once per category the basket spans.
 *
 * Templates accumulate down the scope chain, so a category library adds to
 * the tenant one rather than hiding it — and a consolidated event has to walk
 * the chain once per category, because "the category library" is a different
 * library for each. Deduplicated by id: the tenant templates are reached from
 * every branch and would otherwise be offered once per category.
 */
function questionnaireLibrary(
  spans: (string | null)[], settings: ConfigSetting[],
): QuestionnaireTemplate[] {
  const byId = new Map<string, QuestionnaireTemplate>();
  for (const forCategory of spans) {
    const resolved = resolveAccumulated<QuestionnaireTemplate>(
      TEMPLATE_CUSTOM_KEY, settings,
      {
        tenantId: SCOPE_LINEAGE.tenantId,
        categoryId: forCategory,
        templateId: null,
        eventId: null,
      },
    ).items;
    for (const template of resolved) byId.set(template.id, template);
  }
  return Array.from(byId.values());
}

export function QuestionnaireStep({
  draft, patch, points, categories,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  points: VendorInputPoint[];
  /** The categories the basket spans, widest first. */
  categories: string[];
}) {
  const { state, dispatch } = useStore();
  const [activePoint, setActivePoint] = React.useState<VendorInputPoint>(points[0] ?? 'RFI');
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'edit' | 'preview'>('edit');
  /** The one question open for editing. One at a time keeps the table readable. */
  const [openId, setOpenId] = React.useState<string | null>(null);
  /** The questions being narrowed, if any. Mounted on demand so it opens fresh. */
  const [picking, setPicking] = React.useState<
    { questionIds: string[]; kind: 'VENDOR' | 'LINE' } | null
  >(null);
  /**
   * The questions ticked for tagging together.
   *
   * Who a question goes to is rarely decided while it is being written. It is
   * decided afterwards, about a handful at once — "these four are for the
   * incumbents only" — so that is one decision made once, rather than four
   * trips through four editors making the same choice four times.
   */
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  /**
   * The sections folded shut. Folded rather than opened is what is kept, so a
   * section the buyer has just added arrives open, with its questions showing.
   */
  const [collapsedSections, setCollapsedSections] = React.useState<string[]>([]);
  /** The spreadsheet upload, and the way back into the library. */
  const [importOpen, setImportOpen] = React.useState(false);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [savingToLibrary, setSavingToLibrary] = React.useState(false);
  /**
   * The event's own basket, as the preview's per-line blocks expand against.
   * The draft lines are not line items yet, so they are shaped into the
   * minimum the supplier's renderer reads: a code and a description.
   */
  const previewLines = React.useMemo(
    () => draft.lines.map((line) => ({
      id: line.id, lotId: 'draft', lineNumber: 1, itemCode: line.itemCode,
      description: line.description, specification: line.specification, quantity: line.quantity,
      uom: line.uom, deliveryLocation: line.deliveryLocation, deliveryDate: null,
      incoterm: null, taxClass: null, baselinePrice: line.baselinePrice, baselineSource: null,
      currency: draft.currency, isOptional: false, allowAlternate: false,
      category: line.category, superCategory: line.superCategory, sourcePrLineId: null,
    })),
    [draft.lines, draft.currency],
  );

  // No categories given means the caller is not splitting by category at all,
  // which is one questionnaire covering the whole ask — not one stamped with
  // the event header's category, which would quietly claim a split it has not
  // made and leave every already-shaped questionnaire unmatched.
  const spans: (string | null)[] = categories.length === 0 ? [null] : categories;

  const library = React.useMemo(
    () => questionnaireLibrary(spans, state.configSettings),
    [state.configSettings, spans.join('\u0000')],
  );

  const point = points.includes(activePoint) ? activePoint : points[0];
  const category = activeCategory !== null && spans.includes(activeCategory)
    ? activeCategory
    : spans[0] ?? null;
  const options = React.useMemo(
    () => (point ? templatesFor(library, point, category) : []),
    [library, point, category],
  );

  const write = (next: DraftQuestionnaire) =>
    patch({
      questionnaires: [
        ...draft.questionnaires.filter(
          (q) => !(q.point === next.point && q.category === next.category),
        ),
        next,
      ],
    });

  // Every point the journey asks at starts from the library template that
  // applies there, so the buyer edits a real questionnaire rather than filling
  // a blank page. Points already shaped are left exactly as they are.
  const seeded = seedQuestionnaires({
    existing: draft.questionnaires, points, library, categories: spans, idSeed: 'draft',
  });
  React.useEffect(() => {
    if (seeded.length !== draft.questionnaires.length
        || seeded.some((q, i) => q !== draft.questionnaires[i])) {
      patch({ questionnaires: seeded });
    }
  });

  const current = seeded.find((q) => q.point === point && q.category === category) ?? null;

  if (!point) {
    return (
      <div style={{ fontSize: 12.5, color: color.textSecondary, lineHeight: 1.6 }}>
        This journey never puts a questionnaire in front of a supplier — the auction takes a live
        bid and nothing else. Anything you need asked has to be asked before it opens.
      </div>
    );
  }

  if (!current) return null;

  /**
   * Who and what this questionnaire can reach.
   *
   * Not every supplier on the event and not every line in the basket — the
   * ones that belong to *this* questionnaire. A consolidated event carries one
   * questionnaire per category, and offering a pallet supplier against the
   * laptop questions would invite a narrowing that can never be answered.
   * With nothing invited yet the roster falls back to the event's vendors, so
   * a buyer who writes the questionnaire before the shortlist still has names
   * to work with.
   */
  const rosterLines = draft.lines.filter(
    (line) => category === null || (line.category || draft.category) === category,
  );
  const invitedHere = Array.from(new Set(
    rosterLines.flatMap((line) => draft.invitedByLine[line.id] ?? []),
  ));
  const roster: AudienceRoster = {
    vendorIds: (invitedHere.length > 0 ? invitedHere : draft.vendorIds)
      // Kept in the order the roster screen lists them, so the picker reads
      // the same way the Items & Vendors step does.
      .filter((id, i, all) => all.indexOf(id) === i),
    lineIds: rosterLines.map((line) => line.id),
  };
  const scopeOf = (question: TemplateQuestion) => effectiveScope(question, current.sections);

  /**
   * Drop references the event no longer holds, before anything is read off
   * them. A supplier removed from the shortlist must not keep a question
   * narrowed to them, and a narrowing that has lost every id has to read as
   * "asks nobody" rather than quietly widen back to everyone.
   */
  const pruned = pruneAudience(current, roster);
  React.useEffect(() => {
    if (pruned !== current) write(pruned);
  });
  // Every audience is read off the pruned copy rather than the stored one, so
  // a count never includes a supplier who has already left the shortlist —
  // not even for the one render before the effect above writes the clean
  // version back.


  /** The questions on this form that are not asked of everyone. */
  const narrowed = narrowedQuestions(pruned, roster, scopeOf);
  const audienceProblems = audienceIssues(pruned, roster, scopeOf);
  const audienceProblemBy = new Map(audienceProblems.map((i) => [i.questionId, i]));

  const validation = validateTemplate(draftAsTemplate(current));
  const issuesByQuestion = new Map<string, string[]>();
  for (const issue of [...validation.errors, ...validation.warnings]) {
    if (!issue.questionId) continue;
    issuesByQuestion.set(issue.questionId, [
      ...(issuesByQuestion.get(issue.questionId) ?? []),
      issue.message,
    ]);
  }
  // A narrowing that reaches nobody is shown on the row it belongs to, beside
  // the weighting problems, rather than only in a banner at the top where the
  // buyer has to work out which of twenty rows it means.
  for (const issue of audienceProblems) {
    issuesByQuestion.set(issue.questionId, [
      ...(issuesByQuestion.get(issue.questionId) ?? []),
      issue.message,
    ]);
  }

  const ordered = [...current.questions].sort((a, b) => a.sequence - b.sequence);
  const shares = normalise(ordered.filter(isScored));
  const shareOf = (id: string) => shares.find((s) => s.item.id === id)?.effectivePct ?? null;

  // The section budgets, computed by the library's own rule rather than a
  // second copy of it here.
  const budgets = sectionBudgets(draftAsTemplate(current));
  const budgetFor = (sectionId: string) => budgets.find((b) => b.section.id === sectionId);
  const ceilingFor = (questionId: string) =>
    weightCeilingFor(draftAsTemplate(current), questionId);

  /**
   * The two grains the page is organised by.
   *
   * A section already carries the grain, so a question's grain is its
   * section's — which is what `effectiveScope` resolves, including the types
   * that span the whole basket however they are filed.
   */
  const byScope: Record<QuestionScope, TemplateQuestion[]> = {
    VENDOR: ordered.filter((q) => effectiveScope(q, current.sections) === 'VENDOR'),
    LINE: ordered.filter((q) => effectiveScope(q, current.sections) === 'LINE'),
  };

  /** The budget of a whole grain: every section at it, declared and spent. */
  const budgetOfScope = (scope: QuestionScope) => {
    const inScope = budgets.filter((b) => b.section.askedPer === scope);
    return {
      declared: inScope.reduce((sum, b) => sum + b.declared, 0),
      allocated: inScope.reduce((sum, b) => sum + b.allocated, 0),
    };
  };
  const supplierBudget = budgetOfScope('VENDOR');
  const lineBudget = budgetOfScope('LINE');

  /**
   * The templates authored at one scope — the exact list a save writes back.
   *
   * Read straight off the settings rather than off the accumulated library,
   * because saving must replace the list it came from and nothing else: a
   * category save that wrote back the accumulated items would copy every
   * tenant template into the category's own bucket.
   */
  const authoredAt = (scopeType: 'TENANT' | 'CATEGORY', scopeId: string) => {
    const setting = state.configSettings.find(
      (each) => each.key === TEMPLATE_CUSTOM_KEY
        && each.scopeType === scopeType && each.scopeId === scopeId,
    );
    return Array.isArray(setting?.value) ? (setting.value as QuestionnaireTemplate[]) : [];
  };

  const libraryScopeId = (scopeType: 'TENANT' | 'CATEGORY') =>
    (scopeType === 'TENANT' ? SCOPE_LINEAGE.tenantId : category);

  const saveToLibrary = (
    { name, appliesTo, scopeType }:
    { name: string; appliesTo: VendorInputPoint[]; scopeType: 'TENANT' | 'CATEGORY' },
  ) => {
    const scopeId = libraryScopeId(scopeType);
    if (scopeId === null) return;
    const authored = authoredAt(scopeType, scopeId);
    const previous = authored.find(
      (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    ) ?? null;
    const id = previous?.id ?? nextTemplateId([...library, ...authored]);
    const template = templateFromDraft(pruned, {
      id, name, appliesTo, scopeType, scopeId,
      userId: state.currentUser.id, now: serverNow(), previous,
    });
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key: TEMPLATE_CUSTOM_KEY, scopeType, scopeId,
        value: previous === null
          ? [...authored, template]
          : authored.map((t) => (t.id === id ? template : t)),
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
    // The event is now asking exactly what the library holds, so it says so.
    // Leaving the link off would make the next screen claim the questions came
    // from nowhere, a minute after they were put somewhere.
    write({ ...pruned, templateId: id, templateName: template.name });
  };

  const setQuestion = (id: string, next: Partial<TemplateQuestion>) =>
    write({
      ...current,
      questions: current.questions.map((q) => (q.id === id ? { ...q, ...next } : q)),
    });

  /** Only the ticked questions that are still on this form, at one grain. */
  const selectedAt = (scope: QuestionScope) =>
    byScope[scope].filter((q) => selectedIds.includes(q.id)).map((q) => q.id);

  const toggleSelected = (id: string) =>
    setSelectedIds(selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id]);

  /**
   * The table columns, built per section.
   *
   * Per section rather than once, because the tick-all box in the header
   * belongs to the group it sits in: ticking everything in one section must
   * not quietly tick the questions in the section below it.
   */
  const questionColumns = (
    here: TemplateQuestion[], groupName: string,
  ): Column<TemplateQuestion>[] => [
    {
      key: 'n', header: (() => {
        const picked = here.filter((q) => selectedIds.includes(q.id)).map((q) => q.id);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              aria-label={`Select every question in ${groupName}`}
              checked={here.length > 0 && picked.length === here.length}
              disabled={here.length === 0}
              onChange={() => setSelectedIds(picked.length === here.length
                ? selectedIds.filter((id) => !picked.includes(id))
                : Array.from(new Set([...selectedIds, ...here.map((q) => q.id)])))}
              style={{ accentColor: color.brandPrimary }}
            />
            <span style={{ color: color.textMuted }}>#</span>
          </span>
        );
      })(), width: '62px',
      // Numbered down the whole grain, not restarting in each section, so a
      // question keeps the number the supplier will see it under.
      render: (q) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            aria-label={`Select ${q.code}`}
            checked={selectedIds.includes(q.id)}
            onChange={() => toggleSelected(q.id)}
            style={{ accentColor: color.brandPrimary }}
          />
          <span style={{ fontSize: 11, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {byScope[scopeOf(q)].findIndex((each) => each.id === q.id) + 1}
          </span>
        </span>
      ),
    },
    {
      key: 'question', header: 'Question',
      render: (q) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 }}>
            {q.title.trim() === ''
              ? <span style={{ color: color.textMuted, fontStyle: 'italic' }}>Untitled question</span>
              : q.title}
          </div>
          <div style={{ fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
            <code>{q.code}</code>
            {q.isRequired && ' · required'}
            {q.allowAttachment && ' · attachment'}
          </div>
          {(issuesByQuestion.get(q.id) ?? []).map((message) => (
            <div key={message} style={{ fontSize: 11, color: color.warningText, marginTop: 3, lineHeight: 1.45 }}>
              ● {message}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'type', header: 'Type', width: '150px',
      render: (q) => <span style={{ fontSize: 12 }}>{typeLabel(q.type)}</span>,
    },
    {
      key: 'envelope', header: 'Envelope', width: '120px',
      render: (q) => (
        <Chip
          tone={q.envelope === 'COMMERCIAL' ? 'purple' : q.envelope === 'TECHNICAL' ? 'info' : 'neutral'}
          icon={q.envelope === 'COMMERCIAL' ? '🔒' : undefined}
        >
          {q.envelope === 'COMMERCIAL' ? 'Commercial' : q.envelope === 'TECHNICAL' ? 'Technical' : 'General'}
        </Chip>
      ),
    },
    // Where else the same code is asked. Omitted on a journey that asks once,
    // where every row would carry the same chip and say nothing.
    ...(points.length > 1 ? [{
      key: 'asked', header: 'Asked at', width: '140px',
      render: (q: TemplateQuestion) => {
        const at = pointsAsking(seeded, q.code, category);
        return (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {at.map((p) => (
              <Chip key={p} tone={p === point ? 'brand' : 'neutral'}>{pointLabel(p)}</Chip>
            ))}
          </div>
        );
      },
    }] : []),
    {
      // Who the question reaches. Deliberately quiet when it reaches everyone:
      // "All 6 suppliers" repeated down twenty rows is ink spent on the thing
      // that needs no attention, and it is the exception the buyer scans for.
      key: 'audience', header: 'Asked of', width: '150px',
      render: (q: TemplateQuestion) => {
        // A page break or an instruction block is not put to anybody, so the
        // column stays empty rather than claiming it reaches six suppliers.
        if (STRUCTURAL_TYPES.includes(q.type)) return null;
        const audience = audienceOf(pruned, q.id);
        const summary = audienceSummary(audience, roster, scopeOf(q));
        const problem = audienceProblemBy.get(q.id);
        if (summary === null) {
          return (
            <span
              style={{ fontSize: 11.5, color: color.textMuted }}
              title={scopeOf(q) === 'LINE'
                ? `All ${roster.vendorIds.length} suppliers, all ${roster.lineIds.length} lines`
                : `All ${roster.vendorIds.length} suppliers`}
            >
              Everyone
            </span>
          );
        }
        return (
          <Chip tone={problem?.tone === 'error' ? 'danger' : 'info'}>
            {summary}
          </Chip>
        );
      },
    },
    {
      key: 'rule', header: 'Rule or weight', width: '210px',
      render: (q) => {
        if (q.isKnockout) {
          return (
            <span style={{ fontSize: 11.5, color: color.dangerText }}>
              ⛉ Knockout · {knockoutRule(q)}
            </span>
          );
        }
        if (PRICED_QUESTION_TYPES.includes(q.type)) {
          return (
            <span style={{ fontSize: 11.5, color: color.textSecondary }}>
              Priced — scored through the price component
            </span>
          );
        }
        if (!isScored(q)) {
          return <span style={{ fontSize: 11.5, color: color.textMuted }}>Not weighted</span>;
        }
        const share = shareOf(q.id);
        return (
          <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
            {q.weight}
            <span style={{ color: color.textSecondary }}>
              {share === null ? '' : ` · ${share.toFixed(1)}% of technical`}
            </span>
          </span>
        );
      },
    },
    {
      key: 'actions', header: '', width: '112px',
      render: (q) => (
        <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Button
            variant="icon" size="small" aria-label={`Move ${q.code} up`}
            onClick={() => write(moveDraftQuestion(current, q.id, -1))}
          >
            ▲
          </Button>
          <Button
            variant="icon" size="small" aria-label={`Move ${q.code} down`}
            onClick={() => write(moveDraftQuestion(current, q.id, 1))}
          >
            ▼
          </Button>
          <Button
            variant="icon" size="small" aria-label={`Remove ${q.code}`}
            onClick={() => {
              if (openId === q.id) setOpenId(null);
              write(removeDraftQuestion(current, q.id));
            }}
          >
            ✕
          </Button>
          <Button
            variant="icon" size="small"
            aria-label={`${openId === q.id ? 'Close' : 'Edit'} ${q.code}`}
            onClick={() => setOpenId(openId === q.id ? null : q.id)}
          >
            {openId === q.id ? '⌃' : '⌄'}
          </Button>
        </div>
      ),
    },
  ];

  /**
   * The expanded row.
   *
   * Everything about one question, in the order a buyer decides it: what the
   * answer looks like, who sees it, whether it gates or scores, where in the
   * journey it is asked, and what the supplier is told.
   */
  const renderEditor = (question: TemplateQuestion) => {
    const priced = PRICED_QUESTION_TYPES.includes(question.type);
    const scored = isScored(question);
    const ceiling = ceilingFor(question.id);
    const section = current.sections.find((sec) => sec.id === question.sectionId) ?? null;
    const numeric = usesFacet(question.type, 'numeric_range');
    const askedAt = pointsAsking(seeded, question.code, category);
    const audience = audienceOf(pruned, question.id);
    const reach = resolveAudience(audience, roster);
    const load = answerLoad(audience, roster, scopeOf(question));

    return (
      <div className="rfx-stack" style={{ gap: 12, padding: '12px 14px 14px' }}>
        <Field label="Question" required hint="What the supplier reads, in full.">
          <Textarea
            rows={2}
            value={question.title}
            placeholder="What are you asking the supplier?"
            onChange={(e) => setQuestion(question.id, { title: e.target.value })}
          />
        </Field>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))',
            gap: 10,
          }}
        >
          <Field label="Answer type" hint={QUESTION_TYPE_SPEC[question.type].asks}>
            <Select
              value={question.type}
              onChange={(e) =>
                write(setDraftType(current, question.id, e.target.value as typeof question.type))
              }
            >
              {QUESTION_TYPES_BY_GROUP.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.types.map((type) => (
                    <option key={type} value={type}>{typeLabel(type)}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          {numeric && (
            <>
              <Field label="Unit" hint="Fixed here so answers compare.">
                <TextInput
                  value={question.config.unit ?? ''}
                  placeholder="years"
                  onChange={(e) => setQuestion(question.id, {
                    config: { ...question.config, unit: e.target.value },
                  })}
                />
              </Field>
              <Field
                label={question.isKnockout ? 'Minimum to pass' : 'Minimum accepted'}
                hint={question.isKnockout
                  ? 'Below this the supplier fails this stage.'
                  : 'Answers below this are refused by the form.'}
              >
                <NumberInput
                  value={question.config.min ?? 0}
                  onChange={(e) => setQuestion(question.id, {
                    config: { ...question.config, min: Number(e.target.value) },
                  })}
                />
              </Field>
            </>
          )}

          <Field
            label="Envelope"
            hint={question.envelope === 'COMMERCIAL'
              ? 'Sealed until technical scoring is complete.'
              : 'Scored first, before any price is opened.'}
          >
            <Select
              value={question.envelope}
              onChange={(e) =>
                setQuestion(question.id, { envelope: e.target.value as QuestionEnvelope })
              }
            >
              <option value="TECHNICAL">Technical — scored first</option>
              <option value="COMMERCIAL">Commercial — sealed</option>
              <option value="GENERAL">General</option>
            </Select>
          </Field>

          <Field
            label="Section"
            hint={section
              ? `Asked ${QUESTION_SCOPE_LABEL[section.askedPer].toLowerCase()} — the section decides.`
              : 'In no section, so it sits outside every budget.'}
          >
            <Select
              value={question.sectionId ?? ''}
              onChange={(e) => setQuestion(question.id, { sectionId: e.target.value || null })}
            >
              <option value="">— no section —</option>
              {current.sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name} · {QUESTION_SCOPE_LABEL[sec.askedPer]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/*
          Who is asked, sitting between what the question is and what it is
          worth — which is the order a buyer decides it in. Both rows read as
          a sentence with a way to change it, so the default needs no reading
          and the exception needs one glance.
        */}
        {!STRUCTURAL_TYPES.includes(question.type) && (
          <div
            style={{
              border: `1px solid ${color.border}`, borderRadius: radius.control,
              background: color.surfacePage, padding: '9px 11px',
            }}
            className="rfx-stack"
          >
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>Who is asked</div>
            <AudienceLine
              icon="☖"
              label="Suppliers"
              value={audience.vendorIds === null
                ? `All ${roster.vendorIds.length} invited`
                : `${reach.vendorIds.length} of ${roster.vendorIds.length} chosen`}
              narrowed={audience.vendorIds !== null}
              empty={reach.vendorIds.length === 0}
              onChoose={() => setPicking({ questionIds: [question.id], kind: 'VENDOR' })}
            />
            {scopeOf(question) === 'LINE' && (
              <AudienceLine
                icon="▤"
                label="Line items"
                value={audience.lineIds === null
                  ? `All ${roster.lineIds.length} lines`
                  : `${reach.lineIds.length} of ${roster.lineIds.length} chosen`}
                narrowed={audience.lineIds !== null}
                empty={reach.lineIds.length === 0 && roster.lineIds.length > 0}
                onChoose={() => setPicking({ questionIds: [question.id], kind: 'LINE' })}
              />
            )}
            <div style={{ fontSize: 11, color: color.textSecondary, lineHeight: 1.55 }}>
              {load.answers === 0
                ? 'Nobody is asked this, so it will collect nothing.'
                : scopeOf(question) === 'LINE'
                  ? `Answered ${load.answers} time${load.answers === 1 ? '' : 's'} — `
                    + `${load.vendors} supplier${load.vendors === 1 ? '' : 's'} × `
                    + `${load.lines} line${load.lines === 1 ? '' : 's'}.`
                  : `Answered ${load.answers} time${load.answers === 1 ? '' : 's'}, `
                    + 'once by each supplier asked.'}
              {audience.vendorIds !== null && reach.vendorIds.length > 0 && (
                <> Not asked of {roster.vendorIds.length - reach.vendorIds.length} of the
                  {' '}suppliers invited to this ask.</>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Checkbox
            checked={question.isRequired}
            label="Required"
            onChange={(isRequired) => setQuestion(question.id, { isRequired })}
          />
          <Checkbox
            checked={question.isKnockout}
            label="Knockout — suppliers below the minimum fail this stage"
            onChange={(isKnockout) => setQuestion(question.id, { isKnockout })}
          />
          <Checkbox
            checked={scored}
            label="Scored"
            disabled={priced}
            onChange={(next) => write(setDraftScored(current, question.id, next))}
          />
          {scored ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: color.textSecondary }}>Weight</span>
              <div style={{ width: 76 }}>
                <NumberInput
                  value={question.weight}
                  aria-label={`Weight — ${question.code}`}
                  min={0}
                  max={ceiling ?? undefined}
                  onChange={(e) => setQuestion(question.id, {
                    // Clamped to what the section has left, so an over-budget
                    // section is not a state the buyer can author.
                    weight: Math.min(
                      Math.max(0, Number(e.target.value)),
                      ceiling ?? Number.POSITIVE_INFINITY,
                    ),
                  })}
                />
              </div>
              <span style={{ fontSize: 11, color: color.textSecondary }}>
                {ceiling === null
                  ? 'no section budget caps this'
                  : `${ceiling} available in this section`}
              </span>
            </label>
          ) : (
            <span style={{ fontSize: 11.5, color: color.textMuted }}>
              {priced
                ? 'Priced — weight carried by the price component, by rule'
                : question.isKnockout
                  ? 'Knockout questions are pass / fail and carry no weight'
                  : 'Not weighted'}
            </span>
          )}
        </div>

        {points.length > 1 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>Asked at</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {points.map((p) => (
              <Checkbox
                key={p}
                checked={askedAt.includes(p)}
                label={pointLabel(p)}
                disabled={askedAt.length === 1 && askedAt[0] === p}
                onChange={(on) => patch({
                  questionnaires: setAskedAtPoints(
                    seeded, question, category,
                    on ? [...askedAt, p] : askedAt.filter((x) => x !== p),
                  ),
                })}
              />
            ))}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 5, lineHeight: 1.5 }}>
            Asked at more than one point, the code carries the first answer forward rather than
            asking again. A copy starts unweighted at the new point — a question worth 20% of an
            RFP is not thereby worth 20% of an RFQ.
          </div>
        </div>
        )}

        <Field label="Help text shown to suppliers">
          <TextInput
            value={question.helpText}
            placeholder="Anything the supplier needs to know to answer it properly."
            onChange={(e) => setQuestion(question.id, { helpText: e.target.value })}
          />
        </Field>
      </div>
    );
  };

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {view === 'preview' ? (
        <>
          <Button variant="secondary" size="small" onClick={() => setView('edit')}>
            ← Back to editing
          </Button>
          <QuestionnairePreview
            name={current.templateName}
            point={point}
            sections={current.sections}
            questions={current.questions}
            lines={previewLines}
          />
        </>
      ) : (
      <>
      {/*
        The header: what this questionnaire asks, where it came from, and the
        way out to the supplier's view of it.
      */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 14, flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Questionnaire
          </div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
            {ordered.length} question{ordered.length === 1 ? '' : 's'} ·{' '}
            {byScope.VENDOR.length} about the supplier, {byScope.LINE.length} per line item ·
            asked at {pointLabel(point)}
            {category !== null && spans.length > 1 && <> for {category}</>}
          </div>
          <div style={{ fontSize: 11, color: color.textMuted, marginTop: 3, lineHeight: 1.5, maxWidth: 560 }}>
            {POINT_PURPOSE[point]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <Field label="Template">
              <Select
                value={current.templateId ?? 'BLANK'}
                aria-label="Questionnaire template"
                onChange={(e) => {
                  const id = e.target.value;
                  const template = options.find((t) => t.id === id);
                  const prefix = `${point.toLowerCase()}-${category === null ? '' : `${categorySlug(category)}-`}${Date.now()}`;
                  write(
                    template
                      ? instantiateTemplate(template, point, prefix, category)
                      : blankQuestionnaire(point, prefix, category),
                  );
                }}
              >
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.questions.length} questions
                  </option>
                ))}
                {/*
                  What "no template" means depends on whether anything has been
                  written. After an upload the event is asking a real set of
                  questions that simply did not come from the library, and
                  calling that "blank" would be flatly wrong.
                */}
                <option value="BLANK">
                  {current.templateId === null && current.questions.length > 0
                    ? `${current.templateName} · not from the library`
                    : 'Blank — start from nothing'}
                </option>
              </Select>
            </Field>
          </div>
          <Button
            variant="primary"
            title="An agent reads your items and suppliers, asks what it needs, and builds the questionnaire as an Excel / CSV file"
            onClick={() => setAgentOpen(true)}
          >
            ✦ Build with agent
          </Button>
          <Button
            variant="secondary"
            title="Replace or add questions from an Excel or CSV file"
            onClick={() => setImportOpen(true)}
          >
            ⬆ Upload Excel / CSV
          </Button>
          <Button
            variant="secondary"
            title="Keep this question set in the library for the next event"
            onClick={() => setSavingToLibrary(true)}
          >
            ⇧ Save to library
          </Button>
          <Button variant="secondary" onClick={() => setView('preview')}>
            ◉ Preview as a supplier
          </Button>
        </div>
      </div>

      {/* How the score is made up, before any of the rows that make it up. */}
      <ScoreSplit
        supplier={supplierBudget}
        line={lineBudget}
        supplierCount={byScope.VENDOR.length}
        lineCount={byScope.LINE.length}
        knockouts={ordered.filter((q) => q.isKnockout)}
        priced={ordered.filter((q) => PRICED_QUESTION_TYPES.includes(q.type))}
        lines={draft.lines.length}
      />

      {points.length > 1 && (
        <div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 7, lineHeight: 1.5 }}>
            This journey asks the supplier more than once, and each point gets its own
            questionnaire. A question repeated under the same code carries its first answer
            forward rather than asking again.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {points.map((p) => {
              const q = draft.questionnaires.find((x) => x.point === p && x.category === category);
              const asked = q?.questions ?? [];
              // What the point actually does, not just how many rows it has:
              // a stage of pure knockouts gates and scores nothing, and a
              // stage holding the price is a different kind of ask again.
              const knockouts = asked.filter((x) => x.isKnockout).length;
              const commercial = asked.filter((x) => x.envelope === 'COMMERCIAL').length;
              const technical = asked.length - commercial;
              const summary = asked.length === 0
                ? 'nothing asked'
                : knockouts === asked.length
                  ? `${knockouts} knockout${knockouts === 1 ? '' : 's'}`
                  : [
                    `${asked.length}`,
                    technical > 0 ? `${technical} technical` : null,
                    commercial > 0 ? `${commercial} commercial` : null,
                  ].filter(Boolean).join(' · ');
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActivePoint(p)}
                  style={{
                    border: `1px solid ${p === point ? color.brandPrimary : color.border}`,
                    background: p === point ? color.brandPrimarySoft : '#fff',
                    color: p === point ? color.brandPrimaryStrong : color.textBody,
                    borderRadius: 999, padding: '5px 12px', cursor: 'pointer',
                    fontSize: 11.5, fontWeight: p === point ? 600 : 500, whiteSpace: 'nowrap',
                  }}
                >
                  {pointLabel(p)} · {summary}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {spans.length > 1 && (
        <div>
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 7, lineHeight: 1.5 }}>
            This event buys in {spans.length} categories, so it asks {spans.length} sets of
            questions at each point. A questionnaire goes only to the suppliers shortlisted for
            its category — a pallet supplier is not asked how a laptop is imaged.
          </div>
          <Segmented
            value={category ?? ''}
            onChange={(next) => setActiveCategory(next === '' ? null : next)}
            options={spans.map((c) => {
              const q = draft.questionnaires.find((x) => x.point === point && x.category === c);
              return {
                value: c ?? '',
                label: q ? `${c} · ${q.questions.length}` : String(c),
              };
            })}
          />
        </div>
      )}

      {validation.errors.filter((e) => !e.questionId).map((issue) => (
        <ValidationBanner key={issue.code} tone="error" title={issue.message} />
      ))}
      {validation.warnings.filter((w) => !w.questionId).map((issue) => (
        <ValidationBanner key={issue.code} tone="warning" title={issue.message} />
      ))}

      {/*
        One card per grain, not one per section.
        A buyer reads a questionnaire as two things — what we ask the company
        and what we ask about each item — because that is how the answers come
        back and how they are compared. Sections live inside a grain and are
        shown as a strip when there is more than one, so the budget they carry
        is still visible without making the page a list of six small cards.
      */}
      {SCOPE_CARDS.map((card) => {
        const questions = byScope[card.scope];
        const budget = card.scope === 'VENDOR' ? supplierBudget : lineBudget;
        const sectionsHere = current.sections.filter((s) => s.askedPer === card.scope);
        // The groups drawn in this card: every section at this grain in its own
        // order, then the questions at this grain that sit in no section.
        const unsectioned = questions.filter(
          (q) => !sectionsHere.some((sec) => sec.id === q.sectionId),
        );
        const groupsHere = [
          ...[...sectionsHere].sort((x, y) => x.sequence - y.sequence).map((section) => ({
            key: section.id, section,
            questions: questions.filter((q) => q.sectionId === section.id),
          })),
          ...(unsectioned.length > 0
            ? [{ key: `${card.scope}-unsectioned`, section: null, questions: unsectioned }]
            : []),
        ];
        const narrowedHere = narrowed.filter(
          (n) => scopeOf(n.question) === card.scope,
        ).length;
        const pickedHere = selectedAt(card.scope);
        return (
          <Card
            key={card.scope}
            padded={false}
            title={
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span aria-hidden style={{ color: color.textMuted }}>{card.icon}</span>
                {card.title}
              </span>
            }
            hint={
              `${card.scope === 'LINE'
                ? `Asked for each of the ${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'}`
                : 'Asked once per supplier'
              } · ${questions.length} question${questions.length === 1 ? '' : 's'}`
              + (budget.declared > 0
                ? ` · ${budget.declared}% of the technical score`
                : ' · not weighted')
              // Said only when there is something to say. A form where every
              // question goes to everybody is the normal one and should read
              // as uneventful.
              + (narrowedHere > 0
                ? ` · ${narrowedHere} asked of only some suppliers or lines`
                : '')
            }
          >
            {/*
              The grain's own toolbar: ticking the whole grain, and opening or
              folding every section in it at once. A long questionnaire is
              read a section at a time, so the buyer needs a quick way to fold
              everything down to the headings and open just the one in hand.
            */}
            {(sectionsHere.length > 0 || questions.length > 0) && (
              <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 10, flexWrap: 'wrap', padding: '7px 12px',
                  borderBottom: `1px solid ${color.border}`, background: color.surfacePage,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: color.textSecondary }}>
                  <input
                    type="checkbox"
                    aria-label={`Select every question in ${card.title}`}
                    checked={questions.length > 0 && pickedHere.length === questions.length}
                    disabled={questions.length === 0}
                    onChange={() => setSelectedIds(pickedHere.length === questions.length
                      ? selectedIds.filter((id) => !pickedHere.includes(id))
                      : Array.from(new Set([...selectedIds, ...questions.map((q) => q.id)])))}
                    style={{ accentColor: color.brandPrimary }}
                  />
                  Select all {questions.length} · {sectionsHere.length} section{sectionsHere.length === 1 ? '' : 's'}
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    variant="tertiary" size="small"
                    onClick={() => setCollapsedSections(collapsedSections.filter(
                      (id) => !groupsHere.some((g) => g.key === id),
                    ))}
                  >
                    Expand all
                  </Button>
                  <Button
                    variant="tertiary" size="small"
                    onClick={() => setCollapsedSections(Array.from(new Set([
                      ...collapsedSections, ...groupsHere.map((g) => g.key),
                    ])))}
                  >
                    Collapse all
                  </Button>
                </div>
              </div>
            )}

            {pickedHere.length > 0 && (
              <BulkTagBar
                count={pickedHere.length}
                scope={card.scope}
                onPickVendors={() => setPicking({ questionIds: pickedHere, kind: 'VENDOR' })}
                onPickLines={() => setPicking({ questionIds: pickedHere, kind: 'LINE' })}
                onEveryone={() => write(setAudienceOnAll(
                  pruned, pickedHere, { vendorIds: null, lineIds: null }, roster,
                ))}
                onClear={() => setSelectedIds(
                  selectedIds.filter((id) => !pickedHere.includes(id)),
                )}
              />
            )}

            {groupsHere.length === 0 && (
              <div style={{ padding: '18px 14px', fontSize: 12, color: color.textMuted }}>
                {card.empty}
              </div>
            )}

            {/*
              One expandable group per section, its questions inside it.
              The heading carries the section's name, weight and budget, so
              the share a section claims stays visible even when folded: it is
              the number the 100% rule is about, and a buyer who cannot see it
              cannot fix it.
            */}
            {groupsHere.map((group) => {
              const { section } = group;
              const open = !collapsedSections.includes(group.key);
              const name = section === null
                ? 'Not in a section'
                : section.name.trim() === '' ? 'Untitled section' : section.name;
              const flagged = group.questions.filter((q) => issuesByQuestion.has(q.id)).length;
              return (
                <div key={group.key} style={{ borderBottom: `1px solid ${color.border}` }}>
                  <div
                    style={{
                      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                      padding: '8px 12px', background: open ? color.surfacePage : undefined,
                    }}
                  >
                    <Button
                      variant="icon" size="small"
                      aria-expanded={open}
                      aria-label={`${open ? 'Collapse' : 'Expand'} section ${name}`}
                      onClick={() => setCollapsedSections(open
                        ? [...collapsedSections, group.key]
                        : collapsedSections.filter((id) => id !== group.key))}
                    >
                      {open ? '▾' : '▸'}
                    </Button>
                    {section === null ? (
                      <span style={{ flex: '1 1 180px', fontSize: 12.5, fontStyle: 'italic', color: color.textSecondary }}>
                        {name}
                        <span style={{ fontStyle: 'normal', fontSize: 11, color: color.textMuted }}>
                          {' '}— outside every budget, so it scores nowhere
                        </span>
                      </span>
                    ) : (
                      <div style={{ flex: '1 1 180px', maxWidth: 320 }}>
                        <TextInput
                          value={section.name}
                          aria-label={`Section name — ${section.name}`}
                          onChange={(e) =>
                            write(renameDraftSection(current, section.id, e.target.value))
                          }
                        />
                      </div>
                    )}
                    <Chip tone="neutral">
                      {group.questions.length} question{group.questions.length === 1 ? '' : 's'}
                    </Chip>
                    {flagged > 0 && <Chip tone="gold">{flagged} to fix</Chip>}
                    {section !== null && (
                      <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: color.textSecondary }}>worth</span>
                          <div style={{ width: 72 }}>
                            <NumberInput
                              value={section.weight}
                              aria-label={`Section weight — ${section.name}`}
                              min={0}
                              invalid={budgetFor(section.id)?.overspent}
                              onChange={(e) =>
                                write({
                                  ...current,
                                  sections: current.sections.map((sec) =>
                                    sec.id === section.id
                                      ? { ...sec, weight: Math.max(0, Number(e.target.value)) }
                                      : sec,
                                  ),
                                })
                              }
                            />
                          </div>
                          <span style={{ fontSize: 11, color: color.textSecondary }}>%</span>
                        </label>
                        <SectionBudgetChip budget={budgetFor(section.id)} />
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                          <Button
                            variant="tertiary" size="small"
                            aria-label={`Add a question to ${name}`}
                            onClick={() => {
                              setCollapsedSections(collapsedSections.filter((id) => id !== group.key));
                              write(addDraftQuestion(current, section.id));
                            }}
                          >
                            ＋ Question
                          </Button>
                          <Button
                            variant="icon"
                            size="small"
                            aria-label={`Remove section ${section.name}`}
                            title={`Remove "${section.name}" and the questions in it`}
                            onClick={() => write(removeDraftSection(current, section.id))}
                          >
                            🗑
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                  {open && (
                    <div style={{ borderTop: `1px solid ${color.border}` }}>
                      <Table
                        columns={questionColumns(group.questions, name)}
                        rows={group.questions}
                        rowKey={(q) => q.id}
                        rowStyle={(q) => (issuesByQuestion.has(q.id)
                          ? { background: color.warningSoft }
                          : openId === q.id ? { background: color.brandPrimarySoft } : undefined)}
                        isExpanded={(q) => openId === q.id}
                        renderExpanded={(q) => renderEditor(q)}
                        empty={
                          <div style={{ padding: '14px', fontSize: 12, color: color.textMuted }}>
                            No questions in this section yet.
                          </div>
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 10, flexWrap: 'wrap', padding: '9px 12px',
                borderTop: `1px solid ${color.border}`,
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    // A question landing outside every section sits outside
                    // every budget and scores nowhere, so a grain with no
                    // section gets one as part of adding the question.
                    const host = sectionsHere[0];
                    if (host) {
                      write(addDraftQuestion(current, host.id));
                      return;
                    }
                    const seeded2 = addDraftSection(current, card.title, card.scope);
                    write(addDraftQuestion(
                      seeded2, seeded2.sections[seeded2.sections.length - 1].id,
                    ));
                  }}
                >
                  ＋ {card.addLabel}
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => write(addDraftSection(current, 'New section', card.scope))}
                >
                  ＋ Section
                </Button>
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  color: budget.declared === 0 ? color.textMuted
                    : budget.allocated === budget.declared ? color.successText
                    : budget.allocated > budget.declared ? color.dangerText
                    : color.warningText,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {budget.declared === 0
                  ? 'Nothing here is weighted'
                  : `${card.scope === 'VENDOR' ? 'Supplier-level' : 'Line-level'} weight: `
                    + `${budget.allocated} of ${budget.declared}%`
                    + (budget.allocated === budget.declared ? ' ✓' : '')}
              </span>
            </div>
          </Card>
        );
      })}

      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap', borderTop: `1px solid ${color.border}`, paddingTop: 11,
        }}
      >
        <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6, maxWidth: 680 }}>
          Technical weight totals {supplierBudget.allocated + lineBudget.allocated} of{' '}
          {supplierBudget.declared + lineBudget.declared}% ({supplierBudget.declared}% supplier-level,{' '}
          {lineBudget.declared}% line-level). Knockouts are pass / fail and carry no weight. Scores
          are reported out of {current.scoreScale}.
        </div>
        <Button variant="tertiary" size="small" onClick={() => setView('preview')}>
          Preview as a supplier →
        </Button>
      </div>

      {(ENVELOPE_STAGES as string[]).includes(point) && (
        <EnvelopePicker
          stage={point as 'RFI' | 'RFP' | 'RFQ'}
          draft={draft}
          patch={patch}
          weightedTechnical={(current?.questions ?? []).some((q) => q.envelope === 'TECHNICAL' && (q.weight ?? 0) > 0)}
          asksPrice={(current?.questions ?? []).some((q) => q.envelope === 'COMMERCIAL')}
        />
      )}

      {/*
        The same upload the Questionnaire Library offers, against the event's
        own copy. A buyer who has the question set in a spreadsheet should not
        have to go to the Configuration Studio, make a library template and
        come back — and the sheet is read by the same importer either way, so
        there is one set of rules about what a column means.
      */}
      <QuestionnaireDesignerDrawer
        open={agentOpen}
        sight={{
          point,
          category,
          categories: spans.filter((c): c is string => c !== null),
          lines: rosterLines.map((line) => ({
            id: line.id, description: line.description, specification: line.specification,
            quantity: line.quantity, uom: line.uom, category: line.category || draft.category,
          })),
          suppliers: roster.vendorIds
            .map((id) => COUNTERPARTIES.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => c !== undefined),
        }}
        template={draftAsTemplate(pruned)}
        library={library}
        onClose={() => setAgentOpen(false)}
        onApply={(next) => {
          setOpenId(null);
          setSelectedIds([]);
          write(draftFromTemplate(pruned, next));
        }}
      />

      <QuestionnaireImportDrawer
        open={importOpen}
        template={draftAsTemplate(pruned)}
        onClose={() => setImportOpen(false)}
        onApply={(next) => {
          setOpenId(null);
          setSelectedIds([]);
          write(draftFromTemplate(pruned, next));
        }}
      />

      {savingToLibrary && (
        <SaveToLibrary
          initialName={current.templateName}
          points={points}
          point={point}
          category={category}
          authoredNames={{
            TENANT: authoredAt('TENANT', SCOPE_LINEAGE.tenantId).map((t) => t.name),
            CATEGORY: category === null
              ? []
              : authoredAt('CATEGORY', category).map((t) => t.name),
          }}
          blocked={
            current.questions.length === 0
              ? 'There is nothing to save yet — this questionnaire has no questions.'
              : !validation.valid
                ? `Fix the questionnaire first: ${validation.errors[0].message}`
                : null
          }
          onClose={() => setSavingToLibrary(false)}
          onSave={saveToLibrary}
        />
      )}

      {picking !== null && (() => {
        const asked = picking.questionIds
          .map((id) => current.questions.find((q) => q.id === id) ?? null)
          .filter((q): q is TemplateQuestion => q !== null);
        if (asked.length === 0) return null;
        // What they already share, or null where they differ. A picker opened
        // on four questions with four different narrowings must not show one
        // of them as if it were all of them — pressing Apply would then make
        // three changes the buyer never asked for.
        const shared = commonAudience(pruned, asked.map((q) => q.id));
        const nameOf = (q: TemplateQuestion) =>
          (q.title.trim() === '' ? q.code : q.title.trim());
        const named = asked.length === 1
          ? `"${nameOf(asked[0])}"`
          : `these ${asked.length} questions`;
        const mixedNote = shared === null
          ? `These ${asked.length} questions are not all asked of the same people today.`
            + ' Whatever you choose here is applied to all of them.'
          : undefined;
        const apply = (next: Partial<QuestionAudience>) =>
          write(setAudienceOnAll(pruned, asked.map((q) => q.id), next, roster));

        if (picking.kind === 'VENDOR') {
          const people = roster.vendorIds
            .map((id) => COUNTERPARTIES.find((c) => c.id === id) ?? null)
            .filter((c): c is Counterparty => c !== null);
          const provisional = people.filter((c) => c.isProvisional).map((c) => c.id);
          const categoriesHere = Array.from(
            new Set(people.flatMap((c) => c.categoriesServed)),
          ).filter((c) => spans.includes(c) || spans[0] === null);
          return (
            <AudiencePicker
              title={`Which suppliers are asked ${named}?`}
              noun="supplier"
              mixedNote={mixedNote}
              everyoneLabel="Everyone invited"
              everyoneHint={
                `All ${roster.vendorIds.length} suppliers invited to this ask answer this`
                + ' question — including any you invite later. That is a rule, not a list, so it'
                + ' keeps being true as the shortlist changes.'
              }
              rows={people.map((c) => ({
                id: c.id,
                title: c.name,
                subtitle: `${c.code} · onboarding ${c.onboardingRating}`
                  + ` · performance ${c.performanceRating || '—'}`
                  + ` · ${c.categoriesServed.join(', ')}`,
                chips: c.isProvisional
                  ? [{ label: 'provisional', tone: 'gold' as const }]
                  : [],
              }))}
              groups={[
                ...(provisional.length > 0 && provisional.length < people.length
                  ? [
                    { label: 'Provisional only', ids: provisional },
                    {
                      label: 'Approved only',
                      ids: people.filter((c) => !c.isProvisional).map((c) => c.id),
                    },
                  ]
                  : []),
                ...categoriesHere.length > 1 ? categoriesHere.map((c) => ({
                  label: c,
                  ids: people.filter((p) => p.categoriesServed.includes(c)).map((p) => p.id),
                })) : [],
              ]}
              selected={shared === null ? [] : shared.vendorIds}
              onClose={() => setPicking(null)}
              onApply={(vendorIds) => apply({ vendorIds })}
            />
          );
        }

        return (
          <AudiencePicker
            title={`Which lines ${asked.length === 1 ? 'is' : 'are'} ${named} asked about?`}
            noun="line"
            mixedNote={mixedNote}
            everyoneLabel="Every line"
            everyoneHint={
              `Asked about all ${roster.lineIds.length} lines in this ask — including any line`
              + ' added later. Each supplier answers it once per line.'
            }
            rows={rosterLines.map((line) => ({
              id: line.id,
              title: `${line.itemCode} · ${line.description}`,
              subtitle: `${line.quantity.toLocaleString()} ${line.uom}`
                + ` · ${line.lotName}`
                + (line.deliveryLocation ? ` · ${line.deliveryLocation}` : ''),
              chips: [],
            }))}
            groups={Array.from(new Set(rosterLines.map((l) => l.lotName))).length > 1
              ? Array.from(new Set(rosterLines.map((l) => l.lotName))).map((lot) => ({
                label: lot,
                ids: rosterLines.filter((l) => l.lotName === lot).map((l) => l.id),
              }))
              : []}
            selected={shared === null ? [] : shared.lineIds}
            onClose={() => setPicking(null)}
            onApply={(lineIds) => apply({ lineIds })}
          />
        );
      })()}
      </>
      )}
    </div>
  );
}

/**
 * The Terms step.
 *
 * An event does not go out with one set of terms. It goes out with several —
 * general conditions everywhere, payment terms where a price is asked, and
 * whatever else the category needs — and they do not all apply at the same
 * point in the journey. So this is a table of term sets against the stages of
 * the pattern, each row opening in place to edit its clauses.
 *
 * A set starts from the library and is then owned by this event: editing the
 * payment terms here never reaches back into the library.
 */
export function TermsStep({
  draft, patch, points, patternName, questionnaireStep, onOpenQuestionnaire,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  /** The points this journey asks the supplier at. */
  points: VendorInputPoint[];
  patternName?: string;
  /** The questionnaire's step number, for the note that terms carry no score. */
  questionnaireStep?: number;
  onOpenQuestionnaire?: () => void;
}) {
  const [openId, setOpenId] = React.useState<string | null>(draft.terms[0]?.id ?? null);
  const [adding, setAdding] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [comparing, setComparing] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [removed, setRemoved] = React.useState<RemovedTerms | null>(null);
  const issues = validateTerms(draft.terms, points);

  // Removing a set or a clause can be undone for thirty seconds, then it is gone.
  React.useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 30_000);
    return () => clearTimeout(timer);
  }, [removed]);

  const setDocument = (id: string, next: Partial<TermsDocumentInput>) =>
    patch({ terms: draft.terms.map((d) => (d.id === id ? { ...d, ...next } : d)) });

  const add = (document: TermsDocumentInput) => {
    patch({ terms: [...draft.terms, document] });
    setOpenId(document.id);
    setAdding(false);
  };

  const addTemplate = (template: TermsTemplate) => add(instantiateTerms(
    template,
    `draft-${Date.now()}`,
    // Only the points this journey actually runs.
    template.defaultAppliesTo.filter((p) => points.includes(p)),
  ));

  const remove = (document: TermsDocumentInput) => {
    setRemoved({ kind: 'set', document, index: draft.terms.indexOf(document) });
    patch({ terms: draft.terms.filter((d) => d.id !== document.id) });
    if (openId === document.id) setOpenId(null);
  };

  const removeClause = (document: TermsDocumentInput, clause: TermsClause) => {
    setRemoved({ kind: 'clause', documentId: document.id, clause, index: document.clauses.indexOf(clause) });
    setDocument(document.id, { clauses: document.clauses.filter((c) => c.id !== clause.id) });
  };

  const undo = () => {
    if (!removed) return;
    if (removed.kind === 'set') {
      const terms = [...draft.terms];
      terms.splice(removed.index, 0, removed.document);
      patch({ terms });
    } else {
      const document = draft.terms.find((d) => d.id === removed.documentId);
      if (document) {
        const clauses = [...document.clauses];
        clauses.splice(removed.index, 0, removed.clause);
        setDocument(document.id, { clauses });
      }
    }
    setRemoved(null);
  };

  /** Bring a set up to the library's current version, keeping where it applies and its files. */
  const updateFromLibrary = (document: TermsDocumentInput) => {
    const template = libraryTemplate(document);
    if (!template) return;
    const fresh = instantiateTerms(template, `draft-${Date.now()}`, document.appliesTo);
    setDocument(document.id, {
      ...fresh,
      id: document.id,
      attachmentName: document.attachmentName,
      internalAttachmentName: document.internalAttachmentName ?? null,
    });
    setComparing(null);
  };

  /** Templates not already on the event, so the library does not offer duplicates. */
  const used = new Set(draft.terms.map((d) => d.templateId).filter(Boolean));
  const available = TERMS_TEMPLATES.filter((template) => !used.has(template.id));
  const suggestion = available.find((template) =>
    template.suggestedBecause && !dismissed.includes(template.id)
    && template.defaultAppliesTo.some((p) => points.includes(p)));

  const clauseCount = draft.terms.reduce((sum, d) => sum + d.clauses.length, 0);
  const publicFiles = draft.terms.flatMap((d) => (d.attachmentName ? [d.attachmentName] : []));
  const internalFiles = draft.terms.flatMap((d) => (d.internalAttachmentName ? [d.internalAttachmentName] : []));
  const summary = [
    plural(draft.terms.length, 'term set'),
    plural(clauseCount, 'clause'),
    `${plural(publicFiles.length, 'document')} ${publicFiles.length === 1 ? 'goes' : 'go'} out with the invitation`,
    ...(internalFiles.length > 0
      ? [`${internalFiles.length} ${internalFiles.length === 1 ? 'stays' : 'stay'} internal`]
      : []),
  ].join(' · ');

  const comparingDocument = draft.terms.find((d) => d.id === comparing) ?? null;

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
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

      <Card
        title="Terms & conditions"
        hint={summary}
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="small" variant="secondary" onClick={() => setAdding(true)}>
              <Icon name="book" /> Add from library
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => add(blankTerms('SPECIAL', `draft-${Date.now()}`, points.slice(0, 1)))}
            >
              <Icon name="pencil" /> Write my own
            </Button>
            <Button size="small" variant="secondary" onClick={() => setPreviewing(true)}>
              <Icon name="eye" /> Preview as a supplier
            </Button>
          </div>
        }
      >
        <div className="rfx-stack" style={{ gap: 14 }}>
          <HowTermsCount
            terms={draft.terms}
            questionnaireStep={questionnaireStep}
            onOpenQuestionnaire={onOpenQuestionnaire}
          />

          <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
                padding: '11px 14px', background: color.surfacePage, borderBottom: `1px solid ${color.border}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>Term sets by stage</span>
              <span style={{ fontSize: 12, color: color.textSecondary }}>
                Tick where each set applies.{patternName ? ` Stages of the ${patternName} pattern.` : ''} Open a
                set to edit its clauses.
              </span>
            </div>
            <div className="rfx-scroll-x">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...headCell, width: 36 }} />
                    <th style={headCell}>Term set</th>
                    <th style={headCell}>Supplier must</th>
                    {points.map((point) => (
                      <th key={point} style={{ ...headCell, textAlign: 'center' }}>{pointLabel(point)}</th>
                    ))}
                    <th style={headCell}>Clauses</th>
                    <th style={headCell}>Documents</th>
                    <th style={{ ...headCell, width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {draft.terms.map((document) => {
                    const open = openId === document.id;
                    const template = libraryTemplate(document);
                    const outdated = template !== null && template.version !== document.version;
                    const everywhere = points.every((p) => document.appliesTo.includes(p));
                    return (
                      <React.Fragment key={document.id}>
                        <tr
                          style={{
                            borderTop: `1px solid ${color.border}`,
                            background: open ? color.brandPrimarySoft : undefined,
                          }}
                        >
                          <td style={{ padding: '10px 4px 10px 12px', verticalAlign: 'top' }}>
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${open ? 'Close' : 'Open'} ${document.title}`}
                              onClick={() => setOpenId(open ? null : document.id)}
                              className="rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              style={{ border: 'none', background: 'none', padding: 2, cursor: 'pointer', color: color.textSecondary }}
                            >
                              <Icon name={open ? 'chevDown' : 'chevRight'} size={15} />
                            </button>
                          </td>
                          <td style={{ padding: '10px 11px', minWidth: 240 }}>
                            {renaming === document.id ? (
                              <TextInput
                                autoFocus
                                aria-label="Term set name"
                                value={document.title}
                                onChange={(e) => setDocument(document.id, { title: e.target.value })}
                                onBlur={() => setRenaming(null)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null); }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setOpenId(open ? null : document.id)}
                                style={{
                                  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                                  textAlign: 'left', font: 'inherit', color: color.textPrimary, fontWeight: 600,
                                }}
                              >
                                {document.title}
                              </button>
                            )}
                            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                              v{document.version} ·{' '}
                              {template === null ? 'written for this event' : outdated ? (
                                <span style={{ color: color.warningText }}>
                                  library has v{template.version} ·{' '}
                                  <LinkButton onClick={() => setComparing(document.id)}>see what changed</LinkButton>
                                </span>
                              ) : 'latest'}
                              {everywhere && points.length > 1
                                ? ' · attached to every stage'
                                : document.summary ? ` · ${document.summary}` : ''}
                            </div>
                          </td>
                          <td style={{ padding: '10px 11px' }}>
                            <AcknowledgementBadge acknowledgement={document.acknowledgement} />
                          </td>
                          {points.map((point) => {
                            const on = document.appliesTo.includes(point);
                            return (
                              <td key={point} style={{ padding: '10px 11px', textAlign: 'center' }}>
                                <TickBox
                                  checked={on}
                                  label={`${document.title} at ${pointLabel(point)}`}
                                  onChange={() => setDocument(document.id, {
                                    appliesTo: on
                                      ? document.appliesTo.filter((p) => p !== point)
                                      : [...document.appliesTo, point],
                                  })}
                                />
                              </td>
                            );
                          })}
                          <td style={{ padding: '10px 11px', whiteSpace: 'nowrap' }}>{clausesLabel(document)}</td>
                          <td style={{ padding: '10px 11px', whiteSpace: 'nowrap' }}>{documentsLabel(document)}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                            <RowMenu
                              label={`More for ${document.title}`}
                              items={[
                                { label: open ? 'Close' : 'Open to edit', onSelect: () => setOpenId(open ? null : document.id) },
                                { label: 'Rename', onSelect: () => setRenaming(document.id) },
                                ...(outdated
                                  ? [{ label: `Update to library v${template!.version}`, onSelect: () => setComparing(document.id) }]
                                  : []),
                                { label: 'Remove from this event', danger: true, onSelect: () => remove(document) },
                              ]}
                            />
                          </td>
                        </tr>
                        {open && (
                          <tr style={{ background: color.surface }}>
                            <td colSpan={points.length + 6} style={{ padding: '14px 14px 16px 46px' }}>
                              <TermSetEditor
                                document={document}
                                issues={issues.filter((issue) => issue.documentId === document.id)}
                                onChange={(next) => setDocument(document.id, next)}
                                onRemoveClause={(clause) => removeClause(document, clause)}
                                removedClause={removed?.kind === 'clause' && removed.documentId === document.id
                                  ? removed.clause : null}
                                onUndo={undo}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {draft.terms.length === 0 && (
                    <tr>
                      <td
                        colSpan={points.length + 6}
                        style={{ padding: '16px 14px', color: color.textSecondary, borderTop: `1px solid ${color.border}` }}
                      >
                        No terms attached yet. Add the general conditions first — every stage needs them.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {removed?.kind === 'set' && (
              <UndoBar label={`Removed "${removed.document.title}"`} onUndo={undo} />
            )}

            {suggestion && (
              <div style={{ padding: 12, borderTop: `1px solid ${color.border}` }}>
                <div
                  style={{
                    display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                    border: `1px solid ${color.border}`, borderRadius: radius.control,
                    padding: '10px 12px', background: color.surfacePage,
                  }}
                >
                  <span
                    style={{
                      width: 26, height: 26, borderRadius: radius.control, display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: color.brandPrimarySoft, color: color.brandPrimary,
                    }}
                  >
                    <Icon name="sparkle" size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 13 }}>
                      <strong>Suggested: {suggestion.title}</strong>
                      <span style={{ color: color.textSecondary }}>
                        {' '}· library v{suggestion.version} · {ACKNOWLEDGEMENT_SHORT[suggestion.acknowledgement]} ·{' '}
                        {suggestion.defaultAppliesTo.filter((p) => points.includes(p)).map(pointLabel).join(', ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
                      {suggestion.suggestedBecause}
                    </div>
                  </div>
                  <Button size="small" variant="primary" onClick={() => addTemplate(suggestion)}>
                    Add from library
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setDismissed([...dismissed, suggestion.id])}
                  >
                    Not for this event
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', fontSize: 12, color: color.textSecondary,
            }}
          >
            <span>
              Suppliers see each set at the stages ticked above. Must-accept sets block submission until
              accepted; removing a set or a clause can be undone for 30 seconds.
            </span>
            <LinkButton onClick={() => setPreviewing(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="eye" /> Preview as a supplier →
              </span>
            </LinkButton>
          </div>
        </div>
      </Card>

      <Drawer
        open={adding}
        title="Terms library"
        subtitle="Added as a copy. Editing it here never changes the library."
        onClose={() => setAdding(false)}
      >
        {available.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textSecondary }}>
            Every library set is already on this event.
          </div>
        ) : (
          <div className="rfx-stack" style={{ gap: 8 }}>
            {available.map((template) => (
              <div
                key={template.id}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {template.title} <Chip tone="neutral">v{template.version}</Chip>
                  </div>
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>
                    {TERMS_CATEGORY_PURPOSE[template.category]}
                  </div>
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>
                    {ACKNOWLEDGEMENT_SHORT[template.acknowledgement]} · normally at{' '}
                    {template.defaultAppliesTo.map((p) => pointLabel(p)).join(', ')} ·{' '}
                    {plural(template.clauses.length, 'clause')}
                    {template.payment && ` · ${paymentSummary(template.payment)}`}
                  </div>
                </div>
                <Button size="small" variant="secondary" onClick={() => addTemplate(template)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <SupplierTermsPreview
        open={previewing}
        terms={draft.terms}
        points={points}
        onClose={() => setPreviewing(false)}
      />

      {comparingDocument && (
        <LibraryChanges
          document={comparingDocument}
          onClose={() => setComparing(null)}
          onUpdate={() => updateFromLibrary(comparingDocument)}
        />
      )}
    </div>
  );
}

type RemovedTerms =
  | { kind: 'set'; document: TermsDocumentInput; index: number }
  | { kind: 'clause'; documentId: string; clause: TermsClause; index: number };

const headCell: React.CSSProperties = {
  textAlign: 'left', padding: '9px 11px', fontSize: 12, fontWeight: 500, color: color.textSecondary,
  borderBottom: `1px solid ${color.border}`, whiteSpace: 'nowrap',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The library template a set came from, when the library still has it. */
function libraryTemplate(document: TermsDocumentInput): TermsTemplate | null {
  return TERMS_TEMPLATES.find((t) => t.id === document.templateId) ?? null;
}

/** Only "accept or deviate" lets a clause be negotiable; every other answer locks the lot. */
function isLocked(document: TermsDocumentInput, clause: TermsClause): boolean {
  return document.acknowledgement !== 'ACCEPT_OR_DEVIATE' || clause.nonNegotiable;
}

function clausesLabel(document: TermsDocumentInput): string {
  const total = document.clauses.length;
  if (total === 0) return 'none';
  const locked = document.clauses.filter((c) => isLocked(document, c)).length;
  return `${total} · ${locked === total ? 'all' : locked} locked`;
}

function documentsLabel(document: TermsDocumentInput): string {
  const parts = [
    ...(document.attachmentName ? ['1 public'] : []),
    ...(document.internalAttachmentName ? ['1 internal'] : []),
  ];
  return parts.length === 0 ? 'none' : parts.join(' · ');
}

/** A set's name without its qualifier: "Payment terms", not "Payment terms — Net 30…". */
function shortTitle(title: string): string {
  return title.split(' — ')[0];
}

const ACKNOWLEDGEMENT_ICON: Record<Acknowledgement, AdminIconName> = {
  NONE: 'eye', ACCEPT: 'lock', ACCEPT_OR_DEVIATE: 'expand', SIGN_AND_RETURN: 'pencil',
};

function AcknowledgementBadge({ acknowledgement }: { acknowledgement: Acknowledgement }) {
  const deviate = acknowledgement === 'ACCEPT_OR_DEVIATE';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
        padding: '3px 8px', borderRadius: radius.control, fontSize: 12, fontWeight: 600,
        background: deviate ? color.brandPrimaryTint : color.rowAlt,
        color: deviate ? color.brandPrimaryStrong : color.textBody,
      }}
    >
      <Icon name={ACKNOWLEDGEMENT_ICON[acknowledgement]} size={12} />
      {ACKNOWLEDGEMENT_SHORT[acknowledgement]}
    </span>
  );
}

/**
 * What the buyer's choices on this step amount to, read back as three counts.
 * Terms gate a submission; they do not score it — that is the questionnaire's.
 */
function HowTermsCount({ terms, questionnaireStep, onOpenQuestionnaire }: {
  terms: TermsDocumentInput[];
  questionnaireStep?: number;
  onOpenQuestionnaire?: () => void;
}) {
  const mustAccept = terms.filter((d) => d.acknowledgement === 'ACCEPT' || d.acknowledgement === 'SIGN_AND_RETURN');
  const deviating = terms.filter((d) => d.acknowledgement === 'ACCEPT_OR_DEVIATE');
  const publicFiles = terms.flatMap((d) => (d.attachmentName ? [d.attachmentName] : []));
  const internalFiles = terms.flatMap((d) => (d.internalAttachmentName ? [d.internalAttachmentName] : []));
  const names = (list: TermsDocumentInput[]) => list.map((d) => shortTitle(d.title)).join(', ');
  const step = questionnaireStep ? ` (step ${questionnaireStep})` : '';

  const boxes: { icon: AdminIconName; title: string; text: string }[] = [
    {
      icon: 'lock',
      title: `Must accept · ${plural(mustAccept.length, 'set')}`,
      text: mustAccept.length > 0
        ? `${names(mustAccept)}. A supplier can't submit without accepting them.`
        : 'None. Every set can be deviated from, or is read only.',
    },
    {
      icon: 'expand',
      title: `Deviations allowed · ${plural(deviating.length, 'set')}`,
      text: deviating.length > 0
        ? `${names(deviating)}. Each proposed deviation is listed on the comparison sheet and the NFA (note for approval); you accept or reject it at evaluation.`
        : 'None. Suppliers take every set as written.',
    },
    {
      icon: 'doc',
      title: `Go out with the invitation · ${plural(publicFiles.length, 'document')}`,
      text: [
        publicFiles.length > 0
          ? `${publicFiles.join(', ')}.`
          : 'None yet. Attach a file to a set to send it with the invitation.',
        ...(internalFiles.length > 0
          ? [`${internalFiles.join(', ')} ${internalFiles.length === 1 ? 'stays' : 'stay'} internal.`]
          : []),
      ].join(' '),
    },
  ];

  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>How terms count</span>
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          The technical score comes only from the questionnaire{step}. Terms don't add a second score.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 10 }}>
        {boxes.map((box) => (
          <div
            key={box.icon}
            style={{
              display: 'flex', gap: 10, border: `1px solid ${color.border}`,
              borderRadius: radius.control, padding: '10px 12px',
            }}
          >
            <span style={{ color: color.textSecondary, paddingTop: 2 }}><Icon name={box.icon} size={14} /></span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{box.title}</div>
              <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2, lineHeight: 1.5 }}>{box.text}</div>
            </div>
          </div>
        ))}
      </div>
      {onOpenQuestionnaire && (
        <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 10 }}>
          Want acceptance of terms to count toward the score? Add a scored question in the questionnaire
          instead —{' '}
          <LinkButton onClick={onOpenQuestionnaire}>open step {questionnaireStep ?? 'Questionnaire'}</LinkButton>.
        </div>
      )}
    </div>
  );
}

const SUPPLIER_MUST: { value: Acknowledgement; label: string; hint: string }[] = [
  { value: 'ACCEPT', label: 'Accept to submit', hint: 'every clause locked; no deviations possible' },
  {
    value: 'ACCEPT_OR_DEVIATE', label: 'Accept, or propose a deviation clause by clause',
    hint: 'you choose which clauses stay locked',
  },
  { value: 'SIGN_AND_RETURN', label: 'Sign and return the document', hint: 'for codes of conduct and declarations' },
];

/** One set, opened in its row for editing. */
function TermSetEditor({
  document, issues, onChange, onRemoveClause, removedClause, onUndo,
}: {
  document: TermsDocumentInput;
  issues: { field: string; message: string; blocking: boolean }[];
  onChange: (next: Partial<TermsDocumentInput>) => void;
  onRemoveClause: (clause: TermsClause) => void;
  removedClause: TermsClause | null;
  onUndo: () => void;
}) {
  const errorFor = (field: string) =>
    issues.find((issue) => issue.field === field && issue.blocking)?.message;

  const setClause = (id: string, next: Partial<TermsClause>) =>
    onChange({ clauses: document.clauses.map((c) => (c.id === id ? { ...c, ...next } : c)) });

  const moveClause = (index: number, by: number) => {
    const clauses = [...document.clauses];
    const [clause] = clauses.splice(index, 1);
    clauses.splice(index + by, 0, clause);
    onChange({ clauses });
  };

  const deviate = document.acknowledgement === 'ACCEPT_OR_DEVIATE';
  const derived = document.clauses.find((c) => c.fromPaymentFields);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {document.templateId === null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
          <Field label="Name">
            <TextInput value={document.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Kind of terms" hint={TERMS_CATEGORY_PURPOSE[document.category]}>
            <Select
              value={document.category}
              onChange={(e) => {
                const category = e.target.value as TermsCategory;
                onChange({
                  category,
                  // Payment figures exist on a payment set and nowhere else.
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
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16 }}>
        <div role="radiogroup" aria-label="Supplier must">
          <div style={{ fontSize: 12.5, fontWeight: 600, color: color.textBody, marginBottom: 8 }}>Supplier must</div>
          <div className="rfx-stack" style={{ gap: 8 }}>
            {SUPPLIER_MUST.map((option) => (
              <label
                key={option.value}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name={`supplier-must-${document.id}`}
                  checked={document.acknowledgement === option.value}
                  onChange={() => onChange({
                    acknowledgement: option.value,
                    allowDeviation: option.value === 'ACCEPT_OR_DEVIATE',
                  })}
                  className="accent-primary"
                  style={{ marginTop: 3 }}
                />
                <span>
                  {option.label}
                  <span style={{ color: color.textSecondary }}> — {option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errorFor('acknowledgement') && (
            <div style={{ fontSize: 12, color: color.dangerText, marginTop: 6 }}>{errorFor('acknowledgement')}</div>
          )}
        </div>

        {document.payment && (
          <PaymentFields
            payment={document.payment}
            derivedCode={derived?.code}
            error={issues.find((i) => i.field.startsWith('payment') && i.blocking)?.message}
            onChange={(next) => {
              const payment = { ...document.payment!, ...next };
              onChange({ payment, clauses: syncPaymentClauses(document.clauses, payment) });
            }}
          />
        )}
      </div>

      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', color: color.textSecondary }}>
            CLAUSES · {document.clauses.length}
          </span>
          <span style={{ fontSize: 12, color: color.textSecondary }}>
            {deviate
              ? "Locked clauses can't be deviated from even though this set allows deviations."
              : 'Every clause is locked: suppliers take this set as written.'}
          </span>
        </div>
        {errorFor('clauses') && (
          <div style={{ fontSize: 12, color: color.dangerText, marginTop: 6 }}>{errorFor('clauses')}</div>
        )}

        <div className="rfx-stack" style={{ gap: 10, marginTop: 10 }}>
          {document.clauses.map((clause, index) => (
            <div
              key={clause.id}
              style={{
                display: 'grid', gridTemplateColumns: '56px 1fr', gap: '8px 4px',
                border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
              }}
            >
              <input
                value={clause.code}
                onChange={(e) => setClause(clause.id, { code: e.target.value })}
                aria-label="Clause reference"
                style={{
                  width: 48, border: 'none', background: 'none', padding: '7px 0', fontSize: 12.5,
                  color: color.textSecondary, fontFamily: font.mono,
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextInput
                  value={clause.title}
                  onChange={(e) => setClause(clause.id, { title: e.target.value })}
                  aria-label="Clause title"
                  style={{ flex: 1, minWidth: 180, fontWeight: 600 }}
                />
                {clause.fromPaymentFields && <Chip tone="success">Written from the fields above</Chip>}
                <Segmented<'negotiable' | 'locked'>
                  size="small"
                  value={isLocked(document, clause) ? 'locked' : 'negotiable'}
                  onChange={(next) => setClause(clause.id, { nonNegotiable: next === 'locked' })}
                  options={[
                    {
                      value: 'negotiable', label: 'Negotiable', disabled: !deviate,
                      title: deviate ? undefined : 'Only a set suppliers may deviate from has negotiable clauses',
                    },
                    { value: 'locked', label: '🔒 Locked' },
                  ]}
                />
                <RowMenu
                  label={`More for clause ${clause.code}`}
                  items={[
                    ...(index > 0 ? [{ label: 'Move up', onSelect: () => moveClause(index, -1) }] : []),
                    ...(index < document.clauses.length - 1
                      ? [{ label: 'Move down', onSelect: () => moveClause(index, 1) }]
                      : []),
                    ...(clause.fromPaymentFields
                      ? [{ label: 'Write it myself instead', onSelect: () => setClause(clause.id, { fromPaymentFields: false }) }]
                      : document.payment
                        ? [{
                          label: 'Write it from the payment fields',
                          onSelect: () => setClause(clause.id, {
                            fromPaymentFields: true, text: paymentClauseText(document.payment!),
                          }),
                        }]
                        : []),
                    { label: 'Remove clause', danger: true, onSelect: () => onRemoveClause(clause) },
                  ]}
                />
              </div>
              <div />
              {clause.fromPaymentFields ? (
                <div
                  style={{
                    fontSize: 13, padding: '8px 11px', borderRadius: radius.control,
                    background: color.rowAlt, color: color.textBody, lineHeight: 1.5,
                  }}
                >
                  {clause.text}
                </div>
              ) : (
                <Textarea
                  rows={2}
                  value={clause.text}
                  aria-label={`Clause ${clause.code} text`}
                  onChange={(e) => setClause(clause.id, { text: e.target.value })}
                  placeholder="The clause, in the words a supplier will be held to."
                />
              )}
            </div>
          ))}
          {document.clauses.length === 0 && (
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>
              No clauses yet. Add one, or attach the document a supplier is sent instead.
            </div>
          )}
          {removedClause && (
            <UndoBar label={`Removed clause ${removedClause.code} "${removedClause.title}"`} onUndo={onUndo} boxed />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
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
          <Icon name="plus" /> Add a clause
        </Button>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: color.textSecondary }}>
          <span>
            Documents: goes out with the invitation —{' '}
            <AttachFile
              name={document.attachmentName}
              label={`Attach a document that goes out with ${document.title}`}
              onChange={(attachmentName) => onChange({ attachmentName })}
            />
          </span>
          <span>
            Internal only —{' '}
            <AttachFile
              name={document.internalAttachmentName ?? null}
              label={`Attach an internal document to ${document.title}`}
              onChange={(internalAttachmentName) => onChange({ internalAttachmentName })}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

/** "none · Attach", or the file's name and a way to take it off. */
function AttachFile({ name, label, onChange }: {
  name: string | null; label: string; onChange: (name: string | null) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file.name);
          e.target.value = '';
        }}
      />
      {name ? (
        <>
          <span style={{ color: color.textBody }}>📎 {name}</span> ·{' '}
          <LinkButton onClick={() => onChange(null)} label={`Remove ${name}`}>Remove</LinkButton>
        </>
      ) : (
        <>none · <LinkButton onClick={() => input.current?.click()} label={label}>Attach</LinkButton></>
      )}
    </>
  );
}

function UndoBar({ label, onUndo, boxed }: { label: string; onUndo: () => void; boxed?: boolean }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
        padding: '9px 12px', fontSize: 12.5, color: color.textBody, background: color.rowAlt,
        ...(boxed
          ? { border: `1px solid ${color.border}`, borderRadius: radius.control }
          : { borderTop: `1px solid ${color.border}` }),
      }}
    >
      <span>{label}</span>
      <LinkButton onClick={onUndo}>Undo</LinkButton>
    </div>
  );
}

/** The structured half of a payment set — the part that gets compared. */
function PaymentFields({
  payment, derivedCode, error, onChange,
}: {
  payment: PaymentTerms;
  /** The clause written from these fields, if there is one. */
  derivedCode?: string;
  error?: string;
  onChange: (next: Partial<PaymentTerms>) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${error ? color.danger : '#BBF7D0'}`, borderRadius: radius.control,
        padding: '11px 13px', background: color.successSoft,
      }}
    >
      <div style={{ fontSize: 12.5, marginBottom: 8 }}>
        <strong>Payment, as fields</strong>
        <span style={{ color: color.textSecondary }}>
          {' '}The comparison sheet puts these side by side
          {derivedCode ? `; clause ${derivedCode} is written from them.` : '.'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(110px, 100%), 1fr))', gap: 10 }}>
        <Field label="Credit days">
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
        <Field label="Advance %">
          <NumberInput
            value={payment.advancePct}
            onChange={(e) => onChange({ advancePct: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Retention %">
          <NumberInput
            value={payment.retentionPct}
            onChange={(e) => onChange({ retentionPct: Number(e.target.value) || 0 })}
          />
        </Field>
        {/* A release date only means something once something is held back. */}
        {payment.retentionPct > 0 && (
          <Field label="Released after (days)">
            <NumberInput
              value={payment.retentionReleaseDays}
              onChange={(e) => onChange({ retentionReleaseDays: Number(e.target.value) || 0 })}
            />
          </Field>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: color.dangerText, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/** What a supplier is shown at each stage, internal files left out. */
function SupplierTermsPreview({ open, terms, points, onClose }: {
  open: boolean;
  terms: TermsDocumentInput[];
  points: VendorInputPoint[];
  onClose: () => void;
}) {
  const [point, setPoint] = React.useState<VendorInputPoint>(points[0] ?? 'RFQ');
  const shown = termsForPoint(terms, points.includes(point) ? point : points[0]);
  return (
    <Modal open={open} title="Preview as a supplier" onClose={onClose} width={720}>
      <div className="rfx-stack" style={{ gap: 12 }}>
        <Segmented<VendorInputPoint>
          size="small"
          value={point}
          onChange={setPoint}
          options={points.map((p) => ({ value: p, label: pointLabel(p) }))}
        />
        {shown.length === 0 && (
          <div style={{ color: color.textSecondary }}>No terms are attached at {pointLabel(point)}.</div>
        )}
        {shown.map((document) => (
          <div
            key={document.id}
            style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '11px 13px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <strong>{document.title}</strong>
              <AcknowledgementBadge acknowledgement={document.acknowledgement} />
            </div>
            <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
              {ACKNOWLEDGEMENT_LABEL[document.acknowledgement]}
              {document.payment && ` · ${paymentSummary(document.payment)}`}
            </div>
            <div className="rfx-stack" style={{ gap: 6, marginTop: 8 }}>
              {document.clauses.map((clause) => (
                <div key={clause.id} style={{ fontSize: 12.5 }}>
                  <span style={{ fontFamily: font.mono, color: color.textSecondary }}>{clause.code}</span>{' '}
                  <strong>{clause.title}</strong>
                  {isLocked(document, clause) && <span style={{ color: color.textSecondary }}> · locked</span>}
                  <div style={{ color: color.textBody }}>{clause.text}</div>
                </div>
              ))}
            </div>
            {document.attachmentName && (
              <div style={{ fontSize: 12, marginTop: 8 }}>📎 {document.attachmentName}</div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** What updating a set to the library's version would change, clause by clause. */
function LibraryChanges({ document, onClose, onUpdate }: {
  document: TermsDocumentInput;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const template = libraryTemplate(document)!;
  const before = new Map(document.clauses.map((c) => [c.code, c]));
  const after = new Map(template.clauses.map((c) => [c.code, c]));
  const changes = [
    ...template.clauses.filter((c) => !before.has(c.code)).map((c) => `Adds ${c.code} "${c.title}"`),
    ...document.clauses.filter((c) => !after.has(c.code)).map((c) => `Drops ${c.code} "${c.title}"`),
    ...template.clauses.filter((c) => {
      const mine = before.get(c.code);
      return mine && !c.fromPaymentFields
        && (mine.title !== c.title || mine.text !== c.text || mine.nonNegotiable !== c.nonNegotiable);
    }).map((c) => `Rewords ${c.code} "${c.title}"`),
    ...(template.payment && document.payment
      && paymentSummary(template.payment) !== paymentSummary(document.payment)
      ? [`Payment figures become ${paymentSummary(template.payment)}`]
      : []),
  ];
  return (
    <Modal
      open
      title={`${shortTitle(document.title)}: v${document.version} → v${template.version}`}
      onClose={onClose}
      onConfirm={onUpdate}
      confirmLabel={`Update to v${template.version}`}
    >
      <div style={{ marginBottom: 8 }}>
        Updating replaces this event's copy with the library's. Where it applies and its documents are kept;
        edits made here are not.
      </div>
      {changes.length === 0 ? (
        <div style={{ color: color.textSecondary }}>No clause differs; only the version number moves.</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {changes.map((change) => <li key={change}>{change}</li>)}
        </ul>
      )}
    </Modal>
  );
}

/** The next reference in the set's own numbering. */
function nextClauseCode(clauses: { code: string }[]): string {
  const last = clauses[clauses.length - 1]?.code ?? '1.0';
  const [major, minor] = last.split('.');
  const next = Number.parseInt(minor ?? '0', 10);
  return Number.isFinite(next) ? `${major}.${next + 1}` : `${clauses.length + 1}.1`;
}

/** What each readiness gap links to, in the rail. */
const GAP_FIX_LABEL: Record<GapTarget, string> = { GATE: 'set the gate', TECHNICAL: 'add', COMMERCIAL: 'name' };
/** And on the step's own banner, where the action stands on its own. */
const GAP_ACTION: Record<GapTarget, string> = {
  GATE: 'Set the gate', TECHNICAL: 'Add evaluator', COMMERCIAL: 'Name evaluator',
};

function gateSummary(gate: GateKind, minScore: number): string {
  switch (gate) {
    case 'NONE': return 'no gate';
    case 'MIN_SCORE': return `minimum ${minScore}`;
    case 'PASS_FAIL': return 'pass / fail';
    case 'BOTH': return `pass / fail, then minimum ${minScore}`;
  }
}

/** The category evaluators know the event by — the super-category where the lines carry one. */
function eventCategoryOf(draft: Draft): string {
  return draft.lines.find((l) => l.superCategory)?.superCategory ?? draft.category;
}

/**
 * Whole-number shares that add to exactly 100, largest remainder first, so a
 * column of weights never totals 99 because of rounding.
 */
function shares(weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / total) * 100);
  const floored = raw.map(Math.floor);
  let left = 100 - floored.reduce((a, w) => a + w, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floored[i] += 1;
    left -= 1;
  }
  return floored;
}

const STAGE_HEADLINE: Record<StageKind, string> = {
  QUALIFY: 'Pre-qualify',
  TECHNICAL: 'Technical proposal',
  COMMERCIAL: 'Commercial',
  COMBINED: 'Technical and commercial',
  NEGOTIATION: 'Price negotiation',
  AUCTION: 'Live auction',
};

function stageHeadline(kind: StageKind, side: Side): string {
  if (kind === 'AUCTION') return side === 'BUY' ? 'Live reverse auction' : 'Live forward auction';
  return STAGE_HEADLINE[kind];
}

/** The commercial comparison rule, read from the side — never written as static copy. */
function priceRule(side: Side): string {
  return side === 'BUY' ? 'lowest landed total per line' : 'highest total per line';
}

function scoringNote(question: TemplateQuestion): string {
  switch (question.scoringMethod) {
    case 'MANUAL':
      return question.askedPer === 'LINE' ? 'Rubric, per line, averaged' : 'Rubric, by each technical evaluator';
    case 'RULE':
      return `Automatic — ${question.rubric ?? 'by the rule set on the question'}`;
    case 'AI_ASSISTED':
      return 'AI proposes a score with cited evidence; the evaluator accepts, adjusts or rejects';
    case 'AI_AUTO':
      return 'AI scores; below its confidence threshold an evaluator decides';
    default:
      return 'Not scored';
  }
}

interface AssistantInsight {
  title: string;
  body: React.ReactNode;
  evidenceLabel: string;
  evidence: string[];
}

/**
 * Why the gates are where they are, from the category's own history. Only
 * what the history shows is said — a range used and what happened below it.
 */
function gateInsight(facts: StageFacts[], setup: EvaluationSetup, category: string): AssistantInsight | undefined {
  const merit = facts.filter((f) => judgesMerit(f.kind));
  if (merit.length === 0) return undefined;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const typical = GATE_HISTORY.filter((h) => h.gate >= 65);
  const loose = GATE_HISTORY.filter((h) => h.gate < 65);
  const floor = Math.min(...typical.map((h) => h.gate));
  const range = `${floor}–${Math.max(...typical.map((h) => h.gate))}`;
  const slower = Math.round(avg(loose.map((h) => h.evaluationDays)) - avg(typical.map((h) => h.evaluationDays)));
  const grew = Math.max(0, ...loose.map((h) => wouldQualify(h.scores, h.gate)));
  let historyTold = false;
  const sentences = merit.map((f) => {
    const gate = gateOf(setup, f.stage, f.kind);
    const label = STAGE_LABELS[f.stage];
    if (f.kind === 'QUALIFY') {
      return gate.gate === 'PASS_FAIL'
        ? `${label} screens on compliance, so it is pass / fail on the ${f.questions.knockouts.length} questionnaire knockouts.`
        : `${label} screens on compliance; its gate is ${gateSummary(gate.gate, gate.minScore)}.`;
    }
    if (!usesScore(gate.gate)) {
      return `${label} is judged on the proposal but has no minimum score — the last ${GATE_HISTORY.length} ${category} events used ${range}.`;
    }
    if (historyTold) return `${label} gates on a minimum of ${gate.minScore}.`;
    historyTold = true;
    return `${label} is judged on the proposal, so it gates on score: the last ${GATE_HISTORY.length} ${category} events used ${range}; below ${floor} the shortlist grew to ${grew} suppliers and evaluation took ${slower} days longer.`;
  });
  return {
    title: 'Why these gates',
    body: sentences.join(' '),
    evidenceLabel: `See the ${GATE_HISTORY.length} events`,
    evidence: GATE_HISTORY.map((h) => `${h.reference} ${h.title} — gate ${h.gate}, ${wouldQualify(h.scores, h.gate)} of ${h.scores.length} qualified, ${h.evaluationDays} days to evaluate`),
  };
}

/** "Add P. Nair as the second technical evaluator and R. Mehta as commercial evaluator". */
function describeAdded(
  added: { id: string; role: EvaluatorRole; stage: EvaluatedStage }[], before: EvaluationSetup,
): string {
  const phrase = (role: EvaluatorRole) => {
    const picks = added.filter((a) => a.role === role);
    const people = [...new Set(picks.map((a) => a.id))];
    if (people.length === 0) return null;
    const noun = role === 'TECHNICAL' ? 'technical evaluator' : 'commercial evaluator';
    const second = role === 'TECHNICAL' && people.length === 1
      && picks.every((a) => (before.technicalEvaluators[a.stage] ?? []).length === 1);
    return `${people.map(evaluatorName).join(' and ')} as ${second ? `the second ${noun}` : people.length > 1 ? `${noun}s` : noun}`;
  };
  return `Add ${[phrase('TECHNICAL'), phrase('COMMERCIAL')].filter(Boolean).join(' and ')}`;
}

/** The Evaluation group on the Review step. */
function evaluationReview(draft: Draft, facts: StageFacts[]): [string, React.ReactNode][] {
  const setup = draft.evaluation;
  const rows = facts
    .filter((f) => judgesMerit(f.kind) || opensPrice(f.kind))
    .map((f): [string, React.ReactNode] => {
      const gate = gateOf(setup, f.stage, f.kind);
      const technical = setup.technicalEvaluators[f.stage] ?? [];
      const commercial = setup.commercialEvaluators[f.stage] ?? [];
      const who = [
        judgesMerit(f.kind) ? (technical.length > 0 ? `${technical.map(evaluatorName).join(', ')} (technical)` : 'no technical evaluator') : null,
        opensPrice(f.kind) ? (commercial.length > 0 ? `${commercial.map(evaluatorName).join(', ')} (commercial)` : 'no commercial evaluator') : null,
      ].filter(Boolean).join(' · ');
      const how = judgesMerit(f.kind)
        ? `${GATE_LABEL[gate.gate]}${usesScore(gate.gate) ? ` ${gate.minScore}` : ''}`
        : 'Price compared';
      return [STAGE_LABELS[f.stage], `${how} — ${who}`];
    });
  return [
    ...rows,
    ['Combined score', `Technical ${setup.technicalWeight}% · commercial ${100 - setup.technicalWeight}%`],
    ['Blind technical', setup.blindTechnical ? 'On — evaluators see "Bidder A"' : 'Off'],
    ['Consensus', setup.consensus === 'MODERATED' ? `Moderated — divergence over ${setup.divergenceThreshold}% goes to the lead` : 'Scores averaged'],
    ...(draftEnvelope(draft) === 'TWO_ENVELOPE'
      ? [['Commercial unlock', setup.unlockWitness ? 'Needs a witness' : 'One authorised user'] as [string, React.ReactNode]]
      : []),
  ];
}

/**
 * Evaluation, set up before anyone responds.
 *
 * The buyer decides here how a supplier gets from one stage to the next and
 * who judges them on the way. The questions and their weights are the
 * questionnaire's — this step reads them and says so, rather than letting a
 * second set of weights drift from the first. What the evaluation workspace
 * shows evaluators after publish is exactly what is set here, read-only.
 */
function EvaluationStep({
  draft, patch, facts, gaps, focus, onFocus, overlay, onOverlay, stepNumber, onGoToStep,
  auctionReady, ownerName, bidderIds,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  facts: StageFacts[];
  gaps: EvaluationGap[];
  focus: { stage: EvaluatedStage | null; target: GapTarget | null; nonce: number };
  onFocus: (stage: EvaluatedStage | null, target: GapTarget | null) => void;
  overlay: 'preview' | 'history' | null;
  onOverlay: (next: 'preview' | 'history' | null) => void;
  /** The 1-based position of a wizard step, or 0 when this journey has none. */
  stepNumber: (name: string) => number;
  onGoToStep: (name: string) => void;
  auctionReady: boolean;
  ownerName: string;
  bidderIds: string[];
}) {
  const setup = draft.evaluation;
  const write = (next: Partial<EvaluationSetup>) => patch({ evaluation: { ...setup, ...next } });
  const category = eventCategoryOf(draft);

  const opening = facts.find((f) => gaps.some((g) => g.stage === f.stage))?.stage
    ?? facts.find((f) => judgesMerit(f.kind))?.stage
    ?? facts[0]?.stage
    ?? null;
  const [selected, setSelected] = React.useState<EvaluatedStage | null>(opening);
  React.useEffect(() => {
    if (focus.nonce === 0) return;
    if (focus.stage) setSelected(focus.stage);
    if (focus.target) {
      const target = focus.target.toLowerCase();
      window.setTimeout(() => {
        document.getElementById(`evaluation-${target}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }, 30);
    }
  }, [focus.nonce]);

  const current = facts.find((f) => f.stage === selected) ?? facts[0];
  const merit = facts.filter((f) => judgesMerit(f.kind));
  const previewStage = current && judgesMerit(current.kind) ? current : merit[merit.length - 1];

  const blocking = gaps.filter((g) => g.blocking).length;
  const worth = gaps.length - blocking;
  const bannerTitle = [
    blocking > 0 ? `${blocking} ${blocking === 1 ? 'gap' : 'gaps'} to close before publish` : null,
    worth > 0 ? `${worth} worth a look` : null,
  ].filter(Boolean).join(' · ');

  const preview = (
    <Button variant="secondary" onClick={() => onOverlay('preview')} disabled={!previewStage}>
      <Icon name="eye" size={14} /> Preview the evaluator view
    </Button>
  );

  return (
    <Card padded={false}>
      <div style={{ padding: '14px 18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <h2 style={{ ...type.sectionHeading, margin: 0 }}>Evaluation</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: color.textSecondary, lineHeight: 1.5 }}>
            How suppliers advance at each stage, and who judges them. Scores and knockouts come from the
            questionnaire; this step sets the gates, the rubric and the evaluators.
          </p>
        </div>
        {preview}
      </div>

      <div className="rfx-stack" style={{ padding: 18, gap: 18 }}>
        {facts.length === 0 && (
          <Empty
            title="Nothing on this journey is evaluated"
            hint="The journey has no stage where suppliers are judged — choose a pattern with an RFI, RFP or RFQ to set gates and evaluators."
          />
        )}

        {gaps.length > 0 && (
          <div
            role="region"
            aria-label="Gaps to close"
            style={{
              background: color.warningSoft, border: '1px solid #FDE68A',
              borderRadius: radius.card, padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <span aria-hidden style={{ color: color.warningText, display: 'inline-flex' }}><Icon name="warning" size={15} /></span>
              {bannerTitle}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {gaps.map((gap) => (
                <li
                  key={gap.text}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0 0 23px', flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: gap.blocking ? color.textBody : color.warningText, minWidth: 0, flex: '1 1 260px' }}>
                    {gap.blocking ? null : <span aria-hidden>● </span>}
                    {gap.text}
                  </span>
                  {gap.target && (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => onFocus(gap.stage ?? facts.find((f) => opensPrice(f.kind))?.stage ?? null, gap.target)}
                    >
                      {GAP_ACTION[gap.target]}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {facts.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>How suppliers advance</h3>
              <span style={{ fontSize: 12, color: color.textSecondary }}>
                Click a stage to edit it.
                {merit.length > 0 && facts.some((f) => opensPrice(f.kind)) && (
                  <> Combined score for negotiation and award: technical {setup.technicalWeight}% · commercial {100 - setup.technicalWeight}%.</>
                )}
              </span>
            </div>
            <div
              role="tablist"
              aria-label="Stages"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(168px, 100%), 1fr))', gap: 8 }}
            >
              {facts.map((fact) => (
                <StageCard
                  key={fact.stage}
                  fact={fact}
                  draft={draft}
                  selected={current?.stage === fact.stage}
                  gapCount={gaps.filter((g) => g.stage === fact.stage).length}
                  auctionReady={auctionReady}
                  auctionStep={stepNumber('Auction')}
                  ownerName={ownerName}
                  onSelect={() => setSelected(fact.stage)}
                />
              ))}
            </div>
          </section>
        )}

        {current && (
          <StageDetail
            fact={current}
            facts={facts}
            draft={draft}
            write={write}
            category={category}
            ownerName={ownerName}
            questionnaireStep={stepNumber('Questionnaire')}
            auctionStep={stepNumber('Auction')}
            onGoToStep={onGoToStep}
          />
        )}

        {facts.length > 0 && <EvaluationRules draft={draft} patch={patch} write={write} facts={facts} />}

        {facts.length > 0 && (
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              borderTop: `1px solid ${color.border}`, paddingTop: 12,
            }}
          >
            <span style={{ fontSize: 12, color: color.textSecondary }}>
              Gates and knockouts are enforced automatically when a stage closes. Evaluators see only their own envelope.
            </span>
            {previewStage && (
              <LinkButton onClick={() => onOverlay('preview')}>Preview the evaluator view →</LinkButton>
            )}
          </div>
        )}
      </div>

      {overlay === 'preview' && previewStage && (
        <EvaluatorViewPreview
          fact={previewStage}
          draft={draft}
          bidderIds={bidderIds}
          onClose={() => onOverlay(null)}
        />
      )}
      {overlay === 'history' && (
        <GateHistoryModal
          minScore={decisiveGate(setup, facts.map((f) => f.stage)).minTechnicalScore}
          category={category}
          onClose={() => onOverlay(null)}
        />
      )}
    </Card>
  );
}

/** One stage of the ladder, summarised: what gets a supplier through and who decides. */
function StageCard({
  fact, draft, selected, gapCount, auctionReady, auctionStep, ownerName, onSelect,
}: {
  fact: StageFacts;
  draft: Draft;
  selected: boolean;
  gapCount: number;
  auctionReady: boolean;
  auctionStep: number;
  ownerName: string;
  onSelect: () => void;
}) {
  const setup = draft.evaluation;
  const { stage, kind, questions } = fact;
  const gate = gateOf(setup, stage, kind);
  const technical = setup.technicalEvaluators[stage] ?? [];
  const commercial = setup.commercialEvaluators[stage] ?? [];
  const neededTechnical = technicalNeeded(kind, gate.gate, questions.scored.length);
  const rubric = RUBRIC_SCALES.find((r) => r.id === gate.rubricId) ?? RUBRIC_SCALES[0];
  const short = (n: number) => <span style={{ color: color.dangerText }}>{n}</span>;
  const line = (label: string | null, value: React.ReactNode, danger = false) => (
    <div style={{ fontSize: 12, lineHeight: 1.5, color: danger ? color.dangerText : color.textBody, fontWeight: danger ? 600 : 400 }}>
      {label && <strong style={{ fontWeight: 600 }}>{label}: </strong>}
      {value}
    </div>
  );

  const status = gapCount > 0
    ? <Chip tone="gold" icon="⚠">{gapCount} {gapCount === 1 ? 'gap' : 'gaps'}</Chip>
    : kind === 'AUCTION' && !auctionReady
      ? <Chip>Not started</Chip>
      : <Chip tone="success" icon="✓">Ready</Chip>;

  const gateText = gate.gate === 'MIN_SCORE' ? `minimum score ${gate.minScore} of 100`
    : gate.gate === 'BOTH' ? `knockouts, then minimum ${gate.minScore}`
      : gate.gate === 'PASS_FAIL' ? 'pass / fail' : 'none';

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className="rounded-lg text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: selected ? '11px 11px' : '12px 12px',
        background: color.surface, minWidth: 0,
        border: selected ? `2px solid ${color.brandPrimary}` : `1px solid ${color.border}`,
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: 13.5 }}>{STAGE_LABELS[stage]}</strong>
        {status}
      </span>
      <span style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.45 }}>
        {kind === 'COMMERCIAL'
          ? `Commercial · ${envelopeFor(draft.envelopeByStage, stage) === 'TWO_ENVELOPE' ? 'sealed until technical scoring is complete' : envelopeFor(draft.envelopeByStage, stage) === 'NONE' ? 'not sealed' : 'opened with the technical answers'}`
          : stageHeadline(kind, draft.side)}
      </span>

      {judgesMerit(kind) && (
        <>
          {line('Gate', gateText)}
          {usesKnockouts(gate.gate) && questions.knockouts.length > 0
            ? line(null, `${questions.knockouts.length} ${questions.knockouts.length === 1 ? 'knockout' : 'knockouts'} from the questionnaire: ${questions.knockouts.map((q) => q.title).join(' · ')}`)
            : questions.scored.length > 0
              ? line(null, `${questions.scored.length} scored questions · ${shares(questions.scored.map((q) => q.weight)).join(' / ')} · ${rubric.bands.length}-band rubric`)
              : line(null, 'Nothing scored in the questionnaire')}
          {line(
            neededTechnical > 1 ? 'Evaluators' : 'Evaluator',
            technical.length === 0
              ? <span style={{ color: color.dangerText }}>not named</span>
              : (
                <>
                  {technical.map(evaluatorName).join(', ')}
                  {technical.length < neededTechnical && <> + {short(neededTechnical - technical.length)} needed</>}
                </>
              ),
          )}
        </>
      )}
      {kind === 'COMMERCIAL' && (
        <>
          {line('Rule', priceRule(draft.side))}
          {questions.knockouts.length > 0 && line('Knockout', questions.knockouts.map((q) => q.title).join(' · '))}
        </>
      )}
      {opensPrice(kind) && (
        commercial.length > 0
          ? line('Commercial evaluator', commercial.map(evaluatorName).join(', '))
          : line(null, 'Commercial evaluator: not named', true)
      )}
      {kind === 'NEGOTIATION' && (
        <>
          {line("Who's in", `top ${setup.negotiationShortlist} by combined score`)}
          {line(null, 'No new scoring — prices are re-confirmed')}
          {line('Owner', ownerName)}
        </>
      )}
      {kind === 'AUCTION' && (
        <>
          {line('Rule', directionLabel(draft.side))}
          {line(null, auctionStep > 0 ? `Mechanism and rules are set in step ${auctionStep}` : 'Mechanism and rules come from the journey')}
          {line('Owner', ownerName)}
        </>
      )}
    </button>
  );
}

/** The selected stage, opened up: the gate, the rubric, what is scored and who scores it. */
function StageDetail({
  fact, facts, draft, write, category, ownerName, questionnaireStep, auctionStep, onGoToStep,
}: {
  fact: StageFacts;
  facts: StageFacts[];
  draft: Draft;
  write: (next: Partial<EvaluationSetup>) => void;
  category: string;
  ownerName: string;
  questionnaireStep: number;
  auctionStep: number;
  onGoToStep: (name: string) => void;
}) {
  const setup = draft.evaluation;
  const { stage, kind, questions } = fact;
  const label = STAGE_LABELS[stage];
  const index = facts.indexOf(fact);
  const previous = facts.slice(0, index).reverse().find((f) => judgesMerit(f.kind) || opensPrice(f.kind));
  const next = facts[index + 1];
  const nextLabel = next ? STAGE_LABELS[next.stage] : 'award';
  const gate = gateOf(setup, stage, kind);
  const setGate = (change: Partial<typeof gate>) => write({ gates: { ...setup.gates, [stage]: { ...gate, ...change } } });
  const stages = facts.map((f) => f.stage);

  const subline = kind === 'NEGOTIATION'
    ? 'Suppliers on the shortlist re-confirm or improve their prices.'
    : kind === 'AUCTION'
      ? 'Suppliers who reach the auction bid live against each other.'
      : `${previous ? `Suppliers who clear ${STAGE_LABELS[previous.stage]}` : 'Every invited supplier'} ${questions.total === 1 ? 'answers 1 question' : `answer ${questions.total} questions`}; ${questions.scored.length} ${questions.scored.length === 1 ? 'is' : 'are'} scored.`;

  // Copying keeps one panel across the ladder, which scores more consistently
  // than a new set of people per stage.
  const copyFrom = facts.slice(0, index).reverse()
    .find((f) => judgesMerit(f.kind) && (setup.technicalEvaluators[f.stage] ?? []).length > 0);
  const mine = setup.technicalEvaluators[stage] ?? [];
  const copyable = judgesMerit(kind) && copyFrom
    ? (setup.technicalEvaluators[copyFrom.stage] ?? []).filter((id) => !mine.includes(id))
    : [];

  return (
    <section style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }} aria-label={`${label} setup`}>
      <header
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '11px 14px', background: color.rowAlt, borderBottom: `1px solid ${color.border}`,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <strong style={{ fontSize: 13.5 }}>{label} — {stageHeadline(kind, draft.side).toLowerCase()}</strong>
          <span style={{ fontSize: 12, color: color.textSecondary }}>{subline}</span>
        </span>
        {copyable.length > 0 && copyFrom && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => write(withEvaluators(setup, 'TECHNICAL', stage, [...mine, ...copyable]))}
          >
            Copy evaluators from {STAGE_LABELS[copyFrom.stage]}
          </Button>
        )}
      </header>

      <div className="rfx-stack" style={{ padding: 14, gap: 18 }}>
        {(judgesMerit(kind) || kind === 'COMMERCIAL') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 20 }}>
            <GateChoice
              fact={fact}
              gate={gate}
              nextLabel={nextLabel}
              category={category}
              onChange={setGate}
            />
            {judgesMerit(kind) ? (
              <RubricChoice rubricId={gate.rubricId} category={category} onChange={(rubricId) => setGate({ rubricId })} />
            ) : (
              <CommercialEnvelope draft={draft} stage={stage} previous={previous ? STAGE_LABELS[previous.stage] : null} />
            )}
          </div>
        )}

        {judgesMerit(kind) && (
          <ScoredQuestions
            fact={fact}
            facts={facts}
            lineCount={draft.lines.length}
            questionnaireStep={questionnaireStep}
            onEdit={() => onGoToStep('Questionnaire')}
          />
        )}

        {kind === 'COMBINED' && <CommercialEnvelope draft={draft} stage={stage} previous={null} />}

        {opensPrice(kind) && questions.commercial.length > 0 && (
          <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
            <strong style={{ color: color.textBody, fontWeight: 600 }}>In the commercial envelope: </strong>
            {questions.commercial.map((q) => q.title).join(' · ')}.
            {envelopeFor(draft.envelopeByStage, stage) === 'TWO_ENVELOPE' && ' Never shown to a technical evaluator — not in the workspace, an export or an attachment name.'}
          </div>
        )}

        {judgesMerit(kind) && (
          <EvaluatorPanel
            role="TECHNICAL"
            stage={stage}
            stageLabel={label}
            setup={setup}
            stages={stages}
            envelopeMode={draftEnvelope(draft)}
            needed={technicalNeeded(kind, gate.gate, questions.scored.length)}
            rubricMax={(RUBRIC_SCALES.find((r) => r.id === gate.rubricId) ?? RUBRIC_SCALES[0]).max}
            onChange={(ids) => write(withEvaluators(setup, 'TECHNICAL', stage, ids))}
          />
        )}
        {opensPrice(kind) && (
          <EvaluatorPanel
            role="COMMERCIAL"
            stage={stage}
            stageLabel={label}
            setup={setup}
            stages={stages}
            envelopeMode={draftEnvelope(draft)}
            needed={commercialNeeded(kind)}
            rubricMax={10}
            onChange={(ids) => write(withEvaluators(setup, 'COMMERCIAL', stage, ids))}
          />
        )}

        {kind === 'NEGOTIATION' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            <Field
              label="Suppliers taken into negotiation"
              hint={`The top ${setup.negotiationShortlist} by combined score — technical ${setup.technicalWeight}% · commercial ${100 - setup.technicalWeight}%.`}
            >
              <NumberInput
                min={1}
                max={10}
                value={setup.negotiationShortlist}
                onChange={(e) => write({ negotiationShortlist: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                style={{ width: 90 }}
              />
            </Field>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <div>No new scoring at negotiation — suppliers re-confirm or improve their prices and the combined score is recomputed.</div>
              <div style={{ marginTop: 6 }}><strong style={{ fontWeight: 600 }}>Owner:</strong> {ownerName}</div>
            </div>
          </div>
        )}

        {kind === 'AUCTION' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5, lineHeight: 1.6 }}>
            <span>
              Suppliers who reach the auction bid live; {directionLabel(draft.side)}. Nothing is scored here —
              the mechanism, feedback policy and closing rules decide the outcome. <strong style={{ fontWeight: 600 }}>Owner:</strong> {ownerName}
            </span>
            {auctionStep > 0 && (
              <Button variant="secondary" size="small" onClick={() => onGoToStep('Auction')}>
                Set up the auction in step {auctionStep} →
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** The gate, as a choice with its consequence stated next to it. */
function GateChoice({
  fact, gate, nextLabel, category, onChange,
}: {
  fact: StageFacts;
  gate: { gate: GateKind; minScore: number; rubricId: string };
  nextLabel: string;
  category: string;
  onChange: (change: { gate?: GateKind; minScore?: number }) => void;
}) {
  const { stage, kind, questions } = fact;
  const scored = questions.scored.length > 0;
  const knockouts = questions.knockouts.length;
  const typical = GATE_HISTORY.filter((h) => h.gate >= 65).map((h) => h.gate);
  const minInvalid = usesScore(gate.gate) && (gate.minScore <= 0 || gate.minScore > 100);

  const option = (value: GateKind, content: React.ReactNode) => (
    <label
      key={value}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, padding: '5px 0', cursor: 'pointer' }}
    >
      <input
        type="radio"
        name={`gate-${stage}`}
        checked={gate.gate === value}
        onChange={() => onChange({ gate: value })}
        style={{ width: 15, height: 15, accentColor: color.brandPrimary, margin: '2px 0 0', flexShrink: 0 }}
      />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>{content}</span>
    </label>
  );

  const hint = !judgesMerit(kind)
    ? gate.gate === 'PASS_FAIL'
      ? `A supplier failing a commercial knockout is not compared on price; the evaluator confirms each failure before it counts.`
      : `Every technically qualified supplier is compared on price.`
    : usesScore(gate.gate)
      ? `Suppliers below ${gate.minScore} don't reach the ${nextLabel}. The last ${GATE_HISTORY.length} ${category} events used ${Math.min(...typical)}–${Math.max(...typical)}; a score of 0 counts as no gate.`
      : gate.gate === 'PASS_FAIL'
        ? `A supplier failing any of the ${knockouts} knockouts doesn't reach the ${nextLabel}. The evaluator confirms each failure, and it can be reversed with a reason.`
        : `Every supplier that responds reaches the ${nextLabel}.`;

  return (
    <fieldset id="evaluation-gate" style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, padding: 0 }}>
        Gate — who reaches the {nextLabel}
      </legend>
      {judgesMerit(kind) ? (
        <>
          {option('NONE', (
            <span>
              None
              {scored && (
                <span style={{ color: color.warningText }}> — every responding supplier would proceed; not recommended for a scored stage</span>
              )}
            </span>
          ))}
          {option('MIN_SCORE', (
            <>
              <span>Minimum technical score</span>
              <NumberInput
                aria-label={`Minimum technical score at ${STAGE_LABELS[stage]}`}
                min={0}
                max={100}
                value={gate.minScore}
                invalid={minInvalid}
                onClick={(e) => e.preventDefault()}
                onChange={(e) => onChange({
                  minScore: Number(e.target.value),
                  ...(usesScore(gate.gate) ? {} : { gate: 'MIN_SCORE' as const }),
                })}
                style={{ width: 72 }}
              />
              <span>of 100</span>
            </>
          ))}
          {option('PASS_FAIL', (
            <span>
              Pass / fail on knockouts only
              {knockouts === 0 && <span style={{ color: color.textSecondary }}> — this questionnaire has no knockouts</span>}
            </span>
          ))}
          {option('BOTH', <span>Both — knockouts first, then the minimum score</span>)}
        </>
      ) : (
        <>
          {option('NONE', <span>No gate — compare every technically qualified supplier on price</span>)}
          {option('PASS_FAIL', (
            <span>
              Pass / fail on commercial knockouts
              {knockouts === 0 && <span style={{ color: color.textSecondary }}> — none in this questionnaire</span>}
            </span>
          ))}
        </>
      )}
      <div style={{ fontSize: 11.5, color: minInvalid ? color.dangerText : color.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
        {minInvalid ? 'The minimum score has to be between 1 and 100.' : hint}
      </div>
    </fieldset>
  );
}

function RubricChoice({ rubricId, category, onChange }: {
  rubricId: string; category: string; onChange: (rubricId: string) => void;
}) {
  const rubric = RUBRIC_SCALES.find((r) => r.id === rubricId) ?? RUBRIC_SCALES[0];
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Scoring rubric</div>
      <div style={{ maxWidth: 400 }}>
        <Select aria-label="Scoring rubric" value={rubric.id} onChange={(e) => onChange(e.target.value)}>
          {RUBRIC_SCALES.map((r) => <option key={r.id} value={r.id}>{rubricName(r, category)}</option>)}
        </Select>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {rubric.bands.map((band) => <Chip key={band}>{band}</Chip>)}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 8, lineHeight: 1.5 }}>{rubric.note}</div>
    </div>
  );
}

/** What a commercial envelope is, and what it takes to open it. */
function CommercialEnvelope({ draft, previous, stage }: { draft: Draft; previous: string | null; stage: string }) {
  const mode = envelopeFor(draft.envelopeByStage, stage);
  const two = mode === 'TWO_ENVELOPE';
  return (
    <div style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.6 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Commercial envelope</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span aria-hidden style={{ color: two ? color.accentPurpleText : color.textSecondary, marginTop: 2 }}>
          <Icon name="lock" size={14} />
        </span>
        <span>
          {two
            ? <>Sealed until every technical score{previous ? ` at ${previous}` : ''} is submitted and the technical result is published. Opening it cannot be undone{draft.evaluation.unlockWitness ? ', and needs a second authorised user to witness it' : ''}.</>
            : mode === 'NONE'
              ? <>No envelope — nothing is sealed. Price is visible as soon as each supplier submits, so treat it as indicative.</>
              : <>Single envelope — price is opened with the technical answers, and everyone evaluating can see it.</>}
        </span>
      </div>
      <div style={{ marginTop: 8 }}><strong style={{ fontWeight: 600 }}>Rule:</strong> {priceRule(draft.side)}</div>
    </div>
  );
}

/** The questions a stage is scored on, as the questionnaire set them — read here, edited there. */
function ScoredQuestions({ fact, facts, lineCount, questionnaireStep, onEdit }: {
  fact: StageFacts;
  facts: StageFacts[];
  lineCount: number;
  questionnaireStep: number;
  onEdit: () => void;
}) {
  const label = STAGE_LABELS[fact.stage];
  const weights = shares(fact.questions.scored.map((q) => q.weight));
  const upToHere = facts.slice(0, facts.indexOf(fact) + 1).filter((f) => judgesMerit(f.kind));
  const knockouts = upToHere.flatMap((f) => f.questions.knockouts.map((q) => `${q.title} — ${knockoutRule(q)} (${STAGE_LABELS[f.stage]})`));
  const columns: Column<TemplateQuestion>[] = [
    { key: 'question', header: 'Question', render: (q) => <span style={{ fontWeight: 600 }}>{q.title}</span> },
    {
      key: 'scope', header: 'Scope', width: '150px',
      render: (q) => (q.askedPer === 'LINE' ? `Per line · ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}` : 'Supplier'),
    },
    { key: 'weight', header: 'Weight', width: '80px', numeric: true, render: (_, i) => `${weights[i]}%` },
    { key: 'how', header: "How it's scored", render: (q) => <span style={{ color: color.textSecondary }}>{scoringNote(q)}</span> },
  ];
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '9px 12px', background: color.rowAlt, borderBottom: `1px solid ${color.border}`,
        }}
      >
        <strong style={{ fontSize: 12.5 }}>Scored at {label} — from the questionnaire</strong>
        {questionnaireStep > 0 && (
          <LinkButton onClick={onEdit}>Edit questions and weights in step {questionnaireStep} →</LinkButton>
        )}
      </div>
      <Table
        columns={columns}
        rows={fact.questions.scored}
        rowKey={(q) => q.id}
        dense
        empty={(
          <div style={{ padding: 14, fontSize: 12.5, color: color.textSecondary }}>
            Nothing at {label} is scored, so this stage can only gate on knockouts.
          </div>
        )}
      />
      <div style={{ padding: '9px 12px', borderTop: `1px solid ${color.border}`, fontSize: 12, color: color.textSecondary, lineHeight: 1.6 }}>
        {fact.questions.scored.length > 0 && (
          <span style={{ marginRight: 14, color: color.textBody }}>
            Total <strong style={{ color: color.successText }}>100% ✓</strong>
          </span>
        )}
        {knockouts.length > 0
          ? <>Knockouts checked before scoring: {knockouts.join(' · ')}</>
          : 'No knockouts are checked before scoring.'}
      </div>
    </div>
  );
}

/**
 * Who judges a stage, in one role. The suggestion is made only where the
 * stage is short, and never offers someone on the far side of the envelope.
 */
function EvaluatorPanel({
  role, stage, stageLabel, setup, stages, envelopeMode, needed, rubricMax, onChange,
}: {
  role: EvaluatorRole;
  stage: EvaluatedStage;
  stageLabel: string;
  setup: EvaluationSetup;
  stages: EvaluatedStage[];
  envelopeMode: EnvelopeMode;
  needed: number;
  rubricMax: number;
  onChange: (ids: string[]) => void;
}) {
  const [picking, setPicking] = React.useState(false);
  const named = (role === 'TECHNICAL' ? setup.technicalEvaluators : setup.commercialEvaluators)[stage] ?? [];
  const candidates = candidatesFor(role, stage, setup, stages, envelopeMode, EVALUATORS);
  const suggestion = named.length < needed ? candidates[0] : undefined;
  const noun = role === 'TECHNICAL' ? 'Technical evaluators' : 'Commercial evaluators';
  const met = named.length >= needed;
  const points = Math.round((setup.divergenceThreshold / 100) * rubricMax * 10) / 10;

  const leadNote = (index: number) => {
    if (role !== 'TECHNICAL' || index !== 0 || needed < 2) return null;
    return setup.consensus === 'MODERATED'
      ? ` · Lead evaluator · decides when scores differ by more than ${points} ${points === 1 ? 'point' : 'points'}`
      : ' · Lead evaluator · scores are averaged';
  };

  return (
    <div id={`evaluation-${role.toLowerCase()}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{noun}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: met ? color.successText : color.warningText }}>
          {needed} required{role === 'TECHNICAL' && needed > 1 ? ' for scored stages' : ''} · {named.length} named
          {met ? ' ✓' : ''}
        </span>
      </div>

      <div className="rfx-stack" style={{ gap: 8 }}>
        {named.map((id, index) => {
          const person = evaluatorById(id);
          return (
            <div
              key={id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
              }}
            >
              <Avatar initials={person?.initials ?? id.slice(0, 2).toUpperCase()} />
              <span style={{ minWidth: 0, flex: '1 1 240px' }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{person?.name ?? id}</span>
                <span style={{ display: 'block', fontSize: 12, color: color.textSecondary }}>
                  {person?.title ?? ''}{leadNote(index)}
                </span>
              </span>
              {person?.standing
                ? <Chip tone="success" icon="✓">Accepted · no conflict declared</Chip>
                : <Chip tone="info" title="Asked to accept and declare conflicts when the event is published">Asked on publish</Chip>}
              <RowMenu
                label={`Actions for ${person?.name ?? id}`}
                items={[
                  ...(index > 0 && role === 'TECHNICAL'
                    ? [{ label: 'Make lead evaluator', onSelect: () => onChange([id, ...named.filter((n) => n !== id)]) }]
                    : []),
                  { label: `Remove from ${stageLabel}`, danger: true, onSelect: () => onChange(named.filter((n) => n !== id)) },
                ]}
              />
            </div>
          );
        })}

        {suggestion && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              border: `1px dashed ${color.borderStrong}`, borderRadius: radius.control, padding: '10px 12px',
              background: color.surfacePage,
            }}
          >
            <Avatar initials={suggestion.initials} muted />
            <span style={{ minWidth: 0, flex: '1 1 240px' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>Suggested: {suggestion.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: color.textSecondary }}>{suggestion.record}</span>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="small" onClick={() => onChange([...named, suggestion.id])}>Add as evaluator</Button>
              <Button variant="secondary" size="small" onClick={() => setPicking(true)}>Choose someone else</Button>
            </span>
          </div>
        )}

        {!suggestion && named.length < needed && (
          <div style={{ fontSize: 12, color: color.dangerText }}>
            Nobody eligible is left to suggest.{' '}
            <LinkButton onClick={() => setPicking(true)}>See who could be named</LinkButton>
          </div>
        )}

        {met && candidates.length > 0 && (
          <div>
            <LinkButton onClick={() => setPicking(true)}>+ Add another {role === 'TECHNICAL' ? 'technical' : 'commercial'} evaluator</LinkButton>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 8, lineHeight: 1.5 }}>
        {role === 'TECHNICAL'
          ? `Evaluators are notified when the ${stageLabel} closes and declare no conflict of interest before scoring opens.${envelopeMode === 'TWO_ENVELOPE' ? ' Commercial envelopes stay sealed until every technical score is in.' : ''}`
          : envelopeMode === 'TWO_ENVELOPE'
            ? 'Commercial evaluators open the sealed price schedules only after the technical result is published, and may not score the technical envelope on this event.'
            : 'In single-envelope mode price is opened with the technical answers; the commercial evaluator signs off the price comparison.'}
      </div>

      {picking && (
        <EvaluatorPicker
          role={role}
          stage={stage}
          stageLabel={stageLabel}
          setup={setup}
          stages={stages}
          envelopeMode={envelopeMode}
          onPick={(id) => { onChange([...named, id]); setPicking(false); }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Avatar({ initials, muted }: { initials: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11.5, fontWeight: 600,
        background: muted ? color.rowAlt : color.brandPrimarySoft,
        color: muted ? color.textSecondary : color.brandPrimaryStrong,
      }}
    >
      {initials}
    </span>
  );
}

/** Everyone who could be named to a role, and why the rest cannot. */
function EvaluatorPicker({
  role, stage, stageLabel, setup, stages, envelopeMode, onPick, onClose,
}: {
  role: EvaluatorRole;
  stage: EvaluatedStage;
  stageLabel: string;
  setup: EvaluationSetup;
  stages: EvaluatedStage[];
  envelopeMode: EnvelopeMode;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const open = new Set(candidatesFor(role, stage, setup, stages, envelopeMode, EVALUATORS).map((p) => p.id));
  const named = (role === 'TECHNICAL' ? setup.technicalEvaluators : setup.commercialEvaluators)[stage] ?? [];
  const reason = (person: EvaluatorProfile): string | null => {
    if (open.has(person.id)) return null;
    if (named.includes(person.id)) return `Already named at ${stageLabel}`;
    if (role === 'TECHNICAL' ? !person.canScoreTechnical : !person.canOpenCommercial) {
      return role === 'TECHNICAL' ? 'Not permitted to score technical envelopes' : 'Not permitted to open commercial envelopes';
    }
    return role === 'TECHNICAL'
      ? 'Opens the commercial envelope on this event — two envelopes keep the roles apart'
      : 'Scores the technical envelope on this event — a technical evaluator must never see price';
  };
  return (
    <Drawer
      open
      title={`Choose a ${role === 'TECHNICAL' ? 'technical' : 'commercial'} evaluator`}
      subtitle={`For ${stageLabel}. People who cannot be named say why.`}
      onClose={onClose}
    >
      <div className="rfx-stack" style={{ gap: 8 }}>
        {EVALUATORS.map((person) => {
          const why = reason(person);
          return (
            <div
              key={person.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '10px 12px',
                opacity: why ? 0.75 : 1,
              }}
            >
              <Avatar initials={person.initials} muted={Boolean(why)} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{person.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: color.textSecondary }}>{person.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: why ? color.warningText : color.textSecondary, marginTop: 2 }}>
                  {why ?? person.record}
                </span>
              </span>
              <Button variant="secondary" size="small" disabled={Boolean(why)} onClick={() => onPick(person.id)}>
                Add
              </Button>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}

/**
 * The rules every stage runs under. Each says where its value came from, so
 * an evaluator who later sees them read-only in the workspace can tell a
 * tenant policy from a choice made for this event.
 */
/**
 * One stage's envelope choice: what is sealed, who sees price when, and a
 * caution when the mode does not suit what the stage is doing.
 */
function EnvelopePicker({ stage, draft, patch, weightedTechnical, asksPrice, compact }: {
  stage: 'RFI' | 'RFP' | 'RFQ';
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  weightedTechnical: boolean;
  asksPrice: boolean;
  compact?: boolean;
}) {
  const mode = envelopeFor(draft.envelopeByStage, stage);
  const warning = envelopeWarning(stage, mode, { weightedTechnical, asksPrice });
  return (
    <div
      style={compact
        ? { border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '11px 12px', minWidth: 0 }
        : undefined}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{stage} envelope mode</div>
      {!compact && (
        <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 8, lineHeight: 1.5 }}>
          Envelopes are a permissions boundary, not a layout preference. Each of the RFI, RFP and RFQ
          sets its own: under two-envelope mode a technical evaluator never sees price.
        </div>
      )}
      <div style={{ marginBottom: 8 }}>
        <Segmented
          value={mode}
          onChange={(next) => patch({ envelopeByStage: { ...draft.envelopeByStage, [stage]: next } })}
          options={ENVELOPE_OPTIONS}
        />
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, lineHeight: 1.5 }}>{ENVELOPE_EXPLAINER[mode]}</div>
      {warning && (
        <div style={{ fontSize: 11.5, color: color.warningText, marginTop: 6, lineHeight: 1.5 }}>⚠ {warning}</div>
      )}
    </div>
  );
}

/** The event-level summary of the per-stage envelope choices. */
export function draftEnvelope(draft: Draft): EnvelopeMode {
  return eventEnvelope(draft.envelopeByStage, solicitationStagesOf(draft.pattern));
}

function EvaluationRules({ draft, patch, write, facts }: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  write: (next: Partial<EvaluationSetup>) => void;
  facts: StageFacts[];
}) {
  const { state } = useStore();
  const setup = draft.evaluation;
  const lineage = { tenantId: SCOPE_LINEAGE.tenantId, categoryId: draft.category, templateId: null, eventId: null };
  const resolved = (key: string) => resolve(key, state.configSettings, lineage, TENANT_DEFAULTS[key]);
  const scope = (key: string | null, value: unknown) => {
    if (!key) return <Chip>Set for this event</Chip>;
    const r = resolved(key);
    if (r.isLocked && r.lockedBy) return <Chip tone="purple" icon="🔒">Locked at {SCOPE_LABELS[r.lockedBy]}</Chip>;
    return r.value === value ? <Chip>From {SCOPE_LABELS[r.resolvedFrom]}</Chip> : <Chip tone="brand">Set for this event</Chip>;
  };
  const blind = resolved('evaluation.blind_technical');
  const twoEnvelope = draftEnvelope(draft) === 'TWO_ENVELOPE';
  const pricedAndScored = facts.some((f) => opensPrice(f.kind)) && facts.some((f) => judgesMerit(f.kind));

  const rule = (title: string, tag: React.ReactNode, control: React.ReactNode, note: React.ReactNode) => (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '11px 12px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        {tag}
      </div>
      {control}
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 8, lineHeight: 1.5 }}>{note}</div>
    </div>
  );

  return (
    <section aria-label="Rules every stage runs under">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Rules every stage runs under</h3>
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          Evaluators see these read-only in the evaluation workspace, with where each came from.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 10 }}>
        {facts.filter((f) => (ENVELOPE_STAGES as string[]).includes(f.stage)).map((f) => (
          <EnvelopePicker
            key={f.stage}
            stage={f.stage as 'RFI' | 'RFP' | 'RFQ'}
            draft={draft}
            patch={patch}
            weightedTechnical={judgesMerit(f.kind) && f.questions.scored.length > 0}
            asksPrice={opensPrice(f.kind)}
            compact
          />
        ))}

        {pricedAndScored && rule(
          'Combined score',
          scope(null, setup.technicalWeight),
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
            <span>Technical</span>
            <NumberInput
              aria-label="Technical share of the combined score"
              min={0}
              max={100}
              value={setup.technicalWeight}
              onChange={(e) => write({ technicalWeight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={{ width: 72 }}
            />
            <span>% · commercial <strong>{100 - setup.technicalWeight}%</strong></span>
          </div>,
          combinedFormula(setup.technicalWeight),
        )}

        {rule(
          'Blind technical evaluation',
          scope('evaluation.blind_technical', setup.blindTechnical),
          <Toggle
            checked={setup.blindTechnical}
            onChange={(blindTechnical) => write({ blindTechnical })}
            label={setup.blindTechnical ? 'On — "Bidder A", not the company name' : 'Off — evaluators see company names'}
            disabled={blind.isLocked}
            disabledReason={blind.isLocked ? 'Set by tenant policy' : undefined}
          />,
          'Masked in the bidder list, the answers and exports. Attachment names that reveal a bidder are flagged, and so are answers that name themselves.',
        )}

        {rule(
          'Consensus',
          scope('evaluation.consensus_mode', setup.consensus),
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Segmented
              value={setup.consensus === 'MODERATED' ? 'MODERATED' : 'AVERAGE'}
              onChange={(consensus) => write({ consensus })}
              options={[
                { value: 'MODERATED', label: 'Moderated' },
                { value: 'AVERAGE', label: 'Averaged' },
              ]}
            />
            {setup.consensus === 'MODERATED' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                flag over
                <NumberInput
                  aria-label="Divergence threshold, as a share of the scale"
                  min={1}
                  max={100}
                  value={setup.divergenceThreshold}
                  onChange={(e) => write({ divergenceThreshold: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                  style={{ width: 64 }}
                />
                %
              </span>
            )}
          </div>,
          setup.consensus === 'MODERATED'
            ? `Evaluators score independently, without seeing each other's scores. Questions where they differ by more than ${setup.divergenceThreshold}% of the scale go to the lead evaluator first.`
            : 'Evaluators score independently; each question takes the average of their scores.',
        )}

        {twoEnvelope && facts.some((f) => opensPrice(f.kind)) && rule(
          'Opening the commercial envelope',
          scope(null, setup.unlockWitness),
          <Toggle
            checked={setup.unlockWitness}
            onChange={(unlockWitness) => write({ unlockWitness })}
            label={setup.unlockWitness ? 'Needs a witness' : 'One authorised user'}
          />,
          setup.unlockWitness
            ? 'Two authorised users confirm within 15 minutes, and both are recorded. Irreversible.'
            : 'One authorised user unlocks once every precondition is met. Irreversible, and recorded.',
        )}

        {rule(
          'Telling suppliers the technical result',
          scope(null, setup.notifyResult),
          <Segmented
            value={setup.notifyResult}
            onChange={(notifyResult) => write({ notifyResult })}
            options={[
              { value: 'AT_AWARD', label: 'At award' },
              { value: 'ON_PUBLISH', label: 'When published' },
            ]}
          />,
          setup.notifyResult === 'ON_PUBLISH'
            ? 'Suppliers who did not qualify hear as soon as the technical result is published.'
            : 'Suppliers hear whether they qualified with the award — nobody learns early that they are out.',
        )}
      </div>
    </section>
  );
}

/**
 * The scoring sheet as a technical evaluator will meet it: bidders on the
 * left, the question with its rubric beside the answer in the centre, the
 * criteria on the right. Commercial questions are not hidden here — they are
 * never handed to this view at all.
 */
function EvaluatorViewPreview({ fact, draft, bidderIds, onClose }: {
  fact: StageFacts;
  draft: Draft;
  bidderIds: string[];
  onClose: () => void;
}) {
  const setup = draft.evaluation;
  const label = STAGE_LABELS[fact.stage];
  const evaluators = setup.technicalEvaluators[fact.stage] ?? [];
  const [viewer, setViewer] = React.useState(evaluators[0] ?? '');
  const questions = [
    ...fact.questions.knockouts,
    ...fact.questions.scored.filter((q) => !fact.questions.knockouts.includes(q)),
  ];
  const weights = new Map(fact.questions.scored.map((q, i) => [q.id, shares(fact.questions.scored.map((s) => s.weight))[i]]));
  const [at, setAt] = React.useState(0);
  const [bidderAt, setBidderAt] = React.useState(0);
  const question = questions[Math.min(at, questions.length - 1)];
  const gate = gateOf(setup, fact.stage, fact.kind);
  const rubric = RUBRIC_SCALES.find((r) => r.id === gate.rubricId) ?? RUBRIC_SCALES[0];
  const bidders = (bidderIds.length > 0 ? bidderIds : ['b1', 'b2', 'b3']).map((id, i) => ({
    id,
    label: setup.blindTechnical
      ? `Bidder ${String.fromCharCode(65 + i)}`
      : COUNTERPARTIES.find((c) => c.id === id)?.name ?? `Bidder ${String.fromCharCode(65 + i)}`,
  }));
  const bidder = bidders[Math.min(bidderAt, bidders.length - 1)];
  const withheld = fact.questions.commercial.length;
  const pane: React.CSSProperties = { border: `1px solid ${color.border}`, borderRadius: radius.control, background: color.surface, minWidth: 0 };

  return (
    <Drawer
      open
      width={1080}
      title={`${label} scoring sheet — evaluator view`}
      subtitle="A preview. Answers appear here once suppliers have responded and the stage has closed."
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close preview</Button>}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        {evaluators.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
            <span style={{ color: color.textSecondary }}>Viewing as</span>
            <Segmented
              size="small"
              value={viewer}
              onChange={setViewer}
              options={evaluators.map((id) => ({ value: id, label: evaluatorName(id) }))}
            />
          </div>
        )}
        <ValidationBanner tone="info" title={`What ${viewer ? evaluatorName(viewer) : 'the evaluator'} sees`}>
          The technical envelope only. No price, price schedule or commercial attachment is sent to this view
          {withheld > 0 ? ` — the ${withheld} commercial ${withheld === 1 ? 'question' : 'questions'} at ${label} are withheld, not hidden` : ''}.
          {setup.blindTechnical ? ' Bidders are masked, here and in every export.' : ' Blind evaluation is off, so company names show.'}
          {' '}Other evaluators' scores stay hidden until everyone has submitted.
        </ValidationBanner>

        {questions.length === 0 ? (
          <Empty title={`Nothing at ${label} is scored or screened`} hint="Add scored questions or knockouts on the Questionnaire step." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) minmax(0, 1fr) minmax(170px, 220px)', gap: 10 }}>
            <div style={pane}>
              <div style={{ ...eyebrow, padding: '10px 12px 6px' }}>Bidders</div>
              {bidders.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBidderAt(i)}
                  className="block w-full text-left hover:bg-accent/50"
                  style={{
                    padding: '8px 12px', fontSize: 12.5,
                    background: i === bidderAt ? color.brandPrimarySoft : undefined,
                    borderTop: `1px solid ${color.border}`,
                  }}
                >
                  <span style={{ display: 'block', fontWeight: 600 }}>{b.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: color.textSecondary }}>0 of {questions.length} scored by you</span>
                </button>
              ))}
            </div>

            <div style={{ ...pane, padding: 14 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <Chip>{question.code}</Chip>
                <Chip>{question.askedPer === 'LINE' ? 'Per line' : 'Supplier'}</Chip>
                {question.isKnockout
                  ? <Chip tone="danger">Knockout</Chip>
                  : <Chip tone="brand">Weight {weights.get(question.id) ?? 0}%</Chip>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{question.title}</div>
              {question.helpText && <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>{question.helpText}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
                <div style={{ border: `1px solid ${color.brandPrimaryTint}`, background: color.brandPrimarySoft, borderRadius: radius.control, padding: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>Rubric</div>
                  {question.isKnockout ? (
                    <div style={{ fontSize: 12, lineHeight: 1.5 }}>Pass when {knockoutRule(question)}. Anything else fails.</div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                      {rubric.bands.map((band) => <li key={band}>{band}</li>)}
                    </ul>
                  )}
                  {question.rubric && !question.isKnockout && (
                    <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 6 }}>{question.rubric}</div>
                  )}
                </div>
                <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: 10 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>{bidder.label}'s answer</div>
                  <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.5 }}>
                    Appears here when the {label} closes.
                    {question.allowAttachment && ' Attachments open inline; a file name that reveals the bidder is flagged and can be shown redacted.'}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>Your score</div>
                {question.isKnockout ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Pass / Fail. A fail marks {bidder.label} <strong>Technically disqualified</strong> only after you
                    confirm, cites this question, and can be reversed with a reason.
                  </div>
                ) : question.scoringMethod === 'RULE' ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Scored automatically — {question.rubric ?? 'by the rule on the question'}. Shown read-only, with the rule that fired; an override needs a reason and is logged.
                  </div>
                ) : question.scoringMethod === 'AI_ASSISTED' ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    The agent proposes a score with its confidence and the exact passage that justifies it. Nothing is written until you accept, adjust or reject.
                  </div>
                ) : question.scoringMethod === 'AI_AUTO' ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    The agent writes the score with a badge; below its confidence threshold it comes to you instead. Overridable, with a reason.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {rubric.bands.map((band) => (
                      <span key={band} style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '5px 9px', fontSize: 12 }}>{band}</span>
                    ))}
                  </div>
                )}
                <Textarea aria-label="Comment" placeholder="Comment — why this score" disabled rows={2} style={{ marginTop: 10 }} />
              </div>
            </div>

            <div style={pane}>
              <div style={{ ...eyebrow, padding: '10px 12px 6px' }}>Criteria</div>
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setAt(i)}
                  className="flex w-full items-start justify-between gap-2 text-left hover:bg-accent/50"
                  style={{
                    padding: '7px 12px', fontSize: 12, borderTop: `1px solid ${color.border}`,
                    background: i === at ? color.brandPrimarySoft : undefined,
                  }}
                >
                  <span style={{ minWidth: 0 }}>{q.title}</span>
                  <span style={{ color: color.textSecondary, whiteSpace: 'nowrap' }}>
                    {q.isKnockout ? 'KO' : `${weights.get(q.id) ?? 0}%`}
                  </span>
                </button>
              ))}
              <div style={{ padding: '9px 12px', borderTop: `1px solid ${color.border}`, fontSize: 12 }}>
                Running score <strong>—</strong>
                <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
                  {usesScore(gate.gate) ? `Gate: ${gate.minScore} of 100` : `Gate: ${gateSummary(gate.gate, gate.minScore)}`}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** How a gate would have played out on the category's past events. */
function GateHistoryModal({ minScore, category, onClose }: {
  minScore: number; category: string; onClose: () => void;
}) {
  const passing = GATE_HISTORY.reduce((a, h) => a + wouldQualify(h.scores, minScore), 0);
  const total = GATE_HISTORY.reduce((a, h) => a + h.scores.length, 0);
  const columns: Column<typeof GATE_HISTORY[number]>[] = [
    { key: 'event', header: 'Event', render: (h) => <><strong style={{ fontWeight: 600 }}>{h.title}</strong><div style={{ fontSize: 11, color: color.textSecondary }}>{h.reference}</div></> },
    { key: 'gate', header: 'Gate used', numeric: true, render: (h) => h.gate },
    { key: 'then', header: 'Qualified then', numeric: true, render: (h) => `${wouldQualify(h.scores, h.gate)} of ${h.scores.length}` },
    { key: 'now', header: `At ${minScore}`, numeric: true, render: (h) => `${wouldQualify(h.scores, minScore)} of ${h.scores.length}` },
    { key: 'days', header: 'Days to evaluate', numeric: true, render: (h) => h.evaluationDays },
  ];
  return (
    <Modal open title={`Past ${category} bidders under a ${minScore} gate`} onClose={onClose} width={680}>
      <p style={{ margin: '0 0 10px', fontSize: 12.5 }}>
        At {minScore}, {passing} of {total} bidders across the last {GATE_HISTORY.length} events would have reached
        the next stage. Technical scores are as they were recorded; nothing is re-scored.
      </p>
      <Table columns={columns} rows={GATE_HISTORY} rowKey={(h) => h.reference} dense />
    </Modal>
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

/** The labels the steps use, so the review reads the way the choices were made. */
const ENVELOPE_LABEL: Record<EnvelopeMode, string> = {
  NONE: 'No envelope — nothing sealed, responses visible on arrival',
  SINGLE: 'Single envelope — technical and price opened together',
  TWO_ENVELOPE: 'Two envelopes — technical opened before price',
};
const GATE_LABEL: Record<GateKind, string> = {
  NONE: 'None', MIN_SCORE: 'Minimum score', PASS_FAIL: 'Pass / fail', BOTH: 'Minimum score and pass / fail',
};
const FEEDBACK_LABEL: Record<FeedbackPolicy, string> = {
  FULL_PRICE: 'Full price', BEST_PRICE: 'Best price', RANK_ONLY: 'Rank only',
  RANK_GAP: 'Rank + gap %', TRAFFIC_LIGHT: 'Traffic light', BLIND: 'Blind',
};

/**
 * The review, grouped by the step each value was set on.
 *
 * Every group carries an Edit that goes straight back to its step, so a
 * buyer who spots something wrong here does not have to remember where it
 * lives — and a group with something blocking publish says so in its header.
 */
function ReviewStep({
  draft, pattern, steps, estimatedValue, lotNames, schedule, blockers, evaluationRows, approvalChain,
  onRouteForApproval, onEdit,
}: {
  draft: Draft;
  pattern: string;
  steps: string[];
  estimatedValue: number;
  lotNames: string[];
  schedule: ReturnType<typeof stageWindows>;
  blockers: StepCheck[];
  evaluationRows: [string, React.ReactNode][];
  approvalChain: { level: number; role: string; holderName: string; slaHours: number }[];
  onRouteForApproval: (route: boolean) => void;
  onEdit: (step: string) => void;
}) {
  const notSet = <em style={{ color: color.textMuted }}>not set</em>;
  const all: { step: string; rows: [string, React.ReactNode][] }[] = [
    {
      step: 'Basics',
      rows: [
        ['Title', draft.title || notSet],
        ['Journey', pattern],
        ['Side', `${draft.side === 'BUY' ? 'Buy' : 'Sell'} — ${directionLabel(draft.side)}`],
        ['Category / BU', `${draft.category} · ${draft.businessUnit}`],
        ['Currency', draft.currency],
        ['Source requisition', draft.sourceReference || '—'],
      ],
    },
    {
      step: 'Items & Vendors',
      rows: [
        ['Lines / lots', `${draft.lines.length} lines across ${lotNames.length} lot(s)`],
        ['Estimated value', money(estimatedValue, draft.currency)],
        ['Suppliers', bidderSummary(draft)],
      ],
    },
    {
      step: 'Questionnaire',
      rows: [
        ['Questions', questionnaireSummary(draft)],
        ['Envelopes', solicitationStagesOf(draft.pattern).filter((st) => (ENVELOPE_STAGES as string[]).includes(st)).map((st) => `${st}: ${ENVELOPE_SHORT[envelopeFor(draft.envelopeByStage, st)]}`).join('  ·  ') || ENVELOPE_LABEL[draftEnvelope(draft)]],
      ],
    },
    // Terms are on the review because publish is blocked without them: seeing
    // what is attached here is what makes a blocking line legible.
    { step: 'Terms', rows: [['Documents', describeTerms(draft.terms)]] },
    { step: 'Evaluation', rows: evaluationRows },
    {
      step: 'Auction',
      rows: [
        ['Mechanism', mechanismLabel(draft.mechanism)],
        ['Bidders see', FEEDBACK_LABEL[draft.feedbackPolicy]],
        [`Minimum ${draft.side === 'BUY' ? 'decrement' : 'increment'}`, `${draft.minDecrement}%`],
        ['Soft close', draft.softClose ? 'On' : 'Off'],
      ],
    },
    {
      step: 'Timeline',
      rows: [
        ...schedule.map((w): [string, React.ReactNode] => [
          STAGE_LABELS[w.stage],
          `${shortDate(w.opensAt)} → ${shortDate(w.closesAt)}`,
        ]),
        ['Date changes', describeRules(draft.timelineRules)],
      ],
    },
  ];
  const groups = all.filter((g) => steps.includes(g.step));

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      {blockers.length > 0 ? (
        <ValidationBanner
          tone="error"
          title={`${blockers.length} ${blockers.length === 1 ? 'thing needs' : 'things need'} fixing before you can publish`}
        >
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {blockers.map((b, i) => (
              <li key={i}>
                {b.text}
                {b.step && (
                  <>
                    {' — '}
                    <LinkButton onClick={() => onEdit(b.step!)}>fix on {b.step}</LinkButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </ValidationBanner>
      ) : (
        <ValidationBanner tone="success" title="Everything required is in place">
          Publishing sends the invitations and locks the configuration onto the event, so it can be
          reconstructed exactly even if tenant settings change later.
        </ValidationBanner>
      )}

      <section style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, padding: '12px 13px' }} aria-label="Approval before publish">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            <strong style={{ fontSize: 12.5 }}>Approval before publish</strong>
            <span style={{ display: 'block', fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
              {approvalChain.length === 0
                ? 'No DoA rule matches this value, category and business unit, so the event publishes directly.'
                : `From the DoA matrix for ${money(estimatedValue, draft.currency)} in ${draft.category}. Approvers act on the Employee Portal; suppliers are invited only after the last level.`}
            </span>
          </span>
          {approvalChain.length > 0 && (
            <Toggle
              checked={draft.routeForApproval}
              onChange={onRouteForApproval}
              label={draft.routeForApproval ? 'Route for approval' : 'Publish directly'}
            />
          )}
        </div>
        {approvalChain.length > 0 && draft.routeForApproval && (
          <ol style={{ display: 'flex', gap: 8, flexWrap: 'wrap', listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
            {approvalChain.map((c) => (
              <li key={c.level}>
                <Chip tone="brand">{c.level}. {c.holderName} · {c.role} · {c.slaHours}h</Chip>
              </li>
            ))}
          </ol>
        )}
      </section>

      {groups.map((group) => {
        const issues = blockers.filter((b) => b.step === group.step).length;
        return (
          <section
            key={group.step}
            style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}
          >
            <header
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '8px 13px', background: color.rowAlt, borderBottom: `1px solid ${color.border}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 12.5 }}>{group.step}</strong>
                {issues > 0 && <Chip tone="danger" icon="✕">{issues} to fix</Chip>}
              </span>
              <LinkButton onClick={() => onEdit(group.step)} label={`Edit ${group.step}`}>Edit</LinkButton>
            </header>
            {group.rows.map(([label, value], i) => (
              <div
                key={label}
                className="rfx-defrow-wide"
                style={{
                  padding: '9px 13px', fontSize: 12.5,
                  borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                }}
              >
                <span style={{ color: color.textSecondary }}>{label}</span>
                <span style={{ fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard chrome
// ---------------------------------------------------------------------------

/** A readiness check, and the step the buyer goes to to settle it. */
type StepCheck = ValidationItem & {
  step?: string;
  /** The one action that settles it, where there is one. */
  fix?: { label: string; run: () => void };
};

type StepState = 'current' | 'done' | 'todo' | 'blocked' | 'warning';

/** One line under each step's heading, so nobody has to guess what a step is for. */
const STEP_PURPOSE: Record<string, string> = {
  Basics: 'Name the event and choose how it runs.',
  'Items & Vendors': 'What is being sourced, and which suppliers are asked to price each line.',
  Questionnaire: 'What suppliers must answer alongside their price.',
  Terms: 'The conditions suppliers accept before they respond.',
  Evaluation: 'How responses are screened before price is compared.',
  Auction: 'How the live auction runs and what bidders get to see.',
  Timeline: 'When each ask opens and closes, and the rules for moving those dates.',
  Review: 'Check everything once more. Publishing sends the invitations.',
};

function shortDate(at: number): string {
  return new Date(at).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function LinkButton({ children, onClick, label }: {
  children: React.ReactNode; onClick: () => void; label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-sm text-[12px] font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** The second line under each step in the stepper. */
const STEP_SUBTITLE: Record<string, string> = {
  Basics: 'Details & pattern',
  'Items & Vendors': 'Lines & suppliers',
  Questionnaire: 'Questions & weights',
  Terms: 'Contract terms',
  Evaluation: 'Scoring & gates',
  Auction: 'Bidding rules',
  Timeline: 'Key dates',
  Review: 'Validate & publish',
};

const STEP_MARK: Record<StepState, { fg: string; bg: string; border: string; note: string }> = {
  current: { fg: '#fff', bg: color.brandPrimary, border: color.brandPrimary, note: 'In progress' },
  done: { fg: color.successText, bg: color.successSoft, border: '#BBF7D0', note: 'Done' },
  todo: { fg: color.textSecondary, bg: color.surface, border: color.borderStrong, note: 'Not started' },
  blocked: { fg: color.dangerText, bg: color.dangerSoft, border: '#FECACA', note: 'Needs fixing' },
  warning: { fg: color.warningText, bg: color.warningSoft, border: '#FDE68A', note: 'Worth a look' },
};

/**
 * Where the buyer is, where they have been, and what is still wrong.
 *
 * Every step is reachable, forward as well as back: the draft is one object,
 * so jumping ahead loses nothing. A step's state is carried by its mark and
 * its words — a fixed step reads "1 to fix" rather than relying on red alone.
 */
function WizardProgress({
  steps, status, issueCount, onGo, note,
}: {
  steps: string[];
  status: (step: string) => StepState;
  issueCount: (step: string) => number;
  onGo: (index: number) => void;
  note: string;
}) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <ol
        className="rfx-scroll-x"
        aria-label="Steps"
        style={{
          listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4,
          gridTemplateColumns: `repeat(${steps.length}, minmax(124px, 1fr))`,
        }}
      >
        {steps.map((step, i) => {
          const state = status(step);
          const mark = STEP_MARK[state];
          const issues = issueCount(step);
          const glyph = state === 'done' ? '✓' : state === 'blocked' ? '!' : String(i + 1);
          const sub = state === 'blocked' && issues > 0 ? `${issues} to fix` : STEP_SUBTITLE[step] ?? '';
          return (
            <li key={step} style={{ minWidth: 0 }}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${step} — ${mark.note}`}
                className="flex w-full items-start gap-2.5 rounded-md text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ padding: '6px 6px' }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 600, background: mark.bg, color: mark.fg,
                    border: `1px solid ${mark.border}`,
                  }}
                >
                  {glyph}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block', fontSize: 12.5, fontWeight: 600,
                      color: state === 'current' ? color.brandPrimaryStrong : color.textPrimary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {step}
                  </span>
                  <span
                    style={{
                      display: 'block', fontSize: 11.5,
                      color: state === 'blocked' ? color.dangerText : color.textSecondary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {sub}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div style={{ fontSize: 11.5, color: color.textSecondary, margin: '6px 6px 0' }}>{note}</div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase',
  color: color.textSecondary,
};

/** What a stage does, in the words a buyer would use. */
const STAGE_PURPOSE: Record<string, string> = {
  INTAKE: 'Basics, items, terms',
  RFI: 'Information from the market',
  RFP: 'Proposals & approach',
  RFQ: 'Invite, Q&A, quotes',
  CLARIFICATION: 'Questions & answers',
  EVALUATION: 'Lowest wins, or your rule',
  NEGOTIATION: 'Best and final offers',
  AUCTION: 'Live bidding',
  AWARD: 'Award & contract',
  APPROVAL: 'Sign-off',
};

/** The journey the event will run, kept in view on every step. */
function SelectedPatternCard({
  name, description, stages, inputPoints, stepCount, duration, side, onChange,
}: {
  name: string; description: string; stages: readonly string[]; inputPoints: readonly string[];
  stepCount: number; duration: string; side: Side; onChange: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={eyebrow}>Selected pattern</span>
        <LinkButton onClick={onChange} label="Change the journey pattern">Change</LinkButton>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>{name}</div>
      <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 3, lineHeight: 1.5 }}>{description}</div>
      <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }} className="rfx-stack">
        {stages.map((stage, i) => (
          <li key={stage} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10 }}>
            <span
              aria-hidden
              style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                background: color.brandPrimarySoft, color: color.brandPrimary,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
              }}
            >
              {i + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 600 }}>
                {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage}
                {inputPoints.includes(stage) && <Chip tone="brand">suppliers respond</Chip>}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary }}>
                {STAGE_PURPOSE[stage] ?? ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip>{stepCount} steps</Chip>
        <Chip>~{duration}</Chip>
        <Chip>{side === 'BUY' ? 'Buy side' : 'Sell side'}</Chip>
      </div>
    </section>
  );
}

/**
 * Readiness, from where the buyer stands: what this step still needs, then
 * where every other step is before publish. On Basics that is the required
 * fields themselves; elsewhere it is the checks that step answers for.
 */
function StepReadinessCard({
  steps, current, fields, checks, status, issueCount, onGo,
}: {
  steps: string[];
  current: number;
  fields: { label: string; done: boolean; required: boolean }[] | null;
  checks: StepCheck[];
  status: (step: string) => StepState;
  issueCount: (step: string) => number;
  onGo: (step: string) => void;
}) {
  const required = fields?.filter((f) => f.required) ?? checks;
  const complete = fields
    ? required.filter((f) => (f as { done: boolean }).done).length
    : checks.filter((c) => !c.blocking && c.tone !== 'error').length;
  const total = required.length;
  const percent = total === 0 ? 100 : Math.round((complete / total) * 100);
  const allDone = complete === total;
  const others = steps.filter((s, i) => i !== current && s !== 'Review');

  const tick = (done: boolean, tone: 'ok' | 'bad' | 'warn' | 'todo') => (
    <span
      aria-hidden
      style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: done ? 'none' : `1.5px solid ${tone === 'bad' ? color.danger : tone === 'warn' ? color.warning : color.borderStrong}`,
        color: done ? color.successText : tone === 'bad' ? color.dangerText : color.warningText,
        fontSize: 10, fontWeight: 700,
      }}
    >
      {done ? <Icon name="check" size={14} stroke={2.4} /> : tone === 'bad' ? '!' : ''}
    </span>
  );

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Readiness</span>
        <span style={{ fontSize: 11.5, color: color.textSecondary }}>Step {current + 1} of {steps.length}</span>
      </div>
      <div
        role="progressbar"
        aria-label="This step's readiness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ height: 5, borderRadius: 999, background: color.rowAlt, overflow: 'hidden', marginTop: 10 }}
      >
        <div style={{ width: `${percent}%`, height: '100%', background: allDone ? color.brandPrimary : color.warning }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, marginTop: 8, color: allDone ? color.successText : color.warningText }}>
        {total === 0
          ? 'Nothing on this step blocks publishing'
          : `${complete} of ${total} ${fields ? 'required fields' : 'checks'} complete on this step`}
      </div>

      <ul className="rfx-stack" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, gap: 7 }}>
        {fields
          ? fields.map((f) => (
            <li key={f.label} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: f.done || f.required ? color.textBody : color.textSecondary }}>
              {tick(f.done, f.required ? 'bad' : 'todo')}
              {f.label}
            </li>
          ))
          : checks.map((c, i) => {
            const ok = !c.blocking && c.tone !== 'error' && c.tone !== 'warning';
            return (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: c.blocking ? color.dangerText : color.textBody }}>
                {tick(ok, c.blocking ? 'bad' : 'warn')}
                <span style={{ minWidth: 0 }}>
                  {c.text}
                  {c.fix && (
                    <>
                      {' — '}
                      <LinkButton onClick={c.fix.run}>{c.fix.label}</LinkButton>
                    </>
                  )}
                </span>
              </li>
            );
          })}
      </ul>

      {others.length > 0 && (
        <>
          <div style={{ ...eyebrow, marginTop: 16, marginBottom: 8 }}>Before you can publish</div>
          <ul className="rfx-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 7 }}>
            {others.map((name) => {
              const state = status(name);
              const issues = issueCount(name);
              const index = steps.indexOf(name) + 1;
              const words = state === 'blocked' ? `${issues} to fix`
                : state === 'warning' ? 'worth a look'
                  : state === 'done' ? 'done' : 'not started';
              return (
                <li key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}>
                  {tick(state === 'done', state === 'blocked' ? 'bad' : state === 'warning' ? 'warn' : 'todo')}
                  <button
                    type="button"
                    onClick={() => onGo(name)}
                    className="flex-1 rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {name}
                  </button>
                  <span style={{ fontSize: 11, color: state === 'blocked' ? color.dangerText : color.textSecondary, whiteSpace: 'nowrap' }}>
                    Step {index} · {words}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The intake assistant, on the step it can help with. Each action does what
 * it says on the screen, and says why when it cannot.
 */
function AssistantCard({ pattern, recommended, category, insight, actions }: {
  pattern: string;
  recommended: string | null;
  category: string;
  /** The reasoning behind what this step proposes, with the evidence it rests on. */
  insight?: AssistantInsight;
  actions: { icon: AdminIconName; label: string; run: () => void; disabledReason?: string }[];
}) {
  const [why, setWhy] = React.useState(false);
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 28, height: 28, borderRadius: 7, background: color.brandPrimarySoft, color: color.brandPrimary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="sparkle" size={15} />
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>AI RFX Assistant</div>
          <div style={{ fontSize: 11, color: color.successText }}>● Online</div>
        </div>
      </div>

      {insight && (
        <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '10px 12px', marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>{insight.title}</div>
          {insight.body}
          {insight.evidence.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <LinkButton onClick={() => setWhy((v) => !v)}>{why ? 'Hide the evidence' : insight.evidenceLabel}</LinkButton>
            </div>
          )}
          {why && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: color.textSecondary }}>
              {insight.evidence.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
      )}

      {!insight && recommended && (
        <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '10px 12px', marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Why {recommended}</div>
          This requisition matches 6 prior events in {category}. {recommended} closed those in
          about 3 days at a 4.1% average saving
          {pattern === recommended ? '.' : `; ${pattern} adds rounds the category hasn't needed.`}
          <div style={{ marginTop: 6 }}>
            <LinkButton onClick={() => setWhy((v) => !v)}>{why ? 'Hide the evidence' : 'See the evidence'}</LinkButton>
          </div>
          {why && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: color.textSecondary }}>
              <li>PR-2024-0125 — 2 lines, 12,900 units, indicative ₹1,50,000</li>
              <li>6 prior events in {category}, last 18 months</li>
              <li>{recommended} is the category default in Configuration Studio</li>
            </ul>
          )}
        </div>
      )}

      <div style={{ ...eyebrow, marginTop: 14, marginBottom: 8 }}>On this step I can</div>
      <div className="rfx-stack" style={{ gap: 8 }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={Boolean(action.disabledReason)}
            onClick={action.run}
            title={action.disabledReason}
            className="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden style={{ color: color.textSecondary, marginTop: 1 }}><Icon name={action.icon} size={14} /></span>
            <span>
              {action.label}
              {action.disabledReason && (
                <span style={{ display: 'block', fontSize: 11, color: color.textSecondary }}>{action.disabledReason}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Pick a consolidated requisition to raise this event against. */
function LinkRequisitionDrawer({ open, onClose, onPick, onOpenWorkbench, linkedId }: {
  open: boolean;
  onClose: () => void;
  onPick: (requisition: SourcingRequisition) => void;
  onOpenWorkbench: () => void;
  linkedId?: string;
}) {
  const { state } = useStore();
  const available = state.sourcingRequisitions.filter((r) => r.eventId === null);
  return (
    <Drawer
      open={open}
      title="Link a purchase requisition"
      subtitle="Linking copies the requisition's lines, category, cost centre and currency. Your title, pattern and documents stay as they are."
      onClose={onClose}
      width={480}
    >
      {available.length === 0 ? (
        <Empty
          title="No requisitions waiting to be sourced"
          hint="Requisition lines are consolidated in the PR Workbench. Your draft is saved, so you can come straight back."
          action={<Button variant="primary" onClick={onOpenWorkbench}>Open PR Workbench</Button>}
        />
      ) : (
        <ul className="rfx-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
          {available.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="w-full rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={r.id === linkedId ? { borderColor: color.brandPrimary, background: color.brandPrimarySoft } : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{r.prdNumber}</strong>
                  {r.id === linkedId && <Chip tone="brand">Linked</Chip>}
                </div>
                <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
                  {r.category} · {r.lineIds.length} lines from {r.requestNumbers.join(', ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// The saved draft
// ---------------------------------------------------------------------------

/**
 * One draft per browser, kept in local storage. The event does not exist on
 * the server until it is published, so this is where "Save & close" keeps it.
 */
const SAVED_DRAFT_KEY = 'rfx.createEvent.draft';

interface SavedDraft {
  draft: Draft;
  step: number;
  savedAt: number;
  requisitionId: string | null;
}

function readSavedDraft(): SavedDraft | null {
  try {
    const raw = window.localStorage.getItem(SAVED_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SavedDraft) : null;
  } catch {
    return null;
  }
}

function writeSavedDraft(saved: SavedDraft): boolean {
  try {
    window.localStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

function clearSavedDraft() {
  try {
    window.localStorage.removeItem(SAVED_DRAFT_KEY);
  } catch {
    // Nothing was saved, or storage is unavailable — either way nothing to clear.
  }
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A first description from what is already on the draft, for the buyer to edit. */
function draftDescription(draft: Draft): string {
  const items = draft.lines.slice(0, 3).map((l) => l.description.toLowerCase());
  const more = draft.lines.length > 3 ? `, and ${draft.lines.length - 3} more` : '';
  const sites = [...new Set(draft.lines.map((l) => l.deliveryLocation).filter(Boolean))];
  return [
    `${draft.title.trim() || 'This event'} — ${draft.category}.`,
    draft.lines.length > 0 ? `We are sourcing ${items.join('; ')}${more}.` : '',
    sites.length > 0 ? `Delivery to ${sites.join(', ')}.` : '',
    'Please quote against the attached specification, and state your lead time and how long your price is valid.',
  ].filter(Boolean).join(' ');
}

/**
 * Auto-fix, offered wherever something blocks: fix this step, or fix every
 * step at once. After a run it lists what changed — grouped by step — with an
 * undo, and anything still blocking that needs the buyer's own decision.
 */
function AutoFixBar({
  report, stepName, stepIssues, showAll, allIssues, fixableSteps, remaining, onFixStep, onFixAll, onUndo, onDismiss, onGo,
}: {
  report: { changes: AutoFixChange[]; scope: string } | null;
  stepName: string;
  stepIssues: number;
  showAll: boolean;
  allIssues: number;
  fixableSteps: string[];
  remaining: StepCheck[];
  onFixStep: () => void;
  onFixAll: () => void;
  onUndo: () => void;
  onDismiss: () => void;
  onGo: (step: string) => void;
}) {
  if (report) {
    const byStep = new Map<string, string[]>();
    for (const c of report.changes) byStep.set(c.step, [...(byStep.get(c.step) ?? []), c.text]);
    const left = report.scope === 'all steps' ? remaining : remaining.filter((r) => r.step === report.scope);
    const nothing = report.changes.length === 0;
    return (
      <ValidationBanner
        tone={nothing ? 'warning' : left.length > 0 ? 'warning' : 'success'}
        title={nothing
          ? `Nothing on ${report.scope} could be fixed automatically`
          : `Auto-fix made ${report.changes.length} change${report.changes.length === 1 ? '' : 's'} on ${report.scope}${left.length === 0 ? ' — nothing blocks now' : ''}`}
        action={(
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            {!nothing && <LinkButton onClick={onUndo}>Undo</LinkButton>}
            <LinkButton onClick={onDismiss}>Dismiss</LinkButton>
          </div>
        )}
      >
        {[...byStep.entries()].map(([step, texts]) => (
          <div key={step} style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 600 }}>{step}</div>
            <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
              {texts.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        ))}
        {left.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 600, color: color.dangerText }}>Still needs you</div>
            <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
              {left.map((r, i) => (
                <li key={i}>
                  {r.text}
                  {r.step && r.step !== stepName && <>{' '}<LinkButton onClick={() => onGo(r.step!)}>Open {r.step}</LinkButton></>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ValidationBanner>
    );
  }
  if (stepIssues === 0 && !(showAll && allIssues > 0)) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 14px', borderRadius: radius.card,
        border: `1px solid ${color.border}`, background: color.surface,
      }}
    >
      <span aria-hidden style={{ fontSize: 16, color: color.accentPurpleText }}>✦</span>
      <div style={{ flex: 1, minWidth: 220, fontSize: 12.5 }}>
        <strong>
          {stepIssues > 0
            ? `${stepIssues} issue${stepIssues === 1 ? '' : 's'} on ${stepName} can be fixed for you`
            : `${allIssues} issue${allIssues === 1 ? '' : 's'} elsewhere block publishing`}
        </strong>
        <div style={{ color: color.textSecondary, marginTop: 2 }}>
          Auto-fix applies the fix each rule asks for — suggested choices, section shares rescaled to 100%, the missing terms, evaluators from the panel — and lists every change so you can undo it.
        </div>
      </div>
      {stepIssues > 0 && <Button variant="primary" onClick={onFixStep}>Auto-fix this step</Button>}
      {fixableSteps.length > (stepIssues > 0 ? 1 : 0) && (
        <Button variant={stepIssues > 0 ? 'secondary' : 'primary'} onClick={onFixAll}>
          Auto-fix all steps ({allIssues})
        </Button>
      )}
    </div>
  );
}
