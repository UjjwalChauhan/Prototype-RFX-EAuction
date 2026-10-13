/**
 * The terms a supplier is asked to work under.
 *
 * Not one attachment and a tick box. A real RFx goes out with several distinct
 * sets of terms, they do not all apply at the same point in the journey, and
 * the two a buyer is asked about first are always the same two:
 *
 * - **General terms and conditions** — the conditions of purchase. Attached to
 *   every ask, because a supplier answering an RFI is already inside a process
 *   with rules.
 * - **Payment terms** — credit period, advance, retention and what triggers
 *   payment. These belong where price is asked, and nowhere else: quoting a
 *   number without knowing when it is paid is quoting a different number.
 *
 * Around those sit the ones market practice adds as the journey narrows —
 * delivery, warranty, confidentiality, compliance, the bid conditions
 * themselves — and a set of special conditions when the event needs them.
 *
 * Two structural decisions:
 *
 * 1. **Terms belong to the sourcing event and name the points they apply at.**
 *    A document that applies at RFP and RFQ is one document, not two copies
 *    that later disagree. `termsForPoint` resolves what a given ask carries.
 * 2. **A payment document carries structured fields, not only prose.** Credit
 *    days and retention are compared, reported and argued about; leaving them
 *    inside a paragraph makes that impossible.
 *
 * Everything here is pure.
 */
import type { Id, VendorInputPoint } from './types';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type TermsCategory =
  | 'GENERAL'
  | 'PAYMENT'
  | 'DELIVERY'
  | 'WARRANTY'
  | 'CONFIDENTIALITY'
  | 'COMPLIANCE'
  | 'BID'
  | 'SPECIAL';

export const TERMS_CATEGORIES: TermsCategory[] = [
  'GENERAL', 'PAYMENT', 'DELIVERY', 'WARRANTY', 'CONFIDENTIALITY', 'COMPLIANCE', 'BID', 'SPECIAL',
];

export const TERMS_CATEGORY_LABEL: Record<TermsCategory, string> = {
  GENERAL: 'General terms and conditions',
  PAYMENT: 'Payment terms and conditions',
  DELIVERY: 'Delivery and logistics',
  WARRANTY: 'Warranty and defects liability',
  CONFIDENTIALITY: 'Confidentiality',
  COMPLIANCE: 'Compliance, HSE and conduct',
  BID: 'Bid conditions',
  SPECIAL: 'Special conditions',
};

export const TERMS_CATEGORY_PURPOSE: Record<TermsCategory, string> = {
  GENERAL: 'The conditions of purchase every supplier works under. Attached to every ask.',
  PAYMENT: 'Credit period, advance, retention and what triggers payment. Belongs where price is asked.',
  DELIVERY: 'Incoterm, delivery window, partial delivery and what late delivery costs.',
  WARRANTY: 'Warranty period, defect liability and the remedy when something fails.',
  CONFIDENTIALITY: 'What a supplier may do with what this event tells them.',
  COMPLIANCE: 'Health and safety, ESG, anti-bribery and the code of conduct.',
  BID: 'How to bid: validity period, bid security, withdrawal and disqualification.',
  SPECIAL: 'Conditions particular to this event, which override the general set.',
};

/** The two a buyer is asked for first, and blocked without. */
export const CORE_CATEGORIES: TermsCategory[] = ['GENERAL', 'PAYMENT'];

/** Points where a supplier is asked for a price, so payment terms must be known. */
export const PRICED_POINTS: VendorInputPoint[] = ['RFP', 'RFQ', 'AUCTION'];

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

/** What a supplier has to do about a set of terms. */
export type Acknowledgement = 'NONE' | 'ACCEPT' | 'ACCEPT_OR_DEVIATE' | 'SIGN_AND_RETURN';

export const ACKNOWLEDGEMENT_LABEL: Record<Acknowledgement, string> = {
  NONE: 'Read only — no confirmation asked',
  ACCEPT: 'Must accept to submit',
  ACCEPT_OR_DEVIATE: 'Accept, or state a deviation clause by clause',
  SIGN_AND_RETURN: 'Must sign and return the document',
};

export interface TermsClause {
  id: Id;
  /** The reference a buyer and a supplier will both cite: "3.1". */
  code: string;
  title: string;
  text: string;
  /** A deviation here is a rejection, not a negotiation. */
  nonNegotiable: boolean;
}

export type PaymentTrigger = 'INVOICE' | 'GRN' | 'MILESTONE' | 'DELIVERY';

