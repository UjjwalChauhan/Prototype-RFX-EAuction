import { describe, expect, it } from 'vitest';
import {
  buildSchedule, commercialAccess, commercialCoverage, commercialFlags, commercialScore,
  completionChecklist, countedTwice, defaultRules, deriveTerms, evaluateAll, modelHash,
  paymentTermsAdjustment, rankMovement, treatmentOf, type EvaluationInput, type TermsSeed,
} from '../commercialEvaluation';
import type { CostComponent, LineItem, Question, Response, Score } from '../types';

const line = (n: number, over: Partial<LineItem> = {}): LineItem => ({
  id: `li-${n}`, lotId: n <= 2 ? 'lot-1' : 'lot-2', lineNumber: n, itemCode: `ITEM-${n}`,
  description: `Item ${n}`, specification: '', quantity: 100, uom: 'ea', deliveryLocation: '',
  deliveryDate: null, incoterm: null, taxClass: 'STANDARD', baselinePrice: 10, baselineSource: 'LPP',
  currency: 'INR', isOptional: false, allowAlternate: false, category: 'x', superCategory: null,
  sourcePrLineId: null, ...over,
});

const response = (bidderId: string, prices: (number | null)[], over: Partial<Response['priceLines'][number]> = {}): Response => ({
  id: `r-${bidderId}`, eventId: 'e', bidderId, version: 1, submittedAt: 1_000, answers: [],
  priceLines: prices.flatMap((p, i) => (p === null ? [] : [{
    lineItemId: `li-${i + 1}`, unitPrice: p, currency: 'INR', leadTimeDays: 5, notes: null, ...over,
  }])),
});

const rules = defaultRules({ currency: 'INR', side: 'BUY', requiredValidityDays: 45, standardPaymentDays: 45, costOfCapital: 9 });
const lines = [line(1), line(2), line(3)];

function input(over: Partial<EvaluationInput> & Pick<EvaluationInput, 'responses' | 'bidderIds'>): EvaluationInput {
  return {
    side: 'BUY', rules, lines, questions: [], scores: [], panel: ['ev'], components: [], ...over,
  };
}

const component = (over: Partial<CostComponent> & Pick<CostComponent, 'id' | 'name' | 'basis' | 'valueByBidder'>): CostComponent => ({
  eventId: 'e', source: 'manual', agentProposed: false, ...over,
});

describe('payment-term financing', () => {
  it('is −Total × r × (days − standard) ÷ 365', () => {
    // 15 days against a 45 day standard at 9% on ₹28,45,000 — shorter terms cost the buyer money.
    const { amount } = paymentTermsAdjustment(2_845_000, 15, 45, 9);
    expect(amount).toBeCloseTo((2_845_000 * 0.09 * 30) / 365, 2);
    expect(amount).toBeGreaterThan(0);
  });
  it('is a benefit when the supplier gives longer terms', () => {
    expect(paymentTermsAdjustment(100_000, 90, 45, 9).amount).toBeLessThan(0);
  });
});

