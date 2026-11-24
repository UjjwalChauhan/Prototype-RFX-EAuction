/**
 * The agent panel, and the category picker that gates it.
 *
 * What the screen must not do is as important as what it does: there is no
 * "accept all", nothing is applied until the buyer applies it, and every
 * suggestion names its source. AG-03 may draft and may not publish, and the
 * buyer's per-question decision is what crosses that line.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionnaireAgentPanel } from '../QuestionnaireAgentPanel';
import { TemplateBuilder } from '../QuestionnairePanel';
import { StoreProvider } from '../../store/store';
import { TENANT_TEMPLATES, LOGISTICS_TEMPLATES } from '../../data/questionnaireTemplates';
import { PROCUREMENT_CATEGORIES } from '../../data/procurementCategories';
import type { QuestionnaireTemplate } from '../../domain/types';

const LIBRARY = [...TENANT_TEMPLATES, ...LOGISTICS_TEMPLATES];
const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const panel = (template: QuestionnaireTemplate) => clean(renderToString(
  <StoreProvider>
    <QuestionnaireAgentPanel
      open
      template={template}
      library={LIBRARY}
      onClose={() => {}}
      onApply={() => {}}
    />
  </StoreProvider>,
));

const builder = (template: QuestionnaireTemplate) => clean(renderToString(
  <StoreProvider>
    <TemplateBuilder
      template={template}
      takenNames={[]}
      library={LIBRARY}
      onChange={() => {}}
      onClose={() => {}}
      onSave={() => {}}
    />
  </StoreProvider>,
));

describe('one taxonomy, not one per screen', () => {
  it('the wizard offers the same categories the template library tags with', async () => {
    const { INITIAL_DRAFT } = await import('../CreateEventWizard');
    // The default draft must name a category the library can actually serve,
    // or a fresh event resolves to no questionnaire and does not say why.
    expect(PROCUREMENT_CATEGORIES.map((c) => c.id)).toContain(INITIAL_DRAFT.category);
    for (const line of INITIAL_DRAFT.lines) {
      expect(PROCUREMENT_CATEGORIES.map((c) => c.id), line.description).toContain(line.category);
    }
  });
});

describe('choosing a category', () => {
  const html = builder({ ...RFI, categories: [] });

  it('offers the taxonomy rather than a free-text box', () => {
    expect(html).toContain('Add a category…');
    for (const category of PROCUREMENT_CATEGORIES.slice(0, 6)) {
      expect(html, category.id).toContain(category.id);
    }
  });

  it('groups the list the way spend is grouped', () => {
    for (const group of ['Direct', 'Indirect', 'Services', 'Logistics']) {
      expect(html).toContain(`label="${group}"`);
    }
  });

  it('says plainly what no category means', () => {
    expect(html).toContain('Every category');
  });

  it('shows a chosen category as something removable', () => {
    const chosen = builder({ ...RFI, categories: ['Logistics'] });
    expect(chosen).toContain('aria-label="Remove category Logistics"');
  });
});

describe('getting to the agent', () => {
  it('offers the agent from the template builder', () => {
    expect(builder({ ...RFI, categories: ['Logistics'] })).toContain('Ask the agent');
  });

  it('will not start without a category, and says why', () => {
    const html = builder({ ...RFI, categories: [] });
    const at = html.indexOf('Ask the agent');
    const tag = html.slice(html.lastIndexOf('<button', at), at);
    expect(tag).toContain('disabled');
    expect(tag).toContain('Pick a category first');
  });
});

describe('the agent panel', () => {
  const html = panel({ ...RFI, categories: ['Logistics'], appliesTo: ['RFQ'] });

  it('names the agent and its mandate', () => {
    expect(html).toContain('Questionnaire Builder — AG-03');
    expect(html).toContain('Cannot publish a questionnaire');
  });

  it('says which three sources it will use before it says anything else', () => {
    expect(html).toContain('what your templates already ask');
    expect(html).toContain('what this workspace has seen');
    expect(html).toContain('market practice');
  });

  it('shows what it can actually see in the workspace', () => {
    expect(html).toContain('What I can see in the workspace');
    expect(html).toContain('event in Logistics in this workspace');
  });

  it('opens by asking, not by answering', () => {
    expect(html).toContain('What are you actually trying to find out about these suppliers?');
  });

  it('explains why it is asking', () => {
    expect(html).toContain('A questionnaire that asks everything scores nothing');
  });

  it('offers the concerns a buyer might have', () => {
    expect(html).toContain('Cost and commercial terms');
    expect(html).toContain('Risk and continuity');
    expect(html).toContain('Sustainability');
  });

  it('refuses to start when no category is chosen', () => {
    const none = panel({ ...RFI, categories: [] });
    expect(none).toContain('Pick a category first');
    expect(none).not.toContain('What are you actually trying to find out');
  });
});
