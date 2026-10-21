/**
 * Procure to Pay configuration — the plugin grid, and the RFX tab in it.
 *
 * The grid is generated from `PLUGIN_CATALOGUE` rather than written out per
 * tab, which is what makes the RFX tab the same object as the others instead of
 * a special case bolted beside them. A card is a switch or a module; a switch
 * resolves and writes one boolean through the ordinary scope chain, and a
 * module opens the panel that already configures that part of the product.
 *
 * Two things the reference grid does that are worth keeping and are easy to get
 * wrong. A card that is off is drawn back, not hidden — an administrator
 * looking for a plugin needs to find it in order to turn it on. And the info
 * icon says what the switch actually *does*, not what it is called again: a
 * description that only restates the title is the commonest way a configuration
 * screen stops being readable.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Chip, Toggle } from '../design-system/components/primitives';
import { Tabs } from '../design-system/components/layout';
import { Drawer, ValidationBanner } from '../design-system/components/domain';
import {
  P2P_TABS, PLUGIN_CATALOGUE, pluginsFor, wiredCount, type P2pTab, type Plugin,
} from '../domain/controlRoom';
import { SCOPE_LABELS, SCOPE_ORDER, TENANT_DEFAULTS, resolve } from '../domain/config';
import { Icon } from './AdminIcons';
import { useStore } from '../store/store';
import { serverNow } from '../server/clock';
import type { ConfigScopeType } from '../domain/types';
import type { ScopeLineage } from '../domain/config';

/** What a tab calls its own section heading, as the reference page does. */
const SECTION_TITLE: Record<P2pTab, string> = {
  Configuration: 'General Config',
  PR: 'PR Config',
  RFQ: 'RFQ Config',
  RFX: 'RFX Config',
  PO: 'PO Config',
  GRN: 'GRN Config',
  Contract: 'Contract Plugins',
};

