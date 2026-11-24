/**
 * Pack 01 — Admin shell and navigation.
 *
 * The nav restructure matters: RFI / RFP / RFQ are *shortcuts* under Sourcing,
 * not top-level objects, because they are stages of one event. Sourcing Board
 * is the primary entry.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Avatar, Button, Chip } from '../design-system/components/primitives';
import { Icon, type AdminIconName } from './AdminIcons';
import { ValidationBanner } from '../design-system/components/domain';
import { resetPersistedState, useStore } from '../store/store';
import { USERS } from '../data/seed';

export type Route =
  | { name: 'board' }
  | { name: 'rfxHome' }
  | { name: 'requests' }
  | { name: 'intake' }
  | { name: 'create'; prdId?: string }
  | { name: 'event'; eventId: string; tab?: string }
  | { name: 'list'; stage: 'RFI' | 'RFP' | 'RFQ' | 'AUCTION' }
  | { name: 'approvals' }
  | { name: 'config' }
  | { name: 'agents' };

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  badge?: string;
  route?: Route;
  children?: NavItem[];
  group?: string;
}

/**
 * The rail, as data.
 *
 * Declarative because the shape is the point: everything the buyer does to
 * source something lives under one group, so "where do I raise an RFP" has one
 * answer. RFI / RFP / RFQ and the auction are listed as siblings of the
 * Sourcing Board rather than nested a level deeper — they are filtered views
 * of one object, and burying them made them look like separate records.
 *
 * Rows without a route are the reference's own surrounding modules, kept so
 * the sourcing work sits in a recognisable product rather than alone.
 */
type NavLeaf = { label: string; route?: Route; badge?: string };
/** A child is a row, or a nested group that opens the same way its parent does. */
type NavChild = NavLeaf | { label: string; children: NavLeaf[] };
type NavEntry =
  | { kind: 'section'; label: string }
  | { kind: 'item'; label: string; icon: AdminIconName; route?: Route; badge?: string }
  | { kind: 'group'; label: string; icon: AdminIconName; children: NavChild[] };

const isNested = (c: NavChild): c is { label: string; children: NavLeaf[] } =>
  'children' in c;

/** Every leaf under a child, nested or not — used to test whether it holds the route. */
const leavesOf = (c: NavChild): NavLeaf[] => (isNested(c) ? c.children : [c]);

const NAV: NavEntry[] = [
  { kind: 'item', label: 'Dashboard', icon: 'gauge', route: { name: 'board' } },

  { kind: 'section', label: 'Hierarchy & Enforcement' },
  { kind: 'group', label: 'Organisation', icon: 'org', children: [
    { label: 'Offices' }, { label: 'Employees' },
  ] },
  { kind: 'item', label: 'Configuration Studio', icon: 'lock', route: { name: 'config' } },
  { kind: 'item', label: 'DoA & Agent Console', icon: 'sparkle', route: { name: 'agents' } },
  { kind: 'item', label: 'Approval Requests', icon: 'checkSq', route: { name: 'approvals' }, badge: '7' },

  { kind: 'section', label: 'AP & Procurement' },
  { kind: 'item', label: 'Vendor Management', icon: 'userBox' },
  { kind: 'item', label: 'Product & Stock', icon: 'box' },
  { kind: 'item', label: 'Invoice Management', icon: 'doc' },
  /**
   * Everything that sources something, in the order a buyer meets it.
   *
   * The three written asks are gathered under RFX because they are one family
   * — same shape of work, same screens, told apart only by what is being asked
   * for. Creating an event is not listed: it is an action the board, the
   * intake screen and the PR workbench each offer in context, and a rail row
   * for it would be a fourth way to start the same thing.
   */
  { kind: 'group', label: 'Procurement', icon: 'layers', children: [
    { label: 'Intake / PR Workbench', route: { name: 'intake' } },
    { label: 'Purchase Request', route: { name: 'requests' } },
    { label: 'Sourcing Board', route: { name: 'board' } },
    { label: 'RFX', children: [
      // The family's own front door. It sits above the three filtered views
      // because a buyer opening RFX wants their day, not a list of RFIs.
      { label: 'RFX Home', route: { name: 'rfxHome' } },
      { label: 'Request for Information', route: { name: 'list', stage: 'RFI' } },
      { label: 'Request for Proposal', route: { name: 'list', stage: 'RFP' } },
      { label: 'Request for Quotation', route: { name: 'list', stage: 'RFQ' } },
    ] },
    { label: 'E-Auction', route: { name: 'list', stage: 'AUCTION' }, badge: 'LIVE_AUCTIONS' },
    { label: 'Purchase Order' },
    { label: 'Vendor Catalog' },
  ] },
  { kind: 'item', label: 'Contract Management', icon: 'doc' },
  { kind: 'item', label: 'Vendor Advance', icon: 'wallet' },

  { kind: 'section', label: 'Treasury & Finances' },
  { kind: 'item', label: 'Account Payables', icon: 'doc' },
  { kind: 'item', label: 'Vendor Settlements', icon: 'userBox' },
  { kind: 'item', label: 'Bank Guarantee', icon: 'archive' },

  { kind: 'section', label: 'Payments' },
  { kind: 'item', label: 'Payout', icon: 'person' },

  { kind: 'section', label: 'Others' },
  { kind: 'item', label: 'Repository', icon: 'archive' },
  { kind: 'item', label: 'Reports', icon: 'chart' },
  { kind: 'item', label: 'Export Wizard', icon: 'exportI' },
  { kind: 'item', label: 'Audit Logs', icon: 'scan' },
];

