/**
 * The portal's navigation — the workspace switcher and the labelled rail.
 *
 * Replicated from the reference screen: a 74px column of workspace avatars on
 * the far left with its own foot of actions, then a 250px white rail carrying
 * the wordmark and seven labelled groups. One accent (indigo) marks the
 * selected row; amber discs carry counts; everything else is grey on white.
 *
 * The nav is a component of its own rather than markup inside the shell so the
 * two rails, their geometry and their icon set stay in one place — the shell
 * only says which route is current.
 */
import React from 'react';
import { portal, portalNav, portalRadius } from './portalTheme';
import { PortalIcon, PortalWordmark } from './PortalIcons';

export type PortalRoute =
  | 'home' | 'invoices' | 'inputs'
  | 'requests' | 'offers' | 'credit-note' | 'ask-advance' | 'orders'
  | 'ticketing'
  | 'settlements' | 'profile'
  | 'report' | 'notifications' | 'settings'
  | 'auctions' | 'dashboard' | 'event' | 'bidding' | 'outcome';

export type NavItem = {
  id: PortalRoute;
  label: string;
  icon: () => React.ReactElement;
};

/**
 * The rail, group for group and label for label as the reference has it.
 * Procurement is what a supplier came for and sits highest; everything else is
 * support and follows it.
 */
export const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Quick Links',
    items: [
      { id: 'home', label: 'Home', icon: PortalIcon.home },
      { id: 'invoices', label: 'Invoices', icon: PortalIcon.document },
      { id: 'inputs', label: 'Inputs', icon: PortalIcon.document },
    ],
  },
  {
    heading: 'Procurement',
    items: [
      { id: 'requests', label: 'Requests', icon: PortalIcon.bag },
      { id: 'offers', label: 'Offers', icon: PortalIcon.bag },
      // The room, rather than the invitation to it. An auction is the one ask
      // a supplier answers live, and it had no way in from the rail at all.
      { id: 'bidding', label: 'Auction room', icon: PortalIcon.bars },
      { id: 'credit-note', label: 'Credit Note', icon: PortalIcon.bag },
      { id: 'ask-advance', label: 'Ask Advance', icon: PortalIcon.bars },
      { id: 'orders', label: 'Orders', icon: PortalIcon.bars },
    ],
  },
  {
    heading: 'Ticketing',
    items: [{ id: 'ticketing', label: 'Ticketing', icon: PortalIcon.ticket }],
  },
  {
    heading: 'Account Links',
    items: [
      { id: 'settlements', label: 'Settlements', icon: PortalIcon.card },
      { id: 'profile', label: 'View Profile', icon: PortalIcon.profile },
    ],
  },
  {
    heading: 'Reports',
    items: [{ id: 'report', label: 'Report', icon: PortalIcon.gear }],
  },
  {
    heading: 'Insights',
    items: [{ id: 'notifications', label: 'Notifications', icon: PortalIcon.bell }],
  },
  {
    heading: 'Settings',
    items: [{ id: 'settings', label: 'Settings', icon: PortalIcon.gear }],
  },
];

export type Workspace = { id: string; name: string };