export const PAYMENT_TRIGGER_LABEL: Record<PaymentTrigger, string> = {
  INVOICE: 'receipt of a valid invoice',
  GRN: 'goods receipt',
  MILESTONE: 'milestone certification',
  DELIVERY: 'delivery',
};

/**
 * The structured half of a payment document.
 *
 * Held as fields rather than prose because these are the numbers a comparison
 * sheet puts side by side and an approver argues about. The prose clauses still
 * carry the detail; this carries what has to be machine-readable.
 */
export interface PaymentTerms {
  /** Days from the trigger to payment. */
  creditDays: number;
  trigger: PaymentTrigger;
  /** Paid up front, as a percentage of the order. */
  advancePct: number;
  /** Held back against performance. */
  retentionPct: number;
  /** Days after completion before retention is released. */
  retentionReleaseDays: number;
  /** Whether the quoted price is firm for the contract term. */
  priceBasis: 'FIRM' | 'INDEXED' | 'VARIABLE';
}

export const DEFAULT_PAYMENT_TERMS: PaymentTerms = {
  creditDays: 30,
  trigger: 'GRN',
  advancePct: 0,
  retentionPct: 0,
  retentionReleaseDays: 0,
  priceBasis: 'FIRM',
};

/** One set of terms, attached to an event and applied at named points. */
export interface TermsDocument {
  id: Id;
  eventId: Id;
  category: TermsCategory;
  title: string;
  /** The library template this came from. Null once written from scratch. */
  templateId: Id | null;
  version: string;
  /** The asks it applies at. One document routinely applies at several. */
  appliesTo: VendorInputPoint[];
  acknowledgement: Acknowledgement;
  /** Whether a supplier may propose a change at all. */
  allowDeviation: boolean;
  /** Set when the terms are a file rather than clauses typed here. */
  attachmentName: string | null;
  clauses: TermsClause[];
  /** Set on a payment document. Null on every other category. */
  payment: PaymentTerms | null;
}

/** A document as the wizard holds it, before the event exists to own it. */
export type TermsDocumentInput = Omit<TermsDocument, 'eventId'> & { eventId?: Id };

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export interface TermsTemplate {
  id: Id;
  category: TermsCategory;
  title: string;
  version: string;
  /** Where this template is normally applied. The buyer can change it. */
  defaultAppliesTo: VendorInputPoint[];
  acknowledgement: Acknowledgement;
  allowDeviation: boolean;
  clauses: Omit<TermsClause, 'id'>[];
  payment?: PaymentTerms;
}

/**
 * Copy a library template into an event-owned document.
 *
 * A copy, not a reference: editing an event's payment terms must never reach
 * back into the library and change them for every event that used it.
 */
export function instantiateTerms(
  template: TermsTemplate, idPrefix: string, appliesTo?: VendorInputPoint[],
): TermsDocumentInput {
  return {
    id: `${idPrefix}-${template.id}`,
    category: template.category,
    title: template.title,
    templateId: template.id,
    version: template.version,
    appliesTo: [...(appliesTo ?? template.defaultAppliesTo)],
    acknowledgement: template.acknowledgement,
    allowDeviation: template.allowDeviation,
    attachmentName: null,
    clauses: template.clauses.map((clause, i) => ({ ...clause, id: `${idPrefix}-${template.id}-c${i + 1}` })),
    payment: template.payment ? { ...template.payment } : null,
  };
}

