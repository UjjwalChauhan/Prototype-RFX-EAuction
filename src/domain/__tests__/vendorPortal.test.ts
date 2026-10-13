/**
 * What a supplier sees: the right pile, for the right reason.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_VENDOR_POINTS, REQUEST_POINTS, askableQuestions, classify, draftFromResponse,
  invitationsFor, isAnswered,
  missingRequired, submissionFor, timeRemaining, toAnswers, vendorSections,
} from '../vendorPortal';
import type { EventBidder, Question, Response, SourcingEvent } from '../types';

const NOW = 1_000_000_000;
const HOUR = 3_600_000;

function event(over: Partial<SourcingEvent> = {}): SourcingEvent {
  return {
    id: 'e1', tenantId: 't', eventNumber: 'RFQ-1', title: 'An event', description: '',
    side: 'BUY', templateId: null, journeyPattern: 'JP-02', businessUnit: 'BU',
    category: 'IT Hardware', project: null, costCentre: null, currency: 'USD',
    estimatedValue: 1000, ownerId: 'u1', status: 'OPEN', createdFrom: 'MANUAL',
    sourceReference: null, stagesEnabled: ['RFQ', 'AWARD'], currentStage: 'RFQ',
    envelopeMode: 'SINGLE', vendorInputPoints: ['RFQ'],
    publishedAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, awardedAt: null,
    parentEventId: null, version: 1,
    configSnapshotAtPublish: { feedbackPolicy: 'NONE', mechanism: 'ENGLISH', envelopeMode: 'SINGLE', minDecrement: 1 },
    ...over,
  };
}

function bidder(over: Partial<EventBidder> = {}): EventBidder {
  return {
    id: 'b1', eventId: 'e1', counterpartyId: 'cp-abc', isProvisional: false,
    invitedAt: NOW - HOUR, invitationStatus: 'SENT', declineReason: null,
    ndaAcceptedAt: null, participationStatus: 'NOT_STARTED', qualificationStatus: 'PENDING',
    awardStatus: 'NONE', qualificationSnapshot: 90, performanceRatingSnapshot: 80,
    bidOnBehalfAllowed: false, maskedLabel: 'Bidder A', disqualified: false,
    disqualificationReason: null, ...over,
  };
}

function response(over: Partial<Response> = {}): Response {
  return {
    id: 'r1', eventId: 'e1', bidderId: 'b1', version: 1, submittedAt: NOW - HOUR,
    answers: [], priceLines: [], ...over,
  };
}

describe('active means something is owed', () => {
  it('is active when open, in time, and unanswered', () => {
    const item = classify(event(), bidder(), 'RFQ', [], NOW);
    expect(item.active).toBe(true);
    expect(item.standing).toBe('Waiting on you.');
  });

  it('distinguishes started from not started', () => {
    const item = classify(event(), bidder({ participationStatus: 'IN_PROGRESS' }), 'RFQ', [], NOW);
    expect(item.active).toBe(true);
    expect(item.standing).toContain('Started');
  });

  it('moves to past once submitted, and says which version', () => {
    const item = classify(event(), bidder(), 'RFQ', [response({ version: 2 })], NOW);
    expect(item.active).toBe(false);
    expect(item.standing).toContain('version 2');
    expect(item.submittedAt).not.toBeNull();
  });

  it('moves to past when the deadline has gone by', () => {
    const item = classify(event({ closesAt: NOW - HOUR }), bidder(), 'RFQ', [], NOW);
    expect(item.active).toBe(false);
    expect(item.standing).toContain('deadline passed');
  });

  it('moves to past when the buyer closes responses', () => {
    const item = classify(event({ status: 'UNDER_EVALUATION' }), bidder(), 'RFQ', [], NOW);
    expect(item.active).toBe(false);
    expect(item.standing).toContain('Closed without a response');
  });

  it('moves to past when the buyer advances beyond this ask', () => {
    const e = event({
      stagesEnabled: ['RFI', 'RFP', 'AWARD'], currentStage: 'RFP', vendorInputPoints: ['RFI', 'RFP'],
    });
    expect(classify(e, bidder(), 'RFI', [], NOW).active).toBe(false);
    expect(classify(e, bidder(), 'RFP', [], NOW).active).toBe(true);
  });

  it('respects a decline and a disqualification', () => {
    expect(classify(event(), bidder({ invitationStatus: 'DECLINED' }), 'RFQ', [], NOW).standing)
      .toContain('declined');
    const dq = classify(
      event(), bidder({ disqualified: true, disqualificationReason: 'Late bid bond.' }),
      'RFQ', [], NOW,
    );
    expect(dq.active).toBe(false);
    expect(dq.standing).toBe('Late bid bond.');
  });
});

describe('sections', () => {
  const events = [
    event({ id: 'rfi', eventNumber: 'RFI-1', vendorInputPoints: ['RFI'], stagesEnabled: ['RFI'], currentStage: 'RFI' }),
    event({ id: 'rfp', eventNumber: 'RFP-1', vendorInputPoints: ['RFP'], stagesEnabled: ['RFP'], currentStage: 'RFP' }),
    event({ id: 'rfq', eventNumber: 'RFQ-1', vendorInputPoints: ['RFQ'], stagesEnabled: ['RFQ'], currentStage: 'RFQ' }),
    event({ id: 'auc', eventNumber: 'AUC-1', vendorInputPoints: ['AUCTION'], stagesEnabled: ['AUCTION'], currentStage: 'AUCTION', status: 'AUCTION_LIVE' }),
  ];
  const bidders = events.map((e, i) => bidder({ id: `b${i}`, eventId: e.id }));

  it('covers every point a supplier can be asked at', () => {
    const sections = vendorSections({ events, bidders, responses: [], counterpartyId: 'cp-abc', now: NOW });
    // Every one, not just the three the Requests screen names — an event whose
    // only vendor point is intake must not vanish from the portal.
    expect(sections.map((s) => s.point)).toEqual(ALL_VENDOR_POINTS);
    for (const point of REQUEST_POINTS) {
      expect(sections.some((s) => s.point === point)).toBe(true);
    }
  });

  it('files each event under the ask it actually makes', () => {
    const sections = vendorSections({ events, bidders, responses: [], counterpartyId: 'cp-abc', now: NOW });
    const withWork = sections.filter((s) => s.active.length > 0);
    expect(withWork.map((s) => s.point)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    for (const section of withWork) {
      expect(section.active).toHaveLength(1);
      expect(section.active[0].event.vendorInputPoints).toContain(section.point);
    }
  });

  /**
   * A ladder event carries every point it will eventually ask at. Filing it
   * under all of them listed one invitation as an RFI, an RFP and an RFQ at
   * once — and because an event holds a single response, answering the RFI
   * flipped the other two to "Submitted" as well. A supplier was told they had
   * answered a proposal they had never been shown.
   */
  it('files a ladder event under the one ask it has actually reached', () => {
    const ladder = event({
      id: 'ladder', vendorInputPoints: ['RFI', 'RFP', 'RFQ'],
      stagesEnabled: ['RFI', 'RFP', 'RFQ'], currentStage: 'RFI',
    });
    const sections = vendorSections({
      events: [ladder], bidders: [bidder({ eventId: 'ladder' })],
      responses: [], counterpartyId: 'cp-abc', now: NOW,
    });
    const at = (point: string) => sections.find((s) => s.point === point)!;
    expect(at('RFI').active).toHaveLength(1);
    // Not yet raised. The buyer issues them as their own asks when the time
    // comes, each with its own deadline and its own response.
    expect(at('RFP').active).toHaveLength(0);
    expect(at('RFQ').active).toHaveLength(0);
    expect(at('AUCTION').active).toHaveLength(0);
  });

  it('moves the ladder on to the next ask as the buyer advances it', () => {
    const at = (point: string, currentStage: 'RFI' | 'RFP' | 'RFQ') => {
      const ladder = event({
        id: 'ladder', vendorInputPoints: ['RFI', 'RFP', 'RFQ'],
        stagesEnabled: ['RFI', 'RFP', 'RFQ'], currentStage,
      });
      const sections = vendorSections({
        events: [ladder], bidders: [bidder({ eventId: 'ladder' })],
        responses: [], counterpartyId: 'cp-abc', now: NOW,
      });
      return sections.find((s) => s.point === point)!;
    };
    expect(at('RFP', 'RFP').active).toHaveLength(1);
    expect(at('RFI', 'RFP').active).toHaveLength(0);
    expect(at('RFQ', 'RFQ').active).toHaveLength(1);
  });

  it('files an event standing past all its asks under the last one it made', () => {
    // An auction that is live still belongs in the auction room, not in the
    // RFI section it passed through a fortnight ago.
    const done = event({
      id: 'done', vendorInputPoints: ['RFI', 'AUCTION'],
      stagesEnabled: ['RFI', 'AUCTION', 'AWARD'], currentStage: 'AWARD',
      status: 'AUCTION_CLOSED',
    });
    const sections = vendorSections({
      events: [done], bidders: [bidder({ eventId: 'done' })],
      responses: [], counterpartyId: 'cp-abc', now: NOW,
    });
    const filed = sections.filter((s) => s.active.length + s.past.length > 0);
    expect(filed).toHaveLength(1);
    expect(filed[0].point).toBe('AUCTION');
  });

  it('never shows an event the supplier was not invited to', () => {
    const sections = vendorSections({ events, bidders, responses: [], counterpartyId: 'cp-other', now: NOW });
    for (const section of sections) {
      expect(section.active).toHaveLength(0);
      expect(section.past).toHaveLength(0);
    }
  });

  it('never shows an event the buyer has not published', () => {
    const draft = event({ id: 'd', status: 'DRAFT' });
    const sections = vendorSections({
      events: [draft], bidders: [bidder({ eventId: 'd' })],
      responses: [], counterpartyId: 'cp-abc', now: NOW,
    });
    expect(sections.every((s) => s.active.length === 0 && s.past.length === 0)).toBe(true);
  });

  it('orders active by soonest deadline', () => {
    const soon = event({ id: 's', closesAt: NOW + HOUR });
    const later = event({ id: 'l', closesAt: NOW + 90 * HOUR });
    const sections = vendorSections({
      events: [later, soon],
      bidders: [bidder({ id: 'bl', eventId: 'l' }), bidder({ id: 'bs', eventId: 's' })],
      responses: [], counterpartyId: 'cp-abc', now: NOW,
    });
    const rfq = sections.find((s) => s.point === 'RFQ')!;
    expect(rfq.active.map((i) => i.event.id)).toEqual(['s', 'l']);
  });
});