export function ProcureToPayConfiguration({
  scope, lineage, onOpenModule,
}: {
  scope: ConfigScopeType;
  lineage: ScopeLineage;
  /** A module card hands the panel back to the Control Room, which owns it. */
  onOpenModule: (module: string) => void;
}) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = React.useState<P2pTab>('RFX');
  const [query, setQuery] = React.useState('');
  const [explaining, setExplaining] = React.useState<Plugin | null>(null);

  const scopeId = scopeIdFor(scope, lineage);
  const plugins = pluginsFor(tab, query);

  const setSwitch = (key: string, value: boolean) => {
    if (scopeId === null) return;
    dispatch({
      type: 'SET_CONFIG',
      setting: {
        key, scopeType: scope, scopeId, value,
        isLocked: false, setBy: state.currentUser.id, setAt: serverNow(),
      },
    });
  };

  return (
    <div className="rfx-stack" style={{ gap: 0 }}>
      <Tabs
        tabs={[...P2P_TABS]}
        active={tab}
        onChange={(next) => { setTab(next as P2pTab); setQuery(''); }}
        counts={Object.fromEntries(
          P2P_TABS.map((each) => [each, PLUGIN_CATALOGUE[each].length]),
        )}
      />

      <div className="rfx-stack" style={{ gap: 14, paddingTop: 16 }}>
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 16, flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{SECTION_TITLE[tab]}</h2>
            <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 3 }}>
              All {tab === 'Configuration' ? 'general' : tab} configuration is available below.
            </div>
          </div>
          <label style={{ display: 'block', width: 300, maxWidth: '100%' }}>
            <span className="rfx-visually-hidden">Search {tab} modules</span>
            <div style={{ position: 'relative' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${tab} modules`}
                style={{
                  width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
                  padding: '8px 32px 8px 11px', fontSize: 12.5, background: '#fff',
                  color: color.textPrimary,
                }}
              />
              <span
                aria-hidden
                style={{
                  position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
                  color: color.textSecondary, display: 'inline-flex',
                }}
              >
                <Icon name="search" size={14} />
              </span>
            </div>
          </label>
        </div>

        <TabNote tab={tab} />

        {plugins.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${color.borderStrong}`, borderRadius: radius.card,
              padding: '34px 20px', textAlign: 'center', background: '#fff',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>No plugin matches “{query}”</div>
            <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 6 }}>
              {PLUGIN_CATALOGUE[tab].length} plugins are configured on this tab.
            </div>
          </div>
        ) : (
          <div className="rfx-plugin-grid">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                scope={scope}
                settings={state.configSettings}
                lineage={lineage}
                canWrite={scopeId !== null}
                onToggle={(value) => plugin.key && setSwitch(plugin.key, value)}
                onOpen={() => plugin.module && onOpenModule(plugin.module)}
                onExplain={() => setExplaining(plugin)}
              />
            ))}
          </div>
        )}
      </div>

      <Drawer
        open={explaining !== null}
        title={explaining?.title ?? ''}
        subtitle={explaining?.key ?? explaining?.module ?? ''}
        onClose={() => setExplaining(null)}
      >
        {explaining && (
          <div className="rfx-stack" style={{ gap: 12 }}>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: color.textBody }}>
              {explaining.description}
            </div>
            {explaining.effect === null ? (
              <ValidationBanner tone="warning" title="Stored here, enforced elsewhere">
                This plugin belongs to a Procure-to-Pay module that this build does not contain. The
                setting resolves and persists through the same scope chain as every other — it is
                the behaviour behind it that lives outside. It is listed so the configuration
                surface is the product's, not this build's.
              </ValidationBanner>
            ) : (
              <ValidationBanner tone="info" title="What this changes">
                {explaining.effect}
              </ValidationBanner>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** Why a tab holds what it holds. Only where it is not self-evident. */
function TabNote({ tab }: { tab: P2pTab }) {
  if (tab === 'RFX') {
    return (
      <ValidationBanner tone="info" title={`All ${wiredCount('RFX')} of these are enforced by this build`}>
        Every switch here names a setting the sourcing code reads, and every module opens a panel
        that already configures it. Where a decision has more than one answer — the feedback policy,
        the technical gate, the comparison basis — it is a module rather than a toggle, because a
        switch would have to stand for a choice it cannot express.
      </ValidationBanner>
    );
  }
  if (wiredCount(tab) === 0) {
    return (
      <ValidationBanner tone="warning" title="The suite's plugins, stored but not enforced here">
        These belong to Procure-to-Pay modules outside this build. They resolve and persist like any
        other setting, so the configuration surface matches the product — but nothing in this
        prototype reads them. The <strong>RFX</strong> tab is the one this build enforces.
      </ValidationBanner>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function PluginCard({
  plugin, scope, settings, lineage, canWrite, onToggle, onOpen, onExplain,
}: {
  plugin: Plugin;
  scope: ConfigScopeType;
  settings: import('../domain/types').ConfigSetting[];
  lineage: ScopeLineage;
  canWrite: boolean;
  onToggle: (value: boolean) => void;
  onOpen: () => void;
  onExplain: () => void;
}) {
  const isSwitch = plugin.kind === 'SWITCH' && plugin.key !== undefined;

  // The fallback is the declared default, never a literal here: a default
  // invented at the call site is one the resolver and the card can disagree
  // about, and every plugin in the catalogue has one.
  const resolved = isSwitch
    ? resolve<boolean>(
      plugin.key as string, settings, lineage,
      TENANT_DEFAULTS[plugin.key as string] === true,
    )
    : null;

  const on = resolved?.value === true;
  // A value locked at a broader scope is read-only here, exactly as it is on
  // every other configuration screen — the grid does not get its own rule.
  const locked = resolved?.isLocked === true
    && SCOPE_ORDER.indexOf(resolved.lockedBy ?? 'TENANT') < SCOPE_ORDER.indexOf(scope);
  const dimmed = isSwitch && !on;

  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.card, background: '#fff',
        padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10,
        minHeight: 196,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <span
          aria-hidden
          style={{ color: dimmed ? color.textMuted : color.ink, display: 'inline-flex' }}
        >
          <Icon name="box" size={34} stroke={1.6} />
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {isSwitch && (
            <Toggle
              checked={on}
              ariaLabel={plugin.title}
              onChange={onToggle}
              disabled={locked || !canWrite}
              disabledReason={
                locked
                  ? `Locked at ${SCOPE_LABELS[resolved?.lockedBy ?? 'TENANT']} scope.`
                  : !canWrite ? 'This scope has nothing to write against.' : undefined
              }
            />
          )}
          <button
            type="button"
            onClick={onExplain}
            aria-label={`What ${plugin.title} does`}
            title={`What ${plugin.title} does`}
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 0,
              color: color.textSecondary, display: 'inline-flex',
            }}
          >
            <InfoGlyph />
          </button>
        </div>
      </div>

      <div
        style={{
          fontSize: 16, fontWeight: 700, lineHeight: 1.3,
          color: dimmed ? color.textMuted : color.textPrimary,
        }}
      >
        {plugin.title}
      </div>

      <div
        style={{
          fontSize: 12, lineHeight: 1.55, flex: 1,
          color: dimmed ? color.textMuted : color.textSecondary,
        }}
      >
        {plugin.description}
      </div>

      {plugin.kind === 'MODULE' && (
        plugin.module === 'unavailable' ? (
          <Chip tone="neutral">Module not in this build</Chip>
        ) : (
          <Button variant="secondary" size="small" onClick={onOpen}>
            ⚙ View Module
          </Button>
        )
      )}

      {isSwitch && resolved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone={locked ? 'danger' : 'neutral'}>
            {locked ? '🔒 ' : ''}from {SCOPE_LABELS[resolved.resolvedFrom]}
          </Chip>
          {plugin.effect === null && <Chip tone="gold">not enforced here</Chip>}
        </div>
      )}
    </div>
  );
}

function InfoGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  );
}

function scopeIdFor(scope: ConfigScopeType, lineage: ScopeLineage): string | null {
  switch (scope) {
    case 'TENANT': return lineage.tenantId;
    case 'CATEGORY': return lineage.categoryId;
    case 'TEMPLATE': return lineage.templateId;
    case 'EVENT': return lineage.eventId;
  }
}
