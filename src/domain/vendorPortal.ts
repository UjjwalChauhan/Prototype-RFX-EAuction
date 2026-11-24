/**
 * What a supplier sees, and what they still have to do about it.
 *
 * The buyer's stage machine is not the supplier's mental model. A buyer thinks
 * in journeys — intake, RFI, RFP, evaluation, award. A supplier thinks in
 * envelopes on a desk: *these are the ones waiting on me, and these are the
 * ones I have already dealt with.* So the portal sorts an invitation into the
 * kind of ask it is (RFI, RFP, RFQ, auction) and then into one of two piles.
 *
 * The rule for which pile is deliberately about the supplier, not the buyer:
 *
 * - **Active** — the ask is open, the deadline has not passed, and this
 *   supplier has not yet answered it. Something is owed.
 * - **Past** — anything else: they answered it, the buyer moved the event on,
 *   or the deadline went by. Nothing is owed, and it stays visible because a
 *   supplier needs their own history as much as the buyer needs an audit trail.
 *
 * An event reaches the supplier only through an invitation. There is no route
 * from here to an event they were not invited to, which is the same boundary
 * the admin platform enforces from the other side.
 */
import { EVERYONE, asksLine, asksVendor } from './questionAudience';
import type {
  Answer, Counterparty, EventBidder, EventStatus, Id, LineItem, Question, QuestionScope,
  QuestionType, Questionnaire, Response, ServerMillis, SourcingEvent, TemplateSection,
  VendorInputPoint,
} from './types';

/** The three ways a supplier is asked for a written response. */
export const REQUEST_POINTS: VendorInputPoint[] = ['RFI', 'RFP', 'RFQ'];

/**
 * Every point a supplier can be asked at.
 *
 * Classification covers all of them, not just the three the Requests screen
 * names. A journey that asks only at intake — a requisition raised against a
 * quote the requester already holds — is a real pattern, and an event that
 * reaches the supplier through a point no section covers would simply vanish
 * from this portal while the buyer believed it had been sent.
 */
export const ALL_VENDOR_POINTS: VendorInputPoint[] = [
  'INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION',
];

export const REQUEST_LABELS: Record<string, string> = {
  INTAKE: 'Quote Request',
  RFI: 'Request for Information',
  RFP: 'Request for Proposal',
  RFQ: 'Request for Quotation',
  NEGOTIATION: 'Negotiation',
  AUCTION: 'Auction',
};

/** What the buyer is asking for, in the supplier's language. */
export const REQUEST_PURPOSE: Record<string, string> = {
  INTAKE: 'An indicative price against a requirement that is still taking shape.',
  NEGOTIATION: 'A revised position against the counter-offer you were sent.',
  RFI: 'Tell us what you can do. No pricing is asked for at this stage.',
  RFP: 'A full proposal — how you would deliver, and what it costs.',
  RFQ: 'Prices against a specification that is already fixed.',
  AUCTION: 'A live event. Your bid competes in real time against the others invited.',
};

/** Statuses in which nothing more is expected from a supplier. */
const CLOSED_STATUSES: EventStatus[] = [
  'RESPONSES_CLOSED', 'UNDER_EVALUATION', 'AUCTION_CLOSED', 'AWARD_RECOMMENDED',
  'PENDING_AWARD_APPROVAL', 'AWARD_PENDING_ONBOARDING', 'AWARDED', 'CLOSED', 'CANCELLED',
];

/** Statuses a supplier should never see at all — the buyer has not sent it yet. */
const UNPUBLISHED_STATUSES: EventStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

export interface VendorItem {
  event: SourcingEvent;
  bidder: EventBidder;
  point: VendorInputPoint;
  /** Whether this supplier still owes the buyer something here. */
  active: boolean;
  /** Set while active: when the response is due. */
  closesAt: ServerMillis | null;
  /** Why it sits in the pile it does — shown verbatim to the supplier. */
  standing: string;
  submittedAt: ServerMillis | null;
}

export interface VendorSection {
  point: VendorInputPoint;
  label: string;
  purpose: string;
  active: VendorItem[];
  past: VendorItem[];
}

