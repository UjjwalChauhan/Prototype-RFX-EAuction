/**
 * The timeline, from the wizard's rules to a deadline actually moving.
 *
 * Tested as one chain rather than as parts: publish with a set of rules, read
 * them back off the event they were frozen onto, extend an ask through the
 * store, and check that the asks behind it moved the way the cascade rule said
 * they would — and that the second extension is refused when only one was
 * allowed.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimelineTab } from '../tabs/TimelineTab';
import { localApi } from '../../api/client';
import {
  StoreProvider, initialState, reducer, scheduleOf, timelineRulesOf, type AppState,
} from '../../store/store';
import {
  HOUR_MS, applyExtension, extensionAllowance, type ExtensionRequest, type TimelineRules,
} from '../../domain/eventTimeline';
import { solicitationStagesOf, type SourcingEventInput } from '../../domain/stageEvents';
import { INITIAL_DRAFT, TimelineStep, type Draft } from '../CreateEventWizard';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

function ladder(rules: Partial<TimelineRules>): SourcingEventInput {
  return {
    journeyPattern: 'JP-05',
    title: 'Facilities Management 2026',
    category: 'Facilities',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    lines: [{ description: 'HVAC maintenance', quantity: 96, uom: 'visit', baselinePrice: 2_400, lotName: 'Lot 1' }],
    bidders: [{ counterpartyId: 'cp-abc' }],
    timeline: { opensAt: NOW, closesInHours: 72, rules },
  };
}

/** Publish, and put what comes back into the store — what the wizard does. */
async function published(rules: Partial<TimelineRules> = {}) {
  const before = initialState();
  const family = await localApi({ events: before.events }, { now: () => NOW })
    .createSourcingEvent(ladder(rules));
  const state = reducer(before, {
    type: 'CREATE_EVENT',
    event: family.event,
    stageEvents: family.stageEvents,
    lots: family.lots,
    lineItems: family.lineItems,
    bidders: family.bidders,
    questionnaires: family.questionnaires,
    sourcedLineIds: [],
  });
  return { state, family };
}

describe('the rules the event was published under', () => {
  it('are frozen onto the event and read back off it', async () => {
    const { state, family } = await published({ maxExtensions: 1, cascade: 'ABSORB' });
    const rules = timelineRulesOf(state, family.event.id);
    expect(rules.maxExtensions).toBe(1);
    expect(rules.cascade).toBe('ABSORB');
    // Anything the buyer did not state falls back to the default, not to undefined.
    expect(rules.minResponseWindowHours).toBe(48);
  });

  it('are read the same way from any ask in the family', async () => {
    const { state, family } = await published({ maxExtensions: 4 });
    for (const ask of family.stageEvents) {
      expect(timelineRulesOf(state, ask.id).maxExtensions).toBe(4);
    }
  });
});

describe('the schedule the store reports', () => {
  it('gives every ask a window, running in journey order', async () => {
    const { state, family } = await published();
    const schedule = scheduleOf(state, family.event.id);
    expect(schedule.map((ask) => ask.stage)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(schedule[0].window.opensAt).toBe(NOW);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i].window.opensAt).toBe(schedule[i - 1].window.closesAt);
    }
  });

  it('derives the opening from the ask before it, so only one date is stored', async () => {
    const { state, family } = await published();
    const schedule = scheduleOf(state, family.event.id);
    for (const ask of schedule) {
      expect(ask.window.closesAt).toBe(ask.event.closesAt);
    }
  });

  it('closes clarifications ahead of each deadline', async () => {
    const { state, family } = await published({ clarificationCutoffHours: 12 });
    for (const ask of scheduleOf(state, family.event.id)) {
      if (ask.stage === 'AUCTION') continue;
      expect(ask.window.closesAt - ask.window.clarificationsCloseAt).toBe(12 * HOUR_MS);
    }
  });
});