describe('helpers', () => {
  it('returns the latest submission', () => {
    const found = submissionFor(
      [response({ id: 'a', version: 1, submittedAt: NOW - 2 * HOUR }),
       response({ id: 'b', version: 2, submittedAt: NOW - HOUR })],
      'e1', 'b1',
    );
    expect(found?.version).toBe(2);
  });

  it('ignores a draft response that was never submitted', () => {
    expect(submissionFor([response({ submittedAt: null })], 'e1', 'b1')).toBeNull();
  });

  it('finds only this company’s invitations', () => {
    expect(invitationsFor([bidder(), bidder({ id: 'b2', counterpartyId: 'cp-x' })], 'cp-abc'))
      .toHaveLength(1);
  });

  it('says how long is left in plain language', () => {
    expect(timeRemaining(NOW + 3 * HOUR, NOW)).toBe('3 hours left');
    expect(timeRemaining(NOW + 72 * HOUR, NOW)).toBe('3 days left');
    expect(timeRemaining(NOW - HOUR, NOW)).toBe('Closed');
    expect(timeRemaining(null, NOW)).toContain('No deadline');
  });
});

describe('answering', () => {
  const q = (over: Partial<Question> = {}): Question => ({
    id: 'q1', questionnaireId: 'qn', sectionId: null, sequence: 1, code: 'A',
    type: 'short_text', title: 'A question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false, ...over,
  });

  it('counts zero and false as answers, blank as not', () => {
    expect(isAnswered({ value: 0, attachmentName: null })).toBe(true);
    expect(isAnswered({ value: false, attachmentName: null })).toBe(true);
    expect(isAnswered({ value: '', attachmentName: null })).toBe(false);
    expect(isAnswered({ value: '   ', attachmentName: null })).toBe(false);
    expect(isAnswered({ value: [], attachmentName: null })).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
  });

  it('accepts an attachment as the answer', () => {
    expect(isAnswered({ value: null, attachmentName: 'iso9001.pdf' })).toBe(true);
  });

  it('lists the required questions still outstanding', () => {
    const questions = [
      q({ id: 'a' }),
      q({ id: 'b', isRequired: false }),
      q({ id: 'c' }),
    ];
    const missing = missingRequired(questions, { a: { value: 'done', attachmentName: null } });
    expect(missing.map((m) => m.id)).toEqual(['c']);
  });

  it('never holds a supplier to a question that asks nothing', () => {
    const questions = [q({ id: 's', type: 'section', isRequired: true })];
    expect(missingRequired(questions, {})).toHaveLength(0);
    expect(askableQuestions(questions)).toHaveLength(0);
  });

  it('orders askable questions by sequence', () => {
    const questions = [q({ id: 'b', sequence: 2 }), q({ id: 'a', sequence: 1 })];
    expect(askableQuestions(questions).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('emits answers only for questions that were asked and answered', () => {
    const questions = [q({ id: 'a' }), q({ id: 'b' })];
    const answers = toAnswers(questions, {
      a: { value: 'yes', attachmentName: null },
      b: { value: '', attachmentName: null },
      ghost: { value: 'x', attachmentName: null },
    });
    expect(answers).toEqual([{ questionId: 'a', value: 'yes', attachmentName: null }]);
  });

  it('reopens a submitted response for resubmission', () => {
    const draft = draftFromResponse({
      ...response(), answers: [{ questionId: 'a', value: 7, attachmentName: 'x.pdf' }],
    });
    expect(draft.a).toEqual({ value: 7, attachmentName: 'x.pdf' });
    expect(draftFromResponse(null)).toEqual({});
  });
});
