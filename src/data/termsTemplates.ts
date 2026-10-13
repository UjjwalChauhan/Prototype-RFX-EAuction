/**
 * The terms library.
 *
 * What a category manager actually starts from: a small set of standard
 * documents, each with the clauses that get cited in practice, applied by
 * default where market practice applies them. A buyer adds one, edits it for
 * this event, and the library is untouched.
 *
 * The clause numbering is deliberate. A supplier writes "we deviate on 4.2",
 * an approver reads "deviation on 4.2" in the NFA, and both mean the same line.
 */
import type { TermsTemplate } from '../domain/terms';

export const TERMS_TEMPLATES: TermsTemplate[] = [
  {
    id: 'tt-general-purchase',
    category: 'GENERAL',
    title: 'General conditions of purchase',
    version: '3.2',
    // Every ask, including the two shorter journeys reach first: a quote given
    // at intake and a bid placed in an auction are both commitments, and a
    // supplier cannot make one under conditions nobody has stated.
    defaultAppliesTo: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION'],
    acknowledgement: 'ACCEPT_OR_DEVIATE',
    allowDeviation: true,
    clauses: [
      {
        code: '1.1', title: 'Scope and precedence',
        text: 'These conditions govern any order placed as a result of this event. Where a special condition issued with this event conflicts with these, the special condition prevails.',
        nonNegotiable: false,
      },
      {
        code: '2.3', title: 'Prices and taxes',
        text: 'Quoted prices are exclusive of recoverable taxes and inclusive of packing, marking and documentation. No charge not quoted is payable.',
        nonNegotiable: true,
      },
      {
        code: '9.1', title: 'Limitation of liability',
        text: 'Liability under any resulting order is capped at the value of that order in the preceding twelve months, save for death, personal injury, fraud or breach of confidentiality.',
        nonNegotiable: false,
      },
      {
        code: '11.4', title: 'Termination for convenience',
        text: 'The buyer may terminate on thirty days written notice, paying for goods delivered and work certified to that date and nothing further.',
        nonNegotiable: false,
      },
      {
        code: '13.2', title: 'Governing law and disputes',
        text: 'Governed by the laws of the United Arab Emirates. Disputes are referred to the DIFC-LCIA Arbitration Centre, seated in Dubai, in English.',
        nonNegotiable: true,
      },
    ],
  },
  {
    id: 'tt-payment-net30-grn',
    category: 'PAYMENT',
    title: 'Payment terms — Net 30 from goods receipt',
    version: '2.0',
    defaultAppliesTo: ['RFP', 'RFQ', 'AUCTION'],
    acknowledgement: 'ACCEPT_OR_DEVIATE',
    allowDeviation: true,
    payment: {
      creditDays: 30, trigger: 'GRN', advancePct: 0, retentionPct: 0,
      retentionReleaseDays: 0, priceBasis: 'FIRM',
    },
    clauses: [
      {
        code: '3.1', title: 'Payment period',
        text: 'Payment is made thirty days from goods receipt against a valid tax invoice quoting the purchase order number. An invoice that does not quote it is returned, and the period runs from resubmission.',
        nonNegotiable: false,
      },
      {
        code: '3.4', title: 'Price validity',
        text: 'Prices are firm for the contract term. No index adjustment applies unless it is agreed in writing at award and recorded on the order.',
        nonNegotiable: true,
      },
      {
        code: '3.7', title: 'Set-off',
        text: 'The buyer may set off against any sum due any amount the supplier owes under this or any other order.',
        nonNegotiable: false,
      },
    ],
  },
  {
    id: 'tt-payment-milestone',
    category: 'PAYMENT',
    title: 'Payment terms — milestone with advance and retention',
    version: '1.4',
    defaultAppliesTo: ['RFP', 'RFQ'],
    acknowledgement: 'ACCEPT_OR_DEVIATE',
    allowDeviation: true,
    payment: {
      creditDays: 45, trigger: 'MILESTONE', advancePct: 10, retentionPct: 5,
      retentionReleaseDays: 90, priceBasis: 'FIRM',
    },
    clauses: [
      {
        code: '3.1', title: 'Milestone payment',
        text: 'Payment is made forty-five days from certification of each milestone. A milestone is certified only when every deliverable listed against it has been accepted.',
        nonNegotiable: false,
      },
      {
        code: '3.2', title: 'Advance payment and security',
        text: 'A ten per cent advance is released against an unconditional advance payment guarantee from a bank acceptable to the buyer, valid until the advance is fully recovered.',
        nonNegotiable: true,
      },
      {
        code: '3.3', title: 'Retention',
        text: 'Five per cent of each payment is retained and released ninety days after final acceptance, subject to no open defect.',
        nonNegotiable: false,
      },
    ],
  },
  {
    id: 'tt-delivery',
    category: 'DELIVERY',
    title: 'Delivery, logistics and delay',
    version: '2.1',
    defaultAppliesTo: ['RFQ', 'AUCTION'],
    acknowledgement: 'ACCEPT_OR_DEVIATE',
    allowDeviation: true,
    clauses: [
      {
        code: '4.1', title: 'Incoterm and place',
        text: 'DDP to the delivery location named on the line, Incoterms 2020. Title and risk pass on acceptance at that location.',
        nonNegotiable: false,
      },
      {
        code: '4.2', title: 'Delivery window and partial delivery',
        text: 'Delivery is within the quoted lead time from order. Partial delivery is accepted only where the order permits it.',
        nonNegotiable: false,
      },
      {
        code: '5.4', title: 'Liquidated damages for delay',
        text: 'Late delivery attracts liquidated damages of 0.5% of the value of the delayed goods per week, capped at 5% of the order value. This is a genuine pre-estimate of loss, not a penalty.',
        nonNegotiable: true,
      },
    ],
  },
  {
    id: 'tt-warranty',
    category: 'WARRANTY',
    title: 'Warranty and defects liability',
    version: '1.2',
    defaultAppliesTo: ['RFP', 'RFQ'],
    acknowledgement: 'ACCEPT_OR_DEVIATE',
    allowDeviation: true,
    clauses: [
      {
        code: '6.1', title: 'Warranty period',
        text: 'Twelve months from acceptance, or the manufacturer’s standard warranty where it is longer.',
        nonNegotiable: false,
      },
      {
        code: '6.3', title: 'Remedy',
        text: 'A defect is repaired or replaced at the supplier’s cost within fifteen working days of notification, including collection and redelivery.',
        nonNegotiable: false,
      },
    ],
  },
  {
    id: 'tt-nda',
    category: 'CONFIDENTIALITY',
    title: 'Confidentiality undertaking',
    version: '1.0',
    defaultAppliesTo: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
    acknowledgement: 'SIGN_AND_RETURN',
    allowDeviation: false,
    clauses: [
      {
        code: '1.1', title: 'Confidential information',
        text: 'Everything disclosed in this event, including volumes, specifications and the fact of the event itself, is confidential and is used only to prepare a response.',
        nonNegotiable: true,
      },
      {
        code: '1.4', title: 'Duration',
        text: 'The undertaking survives for three years from the close of this event, whether or not an order follows.',
        nonNegotiable: true,
      },
    ],
  },
  {
    id: 'tt-compliance',
    category: 'COMPLIANCE',
    title: 'Supplier code of conduct, HSE and ESG',
    version: '4.0',
    defaultAppliesTo: ['RFI', 'RFP', 'RFQ'],
    acknowledgement: 'ACCEPT',
    allowDeviation: false,
    clauses: [
      {
        code: '8.1', title: 'Code of conduct',
        text: 'The supplier complies with the buyer’s supplier code of conduct, including anti-bribery, sanctions, modern slavery and conflict-of-interest provisions.',
        nonNegotiable: true,
      },
      {
        code: '8.5', title: 'Health, safety and environment',
        text: 'Work on the buyer’s premises follows the site HSE rules. An incident is reported within twenty-four hours.',
        nonNegotiable: true,
      },
    ],
  },
  {
    id: 'tt-bid-conditions',
    category: 'BID',
    title: 'Conditions of bidding',
    version: '2.2',
    defaultAppliesTo: ['RFP', 'RFQ', 'AUCTION'],
    acknowledgement: 'ACCEPT',
    allowDeviation: false,
    clauses: [
      {
        code: '2.1', title: 'Bid validity',
        text: 'A bid stays open for acceptance for ninety days from the response deadline.',
        nonNegotiable: true,
      },
      {
        code: '2.4', title: 'Costs of bidding',
        text: 'A supplier bears its own costs of responding. The buyer is not obliged to award, and may cancel the event at any point before award.',
        nonNegotiable: true,
      },
      {
        code: '2.6', title: 'Conduct',
        text: 'Collusion, bid rigging or any attempt to influence the evaluation disqualifies the bid and may end the commercial relationship.',
        nonNegotiable: true,
      },
    ],
  },
];

/** The templates that apply at a point, for the "add from library" list. */
export function templatesForPoint(point: string): TermsTemplate[] {
  return TERMS_TEMPLATES.filter((template) =>
    (template.defaultAppliesTo as string[]).includes(point));
}
