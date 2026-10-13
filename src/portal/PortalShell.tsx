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
import { portal, portalRadius } from './portalTheme';
import { PortalNav, type PortalRoute } from './PortalNav';
import { Button } from '../design-system/components/primitives';
import { auctionsForBidder, useStore } from '../store/store';
import { COUNTERPARTIES } from '../data/seed';
import { PortalDashboard } from './PortalDashboard';
import { PortalEventWorkspace } from './PortalEventWorkspace';
import { BiddingConsole } from './BiddingConsole';
import { PortalOutcome } from './PortalOutcome';
import { PortalRequests, activeCounts } from './PortalRequests';
import {
  REQUEST_POINTS, defaultCounterparty, vendorSections, type VendorSection,
} from '../domain/vendorPortal';
import { serverNow } from '../server/clock';
import { rehearsalOpen } from '../domain/auctionRehearsal';

export type { PortalRoute };

/** Portal density: 16px body, 56px rows, two nav levels at most. */
const PORTAL_BODY = 15;

/**
 * Rows the reference navigation carries that this build has no screen for.
 * They stay in the rail — the nav is the supplier's map of the account, and a
 * map with holes in it is worse than one that says "not here yet" — but each
 * one lands on a page that admits it rather than on an empty screen.
 */
const NOT_BUILT: Partial<Record<PortalRoute, { heading: string; blurb: string }>> = {
  invoices: {
    heading: 'Invoices',
    blurb: 'Invoices you have raised against this buyer, and where each one sits in their approval run.',
  },
  inputs: {
    heading: 'Inputs',
    blurb: 'Master data this buyer holds about you — bank details, tax registrations, remittance addresses.',
  },
  'credit-note': {
    heading: 'Credit Note',
    blurb: 'Credits raised against invoices already submitted, and what they have been set against.',
  },
  'ask-advance': {
    heading: 'Ask Advance',
    blurb: 'Request an advance against a confirmed order, and follow the request through approval.',
  },
  ticketing: {
    heading: 'Ticketing',
    blurb: 'Queries you have raised with the buyer\u2019s sourcing desk, with the thread on each one.',
  },
  settlements: {
    heading: 'Settlements',
    blurb: 'Payments made and payments due, with the invoices each settlement covers.',
  },
  notifications: {
    heading: 'Notifications',
    blurb: 'Everything this buyer has told you \u2014 invitations, clarifications, deadline changes and outcomes.',
  },
};

