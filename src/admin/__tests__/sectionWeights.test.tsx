/**
 * Section weighting on screen: the budget a buyer edits, and the score a buyer
 * reads.
 *
 * The domain tests prove the arithmetic. These prove the buyer is *shown* it —
 * that the weight field exists on every section, that the meter says how much
 * is left, that an over-budget section is marked rather than silently
 * accepted, and that the evaluation screen reports a score per section and one
 * overall on the scale the questionnaire was written with.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TemplateBuilder } from '../QuestionnairePanel';
import { ComparisonTab } from '../tabs/ComparisonTab';
import { StoreProvider } from '../../store/store';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import * as seed from '../../data/seed';
import type { QuestionnaireTemplate } from '../../domain/types';

const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

function builder(template: QuestionnaireTemplate): string {
  return clean(renderToString(
    <StoreProvider>
      <TemplateBuilder
        template={template}
        takenNames={[]}
        library={TENANT_TEMPLATES}
        onChange={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />
    </StoreProvider>,
  ));
}

/** The value of one labelled number input. */
function fieldValue(html: string, label: string): string | null {
  const at = html.indexOf(`aria-label="${label}"`);
  if (at === -1) return null;
  const open = html.lastIndexOf('<input', at);
  const tag = html.slice(open, html.indexOf('>', at) + 1);
  return /value="([^"]*)"/.exec(tag)?.[1] ?? null;
}

describe('the section weight is editable', () => {
  const html = builder(RFI);

  it('gives every section its own weight field', () => {
    for (const section of RFI.sections) {
      expect(html, section.name).toContain(`aria-label="Section weight — ${section.name}"`);
    }
  });

  it('shows the weight the section actually carries', () => {
    for (const section of RFI.sections) {
      expect(fieldValue(html, `Section weight — ${section.name}`)).toBe(String(section.weight));
    }
  });

  it('says how much of each section has been allocated', () => {
    // Section weights are percentage points of the technical score and total
    // 100 across the template, so these are the shares the seed declares.
    expect(html).toContain('of 40 allocated');
    expect(html).toContain('of 20 allocated');
  });

  it('calls a fully spent section fully allocated', () => {
    expect(html).toContain('fully allocated');
  });
});

describe('a section that does not add up', () => {
  const over = {
    ...RFI,
    sections: RFI.sections.map((s) => (s.sequence === 1 ? { ...s, weight: 20 } : s)),
  };

  it('says by how much it is over', () => {
    expect(builder(over)).toContain('20 over');
  });

  it('raises the error on the template, not only on the meter', () => {
    expect(builder(over)).toContain('cannot award more than it is worth');
  });

  const under = {
    ...RFI,
    sections: RFI.sections.map((s) => (s.sequence === 1 ? { ...s, weight: 50 } : s)),
  };

  it('calls unspent budget unspent rather than an error', () => {
    const html = builder(under);
    expect(html).toContain('10 unspent');
    expect(html).not.toContain('cannot award more than it is worth');
  });
});

describe('the scale is chosen when the questionnaire is written', () => {
  const html = builder(RFI);

  it('offers a scale field on the template', () => {
    expect(html).toContain('aria-label="Score scale"');
    expect(fieldValue(html, 'Score scale')).toBe('100');
  });

  it('explains why it is chosen now rather than at scoring time', () => {
    expect(html).toContain('a scale changed later rewrites what every committed score meant');
  });

  it('offers the scales a buyer actually picks', () => {
    for (const preset of ['/5', '/10', '/100']) expect(html).toContain(preset);
  });
});

describe('the buyer reads a score per section and one overall', () => {
  const html = clean(renderToString(
    <StoreProvider><ComparisonTab eventId={seed.PRIMARY_EVENT_ID} /></StoreProvider>,
  ));

  it('shows a section breakdown beside the technical sheet', () => {
    expect(html).toContain('Score by section');
  });

  it('names every section the questionnaire was written with', () => {
    for (const section of seed.QUESTION_SECTIONS) expect(html).toContain(section.name);
  });

  it('states the scale the scores are reported out of', () => {
    expect(html).toContain('Out of 100');
    expect(html).toContain('Overall — out of 100');
  });

  it('shows how much each section counts, separately from what it scored', () => {
    expect(html).toContain('Share');
  });

  it('says how much of the evaluation is finished', () => {
    expect(html).toMatch(/\d+ of \d+ scored/);
  });
});