/** Two words at most, first letters — what the reference shows when a logo is absent. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function PortalNav({
  route, onNavigate, workspaces, activeWorkspaceId, onSwitchWorkspace,
  badges = {}, onSignOut, onAddWorkspace,
}: {
  route: PortalRoute;
  onNavigate: (route: PortalRoute) => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  /** Counts on rail rows — amber discs, shown only when there is something to count. */
  badges?: Partial<Record<PortalRoute, number>>;
  onSignOut?: () => void;
  onAddWorkspace?: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const width = collapsed ? portalNav.railCollapsed : portalNav.railWidth;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh',
        fontFamily: portalNav.font,
      }}
    >
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        onSwitch={onSwitchWorkspace}
        onAdd={onAddWorkspace}
        onSettings={() => onNavigate('settings')}
        onSignOut={onSignOut}
      />

      <nav
        aria-label="Portal navigation"
        style={{
          width, background: portal.rail, borderRight: `1px solid ${portal.switcherBorder}`,
          display: 'flex', flexDirection: 'column', position: 'relative',
        }}
      >
        <div style={{ padding: collapsed ? '26px 0 18px' : '26px 24px 18px' }}>
          {collapsed ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <PortalWordmark ink={portal.navInk} accent={portal.primary} markOnly />
            </div>
          ) : (
            <PortalWordmark ink={portal.navInk} accent={portal.primary} />
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '0 12px 24px' : '0 16px 24px' }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} style={{ marginBottom: 6 }}>
              {!collapsed && (
                <div
                  style={{
                    fontSize: 12.5, fontWeight: 500, color: portal.navHeading,
                    letterSpacing: '0.01em', padding: '16px 12px 8px',
                  }}
                >
                  {group.heading}
                </div>
              )}
              <div style={{ display: 'grid', gap: 2 }}>
                {group.items.map((item) => (
                  <NavRow
                    key={item.id}
                    item={item}
                    active={route === item.id}
                    collapsed={collapsed}
                    badge={badges[item.id]}
                    onClick={() => onNavigate(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* The collapse tab, riding the rail's outer edge as in the reference. */}
        <button
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => setCollapsed((v) => !v)}
          style={{
            position: 'absolute', right: -1, bottom: 16,
            width: 26, height: 30, borderRadius: '7px 0 0 7px',
            border: `1px solid ${portal.switcherBorder}`, borderRight: 'none',
            background: '#F1F2F5', color: portal.navLabel, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          {collapsed ? <PortalIcon.chevronRight /> : <PortalIcon.chevronLeft />}
        </button>
      </nav>
    </div>
  );
}

function NavRow({
  item, active, collapsed, badge, onClick,
}: {
  item: NavItem; active: boolean; collapsed: boolean;
  badge?: number; onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      key={item.id}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={active ? undefined : 'rfx-navrow'}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
        position: 'relative', border: 'none', cursor: 'pointer',
        padding: collapsed ? '0 12px' : '0 16px', height: portalNav.rowHeight,
        justifyContent: collapsed ? 'center' : undefined,
        background: active ? portal.primary : 'transparent',
        color: active ? portal.primaryText : portal.navLabel,
        fontWeight: active ? 600 : 500, fontSize: 15,
        letterSpacing: '-0.005em',
        borderRadius: portalRadius.row,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}><Icon /></span>
      {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && <CountBadge value={badge} />}
      {collapsed && badge !== undefined && badge > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute', width: 8, height: 8, borderRadius: '50%',
            background: portal.badge, transform: 'translate(14px, -12px)',
          }}
        />
      )}
    </button>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span
      style={{
        background: portal.badge, color: portal.badgeText,
        minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </span>
  );
}

/**
 * The far-left column: every workspace this account can act for, the current
 * one filled in the accent, and a foot of three round actions.
 */
function WorkspaceSwitcher({
  workspaces, activeId, onSwitch, onAdd, onSettings, onSignOut,
}: {
  workspaces: Workspace[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd?: () => void;
  onSettings: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div
      aria-label="Workspace switcher"
      style={{
        width: portalNav.switcherWidth, flexShrink: 0, background: portal.switcher,
        borderRight: `1px solid ${portal.switcherBorder}`,
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto', padding: '14px 0 18px',
      }}
    >
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
        {workspaces.map((workspace) => {
          const active = workspace.id === activeId;
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => onSwitch(workspace.id)}
              aria-pressed={active}
              title={workspace.name}
              style={{
                display: 'grid', justifyItems: 'center', gap: 4, width: 66,
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              <span
                style={{
                  width: portalNav.avatar, height: portalNav.avatar, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? portal.primary : '#FFFFFF',
                  color: active ? portal.primaryText : portal.navInk,
                  border: `1px solid ${active ? portal.primary : portal.avatarBorder}`,
                  fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
                }}
              >
                {initialsOf(workspace.name)}
              </span>
              <span
                style={{
                  fontSize: 9.5, lineHeight: 1.25, textAlign: 'center',
                  color: active ? portal.navInk : portal.avatarLabel,
                  fontWeight: active ? 600 : 400,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                }}
              >
                {workspace.name}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', justifyItems: 'center', gap: 12, marginTop: 20 }}>
        <SwitcherAction label="Add a workspace" onClick={onAdd}><PortalIcon.plus /></SwitcherAction>
        <SwitcherAction label="Settings" onClick={onSettings}><PortalIcon.gear /></SwitcherAction>
        <SwitcherAction label="Sign out" onClick={onSignOut}><PortalIcon.logout /></SwitcherAction>
      </div>
    </div>
  );
}

function SwitcherAction({
  label, onClick, children,
}: {
  label: string; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={!onClick}
      style={{
        width: 36, height: 36, borderRadius: '50%',
        border: `1px solid ${portal.avatarBorder}`, background: '#FFFFFF',
        color: portal.navLabel, cursor: onClick ? 'pointer' : 'default',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}
    >
      {children}
    </button>
  );
}