/** Has this supplier submitted anything against this event? */
export function submissionFor(
  responses: Response[], eventId: Id, bidderId: Id,
): Response | null {
  const submitted = responses
    .filter((r) => r.eventId === eventId && r.bidderId === bidderId && r.submittedAt !== null)
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
  return submitted[0] ?? null;
}

/**
 * The invitations belonging to one supplier company.
 *
 * A counterparty can hold more than one invitation to the same event over its
 * life, so this keys on the bidder record rather than the company.
 */
export function invitationsFor(
  bidders: EventBidder[], counterpartyId: Id,
): EventBidder[] {
  return bidders.filter((b) => b.counterpartyId === counterpartyId);
}

/**
 * Classify one invitation at one point in the journey.
 *
 * `now` is passed rather than read so the same call is deterministic in a test
 * and honest in the browser — a deadline that passes while the page is open
 * moves the item without a reload.
 */
export function classify(
  event: SourcingEvent, bidder: EventBidder, point: VendorInputPoint,
  responses: Response[], now: ServerMillis,
): VendorItem {
  const submission = submissionFor(responses, event.id, bidder.id);
  const base = {
    event, bidder, point, closesAt: event.closesAt,
    submittedAt: submission?.submittedAt ?? null,
  };

  if (bidder.invitationStatus === 'DECLINED') {
    return { ...base, active: false, standing: 'You declined this invitation.' };
  }
  if (bidder.disqualified) {
    return {
      ...base, active: false,
      standing: bidder.disqualificationReason ?? 'Disqualified from this event.',
    };
  }
  if (submission) {
    return {
      ...base, active: false,
      standing: `Submitted — version ${submission.version}. The buyer has it.`,
    };
  }
  if (bidder.participationStatus === 'WITHDRAWN') {
    return { ...base, active: false, standing: 'You withdrew from this event.' };
  }
  if (CLOSED_STATUSES.includes(event.status)) {
    return {
      ...base, active: false,
      standing: 'Closed without a response from you.',
    };
  }
  if (event.closesAt !== null && event.closesAt <= now) {
    return { ...base, active: false, standing: 'The deadline passed before you responded.' };
  }
  // The buyer has moved the event past the point this ask belongs to.
  if (event.currentStage !== point && stageIsAfter(event, point)) {
    return { ...base, active: false, standing: 'The buyer has moved this event on.' };
  }
  return {
    ...base,
    active: true,
    standing: bidder.participationStatus === 'IN_PROGRESS'
      ? 'Started, not yet submitted.'
      : 'Waiting on you.',
  };
}

/**
 * The one ask an event is making of a supplier right now.
 *
 * An event carries every point it will *ever* ask at, and filing it under all
 * of them put a single event in four sections at once — the same invitation
 * listed as an RFI, an RFP, an RFQ and an auction. That is not four asks. It
 * holds one response, so answering the RFI flipped the RFP and the RFQ to
 * "Submitted" as well, and a supplier was told they had answered a proposal
 * they had never been shown.
 *
 * So an event files under exactly one point: the one it has reached. Later
 * points are asks the buyer has not raised yet, and a journey that issues them
 * separately does so as its own ask event with its own deadline and its own
 * response — which is what `createSourcingEvent` builds, and what lands here
 * as a second item rather than a duplicate of the first.
 */
export function askPointOf(event: SourcingEvent): VendorInputPoint | null {
  const points = event.vendorInputPoints;
  if (points.length === 0) return null;

  const order = event.stagesEnabled as readonly string[];
  const at = order.indexOf(event.currentStage);
  // A journey whose stage list does not place the current stage cannot say
  // which asks have been reached; the first one is the only honest answer.
  if (at === -1) return points[0];

  const reached = points.filter((point) => {
    const index = order.indexOf(point);
    return index !== -1 && index <= at;
  });
  // Nothing reached yet: the event is published but standing before its first
  // ask, so that is the one it is heading for.
  return reached.length === 0 ? points[0] : reached[reached.length - 1];
}

/** Whether the event's current stage sits after `point` in its own journey. */
function stageIsAfter(event: SourcingEvent, point: VendorInputPoint): boolean {
  const order = event.stagesEnabled;
  const at = order.indexOf(event.currentStage);
  const of = order.indexOf(point as (typeof order)[number]);
  if (at === -1 || of === -1) return false;
  return at > of;
}

