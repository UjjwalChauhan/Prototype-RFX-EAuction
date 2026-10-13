/**
 * The terms an event goes out with.
 *
 * The assertions that matter are about coverage and contradiction: that a
 * document applied at two asks is one document rather than two, that an ask
 * asking for a price without payment terms is refused, that two payment
 * documents at the same point are refused because a supplier cannot follow
 * both, and that adding from the library copies rather than references.
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_CATEGORIES, DEFAULT_PAYMENT_TERMS, PRICED_POINTS, alignTermsToJourney, blankTerms,
  describeTerms, instantiateTerms, mustAcknowledge, paymentSummary, termsForPoint, validateTerms,
  type TermsCategory, type TermsDocumentInput,
} from '../terms';
import { TERMS_TEMPLATES, templatesForPoint } from '../../data/termsTemplates';
import type { VendorInputPoint } from '../types';

const LADDER: VendorInputPoint[] = ['RFI', 'RFP', 'RFQ', 'AUCTION'];

const general = TERMS_TEMPLATES.find((t) => t.category === 'GENERAL')!;
const payment = TERMS_TEMPLATES.find((t) => t.id === 'tt-payment-net30-grn')!;
const milestone = TERMS_TEMPLATES.find((t) => t.id === 'tt-payment-milestone')!;

function document(over: Partial<TermsDocumentInput> = {}): TermsDocumentInput {
  return { ...instantiateTerms(general, 'evt-1'), ...over };
}

const blocking = (documents: TermsDocumentInput[], points = LADDER) =>
  validateTerms(documents, points).filter((issue) => issue.blocking);

const messages = (documents: TermsDocumentInput[], points = LADDER) =>
  validateTerms(documents, points).map((issue) => issue.message).join(' | ');

describe('the library', () => {
  it('offers both of the two a buyer is asked for first', () => {
    for (const category of CORE_CATEGORIES) {
      expect(TERMS_TEMPLATES.some((template) => template.category === category)).toBe(true);
    }
  });

  it('applies general conditions everywhere and payment terms where price is asked', () => {
    // Everywhere means every ask, not only the ladder: a quote given at intake
    // and a bid placed in an auction are commitments under the same conditions.
    expect(general.defaultAppliesTo)
      .toEqual(expect.arrayContaining([...LADDER, 'INTAKE', 'NEGOTIATION']));
    expect(payment.defaultAppliesTo).toEqual(PRICED_POINTS);
    expect(payment.defaultAppliesTo).not.toContain('RFI');
  });

  it('lists what applies at a point', () => {
    expect(templatesForPoint('RFI').map((t) => t.category))
      .toEqual(expect.arrayContaining(['GENERAL', 'CONFIDENTIALITY', 'COMPLIANCE']));
    expect(templatesForPoint('RFI').some((t) => t.category === 'PAYMENT')).toBe(false);
  });

  it('copies a template rather than referencing it', () => {
    const copy = instantiateTerms(payment, 'evt-1');
    copy.payment!.creditDays = 90;
    copy.clauses[0].text = 'rewritten';
    // The library is unchanged, so the next event that uses it is unaffected.
    expect(payment.payment!.creditDays).toBe(30);
    expect(TERMS_TEMPLATES.find((t) => t.id === payment.id)!.clauses[0].text)
      .not.toBe('rewritten');
    expect(copy.templateId).toBe(payment.id);
  });

  it('narrows a template to the points the journey actually runs', () => {
    const copy = instantiateTerms(general, 'evt-1', ['RFQ']);
    expect(copy.appliesTo).toEqual(['RFQ']);
  });

  it('starts a blank document with figures only where they belong', () => {
    expect(blankTerms('PAYMENT', 'x', ['RFQ']).payment).toEqual(DEFAULT_PAYMENT_TERMS);
    expect(blankTerms('WARRANTY', 'x', ['RFQ']).payment).toBeNull();
  });
});

describe('resolving what an ask carries', () => {
  const documents = [
    instantiateTerms(payment, 'evt-1'),
    instantiateTerms(general, 'evt-1'),
  ];

  it('gives an RFI the general conditions and no payment terms', () => {
    expect(termsForPoint(documents, 'RFI').map((d) => d.category)).toEqual(['GENERAL']);
  });

  it('gives a priced ask both, general first', () => {
    expect(termsForPoint(documents, 'RFQ').map((d) => d.category)).toEqual(['GENERAL', 'PAYMENT']);
  });

  it('holds one document rather than a copy per ask', () => {
    // The same object is resolved at both points; there is nothing to drift.
    expect(termsForPoint(documents, 'RFP')[0]).toBe(termsForPoint(documents, 'RFQ')[0]);
  });

  it('names what a supplier must actively confirm', () => {
    const quiet = document({ acknowledgement: 'NONE' });
    expect(mustAcknowledge([...documents, quiet])).toHaveLength(2);
  });
});

describe('validation', () => {
  const full = () => alignTermsToJourney(
    [instantiateTerms(general, 'evt-1'), instantiateTerms(payment, 'evt-1')],
    LADDER,
  );

  it('passes a set that covers every ask', () => {
    expect(blocking(full())).toEqual([]);
  });

  it('refuses an ask with no terms at all', () => {
    const rfqOnly = [instantiateTerms(general, 'evt-1', ['RFQ']), instantiateTerms(payment, 'evt-1', ['RFQ'])];
    expect(messages(rfqOnly)).toContain('No terms are attached to the RFI');
  });

  it('refuses an ask with no general conditions', () => {
    const paymentOnly = [instantiateTerms(payment, 'evt-1')];
    expect(messages(paymentOnly, ['RFQ'])).toContain('No general terms and conditions at the RFQ');
  });

  it('refuses a price asked with no payment terms', () => {
    const noPayment = [instantiateTerms(general, 'evt-1')];
    const issues = validateTerms(noPayment, ['RFQ']);
    expect(issues.some((i) => i.blocking && i.message.includes('asks for a price with no payment terms')))
      .toBe(true);
  });

  it('only warns about that at the RFP, where the price is indicative', () => {
    const issues = validateTerms([instantiateTerms(general, 'evt-1')], ['RFP']);
    const payments = issues.filter((i) => i.field === 'PAYMENT');
    expect(payments).toHaveLength(1);
    expect(payments[0].blocking).toBe(false);
  });

  it('refuses two sets of payment terms at one ask', () => {
    const both = [
      instantiateTerms(general, 'evt-1'),
      instantiateTerms(payment, 'evt-1'),
      instantiateTerms(milestone, 'evt-1'),
    ];
    expect(messages(both)).toContain('A supplier cannot follow both');
  });

  it('refuses a document applied at nothing', () => {
    const orphan = [...full(), document({ id: 'd-orphan', title: 'Orphan', appliesTo: [] })];
    expect(messages(orphan)).toContain('is not applied at any ask');
  });

  it('refuses a document with neither clauses nor an attachment', () => {
    const empty = [...full(), document({ id: 'd-empty', title: 'Empty', clauses: [] })];
    expect(messages(empty)).toContain('there is nothing for a supplier to accept');
  });

  it('accepts a document that is an attachment rather than clauses', () => {
    const attached = [
      ...full(),
      document({ id: 'd-file', title: 'Site rules', clauses: [], attachmentName: 'site-rules.pdf' }),
    ];
    expect(blocking(attached)).toEqual([]);
  });

  it('refuses payment figures that add up to more than the order', () => {
    const documents = full();
    documents[1].payment = { ...documents[1].payment!, advancePct: 60, retentionPct: 50 };
    expect(messages(documents)).toContain('come to 110% of the order');
  });

  it('warns about retention with no release date, rather than refusing it', () => {
    const documents = full();
    documents[1].payment = { ...documents[1].payment!, retentionPct: 5, retentionReleaseDays: 0 };
    const issue = validateTerms(documents, LADDER)
      .find((i) => i.field === 'payment.retentionReleaseDays')!;
    expect(issue.blocking).toBe(false);
    expect(issue.message).toContain('A supplier prices that as never');
  });

  it('warns when core terms ask for no confirmation', () => {
    const documents = full();
    documents[0].acknowledgement = 'NONE';
    const issue = validateTerms(documents, LADDER).find((i) => i.field === 'acknowledgement')!;
    expect(issue.blocking).toBe(false);
    expect(issue.message).toContain('nothing records that a supplier read it');
  });

  it('warns when a document is applied at an ask the journey does not run', () => {
    const documents = full();
    const issue = validateTerms(documents, ['RFQ']).find((i) => i.field === 'appliesTo')!;
    expect(issue.blocking).toBe(false);
    expect(issue.message).toContain('which this journey does not run');
  });

  it('warns about payment terms on an RFI, which asks for no price', () => {
    const documents = [
      instantiateTerms(general, 'evt-1'),
      instantiateTerms(payment, 'evt-1', ['RFI', 'RFQ']),
    ];
    const issue = validateTerms(documents, ['RFI', 'RFQ'])
      .find((i) => i.point === 'RFI' && i.field === 'PAYMENT')!;
    expect(issue.blocking).toBe(false);
  });

  it('names the document at fault so a screen can mark it', () => {
    const documents = [...full(), document({ id: 'd-orphan', appliesTo: [] })];
    expect(validateTerms(documents, LADDER).find((i) => i.field === 'appliesTo')?.documentId)
      .toBe('d-orphan');
  });
});

describe('reading terms back', () => {
  it('summarises payment terms the way a buyer reads them', () => {
    expect(paymentSummary(DEFAULT_PAYMENT_TERMS)).toBe('Net 30 days from goods receipt · firm price');
    expect(paymentSummary({
      creditDays: 45, trigger: 'MILESTONE', advancePct: 10, retentionPct: 5,
      retentionReleaseDays: 90, priceBasis: 'FIRM',
    })).toBe('Net 45 days from milestone certification · 10% advance · 5% retention released after 90 days · firm price');
  });

  it('summarises what an event goes out with', () => {
    const documents = [instantiateTerms(payment, 'e'), instantiateTerms(general, 'e')];
    expect(describeTerms(documents))
      .toBe('General terms and conditions · Payment terms and conditions');
    expect(describeTerms([])).toBe('No terms attached.');
  });

  it('counts a category attached more than once', () => {
    const documents = [instantiateTerms(payment, 'a'), instantiateTerms(milestone, 'b')];
    expect(describeTerms(documents)).toContain('Payment terms and conditions (2)');
  });

  it('has a purpose line for every category, so nothing is unexplained', () => {
    const categories: TermsCategory[] = [
      'GENERAL', 'PAYMENT', 'DELIVERY', 'WARRANTY', 'CONFIDENTIALITY', 'COMPLIANCE', 'BID', 'SPECIAL',
    ];
    for (const category of categories) {
      expect(blankTerms(category, 'x', ['RFQ']).title.length).toBeGreaterThan(0);
    }
  });
});

describe('pointing terms at the journey that will carry them', () => {
  const seeded = () => [instantiateTerms(general, 'draft'), instantiateTerms(payment, 'draft')];

  it('drops the asks the journey does not run', () => {
    const [conditions] = alignTermsToJourney(seeded(), ['RFQ', 'AUCTION']);
    expect(conditions.appliesTo).not.toContain('RFI');
    expect(conditions.appliesTo).not.toContain('RFP');
  });

  it('leaves a direct auction publishable, which is the whole point', () => {
    // JP-01 goes straight from the requisition to a live auction. The library
    // templates were written for the ladder, so without this the two asks it
    // does run go out with nothing attached and publish is blocked with no
    // step on screen to fix it.
    const points: VendorInputPoint[] = ['INTAKE', 'AUCTION'];
    expect(validateTerms(alignTermsToJourney(seeded(), points), points)
      .filter((issue) => issue.blocking)).toEqual([]);
  });

  it('carries the general conditions onto an ask nothing else covers', () => {
    const aligned = alignTermsToJourney(seeded(), ['RFQ', 'NEGOTIATION', 'AUCTION']);
    expect(aligned.find((d) => d.category === 'GENERAL')!.appliesTo).toContain('NEGOTIATION');
  });

  it('carries payment terms onto a priced ask and nowhere else', () => {
    const aligned = alignTermsToJourney(seeded(), ['INTAKE', 'AUCTION']);
    const paid = aligned.find((d) => d.category === 'PAYMENT')!;
    expect(paid.appliesTo).toEqual(['AUCTION']);
  });

  it('leaves everything that is not general or payment where the buyer put it', () => {
    const delivery = blankTerms('DELIVERY', 'draft', ['RFQ']);
    const [, , aligned] = alignTermsToJourney([...seeded(), delivery], ['RFQ', 'AUCTION']);
    expect(aligned.appliesTo).toEqual(['RFQ']);
  });

  it('does not invent a payment document a journey never had', () => {
    const aligned = alignTermsToJourney([instantiateTerms(general, 'draft')], ['RFQ']);
    expect(aligned).toHaveLength(1);
    // Saying so is validation's job, not this function's.
    expect(validateTerms(aligned, ['RFQ']).some((i) => i.field === 'PAYMENT')).toBe(true);
  });

  it('survives a switch from one journey to another, which is how a buyer gets here', () => {
    // The wizard opens on JP-02 and the buyer chooses the direct auction. The
    // RFQ the payment terms were pointed at stops existing on the way, so
    // without widening ahead of the drop the auction goes out unpriced.
    const rfq = alignTermsToJourney(seeded(), ['RFQ']);
    const auction = alignTermsToJourney(rfq, ['INTAKE', 'AUCTION']);
    expect(auction.find((d) => d.category === 'PAYMENT')!.appliesTo).toEqual(['AUCTION']);
    expect(validateTerms(auction, ['INTAKE', 'AUCTION']).filter((i) => i.blocking)).toEqual([]);
  });

  it('is stable, so switching back and forth does not accumulate asks', () => {
    const once = alignTermsToJourney(seeded(), LADDER);
    expect(alignTermsToJourney(once, LADDER)).toEqual(once);
  });

  it('removes a library copy this journey has no ask for', () => {
    // JP-07 takes a quote at intake and runs nothing else. The payment terms
    // apply where a price is asked, and none of those asks happen.
    const aligned = alignTermsToJourney(seeded(), ['INTAKE']);
    expect(aligned.map((d) => d.category)).toEqual(['GENERAL']);
    expect(validateTerms(aligned, ['INTAKE']).filter((i) => i.blocking)).toEqual([]);
  });

  it('keeps what the buyer wrote, even when it now applies nowhere', () => {
    const own = blankTerms('SPECIAL', 'draft', ['RFP']);
    const aligned = alignTermsToJourney([...seeded(), own], ['RFQ']);
    expect(aligned.map((d) => d.id)).toContain(own.id);
    // Kept, and said out loud rather than deleted behind the buyer's back.
    expect(messages(aligned, ['RFQ'])).toContain('is not applied at any ask');
  });

  it('copies rather than editing what it was given', () => {
    const before = seeded();
    alignTermsToJourney(before, ['RFQ']);
    expect(before[0].appliesTo).toEqual(general.defaultAppliesTo);
  });
});
