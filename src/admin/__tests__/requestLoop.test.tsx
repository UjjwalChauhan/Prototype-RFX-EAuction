/**
 * The written round trip, for each of the three asks.
 *
 * An RFI, an RFP and an RFQ are one shape of work: the buyer issues it, the
 * supplier finds it in their Requests screen under that heading, answers the
 * questions, and the answers come back to the buyer in the section the ask was
 * issued from. This file drives that loop end to end on the seeded world —
 * the one a person actually sees when they open the prototype — rather than on
 * a fixture built to make it pass.
 *
 * It exists because none of it worked. The RFI and RFP sections listed events
 * with nobody invited to them, the RFQ section was empty, no ask carried a
 * questionnaire, and a single event was filed under four headings at once so
 * answering one flipped the other three to "Submitted".
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, initialState, reducer, type AppState } from '../../store/store';
import { localApi } from '../../api/client';
import { StageList } from '../IntakeAndLists';
import { ResponsesTab } from '../tabs/ResponsesTab';
import { PortalRequests } from '../../portal/PortalRequests';
import {
  REQUEST_POINTS, askPointOf, askableQuestions, toAnswers, vendorSections,
  type AnswerDraft,
} from '../../domain/vendorPortal';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import { CATEGORY_TEMPLATES, TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import { seedQuestionnaires } from '../../domain/questionnaireTemplates';
import { serverNow } from '../../server/clock';
import type { Question, Response, VendorInputPoint } from '../../domain/types';

const paint = (state: AppState, node: React.ReactNode) =>
  renderToString(<StoreProvider seed={state}>{node}</StoreProvider>)
    .replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/').replace(/\s+/g, ' ');

/** The one live ask standing at this point in the seeded world. */
function liveAsk(state: AppState, point: 'RFI' | 'RFP' | 'RFQ') {
  const event = state.events.find(
    (e) => e.currentStage === point && (e.status === 'OPEN' || e.status === 'PUBLISHED'),
  );
  if (!event) throw new Error(`Nothing is standing at ${point} — the section has nothing to show.`);
  const bidders = state.bidders.filter((b) => b.eventId === event.id);
  const questionnaire = state.questionnaires.find(
    (q) => q.eventId === event.id && q.stage === point,
  );
  return { event, bidders, questionnaire };
}

/**
 * Answer every question the way the portal's own submit button does — through
 * the same `toAnswers`, against the same questionnaire — so what lands in the
 * buyer's store is what a supplier pressing the button would actually send.
 */
function answerAll(questions: Question[]): AnswerDraft {
  const draft: AnswerDraft = {};
  for (const question of askableQuestions(questions)) {
    const value =
      question.type === 'yes_no' ? true
        : question.type === 'number' ? 12
          : question.type === 'single_choice' || question.type === 'multiple_choice'
            ? (question.config?.options?.[0]?.id ?? 'yes')
            : 'Answered in full.';
    draft[question.id] = { value, attachmentName: null };
  }
  return draft;
}

function submit(
  state: AppState, point: 'RFI' | 'RFP' | 'RFQ', bidderIndex = 0,
): { state: AppState; response: Response } {
  const { event, bidders, questionnaire } = liveAsk(state, point);
  const bidder = bidders[bidderIndex];
  const questions = askableQuestions(questionnaire?.questions ?? []);
  const response: Response = {
    id: `resp-${event.id}-${bidder.id}`,
    eventId: event.id,
    bidderId: bidder.id,
    version: 1,
    submittedAt: serverNow(),
    answers: toAnswers(questions, answerAll(questions)),
    priceLines: [],
  };
  return { state: reducer(state, { type: 'SUBMIT_RESPONSE', response }), response };
}

/** The three written asks, narrowed — `REQUEST_POINTS` is these three. */
const WRITTEN = REQUEST_POINTS as ('RFI' | 'RFP' | 'RFQ')[];

