/**
 * A supplier's response, from the portal to the buyer's screen.
 *
 * Reported as "I cannot see the responses". The wire was carrying them — what
 * was wrong was the screen at the end of it and the one fact the wire did not
 * carry.
 *
 * The screen built a technical envelope for every invited supplier whether or
 * not they had sent anything, so four rows read "Submitted" and "not
 * submitted" at once, and the detail panel opened on the first supplier
 * alphabetically, who usually had not replied — so the first thing a buyer saw
 * was "No response submitted". The fact the wire did not carry was
 * participation: the invitation rows belong to the buyer, so a supplier who
 * had answered still showed as not started.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponsesTab } from '../tabs/ResponsesTab';
import {
  StoreProvider, initialState, participationRows, reducer, responsesForEvent, type AppState,
} from '../../store/store';
import type { Question, Response } from '../../domain/types';

const NOW = Date.now();

/**
 * A seeded event with a shortlist and nothing answered yet.
 *
 * The primary event already carries four responses, which would hide exactly
 * the thing these tests are about: what the screen does with a field where
 * most of it has not replied.
 */
const EVENT_ID = 'evt-rfp-012';

const clean = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const paint = (state: AppState, eventId: string) => clean(renderToString(
  <StoreProvider seed={state}><ResponsesTab eventId={eventId} /></StoreProvider>,
));

/** An event with a shortlist, a questionnaire and one supplier who answered. */
function answered(): { state: AppState; eventId: string; who: string; question: Question } {
  const base = initialState();
  const event = base.events.find((e) => e.id === EVENT_ID)!;
  const roster = base.bidders.filter((b) => b.eventId === event.id);
  const question: Question = {
    id: 'q-regions', questionnaireId: 'qn-1', sectionId: null, sequence: 1, code: 'Q1',
    type: 'multiple_choice', title: 'Regions you can serve', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 0, scoringMethod: 'MANUAL', maxScore: 10, rubric: '',
    isKnockout: false, allowAttachment: true,
    config: {
      options: [
        { id: 'o-n', label: 'North', score: null, isDisqualifying: false, requiresDetail: false },
        { id: 'o-s', label: 'South', score: null, isDisqualifying: false, requiresDetail: false },
      ],
    },
  };
  const withQuestions: AppState = {
    ...base,
    questionnaires: [
      ...base.questionnaires,
      {
        id: 'qn-1', eventId: event.id, stage: event.currentStage,
        name: 'Qualification', questions: [question],
      },
    ],
  };
  const response: Response = {
    id: 'r-1', eventId: event.id, bidderId: roster[roster.length - 1].id, version: 1,
    submittedAt: NOW - 60_000,
    answers: [
      { questionId: 'q-regions', value: 'o-s,o-n', attachmentName: null },
    ],
    priceLines: [],
  };
  return {
    state: reducer(withQuestions, { type: 'SUBMIT_RESPONSE', response }),
    eventId: event.id,
    who: response.bidderId,
    question,
  };
}

describe('the buyer’s Responses screen', () => {
  it('shows the response that arrived', () => {
    const { state, eventId } = answered();
    expect(responsesForEvent(state, eventId)).toHaveLength(1);
    expect(paint(state, eventId)).toContain('Regions you can serve');
  });

  it('opens on a supplier who answered, not on the first row', () => {
    const { state, eventId, who } = answered();
    const roster = state.bidders.filter((b) => b.eventId === eventId);
    // The responder is deliberately last in the list.
    expect(roster[0].id).not.toBe(who);
    const html = paint(state, eventId);
    const responder = roster.find((b) => b.id === who)!;
    expect(html).toContain(`Technical — ${responder.maskedLabel}`);
    expect(html).not.toContain('No response submitted');
  });

  it('says how many of the field have answered', () => {
    const { state, eventId } = answered();
    const roster = state.bidders.filter((b) => b.eventId === eventId);
    expect(paint(state, eventId)).toContain(`1 of ${roster.length} have answered`);
  });

  it('builds no envelope for a supplier who sent nothing', () => {
    const { state, eventId } = answered();
    const html = paint(state, eventId);
    const roster = state.bidders.filter((b) => b.eventId === eventId);
    // One "Submitted" envelope, and the rest say plainly that nothing came.
    expect(html.match(/nothing sent/g) ?? []).toHaveLength((roster.length - 1) * 2);
  });

  it('never says submitted and not submitted about the same supplier', () => {
    const { state, eventId } = answered();
    const html = paint(state, eventId);
    const rows = html.split('identity concealed for technical evaluation').slice(1);
    for (const row of rows) {
      const cell = row.slice(0, 120);
      if (cell.includes('not submitted')) expect(cell).not.toContain('✓ Submitted');
    }
  });

  it('says nothing has come in, rather than drawing an empty table', () => {
    expect(paint(initialState(), EVENT_ID)).toContain('Nothing has come in yet');
  });
});

describe('reading an answer', () => {
  it('names the options a supplier chose rather than their ids', () => {
    const { state, eventId } = answered();
    const html = paint(state, eventId);
    expect(html).toContain('South, North');
    expect(html).not.toContain('o-s,o-n');
  });

  it('calls an answer given as a document an answer', () => {
    const { state, eventId, who } = answered();
    const withFile = reducer(state, {
      type: 'SUBMIT_RESPONSE',
      response: {
        id: 'r-1', eventId, bidderId: who, version: 2, submittedAt: NOW,
        answers: [{ questionId: 'q-regions', value: '', attachmentName: 'coverage.pdf' }],
        priceLines: [],
      },
    });
    const html = paint(withFile, eventId);
    expect(html).toContain('Answered with the document below');
    expect(html).toContain('coverage.pdf');
    expect(html).not.toContain('not answered');
  });
});

describe('participation coming back from the portal', () => {
  it('sends only the suppliers who have actually started', () => {
    const { state } = answered();
    const rows = participationRows(state);
    expect(rows.every((row) => row.status !== 'NOT_STARTED')).toBe(true);
    expect(rows.some((row) => row.status === 'SUBMITTED')).toBe(true);
  });

  it('reaches the buyer, who created the invitation but cannot see this', () => {
    const { state, who } = answered();
    // The buyer's own roster still says the supplier has not begun.
    const buyer = initialState();
    expect(buyer.bidders.find((b) => b.id === who)?.participationStatus).not.toBe('SUBMITTED');

    const after = reducer(buyer, { type: 'SYNC_IN', participation: participationRows(state) });
    expect(after.bidders.find((b) => b.id === who)?.participationStatus).toBe('SUBMITTED');
  });

  it('only ever moves a supplier forward', () => {
    const { state, who } = answered();
    const submitted = reducer(initialState(), {
      type: 'SYNC_IN', participation: participationRows(state),
    });
    // A portal tab reloaded back to its seed, or a poll arriving out of order.
    const stale = reducer(submitted, {
      type: 'SYNC_IN', participation: [{ id: who, status: 'IN_PROGRESS' }],
    });
    expect(stale.bidders.find((b) => b.id === who)?.participationStatus).toBe('SUBMITTED');
  });

  it('leaves a supplier the portal said nothing about alone', () => {
    const buyer = initialState();
    const untouched = buyer.bidders[0];
    expect(untouched).toBeDefined();
    const after = reducer(buyer, {
      type: 'SYNC_IN', participation: [{ id: 'eb-nobody', status: 'SUBMITTED' }],
    });
    expect(after.bidders[0].participationStatus).toBe(untouched.participationStatus);
  });
});
