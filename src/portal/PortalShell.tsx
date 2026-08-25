/**
 * Packs 10–12 and 24 — the vendor portal.
 *
 * A separate application: its own shell, top nav, airy density, the buying
 * organisation's brand, and plain language only. No admin chrome leaks in, and
 * nothing in the admin platform is reachable from here.
 *
 * The supplier experience is half the product — a platform buyers love and
 * suppliers hate produces low participation and bad prices.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button } from '../design-system/components/primitives';
import { useStore } from '../store/store';
import { COUNTERPARTIES, PORTAL_BIDDER_ID } from '../data/seed';
import { PortalDashboard } from './PortalDashboard';
import { PortalEventWorkspace } from './PortalEventWorkspace';
import { BiddingConsole } from './BiddingConsole';
import { PortalOutcome } from './PortalOutcome';

export type PortalRoute = 'dashboard' | 'event' | 'bidding' | 'outcome' | 'profile';

/** Portal density: 16px body, 56px rows, two nav levels at most. */
const PORTAL_BODY = 15;

export function PortalShell() {
  const { state, dispatch } = useStore();
  const [route, setRoute] = React.useState<PortalRoute>('dashboard');

  const bidder = state.bidders.find((b) => b.id === PORTAL_BIDDER_ID);
  const counterparty = COUNTERPARTIES.find((c) => c.id === bidder?.counterpartyId);
  const auctionLive = state.auction.auction.status === 'LIVE' || state.auction.auction.status === 'EXTENDED';

  /** Named by what the supplier does, never by the buyer's stage names. */
  const nav: { id: PortalRoute; label: string; badge?: string }[] = [
    { id: 'dashboard', label: 'My tasks' },
    { id: 'event', label: 'Office Supplies Annual Contract' },
    { id: 'bidding', label: 'Bid live', badge: auctionLive ? 'live now' : undefined },
    { id: 'outcome', label: 'Outcomes' },
    { id: 'profile', label: 'Company profile' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#FBFCFE', fontSize: PORTAL_BODY }}>
      {state.connectionLost && (
        <div
          role="alert"
          style={{
            background: '#7F1D1D', color: '#FEE2E2', padding: '10px 20px',
            fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}
        >
          <span aria-hidden style={{ animation: 'rfx-pulse 1s infinite' }}>⚡</span>
          <strong>You are offline.</strong>
          Nothing you enter is reaching us right now. We will reconcile your position the moment you
          reconnect — but a bid placed while offline is not a bid.
        </div>
      )}

      {/* Top nav, airy, buyer's brand. */}
      <header style={{ background: '#fff', borderBottom: `1px solid ${color.border}` }}>
        <div
          style={{
            maxWidth: 1180, margin: '0 auto', padding: '14px 24px',
            display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 30, height: 30, borderRadius: 7, background: color.brandPrimary,
                color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
              }}
            >
              U
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>udaan</span>
              <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary }}>
                Supplier portal
              </span>
            </span>
          </div>

          <nav style={{ display: 'flex', gap: 4, marginLeft: 12, flexWrap: 'wrap' }}>
            {nav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRoute(item.id)}
                style={{
                  border: 'none', background: route === item.id ? color.brandPrimarySoft : 'transparent',
                  color: route === item.id ? color.brandPrimary : color.textBody,
                  borderRadius: radius.pill, padding: '8px 15px', cursor: 'pointer',
                  fontSize: 14, fontWeight: route === item.id ? 600 : 400,
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                }}
              >
                {item.label}
                {item.badge && (
                  <span
                    style={{
                      background: color.dangerSoft, color: color.dangerText,
                      borderRadius: radius.pill, padding: '1px 8px',
                      fontSize: 10.5, fontWeight: 700,
                      animation: 'rfx-pulse 1.4s infinite',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ textAlign: 'right' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                {counterparty?.name ?? 'Supplier'}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary }}>
                {counterparty?.contactEmail}
              </span>
            </span>
            <Button variant="secondary" size="small" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}>
              ← Buyer platform
            </Button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px' }}>
        {route === 'dashboard' && <PortalDashboard onNavigate={setRoute} />}
        {route === 'event' && <PortalEventWorkspace onNavigate={setRoute} />}
        {route === 'bidding' && <BiddingConsole />}
        {route === 'outcome' && <PortalOutcome />}
        {route === 'profile' && <CompanyProfile />}
      </main>

      <footer
        style={{
          maxWidth: 1180, margin: '0 auto', padding: '18px 24px 40px',
          fontSize: 12.5, color: color.textSecondary, borderTop: `1px solid ${color.border}`,
        }}
      >
        Need help? Call the buyer's sourcing desk on the number in your invitation email, or reply to
        it — a person answers.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack 24 — company profile
// ---------------------------------------------------------------------------

function CompanyProfile() {
  const { state } = useStore();
  const bidder = state.bidders.find((b) => b.id === PORTAL_BIDDER_ID);
  const counterparty = COUNTERPARTIES.find((c) => c.id === bidder?.counterpartyId);
  if (!counterparty) return null;

  return (
    <div className="rfx-stack" style={{ gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{counterparty.name}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14.5, color: color.textSecondary }}>
          Keeping this current means you are considered for more opportunities.
        </p>
      </div>

      <PortalCard title="Your rating with this buyer">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 14 }}>
          <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px' }}>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>Qualification</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: color.infoText, marginTop: 4 }}>
              {counterparty.onboardingRating}
            </div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
              Based on your documents, categories and locations. You can improve this by keeping
              certificates current.
            </div>
          </div>
          <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, padding: '14px 16px' }}>
            <div style={{ fontSize: 12.5, color: color.textSecondary }}>Performance</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: color.accentPurpleText, marginTop: 4 }}>
              {counterparty.performanceRating}
            </div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
              Based on how past orders went — responsiveness, delivery and quality.
            </div>
          </div>
        </div>
      </PortalCard>

      <PortalCard title="Certificates">
        <div className="rfx-stack" style={{ gap: 12 }}>
          {[
            { name: 'ISO 9001', expires: 'March 2027', warn: false },
            { name: 'FSC chain of custody', expires: 'November 2026', warn: false },
            { name: 'Trade licence', expires: 'in 21 days', warn: true },
          ].map((certificate) => (
            <div
              key={certificate.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                border: `1px solid ${certificate.warn ? '#FCD34D' : color.border}`,
                background: certificate.warn ? color.warningSoft : '#fff',
                borderRadius: radius.card, padding: '14px 16px',
              }}
            >
              <span aria-hidden style={{ fontSize: 18 }}>{certificate.warn ? '⚠' : '✓'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{certificate.name}</span>
                <span
                  style={{
                    display: 'block', fontSize: 13,
                    color: certificate.warn ? color.warningText : color.textSecondary, marginTop: 2,
                  }}
                >
                  {certificate.warn ? `Expires ${certificate.expires} — renew it to stay eligible` : `Valid until ${certificate.expires}`}
                </span>
              </span>
              <Button variant={certificate.warn ? 'primary' : 'secondary'}>
                {certificate.warn ? 'Upload renewal' : 'Replace'}
              </Button>
            </div>
          ))}
        </div>
      </PortalCard>
    </div>
  );
}

export function PortalCard({
  title, hint, children, action, tone,
}: {
  title?: string; hint?: string; children: React.ReactNode;
  action?: React.ReactNode; tone?: 'default' | 'urgent';
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${tone === 'urgent' ? '#FCA5A5' : color.border}`,
        borderRadius: 10, padding: 20,
      }}
    >
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 }}>
          <div>
            {title && <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>}
            {hint && <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>{hint}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