describe('the price schedule is re-computed', () => {
  const terms = deriveTerms(undefined, 'a', []);
  it('applies discount, freight and GST in that order', () => {
    const r = response('a', [10, 10, 10], { discountPct: 10, freight: 50 });
    const s = buildSchedule({ response: r, lines, terms, rules });
    // 100 × 10 = 1000, less 10% = 900, freight 50, GST 18% of 950.
    expect(s.lines[0].net).toBeCloseTo(900);
    expect(s.lines[0].tax).toBeCloseTo(171);
    expect(s.quotedTotal).toBeCloseTo(3 * (900 + 50 + 171));
  });
  it('records an arithmetic gap rather than adopting the supplier’s figure', () => {
    const r = response('a', [10, 10, 10]);
    r.priceLines[0].extendedValue = 1_200;
    const s = buildSchedule({ response: r, lines, terms, rules });
    expect(s.lines[0].net).toBeCloseTo(1_000);
    expect(s.lines[0].arithmeticGap).toBeCloseTo(200);
  });
  it('counts an optional line the supplier priced apart from the required ones', () => {
    const withOptional = [line(1), line(2), line(3, { isOptional: true })];
    const s = buildSchedule({ response: response('a', [10, null, 10]), lines: withOptional, terms, rules });
    expect(s.pricedCount).toBe(2);
    expect(s.requiredCount).toBe(2);
    expect(s.requiredPriced).toBe(1);
    expect(s.complete).toBe(false);
    const leftOut = buildSchedule({ response: response('a', [10, 10, null]), lines: withOptional, terms, rules });
    expect(leftOut.complete).toBe(true);
  });
  it('shows a line the supplier did not price as not offered and the bid as incomplete', () => {
    const s = buildSchedule({ response: response('a', [10, 10, null]), lines, terms, rules });
    expect(s.lines[2].priced).toBe(false);
    expect(s.complete).toBe(false);
  });
  it('converts a foreign quote at the declared rate and says which', () => {
    const fx = { USD: { currency: 'USD', rate: 80, source: 'RBI reference', frozenAt: 0 } };
    const r = response('a', [800, 800, 800]);
    r.priceLines.forEach((p) => { p.quotedCurrency = 'USD'; p.quotedUnitPrice = 0.125; });
    const s = buildSchedule({ response: r, lines, terms, rules: { ...rules, fx } });
    expect(s.lines[0].unitPrice).toBeCloseTo(10);
    expect(s.lines[0].fx?.source).toBe('RBI reference');
    expect(s.fxMissing).toBe(false);
  });
  it('refuses to convert silently when no rate was declared', () => {
    const r = response('a', [10, 10, 10]);
    r.priceLines.forEach((p) => { p.quotedCurrency = 'USD'; p.quotedUnitPrice = 0.125; });
    const s = buildSchedule({ response: r, lines, terms, rules });
    expect(s.fxMissing).toBe(true);
  });
  it('aligns a different unit of measure with a visible factor', () => {
    const r = response('a', [100, 100, 100], { uomFactor: 10, quotedUom: 'carton' });
    const s = buildSchedule({ response: r, lines, terms, rules });
    expect(s.lines[0].unitPrice).toBeCloseTo(10);
    expect(s.lines[0].quoted?.uom).toBe('carton');
  });
  it('treats a composition dealer’s price as all-in with nothing to reclaim', () => {
    const comp = deriveTerms(undefined, 'a', [], { taxProfile: 'COMPOSITION' });
    const s = buildSchedule({ response: response('a', [10, 10, 10]), lines, terms: comp, rules });
    expect(s.tax).toBe(0);
    expect(s.quotedTotal).toBeCloseTo(3000);
  });
  it('treats GST on a blocked-credit class as a real cost', () => {
    const blocked = [line(1, { taxClass: 'BLOCKED' })];
    const s = buildSchedule({ response: response('a', [10]), lines: blocked, terms, rules });
    expect(s.nonCreditableTax).toBeCloseTo(180);
    expect(s.creditableTax).toBe(0);
  });
});

