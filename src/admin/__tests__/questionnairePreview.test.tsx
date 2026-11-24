/**
 * The preview, and the two things it has to be.
 *
 * Faithful: it is the supplier's own renderer, so what the buyer sees is what
 * will be published rather than a drawing of it. And safe: a weight, a rubric
 * or a knockout flag appearing on this screen would be a rehearsal for one
 * appearing on the supplier's.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionnairePreview } from '../QuestionnairePreview';
import type { LineItem, TemplateQuestion, TemplateSection } from '../../domain/types';

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const SECTIONS: TemplateSection[] = [
  { id: 's1', name: 'About your company', sequence: 1, weight: 60, askedPer: 'VENDOR' },
  { id: 's2', name: 'About each item', sequence: 2, weight: 40, askedPer: 'LINE' },
];

function question(over: Partial<TemplateQuestion> & { id: string }): TemplateQuestion {
  return {
    templateId: 't1', sectionId: 's1', sequence: 1, code: 'C', type: 'short_text',
    title: 'A question', helpText: '', isRequired: true, envelope: 'TECHNICAL',
    weight: 10, scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR', config: {}, ...over,
  };
}

const QUESTIONS: TemplateQuestion[] = [
  question({
    id: 'q1', sectionId: 's1', sequence: 1, title: 'Years trading in this category',
    type: 'number', weight: 60, rubric: '0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10',
    isKnockout: true,
  }),
  // Stored per vendor, but its section is per line — the preview must show
  // the grain that will actually be published.
  question({
    id: 'q2', sectionId: 's2', sequence: 2, title: 'Lead time from order to delivery',
    type: 'lead_time', weight: 40, askedPer: 'VENDOR',
  }),
];

function line(id: string, itemCode: string, description: string): LineItem {
  return {
    id, lotId: 'lot', lineNumber: 1, itemCode, description, specification: '',
    quantity: 5, uom: 'each', deliveryLocation: '', deliveryDate: null, incoterm: null,
    taxClass: null, baselinePrice: null, baselineSource: null, currency: 'INR',
    isOptional: false, allowAlternate: false, category: '', superCategory: null,
    sourcePrLineId: null,
  };
}

const paint = (lines?: LineItem[]) => clean(renderToString(
  <QuestionnairePreview
    name="Supplier qualification — RFI"
    point="RFI"
    sections={SECTIONS}
    questions={QUESTIONS}
    lines={lines}
  />,
));

describe('it shows the form a supplier will get', () => {
  const html = paint();

  it('names the questionnaire and both sections', () => {
    expect(html).toContain('Supplier qualification — RFI');
    expect(html).toContain('About your company');
    expect(html).toContain('About each item');
  });

  it('marks the per-line section and expands it', () => {
    expect(html).toContain('asked for each item');
    expect(html).toContain('ITEM-001');
    expect(html).toContain('ITEM-002');
  });

  it('honours the section grain over the grain stored on the question', () => {
    // q2 is stored VENDOR and sits in a LINE section, so it is asked per item.
    expect(html).toContain('Answer this for each of the 2 items below');
  });

  it('says the example lines are examples', () => {
    expect(html).toContain('expanded against two example lines');
  });

  it('counts the boxes a supplier actually has to fill in', () => {
    // One company question, plus the lead time asked for each of two items.
    expect(html).toContain('3 boxes to fill in');
  });
});

describe('nothing from the buyer side leaks into it', () => {
  /**
   * The rendered form alone, as words.
   *
   * Sliced away from the page's own explanation of itself, and stripped of
   * markup — `font-weight:600` is not a weight leaking onto a supplier's
   * screen, and an assertion that cannot tell the difference is an assertion
   * that will be deleted the first time it cries wolf.
   */
  const formText = () => {
    const html = paint();
    const form = html.slice(html.indexOf('aria-label="Questionnaire preview"'));
    return form.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  };

  it('shows no weight', () => {
    expect(formText()).not.toContain('weight');
    expect(formText()).not.toMatch(/\b60\b/);
  });

  it('shows no rubric', () => {
    expect(formText()).not.toContain('0–2 yrs = 2');
  });

  it('shows no knockout flag', () => {
    expect(formText()).not.toContain('knockout');
    expect(formText()).not.toContain('disqualif');
  });
});

describe('with the event s own basket', () => {
  const html = paint([line('l1', 'LAP-005', 'Laptop, 15in'), line('l2', 'MON-012', 'Monitor, 24in')]);

  it('expands against the real lines, and drops the example notice', () => {
    expect(html).toContain('LAP-005 · Laptop, 15in');
    expect(html).toContain('MON-012 · Monitor, 24in');
    expect(html).not.toContain('example lines');
  });
});

describe('an empty questionnaire', () => {
  it('says a supplier would open it and find nothing', () => {
    const html = clean(renderToString(
      <QuestionnairePreview name="Empty" sections={[]} questions={[]} />,
    ));
    expect(html).toContain('a supplier would open this and find an empty form');
  });
});