describe('moving a deadline', () => {
  /** Extend one ask exactly as the dialog does, and put it through the store. */
  async function extend(rules: Partial<TimelineRules>, over: Partial<ExtensionRequest> = {}) {
    const { state, family } = await published(rules);
    const schedule = scheduleOf(state, family.event.id);
    const rfi = schedule[0];
    const context = {
      history: rfi.extensions,
      rules: timelineRulesOf(state, family.event.id),
      now: NOW + HOUR_MS,
      window: rfi.window,
      nextOpensAt: schedule[1].window.opensAt,
      issued: rfi.event.status !== 'DRAFT',
    };
    const request: ExtensionRequest = {
      eventId: rfi.event.id,
      stage: 'RFI',
      currentCloseAt: rfi.window.closesAt,
      newCloseAt: rfi.window.closesAt + 24 * HOUR_MS,
      reason: 'CLARIFICATION_PENDING',
      narrative: 'Two clarifications on the specification are still unanswered.',
      notifyChannels: ['EMAIL'],
      notifyAudience: 'ALL_INVITED',
      corrigendumReference: null,
      reopenClarifications: true,
      requestedBy: 'user-ar',
      approvedBy: null,
      ...over,
    };
    const result = applyExtension(request, context, schedule.map((ask) => ask.window));
    const next = reducer(state, {
      type: 'EXTEND_EVENT',
      extension: result.extension,
      closes: schedule
        .map((ask, i) => ({ eventId: ask.event.id, closesAt: result.schedule[i].closesAt }))
        .filter((close, i) => close.closesAt !== schedule[i].window.closesAt),
    });
    return { before: state, after: next, family, schedule };
  }

  it('moves the ask, and records why', async () => {
    const { after, family } = await extend({ cascade: 'SHIFT' });
    const schedule = scheduleOf(after, family.event.id);
    expect(schedule[0].window.closesAt).toBe(NOW + 96 * HOUR_MS);
    expect(after.extensions).toHaveLength(1);
    expect(after.extensions[0]).toMatchObject({
      stage: 'RFI', sequence: 1, addedHours: 24, reason: 'CLARIFICATION_PENDING',
      requestedBy: 'user-ar',
    });
  });

  it('shifts every ask behind it when the rule says shift', async () => {
    const { before, after, family } = await extend({ cascade: 'SHIFT' });
    const was = scheduleOf(before, family.event.id);
    const now = scheduleOf(after, family.event.id);
    for (let i = 1; i < now.length; i += 1) {
      expect(now[i].window.closesAt).toBe(was[i].window.closesAt + 24 * HOUR_MS);
    }
  });

  it('leaves the end date alone when the rule says absorb', async () => {
    const { before, after, family } = await extend({ cascade: 'ABSORB', gapHoursBetweenStages: 48 });
    const was = scheduleOf(before, family.event.id);
    const now = scheduleOf(after, family.event.id);
    expect(now[0].window.closesAt).toBe(was[0].window.closesAt + 24 * HOUR_MS);
    for (let i = 1; i < now.length; i += 1) {
      expect(now[i].window.closesAt).toBe(was[i].window.closesAt);
    }
  });

  it('refuses a second extension when only one was allowed', async () => {
    const { after, family } = await extend({ maxExtensions: 1 });
    const schedule = scheduleOf(after, family.event.id);
    const allowance = extensionAllowance({
      history: schedule[0].extensions,
      rules: timelineRulesOf(after, family.event.id),
      now: NOW + 2 * HOUR_MS,
      window: schedule[0].window,
      nextOpensAt: schedule[1].window.opensAt,
      issued: true,
    });
    expect(allowance.remaining).toBe(0);
    expect(allowance.blockedReason).toContain('All 1 extensions have been used');
  });

  it('keeps the extension against the ask, not against the sourcing event', async () => {
    const { after, family } = await extend({});
    expect(after.extensions[0].eventId).toBe(family.stageEvents[0].id);
  });
});