describe('the calculation trail', () => {
  const seed: Record<string, TermsSeed> = { a: { paymentDays: 45 } };
  it('accounts for every movement from quoted to evaluated', () => {
    const comps = [
      component({ id: 'c1', name: 'Inbound freight', basis: 'LUMP_SUM', valueByBidder: { a: 5_000 } }),
      component({ id: 'c2', name: 'Incumbent tooling credit', basis: 'LUMP_SUM', valueByBidder: { a: -2_000 } }),
    ];
    const out = evaluateAll(input({
      responses: [response('a', [10, 10, 10])], bidderIds: ['a'], components: comps, termsSeed: seed,
    }));
    const bid = out.bids[0];
    const moved = bid.trail.filter((t) => t.kind !== 'RESULT').reduce((a, t) => a + t.amount, 0);
    expect(moved).toBeCloseTo(bid.transformed);
    expect(bid.trail.map((t) => t.label)).toEqual(expect.arrayContaining(['+ Inbound freight', '− Incumbent tooling credit']));
    // Landed on a regular supplier: quoted 3,540 − recoverable GST 540 + 3,000 net of freight + 3,000.
    expect(bid.basisValue).toBeCloseTo(3_000);
    expect(bid.transformed).toBeCloseTo(6_000);
  });
  it('recalculates when the comparison basis changes', () => {
    const r = [response('a', [10, 10, 10], { discountPct: 10 })];
    const gross = evaluateAll(input({ responses: r, bidderIds: ['a'], rules: { ...rules, basis: 'GROSS' } })).bids[0];
    const net = evaluateAll(input({ responses: r, bidderIds: ['a'], rules: { ...rules, basis: 'NET' } })).bids[0];
    expect(gross.transformed).toBeCloseTo(3_000);
    expect(net.transformed).toBeCloseTo(2_700);
    expect(gross.basis).toBe('GROSS');
  });
  it('applies a payment-term rule from the days offered', () => {
    const out = evaluateAll(input({
      responses: [response('a', [10, 10, 10])], bidderIds: ['a'], termsSeed: { a: { paymentDays: 15 } },
    }));
    const rule = out.bids[0].trail.find((t) => t.id === 'payment-terms');
    expect(rule?.amount).toBeGreaterThan(0);
    expect(rule?.origin).toBe('RULE');
  });
  it('scopes a component to a lot or named lines', () => {
    const comps = [
      component({ id: 'c1', name: 'Packaging', basis: 'PER_UNIT', valueByBidder: { a: 1 }, scope: { type: 'LOT', ids: ['lot-1'] } }),
      component({ id: 'c2', name: 'Tooling', basis: 'PER_LINE', valueByBidder: { a: 10 }, scope: { type: 'LINES', ids: ['li-3'] } }),
    ];
    const out = evaluateAll(input({ responses: [response('a', [10, 10, 10])], bidderIds: ['a'], components: comps }));
    expect(out.bids[0].trail.find((t) => t.id === 'c-c1')?.amount).toBe(200);
    expect(out.bids[0].trail.find((t) => t.id === 'c-c2')?.amount).toBe(10);
  });
  it('does not apply an agent proposal until a person accepts it', () => {
    const proposed = component({
      id: 'c1', name: 'Inbound freight', basis: 'LUMP_SUM', valueByBidder: { a: 1_000 }, agentProposed: true,
    });
    const before = evaluateAll(input({ responses: [response('a', [10, 10, 10])], bidderIds: ['a'], components: [proposed] })).bids[0];
    expect(before.proposals).toHaveLength(1);
    expect(before.adjustments).toBeCloseTo(0);
    const accepted = { ...proposed, valueOrigin: { a: 'MASTER' as const } };
    const after = evaluateAll(input({ responses: [response('a', [10, 10, 10])], bidderIds: ['a'], components: [accepted] })).bids[0];
    expect(after.proposals).toHaveLength(0);
    expect(after.transformed - before.transformed).toBeCloseTo(1_000);
  });
});

describe('knockouts and ranking', () => {
  const two = [response('a', [10, 10, 10]), response('b', [9, 9, 9])];
  it('keeps a bid out of the ranking when its offer expires before the award', () => {
    const out = evaluateAll(input({
      responses: two, bidderIds: ['a', 'b'], termsSeed: { b: { validityDays: 30 } },
    }));
    const b = out.bids.find((x) => x.bidderId === 'b')!;
    expect(b.responsive).toBe(false);
    expect(b.knockouts[0].code).toBe('VALIDITY');
    expect(b.rank).toBeNull();
    expect(out.ranked.map((x) => x.bidderId)).toEqual(['a']);
  });
  it('fails a non-negotiable deviation and not a negotiable one', () => {
    const out = evaluateAll(input({
      responses: two, bidderIds: ['a', 'b'],
      termsSeed: {
        a: { deviations: [{ clause: '8.2', text: 'cap', nonNegotiable: false }] },
        b: { deviations: [{ clause: '14.1', text: 'foreign courts', nonNegotiable: true }] },
      },
    }));
    expect(out.bids[0].responsive).toBe(true);
    expect(out.bids[1].responsive).toBe(false);
  });
  it('does not rank a partial bid on its total', () => {
    const out = evaluateAll(input({
      responses: [response('a', [10, 10, 10]), response('b', [1, 1, null])], bidderIds: ['a', 'b'],
    }));
    expect(out.bids[1].rank).toBeNull();
  });
  it('ranks the lowest evaluated cost first on the buy side and the highest on the sell side', () => {
    const buy = evaluateAll(input({ responses: two, bidderIds: ['a', 'b'] }));
    expect(buy.ranked[0].bidderId).toBe('b');
    const sell = evaluateAll(input({ side: 'SELL', responses: two, bidderIds: ['a', 'b'], rules: { ...rules, side: 'SELL' } }));
    expect(sell.ranked[0].bidderId).toBe('a');
  });
  it('lets an evaluated cost overturn the quoted order', () => {
    // b quotes lower but is ex-works with a heavy freight burden the buyer carries.
    const comps = [component({ id: 'f', name: 'Inbound freight', basis: 'LUMP_SUM', valueByBidder: { a: 0, b: 900 } })];
    const out = evaluateAll(input({ responses: two, bidderIds: ['a', 'b'], components: comps }));
    expect(out.ranked[0].bidderId).toBe('a');
  });
  it('scores price by the ratio form, so the best is 100 and nothing goes negative', () => {
    const out = evaluateAll(input({ responses: two, bidderIds: ['a', 'b'] }));
    const [best, other] = out.ranked;
    expect(best.priceComponent).toBe(100);
    expect(other.priceComponent).toBeCloseTo((best.transformed / other.transformed) * 100, 1);
  });
  it('combines technical and price under QCBS, counting price once', () => {
    const q = { ...rules, method: 'QCBS' as const, technicalWeight: 70 };
    const out = evaluateAll(input({
      rules: q, responses: two, bidderIds: ['a', 'b'], technical: { a: 90, b: 60 },
    }));
    const a = out.bids[0];
    expect(a.combined).toBeCloseTo(90 * 0.7 + (a.priceComponent ?? 0) * 0.3, 1);
    // a costs more but its technical lead outweighs the price gap.
    expect(out.ranked[0].bidderId).toBe('a');
  });
  it('breaks a tie on technical score, then earlier submission, and flags a true tie', () => {
    const same = [response('a', [10, 10, 10]), response('b', [10, 10, 10])];
    const byTech = evaluateAll(input({ responses: same, bidderIds: ['a', 'b'], technical: { a: 70, b: 80 } }));
    expect(byTech.ranked[0].bidderId).toBe('b');
    const early = [{ ...same[0], submittedAt: 500 }, same[1]];
    const bySpeed = evaluateAll(input({ responses: early, bidderIds: ['a', 'b'] }));
    expect(bySpeed.ranked[0].bidderId).toBe('a');
    const dead = evaluateAll(input({ responses: same, bidderIds: ['a', 'b'] }));
    expect(dead.ranked.every((b) => b.tied)).toBe(true);
  });
  it('reports how ranks moved after a change', () => {
    const before = evaluateAll(input({ responses: two, bidderIds: ['a', 'b'] }));
    const comps = [component({ id: 'f', name: 'Freight', basis: 'LUMP_SUM', valueByBidder: { b: 900, a: 0 } })];
    const after = evaluateAll(input({ responses: two, bidderIds: ['a', 'b'], components: comps }));
    const moved = rankMovement({ a: before.bids[0].rank, b: before.bids[1].rank }, after);
    expect(moved).toEqual({ a: 1, b: -1 });
  });
  it('notes a preferred bidder within the margin of L1', () => {
    const out = evaluateAll(input({
      responses: two, bidderIds: ['a', 'b'], termsSeed: { a: { preference: 'MSE' } },
    }));
    expect(out.bids[0].preferenceEligible).toBe(true);
  });
});

