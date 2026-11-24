/**
 * The software requisitions, and the one thing they exist to do.
 *
 * A requisition is only useful here if an event can actually be raised from
 * it, and that needs three things to line up: lines nobody has sourced yet, a
 * basket the consolidation will accept, and at least one supplier on the
 * master who serves the category. Any one of them missing and the requisition
 * reads fine on the list and dead-ends in the wizard.
 */
import { describe, expect, it } from 'vitest';
import { PURCHASE_REQUESTS, PURCHASE_REQUEST_LINES } from '../../data/purchaseRequests';
import { COUNTERPARTIES } from '../../data/seed';
import { CATEGORY_IDS, practiceFor } from '../../data/procurementCategories';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import { linesFor, sourceableLines } from '../purchaseRequests';
import { templatesFor } from '../questionnaireTemplates';
import { defaultShortlist, suggestBidders, validateCoverage } from '../bidders';
import {
  buildSourcingRequisition, suggestedTitle, toConsolidatedLines, validateBasket,
} from '../sourcingRequisition';

const SOFTWARE = PURCHASE_REQUESTS.filter((r) => r.category === 'IT Software');
const linesOf = (id: string) => linesFor(PURCHASE_REQUEST_LINES, id);

describe('the software requisitions', () => {
  it('are on the list under a category the taxonomy knows', () => {
    expect(SOFTWARE.length).toBeGreaterThanOrEqual(3);
    expect(CATEGORY_IDS).toContain('IT Software');
  });

  it('all carry lines that can still be sourced', () => {
    for (const request of SOFTWARE) {
      expect(sourceableLines(linesOf(request.id)).length).toBeGreaterThan(0);
    }
  });

  it('offer one small enough to source in a sitting and one large enough to be worth consolidating', () => {
    const counts = SOFTWARE.map((r) => sourceableLines(linesOf(r.id)).length);
    expect(Math.min(...counts)).toBeLessThanOrEqual(10);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(20);
  });

  it('price every line, so a basket has a baseline to measure savings against', () => {
    for (const request of SOFTWARE) {
      expect(linesOf(request.id).every((l) => l.indicativePrice !== null)).toBe(true);
    }
  });

  it('ask for software by the seat and the year rather than by the each', () => {
    const units = new Set(SOFTWARE.flatMap((r) => linesOf(r.id)).map((l) => l.uom));
    expect([...units].every((u) => /year|subscription/.test(u))).toBe(true);
  });

  it('hold the items their titles say they hold', () => {
    const titled = (number: string, prefix: string) => {
      const request = SOFTWARE.find((r) => r.requestNumber === number);
      expect(request, number).toBeDefined();
      const codes = linesOf(request!.id).map((l) => l.itemCode.split('-')[0]);
      expect(new Set(codes)).toEqual(new Set([prefix]));
    };
    // A requisition whose title names what is in it has to deliver that, or
    // the event raised from it disagrees with the basket it came from.
    titled('RQ-TGRANL-00128', 'CRM');
    titled('RQ-TGRANL-00131', 'SEC');
  });
});

describe('raising an event from one', () => {
  const approved = SOFTWARE.find((r) => r.status === 'APPROVED');
  const basket = sourceableLines(linesOf(approved!.id));

  it('passes consolidation without a single warning about the basket', () => {
    const validation = validateBasket(basket, PURCHASE_REQUESTS);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.map((w) => w.code)).toEqual([]);
  });

  it('consolidates into one single-category demand', () => {
    const requisition = buildSourcingRequisition({
      lines: basket, requests: PURCHASE_REQUESTS, existing: [], userId: 'user-ar', now: 1,
    });
    expect(requisition.category).toBe('IT Software');
    expect(requisition.lineIds).toHaveLength(basket.length);
    expect(requisition.requestNumbers).toEqual([approved!.requestNumber]);
  });

  it('turns into event lines with a lot each', () => {
    const consolidated = toConsolidatedLines(basket, PURCHASE_REQUESTS);
    expect(consolidated).toHaveLength(basket.length);
    expect(consolidated.every((l) => l.lotName.length > 0)).toBe(true);
    expect(suggestedTitle(basket, PURCHASE_REQUESTS).length).toBeGreaterThan(0);
  });

  it('finds suppliers on the master who serve the category', () => {
    const { suggested } = suggestBidders(COUNTERPARTIES, 'IT Software', 'Technology');
    expect(suggested.length).toBeGreaterThanOrEqual(3);
    expect(suggested.every((c) => c.categoriesServed.includes('IT Software'))).toBe(true);
  });

  it('opens with a shortlist of suppliers who can actually be awarded the work', () => {
    // The default shortlist excludes provisional suppliers, so the category
    // has to hold enough awardable ones to fill it on its own.
    const shortlist = defaultShortlist(COUNTERPARTIES, 'IT Software', 'Technology');
    expect(shortlist).toHaveLength(3);
  });

  it('clears the competitiveness check the wizard runs on the roster', () => {
    const shortlist = defaultShortlist(COUNTERPARTIES, 'IT Software', 'Technology');
    const issues = validateCoverage(
      [{ category: 'IT Software', bidderIds: shortlist }], COUNTERPARTIES,
    ).filter((issue) => issue.blocking);
    expect(issues).toEqual([]);
  });

  it('keeps one provisional supplier in the category, so the decision is a real one', () => {
    const { suggested } = suggestBidders(COUNTERPARTIES, 'IT Software', 'Technology');
    expect(suggested.some((c) => c.isProvisional)).toBe(true);
    // Provisional suppliers can bid but not be awarded, so they rank last.
    expect(suggested[suggested.length - 1].isProvisional).toBe(true);
  });
});

describe('the wizard has something to offer the category', () => {
  it('finds questionnaire templates that apply to IT Software', () => {
    const visible = templatesFor(
      TENANT_TEMPLATES, 'RFP', 'IT Software',
    );
    expect(visible.length).toBeGreaterThan(0);
  });

  it('carries a market-practice question bank for software specifically', () => {
    const practice = practiceFor(['IT Software']);
    expect(practice.length).toBeGreaterThan(0);
    // Residency, exit and renewal uplift are the three places a software deal
    // is actually decided, and all three are in the bank.
    const codes = practice.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['SW.DATARES', 'SW.EXIT', 'SW.UPLIFT']));
  });
});
