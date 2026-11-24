/**
 * AG-03, Questionnaire Builder — the agent that drafts questions for a
 * category, and the interview it runs to find out what to draft.
 *
 * Its mandate is already in the catalogue: *draft questions from the category
 * and template library*, maximum autonomy **DRAFT**, and it **cannot publish a
 * questionnaire**. Everything here is built to that line. The agent proposes;
 * every proposal is accepted or rejected by the buyer one at a time; nothing
 * reaches a template without that decision. `applyAccepted` is the only way out
 * of this module and it takes decisions, not proposals.
 *
 * ## Where the suggestions come from
 *
 * Three sources, and a proposal always says which one it is, because a
 * suggestion a buyer cannot interrogate is one they accept blindly or reject
 * blindly — and both are worse than no suggestion.
 *
 * 1. **Market practice** — a curated corpus of what a competent buyer asks in
 *    this category, in `data/procurementCategories`. This is the agent's prior.
 * 2. **The library** — the questions this organisation has already written for
 *    this category. Retrieval over real records: a code that recurs across
 *    templates is house practice, and the proposal cites the template it came
 *    from. This is the RAG half, and it is genuinely retrieval rather than a
 *    label on a guess.
 * 3. **The workspace** — what the dashboard can actually see. A knockout that
 *    has disqualified somebody, a question nobody answered, an ask closing with
 *    no questionnaire. These are computed from events, responses and scores,
 *    not asserted.
 *
 * ## What this is not
 *
 * There is no language model behind it. The agent retrieves, ranks and
 * explains from tables; the wording of a proposed question is the wording in
 * the corpus or in the library, not prose it wrote. That is a deliberate
 * boundary for a prototype — a fabricated question that reads plausibly is
 * worse than no question, because a buyer cannot tell the difference. Where a
 * model would go is `rankProposals`, which would become a re-ranker, and
 * `nextProbe`, which would become the conversation. The interfaces here are the
 * ones it would have to satisfy.
 */
import {
  BUYER_CONCERNS, MARKET_PRACTICE as CATEGORY_PRACTICE, practiceFor, type PracticeQuestion,
} from '../data/procurementCategories';
import { defaultConfigFor } from './questionTypes';
import type {
  Id, Question, Questionnaire, QuestionnaireTemplate, Response, Score, SourcingEvent,
  TemplateQuestion, VendorInputPoint,
} from './types';

export const QUESTIONNAIRE_AGENT = 'AG-03';

// ---------------------------------------------------------------------------
// The brief the interview fills in
// ---------------------------------------------------------------------------

export type SpendBand = 'LOW' | 'MID' | 'HIGH';

export interface AgentBrief {
  categories: string[];
  point: VendorInputPoint;
  /** Which of `BUYER_CONCERNS` matter here. Drives the ranking. */
  concerns: string[];
  spend: SpendBand | null;
  /** Whether an incumbent is being retendered — changes what is worth asking. */
  incumbent: boolean | null;
  /** Anything the buyer typed that no probe asked for. */
  notes: string[];
}

export const emptyBrief = (categories: string[], point: VendorInputPoint): AgentBrief => ({
  categories, point, concerns: [], spend: null, incumbent: null, notes: [],
});

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

export interface ProbeChoice {
  id: string;
  label: string;
  blurb?: string;
}

export interface Probe {
  id: 'concerns' | 'spend' | 'incumbent' | 'notes';
  /** What the agent says. */
  question: string;
  /** Why it is asking. Shown under the question, never hidden behind a tooltip. */
  because: string;
  choices: ProbeChoice[];
  multi: boolean;
  /** Whether the buyer may skip it. The agent can draft without any of these. */
  optional: boolean;
}

