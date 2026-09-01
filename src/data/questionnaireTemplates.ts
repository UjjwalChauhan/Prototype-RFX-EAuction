/**
 * Seeded questionnaire templates.
 *
 * Chosen to make the multi-stage case concrete rather than to be exhaustive:
 * QT-001 qualifies at RFI, QT-002 evaluates at RFP, QT-003 prices at RFQ, and
 * QT-004 re-confirms at negotiation. Three codes — CO.ISO9001, CO.YEARS and
 * CAP.CAPACITY — deliberately appear at more than one point, so the inheritance
 * view has something real to show: a supplier who declared ISO 9001 at RFI
 * should not be asked for it again at RFP.
 *
 * QT-005 is deliberately invalid — it carries a weighted price schedule and a
 * commercial question at RFI — so the studio's validation has something to
 * catch on first load rather than only after a buyer makes a mistake.
 */
import { defaultConfigFor, optionsFromPreset, presetById } from '../domain/questionTypes';
import type { QuestionnaireTemplate, TemplateQuestion } from '../domain/types';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function q(
  templateId: string,
  sectionId: string,
  sequence: number,
  code: string,
  partial: Partial<TemplateQuestion> & Pick<TemplateQuestion, 'type' | 'title'>,
): TemplateQuestion {
  const id = `${templateId}-q${sequence}`;
  return {
    id,
    templateId,
    sectionId,
    sequence,
    code,
    helpText: '',
    isRequired: true,
    envelope: 'TECHNICAL',
    weight: 10,
    scoringMethod: 'MANUAL',
    maxScore: 10,
    rubric: null,
    isKnockout: false,
    allowAttachment: false,
    ...partial,
    // The answer format defaults to whatever the type needs, so a seeded
    // question is askable without spelling out every field.
    config: partial.config ?? defaultConfigFor(partial.type, id),
  };
}

/** A seeded choice list, taken from the same suggestions the builder offers. */
function choices(presetId: string, templateId: string, sequence: number) {
  return { options: optionsFromPreset(presetById(presetId), `${templateId}-q${sequence}`) };
}

// ---------------------------------------------------------------------------
// QT-001 — RFI qualification. Capability only; no commercials by definition.
// ---------------------------------------------------------------------------

const QT1 = 'qt-001';

const RFI_QUALIFICATION: QuestionnaireTemplate = {
  id: QT1,
  code: 'QT-RFI-QUALIFICATION',
  name: 'Supplier qualification — RFI',
  description:
    'Capability, credentials and compliance, asked before anyone is invited to price. Knockouts here keep unqualified suppliers out of the priced stages entirely.',
  appliesTo: ['RFI'],
  categories: [],
  sections: [
    { id: `${QT1}-sec-1`, name: 'Company & compliance', sequence: 1 },
    { id: `${QT1}-sec-2`, name: 'Capability', sequence: 2 },
    { id: `${QT1}-sec-3`, name: 'Sustainability', sequence: 3 },
  ],
  questions: [
    q(QT1, `${QT1}-sec-1`, 1, 'CO.YEARS', {
      type: 'number', title: 'Years trading in this category',
      helpText: 'Whole years.', weight: 10, scoringMethod: 'RULE',
      rubric: '0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10',
      config: { min: 0, max: 200, unit: 'years', decimals: 0 },
    }),
    q(QT1, `${QT1}-sec-1`, 2, 'CO.ISO9001', {
      type: 'certificate', title: 'ISO 9001 certification',
      helpText: 'Attach a current certificate.', weight: 15,
      rubric: 'Valid = 10 · Expired = 4 · Absent = 0',
      isKnockout: true, allowAttachment: true,
    }),
    q(QT1, `${QT1}-sec-1`, 3, 'CO.INSURANCE', {
      type: 'certificate', title: 'Public liability insurance',
      helpText: 'Minimum cover £5m. Attach the schedule.', weight: 10,
      rubric: 'At or above minimum = 10 · Below = 0', isKnockout: true, allowAttachment: true,
    }),
    q(QT1, `${QT1}-sec-2`, 4, 'CAP.CAPACITY', {
      type: 'capacity_declaration', title: 'Monthly capacity in this category',
      helpText: 'Units per month you can reliably supply.',
      weight: 15, scoringMethod: 'AI_ASSISTED', allowAttachment: true,
      rubric: 'Assessed against the volume in the demand.',
    }),
    q(QT1, `${QT1}-sec-2`, 5, 'CAP.REFERENCES', {
      type: 'reference_submission', title: 'Three contactable references',
      helpText: 'Comparable scope and scale, within the last three years.',
      weight: 10, allowAttachment: true,
      rubric: 'Three comparable = 10 · Two = 6 · Fewer = 2',
    }),
    q(QT1, `${QT1}-sec-2`, 6, 'CAP.FOOTPRINT', {
      type: 'multiple_choice', title: 'Regions you can serve',
      helpText: 'Select every region you can deliver into.', weight: 10, scoringMethod: 'RULE',
      rubric: 'Two points per region served, capped at 10.',
      config: { ...choices('regions', QT1, 6), minSelections: 1, maxSelections: null },
    }),
    q(QT1, `${QT1}-sec-3`, 7, 'SUS.POLICY', {
      type: 'file_upload', title: 'Environmental policy',
      helpText: 'Current signed policy.', weight: 5, allowAttachment: true,
      rubric: 'Present and current = 10 · Present but stale = 5 · Absent = 0',
    }),
    q(QT1, `${QT1}-sec-3`, 8, 'SUS.SCOPE12', {
      type: 'yes_no', title: 'Do you report Scope 1 and 2 emissions?',
      helpText: '', weight: 5, scoringMethod: 'RULE', rubric: 'Yes = 10 · No = 0',
    }),
  ],
  status: 'PUBLISHED',
  version: 3,
  scopeType: 'TENANT',
  scopeId: 'tenant-udaan',
  createdBy: 'user-ar',
  createdAt: NOW - 180 * DAY,
};

