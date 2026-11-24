/**
 * The Configuration Studio's scope selector.
 *
 * "Category scope" is one scope per category, not one scope. The studio used
 * to hard-wire a single category, which meant the lineage could be described
 * on screen but never exercised: a questionnaire template written for IT
 * Software had nowhere to live, and the event buying IT Software was never
 * offered it. These are first-paint facts, so server rendering is enough.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import { CategoryScopePicker, ConfigurationStudio } from '../ConfigurationStudio';
import { CATEGORY_IDS } from '../../data/procurementCategories';

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");

const studio = clean(renderToString(
  <StoreProvider><ConfigurationStudio /></StoreProvider>,
));

const picker = (value: string) =>
  clean(renderToString(<CategoryScopePicker value={value} onChange={() => {}} />));

describe('choosing which category is being configured', () => {
  it('does not ask at tenant scope, where there is nothing to choose', () => {
    // The studio opens at tenant scope, so the picker is absent on first paint.
    expect(studio).not.toContain('Category being configured');
    expect(studio).toContain('Configuration scope');
  });

  it('offers every category in the taxonomy, not one hard-wired name', () => {
    const html = picker('Indirect');
    for (const id of CATEGORY_IDS) expect(html).toContain(`value="${id}"`);
    expect(CATEGORY_IDS).toContain('IT Software');
  });

  it('groups them by super category, the way the taxonomy is read', () => {
    expect(picker('Indirect')).toContain('<optgroup label="Direct"');
  });

  it('opens on the category it was given, not on a constant', () => {
    expect(picker('IT Software')).toContain('<option value="IT Software" selected="">');
    expect(picker('Indirect')).toContain('<option value="Indirect" selected="">');
  });

  it('says what authoring here will mean for an event', () => {
    expect(picker('IT Software')).toContain('is offered on an event whose basket holds lines');
    expect(picker('IT Software')).toContain('IT Software');
  });
});