describe('a supplier who extends their offer', () => {
  it('lengthens the validity, and never shortens it', () => {
    const base = { responses: [response('a', [10, 10, 10])], bidderIds: ['a'], termsSeed: { a: { validityDays: 30 } } };
    expect(evaluateAll(input(base)).bids[0].responsive).toBe(false);
    const extended = evaluateAll(input({ ...base, validityOverride: { a: 60 } })).bids[0];
    expect(extended.terms.validityDays).toBe(60);
    expect(extended.responsive).toBe(true);
    expect(evaluateAll(input({ ...base, termsSeed: { a: { validityDays: 90 } }, validityOverride: { a: 60 } })).bids[0].terms.validityDays).toBe(90);
  });
});

describe('coverage', () => {
  it('catches a component applied to some bidders and not others', () => {
    const c = component({ id: 'f', name: 'Freight', basis: 'LUMP_SUM', valueByBidder: { a: 100, b: 100 } });
    expect(commercialCoverage([c], ['a', 'b', 'c'])).toEqual([
      expect.objectContaining({ component: 'Freight', missing: ['c'] }),
    ]);
  });
  it('is quiet for a component nobody has applied yet', () => {
    const c = component({ id: 'f', name: 'Freight', basis: 'LUMP_SUM', valueByBidder: { a: 100 }, agentProposed: true });
    expect(commercialCoverage([c], ['a', 'b'])).toEqual([]);
  });
  it('does not count a proposal as covered', () => {
    const c = component({
      id: 'f', name: 'Freight', basis: 'LUMP_SUM', valueByBidder: { a: 100, b: 100 },
      valueOrigin: { a: 'MANUAL', b: 'AGENT' },
    });
    expect(commercialCoverage([c], ['a', 'b'])[0].missing).toEqual(['b']);
  });
});

