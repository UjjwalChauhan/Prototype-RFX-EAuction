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
import { ValidationBanner } from '../design-system/components/domain';
import { useStore } from '../store/store';
import { USERS } from '../data/seed';

export type Route =
  | { name: 'board' }
  | { name: 'intake' }
  | { name: 'create' }
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

const SOURCING_ROUTES = ['board', 'intake', 'create', 'event', 'list'];

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
  const [procOpen, setProcOpen] = React.useState(true);
  const [sourcingOpen, setSourcingOpen] = React.useState(true);
  const [rfxOpen, setRfxOpen] = React.useState(true);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);

  const liveAuctions = state.events.filter((e) => e.status === 'AUCTION_LIVE');
  const showSectionRail = SOURCING_ROUTES.includes(route.name);

  const isActive = (candidate: Route['name'], extra?: string) => {
    if (route.name !== candidate) return false;
    if (candidate === 'list' && extra) return (route as { stage: string }).stage === extra;
    return true;
  };

  const navRow = (
    label: string,
    icon: string,
    opts: { active?: boolean; onClick?: () => void; badge?: string; indent?: number; caret?: string } = {},
  ) => (
    <button
      key={label}
      type="button"
      className="rfx-navrow"
      onClick={opts.onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', cursor: opts.onClick ? 'pointer' : 'default',
        padding: `7px 10px 7px ${10 + (opts.indent ?? 0) * 14}px`,
        background: opts.active ? color.brandPrimarySoft : 'transparent',
        color: opts.active ? color.brandPrimary : color.textBody,
        fontWeight: opts.active ? 600 : 400, fontSize: 12.5, borderRadius: radius.control,
      }}
    >
      <span aria-hidden style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{label}</span>}
      {!collapsed && opts.badge && <Chip tone="brand">{opts.badge}</Chip>}
      {!collapsed && opts.caret && <span aria-hidden style={{ fontSize: 9, color: color.textMuted }}>{opts.caret}</span>}
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
            width: collapsed ? 56 : 210, flexShrink: 0,
            background: color.surface, borderRight: `1px solid ${color.border}`,
            display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh',
          }}
        >
          <div style={{ padding: '12px 10px', borderBottom: `1px solid ${color.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 26, height: 26, borderRadius: 6, background: color.textPrimary,
                  color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}
              >
                U
              </span>
              {!collapsed && (
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>udaan</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: color.textSecondary }}>
                    Admin platform
                  </span>
                </span>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {navRow('Dashboard', '▦', { active: false, onClick: () => onNavigate({ name: 'board' }) })}

            {!collapsed && <RailGroup>Hierarchy & enforcement</RailGroup>}
            {navRow('Configuration Studio', '⚙', { active: isActive('config'), onClick: () => onNavigate({ name: 'config' }) })}
            {navRow('DoA & Agent Console', '✦', { active: isActive('agents'), onClick: () => onNavigate({ name: 'agents' }) })}
            {navRow('Approval Requests', '✓', {
              active: isActive('approvals'),
              onClick: () => onNavigate({ name: 'approvals' }),
              badge: '7',
            })}

            {!collapsed && <RailGroup>AP & procurement</RailGroup>}
            {navRow('Procurement', '🛒', { onClick: () => setProcOpen((v) => !v), caret: procOpen ? '▾' : '▸' })}
            {procOpen && !collapsed && (
              <>
                {navRow('Purchase Request', '▤', { indent: 1 })}
                {navRow('Sourcing', '◈', {
                  indent: 1,
                  onClick: () => setSourcingOpen((v) => !v),
                  caret: sourcingOpen ? '▾' : '▸',
                })}
                {sourcingOpen && (
                  <>
                    {navRow('Sourcing Board', '·', { indent: 2, active: isActive('board'), onClick: () => onNavigate({ name: 'board' }) })}
                    {navRow('Intake / PR Workbench', '·', { indent: 2, active: isActive('intake'), onClick: () => onNavigate({ name: 'intake' }) })}
                    {navRow('Create Event', '＋', { indent: 2, active: isActive('create'), onClick: () => onNavigate({ name: 'create' }) })}
                  </>
                )}

                {/* RFI/RFP/RFQ are shortcuts into one object, not separate objects. */}
                <RailGroup indent>Shortcuts</RailGroup>
                {navRow('RFX', '↗', { indent: 1, onClick: () => setRfxOpen((v) => !v), caret: rfxOpen ? '▾' : '▸' })}
                {rfxOpen && (
                  <>
                    {navRow('Request for Information', '·', { indent: 2, active: isActive('list', 'RFI'), onClick: () => onNavigate({ name: 'list', stage: 'RFI' }) })}
                    {navRow('Request for Proposal', '·', { indent: 2, active: isActive('list', 'RFP'), onClick: () => onNavigate({ name: 'list', stage: 'RFP' }) })}
                    {navRow('Request for Quotation', '·', { indent: 2, active: isActive('list', 'RFQ'), onClick: () => onNavigate({ name: 'list', stage: 'RFQ' }) })}
                  </>
                )}
                {navRow('E-Auction', '↗', {
                  indent: 1,
                  active: isActive('list', 'AUCTION'),
                  onClick: () => onNavigate({ name: 'list', stage: 'AUCTION' }),
                  badge: liveAuctions.length > 0 ? `${liveAuctions.length} live` : undefined,
                })}
                {navRow('Purchase Order', '▥', { indent: 1 })}
                {navRow('Vendor Catalog', '▣', { indent: 1 })}
              </>
            )}
            {navRow('Contract Management', '▦', {})}
            {navRow('Vendor Management', '⚑', {})}
          </div>

          <div style={{ padding: 8, borderTop: `1px solid ${color.border}` }}>
            <Button variant="tertiary" size="small" onClick={() => setCollapsed((v) => !v)} style={{ width: '100%' }}>
              {collapsed ? '›' : '‹ Collapse'}
            </Button>
          </div>
        </nav>

        {/* ================= SECTION RAIL ================= */}
        {showSectionRail && (
          <nav
            aria-label="Sourcing"
            style={{
              width: 172, flexShrink: 0, background: '#FCFCFD',
              borderRight: `1px solid ${color.border}`, padding: 10,
              position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em',
                textTransform: 'uppercase', color: color.textSecondary, padding: '4px 8px 8px',
              }}
            >
              Sourcing
            </div>
            {[
              { label: 'Sourcing Board', route: { name: 'board' } as Route, active: isActive('board') },
              { label: 'Intake', route: { name: 'intake' } as Route, active: isActive('intake') },
              { label: 'Create Event', route: { name: 'create' } as Route, active: isActive('create') },
              { label: 'RFIs', route: { name: 'list', stage: 'RFI' } as Route, active: isActive('list', 'RFI') },
              { label: 'RFPs', route: { name: 'list', stage: 'RFP' } as Route, active: isActive('list', 'RFP') },
              { label: 'RFQs', route: { name: 'list', stage: 'RFQ' } as Route, active: isActive('list', 'RFQ') },
              { label: 'E-Auctions', route: { name: 'list', stage: 'AUCTION' } as Route, active: isActive('list', 'AUCTION') },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className="rfx-navrow"
                onClick={() => onNavigate(item.route)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  cursor: 'pointer', padding: '7px 9px', borderRadius: radius.control,
                  fontSize: 12.5, fontWeight: item.active ? 600 : 400,
                  background: item.active ? color.brandPrimarySoft : 'transparent',
                  color: item.active ? color.brandPrimary : color.textSecondary,
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}

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

          <header
            style={{
              background: color.surface, borderBottom: `1px solid ${color.border}`,
              padding: '13px 20px',
            }}
          >
            {breadcrumb && (
              <div style={{ fontSize: 11.5, color: color.textSecondary, marginBottom: 5 }}>{breadcrumb}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h1>
                {subtitle && (
                  <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 3 }}>{subtitle}</div>
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
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          {stageRail}
          {tabs}

          <main style={{ padding: 20, flex: 1, minWidth: 0 }}>{children}</main>
        </div>
      </div>
    </div>
  );
}

function RailGroup({ children, indent }: { children: React.ReactNode; indent?: boolean }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
        color: color.textMuted, padding: `10px ${indent ? 24 : 10}px 4px`,
      }}
    >
      {children}
    </div>
  );
}