// ---------------------------------------------------------------------------
// QT-002 — RFP evaluation. Re-confirms two RFI codes, adds method and terms.
// ---------------------------------------------------------------------------

const QT2 = 'qt-002';

const RFP_TECHNICAL: QuestionnaireTemplate = {
  id: QT2,
  code: 'QT-RFP-TECHNICAL',
  name: 'Technical proposal — RFP',
  description:
    'The scored technical proposal. Re-confirms the qualification codes rather than re-asking them, and adds method, service levels and commercial terms that are not price.',
  appliesTo: ['RFP'],
  categories: [],
  sections: [
    { id: `${QT2}-sec-1`, name: 'Company & compliance', sequence: 1 },
    { id: `${QT2}-sec-2`, name: 'Method & delivery', sequence: 2 },
    { id: `${QT2}-sec-3`, name: 'Commercial terms', sequence: 3 },
  ],
  questions: [
    q(QT2, `${QT2}-sec-1`, 1, 'CO.ISO9001', {
      type: 'certificate', title: 'ISO 9001 certification',
      helpText: 'Carried from RFI where already supplied.', weight: 10,
      rubric: 'Valid = 10 · Expired = 4 · Absent = 0',
      isKnockout: true, allowAttachment: true,
    }),
    q(QT2, `${QT2}-sec-1`, 2, 'CO.YEARS', {
      type: 'number', title: 'Years trading in this category',
      helpText: 'Carried from RFI where already supplied.',
      weight: 5, scoringMethod: 'RULE', rubric: '0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10',
      config: { min: 0, max: 200, unit: 'years', decimals: 0 },
    }),
    q(QT2, `${QT2}-sec-2`, 3, 'MTH.APPROACH', {
      type: 'long_text', title: 'Delivery method and mobilisation plan',
      helpText: 'Two pages maximum.', weight: 20, scoringMethod: 'AI_ASSISTED',
      rubric: 'Scored on specificity, risk handling and realism of the timeline.',
    }),
    q(QT2, `${QT2}-sec-2`, 4, 'CAP.CAPACITY', {
      type: 'capacity_declaration', title: 'Monthly capacity in this category',
      helpText: 'Carried from RFI. Re-confirm if it has changed.',
      weight: 10, scoringMethod: 'AI_ASSISTED', allowAttachment: true,
      rubric: 'Assessed against the volume in the demand.',
    }),
    q(QT2, `${QT2}-sec-2`, 5, 'MTH.LEADTIME', {
      type: 'lead_time', title: 'Standard lead time from order to delivery',
      helpText: 'Calendar days.', weight: 15, scoringMethod: 'RULE',
      rubric: '≤5 days = 10 · 6–10 = 7 · 11–20 = 4 · >20 = 1',
    }),
    q(QT2, `${QT2}-sec-2`, 6, 'MTH.SLA', {
      type: 'matrix_rating', title: 'Service levels offered',
      helpText: 'Against the KPI schedule attached to the event.', weight: 10,
      scoringMethod: 'RULE', rubric: 'Scored per KPI, averaged.',
      config: {
        ...choices('rating-5', QT2, 6),
        rows: [
          'On-time delivery', 'Order acknowledgement time',
          'Defect resolution time', 'Account response time',
        ],
      },
    }),
    q(QT2, `${QT2}-sec-3`, 7, 'COM.PAYTERMS', {
      type: 'currency_payment_terms', title: 'Payment terms offered',
      helpText: 'Days from invoice.', envelope: 'COMMERCIAL',
      weight: 10, scoringMethod: 'RULE', rubric: 'Longer credit scores higher; advance scores nothing.',
      config: choices('payment-terms', QT2, 7),
    }),
    q(QT2, `${QT2}-sec-3`, 8, 'COM.WARRANTY', {
      type: 'short_text', title: 'Returns and defect policy',
      helpText: '', envelope: 'COMMERCIAL', isRequired: false, weight: 5,
      rubric: 'Assessed on clarity and coverage.',
    }),
  ],
  status: 'PUBLISHED',
  version: 4,
  scopeType: 'TENANT',
  scopeId: 'tenant-udaan',
  createdBy: 'user-ar',
  createdAt: NOW - 150 * DAY,
};

