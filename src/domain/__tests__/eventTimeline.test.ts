/**
 * Deadlines, and what it takes to move one.
 *
 * The assertions that matter here are the refusals. Anyone can add hours to a
 * date; the product's job is to say no when the rules the event was published
 * under say no — a third extension where two were allowed, a reopen on an event
 * that forbids reopening, a long extension with nobody but the requester
 * behind it — and to say why, in words a buyer can act on.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMELINE_RULES, HOUR_MS, applyExtension, buildSchedule, clarificationsOpen,
  describeRules, extensionAllowance, extensionIssues, rescheduleAfterExtension,
  resolveTimelineRules, timelineStatus, validateSchedule,
  type EventExtension, type ExtensionContext, type ExtensionRequest, type StageSchedule,
  type TimelineRules,
} from '../eventTimeline';

/** A Monday, 09:00 UTC, so the weekend warning is not firing by accident. */
const MONDAY = Date.UTC(2026, 0, 5, 9, 0, 0);

const rulesWith = (over: Partial<TimelineRules> = {}): TimelineRules =>
  resolveTimelineRules({ gapHoursBetweenStages: 0, ...over });

const schedule = (
  stages: Parameters<typeof buildSchedule>[0], hours = 72, rules = rulesWith(),
) => buildSchedule(stages, { startAt: MONDAY, defaultHours: hours }, rules);

describe('building a schedule', () => {
  it('runs the asks back to back from one start', () => {
    const windows = schedule(['RFI', 'RFP', 'RFQ']);
    expect(windows[0].opensAt).toBe(MONDAY);
    expect(windows[1].opensAt).toBe(windows[0].closesAt);
    expect(windows[2].opensAt).toBe(windows[1].closesAt);
  });

  it('leaves the configured gap between them', () => {
    const windows = schedule(['RFI', 'RFP'], 24, rulesWith({ gapHoursBetweenStages: 48 }));
    expect(windows[1].opensAt - windows[0].closesAt).toBe(48 * HOUR_MS);
  });

  it('gives a stage its own length when one is set', () => {
    const windows = buildSchedule(
      ['RFI', 'AUCTION'],
      { startAt: MONDAY, defaultHours: 72, stageHours: { AUCTION: 2 } },
      rulesWith(),
    );
    expect(windows[1].durationHours).toBe(2);
  });

  it('uses a window the buyer pinned, and carries on from it', () => {
    const pinned = { opensAt: MONDAY + 10 * HOUR_MS, closesAt: MONDAY + 100 * HOUR_MS };
    const windows = buildSchedule(
      ['RFI', 'RFP'], { startAt: MONDAY, defaultHours: 24, fixed: { RFI: pinned } }, rulesWith(),
    );
    expect(windows[0]).toMatchObject(pinned);
    expect(windows[1].opensAt).toBe(pinned.closesAt);
  });

  it('closes clarifications ahead of each deadline', () => {
    const [window] = schedule(['RFQ'], 72, rulesWith({ clarificationCutoffHours: 24 }));
    expect(window.closesAt - window.clarificationsCloseAt).toBe(24 * HOUR_MS);
  });

  it('never puts the clarification cutoff before the ask opens', () => {
    const [window] = schedule(['RFQ'], 12, rulesWith({ clarificationCutoffHours: 48 }));
    expect(window.clarificationsCloseAt).toBe(window.opensAt);
  });
});

