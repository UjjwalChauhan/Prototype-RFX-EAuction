/**
 * Keeping the two applications in step.
 *
 * The buyer's platform and the supplier's portal are separate origins, so they
 * share no browser storage and cannot see each other's state. `sync-server.mjs`
 * holds the shared half; this hook is how each side talks to it.
 *
 * Ownership is split rather than merged, which is what keeps this honest
 * without a conflict-resolution story: the buyer pushes events, lots, lines,
 * terms, invitations and questionnaires and pulls responses; the supplier does
 * the reverse. Neither side ever receives its own writes back, so a slow poll can
 * never clobber something the user just typed.
 *
 * The address is a path rather than a host. The buyer's dev server holds the
 * shared document at `/__sync` and the portal's proxies the same path to it,
 * so both applications call their own origin and neither needs a port for the
 * other. Point them somewhere else with VITE_SYNC_URL when the seam is running
 * as a server of its own.
 *
 * Polling rather than sockets is deliberate. A prototype that reconnects
 * cleanly after the server restarts is worth more than one that pushes a
 * change three hundred milliseconds sooner.
 */
import React from 'react';
import {
  allBids, auctionSyncRows, participationRows, rehearsalActivityRows, useStore,
  type AuctionSyncRow, type ParticipationRow, type RehearsalActivityRow,
} from './store';
import type {
  Bid, EventBidder, LineItem, Lot, Questionnaire, Response, SourcingEvent,
} from '../domain/types';
import type { TermsDocument } from '../domain/terms';

export type SyncRole = 'admin' | 'vendor';

export const SYNC_URL =
  (import.meta.env?.VITE_SYNC_URL as string | undefined) ?? '/__sync';

const POLL_MS = 1_500;

/**
 * Which tab this is.
 *
 * The seam records what each client last sent so the client can check it
 * landed. That record has to be per tab: keyed by side, a second tab of the
 * same application overwrote the first tab's, the first read that as a failed
 * push and sent again, and the two re-sent identical documents at each other
 * for as long as both were open.
 */
const CLIENT_ID = `c-${Math.random().toString(36).slice(2, 10)}`;

export type SyncStatus = 'connecting' | 'live' | 'offline';

/** The same cheap hash the seam computes, over the same bytes. */
function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
}

interface ServerState {
  version: number;
  /** What each client last sent, hashed, keyed by client. */
  hashes?: Record<string, string>;
  /**
   * Whether each side has ever written its half.
   *
   * "The buyer has published nothing" and "the buyer's platform is not running
   * yet" are the same empty array over the wire, and applying the second one
   * blanks a portal that was showing perfectly good data a moment earlier.
   */
  present?: { admin: boolean; vendor: boolean };
  events: SourcingEvent[];
  lots: Lot[];
  lineItems: LineItem[];
  termsDocuments: TermsDocument[];
  bidders: EventBidder[];
  questionnaires: Questionnaire[];
  auctions: AuctionSyncRow[];
  responses: Response[];
  bids: Bid[];
  participation: ParticipationRow[];
  rehearsalActivity: RehearsalActivityRow[];
}

/**
 * Sync this application with the other one.
 *
 * Returns the connection's standing so a shell can say plainly whether what is
 * on screen is current — a portal that silently shows stale events is worse
 * than one that admits it is offline.
 */
