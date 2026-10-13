/**
 * When each ask opens, when it closes, and what it takes to move that date.
 *
 * A sourcing event is a sequence of deadlines, and the deadline is the part
 * suppliers organise their week around. Moving one is not an edit — it is an
 * act with consequences: a supplier who submitted on the old date is now
 * competing against bids priced with three more days of information, everyone
 * invited has to be told, and an auditor will later ask who moved it and why.
 *
 * So this module holds two things:
 *
 * 1. **The schedule.** One window per ask — RFI, RFP, RFQ, auction — with a
 *    real start and a real end, in a stated timezone. Windows run in journey
 *    order and may not overlap, because a supplier cannot answer an RFP written
 *    against answers they have not given yet.
 * 2. **The rules that govern moving it.** How short a window may be, how many
 *    times each ask may be extended and by how much, whether a closed ask can
 *    be reopened at all, when clarifications stop being accepted, who has to be
 *    told, and what happens to the asks behind the one being moved.
 *
 * The rules are set once, on the Timeline step, and apply to **every** ask the
 * journey creates. One set of rules per event is the point: an RFQ that may be
 * extended twice while the RFI beside it may be extended five times is not a
 * policy, it is an accident.
 *
 * Everything here is pure. The same functions validate the wizard, gate the
 * extend dialog, and could gate a server route without changing a line.
 */
import type { Id, ServerMillis, Stage } from './types';
import type { SolicitationStage } from './stageEvents';

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** What happens to the asks behind the one whose deadline just moved. */
export type CascadePolicy =
  /** Everything after it shifts by the same amount. The journey gets longer. */
  | 'SHIFT'
  /** The gap before the next ask absorbs it. The journey ends when it always did. */
  | 'ABSORB';

export type NotifyChannel = 'EMAIL' | 'IN_APP' | 'SMS';

export const NOTIFY_CHANNEL_LABEL: Record<NotifyChannel, string> = {
  EMAIL: 'Email', IN_APP: 'In-app', SMS: 'SMS',
};

/** Who hears about a change of date. */
export type NotifyAudience = 'ALL_INVITED' | 'NOT_YET_SUBMITTED' | 'SUBMITTED_ONLY';

export const NOTIFY_AUDIENCE_LABEL: Record<NotifyAudience, string> = {
  ALL_INVITED: 'Everyone invited',
  NOT_YET_SUBMITTED: 'Those who have not submitted',
  SUBMITTED_ONLY: 'Those who already submitted',
};

/**
 * The time rules for an event, applied to every ask it creates.
 *
 * Defaults are deliberately conservative: three days to respond, two
 * extensions, a day's cap on each, no reopening after close, and everyone told
 * on every channel. A buyer who wants something looser has to say so, and the
 * Review step shows what they chose.
 */
export interface TimelineRules {
  /** IANA zone the dates are read and written in. Stored on the event. */
  timezone: string;
  /** No ask may be open for less than this. */
  minResponseWindowHours: number;
  /** Nor for more — a window nobody closes is a tender nobody awards. */
  maxResponseWindowDays: number;
  /** Quiet time between one ask closing and the next opening. */
  gapHoursBetweenStages: number;
  /** How many times one ask may be extended. Zero forbids extension. */
  maxExtensions: number;
  /** The most one extension may add. */
  maxExtensionHoursEach: number;
  /** The most every extension on one ask may add, together. */
  maxTotalExtensionHours: number;
  /** An extension longer than this needs a second person to approve it. */
  approvalRequiredBeyondHours: number;
  /** A narrative reason is always required; this is how much of one. */
  minReasonLength: number;
  /** Whether a closed ask may be reopened at all. */
  allowReopenAfterClose: boolean;
  /** And for how long after it closed. */
  reopenWithinHours: number;
  /** Clarifications stop this long before an ask closes. */
  clarificationCutoffHours: number;
  /** Who is told, and how. */
  notifyChannels: NotifyChannel[];
  notifyAudience: NotifyAudience;
  /** What happens to the asks behind the one that moved. */
  cascade: CascadePolicy;
  /** A late bid extends a live auction — soft close. Auctions only. */
  autoExtendAuction: boolean;
  autoExtendMinutes: number;
  maxAutoExtensions: number;
}

/** The rules an event runs under, filling anything unstated from the default. */
export function resolveTimelineRules(partial?: Partial<TimelineRules>): TimelineRules {
  return { ...DEFAULT_TIMELINE_RULES, ...(partial ?? {}) };
}

