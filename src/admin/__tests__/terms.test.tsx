/**
 * Terms, from the wizard step to what a supplier is sent.
 *
 * Published with a set of documents, they land on the sourcing event, each ask
 * resolves the ones applied at its point, and the supplier portal shows an RFI
 * bidder the general conditions without the payment terms — because an RFI asks
 * for no price.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TermsStep } from '../CreateEventWizard';
import { INITIAL_DRAFT, type Draft } from '../CreateEventWizard';
import { TermsTab } from '../tabs/TermsTab';
import { localApi } from '../../api/client';
import {
  StoreProvider, initialState, reducer, termsForEvent, type AppState,
} from '../../store/store';
import { alignTermsToJourney, instantiateTerms } from '../../domain/terms';
import { JOURNEY_PATTERNS } from '../../domain/journeyPatterns';
import { TERMS_TEMPLATES } from '../../data/termsTemplates';
import type { SourcingEventInput } from '../../domain/stageEvents';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);
const general = TERMS_TEMPLATES.find((t) => t.category === 'GENERAL')!;
const payment = TERMS_TEMPLATES.find((t) => t.id === 'tt-payment-net30-grn')!;

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#x2F;/g, '/');

function input(): SourcingEventInput {
  return {
    journeyPattern: 'JP-05',
    title: 'Facilities Management 2026',
    category: 'Facilities',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    lines: [{ description: 'HVAC maintenance', quantity: 96, uom: 'visit', baselinePrice: 2_400, lotName: 'Lot 1' }],
    bidders: [{ counterpartyId: 'cp-abc' }],
    terms: [instantiateTerms(general, 'draft'), instantiateTerms(payment, 'draft')],
    timeline: { opensAt: NOW, closesInHours: 72 },
  };
}

async function published() {
  const before = initialState();
  const family = await localApi({ events: before.events }, { now: () => NOW })
    .createSourcingEvent(input());
  const state = reducer(before, {
    type: 'CREATE_EVENT',
    event: family.event,
    stageEvents: family.stageEvents,
    lots: family.lots,
    lineItems: family.lineItems,
    bidders: family.bidders,
    questionnaires: family.questionnaires,
    terms: family.terms,
    sourcedLineIds: [],
  });
  return { state, family };
}

describe('publishing with terms', () => {
  it('attaches them to the sourcing event, not to each ask', async () => {
    const { state, family } = await published();
    expect(state.termsDocuments).toHaveLength(2);
    for (const document of state.termsDocuments) {
      expect(document.eventId).toBe(family.event.id);
    }
  });

  it('gives every ask what applies at its point, and nothing else', async () => {
    const { state, family } = await published();
    const at = (stage: string) => termsForEvent(
      state, family.stageEvents.find((e) => e.currentStage === stage)!.id,
    ).map((d) => d.category);

    expect(at('RFI')).toEqual(['GENERAL']);
    expect(at('RFP')).toEqual(['GENERAL', 'PAYMENT']);
    expect(at('RFQ')).toEqual(['GENERAL', 'PAYMENT']);
    expect(at('AUCTION')).toEqual(['GENERAL', 'PAYMENT']);
  });

  it('answers the sourcing event with everything it goes out with', async () => {
    const { state, family } = await published();
    expect(termsForEvent(state, family.event.id)).toHaveLength(2);
  });

  it('keeps the clauses, renumbered against the event that owns them', async () => {
    const { state } = await published();
    const conditions = state.termsDocuments.find((d) => d.category === 'GENERAL')!;
    expect(conditions.clauses.length).toBe(general.clauses.length);
    expect(conditions.clauses[0].code).toBe(general.clauses[0].code);
    expect(conditions.clauses.every((c) => c.id.startsWith(conditions.eventId))).toBe(true);
  });

  it('refuses to publish a price asked with no payment terms', async () => {
    const before = initialState();
    await expect(
      localApi({ events: before.events }, { now: () => NOW }).createSourcingEvent({
        ...input(),
        terms: [instantiateTerms(general, 'draft')],
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 400 });
  });

  it('refuses to publish with no terms at all', async () => {
    const before = initialState();
    await expect(
      localApi({ events: before.events }, { now: () => NOW })
        .createSourcingEvent({ ...input(), terms: [] }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 400 });
  });
});

describe('the Terms tab', () => {
  async function paint(which: 'event' | 'RFI' | 'RFQ') {
    const { state, family } = await published();
    const eventId = which === 'event'
      ? family.event.id
      : family.stageEvents.find((e) => e.currentStage === which)!.id;
    return clean(renderToString(
      <StoreProvider seed={state as AppState}>
        <TermsTab eventId={eventId} />
      </StoreProvider>,
    ));
  }

  it('shows every document and which ask it reaches, from the event', async () => {
    const html = await paint('event');
    expect(html).toContain('Terms attached to this event');
    expect(html).toContain('What each ask carries');
    expect(html).toContain('General conditions of purchase');
    expect(html).toContain('Payment terms — Net 30 from goods receipt');
  });

  it('shows an RFI its general conditions and no payment figures', async () => {
    const html = await paint('RFI');
    expect(html).toContain('Applied at the RFI');
    expect(html).toContain('General conditions of purchase');
    expect(html).not.toContain('Payment figures');
  });

  it('shows a priced ask the payment figures as figures', async () => {
    const html = await paint('RFQ');
    expect(html).toContain('Payment figures');
    expect(html).toContain('Net 30 days from goods receipt');
    expect(html).toContain('Credit 30 days');
  });

  it('marks a non-negotiable clause as one', async () => {
    const html = await paint('RFQ');
    expect(html).toContain('non-negotiable');
    expect(html).toContain('Governing law and disputes');
  });

  it('says what the supplier has to do about each document', async () => {
    const html = await paint('RFQ');
    expect(html).toContain('Accept, or state a deviation clause by clause');
  });

  it('says so plainly on an event that carries none', () => {
    const html = clean(renderToString(
      <StoreProvider seed={initialState()}>
        <TermsTab eventId="evt-rfi-005" />
      </StoreProvider>,
    ));
    expect(html).toContain('This event has no terms attached');
  });
});

describe('the Terms step of the wizard', () => {
  const paintStep = (draft: Draft = INITIAL_DRAFT) => clean(renderToString(
    <StoreProvider>
      <TermsStep draft={draft} patch={() => {}} points={['RFI', 'RFP', 'RFQ', 'AUCTION']} />
    </StoreProvider>,
  ));

  it('opens with the two a buyer is asked for first', () => {
    const html = paintStep();
    expect(html).toContain('General conditions of purchase');
    expect(html).toContain('Payment terms — Net 30 from goods receipt');
  });

  it('shows a grid of which ask carries which document', () => {
    const html = paintStep();
    expect(html).toContain('What each ask carries');
    // One column per point the journey asks at.
    for (const label of ['RFI', 'RFP', 'RFQ']) expect(html).toContain(label);
  });

  it('offers the library and a blank document', () => {
    const html = paintStep();
    expect(html).toContain('Add from library');
    expect(html).toContain('Write my own');
  });

  it('edits the first document, payment figures included where they belong', () => {
    const withPaymentOpen: Draft = {
      ...INITIAL_DRAFT,
      terms: [instantiateTerms(payment, 'draft')],
    };
    const html = paintStep(withPaymentOpen);
    expect(html).toContain('Payment figures');
    expect(html).toContain('Credit period (days)');
    expect(html).toContain('Retention released after (days)');
  });

  it('blocks on what is missing rather than letting it through', () => {
    const html = paintStep({ ...INITIAL_DRAFT, terms: [] });
    expect(html).toContain('These must be settled before publish');
    expect(html).toContain('No terms are attached to the RFI');
  });
});

describe('a direct auction raised from a requisition', () => {
  /**
   * JP-01 is the shortest journey that still asks a supplier for something: a
   * requisition, then a live auction. It had no Terms step and two asks that
   * publish refuses to let through bare, which is a buyer at Review with a red
   * line and nowhere to go and clear it.
   */
  const pattern = JOURNEY_PATTERNS['JP-01'];
  const draft: Draft = {
    ...INITIAL_DRAFT,
    pattern: pattern.id,
    terms: alignTermsToJourney(INITIAL_DRAFT.terms, pattern.vendorInputPoints),
  };
  const html = clean(renderToString(
    <StoreProvider>
      <TermsStep draft={draft} patch={() => {}} points={pattern.vendorInputPoints} />
    </StoreProvider>,
  ));

  it('reaches a step where terms can be attached at all', () => {
    expect(pattern.wizardSteps).toContain('Terms');
  });

  it('gives the grid a column for each of the two asks it runs', () => {
    expect(html).toContain('Intake');
    expect(html).toContain('Auction');
    // And none for the asks it does not, which is where the defaults used to sit.
    expect(html).not.toContain('>RFI<');
  });

  it('opens with nothing blocking, so the buyer can publish without editing terms', () => {
    expect(html).not.toContain('These must be settled before publish');
  });

  it('carries the payment terms onto the auction, where the price is asked', () => {
    const paid = draft.terms.find((d) => d.category === 'PAYMENT')!;
    expect(paid.appliesTo).toEqual(['AUCTION']);
  });
});
