/**
 * Questionnaires chosen by category, not by event.
 *
 * The rule being pinned here is that **the category is what picks the
 * questions**. An event header carries one category, but a consolidated event
 * raised against six requisitions routinely buys in three, and the questions
 * worth asking a pallet supplier are not the ones worth asking a stationery
 * supplier. So the basket decides how many questionnaires an ask carries, the
 * category library decides what is in each, and the shortlist decides who gets
 * which.
 *
 * Three failures these exist to prevent: a consolidated event collapsing to one
 * questionnaire that fits neither market; a category library losing to the
 * generic template it was written to beat; and a supplier being handed somebody
 * else's questions because their lines happen to be in the same event.
 */
import { describe, expect, it } from 'vitest';
import {
  basketCategories, categorySlug, instantiateTemplate, seedQuestionnaires, templatesFor,
} from '../questionnaireTemplates';
import { questionnaireIdFor } from '../stageEvents';
import { questionnairesForBidder } from '../vendorPortal';
import { CATEGORY_TEMPLATES, LOGISTICS_TEMPLATES, TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import * as seed from '../../data/seed';
import type { Questionnaire, QuestionnaireTemplate } from '../types';

const LIBRARY = [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES, ...LOGISTICS_TEMPLATES];
const HANDLING = LOGISTICS_TEMPLATES[0];
const GENERIC_RFQ = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFQ-COMMERCIAL') as QuestionnaireTemplate;

describe('the categories a basket spans', () => {
  it('is one category when every line agrees', () => {
    expect(basketCategories([{ category: 'IT' }, { category: 'IT' }])).toEqual(['IT']);
  });

  it('is every category present, in the order a buyer meets them', () => {
    expect(basketCategories([
      { category: 'Indirect' }, { category: 'Logistics' }, { category: 'Indirect' },
    ])).toEqual(['Indirect', 'Logistics']);
  });

  it('files an unclassified line under the event rather than losing it', () => {
    expect(basketCategories([{ category: '' }, { category: 'Logistics' }], 'Indirect'))
      .toEqual(['Indirect', 'Logistics']);
  });

  it('is empty when nothing is classified and there is no event to fall back on', () => {
    expect(basketCategories([{ category: null }, {}])).toEqual([]);
  });
});

describe('which template a category gets', () => {
  it('offers a template written for the category', () => {
    expect(templatesFor(LIBRARY, 'RFQ', 'Logistics')).toContain(HANDLING);
  });

  it('still offers a template that names no category, because it serves any', () => {
    expect(templatesFor(LIBRARY, 'RFQ', 'Logistics')).toContain(GENERIC_RFQ);
  });

  it("puts the category's own template first, so it is what gets picked", () => {
    expect(templatesFor(LIBRARY, 'RFQ', 'Logistics')[0]).toBe(HANDLING);
  });

  it('does not offer a Logistics template to another category', () => {
    expect(templatesFor(LIBRARY, 'RFQ', 'Indirect')).not.toContain(HANDLING);
  });

  it('leaves the order alone when no category is being asked for', () => {
    const any = templatesFor(LIBRARY, 'RFQ', null);
    expect(any.indexOf(GENERIC_RFQ)).toBeLessThan(any.indexOf(HANDLING));
  });
});

describe('seeding an event that spans several categories', () => {
  const points = ['RFQ'] as const;

  it('produces one questionnaire per category', () => {
    const drafts = seedQuestionnaires({
      existing: [], points: [...points], library: LIBRARY,
      categories: ['Indirect', 'Logistics'], idSeed: 'evt-x',
    });
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.category)).toEqual(['Indirect', 'Logistics']);
  });

  it('draws each from its own category’s library', () => {
    const [indirect, logistics] = seedQuestionnaires({
      existing: [], points: [...points], library: LIBRARY,
      categories: ['Indirect', 'Logistics'], idSeed: 'evt-x',
    });
    expect(indirect.templateId).toBe(GENERIC_RFQ.id);
    expect(logistics.templateId).toBe(HANDLING.id);
  });

  it('gives each a distinct id stem, so one cannot overwrite the other', () => {
    const drafts = seedQuestionnaires({
      existing: [], points: [...points], library: LIBRARY,
      categories: ['Indirect', 'Logistics'], idSeed: 'evt-x',
    });
    const ids = drafts.flatMap((d) => d.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces one questionnaire per point per category across a ladder', () => {
    const drafts = seedQuestionnaires({
      existing: [], points: ['RFI', 'RFQ'], library: LIBRARY,
      categories: ['Indirect', 'Logistics'], idSeed: 'evt-x',
    });
    expect(drafts).toHaveLength(4);
  });

  it('leaves a questionnaire the buyer has already shaped exactly as it is', () => {
    const edited = {
      ...instantiateTemplate(HANDLING, 'RFQ', 'kept', 'Logistics'),
      templateName: 'Shaped by hand',
    };
    const drafts = seedQuestionnaires({
      existing: [edited], points: [...points], library: LIBRARY,
      categories: ['Indirect', 'Logistics'], idSeed: 'evt-x',
    });
    expect(drafts.find((d) => d.category === 'Logistics')).toBe(edited);
  });

  it('falls back to one uncategorised questionnaire when no category is given', () => {
    const drafts = seedQuestionnaires({
      existing: [], points: [...points], library: LIBRARY, categories: [], idSeed: 'evt-x',
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].category).toBeNull();
  });
});