export const DEFAULT_TIMELINE_RULES: TimelineRules = {
  timezone: 'Asia/Dubai',
  minResponseWindowHours: 48,
  maxResponseWindowDays: 60,
  gapHoursBetweenStages: 0,
  maxExtensions: 2,
  maxExtensionHoursEach: 24,
  maxTotalExtensionHours: 168,
  approvalRequiredBeyondHours: 48,
  minReasonLength: 20,
  allowReopenAfterClose: false,
  reopenWithinHours: 24,
  clarificationCutoffHours: 24,
  notifyChannels: ['EMAIL', 'IN_APP', 'SMS'],
  notifyAudience: 'ALL_INVITED',
  cascade: 'SHIFT',
  autoExtendAuction: true,
  autoExtendMinutes: 2,
  maxAutoExtensions: 10,
};

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export interface StageWindow {
  stage: SolicitationStage;
  opensAt: ServerMillis;
  closesAt: ServerMillis;
}

/** A window with everything derived from it that a screen wants to show. */
export interface StageSchedule extends StageWindow {
  /** Hours the ask is open for. */
  durationHours: number;
  /** When questions stop being accepted. Never before it opens. */
  clarificationsCloseAt: ServerMillis;
}

export interface ScheduleInput {
  /** When the first ask opens. */
  startAt: ServerMillis;
  /** Window length for any stage not named in `stageHours`. */
  defaultHours: number;
  /** Per-stage window lengths, in hours. */
  stageHours?: Partial<Record<SolicitationStage, number>>;
  /**
   * Windows the buyer set by hand. A stage present here is used verbatim
   * rather than derived, which is what lets the Timeline step be edited.
   */
  fixed?: Partial<Record<SolicitationStage, { opensAt: ServerMillis; closesAt: ServerMillis }>>;
}

/**
 * The schedule a journey implies.
 *
 * Derived stages run back to back, separated by the configured gap. A stage
 * the buyer pinned by hand keeps its dates, and the stages after it carry on
 * from there — editing one date must not silently rewrite the others.
 */
export function buildSchedule(
  stages: readonly SolicitationStage[], input: ScheduleInput, rules: TimelineRules,
): StageSchedule[] {
  const gap = rules.gapHoursBetweenStages * HOUR_MS;
  let cursor = input.startAt;

  return stages.map((stage, index) => {
    const pinned = input.fixed?.[stage];
    const opensAt = pinned?.opensAt ?? (index === 0 ? input.startAt : cursor + gap);
    const closesAt = pinned?.closesAt
      ?? opensAt + (input.stageHours?.[stage] ?? input.defaultHours) * HOUR_MS;
    cursor = closesAt;
    return describeWindow({ stage, opensAt, closesAt }, rules);
  });
}

export function describeWindow(window: StageWindow, rules: TimelineRules): StageSchedule {
  const cutoff = window.closesAt - rules.clarificationCutoffHours * HOUR_MS;
  return {
    ...window,
    durationHours: Math.round(((window.closesAt - window.opensAt) / HOUR_MS) * 10) / 10,
    // A cutoff earlier than the opening would mean questions were never
    // accepted at all; the opening is the floor.
    clarificationsCloseAt: Math.max(cutoff, window.opensAt),
  };
}

// ---------------------------------------------------------------------------
// Validating a schedule
// ---------------------------------------------------------------------------

export interface TimelineIssue {
  /** The stage the issue is about, or null when it is about the whole schedule. */
  stage: SolicitationStage | null;
  field: string;
  message: string;
  /** Blocking issues stop a publish; warnings are shown and can be accepted. */
  blocking: boolean;
}

/**
 * Everything that must be true before a schedule can be published.
 *
 * Ordering, length and overlap are blocking because they describe something
 * that cannot happen. A short window or a deadline on a weekend is a warning:
 * unwise, sometimes deliberate, and not the platform's decision to refuse.
 */
