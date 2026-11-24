/**
 * Commercial evaluation — everything that happens to a price between the
 * commercial envelope opening and a rank.
 *
 * Two suppliers quote ₹100 a unit and are not offering the same thing: one
 * delivers and one is ex-works, one wants 15 days and one 90, one quotes in
 * dollars, one is a composition dealer whose tax can never be claimed back.
 * The buyer converts every quote into an *evaluated cost* and ranks on that.
 * The supplier never sees the conversion; they quote a number and are told
 * nothing about how it was read.
 *
 * Method (the questionnaire design note, §6):
 *   1. Re-do the arithmetic. The unit price governs; a different extended value
 *      is recorded as a correction, never silently adopted.
 *   2. Commercial knockouts — validity, escalation, all-inclusive pricing and
 *      non-negotiable terms. A failure keeps the bid out of the ranking.
 *   3. Evaluated cost = quoted value (ex-GST, net of credits) + GST the buyer
 *      cannot reclaim + payment-term financing + the buyer's own components.
 *   4. Rank. L1 on evaluated cost; or QCBS, where the price component is
 *      F = 100 × Cmin ÷ Ci. The ratio form, because the linear one goes negative.
 *   5. Preferences are noted, then the declared tie-break ladder runs.
 *   6. A bid far below the rest is asked to justify itself. Never auto-rejected.
 *
 * Price is not scored here. It becomes a score once, in the award formula;
 * the non-price commercial questions are scored separately and the two are
 * kept apart so price cannot be counted twice.
 */
import type {
  CostComponent, CostComponentKind, Id, LineItem, PriceLine, Question, QuestionEvalType,
  Response, Score, Side,
} from './types';
import { PRICED_QUESTION_TYPES, STRUCTURAL_TYPES } from './questionnaireTemplates';
import { priceScore } from './evaluation';
import { agreedValue } from './employeePortal';
import type { RequestKind } from './buyerRequests';

// ---------------------------------------------------------------------------
// Rules — declared with the event, frozen at publish
// ---------------------------------------------------------------------------

export type ComparisonBasis = 'GROSS' | 'NET' | 'LANDED';
export type CommercialMethod = 'L1' | 'QCBS';

export const BASIS_LABEL: Record<ComparisonBasis, string> = {
  GROSS: 'Gross', NET: 'Net', LANDED: 'Landed',
};

export const BASIS_NOTE: Record<ComparisonBasis, string> = {
  GROSS: 'List price × quantity, before discounts. Tax and freight are left out.',
  NET: 'After discounts. Tax and freight are left out.',
  LANDED: 'Net, plus freight and any GST the buyer cannot reclaim, less credits. Recoverable GST is left out.',
};

/** The rate a foreign-currency bid is converted at — shown, never silent. */
export interface FxRate {
  currency: string;
  /** Units of the event currency in one unit of this currency. */
  rate: number;
  source: string;
  frozenAt: number;
}

export interface CommercialRules {
  currency: string;
  side: Side;
  basis: ComparisonBasis;
  method: CommercialMethod;
  /** Technical share of the combined score. Only read under QCBS. */
  technicalWeight: number;
  /** The tenant's annual cost of capital, in percent. */
  costOfCapital: number;
  standardPaymentDays: number;
  /** How long a bid must stay valid to cover the expected award date. */
  requiredValidityDays: number;
  /** Below the average of eligible bids by more than this, justification is asked for. */
  abnormallyLowPct: number;
  /** A line priced this far from the median across bidders is flagged. */
  outlierPct: number;
  /** The most price escalation a bid may carry and stay responsive. */
  escalationCapPct: number;
  /** Lines two bidders must price identically before it is an integrity signal. */
  identicalMinLines: number;
  /** A preferred bidder within this share of L1 may be invited to match it. */
  preferenceMarginPct: number;
  fx: Record<string, FxRate>;
  /** GST by item tax class. */
  gstRates: Record<string, number>;
}

export const DEFAULT_GST: Record<string, number> = {
  STANDARD: 18, REDUCED: 12, ZERO: 0,
  /** Blocked credit under §17(5): charged, and a real cost to the buyer. */
  BLOCKED: 18,
};

/** Tax classes whose GST the buyer cannot claim back, whoever the supplier is. */
export const NON_CREDITABLE_CLASSES = ['BLOCKED'];