/**
 * Which groups to open when a route is reached directly, by URL or by a link.
 *
 * A chain rather than a single name: an RFP reached from a link has to open
 * Procurement *and* the RFX group inside it, or the rail sits shut beside the
 * screen it is describing.
 */
function groupsFor(route: Route): string[] {
  const WRITTEN = ['RFI', 'RFP', 'RFQ'];
  if (route.name === 'rfxHome') return ['Procurement', 'RFX'];
  if (route.name === 'list' && WRITTEN.includes(route.stage)) return ['Procurement', 'RFX'];
  return ['board', 'requests', 'intake', 'create', 'event', 'list'].includes(route.name)
    ? ['Procurement']
    : [];
}

export function AdminShell({
  route, onNavigate, title, subtitle, breadcrumb, primaryAction, tabs, stageRail, children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  title: string;
  subtitle?: string;
  breadcrumb?: React.ReactNode;
  primaryAction?: React.ReactNode;
  tabs?: React.ReactNode;
  stageRail?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { state, dispatch } = useStore();
  const [collapsed, setCollapsed] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  /**
   * The page head is sticky and its height varies with the breadcrumb and
   * subtitle, so a screen that wants to stick something under it cannot
   * hard-code the offset. Publish the measured height instead, and let them
   * read `top: var(--rfx-head-h)`.
   */
  const headRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const head = headRef.current;
    if (!head || typeof ResizeObserver === 'undefined') return;
    const publish = () =>
      document.documentElement.style.setProperty('--rfx-head-h', `${head.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);
  /**
   * Which groups are expanded. Seeded from the route so that landing on an
   * auction with a link opens Procurement around it rather than leaving the
   * rail closed beside the screen it is describing.
   */
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(
    () => new Set(groupsFor(route).length > 0 ? groupsFor(route) : ['Procurement']),
  );
  const toggleGroup = (label: string) =>
    setOpenGroups((held) => {
      const next = new Set(held);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });

  /** Navigating into a group's territory opens it, and never closes another. */
  const landedIn = groupsFor(route).join('/');
  React.useEffect(() => {
    if (!landedIn) return;
    const wanted = landedIn.split('/');
    setOpenGroups((held) => {
      if (wanted.every((g) => held.has(g))) return held;
      const next = new Set(held);
      for (const g of wanted) next.add(g);
      return next;
    });
  }, [landedIn]);

  const liveAuctions = state.events.filter((e) => e.status === 'AUCTION_LIVE');

  const isActive = (candidate: Route['name'], extra?: string) => {
    if (route.name !== candidate) return false;
    if (candidate === 'list' && extra) return (route as { stage: string }).stage === extra;
    return true;
  };
  /** The same test, against a whole route — what the declarative tree carries. */
  const isActiveRoute = (candidate: Route) =>
    isActive(candidate.name, candidate.name === 'list' ? candidate.stage : undefined);

  const navRow = (
    label: string,
    icon: AdminIconName,
    opts: {
      active?: boolean; onClick?: () => void; badge?: string;
      caret?: AdminIconName; groupActive?: boolean;
    } = {},
  ) => (
    <button
      key={label}
      type="button"
      className="rfx-navrow"
      onClick={opts.onClick}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', cursor: opts.onClick ? 'pointer' : 'default',
        padding: '7px 8px',
        background: opts.active ? color.brandPrimarySoft : 'transparent',
        color: opts.active || opts.groupActive ? color.brandPrimaryStrong : color.textBody,
        fontWeight: opts.active || opts.groupActive ? 500 : 400,
        fontSize: 12, borderRadius: radius.nav,
      }}
    >
      <span style={{ color: opts.active || opts.groupActive ? color.brandPrimary : '#55555F', display: 'flex' }}>
        <Icon name={icon} />
      </span>
      {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{label}</span>}
      {!collapsed && opts.badge && <Chip tone="brand">{opts.badge}</Chip>}
      {!collapsed && opts.caret && (
        <span style={{ color: color.textMuted, display: 'flex' }}><Icon name={opts.caret} size={11} stroke={2} /></span>
      )}
    </button>
  );

  /** A row inside a group's panel: a destination, or a nested group's header. */
  const navLeaf = ({
    label, route: to, badge, on, caret, strong, onClick,
  }: {
    label: string; route?: Route; badge?: string; on?: boolean;
    caret?: AdminIconName; strong?: boolean; onClick?: () => void;
  }) => (
    <button
      key={label}
      type="button"
      className={`rfx-navrow ${on ? 'on' : ''}`}
      onClick={onClick ?? (to ? () => onNavigate(to) : undefined)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        textAlign: 'left', border: 'none', background: 'transparent',
        cursor: to || onClick ? 'pointer' : 'default',
        padding: '6px 8px', borderRadius: radius.nav, fontSize: 11,
        color: strong ? color.brandPrimaryStrong : 'inherit',
        fontWeight: strong ? 600 : undefined,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {badge === 'LIVE_AUCTIONS' && liveAuctions.length > 0 && (
        <Chip tone="danger">{liveAuctions.length} live</Chip>
      )}
      {badge && badge !== 'LIVE_AUCTIONS' && <Chip tone="brand">{badge}</Chip>}
      {caret && (
        <span style={{ color: color.textMuted, display: 'flex' }}>
          <Icon name={caret} size={11} stroke={2} />
        </span>
      )}
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', background: color.surfacePage }}>
      {/* Kill switch and connection banners sit above everything. */}
      {state.agentKillSwitch.engaged && (
        <div style={{ padding: '8px 12px', background: color.dangerSoft, borderBottom: `1px solid #FCA5A5` }}>
          <ValidationBanner
            tone="error"
            title="Agent kill switch engaged — all agent automation is halted"
            action={<Button size="small" variant="secondary" onClick={() => dispatch({ type: 'RELEASE_KILL_SWITCH' })}>Review & release</Button>}
          >
            Engaged by <strong>{state.agentKillSwitch.by}</strong>
            {state.agentKillSwitch.at && ` at ${new Date(state.agentKillSwitch.at).toLocaleTimeString()}`} · scope: whole tenant.
          </ValidationBanner>
        </div>
      )}
      {state.connectionLost && (
        <div style={{ padding: '8px 12px', background: color.warningSoft, borderBottom: `1px solid #FCD34D` }}>
          <ValidationBanner tone="warning" title="Connection lost — reconnecting">
            Bids and edits are paused. This matters most during a live auction: nothing you type reaches the server until the connection returns.
          </ValidationBanner>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
        {/* ================= GLOBAL RAIL ================= */}
        <nav
          aria-label="Global navigation"
          style={{
            width: collapsed ? 56 : 200, flexShrink: 0,
            background: color.surface, borderRight: `1px solid ${color.border}`,
            display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh',
          }}
        >
          {/* Brand block — the reference's tile, name, sign-in and tool row. */}
          <div style={{ padding: '14px 8px 10px' }}>
            <div
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: 'linear-gradient(135deg,#6C5DD3,#9B7BE6)',
                color: '#fff', display: 'grid', placeItems: 'center',
                fontSize: 13, fontWeight: 700, boxShadow: '0 1px 2px rgba(0,0,0,.15)',
              }}
            >
              B
            </div>
            {!collapsed && (
              <>
                <div style={{ fontWeight: 600, fontSize: 12, marginTop: 8 }}>Admin — Bajel</div>
                <div style={{ fontSize: 10, color: color.textSecondary }}>{state.currentUser.email}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {([
                    ['gear', 'Configuration Studio', () => onNavigate({ name: 'config' })],
                    ['search', 'Search', undefined],
                    ['logout', 'Open the vendor portal', () => dispatch({ type: 'SET_SURFACE', surface: 'PORTAL' })],
                    ['users', 'Open the employee portal', () => dispatch({ type: 'SET_SURFACE', surface: 'EMPLOYEE' })],
                    ['archive', 'Reset demo data — forget every event, approval and score created in this browser', () => {
                      if (window.confirm('Reset the demo? Every event, RFI, RFP, RFQ, approval and score created in this browser is removed, in every open tab.')) resetPersistedState();
                    }],
                  ] as const).map(
                    ([name, title, run]) => (
                      <button
                        key={name}
                        type="button"
                        title={title}
                        aria-label={title}
                        className="rfx-brandtool"
                        onClick={run}
                        disabled={!run}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', cursor: run ? 'pointer' : 'default',
                          border: `1px solid ${color.border}`, background: '#fff',
                          display: 'grid', placeItems: 'center',
                          color: run ? color.textSecondary : color.textMuted,
                        }}
                      >
                        <Icon name={name} size={11} />
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 24px' }}>
            {NAV.map((entry, i) => {
              if (entry.kind === 'section') {
                return collapsed ? null : <RailGroup key={`s${i}`}>{entry.label}</RailGroup>;
              }
              if (entry.kind === 'item') {
                return navRow(entry.label, entry.icon, {
                  active: entry.route ? isActiveRoute(entry.route) : false,
                  onClick: entry.route ? () => onNavigate(entry.route!) : undefined,
                  badge: entry.badge === 'LIVE_AUCTIONS'
                    ? (liveAuctions.length > 0 ? `${liveAuctions.length} live` : undefined)
                    : entry.badge,
                });
              }

              /**
               * A group and its children, as one block.
               *
               * The children sit in a tinted panel hanging off the group row
               * rather than being indented under it, so the relationship is
               * carried by the surface. That is what lets a selected child read
               * as selected — it lifts onto white, out of the tint.
               */
              const open = openGroups.has(entry.label);
              const holdsRoute = entry.children
                .flatMap(leavesOf)
                .some((leaf) => leaf.route && isActiveRoute(leaf.route));
              return (
                <div
                  key={entry.label}
                  className={`rfx-navgroup ${open && !collapsed ? 'open' : ''} ${holdsRoute ? 'active' : ''}`}
                >
                  {navRow(entry.label, entry.icon, {
                    onClick: () => toggleGroup(entry.label),
                    caret: open ? 'chevUp' : 'chevDown',
                    groupActive: holdsRoute,
                  })}
                  {open && !collapsed && (
                    <div className="rfx-navsub">
                      {entry.children.map((child) => {
                        /**
                         * A nested group behaves exactly like its parent —
                         * same caret, same expand, same panel one tint deeper.
                         * A selected leaf still lifts onto white at either
                         * level, so "white means you are here" holds whatever
                         * depth the row sits at.
                         */
                        if (isNested(child)) {
                          const subOpen = openGroups.has(child.label);
                          const subHolds = child.children.some(
                            (leaf) => leaf.route && isActiveRoute(leaf.route),
                          );
                          return (
                            <div
                              key={child.label}
                              className={`rfx-navgroup nested ${subOpen ? 'open' : ''} ${subHolds ? 'active' : ''}`}
                            >
                              {navLeaf({
                                label: child.label,
                                onClick: () => toggleGroup(child.label),
                                caret: subOpen ? 'chevUp' : 'chevDown',
                                strong: subHolds,
                              })}
                              {subOpen && (
                                <div className="rfx-navsub nested">
                                  {child.children.map((leaf) => navLeaf({
                                    label: leaf.label,
                                    route: leaf.route,
                                    badge: leaf.badge,
                                    on: !!leaf.route && isActiveRoute(leaf.route),
                                  }))}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return navLeaf({
                          label: child.label,
                          route: child.route,
                          badge: child.badge,
                          on: !!child.route && isActiveRoute(child.route),
                        });
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ padding: 8, borderTop: `1px solid ${color.border}` }}>
            <Button variant="tertiary" size="small" onClick={() => setCollapsed((v) => !v)} style={{ width: '100%' }}>
              {collapsed ? '›' : '‹ Collapse'}
            </Button>
          </div>
        </nav>

        {/* ================= MAIN ================= */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Live auction ticker — always reachable from anywhere. */}
          {liveAuctions.length > 0 && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: '#450A0A', color: '#FCA5A5',
                padding: '7px 16px', fontSize: 12,
              }}
            >
              <span aria-hidden style={{ animation: 'rfx-pulse 1.2s infinite' }}>●</span>
              <strong style={{ color: '#fff' }}>
                {liveAuctions.length} auction{liveAuctions.length > 1 ? 's' : ''} live
              </strong>
              {liveAuctions.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onNavigate({ name: 'event', eventId: event.id, tab: 'Auction' })}
                  style={{
                    border: '1px solid #7F1D1D', background: 'transparent', color: '#FCA5A5',
                    borderRadius: radius.pill, padding: '2px 10px', fontSize: 11,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {event.eventNumber} →
                </button>
              ))}
            </div>
          )}

          {/* The reference's page head: a sticky 56px bar, 16px title, crumbs
              under it. Deliberately quieter than the old 22px heading — the
              screen's own content is what should carry the weight. */}
          <header
            ref={headRef}
            style={{
              background: color.surface, borderBottom: `1px solid ${color.border}`,
              padding: '12px 24px', minHeight: 56,
              position: 'sticky', top: 0, zIndex: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h1>
                {breadcrumb && (
                  <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 3 }}>{breadcrumb}</div>
                )}
                {subtitle && (
                  <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3 }}>{subtitle}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {primaryAction}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((v) => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${color.border}`,
                      background: '#fff', borderRadius: radius.pill, padding: '4px 10px 4px 4px', cursor: 'pointer',
                    }}
                  >
                    <Avatar initials={state.currentUser.initials} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{state.currentUser.name}</span>
                    <span aria-hidden style={{ fontSize: 9, color: color.textMuted }}>▾</span>
                  </button>
                  {userMenuOpen && (
                    <div
                      style={{
                        position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 300,
                        background: '#fff', border: `1px solid ${color.border}`,
                        borderRadius: radius.card, boxShadow: '0 12px 32px rgba(17,24,39,.14)',
                        minWidth: 250, padding: 8,
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: color.textSecondary, padding: '4px 8px' }}>
                        Switch persona
                      </div>
                      {USERS.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="rfx-navrow"
                          onClick={() => { dispatch({ type: 'SET_USER', userId: user.id }); setUserMenuOpen(false); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', border: 'none',
                            background: user.id === state.currentUser.id ? color.brandPrimarySoft : 'transparent',
                            borderRadius: radius.control, padding: '6px 8px', cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{user.name}</span>
                          <span style={{ display: 'block', fontSize: 11, color: color.textSecondary }}>{user.role}</span>
                        </button>
                      ))}
                      <div className="rfx-stack" style={{ borderTop: `1px solid ${color.border}`, marginTop: 6, paddingTop: 6, gap: 6 }}>
                        <Button size="small" variant="secondary" onClick={() => dispatch({ type: 'TOGGLE_CONNECTION' })}>
                          {state.connectionLost ? 'Restore connection' : 'Simulate connection loss'}
                        </Button>
                        <Button
                          size="small"
                          variant={state.agentKillSwitch.engaged ? 'secondary' : 'destructive'}
                          onClick={() =>
                            state.agentKillSwitch.engaged
                              ? dispatch({ type: 'RELEASE_KILL_SWITCH' })
                              : dispatch({ type: 'ENGAGE_KILL_SWITCH', by: state.currentUser.name })
                          }
                        >
                          {state.agentKillSwitch.engaged ? 'Release kill switch' : 'Engage agent kill switch'}
                        </Button>
                        <Button size="small" variant="secondary" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'PORTAL' })}>
                          Open vendor portal →
                        </Button>
                        <Button size="small" variant="secondary" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'EMPLOYEE' })}>
                          Open employee portal →
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          {stageRail}
          {tabs}

          <main style={{ padding: '18px 24px 40px', flex: 1, minWidth: 0 }}>{children}</main>
        </div>
      </div>
    </div>
  );
}

function RailGroup({ children, indent }: { children: React.ReactNode; indent?: boolean }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 500, color: color.textMuted,
        padding: `12px ${indent ? 22 : 8}px 4px`,
      }}
    >
      {children}
    </div>
  );
}