export function PortalShell({ standalone = false }: { standalone?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const [route, setRoute] = React.useState<PortalRoute>('home');
  /**
   * Which room the supplier walked into.
   *
   * Left unset when they reach the console from the rail rather than from an
   * offer, and the console then picks the most urgent auction they are in —
   * which is the right answer when they have only one, and it offers a
   * switcher when they have more.
   */
  const [auctionEventId, setAuctionEventId] = React.useState<string | undefined>(undefined);

  /**
   * Which supplier is signed in. In the real product this comes from the
   * session; here it is switchable so one browser can check what each invited
   * supplier actually sees.
   */
  const [chosenId, setChosenId] = React.useState<string | null>(null);

  /**
   * Until the supplier picks a company, follow the work: open as whoever this
   * buyer has actually invited. A newly published event otherwise looks missing
   * simply because the portal was signed in as a company not on its shortlist.
   */
  const counterpartyId = chosenId ?? defaultCounterparty({
    events: state.events,
    bidders: state.bidders,
    responses: state.responses,
    counterparties: COUNTERPARTIES,
    preferred: 'cp-abc',
    now: serverNow(),
  });
  const setCounterpartyId = setChosenId;

  const counterparty = COUNTERPARTIES.find((c) => c.id === counterpartyId);

  const sections = vendorSections({
    events: state.events, bidders: state.bidders, responses: state.responses,
    counterpartyId, now: serverNow(),
  });
  const counts = activeCounts(sections);
  // Any auction this supplier is actually in — not "the" auction, since the
  // tenant runs several at once and they are rarely the same mechanism.
  const myAuctions = auctionsForBidder(state, counterpartyId);
  const liveForMe = myAuctions.filter(
    (h) => h.auction.status === 'LIVE' || h.auction.status === 'EXTENDED',
  );
  /**
   * Rooms worth walking into — the live ones, and the ones whose buyer has
   * the practice run open. A rehearsal nobody knows about is a rehearsal
   * nobody uses, and the supplier who most needs it is the one who would
   * never think to go looking.
   */
  const callingMe = myAuctions.filter(
    (h) => h.auction.status === 'LIVE' || h.auction.status === 'EXTENDED'
      || rehearsalOpen(h.controlEvents),
  );

  /**
   * Counts on rail rows. Every disc is a real number this portal can defend —
   * the same figure the section it sits on would show if you opened it.
   */
  const badges: Partial<Record<PortalRoute, number>> = {
    requests: counts.requests,
    offers: counts.auctions,
    bidding: callingMe.length,
    orders: liveForMe.length,
  };

  /** Every supplier this sign-in can act for, as the switcher column. */
  const workspaces = COUNTERPARTIES.map((c) => ({ id: c.id, name: c.name }));

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

      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
        <PortalNav
          route={route}
          onNavigate={setRoute}
          workspaces={workspaces}
          activeWorkspaceId={counterpartyId}
          onSwitchWorkspace={setCounterpartyId}
          badges={badges}
          onSignOut={standalone ? undefined : () => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}
        />

        {/* ================= CONTENT ================= */}
        <div
          style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
            background: portal.page,
          }}
        >
          <main style={{ flex: 1, maxWidth: 1240, width: '100%', padding: '46px 56px' }}>
            {route === 'home' && (
              <PortalHome
                counterparty={counterparty}
                sections={sections}
                onNavigate={setRoute}
              />
            )}
            {route === 'requests' && (
              <PortalRequests
                counterpartyId={counterpartyId}
                points={REQUEST_POINTS}
                heading="Requests"
                blurb="Everything this buyer has asked you for. Active is waiting on you; Past is what you have already dealt with."
              />
            )}
            {(route === 'offers' || route === 'auctions') && (
              <PortalRequests
                counterpartyId={counterpartyId}
                points={['AUCTION']}
                heading="Offers"
                blurb="Live events where the offer you put in competes in real time. Anything not asked before an auction opens cannot be asked during it."
                onEnterAuction={(eventId) => { setAuctionEventId(eventId); setRoute('bidding'); }}
              />
            )}
            {(route === 'report' || route === 'dashboard') && <PortalDashboard onNavigate={setRoute} />}
            {route === 'event' && <PortalEventWorkspace onNavigate={setRoute} />}
            {route === 'bidding' && (
              <BiddingConsole counterpartyId={counterpartyId} eventId={auctionEventId} />
            )}
            {(route === 'orders' || route === 'outcome') && <PortalOutcome />}
            {route === 'profile' && <CompanyProfile counterpartyId={counterpartyId} />}
            {route === 'settings' && (
              <PortalSettings
                counterpartyId={counterpartyId}
                onSwitch={setCounterpartyId}
                standalone={standalone}
                onBackToAdmin={() => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}
              />
            )}
            {NOT_BUILT[route] && (
              <SectionPlaceholder heading={NOT_BUILT[route]!.heading} blurb={NOT_BUILT[route]!.blurb} />
            )}
          </main>

          <footer
            style={{
              maxWidth: 1240, padding: '20px 56px 44px',
              fontSize: 13, color: portal.muted, borderTop: `1px solid ${portal.border}`,
            }}
          >
            Need help? Call the buyer's sourcing desk on the number in your invitation email, or reply to
            it — a person answers.
          </footer>
        </div>
      </div>
    </div>
  );
}

/**
 * The landing page.
 *
 * Laid out as the portal design lays it out: a greeting, the company the
 * supplier is signed in as, and a single metrics card — one headline figure
 * over a row of counters divided by hairlines, each with its own colour chip.
 *
 * The counters are the sections of this portal rather than invented measures,
 * so every number on this page is the same number the section it names would
 * show if you opened it.
 */