describe.each(WRITTEN)('%s', (point) => {
  const state = initialState();

  it('has a live ask standing in the section', () => {
    const { event } = liveAsk(state, point);
    const html = paint(state, <StageList stage={point} onNavigate={() => {}} />);
    expect(html).toContain(event.eventNumber);
    expect(html).toContain(event.title);
  });

  it('has suppliers invited to it, or nobody can answer', () => {
    const { bidders } = liveAsk(state, point);
    expect(bidders.length).toBeGreaterThan(0);
  });

  it('has questions behind it, or the form opens empty', () => {
    const { questionnaire } = liveAsk(state, point);
    expect(askableQuestions(questionnaire?.questions ?? []).length).toBeGreaterThan(0);
  });

  it('shows the buyer that nothing has come back yet', () => {
    const { bidders } = liveAsk(state, point);
    const html = paint(state, <StageList stage={point} onNavigate={() => {}} />);
    expect(html).toContain(`0 / ${bidders.length}`);
  });

  it('reaches an invited supplier as waiting on them', () => {
    const { event, bidders } = liveAsk(state, point);
    const sections = vendorSections({
      events: state.events, bidders: state.bidders, responses: state.responses,
      counterpartyId: bidders[0].counterpartyId, now: serverNow(),
    });
    const section = sections.find((s) => s.point === point)!;
    expect(section.active.map((i) => i.event.id)).toContain(event.id);
  });

  it('is filed under this heading and no other', () => {
    const { event } = liveAsk(state, point);
    expect(askPointOf(event)).toBe(point);
  });

  it('appears on the supplier’s Requests screen, under this heading', () => {
    const { event, bidders } = liveAsk(state, point);
    const html = paint(
      state,
      <PortalRequests
        counterpartyId={bidders[0].counterpartyId}
        points={REQUEST_POINTS}
        heading="Requests"
        blurb=""
      />,
    );
    // The screen opens on whichever ask has work, so a supplier holding two
    // lands on one of them. Both must be reachable and counted.
    expect(html).toContain(`${point} 1 waiting on you`);

    // And the one it opens on shows the ask itself.
    const onlyThis = bidders
      .map((b) => b.counterpartyId)
      .find((counterpartyId) => {
        const sections = vendorSections({
          events: state.events, bidders: state.bidders, responses: state.responses,
          counterpartyId, now: serverNow(),
        });
        const waiting = sections.filter((s) => s.active.length > 0).map((s) => s.point);
        return waiting.length === 1 && waiting[0] === point;
      });
    if (onlyThis) {
      const alone = paint(
        state,
        <PortalRequests
          counterpartyId={onlyThis} points={REQUEST_POINTS} heading="Requests" blurb=""
        />,
      );
      expect(alone).toContain(event.title);
      expect(alone).toContain('Open and respond');
    }
  });

  it('opens the ask onto the questions the buyer published', () => {
    const { questionnaire } = liveAsk(state, point);
    const asked = askableQuestions(questionnaire!.questions);
    expect(asked.length).toBeGreaterThan(0);
    // Every question the buyer shaped can be answered and sent back; an ask
    // whose questionnaire produces nothing is an empty form.
    expect(toAnswers(asked, answerAll(asked))).toHaveLength(asked.length);
  });

  it('does not reach a supplier who was not invited', () => {
    const { event, bidders } = liveAsk(state, point);
    const invited = new Set(bidders.map((b) => b.counterpartyId));
    const outsider = Object.keys(COUNTERPARTY_NAMES).find((id) => !invited.has(id))!;
    const sections = vendorSections({
      events: state.events, bidders: state.bidders, responses: state.responses,
      counterpartyId: outsider, now: serverNow(),
    });
    for (const section of sections) {
      expect([...section.active, ...section.past].map((i) => i.event.id)).not.toContain(event.id);
    }
  });

  it('carries the submitted answers back to the buyer', () => {
    const { state: after, response } = submit(state, point);
    const { event } = liveAsk(after, point);
    expect(response.answers.length).toBeGreaterThan(0);
    const html = paint(after, <ResponsesTab eventId={event.id} />);
    expect(html).toContain('1 of');
    expect(html).toContain('have answered');
  });

  it('counts the response in the section it was issued from', () => {
    const { state: after } = submit(state, point);
    const { bidders } = liveAsk(after, point);
    const html = paint(after, <StageList stage={point} onNavigate={() => {}} />);
    expect(html).toContain(`1 / ${bidders.length}`);
  });

  it('moves the ask out of the supplier’s Active pile once answered', () => {
    const { state: after } = submit(state, point);
    const { event, bidders } = liveAsk(after, point);
    const sections = vendorSections({
      events: after.events, bidders: after.bidders, responses: after.responses,
      counterpartyId: bidders[0].counterpartyId, now: serverNow(),
    });
    const section = sections.find((s) => s.point === point)!;
    expect(section.active.map((i) => i.event.id)).not.toContain(event.id);
    expect(section.past.map((i) => i.event.id)).toContain(event.id);
    expect(section.past.find((i) => i.event.id === event.id)!.standing).toContain('Submitted');
  });

  it('leaves the other two sections alone', () => {
    const { state: after } = submit(state, point);
    const { bidders } = liveAsk(after, point);
    const sections = vendorSections({
      events: after.events, bidders: after.bidders, responses: after.responses,
      counterpartyId: bidders[0].counterpartyId, now: serverNow(),
    });
    // One response answers one ask. Before this, a single event was filed
    // under RFI, RFP and RFQ at once and answering it marked all three
    // submitted — the supplier was told they had answered asks never sent.
    for (const other of WRITTEN.filter((p) => p !== point)) {
      const section = sections.find((s) => s.point === other)!;
      for (const item of section.past) {
        expect(item.standing).not.toContain('Submitted');
      }
    }
  });
});