/**
 * Everything one supplier can see, split by the kind of ask and then by
 * whether it is waiting on them.
 */
export function vendorSections(
  {
    events, bidders, responses, counterpartyId, now,
  }: {
    events: SourcingEvent[];
    bidders: EventBidder[];
    responses: Response[];
    counterpartyId: Id;
    now: ServerMillis;
  },
): VendorSection[] {
  const invitations = invitationsFor(bidders, counterpartyId);
  const byId = new Map(events.map((e) => [e.id, e]));

  return ALL_VENDOR_POINTS.map((point) => {
    const items: VendorItem[] = [];
    for (const bidder of invitations) {
      const event = byId.get(bidder.eventId);
      if (!event) continue;
      if (UNPUBLISHED_STATUSES.includes(event.status)) continue;
      if (askPointOf(event) !== point) continue;
      items.push(classify(event, bidder, point, responses, now));
    }
    const order = (a: VendorItem, b: VendorItem) =>
      (a.closesAt ?? Infinity) - (b.closesAt ?? Infinity);
    return {
      point,
      label: REQUEST_LABELS[point],
      purpose: REQUEST_PURPOSE[point],
      active: items.filter((i) => i.active).sort(order),
      past: items.filter((i) => !i.active).sort((a, b) =>
        (b.submittedAt ?? b.closesAt ?? 0) - (a.submittedAt ?? a.closesAt ?? 0),
      ),
    };
  });
}

/** The supplier company behind an invitation. */
export function counterpartyOf(
  counterparties: Counterparty[], bidder: EventBidder | undefined,
): Counterparty | undefined {
  return counterparties.find((c) => c.id === bidder?.counterpartyId);
}