export function validateSchedule(
  schedule: StageSchedule[], rules: TimelineRules, now: ServerMillis,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const say = (
    stage: SolicitationStage | null, field: string, message: string, blocking = true,
  ) => issues.push({ stage, field, message, blocking });

  if (schedule.length === 0) return issues;

  schedule.forEach((window, index) => {
    const label = STAGE_TIMELINE_LABEL[window.stage];

    if (window.closesAt <= window.opensAt) {
      say(window.stage, 'closesAt', `${label} closes before it opens.`);
    }
    if (window.opensAt < now - 5 * 60_000 && index === 0) {
      say(window.stage, 'opensAt', `${label} opens in the past.`, false);
    }

    const hours = (window.closesAt - window.opensAt) / HOUR_MS;
    // The response-window rules govern the written asks. An auction is short by
    // design — a live event running for two days is not a live event — so it is
    // held to its own floor of a few minutes rather than to days.
    if (window.stage === 'AUCTION') {
      if (hours > 0 && hours * 60 < MIN_AUCTION_MINUTES) {
        say(
          window.stage, 'closesAt',
          `${label} runs for under ${MIN_AUCTION_MINUTES} minutes, which is not long enough for bidders to join and compete.`,
        );
      }
    } else {
      if (hours > 0 && hours < rules.minResponseWindowHours) {
        say(
          window.stage, 'closesAt',
          `${label} is open for ${round1(hours)}h; the rule for this event is a minimum of ${rules.minResponseWindowHours}h.`,
        );
      }
      if (hours > rules.maxResponseWindowDays * 24) {
        say(
          window.stage, 'closesAt',
          `${label} is open for ${Math.round(hours / 24)} days, beyond the ${rules.maxResponseWindowDays}-day maximum.`,
        );
      }
    }

    const previous = schedule[index - 1];
    if (previous && window.opensAt < previous.closesAt) {
      say(
        window.stage, 'opensAt',
        `${label} opens before ${STAGE_TIMELINE_LABEL[previous.stage]} closes. Asks run in sequence — a supplier cannot answer one written against answers they have not given yet.`,
      );
    }
    if (previous && rules.gapHoursBetweenStages > 0) {
      const gap = (window.opensAt - previous.closesAt) / HOUR_MS;
      if (gap >= 0 && gap < rules.gapHoursBetweenStages) {
        say(
          window.stage, 'opensAt',
          `Only ${round1(gap)}h between ${STAGE_TIMELINE_LABEL[previous.stage]} closing and ${label} opening; the rule asks for ${rules.gapHoursBetweenStages}h.`,
          false,
        );
      }
    }

    if (window.stage !== 'AUCTION' && rules.clarificationCutoffHours >= hours && hours > 0) {
      say(
        window.stage, 'clarificationCutoffHours',
        `The clarification cutoff of ${rules.clarificationCutoffHours}h is as long as the ${label} window itself, so no question could ever be asked.`,
        false,
      );
    }

    if (isWeekend(window.closesAt)) {
      say(
        window.stage, 'closesAt',
        `${label} closes on a weekend. Suppliers routinely submit on the final day.`,
        false,
      );
    }
  });

  return issues;
}

/** Below this an auction cannot be joined, let alone competed in. */
export const MIN_AUCTION_MINUTES = 10;

const round1 = (value: number) => Math.round(value * 10) / 10;

function isWeekend(at: ServerMillis): boolean {
  const day = new Date(at).getUTCDay();
  return day === 0 || day === 6;
}

export const STAGE_TIMELINE_LABEL: Record<SolicitationStage, string> = {
  RFI: 'The RFI', RFP: 'The RFP', RFQ: 'The RFQ', AUCTION: 'The auction',
};

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/**
 * Why a deadline moved.
 *
 * A closed list rather than free text alone, because "why do we keep extending
 * RFQs" is a question the category manager asks once a quarter and cannot
 * answer from a thousand sentences. The narrative is required as well.
 */
export type ExtensionReason =
  | 'CLARIFICATION_PENDING'
  | 'CORRIGENDUM_ISSUED'
  | 'SCOPE_CHANGED'
  | 'INSUFFICIENT_RESPONSES'
  | 'SUPPLIER_REQUEST'
  | 'TECHNICAL_ISSUE'
  | 'INTERNAL_DELAY'
  | 'OTHER';

export const EXTENSION_REASON_LABEL: Record<ExtensionReason, string> = {
  CLARIFICATION_PENDING: 'Clarifications still unanswered',
  CORRIGENDUM_ISSUED: 'Corrigendum issued — scope or documents changed',
  SCOPE_CHANGED: 'Requirement changed',
  INSUFFICIENT_RESPONSES: 'Too few responses to compete',
  SUPPLIER_REQUEST: 'Supplier asked for more time',
  TECHNICAL_ISSUE: 'Platform or portal problem',
  INTERNAL_DELAY: 'Internal delay on our side',
  OTHER: 'Other',
};

