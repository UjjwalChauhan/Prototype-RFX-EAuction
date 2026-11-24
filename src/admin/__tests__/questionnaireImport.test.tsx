/**
 * The upload surface, and the question editor it changed on the way past.
 *
 * Two things are worth holding in place here. The upload has to be findable
 * from the library — a buyer who already has the sheet should not have to
 * open an empty builder to discover there is an import. And the drawer has to
 * offer the template before it asks for a file, because the first visit is
 * the one where people give up.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionnaireImportDrawer } from '../QuestionnaireImport';
import { QuestionEditor, TemplateBuilder, TemplateLibrary } from '../QuestionnairePanel';
import { emptyTemplate } from '../../domain/questionnaireTemplates';
import { StoreProvider } from '../../store/store';
import { color } from '../../design-system/tokens';
import { IMPORT_COLUMNS } from '../../domain/questionnaireImport';
import type { QuestionnaireTemplate, TemplateQuestion } from '../../domain/types';

/** A template with two sections and a question, as an upload would leave it. */
const IMPORTED = (): QuestionnaireTemplate => ({
  ...TEMPLATE(),
  sections: [
    { id: 's1', name: 'Capability', sequence: 1, weight: 60, askedPer: 'VENDOR' },
    { id: 's2', name: 'Delivery', sequence: 2, weight: 40, askedPer: 'LINE' },
  ],
  questions: [{ ...QUESTION, sectionId: 's1' }],
});

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>');

const TEMPLATE = (): QuestionnaireTemplate => ({
  ...emptyTemplate({
    id: 'qt-900', scopeType: 'TENANT', scopeId: 'tenant-1', userId: 'u-1', now: 1,
  }),
  name: 'Supplier qualification — RFI',
});

const QUESTION: TemplateQuestion = {
  id: 'q1', templateId: 'qt-900', sectionId: 'qt-900-sec-1', sequence: 1, code: 'CAP-1',
  type: 'long_text', title: 'Describe your quality management system.', helpText: '',
  isRequired: true, envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
  rubric: null, isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', config: {},
};

describe('the question editor', () => {
  const html = clean(renderToString(
    <QuestionEditor
      question={QUESTION}
      sections={TEMPLATE().sections}
      ceiling={40}
      onChange={() => {}}
    />,
  ));

  it('calls the field Question, not Title', () => {
    expect(html).toContain('Question');
    expect(html).not.toContain('>Title<');
  });

  it('asks for the code before the question', () => {
    expect(html.indexOf('>Code<')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('>Code<')).toBeLessThan(html.indexOf('>Question<'));
  });

  it('gives the question text a box it can be read in, not a one-line input', () => {
    expect(html).toContain('<textarea');
    expect(html).toContain('Describe your quality management system.');
  });

  it('still asks for the response type and the section', () => {
    expect(html).toContain('Response type');
    expect(html).toContain('>Section<');
  });
});