describe('the timeline tab', () => {
  async function paint(rules: Partial<TimelineRules> = {}) {
    const { state, family } = await published(rules);
    const html = renderToString(
      <StoreProvider seed={state as AppState}>
        <TimelineTab eventId={family.event.id} />
      </StoreProvider>,
    ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    return { html, family };
  }

  it('shows the rules the event is governed by', async () => {
    const { html } = await paint({ maxExtensions: 3, maxExtensionHoursEach: 12 });
    expect(html).toContain('Rules in force');
    expect(html).toContain('up to 3 extensions of at most 12h each');
    expect(html).toContain('no reopening after close');
  });

  it('lists every ask with its window', async () => {
    const { html, family } = await paint();
    expect(html).toContain('Schedule');
    for (const ask of family.stageEvents) expect(html).toContain(ask.eventNumber);
    expect(html).toContain('Clarifications close');
  });

  it('marks the asks that have not been issued as planned, not as closed', async () => {
    const { html } = await paint();
    expect(html).toContain('planned');
  });

  it('says nothing has been extended yet rather than showing an empty table', async () => {
    const { html } = await paint();
    expect(html).toContain('No deadline has been moved on this event');
  });

  it('says an auction has no clarification cutoff', async () => {
    const { html } = await paint();
    // Every written ask has one; the auction row shows an em dash instead.
    expect(html).toContain('—');
  });
});

describe('the Timeline step of the wizard', () => {
  const paintStep = (pattern: Draft['pattern']) => {
    const draft: Draft = { ...INITIAL_DRAFT, pattern, startAt: NOW };
    return renderToString(
      <StoreProvider>
        <TimelineStep draft={draft} patch={() => {}} stages={solicitationStagesOf(pattern)} />
      </StoreProvider>,
    ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  };

  it('asks for a start date and a window per ask', () => {
    const html = paintStep('JP-05');
    expect(html).toContain('Event start');
    expect(html).toContain('Default window per ask (hours)');
    expect(html).toContain('Clarifications close');
    // One row per ask the Full Ladder creates.
    for (const label of ['RFI', 'RFP', 'RFQ', 'Auction']) expect(html).toContain(label);
  });

  it('asks for the extension rules that will govern every ask', () => {
    const html = paintStep('JP-05');
    expect(html).toContain('Extensions allowed per ask');
    expect(html).toContain('Most one extension may add (hours)');
    expect(html).toContain('Second approver needed beyond (hours)');
    expect(html).toContain('Shift the asks behind it');
    expect(html).toContain('Absorb it — keep the end date');
  });

  it('says what a buyer will have to give when they extend', () => {
    const html = paintStep('JP-02');
    expect(html).toContain('What a buyer will have to give when they extend');
    expect(html).toContain('sent to suppliers');
  });

  it('offers soft close only where there is an auction', () => {
    expect(paintStep('JP-05')).toContain('Soft close: a late bid extends the live auction');
    expect(paintStep('JP-06')).not.toContain('Soft close: a late bid extends the live auction');
  });

  it('says there is no deadline to set on a journey that solicits nobody', () => {
    expect(paintStep('JP-08')).toContain('asks suppliers for nothing');
  });
});

describe('an event that predates the split into asks', () => {
  it('is its own window, governed by the same rules', () => {
    const state = initialState();
    const html = renderToString(
      <StoreProvider seed={state}>
        <TimelineTab eventId="evt-rfi-005" />
      </StoreProvider>,
    ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&');
    expect(html).toContain('Schedule');
    expect(html).toContain('RFI-2024-005');
    // No rules were frozen onto a seeded event, so the defaults apply.
    expect(html).toContain('up to 2 extensions of at most 24h each');
  });

  it('has a schedule of exactly one row', () => {
    const state = initialState();
    const schedule = scheduleOf(state, 'evt-rfi-005');
    expect(schedule).toHaveLength(1);
    expect(schedule[0].stage).toBe('RFI');
    expect(schedule[0].window.closesAt).toBe(
      state.events.find((e) => e.id === 'evt-rfi-005')!.closesAt,
    );
  });

  it('has none at all when the event is at a stage that is not an ask', () => {
    const state = initialState();
    // A draft RFQ sits at INTAKE, which is not something a supplier answers.
    expect(scheduleOf(state, 'evt-rfq-039')).toEqual([]);
  });
});