describe('flags', () => {
  const lotsOf = (n: number) => Array.from({ length: n }, (_, i) => line(i + 1));
  it('flags a line far from the median, arithmetic, missing lines and identical pricing', () => {
    const l = lotsOf(4);
    const rs = [
      response('a', [10, 10, 10, 10]), response('b', [10, 10, 10, 10]),
      response('c', [10, 10, 40, null]), response('d', [10, 11, 12, 13]),
    ];
    rs[2].priceLines[0].extendedValue = 5_000;
    const inp = input({ lines: l, responses: rs, bidderIds: ['a', 'b', 'c', 'd'] });
    const flags = commercialFlags(evaluateAll(inp), inp);
    const codes = flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['PRICE_OUTLIER', 'ARITHMETIC', 'MISSING_LINES', 'IDENTICAL_PRICING']));
    expect(flags.find((f) => f.code === 'IDENTICAL_PRICING')?.severity).toBe('WARNING');
    expect(flags.find((f) => f.code === 'MISSING_LINES')?.suggestedRequest?.message).not.toMatch(/transform/i);
  });
  it('asks an abnormally low bid to justify itself instead of rejecting it', () => {
    const rs = [response('a', [10, 10, 10]), response('b', [10, 10, 10.1]), response('c', [10, 10.2, 10]), response('d', [3, 3, 3])];
    const inp = input({ responses: rs, bidderIds: ['a', 'b', 'c', 'd'] });
    const result = evaluateAll(inp);
    const low = commercialFlags(result, inp).find((f) => f.code === 'ABNORMALLY_LOW');
    expect(low?.bidderId).toBe('d');
    expect(low?.suggestedRequest?.kind).toBe('PRICE_JUSTIFICATION');
    expect(result.bids.find((b) => b.bidderId === 'd')?.responsive).toBe(true);
  });
  it('warns about an ex-works bid until inbound freight is applied', () => {
    const inp = input({ responses: [response('a', [10, 10, 10])], bidderIds: ['a'], termsSeed: { a: { delivery: 'EX_WORKS' } } });
    expect(commercialFlags(evaluateAll(inp), inp).some((f) => f.code === 'EX_WORKS')).toBe(true);
    const freight = component({ id: 'f', name: 'Inbound freight', basis: 'LUMP_SUM', valueByBidder: { a: 100 } });
    const covered = { ...inp, components: [freight] };
    expect(commercialFlags(evaluateAll(covered), covered).some((f) => f.code === 'EX_WORKS')).toBe(false);
  });
  it('writes supplier-facing requests without internal vocabulary', () => {
    const inp = input({
      responses: [response('a', [10, 10, null])], bidderIds: ['a'],
      termsSeed: { a: { validityDays: 20, deviations: [{ clause: '14.1', text: 'foreign courts', nonNegotiable: true }] } },
    });
    const asks = commercialFlags(evaluateAll(inp), inp).flatMap((f) => (f.suggestedRequest ? [f.suggestedRequest.message, f.suggestedRequest.subject] : []));
    expect(asks.length).toBeGreaterThan(2);
    for (const text of asks) expect(text).not.toMatch(/transform|evaluated cost|knockout|envelope|rank/i);
  });
});

describe('commercial questions', () => {
  const q = (over: Partial<Question>): Question => ({
    id: 'q', questionnaireId: 'qn', sectionId: null, sequence: 1, code: 'COM.X', type: 'short_text', title: 'X',
    helpText: '', isRequired: false, envelope: 'COMMERCIAL', weight: 0, scoringMethod: 'NONE', maxScore: 0,
    rubric: null, isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', ...over,
  });
  it('works out what to do with a question that does not say', () => {
    expect(treatmentOf(q({ type: 'price_schedule' }))).toBe('PRICE');
    expect(treatmentOf(q({ type: 'currency_payment_terms' }))).toBe('MONETISED');
    expect(treatmentOf(q({ isKnockout: true }))).toBe('KO');
    expect(treatmentOf(q({ weight: 5, scoringMethod: 'MANUAL', maxScore: 10 }))).toBe('SCORED');
    expect(treatmentOf(q({ evalType: 'LOADING' }))).toBe('LOADING');
    expect(treatmentOf(q({}))).toBe('INFO');
  });
  it('never scores price', () => {
    const priced = q({ type: 'price_schedule', weight: 40, scoringMethod: 'MANUAL', maxScore: 10 });
    const s = commercialScore('a', [priced], [], ['ev']);
    expect(s.total).toBe(0);
    expect(s.score).toBeNull();
  });
  it('flags a payment-terms question that is both converted to money and weighted', () => {
    expect(countedTwice(q({ type: 'currency_payment_terms', weight: 10, scoringMethod: 'RULE', maxScore: 10 }))).toBe(true);
    expect(countedTwice(q({ type: 'currency_payment_terms' }))).toBe(false);
  });
  it('treats an unscored question as unscored, not zero', () => {
    const scored = q({ id: 'q1', weight: 5, scoringMethod: 'MANUAL', maxScore: 10 });
    expect(commercialScore('a', [scored], [], ['ev']).score).toBeNull();
    const row: Score = {
      id: 's', eventId: 'e', bidderId: 'a', questionId: 'q1', evaluatorId: 'ev', value: 8, comment: '',
      method: 'MANUAL', agentConfidence: null, citedEvidence: null, overridesScoreId: null, overrideReason: null, createdAt: 1,
    };
    expect(commercialScore('a', [scored], [row], ['ev']).score).toBe(80);
  });
  it('fingerprints the frozen model so a change is detectable', () => {
    const base = modelHash(rules, [q({ weight: 5 })]);
    expect(modelHash(rules, [q({ weight: 5 })])).toBe(base);
    expect(modelHash({ ...rules, costOfCapital: 12 }, [q({ weight: 5 })])).not.toBe(base);
    expect(modelHash(rules, [q({ weight: 6 })])).not.toBe(base);
  });
});