const PROBES: Probe[] = [
  {
    id: 'concerns',
    question: 'What are you actually trying to find out about these suppliers?',
    because: 'It decides which questions earn their place. A questionnaire that asks everything scores nothing, because every answer is diluted by the ones that did not matter.',
    choices: BUYER_CONCERNS.map((concern) => ({
      id: concern.id, label: concern.label, blurb: concern.blurb,
    })),
    multi: true,
    optional: false,
  },
  {
    id: 'spend',
    question: 'Roughly what is this worth over the contract term?',
    because: 'It sets how much to ask for. A supplier will not write a continuity plan for a small order, and asking anyway loses you the ones who had better things to do.',
    choices: [
      { id: 'LOW', label: 'Under ₹25 lakh', blurb: 'Keep it short — qualification only.' },
      { id: 'MID', label: '₹25 lakh to ₹5 crore', blurb: 'A full technical set is proportionate.' },
      { id: 'HIGH', label: 'Over ₹5 crore', blurb: 'Worth asking for evidence and continuity.' },
    ],
    multi: false,
    optional: true,
  },
  {
    id: 'incumbent',
    question: 'Is there an incumbent being retendered here?',
    because: 'It changes what is worth asking. With an incumbent you already know the answers to half of these, and the questions that matter are the ones about transition.',
    choices: [
      { id: 'YES', label: 'Yes, there is an incumbent' },
      { id: 'NO', label: 'No, this is a new requirement' },
    ],
    multi: false,
    optional: true,
  },
  {
    id: 'notes',
    question: 'Anything specific to this requirement I should ask about?',
    because: 'Market practice is the floor, not the ceiling. If there is a constraint particular to this buy, it will not be in any corpus.',
    choices: [],
    multi: false,
    optional: true,
  },
];

/**
 * The next thing the agent needs to know, or null when it can draft.
 *
 * One at a time, rather than a form. A form asks everything at once and gets
 * the first three answers thought about and the rest guessed; and the later
 * probes are only worth asking because of how the earlier ones were answered.
 */
export function nextProbe(brief: AgentBrief, answered: string[]): Probe | null {
  for (const probe of PROBES) {
    if (answered.includes(probe.id)) continue;
    if (probe.id === 'concerns' && brief.concerns.length > 0) continue;
    return probe;
  }
  return null;
}

/** Whether the agent has enough to draft something worth reading. */
export const canDraft = (brief: AgentBrief): boolean =>
  brief.categories.length > 0 && brief.concerns.length > 0;

/** Record one answer. Pure — the panel holds the transcript. */
export function answerProbe(brief: AgentBrief, probeId: Probe['id'], value: string[]): AgentBrief {
  switch (probeId) {
    case 'concerns': return { ...brief, concerns: value };
    case 'spend': return { ...brief, spend: (value[0] as SpendBand) ?? null };
    case 'incumbent': return { ...brief, incumbent: value[0] === undefined ? null : value[0] === 'YES' };
    case 'notes': return { ...brief, notes: value.filter((note) => note.trim() !== '') };
  }
}

// ---------------------------------------------------------------------------
// Retrieval — what this organisation has already done
// ---------------------------------------------------------------------------

export interface LibraryHit {
  code: string;
  title: string;
  /** Templates that ask it, by code — the citation shown to the buyer. */
  usedBy: string[];
  question: TemplateQuestion;
}

/**
 * Questions this organisation already asks in these categories.
 *
 * Ranked by how many templates use a code, because a code that recurs is house
 * practice rather than one buyer's preference — and reusing the exact code is
 * what lets an answer given at RFI carry forward to RFP.
 */