export function useSync(role: SyncRole): SyncStatus {
  const { state, dispatch } = useStore();
  const [status, setStatus] = React.useState<SyncStatus>('connecting');

  // What this side owns and therefore publishes.
  const owned = role === 'admin'
    ? {
        events: state.events,
        lots: state.lots,
        lineItems: state.lineItems,
        termsDocuments: state.termsDocuments,
        bidders: state.bidders,
        questionnaires: state.questionnaires,
        // An auction is published by the buyer and read by the supplier. Its
        // roster and lot details are not sent: they are already on the wire as
        // `bidders` and `lots`.
        auctions: auctionSyncRows(state),
      }
    : {
      responses: state.responses,
      // The one thing a supplier writes into an auction. Merged into the
      // buyer's ledger by id, never replacing it.
      bids: allBids(state),
      // Whether a supplier has opened an ask or answered it. The invitation
      // row is the buyer's; this one fact about it is only knowable here.
      participation: participationRows(state),
      // Who has tried the practice run, and how it went for them. Counts
      // only — a practice price never crosses this seam, because a rehearsal
      // the buyer can read the figures of is not a rehearsal.
      rehearsalActivity: rehearsalActivityRows(state),
    };

  const serialised = JSON.stringify(owned);
  const lastPushed = React.useRef<string | null>(null);
  const lastVersion = React.useRef<number>(-1);
  /**
   * Bumped when the sync server is found to have restarted, to force this side
   * to send its half again. Without it a restarted server stays empty until
   * something happens to change local state, and the other application sits
   * looking at nothing while both are plainly running.
   */
  const [resendNonce, setResendNonce] = React.useState(0);
  // Read by the poll, which must not restart every time local state changes.
  const serialisedRef = React.useRef(serialised);
  serialisedRef.current = serialised;

  // Push whatever changed on this side.
  React.useEffect(() => {
    if (lastPushed.current === serialised) return;
    let cancelled = false;
    fetch(`${SYNC_URL}/${role}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-client': CLIENT_ID },
      body: serialised,
    })
      .then((res) => {
        if (cancelled) return;
        // A 4xx or 5xx is a failed push. Recording it as sent would leave this
        // side believing it is in step for ever, which is the silent
        // divergence this whole layer exists to avoid.
        if (!res.ok) throw new Error(String(res.status));
        lastPushed.current = serialised;
        setStatus('live');
      })
      .catch(() => {
        if (!cancelled) setStatus('offline');
      });
    return () => { cancelled = true; };
  }, [role, serialised, resendNonce]);

  // Pull whatever the other side changed.
  React.useEffect(() => {
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch(`${SYNC_URL}/state`);
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as ServerState;
        if (stopped) return;
        setStatus('live');

        /**
         * Does the seam hold what this tab last sent?
         *
         * Checked every poll rather than trusted, because a push can go astray
         * for reasons this side never sees — a restart mid-flight, a dropped
         * request, a reload that reset local state. Comparing content rather
         * than counting versions means any divergence, whatever caused it, is
         * repaired within one poll instead of lasting until something else
         * happens to change. Nothing recorded at all — a restarted seam, a
         * push that never arrived — is the same answer: send it again.
         */
        if (next.hashes?.[CLIENT_ID] !== contentHash(serialisedRef.current)) {
          lastPushed.current = null;
          lastVersion.current = next.version;
          setResendNonce((n) => n + 1);
          return;
        }

        // A version lower than the one we last saw means the server restarted
        // and lost everything, so this side has to send its half again.
        if (next.version < lastVersion.current) {
          lastPushed.current = null;
          lastVersion.current = next.version;
          setResendNonce((n) => n + 1);
          return;
        }
        // A version we have already applied carries nothing new.
        if (next.version === lastVersion.current) return;

        // Nothing to apply until the other application has said something.
        // Its silence is not an instruction to empty this one.
        const other = role === 'vendor' ? 'admin' : 'vendor';
        if (next.present?.[other] === false) return;

        lastVersion.current = next.version;
        dispatch(
          role === 'vendor'
            ? {
                type: 'SYNC_IN',
                events: next.events,
                lots: next.lots,
                lineItems: next.lineItems,
                termsDocuments: next.termsDocuments,
                bidders: next.bidders,
                questionnaires: next.questionnaires,
                auctions: next.auctions,
              }
            : {
                type: 'SYNC_IN',
                responses: next.responses,
                bids: next.bids,
                participation: next.participation,
                rehearsalActivity: next.rehearsalActivity,
              },
        );
      } catch {
        if (!stopped) setStatus('offline');
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [role, dispatch]);

  return status;
}