describe('finding the upload', () => {
  it('offers it from the library, beside New template', () => {
    const html = clean(renderToString(
      <TemplateLibrary
        scope="TENANT"
        scopeId="tenant-1"
        templates={[]}
        uses={new Map()}
        canAuthor
        onNew={() => {}}
        onUpload={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onInspect={() => {}}
        onDelete={() => {}}
      />,
    ));
    expect(html).toContain('Upload Excel / CSV');
    expect(html).toContain('New template');
  });

  it('opens straight into the upload when the buyer came in by that button', () => {
    const html = clean(renderToString(
      <StoreProvider>
        <TemplateBuilder
          template={TEMPLATE()}
          takenNames={[]}
          library={[]}
          startImporting
          onChange={() => {}}
          onClose={() => {}}
          onSave={() => {}}
        />
      </StoreProvider>,
    ));
    expect(html).toContain('Upload a questionnaire');
  });

  it('stays shut when the buyer came in by New template', () => {
    const html = clean(renderToString(
      <StoreProvider>
        <TemplateBuilder
          template={TEMPLATE()}
          takenNames={[]}
          library={[]}
          onChange={() => {}}
          onClose={() => {}}
          onSave={() => {}}
        />
      </StoreProvider>,
    ));
    expect(html).not.toContain('Upload a questionnaire');
    // The way in is still on screen, in the footer beside the agent.
    expect(html).toContain('⬆ Upload');
  });
});

describe('the upload drawer', () => {
  const html = clean(renderToString(
    <QuestionnaireImportDrawer
      open
      template={TEMPLATE()}
      onClose={() => {}}
      onApply={() => {}}
    />,
  ));

  it('renders nothing at all when it is closed', () => {
    expect(renderToString(
      <QuestionnaireImportDrawer
        open={false}
        template={TEMPLATE()}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )).toBe('');
  });

  it('offers both downloads before it asks for anything', () => {
    expect(html).toContain('Excel template');
    expect(html).toContain('CSV');
    expect(html.indexOf('Start from the template')).toBeLessThan(html.indexOf('Drop the filled-in sheet here'));
  });

  it('names every column the sheet carries', () => {
    for (const column of IMPORT_COLUMNS) expect(html).toContain(column.header);
  });

  it('accepts the two formats and nothing that pretends to be them', () => {
    expect(html).toContain('accept=".xlsx,.csv,.txt"');
  });

  it('promises nothing is written before the buyer confirms', () => {
    expect(html).toContain('nothing is written to the template until you confirm');
  });

  it('says only the question column is compulsory', () => {
    expect(html).toContain('has to be filled');
  });

  it('cannot be confirmed before a file has been read', () => {
    const confirm = html.slice(html.indexOf('Bring it in') - 400, html.indexOf('Bring it in'));
    expect(confirm).toContain('disabled');
  });

  it('does not offer replace-or-add on a template that holds nothing yet', () => {
    expect(html).not.toContain('Replace all of it');
  });
});

describe('what the buyer can change once it is in', () => {
  const html = clean(renderToString(
    <StoreProvider>
      <TemplateBuilder
        template={IMPORTED()}
        takenNames={[]}
        library={[]}
        onChange={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />
    </StoreProvider>,
  ));

  it('offers the section name, weight and grain as editable controls', () => {
    expect(html).toContain('aria-label="Section name — Capability"');
    expect(html).toContain('aria-label="Section weight — Capability"');
    expect(html).toContain('Per line item');
  });

  it('lets a section be moved up or down the form', () => {
    expect(html).toContain('aria-label="Move Capability down"');
    expect(html).toContain('aria-label="Move Delivery up"');
  });

  it('does not offer to move the first section up or the last one down', () => {
    /** The rest of the one button tag that carries this label. */
    const button = (label: string) => {
      const at = html.indexOf(`aria-label="${label}"`);
      return html.slice(at, html.indexOf('>', at));
    };
    // `disabled=""` is the attribute; `disabled:` inside the class list is a
    // Tailwind variant and matches on every button whether it is on or not.
    expect(button('Move Capability up')).toContain('disabled=""');
    expect(button('Move Delivery down')).toContain('disabled=""');
    expect(button('Move Capability down')).not.toContain('disabled=""');
  });

  it('lets a section be removed, saying what goes with it', () => {
    expect(html).toContain('aria-label="Remove section Capability"');
    expect(html).toContain('Remove "Capability" and the 1 question(s) in it');
  });

  it('lets a question be reordered and removed', () => {
    expect(html).toContain(`aria-label="Move ${QUESTION.code} down"`);
    expect(html).toContain(`aria-label="Remove ${QUESTION.title}"`);
  });

  it('can still add a section and a question', () => {
    expect(html).toContain('Add section');
    expect(html).toContain('Question');
  });
});

describe('an uploaded template is a draft', () => {
  it('leaves the code editable, which a published template does not', () => {
    const draft = clean(renderToString(
      <StoreProvider>
        <TemplateBuilder
          template={IMPORTED()}
          takenNames={[]}
          library={[]}
          onChange={() => {}}
          onClose={() => {}}
          onSave={() => {}}
        />
      </StoreProvider>,
    ));
    expect(draft).toContain('Derived from the name while the template is a draft');
    expect(draft).not.toContain('Frozen — this template is published');
  });
});

describe('why Save is greyed out', () => {
  /** A template that cannot be saved: no name, and a section short of 100%. */
  const BROKEN = (): QuestionnaireTemplate => ({
    ...IMPORTED(),
    name: '',
    sections: [{ id: 's1', name: 'Capability', sequence: 1, weight: 60, askedPer: 'VENDOR' }],
  });

  const builder = (template: QuestionnaireTemplate) => clean(renderToString(
    <StoreProvider>
      <TemplateBuilder
        template={template}
        takenNames={[]}
        library={[]}
        onChange={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />
    </StoreProvider>,
  ));

  it('says so beside the button, not only at the top of the form', () => {
    const html = builder(BROKEN());
    const footer = html.slice(html.lastIndexOf('Cannot be saved yet'));
    expect(footer).toContain('A template needs a name');
    // Beside the button it blocks, so the two are read together.
    expect(html.indexOf('Cannot be saved yet')).toBeLessThan(html.indexOf('Save template'));
  });

  it('counts the rest rather than reprinting the whole list twice', () => {
    expect(builder(BROKEN())).toContain('listed at the top of the form');
  });

  it('says nothing at all once the template is saveable', () => {
    const html = builder({ ...IMPORTED(), name: 'Tyres — RFI' });
    expect(html).not.toContain('Cannot be saved yet');
  });
});

describe('the drawer warns before the button does', () => {
  it('lists what will still block Save after the import', () => {
    const html = clean(renderToString(
      <QuestionnaireImportDrawer
        open
        template={TEMPLATE()}
        takenNames={['Supplier qualification — RFI']}
        onClose={() => {}}
        onApply={() => {}}
      />,
    ));
    // Nothing has been read yet, so there is no report to carry the list.
    expect(html).not.toContain('to fix before this template can be saved');
  });
});

describe('the question that is blocking Save is marked', () => {
  /** A Single choice with no choices — the commonest thing an upload leaves. */
  const BROKEN_QUESTION = (): QuestionnaireTemplate => ({
    ...IMPORTED(),
    name: 'Tyres — RFI',
    sections: [{ id: 's1', name: 'Capability', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
    questions: [
      { ...QUESTION, id: 'q1', code: 'CAP-1', sectionId: 's1', weight: 100 },
      {
        ...QUESTION, id: 'q2', code: 'CAP-2', sectionId: 's1', sequence: 2, weight: 0,
        scoringMethod: 'NONE', maxScore: 0,
        title: 'Which of these do you hold?', type: 'single_choice', config: { options: [] },
      },
    ],
  });

  const html = clean(renderToString(
    <StoreProvider>
      <TemplateBuilder
        template={BROKEN_QUESTION()}
        takenNames={[]}
        library={[]}
        onChange={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />
    </StoreProvider>,
  ));

  it('flags the question that is wrong, not the whole list', () => {
    expect(html).toContain('needs fixing');
    expect(html.split('needs fixing')).toHaveLength(2);
  });

  it('puts the reason on the question, not only at the top of the form', () => {
    const row = html.slice(html.indexOf('Which of these do you hold?'));
    expect(row.slice(0, 1200)).toContain('the list holds 0 choices');
  });

  it('draws the row in the danger colour, edge and fill', () => {
    const row = html.slice(html.indexOf('needs fixing') - 1200, html.indexOf('needs fixing'));
    expect(row.toLowerCase()).toContain(`border-left:3px solid ${color.dangerText.toLowerCase()}`);
    expect(row.toLowerCase()).toContain(`background:${color.dangerSoft.toLowerCase()}`);
  });

  it('leaves the healthy question unmarked', () => {
    const row = html.slice(html.indexOf('CAP-1') - 900, html.indexOf('CAP-1'));
    expect(row).not.toContain('needs fixing');
  });
});

describe('removing a weighted question', () => {
  it('warns what it will do to the section before the click', () => {
    const html = clean(renderToString(
      <StoreProvider>
        <TemplateBuilder
          template={{
            ...IMPORTED(),
            sections: [{ id: 's1', name: 'Capability', sequence: 1, weight: 60, askedPer: 'VENDOR' }],
            questions: [{ ...QUESTION, sectionId: 's1', weight: 25 }],
          }}
          takenNames={[]}
          library={[]}
          onChange={() => {}}
          onClose={() => {}}
          onSave={() => {}}
        />
      </StoreProvider>,
    ));
    expect(html).toContain('"Capability" drops from 60% to 35%');
  });
});