describe('completion', () => {
  it('lists what is outstanding and blocks until it is done', () => {
    const inp = input({ responses: [response('a', [10, 10, 10])], bidderIds: ['a'] });
    const result = evaluateAll(inp);
    const base = {
      result, flags: [], decisions: [], reviews: [], declared: false, openRequests: 1,
      coverageGaps: [], bidderIds: ['a'], names: (id: string) => id,
    };
    const open = completionChecklist(base);
    expect(open.filter((i) => !i.met && i.blocking).map((i) => i.id)).toEqual(['declaration', 'reviewed', 'requests']);
    const done = completionChecklist({
      ...base, declared: true, openRequests: 0,
      reviews: [{ eventId: 'e', bidderId: 'a', status: 'REVIEWED', by: 'ev', at: 1 }],
    });
    expect(done.every((i) => i.met)).toBe(true);
  });
});

describe('who may be in the workspace', () => {
  const base = {
    personId: 'rm', panel: ['rm'], technicalPanel: ['js', 'pn'], twoEnvelope: true,
    unlocked: true, completed: false,
  };
  it('explains rather than fails before the unlock', () => {
    const v = commercialAccess({ ...base, unlocked: false });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/unlocked/);
  });
  it('refuses a technical-only evaluator by every route', () => {
    expect(commercialAccess({ ...base, personId: 'js' }).ok).toBe(false);
    // Even one who also holds a commercial role.
    expect(commercialAccess({ ...base, personId: 'js', panel: ['js'] }).ok).toBe(false);
    expect(commercialAccess({ ...base, personId: 'js', holdsViewCommercial: true }).ok).toBe(false);
  });
  it('admits the evaluator, read-only once complete or when observing', () => {
    expect(commercialAccess(base)).toEqual({ ok: true, readOnly: false });
    expect(commercialAccess({ ...base, completed: true })).toMatchObject({ ok: true, readOnly: true });
    expect(commercialAccess({ ...base, observer: true })).toMatchObject({ ok: true, readOnly: true });
  });
  it('lets a buyer with view_commercial read but not change', () => {
    expect(commercialAccess({ ...base, personId: 'buyer', holdsViewCommercial: true })).toMatchObject({ ok: true, readOnly: true });
    expect(commercialAccess({ ...base, personId: 'stranger' }).ok).toBe(false);
  });
});

describe('scale', () => {
  it('evaluates 12 bidders across 400 lines quickly', () => {
    const many = Array.from({ length: 400 }, (_, i) => line(i + 1));
    const ids = Array.from({ length: 12 }, (_, i) => `b${i}`);
    const rs = ids.map((id, b) => response(id, many.map((_, i) => 10 + ((i * 7 + b * 3) % 11) / 10)));
    const comps = [component({
      id: 'f', name: 'Freight', basis: 'PER_UNIT', valueByBidder: Object.fromEntries(ids.map((id, i) => [id, i])),
    })];
    const inp = input({ lines: many, responses: rs, bidderIds: ids, components: comps });
    const t0 = performance.now();
    const result = evaluateAll(inp);
    const flags = commercialFlags(result, inp);
    const ms = performance.now() - t0;
    expect(result.ranked).toHaveLength(12);
    expect(flags.length).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1_500);
  });
});
