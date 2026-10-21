/**
 * The Control Room, and the RFX tab inside Procure to Pay.
 *
 * Two things are being pinned, and the second is the one that matters.
 *
 * The **shape**: the rail carries the platform's configuration areas, and the
 * Procure-to-Pay page carries PR, RFQ, RFX, PO, GRN and Contract — RFX among
 * the others rather than bolted beside them, because the whole point is that it
 * is the same kind of object as PR and GRN.
 *
 * The **honesty**: a switch on the RFX tab resolves a setting this build
 * actually reads, and a switch that does not is visibly marked as such. A
 * configuration screen whose toggles half work, with no way to tell which half,
 * is worse than one with fewer toggles — an administrator turns something on,
 * nothing happens, and from then on they do not trust any of it.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfigurationStudio, HANDLED_MODULES } from '../ConfigurationStudio';
import { ProcureToPayConfiguration } from '../ProcureToPay';
import { StoreProvider } from '../../store/store';
import { SCOPE_LINEAGE } from '../../data/seed';
import { TENANT_DEFAULTS } from '../../domain/config';
import {
  CONTROL_ROOM, P2P_TABS, PLUGIN_CATALOGUE, pluginsFor, wiredCount,
} from '../../domain/controlRoom';

const LINEAGE = {
  tenantId: SCOPE_LINEAGE.tenantId, categoryId: null, templateId: null, eventId: null,
};

const clean = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const studio = () => clean(renderToString(
  <StoreProvider><ConfigurationStudio /></StoreProvider>,
));

const p2p = () => clean(renderToString(
  <StoreProvider>
    <ProcureToPayConfiguration scope="TENANT" lineage={LINEAGE} onOpenModule={() => {}} />
  </StoreProvider>,
));

/** Every switch the page rendered, by its accessible name. */
function switches(html: string): Record<string, boolean> {
  return Object.fromEntries(
    Array.from(html.matchAll(/aria-checked="(true|false)" aria-label="([^"]+)"/g))
      .map((match) => [match[2], match[1] === 'true']),
  );
}