describe('the id an event questionnaire gets', () => {
  it('is the plain one when the questionnaire covers the whole ask', () => {
    expect(questionnaireIdFor('evt-1', 'RFQ', null)).toBe('evt-1-qn-rfq');
  });

  it('carries the category when the ask asks more than once at a point', () => {
    expect(questionnaireIdFor('evt-1', 'RFQ', 'Logistics')).toBe('evt-1-qn-rfq-logistics');
  });

  it('slugs a category that would not survive as an id', () => {
    expect(questionnaireIdFor('evt-1', 'RFQ', 'Office & Admin')).toBe('evt-1-qn-rfq-office-admin');
    expect(categorySlug('   ')).toBe('category');
  });

  it('keeps two categories apart', () => {
    expect(questionnaireIdFor('evt-1', 'RFQ', 'Indirect'))
      .not.toBe(questionnaireIdFor('evt-1', 'RFQ', 'Logistics'));
  });
});

describe('which questionnaires reach which supplier', () => {
  const ask = (category: string | null, id: string): Questionnaire => ({
    id, eventId: 'evt-1', stage: 'RFQ', category, name: id, questions: [],
  });
  const all = [ask('Indirect', 'q-ind'), ask('Logistics', 'q-log'), ask(null, 'q-all')];

  it('gives a supplier only the categories they were shortlisted for', () => {
    const mine = questionnairesForBidder(all, 'evt-1', 'RFQ', ['Logistics']);
    expect(mine.map((q) => q.id)).toEqual(['q-log', 'q-all']);
  });

  it('gives a supplier shortlisted for both categories both questionnaires', () => {
    const mine = questionnairesForBidder(all, 'evt-1', 'RFQ', ['Indirect', 'Logistics']);
    expect(mine).toHaveLength(3);
  });

  it('treats an empty shortlist category as the whole basket', () => {
    expect(questionnairesForBidder(all, 'evt-1', 'RFQ', [])).toHaveLength(3);
  });

  it('never withholds a questionnaire that covers the whole ask', () => {
    const mine = questionnairesForBidder(all, 'evt-1', 'RFQ', ['Aviation']);
    expect(mine.map((q) => q.id)).toEqual(['q-all']);
  });

  it('ignores another ask’s questionnaires entirely', () => {
    const other = [...all, { ...ask('Logistics', 'q-other'), eventId: 'evt-2' }];
    expect(questionnairesForBidder(other, 'evt-1', 'RFQ', [])).toHaveLength(3);
  });

  it('ignores the same event’s questionnaires at a different point', () => {
    const other = [...all, { ...ask('Logistics', 'q-rfi'), stage: 'RFI' as const }];
    expect(questionnairesForBidder(other, 'evt-1', 'RFQ', [])).toHaveLength(3);
  });
});

describe('the seeded consolidated RFQ', () => {
  const questionnaires = seed.REQUEST_QUESTIONNAIRES();
  const rfq = questionnaires.filter((q) => q.eventId === 'evt-rfq-061');

  it('asks twice, because its basket buys in two categories', () => {
    expect(rfq).toHaveLength(2);
    expect(rfq.map((q) => q.category)).toEqual(['Indirect', 'Logistics']);
  });

  it('asks the logistics market the logistics questions', () => {
    const logistics = rfq.find((q) => q.category === 'Logistics');
    expect(logistics?.sourceTemplateId).toBe(HANDLING.id);
    expect(logistics?.questions.map((q) => q.code)).toContain('LOG.ISPM15');
  });

  it('asks the other lines the ordinary price schedule', () => {
    const indirect = rfq.find((q) => q.category === 'Indirect');
    expect(indirect?.sourceTemplateId).toBe(GENERIC_RFQ.id);
    expect(indirect?.questions.map((q) => q.code)).not.toContain('LOG.ISPM15');
  });

  it('leaves a single-category ask asking once', () => {
    expect(questionnaires.filter((q) => q.eventId === 'evt-rfi-005')).toHaveLength(1);
  });

  it('shows a supplier shortlisted for one category only their half', () => {
    const prime = seed.REQUEST_BIDDERS.find(
      (b) => b.eventId === 'evt-rfq-061' && b.counterpartyId === 'cp-prime',
    );
    const mine = questionnairesForBidder(
      questionnaires, 'evt-rfq-061', 'RFQ', prime?.categories ?? [],
    );
    expect(mine.map((q) => q.category)).toEqual(['Indirect']);
  });

  it('shows a supplier shortlisted for both categories both halves', () => {
    const abc = seed.REQUEST_BIDDERS.find(
      (b) => b.eventId === 'evt-rfq-061' && b.counterpartyId === 'cp-abc',
    );
    const mine = questionnairesForBidder(
      questionnaires, 'evt-rfq-061', 'RFQ', abc?.categories ?? [],
    );
    expect(mine).toHaveLength(2);
  });
});
