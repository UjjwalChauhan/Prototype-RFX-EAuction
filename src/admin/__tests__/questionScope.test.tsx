/**
 * Asking per line, end to end through the screens.
 *
 * The domain tests prove the model. These prove the three places a person
 * meets it: the buyer choosing the scope when the question is written, the
 * supplier being asked it once per item, and the buyer reading every line's
 * answer back instead of whichever one arrived first.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, type AppState } from '../../store/store';
import { AskedPerControl } from '../QuestionnairePanel';
import { QuestionnaireStep, INITIAL_DRAFT, type Draft } from '../CreateEventWizard';
import { ResponsesTab } from '../tabs/ResponsesTab';
import { RequestDetail } from '../../portal/PortalRequests';
import { vendorSections } from '../../domain/vendorPortal';
import { instantiateTemplate } from '../../domain/questionnaireTemplates';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type {
  EventBidder, LineItem, Lot, Question, Questionnaire, Response, SourcingEvent,
} from '../../domain/types';

const NOW = Date.now();
const HOUR = 3_600_000;

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

// ---------------------------------------------------------------------------
// Writing the question
// ---------------------------------------------------------------------------

describe('the buyer chooses who a question is put to', () => {
  const paint = (type: Question['type'], askedPer: Question['askedPer']) =>
    clean(renderToString(<AskedPerControl question={{ type, askedPer }} onChange={() => {}} />));

  it('offers both scopes, with the reason for the one in force', () => {
    const html = paint('lead_time', 'VENDOR');
    expect(html).toContain('Per vendor');
    expect(html).toContain('Per line item');
    expect(html).toContain('The answer is about the company');
  });

  it('explains what per line actually means once it is chosen', () => {
    expect(paint('lead_time', 'LINE')).toContain('Asked once for every line in the basket');
  });

  it('says why a price schedule cannot be asked per line', () => {
    const html = paint('price_schedule', 'VENDOR');
    expect(html).toContain('already spans every line in the basket');
  });

  it('says why a heading cannot be', () => {
    expect(paint('section', 'VENDOR')).toContain('displays something rather than asking for it');
  });
});

describe('the wizard asks it too', () => {
  it('puts the scope beside the envelope on every question', () => {
    const draft: Draft = {
      ...INITIAL_DRAFT,
      questionnaires: [instantiateTemplate(TENANT_TEMPLATES[0], 'RFI', 'd1')],
    };
    const html = clean(renderToString(
      <StoreProvider>
        <QuestionnaireStep draft={draft} patch={() => {}} points={['RFI']} categories={[]} />
      </StoreProvider>,
    ));
    expect(html).toContain('Asked per');
    expect(html).toContain('Per line item');
  });
});

// ---------------------------------------------------------------------------
// Being asked it, and reading it back
// ---------------------------------------------------------------------------

const EVENT: SourcingEvent = {
  id: 'e-scope', tenantId: 't', eventNumber: 'RFI-7001', title: 'Hardware refresh',
  description: '', side: 'BUY', templateId: null, journeyPattern: 'JP-05',
  businessUnit: 'BU', category: 'IT Hardware', project: null, costCentre: null,
  currency: 'INR', estimatedValue: 1000, ownerId: 'u', status: 'OPEN',
  createdFrom: 'MANUAL', sourceReference: null, stagesEnabled: ['RFI', 'AWARD'],
  currentStage: 'RFI', envelopeMode: 'SINGLE', vendorInputPoints: ['RFI'],
  publishedAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, awardedAt: null,
  parentEventId: null, version: 1, configSnapshotAtPublish: null,
};

const LOT: Lot = {
  id: 'lot-scope', eventId: 'e-scope', lotNumber: 1, name: 'Lot 1 · Hardware',
  description: '', sequence: 1, biddingOpenAt: null, biddingCloseAt: null,
  awardMode: 'SINGLE', minSuppliers: null, maxSuppliers: null, reservePrice: null,
  targetPrice: null, ceilingPrice: null, floorPrice: null, status: 'LOT_OPEN',
};

function line(id: string, itemCode: string, description: string): LineItem {
  return {
    id, lotId: 'lot-scope', lineNumber: 1, itemCode, description, specification: '',
    quantity: 10, uom: 'each', deliveryLocation: 'Dubai DC', deliveryDate: null,
    incoterm: null, taxClass: null, baselinePrice: 100, baselineSource: 'PR',
    currency: 'INR', isOptional: false, allowAlternate: false,
    category: 'IT Hardware', superCategory: null, sourcePrLineId: null,
  };
}

const LINES = [
  line('li-1', 'LAP-005', 'Laptop, 15in'),
  line('li-2', 'MON-012', 'Monitor, 24in'),
];

const BIDDER: EventBidder = {
  categories: [], id: 'eb-scope', eventId: 'e-scope', counterpartyId: 'cp-abc',
  isProvisional: false, invitedAt: NOW - HOUR, invitationStatus: 'SENT', declineReason: null,
  ndaAcceptedAt: null, participationStatus: 'NOT_STARTED', qualificationStatus: 'PENDING',
  awardStatus: 'NONE', qualificationSnapshot: 90, performanceRatingSnapshot: 80,
  bidOnBehalfAllowed: false, maskedLabel: 'Bidder A', disqualified: false,
  disqualificationReason: null,
};

function question(over: Partial<Question> & { id: string }): Question {
  return {
    questionnaireId: 'qn-scope', sectionId: null, sequence: 1, code: 'C',
    type: 'short_text', title: 'A question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', ...over,
  };
}

const QUESTIONNAIRE: Questionnaire = {
  id: 'qn-scope', eventId: 'e-scope', stage: 'RFI', name: 'Qualification',
  questions: [
    question({ id: 'q-years', sequence: 1, title: 'Years trading in this category', type: 'number' }),
    question({
      id: 'q-lead', sequence: 2, title: 'Lead time from order to delivery',
      type: 'lead_time', askedPer: 'LINE',
    }),
  ],
};

function seed(over: Partial<AppState> = {}): Partial<AppState> {
  return {
    events: [EVENT], bidders: [BIDDER], questionnaires: [QUESTIONNAIRE],
    lots: [LOT], lineItems: LINES, responses: [], ...over,
  };
}

function openAsk(state: Partial<AppState>): string {
  const item = vendorSections({
    events: state.events!, bidders: state.bidders!, responses: state.responses ?? [],
    counterpartyId: 'cp-abc', now: NOW,
  }).flatMap((section) => [...section.active, ...section.past])
    .find((i) => i.event.id === 'e-scope')!;
  return clean(renderToString(
    <StoreProvider seed={state}>
      <RequestDetail item={item} now={NOW} onBack={() => {}} />
    </StoreProvider>,
  ));
}

describe('the supplier is asked a line question once per item', () => {
  const html = openAsk(seed());

  it('asks the vendor-level question once', () => {
    expect(html.match(/Years trading in this category/g)).toHaveLength(1);
  });

  it('asks the line question once, against each item by name', () => {
    expect(html.match(/Lead time from order to delivery/g)).toHaveLength(1);
    expect(html).toContain('LAP-005 · Laptop, 15in');
    expect(html).toContain('MON-012 · Monitor, 24in');
  });

  it('marks it as per item and says how much is still owed', () => {
    expect(html).toContain('per item');
    expect(html).toContain('Answer this for each of the 2 items below — 0 of 2 done');
  });
});

describe('the buyer reads every line back', () => {
  const response: Response = {
    id: 'r-scope', eventId: 'e-scope', bidderId: 'eb-scope', version: 1, submittedAt: NOW,
    answers: [
      { questionId: 'q-years', value: 12, attachmentName: null, lineItemId: null },
      { questionId: 'q-lead', value: 5, attachmentName: null, lineItemId: 'li-1' },
      { questionId: 'q-lead', value: 21, attachmentName: null, lineItemId: 'li-2' },
    ],
    priceLines: [],
  };

  const html = clean(renderToString(
    <StoreProvider seed={seed({ responses: [response] })}>
      <ResponsesTab eventId="e-scope" />
    </StoreProvider>,
  ));

  it('groups the line answers under one question rather than repeating it', () => {
    expect(html.match(/Lead time from order to delivery/g)).toHaveLength(1);
    expect(html).toContain('per line item');
  });

  it('shows both answers, each against the item it is about', () => {
    expect(html).toContain('LAP-005');
    expect(html).toContain('MON-012');
    expect(html).toContain('5');
    expect(html).toContain('21');
  });
});