describe('validating a schedule', () => {
  const blocking = (windows: StageSchedule[], rules = rulesWith()) =>
    validateSchedule(windows, rules, MONDAY).filter((issue) => issue.blocking);

  it('passes a schedule that follows the rules', () => {
    expect(blocking(schedule(['RFI', 'RFP', 'RFQ']))).toEqual([]);
  });

  it('refuses an ask that closes before it opens', () => {
    const windows = schedule(['RFQ']);
    windows[0].closesAt = windows[0].opensAt - HOUR_MS;
    expect(blocking(windows)[0].message).toContain('closes before it opens');
  });

  it('refuses a window shorter than the rule for this event', () => {
    const issues = blocking(schedule(['RFQ'], 12, rulesWith({ minResponseWindowHours: 48 })));
    expect(issues[0].message).toContain('minimum of 48h');
  });

  it('holds an auction to its own floor, not to the written-ask minimum', () => {
    // An auction running for days is not a live event, so the hours rule that
    // protects a supplier's pricing time does not apply to it.
    expect(blocking(schedule(['AUCTION'], 2))).toEqual([]);
    const tooShort = blocking(schedule(['AUCTION'], 0.05));
    expect(tooShort[0].message).toContain('not long enough');
  });

  it('refuses asks that overlap', () => {
    const windows = schedule(['RFI', 'RFP']);
    windows[1].opensAt = windows[0].closesAt - HOUR_MS;
    expect(blocking(windows)[0].message).toContain('opens before');
  });

  it('refuses a window longer than the maximum', () => {
    const issues = blocking(schedule(['RFQ'], 24 * 90, rulesWith({ maxResponseWindowDays: 60 })));
    expect(issues[0].message).toContain('60-day maximum');
  });

  it('warns about a weekend deadline without blocking it', () => {
    // Monday 09:00 + 96h lands on Friday; + 120h lands on Saturday.
    const issues = validateSchedule(schedule(['RFQ'], 120), rulesWith(), MONDAY);
    const weekend = issues.find((issue) => issue.message.includes('weekend'));
    expect(weekend?.blocking).toBe(false);
  });

  it('warns when the clarification cutoff swallows the whole window', () => {
    const issues = validateSchedule(
      schedule(['RFQ'], 48, rulesWith({ clarificationCutoffHours: 48, minResponseWindowHours: 24 })),
      rulesWith({ clarificationCutoffHours: 48, minResponseWindowHours: 24 }),
      MONDAY,
    );
    expect(issues.some((i) => i.message.includes('no question could ever be asked'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

const WINDOW = { stage: 'RFQ' as const, opensAt: MONDAY, closesAt: MONDAY + 72 * HOUR_MS };

function extension(over: Partial<EventExtension> = {}): EventExtension {
  return {
    id: 'ext-1', eventId: 'evt-rfq', stage: 'RFQ', sequence: 1,
    previousCloseAt: WINDOW.closesAt - 24 * HOUR_MS, newCloseAt: WINDOW.closesAt,
    addedHours: 24, reason: 'CLARIFICATION_PENDING', narrative: 'Two answers still outstanding.',
    notifyChannels: ['EMAIL'], notifyAudience: 'ALL_INVITED', corrigendumReference: null,
    reopenClarifications: true, isReopen: false, requestedBy: 'user-ar', approvedBy: null,
    createdAt: MONDAY,
    ...over,
  };
}

function context(over: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    history: [],
    rules: rulesWith(),
    now: MONDAY + HOUR_MS,
    window: WINDOW,
    nextOpensAt: null,
    issued: true,
    ...over,
  };
}

function request(over: Partial<ExtensionRequest> = {}): ExtensionRequest {
  return {
    eventId: 'evt-rfq',
    stage: 'RFQ',
    currentCloseAt: WINDOW.closesAt,
    newCloseAt: WINDOW.closesAt + 24 * HOUR_MS,
    reason: 'CLARIFICATION_PENDING',
    narrative: 'Two clarifications on the specification are still unanswered.',
    notifyChannels: ['EMAIL', 'IN_APP'],
    notifyAudience: 'ALL_INVITED',
    corrigendumReference: null,
    reopenClarifications: true,
    requestedBy: 'user-ar',
    approvedBy: null,
    ...over,
  };
}

const messages = (issues: { message: string; blocking: boolean }[]) =>
  issues.filter((i) => i.blocking).map((i) => i.message).join(' | ');

describe('what is left of the extension budget', () => {
  it('counts what has been used and what remains', () => {
    const allowance = extensionAllowance(context({
      history: [extension({ addedHours: 24 })],
      rules: rulesWith({ maxExtensions: 3, maxTotalExtensionHours: 96 }),
    }));
    expect(allowance.used).toBe(1);
    expect(allowance.remaining).toBe(2);
    expect(allowance.hoursUsed).toBe(24);
    expect(allowance.hoursRemaining).toBe(72);
    expect(allowance.blockedReason).toBeNull();
  });

  it('blocks once every extension has been used', () => {
    const allowance = extensionAllowance(context({
      history: [extension(), extension({ id: 'e2', sequence: 2 })],
      rules: rulesWith({ maxExtensions: 2 }),
    }));
    expect(allowance.remaining).toBe(0);
    expect(allowance.blockedReason).toContain('All 2 extensions have been used');
  });

  it('blocks outright on an event that allows none', () => {
    const allowance = extensionAllowance(context({ rules: rulesWith({ maxExtensions: 0 }) }));
    expect(allowance.blockedReason).toContain('does not allow extensions');
  });

  it('blocks a closed ask when reopening is not allowed', () => {
    const allowance = extensionAllowance(context({
      now: WINDOW.closesAt + HOUR_MS,
      rules: rulesWith({ allowReopenAfterClose: false }),
    }));
    expect(allowance.blockedReason).toContain('reopening a closed ask is not allowed');
  });

  it('allows a reopen inside the reopen window, and refuses it after', () => {
    const rules = rulesWith({ allowReopenAfterClose: true, reopenWithinHours: 24 });
    expect(extensionAllowance(context({ now: WINDOW.closesAt + HOUR_MS, rules })).blockedReason)
      .toBeNull();
    expect(extensionAllowance(context({ now: WINDOW.closesAt + 30 * HOUR_MS, rules })).blockedReason)
      .toContain('that has passed');
  });

  it('reports the latest date the ask could be moved to', () => {
    const allowance = extensionAllowance(context({
      rules: rulesWith({ maxExtensionHoursEach: 24 }),
    }));
    expect(allowance.latestPossibleCloseAt).toBe(WINDOW.closesAt + 24 * HOUR_MS);
  });

  it('stops that at the next ask when the event absorbs extensions', () => {
    const allowance = extensionAllowance(context({
      rules: rulesWith({ cascade: 'ABSORB', maxExtensionHoursEach: 48 }),
      nextOpensAt: WINDOW.closesAt + 12 * HOUR_MS,
    }));
    expect(allowance.latestPossibleCloseAt).toBe(WINDOW.closesAt + 12 * HOUR_MS);
  });
});

describe('refusing an extension', () => {
  it('accepts one that follows every rule', () => {
    expect(extensionIssues(request(), context()).filter((i) => i.blocking)).toEqual([]);
  });

  it('refuses one that does not move the date forward', () => {
    expect(messages(extensionIssues(request({ newCloseAt: WINDOW.closesAt }), context())))
      .toContain('must move the deadline later');
  });

  it('refuses one longer than a single extension may be', () => {
    const issues = extensionIssues(
      request({ newCloseAt: WINDOW.closesAt + 96 * HOUR_MS }),
      context({ rules: rulesWith({ maxExtensionHoursEach: 24, approvalRequiredBeyondHours: 999 }) }),
    );
    expect(messages(issues)).toContain('may add at most 24h');
  });

  it('refuses one that would overspend the total budget', () => {
    const issues = extensionIssues(
      request({ newCloseAt: WINDOW.closesAt + 24 * HOUR_MS }),
      context({
        history: [extension({ addedHours: 40 })],
        rules: rulesWith({ maxTotalExtensionHours: 48, maxExtensions: 5 }),
      }),
    );
    expect(messages(issues)).toContain('of the total extension budget is left');
  });

  it('refuses one raised against a deadline that has since moved', () => {
    const issues = extensionIssues(
      request({ currentCloseAt: WINDOW.closesAt - HOUR_MS }), context(),
    );
    expect(messages(issues)).toContain('changed while this was open');
  });

  it('refuses to extend an ask that has not been issued', () => {
    const issues = extensionIssues(request(), context({ issued: false }));
    expect(messages(issues)).toContain('has not been issued yet');
  });

  it('refuses one that runs past the next ask when extensions are absorbed', () => {
    const issues = extensionIssues(request(), context({
      rules: rulesWith({ cascade: 'ABSORB' }),
      nextOpensAt: WINDOW.closesAt + 2 * HOUR_MS,
    }));
    expect(messages(issues)).toContain('runs past the next ask');
  });

  it('allows the same extension when the event shifts what follows', () => {
    const issues = extensionIssues(request(), context({
      rules: rulesWith({ cascade: 'SHIFT' }),
      nextOpensAt: WINDOW.closesAt + 2 * HOUR_MS,
    }));
    expect(issues.filter((i) => i.blocking)).toEqual([]);
  });

  it('requires a reason long enough to be worth sending', () => {
    const issues = extensionIssues(request({ narrative: 'more time' }), context());
    expect(messages(issues)).toContain('at least 20 characters');
  });

  it('requires the corrigendum reference when the reason is a corrigendum', () => {
    const issues = extensionIssues(
      request({ reason: 'CORRIGENDUM_ISSUED', corrigendumReference: null }), context(),
    );
    expect(messages(issues)).toContain('Reference the corrigendum');
  });

  it('requires at least one channel to tell suppliers on', () => {
    expect(messages(extensionIssues(request({ notifyChannels: [] }), context())))
      .toContain('at least one channel');
  });

  it('requires a second approver past the threshold, and refuses self-approval', () => {
    const long = request({ newCloseAt: WINDOW.closesAt + 72 * HOUR_MS });
    const rules = rulesWith({ approvalRequiredBeyondHours: 48, maxExtensionHoursEach: 96 });
    expect(messages(extensionIssues(long, context({ rules }))))
      .toContain('needs a second authorised approver');
    expect(messages(extensionIssues(
      { ...long, approvedBy: 'user-ar' }, context({ rules }),
    ))).toContain('must be someone other than the person requesting it');
    expect(extensionIssues({ ...long, approvedBy: 'user-js' }, context({ rules }))
      .filter((i) => i.blocking)).toEqual([]);
  });

  it('names every problem at once rather than one at a time', () => {
    const issues = extensionIssues(
      request({ narrative: 'x', notifyChannels: [], newCloseAt: WINDOW.closesAt }), context(),
    );
    expect(issues.filter((i) => i.blocking).length).toBeGreaterThanOrEqual(3);
  });
});

describe('granting an extension', () => {
  const windows = schedule(['RFQ', 'AUCTION'], 72);

  it('records what was decided, and by whom', () => {
    const { extension: granted } = applyExtension(
      request({ newCloseAt: WINDOW.closesAt + 24 * HOUR_MS }), context(), windows,
    );
    expect(granted).toMatchObject({
      stage: 'RFQ',
      sequence: 1,
      previousCloseAt: WINDOW.closesAt,
      newCloseAt: WINDOW.closesAt + 24 * HOUR_MS,
      addedHours: 24,
      reason: 'CLARIFICATION_PENDING',
      isReopen: false,
      requestedBy: 'user-ar',
    });
    expect(granted.createdAt).toBe(MONDAY + HOUR_MS);
  });

  it('numbers each extension of an ask in turn', () => {
    const { extension: second } = applyExtension(
      request(),
      context({ history: [extension()], rules: rulesWith({ maxExtensions: 3 }) }),
      windows,
    );
    expect(second.sequence).toBe(2);
  });

  it('marks an extension granted after the close as a reopen', () => {
    const closed = context({
      now: WINDOW.closesAt + HOUR_MS,
      rules: rulesWith({ allowReopenAfterClose: true, reopenWithinHours: 24 }),
    });
    const { extension: granted } = applyExtension(
      request({ newCloseAt: WINDOW.closesAt + 24 * HOUR_MS }), closed, windows,
    );
    expect(granted.isReopen).toBe(true);
  });

  it('throws rather than granting something the rules refuse', () => {
    expect(() => applyExtension(request({ narrative: 'no' }), context(), windows))
      .toThrow(/Extension refused/);
  });
});

describe('what happens to the asks behind it', () => {
  const windows = schedule(['RFI', 'RFP', 'RFQ'], 72);
  const newClose = windows[0].closesAt + 24 * HOUR_MS;

  it('shifts every later ask by the same amount', () => {
    const after = rescheduleAfterExtension(windows, 'RFI', newClose, rulesWith({ cascade: 'SHIFT' }));
    expect(after[0].closesAt).toBe(newClose);
    expect(after[1].opensAt).toBe(windows[1].opensAt + 24 * HOUR_MS);
    expect(after[2].closesAt).toBe(windows[2].closesAt + 24 * HOUR_MS);
  });

  it('absorbs it so the event still ends when it always did', () => {
    const after = rescheduleAfterExtension(windows, 'RFI', newClose, rulesWith({ cascade: 'ABSORB' }));
    expect(after[0].closesAt).toBe(newClose);
    // The next ask starts later but still closes on its original date, and
    // nothing beyond it moves at all.
    expect(after[1].opensAt).toBe(newClose);
    expect(after[1].closesAt).toBe(windows[1].closesAt);
    expect(after[2]).toMatchObject({
      opensAt: windows[2].opensAt, closesAt: windows[2].closesAt,
    });
  });

  it('leaves the asks before it alone either way', () => {
    for (const cascade of ['SHIFT', 'ABSORB'] as const) {
      const after = rescheduleAfterExtension(
        windows, 'RFQ', windows[2].closesAt + HOUR_MS, rulesWith({ cascade }),
      );
      expect(after[0]).toEqual(windows[0]);
      expect(after[1]).toEqual(windows[1]);
    }
  });
});

describe('reading a schedule', () => {
  const [window] = schedule(['RFQ'], 72);

  it('says where an ask stands against the clock', () => {
    expect(timelineStatus(window, window.opensAt - HOUR_MS)).toBe('NOT_OPEN');
    expect(timelineStatus(window, window.opensAt + HOUR_MS)).toBe('OPEN');
    expect(timelineStatus(window, window.closesAt - 2 * HOUR_MS)).toBe('CLOSING_SOON');
    expect(timelineStatus(window, window.closesAt)).toBe('CLOSED');
  });

  it('closes clarifications before the ask itself closes', () => {
    expect(clarificationsOpen(window, window.opensAt + HOUR_MS)).toBe(true);
    expect(clarificationsOpen(window, window.clarificationsCloseAt)).toBe(false);
    expect(clarificationsOpen(window, window.opensAt - HOUR_MS)).toBe(false);
  });

  it('describes the rules in one sentence a buyer can check', () => {
    const sentence = describeRules(DEFAULT_TIMELINE_RULES);
    expect(sentence).toContain('Minimum 48h per ask');
    expect(sentence).toContain('up to 2 extensions of at most 24h each');
    expect(sentence).toContain('no reopening after close');
    expect(describeRules(rulesWith({ maxExtensions: 0 }))).toContain('no extensions');
  });

  it('fills unstated rules from the default rather than leaving them undefined', () => {
    const rules = resolveTimelineRules({ maxExtensions: 5 });
    expect(rules.maxExtensions).toBe(5);
    expect(rules.minResponseWindowHours).toBe(DEFAULT_TIMELINE_RULES.minResponseWindowHours);
  });
});