describe('the Control Room rail', () => {
  const html = studio();

  it('is headed Control Room', () => {
    expect(html).toContain('Control Room');
  });

  it('lists every configuration area of the platform', () => {
    for (const entry of CONTROL_ROOM) {
      expect(html, `missing ${entry.label}`).toContain(entry.label);
    }
  });

  it('keeps them in the order an administrator learned them in', () => {
    const positions = CONTROL_ROOM.map((entry) => html.indexOf(entry.label));
    expect(positions.every((at) => at > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('opens on Procure to Pay, which is the area with the most behind it', () => {
    expect(html).toContain('RFX Config');
  });

  it('lists areas this build does not implement rather than silently dropping them', () => {
    const absent = CONTROL_ROOM.filter((entry) => !entry.built);
    expect(absent.length).toBeGreaterThan(0);
    for (const entry of absent) expect(html).toContain(entry.label);
  });

  it('still shows the scope selector, which is the point of the studio', () => {
    expect(html).toContain('Configuration scope');
    expect(html).toContain('The narrowest scope that defines a value wins');
  });
});

describe('the Procure to Pay tabs', () => {
  const html = p2p();

  it('carries the same tabs as the rest of the suite', () => {
    for (const tab of ['Configuration', 'PR', 'RFQ', 'PO', 'GRN', 'Contract']) {
      expect(html).toContain(`>${tab}<`);
    }
  });

  it('carries RFX among them', () => {
    expect(html).toContain('>RFX<');
  });

  it('places RFX between RFQ and PO, where the journey puts it', () => {
    expect(P2P_TABS.indexOf('RFX')).toBeGreaterThan(P2P_TABS.indexOf('RFQ'));
    expect(P2P_TABS.indexOf('RFX')).toBeLessThan(P2P_TABS.indexOf('PO'));
  });

  it('opens on RFX, because that is the tab this build enforces', () => {
    expect(html).toContain('RFX Config');
    expect(html).toContain('All RFX configuration is available below.');
  });

  it('offers a search over the tab, as the reference page does', () => {
    expect(html).toContain('Search RFX modules');
  });
});

describe('the RFX tab', () => {
  const html = p2p();
  const state = switches(html);

  it('renders a card for every RFX plugin', () => {
    for (const plugin of PLUGIN_CATALOGUE.RFX) {
      expect(html, `missing ${plugin.title}`).toContain(plugin.title);
    }
  });

  it('gives every switch an accessible name, not a bare toggle', () => {
    const expected = PLUGIN_CATALOGUE.RFX.filter((p) => p.kind === 'SWITCH');
    expect(Object.keys(state)).toHaveLength(expected.length);
    for (const plugin of expected) expect(state).toHaveProperty(plugin.title);
  });

  it('shows each switch at the value the config chain resolves', () => {
    for (const plugin of PLUGIN_CATALOGUE.RFX) {
      if (plugin.kind !== 'SWITCH') continue;
      expect(state[plugin.title], plugin.title)
        .toBe(TENANT_DEFAULTS[plugin.key as string] === true);
    }
  });

  it('keeps the target price undisclosed by default, which is the whole point of a target', () => {
    expect(state['Disclose Target Price']).toBe(false);
  });

  it('keeps blind technical evaluation on by default', () => {
    expect(state['Blind Technical Evaluation']).toBe(true);
  });

  it('says where each switch resolved from, not only what it is', () => {
    expect(html).toContain('from Tenant');
  });

  it('offers a module rather than a toggle where the answer is not yes or no', () => {
    for (const plugin of PLUGIN_CATALOGUE.RFX.filter((p) => p.kind === 'MODULE')) {
      expect(html, `${plugin.title} has no way in`).toContain(plugin.title);
    }
    expect(html).toContain('View Module');
  });

  it('opens the panels that already configure these things', () => {
    const modules = PLUGIN_CATALOGUE.RFX.filter((p) => p.kind === 'MODULE').map((p) => p.module);
    expect(modules).toContain('patterns');
    expect(modules).toContain('questionnaire');
    expect(modules).toContain('auction');
    expect(modules).not.toContain('unavailable');
  });

  it('is marked as enforced, and does not carry the not-enforced warning', () => {
    expect(html).toContain('enforced by this build');
    expect(html).not.toContain('not enforced here');
  });
});

describe('what each plugin claims to do', () => {
  it('every RFX plugin says what changes when it is on', () => {
    for (const plugin of PLUGIN_CATALOGUE.RFX) {
      expect(plugin.effect, plugin.title).not.toBeNull();
    }
    expect(wiredCount('RFX')).toBe(PLUGIN_CATALOGUE.RFX.length);
  });

  it('every RFX switch names a setting that resolves to something', () => {
    for (const plugin of PLUGIN_CATALOGUE.RFX) {
      if (plugin.kind !== 'SWITCH') continue;
      expect(TENANT_DEFAULTS, plugin.title).toHaveProperty(plugin.key as string);
    }
  });

  it('a plugin of a module this build lacks admits it rather than implying an effect', () => {
    for (const tab of ['PR', 'RFQ', 'PO', 'GRN', 'Contract'] as const) {
      expect(wiredCount(tab), tab).toBe(0);
    }
  });

  it('still resolves the suite plugins, so the scope chain covers them too', () => {
    for (const tab of ['PR', 'RFQ', 'PO', 'GRN', 'Contract'] as const) {
      for (const plugin of PLUGIN_CATALOGUE[tab]) {
        if (plugin.kind !== 'SWITCH') continue;
        expect(TENANT_DEFAULTS, plugin.title).toHaveProperty(plugin.key as string);
      }
    }
  });

  it('starts the suite plugins in the state the product ships them in', () => {
    expect(TENANT_DEFAULTS['p2p.grn.enable']).toBe(true);
    expect(TENANT_DEFAULTS['p2p.rfq.reopen']).toBe(true);
    expect(TENANT_DEFAULTS['p2p.pr.enable_bom']).toBe(true);
    expect(TENANT_DEFAULTS['p2p.contract.tds_at_lineitem']).toBe(false);
  });
});

describe('the catalogue holds together', () => {
  const every = P2P_TABS.flatMap((tab) => PLUGIN_CATALOGUE[tab]);

  it('gives every switch a key to write to', () => {
    for (const plugin of every) {
      if (plugin.kind === 'SWITCH') expect(plugin.key, plugin.id).toBeDefined();
    }
  });

  it('gives every module somewhere to go', () => {
    for (const plugin of every) {
      if (plugin.kind === 'MODULE') expect(plugin.module, plugin.id).toBeDefined();
    }
  });

  it('never gives one plugin both', () => {
    for (const plugin of every) {
      expect(plugin.kind === 'SWITCH' ? plugin.module : plugin.key, plugin.id).toBeUndefined();
    }
  });

  it('points every module card at something that renders', () => {
    for (const plugin of every) {
      if (plugin.kind !== 'MODULE') continue;
      expect(HANDLED_MODULES, `${plugin.id} opens nothing`).toContain(plugin.module);
    }
  });

  it('keeps every id unique, so two cards cannot share a React key', () => {
    const ids = every.map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every config key unique, so two switches cannot fight over one setting', () => {
    const keys = every.map((plugin) => plugin.key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('describes every plugin rather than restating its title', () => {
    for (const plugin of every) {
      expect(plugin.description.length, plugin.id).toBeGreaterThan(plugin.title.length);
    }
  });
});

describe('searching a tab', () => {
  it('returns everything when nothing is typed', () => {
    expect(pluginsFor('RFX')).toHaveLength(PLUGIN_CATALOGUE.RFX.length);
  });

  it('narrows on the title', () => {
    const found = pluginsFor('RFX', 'rehearsal');
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('Require Rehearsal Before First Auction');
  });

  it('narrows on the description too, since that is what a buyer remembers', () => {
    expect(pluginsFor('GRN', 'ASN').length).toBeGreaterThan(0);
  });

  it('ignores case', () => {
    expect(pluginsFor('RFX', 'BLIND')).toHaveLength(pluginsFor('RFX', 'blind').length);
  });

  it('returns nothing for a term on another tab', () => {
    expect(pluginsFor('RFX', 'credit note')).toHaveLength(0);
  });
});
