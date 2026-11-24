/**
 * The Basics step — specifically, what the Category field admits to.
 *
 * A consolidated basket routinely spans categories and the select can only
 * hold one. Showing that one alone reads as though the rest were dropped, so
 * the field names every category the lines actually carry. These tests paint
 * the step rather than inspect the draft, because the claim being made is a
 * claim about what the buyer can see.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import { BasicsStep, INITIAL_DRAFT, type Draft } from '../CreateEventWizard';

function line(over: Partial<Draft['lines'][number]>): Draft['lines'][number] {
  return {
    id: 'l1', itemCode: 'X-1', description: 'A thing', specification: '', quantity: 10,
    uom: 'each', deliveryLocation: 'Pune — Plant 2', needBy: '',
    baselinePrice: 100, lotName: 'Lot 1 · Things', category: 'IT Hardware',
    superCategory: 'Technology', ...over,
  };
}

const MIXED: Draft = {
  ...INITIAL_DRAFT,
  category: 'IT Hardware',
  lines: [
    line({ id: 'l1', description: 'Laptop, 15in', category: 'IT Hardware' }),
    line({ id: 'l2', description: 'Monitor, 24in', category: 'IT Hardware' }),
    line({ id: 'l3', description: 'Monitor, 27in', category: 'IT Hardware' }),
    line({ id: 'l4', description: 'Network switch', category: 'IT Hardware' }),
    line({ id: 'l5', description: 'Monitor riser', category: 'Office & Administrative', superCategory: 'Indirect' }),
    line({ id: 'l6', description: 'Cable tray', category: 'Office & Administrative', superCategory: 'Indirect' }),
  ],
};

const SINGLE: Draft = {
  ...INITIAL_DRAFT,
  category: 'IT Hardware',
  lines: [line({ id: 'l1', category: 'IT Hardware' })],
};

function paint(draft: Draft): string {
  return renderToString(
    <StoreProvider>
      <BasicsStep draft={draft} patch={() => {}} applyPattern={() => {}} />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
}

/** The field, without the <option> list — which names every category anyway. */
function categoryField(html: string): string {
  const start = html.indexOf('Category');
  const end = html.indexOf('Entity', start);
  return html.slice(start, end).replace(/<option[^>]*>[^<]*<\/option>/g, '');
}

describe('a basket that spans categories says so', () => {
  it('names every category in the demand, not just the one the event is raised under', () => {
    const field = categoryField(paint(MIXED));
    expect(field).toContain('IT Hardware');
    expect(field).toContain('Office & Administrative');
  });

  it('counts the lines sitting in each one', () => {
    const field = categoryField(paint(MIXED));
    expect(field).toContain('IT Hardware · 4');
    expect(field).toContain('Office & Administrative · 2');
  });

  it('says what the other categories get, so they do not read as discarded', () => {
    const field = categoryField(paint(MIXED));
    expect(field).toContain('2 categories in the demand');
    expect(field).toContain('its own shortlist and questionnaire');
  });

  it('marks which category the event header is raised under', () => {
    const field = categoryField(paint(MIXED));
    expect(field).toContain('The event header is raised under IT Hardware');
    expect(field).toContain('stay Office & Administrative');
  });

  it('adds nothing when the basket is one category — there is nothing to reconcile', () => {
    const field = categoryField(paint(SINGLE));
    expect(field).not.toContain('categories in the demand');
    expect(field).not.toContain('IT Hardware · 1');
  });
});
