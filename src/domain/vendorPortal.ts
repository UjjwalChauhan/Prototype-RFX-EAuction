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
import type {
  Answer, Counterparty, EventBidder, EventStatus, Id, Question, QuestionType, Response,
  ServerMillis, SourcingEvent, VendorInputPoint,
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
export type AnswerDraft = Record<Id, { value: Answer['value']; attachmentName: string | null }>;

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
 * The required questions still unanswered.
 *
 * Structural questions — a section heading, a page break, an instruction block —
 * ask the supplier for nothing, so they can never be outstanding however they
 * are flagged in the template.
 */
export function missingRequired(
  questions: Question[], draft: AnswerDraft,
): Question[] {
  return questions.filter(
    (q) => q.isRequired && !NON_ASKING_TYPES.includes(q.type) && !isAnswered(draft[q.id]),
  );
}

/** Types that display something rather than ask for something. */
export const NON_ASKING_TYPES: QuestionType[] = [
  'section', 'page_break', 'instruction_block', 'hidden_metadata',
];

/** The questions a supplier is actually expected to fill in. */
export function askableQuestions(questions: Question[]): Question[] {
  return [...questions]
    .filter((q) => !NON_ASKING_TYPES.includes(q.type))
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * Turn the working draft into the answers a response carries.
 *
 * Only questions that were actually asked produce an answer, so a response
 * never contains a value for something the supplier was never shown.
 */
export function toAnswers(questions: Question[], draft: AnswerDraft): Answer[] {
  return askableQuestions(questions)
    .filter((q) => isAnswered(draft[q.id]))
    .map((q) => ({
      questionId: q.id,
      value: draft[q.id].value,
      attachmentName: draft[q.id].attachmentName,
    }));
}

/** Reopen a submitted response for editing — a resubmission starts from it. */
export function draftFromResponse(response: Response | null): AnswerDraft {
  const draft: AnswerDraft = {};
  for (const answer of response?.answers ?? []) {
    draft[answer.questionId] = { value: answer.value, attachmentName: answer.attachmentName };
  }
  return draft;
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