export function libraryHits(
  library: QuestionnaireTemplate[], categories: string[], point: VendorInputPoint,
): LibraryHit[] {
  const relevant = library.filter(
    (template) =>
      template.status !== 'RETIRED' &&
      template.appliesTo.includes(point) &&
      (template.categories.length === 0
        || template.categories.some((category) => categories.includes(category))),
  );

  const byCode = new Map<string, LibraryHit>();
  for (const template of relevant) {
    for (const question of template.questions) {
      const hit = byCode.get(question.code);
      if (hit) {
        if (!hit.usedBy.includes(template.code)) hit.usedBy.push(template.code);
      } else {
        byCode.set(question.code, {
          code: question.code,
          title: question.title,
          usedBy: [template.code],
          question,
        });
      }
    }
  }

  return Array.from(byCode.values())
    .sort((a, b) => b.usedBy.length - a.usedBy.length || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Retrieval — what the workspace can see
// ---------------------------------------------------------------------------

export interface WorkspaceSignal {
  id: string;
  /** What the agent observed, in the buyer's terms. */
  observation: string;
  /** The question code it argues for, where it argues for one. */
  code: string | null;
  strength: number;
}

/**
 * What the dashboard knows that a corpus cannot.
 *
 * Every one of these is computed from records this workspace holds — events,
 * invitations, responses, scores. None is asserted, and an observation with
 * nothing behind it is simply absent rather than hedged.
 */
export function workspaceSignals({
  categories, events, questionnaires, responses, scores,
}: {
  categories: string[];
  events: SourcingEvent[];
  questionnaires: Questionnaire[];
  responses: Response[];
  scores: Score[];
}): WorkspaceSignal[] {
  const signals: WorkspaceSignal[] = [];
  /**
   * An event counts as "in this category" if its header says so **or** if any
   * of its questionnaires was written for the category.
   *
   * The header carries one category and a consolidated event buys in several,
   * so matching on the header alone found nothing for the categories that only
   * exist on the basket — which is exactly the case the agent is most useful
   * in.
   */
  const askedInCategory = questionnaires.filter(
    (questionnaire) => questionnaire.category !== null
      && questionnaire.category !== undefined
      && categories.includes(questionnaire.category),
  );
  const fromBasket = new Set(askedInCategory.map((questionnaire) => questionnaire.eventId));
  const inCategory = events.filter(
    (event) => categories.includes(event.category) || fromBasket.has(event.id),
  );
  const eventIds = new Set(inCategory.map((event) => event.id));
  const asked = questionnaires.filter(
    (questionnaire) => eventIds.has(questionnaire.eventId)
      && (questionnaire.category === null
        || questionnaire.category === undefined
        || categories.includes(questionnaire.category)),
  );
  const questions = asked.flatMap((questionnaire) => questionnaire.questions);

  if (inCategory.length > 0) {
    signals.push({
      id: 'history',
      observation: `${inCategory.length} event${inCategory.length === 1 ? '' : 's'} in ${categories.join(' / ')} in this workspace, so the questions below are what this organisation has actually been asking.`,
      code: null,
      strength: 0.4,
    });
  }

  // A knockout that has actually knocked somebody out has earned its place.
  const zeroScored = new Set(
    scores.filter((score) => score.value <= 0).map((score) => score.questionId),
  );
  for (const question of questions) {
    if (!question.isKnockout || !zeroScored.has(question.id)) continue;
    if (signals.some((signal) => signal.code === question.code)) continue;
    signals.push({
      id: `knockout-${question.code}`,
      observation: `"${question.title}" has failed at least one supplier in this category, so it is doing work rather than sitting there.`,
      code: question.code,
      strength: 0.9,
    });
  }

  // A question nobody answers is one that costs the supplier more than it
  // tells the buyer. Worth saying before it is copied into another template.
  // Scoped to the events in this category. Judging a logistics question by
  // whether stationery bidders answered it is not evidence, it is a join bug:
  // they were never asked it, so of course they did not answer.
  const submitted = responses.filter(
    (response) => response.submittedAt !== null && eventIds.has(response.eventId),
  );
  if (submitted.length >= 2) {
    const answeredIds = new Set(
      submitted.flatMap((response) =>
        response.answers
          .filter((answer) => answer.value !== null && answer.value !== '')
          .map((answer) => answer.questionId)),
    );
    for (const question of questions) {
      if (!question.isRequired || answeredIds.has(question.id)) continue;
      if (signals.some((signal) => signal.code === question.code)) continue;
      signals.push({
        id: `unanswered-${question.code}`,
        observation: `No supplier has answered "${question.title}" in this category, across ${submitted.length} submissions. Worth rewording before asking it again.`,
        code: question.code,
        strength: -0.6,
      });
    }
  }

  const openWithoutQuestions = inCategory.filter(
    (event) => event.status === 'OPEN'
      && event.vendorInputPoints.length > 0
      && !asked.some((questionnaire) => questionnaire.eventId === event.id),
  );
  if (openWithoutQuestions.length > 0) {
    signals.push({
      id: 'open-unasked',
      observation: `${openWithoutQuestions.length} open ask${openWithoutQuestions.length === 1 ? '' : 's'} in this category ${openWithoutQuestions.length === 1 ? 'has' : 'have'} no questionnaire attached — ${openWithoutQuestions.map((event) => event.eventNumber).join(', ')}.`,
      code: null,
      strength: 0.3,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export type ProposalSource = 'MARKET_PRACTICE' | 'LIBRARY' | 'WORKSPACE';

export interface AgentProposal {
  id: string;
  code: string;
  title: string;
  helpText: string;
  type: TemplateQuestion['type'];
  envelope: TemplateQuestion['envelope'];
  scoringMethod: TemplateQuestion['scoringMethod'];
  weight: number;
  isKnockout: boolean;
  allowAttachment: boolean;
  rubric: string | null;
  /** The section the agent would file it under. Created if it does not exist. */
  section: string;
  source: ProposalSource;
  /** Why this question, in the buyer's terms. Always present. */
  rationale: string;
  /** The template or record it came from, where there is one. */
  citation: string | null;
  /** 0–1. Shown, and used for nothing else — the buyer decides. */
  confidence: number;
}

export type Decision = 'PENDING' | 'ACCEPTED' | 'REJECTED';

/**
 * Draft a set of questions for this brief.
 *
 * Ranking is explicit rather than learned: a question that serves a concern the
 * buyer named outranks one that does not, the library beats the corpus where
 * both have the same code because house wording is what answers carry forward
 * against, and a workspace signal can push a question up or drop it entirely.
 */
export function proposeQuestions({
  brief, library, signals, existingCodes = [],
}: {
  brief: AgentBrief;
  library: QuestionnaireTemplate[];
  signals: WorkspaceSignal[];
  /** Codes already in the questionnaire. The agent never proposes a duplicate. */
  existingCodes?: string[];
}): AgentProposal[] {
  if (!canDraft(brief)) return [];

  const already = new Set(existingCodes);
  const hits = libraryHits(library, brief.categories, brief.point);
  const hitByCode = new Map(hits.map((hit) => [hit.code, hit]));
  const signalByCode = new Map(
    signals.filter((signal) => signal.code !== null).map((signal) => [signal.code as string, signal]),
  );

  const proposals: AgentProposal[] = [];
  const seen = new Set<string>(already);

  /**
   * How much the buyer's stated concerns support this question, 0 to 1.
   *
   * Zero means it serves nothing they asked about and is not proposed at all.
   * The fraction matters rather than the count: a question that serves one
   * concern and hits it is a better fit than one that claims three and hits
   * one.
   */
  const concernFit = (serves: string[]): number => {
    if (serves.length === 0) return 0.3;
    const matched = serves.filter((concern) => brief.concerns.includes(concern)).length;
    return matched === 0 ? 0 : matched / serves.length;
  };

  /**
   * Whether this is category knowledge or general good practice.
   *
   * Worth separating in the confidence, because "every buyer asks for
   * insurance" is a weaker reason to put a question in *this* questionnaire
   * than "buyers in this category ask about pallet pooling".
   */
  const categorySpecific = new Set(
    brief.categories.flatMap((category) =>
      (CATEGORY_PRACTICE[category] ?? []).map((question) => question.code)),
  );

  /** The spend band gates how much evidence it is reasonable to ask for. */
  const proportionate = (question: PracticeQuestion): boolean => {
    if (brief.spend !== 'LOW') return true;
    // A small order does not justify documents and plans.
    return !(question.type === 'file_upload' || question.code === 'GEN.CONTINUITY');
  };

  for (const question of practiceFor(brief.categories)) {
    if (seen.has(question.code)) continue;
    if (!question.appliesTo.includes(brief.point)) continue;
    if (!proportionate(question)) continue;

    const fit = concernFit(question.serves);
    if (fit === 0) continue;

    const signal = signalByCode.get(question.code);
    // A question nobody answers is dropped rather than proposed with a caveat:
    // the buyer asked for suggestions, not for a list to audit.
    if (signal !== undefined && signal.strength < 0) continue;

    const hit = hitByCode.get(question.code);
    seen.add(question.code);

    if (hit !== undefined) {
      proposals.push({
        id: `p-${question.code}`,
        code: question.code,
        title: hit.question.title,
        helpText: hit.question.helpText,
        type: hit.question.type,
        envelope: hit.question.envelope,
        scoringMethod: hit.question.scoringMethod,
        weight: hit.question.weight,
        isKnockout: hit.question.isKnockout,
        allowAttachment: hit.question.allowAttachment,
        rubric: hit.question.rubric,
        section: question.section,
        source: 'LIBRARY',
        rationale: `You already ask this in ${hit.usedBy.join(', ')}. Reusing the code is what carries an answer given at one stage into the next, so I have kept your wording rather than the market's.`,
        citation: hit.usedBy.join(', '),
        // Reuse is the strongest signal there is: it is this organisation's
        // own wording, already agreed, and the code carries answers forward.
        confidence: Math.min(0.95, 0.6 + 0.15 * fit + 0.07 * hit.usedBy.length),
      });
      continue;
    }

    proposals.push({
      id: `p-${question.code}`,
      code: question.code,
      title: question.title,
      helpText: question.helpText,
      type: question.type,
      envelope: question.envelope,
      scoringMethod: question.scoringMethod,
      weight: question.weight,
      isKnockout: question.isKnockout,
      allowAttachment: question.allowAttachment,
      rubric: question.rubric,
      section: question.section,
      source: signal === undefined ? 'MARKET_PRACTICE' : 'WORKSPACE',
      rationale: signal === undefined
        ? question.why
        : `${signal.observation} ${question.why}`,
      citation: null,
      confidence: Math.max(0.3, Math.min(0.88,
        0.38 + 0.3 * fit
        + (categorySpecific.has(question.code) ? 0.12 : 0)
        + (signal?.strength ?? 0) * 0.15)),
    });
  }

  // Library questions the corpus has never heard of are still house practice,
  // and leaving them out would make the agent worse than the buyer's own
  // library at suggesting what the buyer's own library already contains.
  for (const hit of hits) {
    if (seen.has(hit.code)) continue;
    if (hit.usedBy.length < 2) continue;
    seen.add(hit.code);
    proposals.push({
      id: `p-${hit.code}`,
      code: hit.code,
      title: hit.question.title,
      helpText: hit.question.helpText,
      type: hit.question.type,
      envelope: hit.question.envelope,
      scoringMethod: hit.question.scoringMethod,
      weight: hit.question.weight,
      isKnockout: hit.question.isKnockout,
      allowAttachment: hit.question.allowAttachment,
      rubric: hit.question.rubric,
      section: 'Company & compliance',
      source: 'LIBRARY',
      rationale: `${hit.usedBy.length} of your templates ask this and the market corpus does not, so it is house practice rather than something I brought.`,
      citation: hit.usedBy.join(', '),
      confidence: 0.55 + 0.1 * hit.usedBy.length,
    });
  }

  return rankProposals(proposals, brief);
}

/**
 * Order the proposals.
 *
 * Knockouts first — a question that can disqualify is the one a buyer most
 * needs to agree with — then by confidence. This is the seam a learned
 * re-ranker would replace; it is deliberately a pure function of the proposal
 * and the brief so that swap changes nothing else.
 */
export function rankProposals(proposals: AgentProposal[], brief: AgentBrief): AgentProposal[] {
  const order: Record<ProposalSource, number> = {
    LIBRARY: 0, WORKSPACE: 1, MARKET_PRACTICE: 2,
  };
  return [...proposals].sort((a, b) => {
    if (a.isKnockout !== b.isKnockout) return a.isKnockout ? -1 : 1;
    if (Math.abs(b.confidence - a.confidence) > 0.01) return b.confidence - a.confidence;
    if (order[a.source] !== order[b.source]) return order[a.source] - order[b.source];
    return a.code.localeCompare(b.code);
  }).map((proposal) => ({
    ...proposal,
    // A knockout proposed against a brief that never mentioned compliance or
    // risk is the agent over-reaching; say so rather than quietly ranking it.
    rationale: proposal.isKnockout
      && !brief.concerns.includes('COMPLIANCE') && !brief.concerns.includes('RISK')
      ? `${proposal.rationale} You did not raise compliance or risk, so consider whether this should disqualify or merely score.`
      : proposal.rationale,
  }));
}

/** A one-line account of where a draft came from, for the transcript. */
export function describeSources(proposals: AgentProposal[]): string {
  const counts = proposals.reduce<Record<ProposalSource, number>>(
    (totals, proposal) => ({ ...totals, [proposal.source]: (totals[proposal.source] ?? 0) + 1 }),
    { MARKET_PRACTICE: 0, LIBRARY: 0, WORKSPACE: 0 },
  );
  const parts: string[] = [];
  if (counts.LIBRARY > 0) parts.push(`${counts.LIBRARY} reused from your own templates`);
  if (counts.WORKSPACE > 0) parts.push(`${counts.WORKSPACE} from what this workspace has seen`);
  if (counts.MARKET_PRACTICE > 0) parts.push(`${counts.MARKET_PRACTICE} from market practice`);
  return parts.length === 0 ? 'Nothing to suggest for this brief.' : parts.join(', ') + '.';
}

// ---------------------------------------------------------------------------
// Accepting
// ---------------------------------------------------------------------------

/**
 * Turn the accepted proposals into template questions.
 *
 * The only way anything leaves this module. It takes the decisions rather than
 * the proposals, so there is no call shape that applies a suggestion the buyer
 * has not accepted — AG-03 may draft and may not publish, and that limit is
 * easier to keep when the function signature enforces it.
 *
 * Sections named by a proposal are created if the template has none; weights
 * come across as the corpus suggests them and are the buyer's to re-cut against
 * the section budget afterwards.
 */
export function applyAccepted({
  template, proposals, decisions,
}: {
  template: QuestionnaireTemplate;
  proposals: AgentProposal[];
  decisions: Record<string, Decision>;
}): QuestionnaireTemplate {
  const accepted = proposals.filter((proposal) => decisions[proposal.id] === 'ACCEPTED');
  if (accepted.length === 0) return template;

  const sections = [...template.sections];
  const sectionIdFor = (name: string): Id => {
    const existing = sections.find(
      (section) => section.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (existing) return existing.id;
    const sequence = sections.reduce((max, section) => Math.max(max, section.sequence), 0) + 1;
    const created = {
      id: `${template.id}-sec-ag-${sequence}`,
      name,
      sequence,
      // Budgeted at zero; the buyer allocates. A section the agent silently
      // gave weight to would change the scoring model without being asked.
      weight: 0,
      // And asked of the company, for the same reason: changing the grain
      // changes how many answers a supplier owes.
      askedPer: 'VENDOR' as const,
    };
    sections.push(created);
    return created.id;
  };

  let sequence = template.questions.reduce((max, q) => Math.max(max, q.sequence), 0);
  const added: TemplateQuestion[] = accepted.map((proposal) => {
    sequence += 1;
    const id = `${template.id}-q-ag-${proposal.code.replace(/[^A-Za-z0-9]+/g, '-')}`;
    return {
      id,
      templateId: template.id,
      sectionId: sectionIdFor(proposal.section),
      sequence,
      code: proposal.code,
      type: proposal.type,
      title: proposal.title,
      helpText: proposal.helpText,
      isRequired: true,
      envelope: proposal.envelope,
      weight: proposal.weight,
      scoringMethod: proposal.scoringMethod,
      maxScore: proposal.scoringMethod === 'NONE' ? 0 : 10,
      rubric: proposal.rubric,
      isKnockout: proposal.isKnockout,
      allowAttachment: proposal.allowAttachment,
      // The agent proposes company-level questions; asking per line changes
      // how many answers a supplier owes and is the buyer's call to make.
      askedPer: 'VENDOR',
      config: defaultConfigFor(proposal.type, id),
    };
  });

  return { ...template, sections, questions: [...template.questions, ...added] };
}

/** Codes already present, so the agent never proposes one twice. */
export const codesIn = (questions: { code: string }[] | Question[]): string[] =>
  questions.map((question) => question.code);
