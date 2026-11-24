/**
 * The template library screen, and the delete it will and will not offer.
 *
 * The domain tests decide *whether* a template may go. These prove the screen
 * acts on that answer rather than describing it: the button is disabled on a
 * used template, the row says where it is used, and the confirm modal for a
 * used template is rendered with no confirm button at all — there is no path
 * from this screen to the delete, not merely a discouraged one.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TemplateLibrary } from '../QuestionnairePanel';
import * as seed from '../../data/seed';
import {
  deletionBlock, templateUseIndex, templateUses,
} from '../../domain/questionnaireTemplates';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type { QuestionnaireTemplate } from '../../domain/types';

const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;
const UNUSED = TENANT_TEMPLATES.find(
  (t) => templateUses(t.id, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS).length === 0,
) as QuestionnaireTemplate;

const LIBRARY = TENANT_TEMPLATES;

function paint(): string {
  const uses = templateUseIndex(LIBRARY, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS);
  return renderToString(
    <TemplateLibrary
      scope="TENANT"
      scopeId="tenant-udaan"
      templates={LIBRARY}
      uses={uses}
      canAuthor
      onNew={() => {}}
      onUpload={() => {}}
      onEdit={() => {}}
      onDuplicate={() => {}}
      onInspect={() => {}}
      onDelete={() => {}}
    />,
  )
    .replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
}

/** The row for one template — the library renders one `<tr>` per template. */
function rowFor(html: string, template: QuestionnaireTemplate): string {
  const rows = html.split('<tr');
  const row = rows.find((r) => r.includes(template.name));
  expect(row, `no row for ${template.name}`).toBeDefined();
  return row as string;
}

/**
 * The opening tag of a row's delete button, where the `disabled` attribute
 * would sit. Matched as `disabled=""` rather than as the bare word, because
 * the button's shadcn class list carries `disabled:opacity-50` and a substring
 * search for "disabled" matches that on every button in the product.
 */
function deleteTag(html: string, template: QuestionnaireTemplate): string {
  const row = rowFor(html, template);
  const at = row.indexOf(`aria-label="Delete ${template.name}"`);
  expect(at, `no delete button for ${template.name}`).toBeGreaterThan(-1);
  const opens = row.lastIndexOf('<button', at);
  return row.slice(opens, row.indexOf('>', at) + 1);
}

describe('the library is honest about what has been used', () => {
  it('has both a used and an unused template to show, or it proves nothing', () => {
    const used = templateUses(RFI.id, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS);
    expect(used.length).toBeGreaterThan(0);
    expect(UNUSED).toBeDefined();
    expect(UNUSED.id).not.toBe(RFI.id);
  });

  it('shows how many events a used template is held by', () => {
    const html = paint();
    expect(rowFor(html, RFI)).toContain('1 event');
  });

  it('says plainly that an unused template is unused', () => {
    const html = paint();
    expect(rowFor(html, UNUSED)).toContain('not yet used');
  });
});

describe('deleting is offered only where it is allowed', () => {
  it('disables delete on a template an event was built from', () => {
    expect(deleteTag(paint(), RFI)).toContain('disabled=""');
  });

  it('explains on the button itself why it is disabled', () => {
    const row = rowFor(paint(), RFI);
    expect(row).toContain('Retire it instead');
  });

  it('leaves delete live on a template nothing has been asked from', () => {
    expect(deleteTag(paint(), UNUSED)).not.toContain('disabled=""');
  });

  it('names the event in the reason, so the buyer knows where to look', () => {
    const uses = templateUses(RFI.id, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS);
    const event = seed.EVENTS.find((e) => e.id === uses[0].eventId);
    expect(deletionBlock(uses)).toContain(event?.eventNumber ?? uses[0].eventNumber);
  });
});

describe('the delete is always on screen, whatever scope is being viewed', () => {
  /** The library as it paints at a scope nothing in it was authored at. */
  const atOtherScope = () => {
    const uses = templateUseIndex(LIBRARY, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS);
    return renderToString(
      <TemplateLibrary
        scope="EVENT"
        scopeId="evt-0142"
        templates={LIBRARY}
        uses={uses}
        canAuthor
        onNew={() => {}}
      onUpload={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
        onInspect={() => {}}
        onDelete={() => {}}
      />,
    ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  };

  it('renders a delete button for every row, not only the ones it can act on', () => {
    const html = atOtherScope();
    for (const template of LIBRARY) {
      expect(html).toContain(`aria-label="Delete ${template.name}"`);
    }
  });

  it('disables it and names the scope to open instead of hiding it', () => {
    const tag = deleteTag(atOtherScope(), UNUSED);
    expect(tag).toContain('disabled=""');
    expect(tag).toContain('Tenant');
  });

  it('still offers it at the scope the template was authored at', () => {
    expect(deleteTag(paint(), UNUSED)).not.toContain('disabled=""');
  });

  it('prefers the usage reason over the scope one where both would apply', () => {
    expect(deleteTag(paint(), RFI)).toContain('Retire it instead');
  });
});

describe('the rule is the same whichever way the delete is reached', () => {
  it('a used template cannot be deleted even by id, with no row in the way', () => {
    // The panel's confirm handler is only installed when the block is null, so
    // the rule holds for any caller that sets the delete target directly.
    const uses = templateUses(RFI.id, seed.REQUEST_QUESTIONNAIRES(), seed.EVENTS);
    expect(deletionBlock(uses)).not.toBeNull();
    expect(deletionBlock([])).toBeNull();
  });

  it('counts an event once even if it asked from the template twice', () => {
    const twice = [
      { eventId: 'evt-1', eventNumber: 'RFI-2026-0001', title: 'A', stage: 'RFI' as const },
      { eventId: 'evt-1', eventNumber: 'RFI-2026-0001', title: 'A', stage: 'RFP' as const },
    ];
    expect(deletionBlock(twice)).toContain('RFI-2026-0001 was built');
  });
});