describe('the three asks are three separate pieces of work', () => {
  const state = initialState();

  it('stands one live ask in each section', () => {
    const numbers = WRITTEN.map((point) => liveAsk(state, point).event.eventNumber);
    expect(new Set(numbers).size).toBe(3);
  });

  it('answers only the ask that was answered', () => {
    const { state: after } = submit(state, 'RFI');
    const answered = liveAsk(after, 'RFI').event.id;
    for (const point of ['RFP', 'RFQ'] as const) {
      const { event } = liveAsk(after, point);
      expect(event.id).not.toBe(answered);
      const back = after.responses.filter(
        (r) => r.eventId === event.id && r.submittedAt !== null,
      );
      expect(back).toHaveLength(0);
    }
  });

  it('opens the portal on a supplier who has written work waiting', () => {
    // cp-abc holds the RFI and the RFQ; the portal must not open on a company
    // whose only invitation is to an auction that closed a week ago.
    const sections = vendorSections({
      events: state.events, bidders: state.bidders, responses: state.responses,
      counterpartyId: 'cp-abc', now: serverNow(),
    });
    const active = sections.filter((s) => s.active.length > 0).map((s) => s.point);
    expect(active).toContain('RFI');
    expect(active).toContain('RFQ');
  });
});

/**
 * The same loop for an ask a buyer creates now, rather than one that was
 * seeded. A journey publishes an ask per point, each with its own deadline,
 * shortlist and questionnaire, so the round trip has to hold for those too —
 * and the answer must come back against the ask that was answered, not
 * against the sourcing event that raised it.
 */
/**
 * The questionnaires the Create Event wizard would attach, from the same
 * library call it makes.
 */
function libraryQuestionnaires(points: VendorInputPoint[], category: string) {
  return seedQuestionnaires({
    existing: [], points, category, idSeed: 'loop',
    library: [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES],
  }).map((draft) => ({
    point: draft.point,
    name: draft.templateName,
    questions: draft.questions.map(({ id: _id, templateId: _templateId, ...rest }) => rest),
  }));
}