/** What the buyer fills in to move a date. */
export interface ExtensionRequest {
  eventId: Id;
  stage: SolicitationStage;
  /** The date being moved from — carried so a stale dialog cannot overwrite. */
  currentCloseAt: ServerMillis;
  newCloseAt: ServerMillis;
  reason: ExtensionReason;
  /** In the buyer's words. Goes to suppliers verbatim. */
  narrative: string;
  notifyChannels: NotifyChannel[];
  notifyAudience: NotifyAudience;
  /** Set when a corrigendum accompanies the change. */
  corrigendumReference: string | null;
  /** Whether clarifications reopen with the deadline. */
  reopenClarifications: boolean;
  requestedBy: Id;
  /** Required when the extension is longer than the approval threshold. */
  approvedBy: Id | null;
}

/** What is recorded once it is done. Append-only; an event keeps every one. */
export interface EventExtension {
  id: Id;
  eventId: Id;
  stage: SolicitationStage;
  /** 1 for the first extension of this ask, 2 for the next. */
  sequence: number;
  previousCloseAt: ServerMillis;
  newCloseAt: ServerMillis;
  addedHours: number;
  reason: ExtensionReason;
  narrative: string;
  notifyChannels: NotifyChannel[];
  notifyAudience: NotifyAudience;
  corrigendumReference: string | null;
  reopenClarifications: boolean;
  /** True when the ask had already closed and was reopened. */
  isReopen: boolean;
  requestedBy: Id;
  approvedBy: Id | null;
  createdAt: ServerMillis;
}

export interface ExtensionContext {
  /** Extensions already recorded against this ask. */
  history: EventExtension[];
  rules: TimelineRules;
  now: ServerMillis;
  /** The window this ask currently has. */
  window: StageWindow;
  /** The next ask's opening, when there is one — an extension may not cross it. */
  nextOpensAt: ServerMillis | null;
  /** Whether the ask has been issued. A planned ask is rescheduled, not extended. */
  issued: boolean;
}

export interface ExtensionAllowance {
  used: number;
  remaining: number;
  hoursUsed: number;
  hoursRemaining: number;
  /** The latest date this ask could be extended to under the rules. */
  latestPossibleCloseAt: ServerMillis | null;
  /** Set when no further extension is possible, with the reason why. */
  blockedReason: string | null;
}

/** What is left of an ask's extension budget. */
export function extensionAllowance(context: ExtensionContext): ExtensionAllowance {
  const { history, rules, window, now } = context;
  const used = history.length;
  const hoursUsed = history.reduce((sum, extension) => sum + extension.addedHours, 0);
  const remaining = Math.max(0, rules.maxExtensions - used);
  const hoursRemaining = Math.max(0, rules.maxTotalExtensionHours - hoursUsed);

  const closed = window.closesAt <= now;
  let blockedReason: string | null = null;
  if (rules.maxExtensions === 0) {
    blockedReason = 'This event does not allow extensions.';
  } else if (remaining === 0) {
    blockedReason = `All ${rules.maxExtensions} extensions have been used.`;
  } else if (hoursRemaining === 0) {
    blockedReason = `The ${rules.maxTotalExtensionHours}h total extension budget is spent.`;
  } else if (closed && !rules.allowReopenAfterClose) {
    blockedReason = 'This ask has closed, and reopening a closed ask is not allowed on this event.';
  } else if (
    closed && rules.allowReopenAfterClose
    && now > window.closesAt + rules.reopenWithinHours * HOUR_MS
  ) {
    blockedReason = `Reopening was allowed for ${rules.reopenWithinHours}h after close, and that has passed.`;
  }

  const cap = Math.min(rules.maxExtensionHoursEach, hoursRemaining);
  const from = Math.max(window.closesAt, closed ? now : window.closesAt);
  const latest = blockedReason === null ? from + cap * HOUR_MS : null;

  return {
    used,
    remaining,
    hoursUsed,
    hoursRemaining,
    latestPossibleCloseAt: latest === null
      ? null
      : context.nextOpensAt !== null && rules.cascade === 'ABSORB'
        ? Math.min(latest, context.nextOpensAt)
        : latest,
    blockedReason,
  };
}

/**
 * Whether this extension may go ahead, and what is wrong with it if not.
 *
 * Returns every problem rather than the first, so the dialog can mark all the
 * fields at once instead of revealing them one at a time.
 */