// ---------------------------------------------------------------------------
// QT-003 — RFQ pricing. The price schedule carries no weight, by rule.
// ---------------------------------------------------------------------------

const QT3 = 'qt-003';

const RFQ_COMMERCIAL: QuestionnaireTemplate = {
  id: QT3,
  code: 'QT-RFQ-COMMERCIAL',
  name: 'Price schedule — RFQ',
  description:
    'Prices against a fixed specification, plus the non-price commercial terms that feed the commercial component. The price schedule itself carries no weight — price reaches the award score through the price component alone.',
  appliesTo: ['RFQ', 'AUCTION'],
  categories: [],
  sections: [
    { id: `${QT3}-sec-1`, name: 'Pricing', sequence: 1 },
    { id: `${QT3}-sec-2`, name: 'Commercial terms', sequence: 2 },
  ],
  questions: [
    q(QT3, `${QT3}-sec-1`, 1, 'COM.PRICES', {
      type: 'price_schedule', title: 'Price schedule',
      helpText: 'Unit prices for every line. Extended values are calculated.',
      envelope: 'COMMERCIAL', weight: 0, scoringMethod: 'NONE', maxScore: 0,
    }),
    q(QT3, `${QT3}-sec-1`, 2, 'COM.VALIDITY', {
      type: 'number', title: 'Price validity, in days',
      helpText: 'From the submission deadline.', envelope: 'COMMERCIAL',
      weight: 5, scoringMethod: 'RULE', rubric: '≥90 = 10 · 60–89 = 7 · 30–59 = 4 · <30 = 1',
      config: { min: 1, max: 365, unit: 'days', decimals: 0 },
    }),
    q(QT3, `${QT3}-sec-2`, 3, 'COM.PAYTERMS', {
      type: 'currency_payment_terms', title: 'Payment terms offered',
      helpText: 'Days from invoice.', envelope: 'COMMERCIAL',
      weight: 10, scoringMethod: 'RULE', rubric: 'Longer credit scores higher; advance scores nothing.',
      config: choices('payment-terms', QT3, 3),
    }),
    q(QT3, `${QT3}-sec-2`, 4, 'COM.INCOTERM', {
      type: 'single_choice', title: 'Incoterm offered',
      helpText: '', envelope: 'COMMERCIAL', weight: 5, scoringMethod: 'RULE',
      rubric: 'Scored on how much of the landed cost the supplier carries.',
      config: choices('incoterms', QT3, 4),
    }),
  ],
  status: 'PUBLISHED',
  version: 2,
  scopeType: 'TENANT',
  scopeId: 'tenant-udaan',
  createdBy: 'user-ar',
  createdAt: NOW - 120 * DAY,
};

// ---------------------------------------------------------------------------
// QT-004 — negotiation re-confirmation, authored at category scope.
// ---------------------------------------------------------------------------

const QT4 = 'qt-004';