describe('an ask created through the wizard', () => {
  async function publishLadder() {
    const before = initialState();
    const family = await localApi({ events: before.events }).createSourcingEvent({
      journeyPattern: 'JP-05',
      title: 'Facilities Management 2027',
      category: 'Facilities', businessUnit: 'Corporate Services', ownerId: 'user-ar',
      lines: [{
        description: 'HVAC maintenance', quantity: 96, uom: 'visit',
        baselinePrice: 2400, lotName: 'Lot 1 · Hard services',
      }],
      bidders: [{ counterpartyId: 'cp-abc' }],
      // What the wizard's Questionnaire step puts on the draft. Passed here
      // for the same reason: an ask published without one opens as an empty
      // form, and `createSourcingEvent` builds only what it is given.
      questionnaires: libraryQuestionnaires(['RFI', 'RFP', 'RFQ'], 'Facilities'),
      timeline: { closesInHours: 72 },
    });
    const state = reducer(before, {
      type: 'CREATE_EVENT', event: family.event, stageEvents: family.stageEvents,
      lots: family.lots, lineItems: family.lineItems, bidders: family.bidders,
      questionnaires: family.questionnaires, sourcedLineIds: [],
    });
    const ask = family.stageEvents.find((e) => e.currentStage === 'RFI')!;
    return { state, family, ask };
  }

  it('reaches the invited supplier under the ask it is', async () => {
    const { state, ask } = await publishLadder();
    expect(askPointOf(ask)).toBe('RFI');
    const sections = vendorSections({
      events: state.events, bidders: state.bidders, responses: state.responses,
      counterpartyId: 'cp-abc', now: serverNow(),
    });
    const rfi = sections.find((s) => s.point === 'RFI')!;
    expect(rfi.active.map((i) => i.event.id)).toContain(ask.id);
  });

  it('carries the answers back into the section it was issued from', async () => {
    const { state, family, ask } = await publishLadder();
    const questionnaire = family.questionnaires.find((q) => q.eventId === ask.id)!;
    const asked = askableQuestions(questionnaire.questions);
    expect(asked.length).toBeGreaterThan(0);

    const bidder = state.bidders.find((b) => b.eventId === ask.id)!;
    const after = reducer(state, {
      type: 'SUBMIT_RESPONSE',
      response: {
        id: `resp-${ask.id}-${bidder.id}`, eventId: ask.id, bidderId: bidder.id,
        version: 1, submittedAt: serverNow(),
        answers: toAnswers(asked, answerAll(asked)), priceLines: [],
      },
    });

    const section = paint(after, <StageList stage="RFI" onNavigate={() => {}} />);
    expect(section).toContain(ask.eventNumber);
    expect(section).toContain('1 / 1');

    const responses = paint(after, <ResponsesTab eventId={ask.id} />);
    expect(responses).toContain('1 of 1 have answered');
  });

  it('does not credit the answer to a sibling ask', async () => {
    const { state, family, ask } = await publishLadder();
    const questionnaire = family.questionnaires.find((q) => q.eventId === ask.id)!;
    const asked = askableQuestions(questionnaire.questions);
    const bidder = state.bidders.find((b) => b.eventId === ask.id)!;
    const after = reducer(state, {
      type: 'SUBMIT_RESPONSE',
      response: {
        id: `resp-${ask.id}-${bidder.id}`, eventId: ask.id, bidderId: bidder.id,
        version: 1, submittedAt: serverNow(),
        answers: toAnswers(asked, answerAll(asked)), priceLines: [],
      },
    });
    for (const sibling of family.stageEvents.filter((e) => e.id !== ask.id)) {
      const back = after.responses.filter(
        (r) => r.eventId === sibling.id && r.submittedAt !== null,
      );
      expect(back).toHaveLength(0);
    }
  });
});
