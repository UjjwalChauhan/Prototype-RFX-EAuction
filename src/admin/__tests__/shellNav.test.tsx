/**
 * Where the sourcing work lives in the rail.
 *
 * The one thing this file protects is the answer to "where do I raise an
 * RFP". Everything a buyer does to source something — intake, the board, the
 * three written asks and the auction — sits under Procurement, as siblings,
 * because they are filtered views of one object. Nesting them a level deeper
 * made them look like separate records; scattering them across the rail made
 * the question unanswerable.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, initialState, type AppState } from '../../store/store';
import { AdminShell, type Route } from '../AdminShell';

const state = initialState();

function paint(route: Route, seed: AppState = state) {
  return renderToString(
    <StoreProvider seed={seed}>
      <AdminShell route={route} onNavigate={() => {}} title="Title">body</AdminShell>
    </StoreProvider>,
  );
}

/** Just the rail, so an assertion can't be satisfied by the page behind it. */
const rail = (html: string) =>
  html.slice(html.indexOf('Global navigation'), html.indexOf('Collapse'));

const text = (html: string) =>
  html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/**
 * The rows of a panel, in rail order.
 *
 * The outer panel is sliced up to where the nested one starts, so a child of
 * RFX can never satisfy an assertion about a child of Procurement.
 */
function panelRows(html: string, which: 'procurement' | 'rfx'): string[] {
  const r = rail(html);
  const outer = r.indexOf('class="rfx-navsub"');
  const nested = r.indexOf('class="rfx-navsub nested"');
  const slice = which === 'rfx'
    ? (nested === -1 ? '' : r.slice(nested, r.indexOf('</div>', nested)))
    : r.slice(outer, nested === -1 ? r.length : nested);
  return [...slice.matchAll(/<span[^>]*>([^<]+)<\/span>/g)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 1);
}

const WRITTEN = ['Request for Information', 'Request for Proposal', 'Request for Quotation'];

describe('RFX gathers the three written asks', () => {
  const html = paint({ name: 'list', stage: 'RFI' });

  it.each(WRITTEN)('%s is a child of RFX, not of Procurement directly', (label) => {
    expect(panelRows(html, 'rfx')).toContain(label);
    expect(panelRows(html, 'procurement')).not.toContain(label);
  });

  it('puts RFX itself under Procurement', () => {
    expect(panelRows(html, 'procurement')).toContain('RFX');
  });

  it('opens and closes like its parent does', () => {
    // Same mechanism, same markers: a group row with a caret and a panel.
    const r = rail(html);
    expect(r).toContain('rfx-navgroup nested open active');
    expect(r).toContain('class="rfx-navsub nested"');
  });

  it('keeps the asks out of the rail until RFX is open', () => {
    // A route outside RFX leaves the group shut, so the asks are not rendered.
    const shut = rail(paint({ name: 'approvals' }));
    expect(shut).not.toContain('rfx-navsub nested');
    for (const label of WRITTEN) expect(text(shut)).not.toContain(label);
  });

  it('is the only place each ask appears', () => {
    const r = text(rail(html));
    for (const label of WRITTEN) expect(r.split(label)).toHaveLength(2);
  });
});

describe('Procurement holds the rest of the sourcing work', () => {
  const html = paint({ name: 'board' });

  it.each(['Intake / PR Workbench', 'Purchase Request', 'Sourcing Board', 'RFX', 'E-Auction'])(
    '%s is a direct child',
    (label) => { expect(panelRows(html, 'procurement')).toContain(label); },
  );

  it('does not list Create Event', () => {
    // Creating an event is an action the board, intake and the PR workbench
    // each offer in context — a rail row would be a fourth way in.
    expect(text(rail(html))).not.toContain('Create Event');
  });

  it('names Procurement under the AP & Procurement section', () => {
    const r = text(rail(html));
    expect(r.indexOf('AP & Procurement')).toBeLessThan(r.indexOf('Procurement Intake'));
  });
});

describe('the rail says where you are', () => {
  it.each([
    [{ name: 'list', stage: 'RFI' } as Route, 'Request for Information'],
    [{ name: 'list', stage: 'RFP' } as Route, 'Request for Proposal'],
    [{ name: 'list', stage: 'RFQ' } as Route, 'Request for Quotation'],
    [{ name: 'list', stage: 'AUCTION' } as Route, 'E-Auction'],
    [{ name: 'intake' } as Route, 'Intake / PR Workbench'],
    [{ name: 'board' } as Route, 'Sourcing Board'],
    [{ name: 'requests' } as Route, 'Purchase Request'],
  ])('marks %o as selected', (route, label) => {
    const r = rail(paint(route));
    const selected = [...r.matchAll(/class="rfx-navrow on"[^>]*>(?:<[^>]+>)*\s*([^<]+)/g)].map((m) => m[1].trim());
    expect(selected).toEqual([label]);
  });

  it('opens Procurement around the screen you landed on', () => {
    const r = rail(paint({ name: 'list', stage: 'AUCTION' }));
    expect(r).toContain('rfx-navgroup open active');
  });

  it('opens the whole chain for an ask reached by a link', () => {
    // Procurement *and* RFX inside it, or the rail sits shut beside the
    // screen it is describing.
    const r = rail(paint({ name: 'list', stage: 'RFP' }));
    expect(r).toContain('rfx-navgroup open active');
    expect(r).toContain('rfx-navgroup nested open active');
  });

  it('carries the live-auction count on the E-Auction row', () => {
    const live = state.events.filter((e) => e.status === 'AUCTION_LIVE').length;
    expect(live).toBeGreaterThan(0);
    expect(text(rail(paint({ name: 'board' })))).toContain(`${live} live`);
  });
});

describe('the shell follows the reference', () => {
  const html = paint({ name: 'board' });

  it('has one rail, not two', () => {
    // The old build put a second 172px "Sourcing" rail beside the first,
    // listing exactly what the Procurement panel now holds.
    expect(html).not.toContain('aria-label="Sourcing"');
    expect(html.match(/<nav/g)).toHaveLength(1);
  });

  it('uses the reference width and palette', () => {
    expect(html).toContain('width:200px');
    expect(html).toContain('#6C5DD3');
  });

  it('carries no colour from the previous palette', () => {
    for (const legacy of ['#2563EB', '#EFF4FF', '#111827', '#F7F8FA', '#E5E7EB']) {
      expect(html).not.toContain(legacy);
    }
  });
});