export function extensionIssues(
  request: ExtensionRequest, context: ExtensionContext,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const { rules, window, now } = context;
  const say = (field: string, message: string, blocking = true) =>
    issues.push({ stage: request.stage, field, message, blocking });

  const allowance = extensionAllowance(context);
  if (allowance.blockedReason !== null) say('stage', allowance.blockedReason);

  if (!context.issued) {
    say(
      'stage',
      'This ask has not been issued yet. Change its dates on the schedule rather than extending it — nobody has been told the old date.',
    );
  }

  // A dialog opened before someone else moved the date must not overwrite it.
  if (request.currentCloseAt !== window.closesAt) {
    say('newCloseAt', 'The deadline changed while this was open. Reload and try again.');
  }

  const added = (request.newCloseAt - window.closesAt) / HOUR_MS;
  if (request.newCloseAt <= window.closesAt) {
    say('newCloseAt', 'An extension must move the deadline later than it is now.');
  } else if (added > rules.maxExtensionHoursEach) {
    say(
      'newCloseAt',
      `This adds ${round1(added)}h; one extension may add at most ${rules.maxExtensionHoursEach}h on this event.`,
    );
  }
  if (added > allowance.hoursRemaining) {
    say(
      'newCloseAt',
      `This adds ${round1(added)}h and only ${round1(allowance.hoursRemaining)}h of the total extension budget is left.`,
    );
  }
  if (request.newCloseAt <= now) {
    say('newCloseAt', 'The new deadline is already in the past.');
  }
  if (
    context.nextOpensAt !== null
    && rules.cascade === 'ABSORB'
    && request.newCloseAt > context.nextOpensAt
  ) {
    say(
      'newCloseAt',
      'This runs past the next ask, and this event absorbs extensions rather than shifting what follows. Shorten it, or change the cascade rule.',
    );
  }

  if (request.narrative.trim().length < rules.minReasonLength) {
    say(
      'narrative',
      `A reason of at least ${rules.minReasonLength} characters is required. It is sent to every supplier and kept on the audit trail.`,
    );
  }
  if (request.reason === 'CORRIGENDUM_ISSUED' && !request.corrigendumReference?.trim()) {
    say('corrigendumReference', 'Reference the corrigendum this extension accompanies.');
  }
  if (request.notifyChannels.length === 0) {
    say('notifyChannels', 'Suppliers must be told on at least one channel.');
  }
  if (added > rules.approvalRequiredBeyondHours && request.approvedBy === null) {
    say(
      'approvedBy',
      `An extension longer than ${rules.approvalRequiredBeyondHours}h needs a second authorised approver.`,
    );
  }
  if (request.approvedBy !== null && request.approvedBy === request.requestedBy) {
    say('approvedBy', 'The approver must be someone other than the person requesting it.');
  }

  return issues;
}

export interface ExtensionResult {
  extension: EventExtension;
  /** Every ask whose window moved, including the one extended. */
  schedule: StageSchedule[];
}

/**
 * Apply an extension to a schedule.
 *
 * Throws when the request has not been validated. A caller reaching this with
 * a bad request has skipped the gate, and failing loudly is better than a
 * deadline moving in a way the rules forbid.
 */
export function applyExtension(
  request: ExtensionRequest, context: ExtensionContext, schedule: StageSchedule[],
): ExtensionResult {
  const blocking = extensionIssues(request, context).filter((issue) => issue.blocking);
  if (blocking.length > 0) {
    throw new Error(`Extension refused: ${blocking.map((i) => i.message).join(' ')}`);
  }

  const added = (request.newCloseAt - context.window.closesAt) / HOUR_MS;
  const extension: EventExtension = {
    id: `ext-${request.eventId}-${request.stage.toLowerCase()}-${context.history.length + 1}`,
    eventId: request.eventId,
    stage: request.stage,
    sequence: context.history.length + 1,
    previousCloseAt: context.window.closesAt,
    newCloseAt: request.newCloseAt,
    addedHours: round1(added),
    reason: request.reason,
    narrative: request.narrative.trim(),
    notifyChannels: [...request.notifyChannels],
    notifyAudience: request.notifyAudience,
    corrigendumReference: request.corrigendumReference?.trim() || null,
    reopenClarifications: request.reopenClarifications,
    isReopen: context.window.closesAt <= context.now,
    requestedBy: request.requestedBy,
    approvedBy: request.approvedBy,
    createdAt: context.now,
  };

  return {
    extension,
    schedule: rescheduleAfterExtension(schedule, request.stage, request.newCloseAt, context.rules),
  };
}