function PortalHome({
  counterparty, sections, onNavigate,
}: {
  counterparty: { name: string; contactEmail: string; categoriesServed: string[]; locationsServed: string[] } | undefined;
  sections: VendorSection[];
  onNavigate: (route: PortalRoute) => void;
}) {
  const waiting = sections.reduce((n, s) => n + s.active.length, 0);
  const submitted = sections.reduce(
    (n, s) => n + s.past.filter((i) => i.submittedAt !== null).length, 0,
  );

  /**
   * The counters.
   *
   * The named asks always show, so the row does not change shape as work
   * arrives. The other points a supplier can be asked at — a quote request at
   * intake, a negotiation round — appear only when they actually hold
   * something, rather than standing at zero for every supplier forever.
   */
  const tiles: { label: string; value: number; route: PortalRoute }[] = [
    ...sections
      .filter(
        (section) =>
          REQUEST_POINTS.includes(section.point)
          || section.point === 'AUCTION'
          || section.active.length + section.past.length > 0,
      )
      .map((section) => ({
        label: section.point === 'AUCTION' ? 'Auctions' : `${section.point} Requests`,
        value: section.active.length,
        route: (section.point === 'AUCTION' ? 'auctions' : 'requests') as PortalRoute,
      })),
    { label: 'Submitted', value: submitted, route: 'requests' as PortalRoute },
  ];

  return (
    <div className="rfx-stack" style={{ gap: 0 }}>
      <div style={{ fontSize: 17, color: portal.label, marginBottom: 4 }}>
        Hi, {counterparty?.name ?? 'Supplier'}
      </div>
      <h1
        style={{
          margin: 0, fontSize: 46, fontWeight: 700, letterSpacing: '-0.02em',
          color: portal.heading, lineHeight: 1.1,
        }}
      >
        Welcome Back
      </h1>

      {counterparty && (
        <div style={{ marginTop: 34 }}>
          <div
            style={{
              fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em',
              color: portal.heading,
            }}
          >
            {counterparty.name}
          </div>
          <div style={{ fontSize: 15, color: portal.muted, lineHeight: 1.6, marginTop: 6 }}>
            <div>{counterparty.contactEmail}</div>
            <div>Categories: {counterparty.categoriesServed.join(', ')}</div>
            <div>Serving: {counterparty.locationsServed.join(', ')}</div>
          </div>
        </div>
      )}

      <section
        style={{
          marginTop: 38, background: portal.card,
          border: `1px solid ${portal.border}`, borderRadius: portalRadius.card,
          padding: '30px 34px 34px',
          boxShadow: '0 1px 2px rgba(17,24,39,.03)',
        }}
      >
        <h2
          style={{
            margin: '0 0 26px', fontSize: 26, fontWeight: 700,
            letterSpacing: '-0.01em', color: portal.heading,
          }}
        >
          Workspace Metrics
        </h2>

        <div style={{ maxWidth: 200, marginBottom: 30 }}>
          <div
            style={{
              fontSize: 44, fontWeight: 600, color: portal.heading, lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {waiting}
          </div>
          <div style={{ fontSize: 13.5, color: portal.faint, margin: '10px 0 12px' }}>
            Requests waiting on you
          </div>
          <div style={{ height: 1, background: portal.border }} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))',
          }}
        >
          {tiles.map((tile, i) => (
            <button
              key={tile.label}
              type="button"
              onClick={() => onNavigate(tile.route)}
              style={{
                textAlign: 'left', cursor: 'pointer', background: 'transparent',
                border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${portal.border}`,
                padding: i === 0 ? '4px 26px 4px 0' : '4px 26px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span
                  aria-hidden
                  style={{
                    width: 13, height: 13, borderRadius: portalRadius.chip,
                    background: portal.chips[i % portal.chips.length], flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13.5, color: portal.muted }}>{tile.label}</span>
              </div>
              <div
                style={{
                  fontSize: 34, fontWeight: 600, color: portal.heading,
                  margin: '14px 0 14px', lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tile.value}
              </div>
              <div style={{ height: 1, background: portal.border }} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack 24 — company profile
// ---------------------------------------------------------------------------

function CompanyProfile({ counterpartyId }: { counterpartyId: string }) {
  const counterparty = COUNTERPARTIES.find((c) => c.id === counterpartyId);
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

/**
 * A section the rail offers but this build does not carry yet. It says so
 * plainly rather than showing an empty table — a supplier who cannot tell
 * "nothing here" from "nothing yet" assumes the platform lost their work.
 */
function SectionPlaceholder({ heading, blurb }: { heading: string; blurb: string }) {
  return (
    <div className="rfx-stack" style={{ gap: 18, maxWidth: 720 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.015em', color: portal.heading }}>
          {heading}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: portal.muted, lineHeight: 1.6 }}>{blurb}</p>
      </div>
      <PortalCard>
        <div style={{ fontSize: 15, color: portal.label }}>Nothing to show here yet.</div>
        <div style={{ fontSize: 14, color: portal.muted, marginTop: 6, lineHeight: 1.6 }}>
          This part of your account is not switched on for this buyer. Requests, Offers and Orders are
          where your work with them sits today.
        </div>
      </PortalCard>
    </div>
  );
}

/** Who you are signed in as, and — in the combined build — the way back. */
function PortalSettings({
  counterpartyId, onSwitch, standalone, onBackToAdmin,
}: {
  counterpartyId: string;
  onSwitch: (id: string) => void;
  standalone: boolean;
  onBackToAdmin: () => void;
}) {
  return (
    <div className="rfx-stack" style={{ gap: 18, maxWidth: 620 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.015em', color: portal.heading }}>
          Settings
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: portal.muted, lineHeight: 1.6 }}>
          The workspace you are acting for. Switching here is the same as picking a company in the
          left-hand column.
        </p>
      </div>

      <PortalCard title="Signed in as">
        <select
          aria-label="Signed in as"
          value={counterpartyId}
          onChange={(e) => onSwitch(e.target.value)}
          style={{
            width: '100%', border: `1px solid ${portal.border}`,
            borderRadius: portalRadius.row, padding: '11px 13px', fontSize: 15,
            background: '#fff', color: portal.label,
          }}
        >
          {COUNTERPARTIES.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {!standalone && (
          <div style={{ marginTop: 14 }}>
            <Button variant="secondary" size="small" onClick={onBackToAdmin}>
              \u2190 Buyer platform
            </Button>
          </div>
        )}
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