/** How long until a deadline, in the plain language the portal uses. */
export function timeRemaining(closesAt: ServerMillis | null, now: ServerMillis): string {
  if (closesAt === null) return 'No deadline set';
  const ms = closesAt - now;
  if (ms <= 0) return 'Closed';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} minutes left`;
  if (hours < 48) return `${hours} hours left`;
  return `${Math.floor(hours / 24)} days left`;
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * A supplier's working answers, before they are submitted.
 *
 * Held by question id rather than as an array so an edit is a replacement
 * rather than a search — and so a question removed from the ask cannot leave a
 * stray answer behind pointing at nothing.
 */
export type AnswerDraft = Record<string, { value: Answer['value']; attachmentName: string | null }>;

/**
 * The key one answer is held under.
 *
 * A vendor-level question is its own key. A line-level question is asked once
 * per line, so the line has to be part of the key or the second line
 * overwrites the first. The separator is a pair of colons because an id never
 * contains one, and `splitAnswerKey` is the only thing that takes it apart.
 */
export function answerKey(questionId: Id, lineItemId: Id | null = null): string {
  return lineItemId === null ? questionId : `${questionId}::${lineItemId}`;
}

export function splitAnswerKey(key: string): { questionId: Id; lineItemId: Id | null } {
  const at = key.indexOf('::');
  return at < 0
    ? { questionId: key, lineItemId: null }
    : { questionId: key.slice(0, at), lineItemId: key.slice(at + 2) };
}

/** Whether an answer counts as given. Zero and `false` are answers; blank is not. */
export function isAnswered(entry: AnswerDraft[string] | undefined): boolean {
  if (!entry) return false;
  const { value, attachmentName } = entry;
  if (attachmentName) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  // A number or a boolean is an answer even when it is 0 or false.
  return true;
}

/**
 * One box the supplier has to fill in.
 *
 * A vendor-level question is one cell. A line-level question is one cell per
 * line in the basket, each carrying the line it belongs to — which is what
 * turns "tell us your lead times" plus an attached spreadsheet into something
 * the buyer can rank suppliers on.
 */
export interface AskedCell {
  key: string;
  question: Question;
  lineItemId: Id | null;
  /** How the line reads on screen. Null on a vendor-level cell. */
  lineLabel: string | null;
}

/**
 * Expand a question set against a basket.
 *
 * With no lines, a line-level question collapses to a single cell rather than
 * disappearing: an ask raised before its basket exists still has to be
 * answerable, and silently dropping the question would lose it from the
 * response without telling anybody.
 */
export function askedCells(
  questions: Question[], lines: LineItem[] = [], forVendorId: Id | null = null,
): AskedCell[] {
  const cells: AskedCell[] = [];
  for (const question of askableQuestions(questions, forVendorId)) {
    const askedLines = linesAsked(question, lines);
    if (question.askedPer !== 'LINE' || askedLines.length === 0) {
      cells.push({ key: answerKey(question.id), question, lineItemId: null, lineLabel: null });
      continue;
    }
    for (const lineItem of askedLines) {
      cells.push({
        key: answerKey(question.id, lineItem.id),
        question,
        lineItemId: lineItem.id,
        lineLabel: `${lineItem.itemCode} · ${lineItem.description}`,
      });
    }
  }
  return cells;
}

/**
 * One block of the form as the supplier meets it.
 *
 * Grouped by section because the section is where the grain is declared: a
 * per-line block and a per-vendor block are different kinds of work, and a
 * flat list that switches between them row by row reads as a form that keeps
 * changing its mind. The section's weight never travels — the supplier is
 * told what is being asked, never what it is worth.
 */
export interface SupplierGroup {
  id: string;
  /** Null for questions in no section at all. */
  name: string | null;
  askedPer: QuestionScope;
  questions: Question[];
  cells: AskedCell[];
}

export function supplierGroups(
  questions: Question[],
  sections: TemplateSection[] = [],
  lines: LineItem[] = [],
  forVendorId: Id | null = null,
): SupplierGroup[] {
  const asked = askableQuestions(questions, forVendorId);
  const ordered = [...sections].sort((a, b) => a.sequence - b.sequence);
  const groups: SupplierGroup[] = [];

  const push = (id: string, name: string | null, inside: Question[]) => {
    if (inside.length === 0) return;
    groups.push({
      id,
      name,
      askedPer: inside.some((q) => q.askedPer === 'LINE') ? 'LINE' : 'VENDOR',
      questions: inside,
      cells: askedCells(inside, lines, forVendorId),
    });
  };

  for (const section of ordered) {
    push(section.id, section.name, asked.filter((q) => q.sectionId === section.id));
  }
  // Anything in no section, or in a section the questionnaire did not carry,
  // still has to be asked rather than quietly dropped.
  const grouped = new Set(groups.flatMap((g) => g.questions.map((q) => q.id)));
  push('ungrouped', null, asked.filter((q) => !grouped.has(q.id)));
  return groups;
}

/**
 * The required cells still unanswered.
 *
 * Required on a line-level question means required for every line — a lead
 * time given for three of six items is not an answer, it is a gap the buyer
 * finds at comparison.
 *
 * Structural questions ask the supplier for nothing, so they can never be
 * outstanding however they are flagged in the template; `askedCells` has
 * already left them out.
 */
export function missingRequired(cells: AskedCell[], draft: AnswerDraft): AskedCell[] {
  return cells.filter((cell) => cell.question.isRequired && !isAnswered(draft[cell.key]));
}

/** Types that display something rather than ask for something. */
export const NON_ASKING_TYPES: QuestionType[] = [
  'section', 'page_break', 'instruction_block', 'hidden_metadata',
];

/**
 * The questionnaires one ask puts in front of one supplier.
 *
 * An ask carries one questionnaire per category in its basket. A supplier is
 * shortlisted per category too, so they are asked for their categories and no
 * others — an empty `categories` on the invitation means the whole basket,
 * which is the ordinary single-category case and the only safe reading of a
 * roster recorded before categories were kept.
 *
 * A questionnaire with no category covers the whole ask and always applies.
 */
export function questionnairesForBidder(
  questionnaires: Questionnaire[],
  eventId: Id,
  point: VendorInputPoint,
  bidderCategories: string[] = [],
): Questionnaire[] {
  return questionnaires.filter((questionnaire) => {
    if (questionnaire.eventId !== eventId || questionnaire.stage !== point) return false;
    const category = questionnaire.category ?? null;
    if (category === null) return true;
    return bidderCategories.length === 0 || bidderCategories.includes(category);
  });
}

/**
 * The questions a supplier is actually expected to fill in.
 *
 * `forVendorId` applies the buyer's narrowing: a question tagged to three of
 * six suppliers is not on the other three's form at all. Omit it to get the
 * whole questionnaire, which is what the buyer-side preview and the
 * evaluation screens want — they are looking at the form, not answering it.
 */
export function askableQuestions(
  questions: Question[], forVendorId: Id | null = null,
): Question[] {
  return [...questions]
    .filter((q) => !NON_ASKING_TYPES.includes(q.type))
    .filter((q) => forVendorId === null || asksVendor(q.askedOf ?? EVERYONE, forVendorId))
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * The lines one question is asked about.
 *
 * A question narrowed to four of nine lines produces four cells, not nine.
 * A narrowing that matches no line in this basket falls back to the whole
 * basket rather than to nothing: the alternative is a question on the form
 * with no box under it, which tells the supplier nothing and loses the answer.
 */
export function linesAsked(question: Question, lines: LineItem[]): LineItem[] {
  const audience = question.askedOf ?? EVERYONE;
  if (audience.lineIds === null) return lines;
  const kept = lines.filter((line) => asksLine(audience, line.id));
  return kept.length === 0 ? lines : kept;
}

/**
 * Turn the working draft into the answers a response carries.
 *
 * Only questions that were actually asked produce an answer, so a response
 * never contains a value for something the supplier was never shown.
 */
export function toAnswers(cells: AskedCell[], draft: AnswerDraft): Answer[] {
  return cells
    .filter((cell) => isAnswered(draft[cell.key]))
    .map((cell) => ({
      questionId: cell.question.id,
      value: draft[cell.key].value,
      attachmentName: draft[cell.key].attachmentName,
      lineItemId: cell.lineItemId,
    }));
}

/** Reopen a submitted response for editing — a resubmission starts from it. */
export function draftFromResponse(response: Response | null): AnswerDraft {
  const draft: AnswerDraft = {};
  for (const answer of response?.answers ?? []) {
    draft[answerKey(answer.questionId, answer.lineItemId ?? null)] = {
      value: answer.value,
      attachmentName: answer.attachmentName,
    };
  }
  return draft;
}

/**
 * One question's answers, keyed by line — what the buyer reads at comparison.
 *
 * A vendor-level answer comes back under the `null` key, so one accessor
 * serves both kinds and no caller has to branch on the scope first.
 */
export function answersByLine(
  answers: Answer[], questionId: Id,
): Map<Id | null, Answer> {
  const byLine = new Map<Id | null, Answer>();
  for (const answer of answers) {
    if (answer.questionId !== questionId) continue;
    byLine.set(answer.lineItemId ?? null, answer);
  }
  return byLine;
}

/**
 * Which supplier the portal should open as.
 *
 * The real product knows this from the session. A prototype with a switcher
 * has to choose, and choosing a fixed company means a buyer who publishes to a
 * different shortlist opens the portal, sees an empty list, and concludes the
 * event never arrived. So it opens as whoever actually has work waiting —
 * falling back to whoever holds any invitation at all, and only then to the
 * preferred default.
 */
export function defaultCounterparty({
  events, bidders, responses, counterparties, preferred, now,
}: {
  events: SourcingEvent[];
  bidders: EventBidder[];
  responses: Response[];
  counterparties: { id: Id }[];
  preferred: Id;
  now: ServerMillis;
}): Id {
  const score = (counterpartyId: Id) => {
    const sections = vendorSections({ events, bidders, responses, counterpartyId, now });
    return sections.reduce(
      (totals, section) => ({
        active: totals.active + section.active.length,
        any: totals.any + section.active.length + section.past.length,
      }),
      { active: 0, any: 0 },
    );
  };

  const preferredScore = score(preferred);
  if (preferredScore.active > 0) return preferred;

  const ranked = counterparties
    .map((c) => ({ id: c.id, ...score(c.id) }))
    .sort((a, b) => b.active - a.active || b.any - a.any);

  const best = ranked[0];
  if (best && best.active > 0) return best.id;
  if (preferredScore.any > 0) return preferred;
  if (best && best.any > 0) return best.id;
  return preferred;
}