export function defaultRules(partial: Partial<CommercialRules> & { currency: string; side: Side }): CommercialRules {
  return {
    basis: 'LANDED',
    method: 'L1',
    technicalWeight: 70,
    costOfCapital: 9,
    standardPaymentDays: 45,
    requiredValidityDays: 45,
    abnormallyLowPct: 20,
    outlierPct: 30,
    escalationCapPct: 5,
    identicalMinLines: 3,
    preferenceMarginPct: 15,
    fx: {},
    gstRates: DEFAULT_GST,
    ...partial,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A short fingerprint of what was frozen at publish, so a change is detectable. */
export function modelHash(rules: CommercialRules, questions: Question[]): string {
  const text = JSON.stringify({
    rules: { ...rules, fx: Object.keys(rules.fx).sort().map((k) => [k, rules.fx[k].rate]) },
    questions: questions
      .filter((q) => !STRUCTURAL_TYPES.includes(q.type))
      .map((q) => [q.code, q.weight, q.maxScore, q.isKnockout, q.rubric, q.evalType ?? null]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// What each commercial question does
// ---------------------------------------------------------------------------

export type Treatment = 'PRICE' | QuestionEvalType;

export const TREATMENT_LABEL: Record<Treatment, string> = {
  PRICE: 'Price', KO: 'Knockout', SCORED: 'Scored', INFO: 'Information only',
  MONETISED: 'Converted to money', LOADING: 'Loading', PREFERENCE: 'Preference',
};

export const TREATMENT_NOTE: Record<Treatment, string> = {
  PRICE: 'Read in the price schedule. Never scored here — price becomes a score once, in the award formula.',
  KO: 'Pass or fail. A fail keeps the bid out of the ranking.',
  SCORED: 'Scored 0 to the maximum against the rubric, then weighted.',
  INFO: 'Read, not evaluated.',
  MONETISED: 'Converted to money and added to the evaluated cost. Not scored — that would count it twice.',
  LOADING: 'A material deviation, loaded as a money amount in Adjustments.',
  PREFERENCE: 'Applied after ranking, before the tie-break, where the buyer’s policy allows.',
};

/**
 * What evaluation does with a commercial question.
 *
 * Worked out from the question when it does not say, so a questionnaire written
 * before the evaluation type existed still evaluates sensibly: payment terms
 * are converted to money, a knockout is a gate, a weighted question is scored.
 */
export function treatmentOf(
  q: Pick<Question, 'type' | 'evalType' | 'isKnockout' | 'weight' | 'scoringMethod' | 'maxScore'>,
): Treatment {
  if (PRICED_QUESTION_TYPES.includes(q.type)) return 'PRICE';
  if (q.evalType) return q.evalType;
  if (q.isKnockout) return 'KO';
  if (q.type === 'currency_payment_terms') return 'MONETISED';
  if (q.weight > 0 && q.scoringMethod !== 'NONE' && q.maxScore > 0) return 'SCORED';
  return 'INFO';
}

/** A question converted to money that also carries score weight is counted twice. */
export function countedTwice(q: Question): boolean {
  return treatmentOf(q) === 'MONETISED' && q.weight > 0 && q.scoringMethod !== 'NONE';
}

export function scoredQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type) && treatmentOf(q) === 'SCORED' && q.weight > 0 && q.maxScore > 0);
}

export function knockoutQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => !STRUCTURAL_TYPES.includes(q.type) && treatmentOf(q) === 'KO');
}

export interface CommercialScore {
  /** Out of 100, or null while nothing is scored — unscored is not zero. */
  score: number | null;
  scored: number;
  total: number;
  knockedOut: Question[];
}

export function commercialScore(
  bidderId: Id, questions: Question[], scores: Score[], panel: Id[],
): CommercialScore {
  const scoredQs = scoredQuestions(questions);
  let weighted = 0;
  let weightSum = 0;
  let scored = 0;
  for (const q of scoredQs) {
    const value = agreedValue(scores, bidderId, q, panel);
    if (value === null) continue;
    scored += 1;
    weightSum += q.weight;
    weighted += (value / q.maxScore) * q.weight;
  }
  const knockedOut = knockoutQuestions(questions)
    .filter((q) => agreedValue(scores, bidderId, q, panel) === 0);
  return {
    score: weightSum > 0 ? Math.round((weighted / weightSum) * 1000) / 10 : null,
    scored, total: scoredQs.length, knockedOut,
  };
}

// ---------------------------------------------------------------------------
// A bid's terms
// ---------------------------------------------------------------------------

export interface Deviation {
  clause: string;
  text: string;
  /** Carried from the terms: a non-negotiable clause the supplier took exception to. */
  nonNegotiable: boolean;
}

export interface BidTerms {
  bidderId: Id;
  validityDays: number | null;
  paymentDays: number | null;
  delivery: 'DELIVERED' | 'EX_WORKS';
  /** A composition dealer charges no GST, so the price is all-in and nothing can be reclaimed. */
  taxProfile: 'REGULAR' | 'COMPOSITION';
  allInclusive: boolean;
  escalationPct: number;
  /** Buy-back or trade-in credit, in the event currency. */
  buyBack: number;
  deviations: Deviation[];
  preference: 'MSE' | 'MAKE_IN_INDIA' | null;
  submittedAt: number | null;
}

export type TermsSeed = Partial<Omit<BidTerms, 'bidderId' | 'submittedAt'>>;

/**
 * A bid's terms, from what the supplier answered and what the offer sheet
 * carried. Payment days come from the payment-terms answer; validity from the
 * shortest validity on any line.
 */
export function deriveTerms(
  response: Response | undefined, bidderId: Id, questions: Question[], extras: TermsSeed = {},
): BidTerms {
  const paymentQ = questions.find((q) => q.type === 'currency_payment_terms');
  const answered = paymentQ ? response?.answers.find((a) => a.questionId === paymentQ.id)?.value : undefined;
  const paymentDays = typeof answered === 'number' ? answered
    : typeof answered === 'string' && /^\d+$/.test(answered.trim()) ? Number(answered) : extras.paymentDays ?? null;
  const lineValidity = (response?.priceLines ?? [])
    .map((l) => l.validityDays)
    .filter((v): v is number => typeof v === 'number');
  return {
    bidderId,
    validityDays: lineValidity.length > 0 ? Math.min(...lineValidity) : extras.validityDays ?? null,
    paymentDays,
    delivery: extras.delivery ?? 'DELIVERED',
    taxProfile: extras.taxProfile ?? 'REGULAR',
    allInclusive: extras.allInclusive ?? true,
    escalationPct: extras.escalationPct ?? 0,
    buyBack: extras.buyBack ?? 0,
    deviations: extras.deviations ?? [],
    preference: extras.preference ?? null,
    submittedAt: response?.submittedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// The price schedule, re-computed
// ---------------------------------------------------------------------------

export interface ScheduleLine {
  lineItemId: Id;
  lotId: Id;
  lineNumber: number;
  itemCode: string;
  description: string;
  qty: number;
  uom: string;
  /** False for a line the supplier did not price: *not offered*. */
  priced: boolean;
  optional: boolean;
  /** As the supplier typed it, in the currency they quoted. */
  quoted: { currency: string; unitPrice: number; uom: string; uomFactor: number } | null;
  /** Rate applied when the quote currency is not the event's. */
  fx: FxRate | null;
  /** Unit price in the event currency, per unit of the asked-for UoM. */
  unitPrice: number;
  discountPct: number;
  gross: number;
  discount: number;
  net: number;
  freight: number;
  taxRate: number;
  tax: number;
  /** GST the buyer can claim back, and GST it cannot. */
  creditableTax: number;
  nonCreditableTax: number;
  /** The supplier's own extended value, in the event currency, when they gave one. */
  suppliedExtended: number | null;
  /** The supplier's figure minus the re-computed one. Non-zero is an arithmetic correction. */
  arithmeticGap: number;
  leadTimeDays: number | null;
  moq: number | null;
  validityDays: number | null;
  notes: string | null;
  source: 'PORTAL' | 'ON_BEHALF' | 'EXTRACTED';
  alternate: { unitPrice: number; note: string } | null;
  fxMissing: boolean;
}

export interface Schedule {
  lines: ScheduleLine[];
  pricedCount: number;
  requiredCount: number;
  /** Required lines the supplier priced — the figure that sits against `requiredCount`. */
  requiredPriced: number;
  /** Every required line is priced. A partial bid is not comparable on total. */
  complete: boolean;
  gross: number;
  discount: number;
  net: number;
  freight: number;
  tax: number;
  creditableTax: number;
  nonCreditableTax: number;
  /** What the supplier would invoice: net + freight + the GST they charge. */
  quotedTotal: number;
  fxMissing: boolean;
  currencies: string[];
}

const ARITH_TOLERANCE = 0.5;

export function buildSchedule(input: {
  response: Response | undefined;
  lines: LineItem[];
  terms: BidTerms;
  rules: CommercialRules;
}): Schedule {
  const { response, lines, terms, rules } = input;
  const out: ScheduleLine[] = [];
  const currencies = new Set<string>();

  for (const item of lines) {
    const pl: PriceLine | undefined = response?.priceLines.find((p) => p.lineItemId === item.id && !p.alternateOf);
    const alt = response?.priceLines.find((p) => p.alternateOf === item.id) ?? null;
    const priced = Boolean(pl) && (pl?.quotedUnitPrice ?? pl?.unitPrice ?? 0) > 0;
    const quoteCurrency = pl?.quotedCurrency ?? pl?.currency ?? rules.currency;
    const foreign = quoteCurrency !== rules.currency;
    const fx = foreign ? rules.fx[quoteCurrency] ?? null : null;
    const fxMissing = priced && foreign && fx === null;
    const rate = foreign ? fx?.rate ?? 0 : 1;
    const factor = pl?.uomFactor && pl.uomFactor > 0 ? pl.uomFactor : 1;
    const quotedUnit = pl ? (foreign ? pl.quotedUnitPrice ?? pl.unitPrice : pl.unitPrice) : 0;
    const unitPrice = priced ? (quotedUnit / factor) * rate : 0;
    const discountPct = pl?.discountPct ?? 0;
    const gross = unitPrice * item.quantity;
    const discount = gross * (discountPct / 100);
    const net = gross - discount;
    const freight = priced ? (pl?.freight ?? 0) * rate : 0;
    const taxClass = item.taxClass ?? 'STANDARD';
    const taxRate = pl?.taxRate ?? rules.gstRates[taxClass] ?? 18;
    // A composition dealer charges no GST: the price is all-in and has nothing in it to reclaim.
    const tax = priced && terms.taxProfile === 'REGULAR' ? (net + freight) * (taxRate / 100) : 0;
    const blocked = NON_CREDITABLE_CLASSES.includes(taxClass);
    const creditableTax = blocked ? 0 : tax;
    const nonCreditableTax = tax - creditableTax;
    const suppliedExtended = pl?.extendedValue !== undefined ? pl.extendedValue * (foreign ? rate : 1) : null;
    const arithmeticGap = priced && suppliedExtended !== null && Math.abs(suppliedExtended - net) > ARITH_TOLERANCE
      ? suppliedExtended - net : 0;
    if (priced) currencies.add(quoteCurrency);
    out.push({
      lineItemId: item.id, lotId: item.lotId, lineNumber: item.lineNumber,
      itemCode: item.itemCode, description: item.description, qty: item.quantity, uom: item.uom,
      priced, optional: item.isOptional,
      quoted: priced && pl ? { currency: quoteCurrency, unitPrice: quotedUnit, uom: pl.quotedUom ?? item.uom, uomFactor: factor } : null,
      fx: foreign ? fx : null,
      unitPrice, discountPct, gross, discount, net, freight, taxRate, tax, creditableTax, nonCreditableTax,
      suppliedExtended, arithmeticGap,
      leadTimeDays: pl?.leadTimeDays ?? null, moq: pl?.moq ?? null,
      validityDays: pl?.validityDays ?? null, notes: pl?.notes ?? null,
      source: pl?.source ?? 'PORTAL',
      alternate: alt ? { unitPrice: alt.unitPrice, note: alt.alternateNote ?? alt.notes ?? 'Alternate offer' } : null,
      fxMissing,
    });
  }

  const priced = out.filter((l) => l.priced);
  const sum = (pick: (l: ScheduleLine) => number) => priced.reduce((a, l) => a + pick(l), 0);
  const required = out.filter((l) => !l.optional);
  const net = sum((l) => l.net);
  const freight = sum((l) => l.freight);
  const tax = sum((l) => l.tax);
  return {
    lines: out,
    pricedCount: priced.length,
    requiredCount: required.length,
    requiredPriced: required.filter((l) => l.priced).length,
    complete: required.length > 0 && required.every((l) => l.priced),
    gross: sum((l) => l.gross),
    discount: sum((l) => l.discount),
    net, freight, tax,
    creditableTax: sum((l) => l.creditableTax),
    nonCreditableTax: sum((l) => l.nonCreditableTax),
    quotedTotal: net + freight + tax,
    fxMissing: out.some((l) => l.fxMissing),
    currencies: [...currencies],
  };
}

// ---------------------------------------------------------------------------
// The buyer's cost components
// ---------------------------------------------------------------------------

export type ValueOrigin = 'MANUAL' | 'MASTER' | 'AGENT';

export const KIND_LABEL: Record<CostComponentKind, string> = {
  FREIGHT: 'Inbound freight', DUTY: 'Customs duty', PACKAGING: 'Packaging',
  SWITCHING: 'Switching or tooling', PAYMENT_TERMS: 'Payment-term financing',
  QUALITY: 'Quality loading', WARRANTY: 'Warranty reserve',
  CURRENCY_RISK: 'Currency risk', CUSTOM: 'Custom component',
};

export const BASIS_NAME: Record<CostComponent['basis'], string> = {
  PER_UNIT: 'per unit', PER_LINE: 'per line', PERCENTAGE: 'percentage', LUMP_SUM: 'lump sum',
};

/** Where a component's value for one bidder came from. A proposal is not yet applied. */
export function originOf(component: CostComponent, bidderId: Id): ValueOrigin {
  return component.valueOrigin?.[bidderId] ?? (component.agentProposed ? 'AGENT' : 'MANUAL');
}

export function kindOf(component: CostComponent): CostComponentKind {
  if (component.kind) return component.kind;
  const name = component.name.toLowerCase();
  if (name.includes('freight')) return 'FREIGHT';
  if (name.includes('duty') || name.includes('customs')) return 'DUTY';
  if (name.includes('payment')) return 'PAYMENT_TERMS';
  if (name.includes('switch') || name.includes('tooling')) return 'SWITCHING';
  if (name.includes('packag')) return 'PACKAGING';
  if (name.includes('warrant')) return 'WARRANTY';
  if (name.includes('quality')) return 'QUALITY';
  if (name.includes('currency')) return 'CURRENCY_RISK';
  return 'CUSTOM';
}

function linesInScope(component: CostComponent, lines: ScheduleLine[]): ScheduleLine[] {
  const priced = lines.filter((l) => l.priced);
  const scope = component.scope;
  if (!scope || scope.type === 'BID') return priced;
  if (scope.type === 'LOT') return priced.filter((l) => scope.ids.includes(l.lotId));
  return priced.filter((l) => scope.ids.includes(l.lineItemId));
}

export function scopeLabel(component: CostComponent, lotNames: Record<Id, string> = {}): string {
  const scope = component.scope;
  if (!scope || scope.type === 'BID') return 'Whole bid';
  if (scope.type === 'LOT') return scope.ids.map((id) => lotNames[id] ?? id).join(', ');
  return `${scope.ids.length} named line${scope.ids.length === 1 ? '' : 's'}`;
}

/** A line's value on the chosen basis, before any buyer component. */
export function lineBasisValue(line: ScheduleLine, basis: ComparisonBasis, buyBackShare = 0): number {
  switch (basis) {
    case 'GROSS': return line.gross;
    case 'NET': return line.net;
    case 'LANDED': return line.net + line.freight + line.nonCreditableTax - buyBackShare;
  }
}

/** What one component adds for one bidder, in the event currency. */
export function componentAmount(
  component: CostComponent, bidderId: Id, schedule: Schedule, basis: ComparisonBasis,
): { raw: number; amount: number; formula: string } {
  const raw = component.valueByBidder[bidderId] ?? 0;
  const scoped = linesInScope(component, schedule.lines);
  switch (component.basis) {
    case 'PER_UNIT': {
      const units = scoped.reduce((a, l) => a + l.qty, 0);
      return { raw, amount: raw * units, formula: `${raw.toLocaleString('en-IN')} × ${units.toLocaleString('en-IN')} units` };
    }
    case 'PER_LINE':
      return { raw, amount: raw * scoped.length, formula: `${raw.toLocaleString('en-IN')} × ${scoped.length} lines` };
    case 'PERCENTAGE': {
      const base = scoped.reduce((a, l) => a + lineBasisValue(l, basis), 0);
      return { raw, amount: (base * raw) / 100, formula: `${raw}% of ${Math.round(base).toLocaleString('en-IN')}` };
    }
    case 'LUMP_SUM':
      return { raw, amount: raw, formula: 'lump sum' };
  }
}

export interface PaymentTermsAdjustment {
  amount: number;
  formula: string;
}

/**
 * −Total × r × (days offered − standard days) ÷ 365.
 *
 * Longer terms are a financing benefit to the buyer and lower the evaluated
 * cost; shorter terms raise it. The rate and the standard are declared with
 * the event, not chosen here.
 */
export function paymentTermsAdjustment(
  base: number, daysOffered: number, standardDays: number, annualRatePct: number,
): PaymentTermsAdjustment {
  const amount = -(base * (annualRatePct / 100) * (daysOffered - standardDays)) / 365;
  return {
    amount,
    formula: `${daysOffered}d offered vs ${standardDays}d standard, financing at ${annualRatePct}% p.a.`,
  };
}

// ---------------------------------------------------------------------------
// One bid, evaluated
// ---------------------------------------------------------------------------

export interface TrailEntry {
  id: string;
  kind: 'QUOTED' | 'BASIS' | 'ADJUSTMENT' | 'RULE' | 'RESULT';
  label: string;
  /** How the amount was worked out, in words. */
  detail: string;
  /** Signed. Positive raises the evaluated cost. */
  amount: number;
  origin?: ValueOrigin | 'RULE';
  componentId?: Id;
}

export interface Proposal {
  componentId: Id;
  name: string;
  basis: CostComponent['basis'];
  value: number;
  amount: number;
  derivedFrom: string;
}

export interface Knockout {
  code: 'VALIDITY' | 'ESCALATION' | 'NOT_ALL_INCLUSIVE' | 'NON_NEGOTIABLE' | 'QUESTION';
  text: string;
}

export interface BidEvaluation {
  bidderId: Id;
  terms: BidTerms;
  schedule: Schedule;
  basis: ComparisonBasis;
  quotedTotal: number;
  /** The quoted value moved onto the chosen basis. */
  basisValue: number;
  adjustments: number;
  /** The evaluated cost — the number ranking reads. */
  transformed: number;
  trail: TrailEntry[];
  /** Agent-proposed values still waiting for a person to accept or override them. */
  proposals: Proposal[];
  knockouts: Knockout[];
  /** Passes every commercial knockout. */
  responsive: boolean;
  /** Eligible to be ranked: responsive, fully priced, every currency convertible. */
  rankable: boolean;
  rank: number | null;
  tied: boolean;
  /** Price component, 0–100. Rendered here, scored once, in the award formula. */
  priceComponent: number | null;
  commercialScore: CommercialScore;
  technical: number | null;
  /** QCBS combined score, when the method is QCBS and a technical score exists. */
  combined: number | null;
  preferenceEligible: boolean;
  averageLeadDays: number | null;
}

export interface EvaluationInput {
  side: Side;
  rules: CommercialRules;
  lines: LineItem[];
  responses: Response[];
  bidderIds: Id[];
  questions: Question[];
  scores: Score[];
  panel: Id[];
  components: CostComponent[];
  termsSeed?: Record<Id, TermsSeed>;
  /** Technical score per bidder, 0–100, where a technical stage ran. */
  technical?: Record<Id, number | null>;
  /** Validity a supplier extended and an evaluator accepted. Longer only — never shortens an offer. */
  validityOverride?: Record<Id, number>;
}

function evaluateOne(
  bidderId: Id, input: EvaluationInput,
): BidEvaluation {
  const { rules, lines, questions, scores, panel, components } = input;
  const response = input.responses.find((r) => r.bidderId === bidderId);
  const base = deriveTerms(response, bidderId, questions, input.termsSeed?.[bidderId]);
  const extended = input.validityOverride?.[bidderId];
  const terms = extended !== undefined && (base.validityDays ?? 0) < extended
    ? { ...base, validityDays: extended } : base;
  const schedule = buildSchedule({ response, lines, terms, rules });
  const basis = rules.basis;
  const trail: TrailEntry[] = [];

  trail.push({
    id: 'quoted', kind: 'QUOTED', label: 'Quoted total',
    detail: 'Net of discount, plus freight and the GST the supplier charges', amount: schedule.quotedTotal,
  });

  // Move the quote onto the comparison basis, one visible step at a time.
  let value = schedule.quotedTotal;
  const step = (id: string, label: string, detail: string, amount: number) => {
    if (Math.abs(amount) < 0.005) return;
    value += amount;
    trail.push({ id, kind: 'BASIS', label, detail, amount });
  };
  if (basis === 'GROSS') {
    step('no-tax', '− GST', 'Tax is left out of a gross comparison', -schedule.tax);
    step('no-freight', '− Supplier freight', 'Freight is left out of a gross comparison', -schedule.freight);
    step('discount-back', '+ Discounts added back', 'Gross is the list price before discount', schedule.discount);
  } else if (basis === 'NET') {
    step('no-tax', '− GST', 'Tax is left out of a net comparison', -schedule.tax);
    step('no-freight', '− Supplier freight', 'Freight is left out of a net comparison', -schedule.freight);
  } else {
    step('recoverable', '− Recoverable GST', 'GST the buyer claims back is not a cost', -schedule.creditableTax);
    step('buy-back', '− Buy-back credit', 'Credit the supplier gives against the order', -terms.buyBack);
  }
  const basisValue = value;

  // The buyer's own components, applied per bidder.
  const proposals: Proposal[] = [];
  let adjustments = 0;
  const supersededPayment = components.some(
    (c) => kindOf(c) === 'PAYMENT_TERMS' && c.valueByBidder[bidderId] !== undefined && originOf(c, bidderId) !== 'AGENT',
  );
  for (const component of components) {
    if (component.valueByBidder[bidderId] === undefined) continue;
    // Payment terms are computed from the days offered; a hand-entered figure would be counted twice.
    if (kindOf(component) === 'PAYMENT_TERMS') continue;
    const { raw, amount, formula } = componentAmount(component, bidderId, schedule, basis);
    const origin = originOf(component, bidderId);
    if (origin === 'AGENT') {
      proposals.push({
        componentId: component.id, name: component.name, basis: component.basis,
        value: raw, amount, derivedFrom: component.source,
      });
      continue;
    }
    if (raw === 0) continue;
    adjustments += amount;
    value += amount;
    trail.push({
      id: `c-${component.id}`, kind: 'ADJUSTMENT',
      label: `${amount < 0 ? '−' : '+'} ${component.name}`,
      detail: `${BASIS_NAME[component.basis]} · ${formula}`,
      amount, origin, componentId: component.id,
    });
  }

  // Payment terms: computed, so the declared rate and standard are what apply.
  if (terms.paymentDays !== null && !supersededPayment) {
    const pay = paymentTermsAdjustment(basisValue, terms.paymentDays, rules.standardPaymentDays, rules.costOfCapital);
    if (Math.abs(pay.amount) >= 0.005) {
      adjustments += pay.amount;
      value += pay.amount;
      trail.push({
        id: 'payment-terms', kind: 'RULE',
        label: `${pay.amount < 0 ? '−' : '+'} Payment terms (${terms.paymentDays}d vs ${rules.standardPaymentDays}d)`,
        detail: pay.formula, amount: pay.amount, origin: 'RULE',
      });
    }
  }

  trail.push({
    id: 'result', kind: 'RESULT', label: '= Evaluated total',
    detail: `On the ${BASIS_LABEL[basis].toLowerCase()} basis`, amount: value,
  });

  // Commercial knockouts.
  const score = commercialScore(bidderId, questions, scores, panel);
  const knockouts: Knockout[] = [];
  if (terms.validityDays !== null && terms.validityDays < rules.requiredValidityDays) {
    knockouts.push({
      code: 'VALIDITY',
      text: `Valid for ${terms.validityDays} days; the expected award needs ${rules.requiredValidityDays}`,
    });
  }
  if (terms.escalationPct > rules.escalationCapPct) {
    knockouts.push({
      code: 'ESCALATION',
      text: `Price escalation of ${terms.escalationPct}% is above the ${rules.escalationCapPct}% cap`,
    });
  }
  if (!terms.allInclusive) {
    knockouts.push({ code: 'NOT_ALL_INCLUSIVE', text: 'Price is not all-inclusive — charges are quoted outside it' });
  }
  for (const d of terms.deviations.filter((x) => x.nonNegotiable)) {
    knockouts.push({ code: 'NON_NEGOTIABLE', text: `Exception to a non-negotiable clause: ${d.clause} — ${d.text}` });
  }
  for (const q of score.knockedOut) {
    knockouts.push({ code: 'QUESTION', text: `Failed commercial knockout ${q.code}: ${q.title}` });
  }

  const responsive = knockouts.length === 0;
  const lead = schedule.lines.filter((l) => l.priced && l.leadTimeDays !== null);
  const technical = input.technical?.[bidderId] ?? null;
  return {
    bidderId, terms, schedule, basis,
    quotedTotal: schedule.quotedTotal, basisValue, adjustments, transformed: value,
    trail, proposals, knockouts, responsive,
    rankable: responsive && schedule.complete && !schedule.fxMissing,
    rank: null, tied: false, priceComponent: null,
    commercialScore: score, technical, combined: null,
    preferenceEligible: false,
    averageLeadDays: lead.length > 0 ? lead.reduce((a, l) => a + (l.leadTimeDays ?? 0), 0) / lead.length : null,
  };
}

export interface EvaluationResult {
  bids: BidEvaluation[];
  /** Rankable bids, best first. */
  ranked: BidEvaluation[];
  /** The best evaluated cost among rankable bids — the F denominator. */
  best: number | null;
  /** Average of rankable evaluated costs, for the abnormally-low test. */
  average: number | null;
}

export function evaluateAll(input: EvaluationInput): EvaluationResult {
  const { side, rules } = input;
  const bids = input.bidderIds.map((id) => evaluateOne(id, input));
  const eligible = bids.filter((b) => b.rankable);
  const values = eligible.map((b) => b.transformed);
  const best = values.length > 0 ? (side === 'BUY' ? Math.min(...values) : Math.max(...values)) : null;

  for (const bid of eligible) {
    bid.priceComponent = round2(priceScore(bid.transformed, values, 'RATIO', side));
    if (rules.method === 'QCBS' && bid.technical !== null) {
      bid.combined = round2((bid.technical * rules.technicalWeight) / 100
        + (bid.priceComponent * (100 - rules.technicalWeight)) / 100);
    }
  }

  /** QCBS ranks on the combined score; L1 on the evaluated cost. A gap under half a paisa is a tie. */
  const better = (a: BidEvaluation, b: BidEvaluation): number => {
    if (a.combined !== null && b.combined !== null) {
      return Math.abs(a.combined - b.combined) > 0.005 ? b.combined - a.combined : 0;
    }
    const gap = side === 'BUY' ? a.transformed - b.transformed : b.transformed - a.transformed;
    return Math.abs(gap) > 0.005 ? gap : 0;
  };

  /** The declared ladder: higher technical → earlier submission → shorter lead time. */
  const ladder = (a: BidEvaluation, b: BidEvaluation): number => {
    if ((a.technical ?? -1) !== (b.technical ?? -1)) return (b.technical ?? -1) - (a.technical ?? -1);
    const ta = a.terms.submittedAt ?? Infinity;
    const tb = b.terms.submittedAt ?? Infinity;
    if (ta !== tb) return ta - tb;
    const la = a.averageLeadDays ?? Infinity;
    const lb = b.averageLeadDays ?? Infinity;
    if (la !== lb) return la - lb;
    return 0;
  };

  const ranked = [...eligible].sort((a, b) => better(a, b) || ladder(a, b));
  ranked.forEach((bid, i) => {
    bid.rank = i + 1;
    const next = ranked[i + 1];
    const prev = ranked[i - 1];
    bid.tied = [next, prev].some((o) => o !== undefined && better(bid, o) === 0 && ladder(bid, o) === 0);
  });

  // A preferred bidder close enough to L1 is noted as eligible to match it.
  if (ranked.length > 0 && best !== null) {
    for (const bid of ranked) {
      if (bid.rank === 1 || bid.terms.preference === null) continue;
      const over = side === 'BUY'
        ? ((bid.transformed - best) / best) * 100
        : ((best - bid.transformed) / best) * 100;
      bid.preferenceEligible = over <= rules.preferenceMarginPct;
    }
  }

  const average = values.length > 0 ? values.reduce((a, v) => a + v, 0) / values.length : null;
  return { bids, ranked, best, average };
}

/** How far each bidder's rank moved between two evaluations. Positive is up. */
export function rankMovement(
  before: Record<Id, number | null>, after: EvaluationResult,
): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const bid of after.bids) {
    const was = before[bid.bidderId] ?? null;
    if (was !== null && bid.rank !== null && was !== bid.rank) out[bid.bidderId] = was - bid.rank;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coverage — the commonest source of an unfair comparison
// ---------------------------------------------------------------------------

export interface CoverageGap {
  componentId: Id;
  component: string;
  /** Bidders the component is applied to, and the ones it is not. */
  appliedTo: Id[];
  missing: Id[];
}

/**
 * Components applied to some bidders and not others.
 *
 * A proposal awaiting a decision is not applied, so it does not count as
 * covered — but a component nobody has applied yet is not uneven, it is
 * simply not in use, and is not reported.
 */
export function commercialCoverage(components: CostComponent[], bidderIds: Id[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const component of components) {
    if (kindOf(component) === 'PAYMENT_TERMS') continue;
    const appliedTo = bidderIds.filter(
      (id) => component.valueByBidder[id] !== undefined && originOf(component, id) !== 'AGENT',
    );
    const missing = bidderIds.filter((id) => !appliedTo.includes(id));
    if (appliedTo.length > 0 && missing.length > 0) {
      gaps.push({ componentId: component.id, component: component.name, appliedTo, missing });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type FlagCode =
  | 'PRICE_OUTLIER' | 'ARITHMETIC' | 'MISSING_LINES' | 'CURRENCY' | 'FX_MISSING'
  | 'VALIDITY' | 'DEVIATION' | 'IDENTICAL_PRICING' | 'ABNORMALLY_LOW'
  | 'EX_WORKS' | 'ESCALATION' | 'NOT_ALL_INCLUSIVE' | 'COMPOSITION' | 'DOUBLE_COUNT'
  | 'UOM' | 'KO_QUESTION';

export type FlagAction = 'CLARIFY' | 'BASIS' | 'REVIEW' | 'RECORD';

export interface CommercialFlag {
  key: string;
  code: FlagCode;
  bidderId: Id | null;
  /** The other party to a comparison — identical pricing involves two bidders. */
  otherBidderId?: Id;
  lineItemId?: Id;
  /** Blocking flags must be dealt with before the evaluation can be completed. */
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  actions: FlagAction[];
  /** A request to the supplier would settle it. */
  askable: boolean;
  /** For a clarification: the plain-language request, written without internal terms. */
  suggestedRequest?: { subject: string; message: string; kind: RequestKind; askValidityDays?: number };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function commercialFlags(
  result: EvaluationResult, input: EvaluationInput,
  names: (id: Id) => string = (id) => id,
): CommercialFlag[] {
  const { rules } = input;
  const flags: CommercialFlag[] = [];
  const add = (f: Omit<CommercialFlag, 'key'>) => {
    flags.push({ ...f, key: `${f.code}:${f.bidderId ?? '-'}:${f.otherBidderId ?? ''}:${f.lineItemId ?? ''}` });
  };

  for (const bid of result.bids) {
    const who = names(bid.bidderId);
    const s = bid.schedule;

    const missing = s.lines.filter((l) => !l.priced && !l.optional);
    if (missing.length > 0) {
      add({
        code: 'MISSING_LINES', bidderId: bid.bidderId, severity: 'BLOCKING', askable: true,
        title: `${missing.length} line${missing.length === 1 ? '' : 's'} not priced`,
        detail: `${who} did not price ${missing.map((l) => l.itemCode).join(', ')}. Those lines are read as not offered, and the bid is not ranked on its total.`,
        actions: ['CLARIFY', 'REVIEW'],
        suggestedRequest: {
          kind: 'MISSING_PRICE', subject: 'Prices missing on some items',
          message: `We could not find a price for ${missing.map((l) => `${l.description} (${l.itemCode})`).join(', ')}. Please send a price for each, or tell us if you are not offering them.`,
        },
      });
    }

    for (const line of s.lines.filter((l) => l.arithmeticGap !== 0)) {
      add({
        code: 'ARITHMETIC', bidderId: bid.bidderId, lineItemId: line.lineItemId, severity: 'WARNING', askable: true,
        title: `Extended value does not match on ${line.itemCode}`,
        detail: `${who} gave ${Math.round(line.suppliedExtended ?? 0).toLocaleString('en-IN')}; unit price × quantity gives ${Math.round(line.net).toLocaleString('en-IN')}. The unit price governs and the correction is recorded.`,
        actions: ['RECORD', 'CLARIFY'],
        suggestedRequest: {
          kind: 'ARITHMETIC', subject: `Please check the total on ${line.itemCode}`,
          message: `The total you gave for ${line.description} does not match your unit price multiplied by the quantity. We will read your unit price as the offer. Please confirm that is right.`,
        },
      });
    }

    for (const cur of s.currencies.filter((c) => c !== rules.currency)) {
      const fx = rules.fx[cur];
      if (!fx) {
        add({
          code: 'FX_MISSING', bidderId: bid.bidderId, severity: 'BLOCKING', askable: false,
          title: `No frozen rate for ${cur}`,
          detail: `${who} quoted in ${cur} and the event declared no conversion rate. The bid cannot be compared until one is set.`,
          actions: ['REVIEW'],
        });
      } else {
        add({
          code: 'CURRENCY', bidderId: bid.bidderId, severity: 'INFO', askable: false,
          title: `Quoted in ${cur}`,
          detail: `Converted at ${fx.rate} ${rules.currency} per ${cur} — ${fx.source}, frozen ${new Date(fx.frozenAt).toLocaleDateString('en-GB')}. Never converted without showing it.`,
          actions: ['REVIEW'],
        });
      }
    }

    if (bid.terms.validityDays !== null && bid.terms.validityDays < rules.requiredValidityDays) {
      add({
        code: 'VALIDITY', bidderId: bid.bidderId, severity: 'BLOCKING', askable: true,
        title: 'Offer expires before the expected award',
        detail: `${who}'s offer is valid for ${bid.terms.validityDays} days. The expected award is ${rules.requiredValidityDays} days after submission.`,
        actions: ['CLARIFY', 'REVIEW'],
        suggestedRequest: {
          kind: 'VALIDITY', subject: 'Please extend how long your offer is valid',
          message: `Your offer is valid for ${bid.terms.validityDays} days, which ends before we expect to decide. Can you keep it open for at least ${rules.requiredValidityDays} days?`,
          askValidityDays: rules.requiredValidityDays,
        },
      });
    }

    if (bid.terms.escalationPct > rules.escalationCapPct) {
      add({
        code: 'ESCALATION', bidderId: bid.bidderId, severity: 'BLOCKING', askable: true,
        title: 'Price escalation above the cap',
        detail: `${who} reserves ${bid.terms.escalationPct}% escalation; the cap is ${rules.escalationCapPct}%.`,
        actions: ['CLARIFY', 'REVIEW'],
        suggestedRequest: {
          kind: 'GENERAL', subject: 'Price changes after you are awarded',
          message: `Your offer allows the price to rise by ${bid.terms.escalationPct}% after award. We can accept at most ${rules.escalationCapPct}%. Please tell us whether you can offer that.`,
        },
      });
    }

    if (!bid.terms.allInclusive) {
      add({
        code: 'NOT_ALL_INCLUSIVE', bidderId: bid.bidderId, severity: 'BLOCKING', askable: true,
        title: 'Price is not all-inclusive',
        detail: `${who} quoted charges outside the price. The event asks for all-inclusive pricing.`,
        actions: ['CLARIFY', 'REVIEW'],
        suggestedRequest: {
          kind: 'GENERAL', subject: 'Please confirm your price includes everything',
          message: 'We are comparing offers on an all-inclusive price. Please confirm your price covers every charge, or send a price that does.',
        },
      });
    }

    for (const d of bid.terms.deviations) {
      add({
        code: 'DEVIATION', bidderId: bid.bidderId,
        severity: d.nonNegotiable ? 'BLOCKING' : 'WARNING', askable: true,
        title: d.nonNegotiable ? `Exception to a non-negotiable clause (${d.clause})` : `Deviation proposed on ${d.clause}`,
        detail: `${who}: ${d.text}${d.nonNegotiable ? ' — carried from the terms, where this clause cannot be negotiated.' : ' — assess any cost as a component under Adjustments.'}`,
        actions: ['CLARIFY', 'REVIEW'],
        suggestedRequest: {
          kind: 'DEVIATION', subject: `About your change to clause ${d.clause}`,
          message: `You proposed a change to clause ${d.clause}: "${d.text}". ${d.nonNegotiable ? 'This clause cannot be changed. Please confirm you will accept it as written.' : 'Please tell us what this would mean for your price if we keep the clause as written.'}`,
        },
      });
    }

    if (bid.terms.delivery === 'EX_WORKS') {
      const covered = input.components.some(
        (c) => kindOf(c) === 'FREIGHT' && c.valueByBidder[bid.bidderId] !== undefined && originOf(c, bid.bidderId) !== 'AGENT',
      );
      if (!covered) {
        add({
          code: 'EX_WORKS', bidderId: bid.bidderId, severity: 'WARNING', askable: false,
          title: 'Ex-works with no inbound freight applied',
          detail: `${who} quotes ex-works, so the buyer carries the freight. Without an inbound-freight component this bid looks cheaper than it is.`,
          actions: ['BASIS', 'REVIEW'],
        });
      }
    }

    if (bid.terms.taxProfile === 'COMPOSITION') {
      add({
        code: 'COMPOSITION', bidderId: bid.bidderId, severity: 'INFO', askable: false,
        title: 'Composition dealer',
        detail: `${who} charges no GST, so the price is read as all-in and nothing in it can be claimed back. A composition dealer cannot supply across states.`,
        actions: ['REVIEW'],
      });
    }

    for (const q of bid.commercialScore.knockedOut) {
      add({
        code: 'KO_QUESTION', bidderId: bid.bidderId, severity: 'BLOCKING', askable: true,
        title: `Failed knockout ${q.code}`,
        detail: `${who} failed “${q.title}”. A knockout keeps the bid out of the ranking.`,
        actions: ['CLARIFY', 'REVIEW'],
      });
    }
  }

  // Lines priced far from the median.
  if (result.bids.length >= 3) {
    for (const item of input.lines) {
      const priced = result.bids
        .map((b) => ({ b, line: b.schedule.lines.find((l) => l.lineItemId === item.id) }))
        .filter((x): x is { b: BidEvaluation; line: ScheduleLine } => Boolean(x.line?.priced));
      if (priced.length < 3) continue;
      const mid = median(priced.map((x) => x.line.unitPrice));
      if (mid <= 0) continue;
      for (const { b, line } of priced) {
        const off = ((line.unitPrice - mid) / mid) * 100;
        if (Math.abs(off) <= rules.outlierPct) continue;
        add({
          code: 'PRICE_OUTLIER', bidderId: b.bidderId, lineItemId: item.id, severity: 'WARNING', askable: true,
          title: `${line.itemCode} is ${Math.abs(off).toFixed(0)}% ${off < 0 ? 'below' : 'above'} the median`,
          detail: `${names(b.bidderId)} priced ${line.itemCode} at ${line.unitPrice.toFixed(2)}; the median across ${priced.length} bidders is ${mid.toFixed(2)}.`,
          actions: ['CLARIFY', 'REVIEW'],
          suggestedRequest: {
            kind: 'PRICE_JUSTIFICATION', subject: `Please confirm your price for ${line.itemCode}`,
            message: `Your price for ${line.description} is well ${off < 0 ? 'below' : 'above'} the other offers we received. Please confirm it is correct, and tell us anything that explains it.`,
          },
        });
      }
    }
  }

  // Identical or near-identical line pricing between two bidders — an integrity signal.
  const bids = result.bids;
  for (let i = 0; i < bids.length; i += 1) {
    for (let j = i + 1; j < bids.length; j += 1) {
      const both = input.lines
        .map((item) => [
          bids[i].schedule.lines.find((l) => l.lineItemId === item.id),
          bids[j].schedule.lines.find((l) => l.lineItemId === item.id),
        ] as const)
        .filter(([a, b]) => a?.priced && b?.priced);
      const same = both.filter(([a, b]) => Math.abs((a?.unitPrice ?? 0) - (b?.unitPrice ?? 0)) <= 0.005);
      if (same.length >= rules.identicalMinLines && same.length / Math.max(both.length, 1) >= 0.5) {
        for (const [me, other] of [[bids[i], bids[j]], [bids[j], bids[i]]] as const) {
          add({
            code: 'IDENTICAL_PRICING', bidderId: me.bidderId, otherBidderId: other.bidderId, severity: 'WARNING', askable: false,
            title: `Identical pricing with ${names(other.bidderId)}`,
            detail: `${same.length} of ${both.length} commonly priced lines carry exactly the same unit price. Independent bids rarely match to the paisa — mark for review before relying on either.`,
            actions: ['REVIEW'],
          });
        }
      }
    }
  }

  // Abnormally low: justification is asked for, never an automatic rejection.
  if (result.average !== null && result.ranked.length >= 3) {
    for (const bid of result.ranked) {
      const below = ((result.average - bid.transformed) / result.average) * 100;
      if (input.side === 'BUY' && below > rules.abnormallyLowPct) {
        add({
          code: 'ABNORMALLY_LOW', bidderId: bid.bidderId, severity: 'WARNING', askable: true,
          title: `${below.toFixed(0)}% below the average of eligible bids`,
          detail: `${names(bid.bidderId)} is more than ${rules.abnormallyLowPct}% below the average. Ask for written justification — this never rejects the bid on its own.`,
          actions: ['CLARIFY', 'REVIEW'],
          suggestedRequest: {
            kind: 'PRICE_JUSTIFICATION', subject: 'Please explain your price',
            message: 'Your overall price is a lot lower than the other offers. Please tell us in writing how you can deliver at this price, so we can be sure it is sustainable.',
          },
        });
      }
    }
  }

  // A question that is converted to money and also scored is counted twice.
  for (const q of input.questions.filter(countedTwice)) {
    add({
      code: 'DOUBLE_COUNT', bidderId: null, severity: 'INFO', askable: false,
      title: `${q.code} is converted to money and also carries a weight`,
      detail: `“${q.title}” moves the evaluated cost, so its score weight is ignored here to avoid counting it twice. Remove the weight in the questionnaire, or its evaluation type.`,
      actions: ['REVIEW'],
    });
  }

  const order = { BLOCKING: 0, WARNING: 1, INFO: 2 } as const;
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ---------------------------------------------------------------------------
// What the evaluator has done about a flag, and about a bidder
// ---------------------------------------------------------------------------

export interface FlagDecision {
  eventId: Id;
  key: string;
  action: FlagAction;
  by: Id;
  at: number;
  note: string;
}

export interface BidderReview {
  eventId: Id;
  bidderId: Id;
  status: 'IN_REVIEW' | 'REVIEWED';
  by: Id;
  at: number;
}

export interface CommercialAuditEntry {
  id: Id;
  eventId: Id;
  bidderId: Id | null;
  at: number;
  actor: Id;
  action:
    | 'ADD' | 'CHANGE' | 'REMOVE' | 'ACCEPT' | 'OVERRIDE' | 'BASIS' | 'ARITHMETIC'
    | 'SCORE' | 'REVIEW' | 'FLAG' | 'REQUEST' | 'COMPLETE' | 'DECLARE';
  subject: string;
  before: string | null;
  after: string | null;
  reason: string;
}

export interface Declaration {
  eventId: Id;
  evaluatorId: Id;
  at: number;
}

export interface CommercialRequestRow {
  id: Id;
  status: 'OPEN' | 'CLOSED';
  bidderId: Id;
}

export function flagStatus(flag: CommercialFlag, decisions: FlagDecision[]): FlagDecision | null {
  return decisions.find((d) => d.key === flag.key) ?? null;
}

// ---------------------------------------------------------------------------
// Completing the evaluation
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id: string;
  label: string;
  met: boolean;
  /** Unmet and blocking disables Complete. Unmet and not blocking is a warning. */
  blocking: boolean;
  detail?: string;
}

export function completionChecklist(input: {
  result: EvaluationResult;
  flags: CommercialFlag[];
  decisions: FlagDecision[];
  reviews: BidderReview[];
  declared: boolean;
  openRequests: number;
  coverageGaps: CoverageGap[];
  bidderIds: Id[];
  names: (id: Id) => string;
}): ChecklistItem[] {
  const { result, flags, decisions, reviews, bidderIds } = input;
  const reviewed = bidderIds.filter((id) => reviews.some((r) => r.bidderId === id && r.status === 'REVIEWED'));
  const blocking = flags.filter((f) => f.severity === 'BLOCKING' && !flagStatus(f, decisions));
  const unscored = result.ranked.filter(
    (b) => b.commercialScore.total > 0 && b.commercialScore.scored < b.commercialScore.total,
  );
  return [
    {
      id: 'declaration', label: 'Conflict-of-interest declaration signed', met: input.declared, blocking: true,
      detail: input.declared ? undefined : 'Every evaluator declares any conflict once per event, before evaluating.',
    },
    {
      id: 'reviewed', label: `Every bidder reviewed (${reviewed.length} of ${bidderIds.length})`,
      met: reviewed.length === bidderIds.length && bidderIds.length > 0, blocking: true,
      detail: bidderIds.filter((id) => !reviewed.includes(id)).map(input.names).join(', ') || undefined,
    },
    {
      id: 'flags', label: 'Every blocking flag dealt with',
      met: blocking.length === 0, blocking: true,
      detail: blocking.length > 0 ? `${blocking.length} outstanding: ${blocking.slice(0, 3).map((f) => f.title).join(' · ')}` : undefined,
    },
    {
      id: 'requests', label: 'Every question to a supplier is settled',
      met: input.openRequests === 0, blocking: true,
      detail: input.openRequests > 0 ? `${input.openRequests} still open` : undefined,
    },
    {
      id: 'scoring', label: 'Commercial scoring complete for every ranked bid',
      met: unscored.length === 0, blocking: true,
      detail: unscored.length > 0 ? unscored.map((b) => `${input.names(b.bidderId)}: ${b.commercialScore.scored} of ${b.commercialScore.total}`).join(' · ') : undefined,
    },
    {
      id: 'coverage', label: 'Every cost component applied evenly',
      met: input.coverageGaps.length === 0, blocking: false,
      detail: input.coverageGaps.length > 0 ? input.coverageGaps.map((g) => g.component).join(', ') : undefined,
    },
    {
      id: 'ranked', label: 'At least one bid is ranked',
      met: result.ranked.length > 0, blocking: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// The record kept at completion — what the comparison sheet and the award note read
// ---------------------------------------------------------------------------

export interface CommercialResultRecord {
  eventId: Id;
  completedBy: Id;
  completedAt: number;
  basis: ComparisonBasis;
  method: CommercialMethod;
  /** Fingerprint of the rules and questions frozen at publish. */
  modelHash: string;
  rows: {
    bidderId: Id;
    quoted: number;
    evaluated: number;
    rank: number | null;
    priceComponent: number | null;
    commercialScore: number | null;
    knockouts: string[];
    trail: TrailEntry[];
  }[];
  flags: { key: string; severity: CommercialFlag['severity']; title: string; resolved: string | null }[];
}

export function resultRecord(input: {
  eventId: Id; by: Id; at: number; rules: CommercialRules; hash: string;
  result: EvaluationResult; flags: CommercialFlag[]; decisions: FlagDecision[];
}): CommercialResultRecord {
  return {
    eventId: input.eventId, completedBy: input.by, completedAt: input.at,
    basis: input.rules.basis, method: input.rules.method, modelHash: input.hash,
    rows: input.result.bids.map((b) => ({
      bidderId: b.bidderId, quoted: b.quotedTotal, evaluated: b.transformed, rank: b.rank,
      priceComponent: b.priceComponent, commercialScore: b.commercialScore.score,
      knockouts: b.knockouts.map((k) => k.text), trail: b.trail,
    })),
    flags: input.flags.map((f) => ({
      key: f.key, severity: f.severity, title: f.title,
      resolved: flagStatus(f, input.decisions)?.action ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Who may be here
// ---------------------------------------------------------------------------

export type AccessVerdict =
  | { ok: true; readOnly: boolean; reason?: string }
  | { ok: false; reason: string };

/**
 * Whether a person may reach the commercial workspace at all.
 *
 * Not a screen that is hidden — the route itself refuses. A technical-only
 * evaluator has no way in, and under two envelopes anyone who scored technical
 * is refused even if some other role would have admitted them.
 */
export function commercialAccess(input: {
  personId: Id;
  panel: Id[];
  technicalPanel: Id[];
  twoEnvelope: boolean;
  unlocked: boolean;
  completed: boolean;
  observer?: boolean;
  /** An admin-side permission, for a buyer reading the evaluation rather than doing it. */
  holdsViewCommercial?: boolean;
}): AccessVerdict {
  if (!input.unlocked) return { ok: false, reason: 'The commercial envelope has not been unlocked, so there is nothing to evaluate yet.' };
  const onTechnical = input.technicalPanel.includes(input.personId);
  if (input.twoEnvelope && onTechnical) {
    return { ok: false, reason: 'You scored the technical envelope on this event. Under two envelopes that rules out seeing price.' };
  }
  const evaluator = input.panel.includes(input.personId);
  if (!evaluator && !input.holdsViewCommercial) {
    return { ok: false, reason: 'You are not named as a commercial evaluator on this event.' };
  }
  if (!evaluator) return { ok: true, readOnly: true, reason: 'You can read this evaluation; only its evaluators can change it.' };
  if (input.observer) return { ok: true, readOnly: true, reason: 'Observer — read only.' };
  if (input.completed) return { ok: true, readOnly: true, reason: 'The commercial evaluation is complete and locked.' };
  return { ok: true, readOnly: false };
}