/** An empty document of a category, for a buyer writing their own. */
export function blankTerms(
  category: TermsCategory, idPrefix: string, appliesTo: VendorInputPoint[],
): TermsDocumentInput {
  return {
    id: `${idPrefix}-${category.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    title: TERMS_CATEGORY_LABEL[category],
    templateId: null,
    version: '1.0',
    appliesTo: [...appliesTo],
    acknowledgement: category === 'PAYMENT' || category === 'GENERAL' ? 'ACCEPT_OR_DEVIATE' : 'ACCEPT',
    allowDeviation: true,
    attachmentName: null,
    clauses: [],
    payment: category === 'PAYMENT' ? { ...DEFAULT_PAYMENT_TERMS } : null,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Point a set of terms at the asks a journey actually runs.
 *
 * A library template carries the asks it is normally used at, which are the
 * asks of the journey it was written for — not necessarily this one. Seed a
 * draft from the library and then choose a direct auction, and the general
 * conditions sit at an RFI, an RFP and an RFQ that never happen while the two
 * asks that do happen carry nothing. That is a blocked publish.
 *
 * So: drop the asks this journey does not run, then widen the general and the
 * payment set to cover the asks that would otherwise go out bare. Those two
 * are widened and nothing else is, because those two are what `validateTerms`
 * blocks on — a delivery or warranty document stays exactly where it was put.
 *
 * A document left applying at nothing is removed if it came from the library,
 * because it is a copy and the library still offers it. One the buyer wrote is
 * kept and left for validation to flag: quietly deleting somebody's typing
 * because they changed the pattern is worse than a message.
 */
export function alignTermsToJourney<
  T extends { category: TermsCategory; appliesTo: VendorInputPoint[]; templateId: Id | null },
>(documents: T[], points: VendorInputPoint[]): T[] {
  const aligned = documents.map((document) => ({
    ...document,
    appliesTo: document.appliesTo.filter((point) => points.includes(point)),
  }));

  const widen = (category: TermsCategory, wanted: VendorInputPoint[]) => {
    const covered = new Set(
      aligned.filter((document) => document.category === category)
        .flatMap((document) => document.appliesTo),
    );
    const missing = wanted.filter((point) => !covered.has(point));
    // Nothing to widen onto: a journey with no payment document is left to say
    // so in validation rather than having one invented here.
    const first = aligned.find((document) => document.category === category);
    if (missing.length === 0 || !first) return;
    first.appliesTo = [...first.appliesTo, ...missing];
  };

  // Widening comes before the drop, or a journey moving from one priced ask to
  // another loses its payment terms on the way: the old ask goes, leaving the
  // document applying nowhere, and there is then nothing left to widen onto.
  widen('GENERAL', points);
  widen('PAYMENT', points.filter((point) => PRICED_POINTS.includes(point)));

  return aligned.filter(
    (document) => document.appliesTo.length > 0 || document.templateId === null,
  );
}

const CATEGORY_ORDER = new Map(TERMS_CATEGORIES.map((category, i) => [category, i]));

/** The terms one ask carries, in a stable reading order. */
export function termsForPoint<T extends { category: TermsCategory; appliesTo: VendorInputPoint[] }>(
  documents: T[], point: VendorInputPoint,
): T[] {
  return documents
    .filter((document) => document.appliesTo.includes(point))
    .sort((a, b) => (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99));
}

/** Everything a supplier must actively confirm before they can submit. */
export function mustAcknowledge<T extends { acknowledgement: Acknowledgement }>(
  documents: T[],
): T[] {
  return documents.filter((document) => document.acknowledgement !== 'NONE');
}

/** Payment terms in the one line a buyer reads them as. */
export function paymentSummary(payment: PaymentTerms): string {
  const parts = [`Net ${payment.creditDays} days from ${PAYMENT_TRIGGER_LABEL[payment.trigger]}`];
  if (payment.advancePct > 0) parts.push(`${payment.advancePct}% advance`);
  if (payment.retentionPct > 0) {
    parts.push(
      payment.retentionReleaseDays > 0
        ? `${payment.retentionPct}% retention released after ${payment.retentionReleaseDays} days`
        : `${payment.retentionPct}% retention`,
    );
  }
  parts.push(payment.priceBasis === 'FIRM' ? 'firm price' : `${payment.priceBasis.toLowerCase()} price`);
  return parts.join(' · ');
}

/** A one-line summary of what an event goes out with. */
export function describeTerms(documents: { category: TermsCategory }[]): string {
  if (documents.length === 0) return 'No terms attached.';
  const counted = new Map<TermsCategory, number>();
  for (const document of documents) {
    counted.set(document.category, (counted.get(document.category) ?? 0) + 1);
  }
  return TERMS_CATEGORIES
    .filter((category) => counted.has(category))
    .map((category) => {
      const count = counted.get(category)!;
      return count === 1
        ? TERMS_CATEGORY_LABEL[category]
        : `${TERMS_CATEGORY_LABEL[category]} (${count})`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TermsIssue {
  /** The document at fault, or null when the problem is something missing. */
  documentId: Id | null;
  point: VendorInputPoint | null;
  field: string;
  message: string;
  blocking: boolean;
}

export const POINT_LABEL: Record<string, string> = {
  INTAKE: 'intake', RFI: 'the RFI', RFP: 'the RFP', RFQ: 'the RFQ',
  NEGOTIATION: 'the negotiation', AUCTION: 'the auction',
};

/**
 * What must be true before an event goes out with these terms.
 *
 * The blocking rules are the ones where a supplier would be asked to commit to
 * something nobody has stated: an ask with no terms at all, a price asked
 * without payment terms, two payment documents contradicting each other at the
 * same point. The rest are warnings, because they are judgement.
 */
export function validateTerms(
  documents: { id: Id; category: TermsCategory; title: string; appliesTo: VendorInputPoint[];
    clauses: unknown[]; attachmentName: string | null; payment: PaymentTerms | null;
    acknowledgement: Acknowledgement }[],
  points: VendorInputPoint[],
): TermsIssue[] {
  const issues: TermsIssue[] = [];
  const say = (
    documentId: Id | null, point: VendorInputPoint | null, field: string, message: string,
    blocking = true,
  ) => issues.push({ documentId, point, field, message, blocking });

  for (const document of documents) {
    if (document.appliesTo.length === 0) {
      say(
        document.id, null, 'appliesTo',
        `"${document.title}" is not applied at any ask, so no supplier will ever see it.`,
      );
    }
    for (const point of document.appliesTo) {
      if (!points.includes(point)) {
        say(
          document.id, point, 'appliesTo',
          `"${document.title}" is applied at ${POINT_LABEL[point] ?? point}, which this journey does not run.`,
          false,
        );
      }
    }
    if (document.clauses.length === 0 && document.attachmentName === null) {
      say(
        document.id, null, 'clauses',
        `"${document.title}" has no clauses and no attached document — there is nothing for a supplier to accept.`,
      );
    }
    if (document.category === 'PAYMENT') {
      const payment = document.payment;
      if (payment === null) {
        say(document.id, null, 'payment', `"${document.title}" carries no payment figures.`);
      } else {
        if (payment.creditDays < 0) {
          say(document.id, null, 'payment.creditDays', 'A credit period cannot be negative.');
        }
        if (payment.advancePct < 0 || payment.retentionPct < 0) {
          say(document.id, null, 'payment.advancePct', 'Advance and retention cannot be negative.');
        }
        if (payment.advancePct + payment.retentionPct > 100) {
          say(
            document.id, null, 'payment.advancePct',
            `Advance and retention together come to ${payment.advancePct + payment.retentionPct}% of the order.`,
          );
        }
        if (payment.retentionPct > 0 && payment.retentionReleaseDays === 0) {
          say(
            document.id, null, 'payment.retentionReleaseDays',
            'Retention is held with no stated release date. A supplier prices that as never.',
            false,
          );
        }
      }
    } else if (document.payment !== null) {
      say(
        document.id, null, 'payment',
        `"${document.title}" is not a payment document but carries payment figures.`,
        false,
      );
    }
    if (CORE_CATEGORIES.includes(document.category) && document.acknowledgement === 'NONE') {
      say(
        document.id, null, 'acknowledgement',
        `"${document.title}" asks for no confirmation, so nothing records that a supplier read it.`,
        false,
      );
    }
  }

  for (const point of points) {
    const atPoint = documents.filter((document) => document.appliesTo.includes(point));
    if (atPoint.length === 0) {
      say(null, point, 'appliesTo', `No terms are attached to ${POINT_LABEL[point] ?? point}.`);
      continue;
    }
    if (!atPoint.some((document) => document.category === 'GENERAL')) {
      say(
        null, point, 'GENERAL',
        `No general terms and conditions at ${POINT_LABEL[point] ?? point}. A supplier answering it is already inside a process with rules.`,
      );
    }

    const payments = atPoint.filter((document) => document.category === 'PAYMENT');
    if (PRICED_POINTS.includes(point) && payments.length === 0) {
      say(
        null, point, 'PAYMENT',
        `${POINT_LABEL[point] ?? point} asks for a price with no payment terms. When a supplier is paid changes the price they quote.`,
        // At RFP the price is indicative, so this is a warning rather than a bar.
        point !== 'RFP',
      );
    }
    if (payments.length > 1) {
      say(
        payments[1].id, point, 'PAYMENT',
        `Two sets of payment terms apply at ${POINT_LABEL[point] ?? point}: "${payments[0].title}" and "${payments[1].title}". A supplier cannot follow both.`,
      );
    }
    if (point === 'RFI' && payments.length > 0) {
      say(
        payments[0].id, point, 'PAYMENT',
        'Payment terms are attached to the RFI, which asks for no price. Harmless, but they usually belong from the RFP onwards.',
        false,
      );
    }
  }

  return issues;
}