/**
 * The schedule after one ask's deadline moves.
 *
 * Under SHIFT everything behind it moves by the same amount and the journey
 * gets longer. Under ABSORB the gap before the next ask takes the hit and the
 * end date holds — which is what a buyer working to a board date needs, and why
 * it is a rule rather than a preference.
 */
export function rescheduleAfterExtension(
  schedule: StageSchedule[], stage: SolicitationStage, newCloseAt: ServerMillis,
  rules: TimelineRules,
): StageSchedule[] {
  const index = schedule.findIndex((window) => window.stage === stage);
  if (index === -1) return schedule;

  const moved = newCloseAt - schedule[index].closesAt;
  return schedule.map((window, i) => {
    if (i < index) return window;
    if (i === index) return describeWindow({ ...window, closesAt: newCloseAt }, rules);
    if (rules.cascade === 'ABSORB') {
      // Only the opening of the ask that follows is pulled forward, and only as
      // far as it must be. Nothing after that moves at all.
      const opensAt = Math.max(window.opensAt, i === index + 1 ? newCloseAt : window.opensAt);
      return describeWindow({ ...window, opensAt: Math.min(opensAt, window.closesAt) }, rules);
    }
    return describeWindow(
      { ...window, opensAt: window.opensAt + moved, closesAt: window.closesAt + moved },
      rules,
    );
  });
}

// ---------------------------------------------------------------------------
// Reading a schedule
// ---------------------------------------------------------------------------

export type TimelineStatus = 'NOT_OPEN' | 'OPEN' | 'CLOSING_SOON' | 'CLOSED';

export const TIMELINE_STATUS_LABEL: Record<TimelineStatus, string> = {
  NOT_OPEN: 'Not open yet',
  OPEN: 'Open',
  CLOSING_SOON: 'Closing soon',
  CLOSED: 'Closed',
};

/** Where an ask stands against the clock. */
export function timelineStatus(
  window: StageWindow, now: ServerMillis, closingSoonHours = 24,
): TimelineStatus {
  if (now < window.opensAt) return 'NOT_OPEN';
  if (now >= window.closesAt) return 'CLOSED';
  return window.closesAt - now <= closingSoonHours * HOUR_MS ? 'CLOSING_SOON' : 'OPEN';
}

/** Whether questions are still being accepted on an ask. */
export function clarificationsOpen(window: StageSchedule, now: ServerMillis): boolean {
  return now >= window.opensAt && now < window.clarificationsCloseAt;
}

/** The extensions recorded against one ask, oldest first. */
export function extensionsFor(
  extensions: EventExtension[], eventId: Id, stage?: Stage,
): EventExtension[] {
  return extensions
    .filter((e) => e.eventId === eventId && (stage === undefined || e.stage === stage))
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * A plain-language summary of the rules, for the Review step and the audit
 * trail. Written as one sentence because that is how a buyer checks it.
 */
export function describeRules(rules: TimelineRules): string {
  const parts = [
    `Minimum ${rules.minResponseWindowHours}h per ask`,
    rules.maxExtensions === 0
      ? 'no extensions'
      : `up to ${rules.maxExtensions} extension${rules.maxExtensions === 1 ? '' : 's'} of at most ${rules.maxExtensionHoursEach}h each`,
    rules.allowReopenAfterClose
      ? `reopening allowed for ${rules.reopenWithinHours}h after close`
      : 'no reopening after close',
    `clarifications close ${rules.clarificationCutoffHours}h before each deadline`,
    rules.cascade === 'SHIFT'
      ? 'an extension shifts the asks behind it'
      : 'an extension is absorbed before the next ask',
  ];
  return `${parts.join(', ')}.`;
}

/** The default schedule for a set of asks — three days each, starting now. */
export function defaultScheduleInput(now: ServerMillis, hours = 72): ScheduleInput {
  return { startAt: roundToNextHour(now), defaultHours: hours };
}

export function roundToNextHour(at: ServerMillis): ServerMillis {
  return Math.ceil(at / HOUR_MS) * HOUR_MS;
}

/** Days between two instants, for a duration shown in a summary. */
export function daysBetween(from: ServerMillis, to: ServerMillis): number {
  return Math.max(0, Math.round(((to - from) / DAY_MS) * 10) / 10);
}
