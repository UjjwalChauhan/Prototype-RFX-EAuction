/**
 * Answering a questionnaire in the portal, and the buyer reading it back.
 *
 * The domain tests prove what counts as an answer. These prove the loop: the
 * questions the buyer published reach the supplier, and a submitted answer
 * reaches the buyer's review screen against the question that produced it.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, type AppState } from '../../store/store';
import { PortalRequests } from '../PortalRequests';
import { ResponsesTab } from '../../admin/tabs/ResponsesTab';
import type {
  EventBidder, Question, Questionnaire, Response, SourcingEvent,
} from '../../domain/types';

const NOW = Date.now();
const HOUR = 3_600_000;

const EVENT: SourcingEvent = {
  id: 'e-ans', tenantId: 't', eventNumber: 'RFI-9001', title: 'Cabling framework',
  description: '', side: 'BUY', templateId: null, journeyPattern: 'JP-05',
  businessUnit: 'BU', category: 'IT Hardware', project: null, costCentre: null,
  currency: 'USD', estimatedValue: 1000, ownerId: 'u', status: 'OPEN',
  createdFrom: 'MANUAL', sourceReference: null, stagesEnabled: ['RFI', 'AWARD'],
  currentStage: 'RFI', envelopeMode: 'SINGLE', vendorInputPoints: ['RFI'],
  publishedAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, awardedAt: null,
  parentEventId: null, version: 1,
  configSnapshotAtPublish: { feedbackPolicy: 'NONE', mechanism: 'ENGLISH', envelopeMode: 'SINGLE', minDecrement: 1 },
};

const BIDDER: EventBidder = {
  id: 'eb-ans', eventId: 'e-ans', counterpartyId: 'cp-abc', isProvisional: false,
  invitedAt: NOW - HOUR, invitationStatus: 'SENT', declineReason: null, ndaAcceptedAt: null,
  participationStatus: 'NOT_STARTED', qualificationStatus: 'PENDING', awardStatus: 'NONE',
  qualificationSnapshot: 90, performanceRatingSnapshot: 80, bidOnBehalfAllowed: false,
  maskedLabel: 'Bidder A', disqualified: false, disqualificationReason: null,
};

function question(over: Partial<Question>): Question {
  return {
    id: 'q', questionnaireId: 'qn-ans', sectionId: null, sequence: 1, code: 'C',
    type: 'short_text', title: 'A question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false, ...over,
  };
}

const QUESTIONNAIRE: Questionnaire = {
  id: 'qn-ans', eventId: 'e-ans', stage: 'RFI', name: 'Qualification',
  questions: [
    question({ id: 'q1', sequence: 1, title: 'Years trading in this category', type: 'number' }),
    question({ id: 'q2', sequence: 2, title: 'Do you report Scope 1 and 2 emissions?', type: 'yes_no' }),
    question({ id: 'q3', sequence: 3, title: 'ISO 9001 certification', type: 'certificate', allowAttachment: true }),
    question({ id: 'q4', sequence: 4, title: 'Describe your escalation process', type: 'long_text', isRequired: false }),
  ],
};

function portalState(over: Partial<AppState> = {}): Partial<AppState> {
  return {
    events: [EVENT], bidders: [BIDDER], questionnaires: [QUESTIONNAIRE],
    responses: [], lots: [], ...over,
  };
}

function paintPortal(seed: Partial<AppState>): string {
  return renderToString(
    <StoreProvider seed={seed}>
      <PortalRequests counterpartyId="cp-abc" points={['RFI']} heading="Requests" blurb="" />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
}

describe('the ask reaches the supplier', () => {
  it('lists it as waiting on them', () => {
    const html = paintPortal(portalState());
    expect(html).toContain('Cabling framework');
    expect(html).toContain('Waiting on you');
    expect(html).toContain('Open and respond');
  });

  it('moves it out of Active once a response is submitted', () => {
    const response: Response = {
      id: 'r1', eventId: 'e-ans', bidderId: 'eb-ans', version: 1, submittedAt: NOW,
      answers: [{ questionId: 'q1', value: 12, attachmentName: null }], priceLines: [],
    };
    const html = paintPortal(portalState({ responses: [response] }));
    // The Past pile is a click away, so the first paint proves the counts.
    expect(html).toContain('Active (0)');
    expect(html).toContain('Past (1)');
    expect(html).toContain('Nothing is waiting on you here');
  });
});

describe('the buyer reads the answers back', () => {
  const response: Response = {
    id: 'r1', eventId: 'e-ans', bidderId: 'eb-ans', version: 1, submittedAt: NOW,
    answers: [
      { questionId: 'q1', value: 12, attachmentName: null },
      { questionId: 'q2', value: true, attachmentName: null },
      { questionId: 'q3', value: 'Certified', attachmentName: 'iso9001.pdf' },
    ],
    priceLines: [],
  };

  const paintAdmin = () =>
    renderToString(
      <StoreProvider seed={portalState({ responses: [response] })}>
        <ResponsesTab eventId="e-ans" />
      </StoreProvider>,
    ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");

  it('shows each answer against the question that produced it', () => {
    const html = paintAdmin();
    expect(html).toContain('Years trading in this category');
    expect(html).toContain('12');
    expect(html).toContain('Do you report Scope 1 and 2 emissions?');
    expect(html).toContain('ISO 9001 certification');
  });

  it('shows the attachment the supplier sent', () => {
    expect(paintAdmin()).toContain('iso9001.pdf');
  });

  it('resolves questions from the event rather than the seeded set', () => {
    // A question that exists only in the demonstration questionnaire must not
    // appear for an event that published its own.
    expect(paintAdmin()).not.toContain('Copier paper');
  });
});