const NEGOTIATION_CONFIRM: QuestionnaireTemplate = {
  id: QT4,
  code: 'QT-NEG-CONFIRM',
  name: 'Revised position — negotiation',
  description:
    'What a supplier must restate when responding to a counter-offer. Deliberately short: a negotiation round that re-asks the whole proposal is not a negotiation.',
  appliesTo: ['NEGOTIATION'],
  categories: ['Indirect'],
  sections: [
    { id: `${QT4}-sec-1`, name: 'Revised position', sequence: 1 },
  ],
  questions: [
    q(QT4, `${QT4}-sec-1`, 1, 'NEG.CONCESSION', {
      type: 'long_text', title: 'What has changed in this offer, and why',
      helpText: 'Against your previous submission.', weight: 10,
      rubric: 'Scored on the substance of the movement, not its length.',
    }),
    q(QT4, `${QT4}-sec-1`, 2, 'COM.PAYTERMS', {
      type: 'currency_payment_terms', title: 'Payment terms offered',
      helpText: 'Restate, including any change.', envelope: 'COMMERCIAL',
      weight: 10, scoringMethod: 'RULE', rubric: 'Longer credit scores higher; advance scores nothing.',
      config: choices('payment-terms', QT4, 2),
    }),
    q(QT4, `${QT4}-sec-1`, 3, 'NEG.VALIDITY', {
      type: 'date', title: 'This revised offer is valid until',
      helpText: '', envelope: 'COMMERCIAL', weight: 0, scoringMethod: 'NONE', maxScore: 0,
    }),
  ],
  status: 'PUBLISHED',
  version: 1,
  scopeType: 'CATEGORY',
  scopeId: 'Indirect',
  createdBy: 'user-ar',
  createdAt: NOW - 40 * DAY,
};

// ---------------------------------------------------------------------------
// QT-005 — deliberately invalid, so validation has something real to catch.
// ---------------------------------------------------------------------------

const QT5 = 'qt-005';

const BROKEN_DRAFT: QuestionnaireTemplate = {
  id: QT5,
  code: 'QT-RFI-COMBINED',
  name: 'Combined qualification and pricing — RFI',
  description:
    'A draft that tries to qualify and price in one asking at RFI. Left in place because the studio should catch it: a weighted price schedule counts price twice, and commercial questions have no place at RFI.',
  appliesTo: ['RFI', 'RFQ'],
  categories: [],
  sections: [
    { id: `${QT5}-sec-1`, name: 'Everything', sequence: 1 },
  ],
  questions: [
    q(QT5, `${QT5}-sec-1`, 1, 'CO.YEARS', {
      type: 'number', title: 'Years trading in this category',
      weight: 10, scoringMethod: 'RULE', rubric: '0–2 = 2 · 3–5 = 6 · 6+ = 10',
      config: { min: 0, max: 200, unit: 'years', decimals: 0 },
    }),
    q(QT5, `${QT5}-sec-1`, 2, 'COM.PRICES', {
      // Weighted price schedule — price would reach the score twice.
      type: 'price_schedule', title: 'Indicative price schedule',
      envelope: 'COMMERCIAL', weight: 30, scoringMethod: 'MANUAL',
    }),
    q(QT5, `${QT5}-sec-1`, 3, 'COM.DISCOUNT', {
      // Commercial question in a template applied at RFI.
      type: 'number', title: 'Volume discount offered, in percent',
      envelope: 'COMMERCIAL', weight: 10, scoringMethod: 'RULE',
      rubric: '≥10% = 10 · 5–9% = 6 · <5% = 2',
      config: { min: 0, max: 100, unit: 'percent', decimals: 1 },
    }),
    q(QT5, `${QT5}-sec-1`, 4, 'SUS.NOTES', {
      // Weight with no scoring — inert, and it inflates the total.
      type: 'long_text', title: 'Anything else on sustainability',
      isRequired: false, weight: 15, scoringMethod: 'NONE', maxScore: 0,
    }),
  ],
  status: 'DRAFT',
  version: 1,
  scopeType: 'TENANT',
  scopeId: 'tenant-udaan',
  createdBy: 'user-ar',
  createdAt: NOW - 9 * DAY,
};

export const TENANT_TEMPLATES: QuestionnaireTemplate[] = [
  RFI_QUALIFICATION, RFP_TECHNICAL, RFQ_COMMERCIAL, BROKEN_DRAFT,
];

export const CATEGORY_TEMPLATES: QuestionnaireTemplate[] = [NEGOTIATION_CONFIRM];

/**
 * Default weighting across the journey: qualification counts, but the scored
 * proposal at RFP is what decides a technical ranking.
 */
export const DEFAULT_STAGE_WEIGHTING = [
  { point: 'INTAKE' as const, weight: 0 },
  { point: 'RFI' as const, weight: 20 },
  { point: 'RFP' as const, weight: 60 },
  { point: 'RFQ' as const, weight: 20 },
  { point: 'NEGOTIATION' as const, weight: 0 },
  { point: 'AUCTION' as const, weight: 0 },
];
