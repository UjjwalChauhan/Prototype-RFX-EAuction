/**
 * The API server's half: a repository seeded with the demonstration data, and
 * the router over it.
 *
 * Kept apart from `client.ts` so nothing browser-shaped is dragged into the
 * node process. `api-server.mjs` loads this module and does nothing but move
 * bytes in and out of `handle`.
 */
import * as seed from '../data/seed';
import { Repository } from './repository';
import { createRouter, type ApiRequest, type ApiResponse } from './router';

/** The state the API starts from — the same events the platform opens on. */
export function seededState() {
  const auctions = Object.values(seed.AUCTIONS_BY_EVENT());
  return {
    events: [...seed.EVENTS],
    lots: [...seed.LOTS, ...seed.OTHER_EVENT_LOTS],
    lineItems: [...seed.LINE_ITEMS, ...seed.OTHER_EVENT_LINE_ITEMS],
    // Every invitation, including the rosters that belong to the demonstration
    // auctions rather than to the primary event. Deduplicated because the
    // primary event's auction shares its roster with the event itself.
    bidders: Object.values(Object.fromEntries(
      [...seed.EVENT_BIDDERS, ...auctions.flatMap((held) => held.bidders)]
        .map((bidder) => [bidder.id, bidder]),
    )),
    questionnaires: [],
    // The demonstration auctions, so `/api/auction-events` answers with the
    // same five the E-Auction board opens on rather than an empty list until
    // somebody publishes.
    auctions: auctions.map((held) => ({
      auction: held.auction,
      lots: held.lots,
      bids: held.bids,
      controlEvents: held.controlEvents,
    })),
  };
}

export function createApi(options: { now?: () => number } = {}) {
  const repository = new Repository(seededState());
  const handle = createRouter({ repository, ...options });
  return { repository, handle };
}

export type { ApiRequest, ApiResponse };
