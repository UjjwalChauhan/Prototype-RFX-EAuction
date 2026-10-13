/**
 * The auctions, over the API.
 *
 * `/api/auctions` already existed and creates an *ask* — the row on the board
 * with a number and a window. This is the other half: the auction behind that
 * ask, which is what a cockpit controls and a supplier bids into. One list
 * route so an integration can see every auction that has been created, one
 * detail route, one route per side of the glass, and the two writes.
 *
 * The boundary is the point of the two read routes. `/standing` is the buyer's
 * view and names everyone; `/bidder-view` goes through `bidderView`, which
 * builds by whitelist from the feedback policy, so what a supplier's client
 * receives never contains a number the policy forbids. The same function the
 * console calls, so the HTTP client and the in-tab one cannot disagree about
 * what a bidder is allowed to know.
 */
import {
  bidderView, buyerView, controllerAction, submitBid,
  type AuctionState, type ControllerAction,
} from '../server/auctionService';
import { serverNow } from '../server/clock';
import {
  MECHANISM_PROFILE, availableActions, bidderRules, howItWorks, mechanismIssues,
} from '../domain/auctionMechanics';
import { readSetting, settingsFor } from '../domain/auctionRules';
import { COUNTERPARTY_NAMES } from '../data/seed';
import type { Repository, AuctionRecord } from './repository';
import type { ApiRequest, ApiResponse } from './router';
import type { Id } from '../domain/types';

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
const badRequest = (message: string, details: unknown[] = []): ApiResponse =>
  ({ status: 400, body: { error: message, details } });
const notFound = (message: string): ApiResponse => ({ status: 404, body: { error: message } });

export const AUCTION_ROUTES = [
  {
    method: 'GET', path: '/api/auction-events',
    summary: 'Every auction that has been created, with its mechanism and standing. Filter with ?status= &mechanism= &side= &counterpartyId=.',
  },
  {
    method: 'GET', path: '/api/auction-events/:id',
    summary: 'One auction: configuration, lots, roster, control log and how the mechanism runs.',
  },
  {
    method: 'GET', path: '/api/auction-events/:id/standing',
    summary: 'The buyer-side ranking, per lot. Real names, transformed values.',
  },
  {
    method: 'GET', path: '/api/auction-events/:id/bidder-view',
    summary: 'What one bidder is permitted to see. Pass ?bidderId= or ?counterpartyId=.',
  },
  {
    method: 'POST', path: '/api/auction-events/:id/bids',
    summary: 'Place a bid. Validated and ranked server-side; a refusal says why.',
  },
  {
    method: 'POST', path: '/api/auction-events/:id/control',
    summary: 'A controller action — open, pause, advance the round, open the envelopes. Reason required.',
  },
];

/**
 * The shape the auction service works in, assembled from what the repository
 * holds separately.
 *
 * The roster and the lot details are not copied into the auction record: they
 * belong to the ask and the basket, and a second copy is a second thing to keep
 * in step. They are joined here, on the way in.
 */
function stateOf(repository: Repository, held: AuctionRecord): AuctionState {
  const { lots } = repository.snapshot();
  return {
    auction: held.auction,
    lots: held.lots,
    lotDetails: Object.fromEntries(lots.map((lot) => [lot.id, lot])),
    bids: held.bids,
    bidders: repository.biddersOf(held.auction.eventId),
    costComponents: [],
    controlEvents: held.controlEvents,
    integrityFlags: [],
  };
}

/** Back into the two ledgers and the configuration the repository stores. */
const recordOf = (state: AuctionState): AuctionRecord => ({
  auction: state.auction,
  lots: state.lots,
  bids: state.bids,
  controlEvents: state.controlEvents,
});

/** One row of the list — enough to decide which auction to open, and no more. */
function summary(repository: Repository, held: AuctionRecord) {
  const { auction } = held;
  const event = repository.event(auction.eventId);
  const profile = MECHANISM_PROFILE[auction.mechanism];
  const roster = repository.biddersOf(auction.eventId);
  const openLot = held.lots.find((lot) => lot.status === 'LOT_OPEN') ?? held.lots[0] ?? null;

  return {
    auctionId: auction.id,
    /** The reference a person quotes. Distinct from the ask's own number. */
    auctionNumber: auction.auctionNumber,
    eventId: auction.eventId,
    eventNumber: event?.eventNumber ?? null,
    title: event?.title ?? null,
    parentEventId: event?.parentEventId ?? null,
    side: auction.side,
    currency: event?.currency ?? null,
    mechanism: auction.mechanism,
    mechanismLabel: profile.label,
    status: auction.status,
    feedbackPolicy: auction.feedbackPolicy,
    identityPolicy: auction.identityPolicy,
    closePolicy: auction.closePolicy,
    rounds: auction.rounds,
    clockOwner: auction.clockOwner,
    opensAt: auction.startsAt,
    closesAt: auction.endsAt,
    lotCount: held.lots.length,
    bidderCount: roster.length,
    bidCount: held.bids.filter((bid) => bid.isValid).length,
    openingValue: held.lots.reduce((total, lot) => total + lot.startingPrice, 0),
    /**
     * Sealed formats have no standing to report, and saying so is the honest
     * answer — a null here means "there is none", not "we did not look".
     */
    standing: profile.liveRanking && openLot
      ? buyerView(stateOf(repository, held), openLot.id, COUNTERPARTY_NAMES)
        .filter((row) => row.bidCount > 0)
        .slice(0, 3)
        .map((row) => ({ rank: row.rank, bidder: row.displayName, value: row.transformedValue }))
      : null,
    /** What the controller has to do before anything else can happen. */
    waitingOn: waitingOn(held),
  };
}

/** One row of `GET /api/auction-events`, as a caller receives it. */
export type AuctionListRow = ReturnType<typeof summary>;

/**
 * Whether this auction is waiting on a human, and for what.
 *
 * A Japanese round and a sealed envelope do not advance themselves, and an
 * auction nobody has opened never starts. Reported on the row rather than left
 * for a controller to work out from the status.
 */
function waitingOn(held: AuctionRecord): string | null {
  const { auction } = held;
  if (auction.status === 'CONFIGURED' || auction.status === 'SCHEDULED' || auction.status === 'LOBBY_OPEN') {
    return 'Not open yet — a controller starts it.';
  }
  if (auction.status === 'PAUSED') return 'Paused — a controller resumes it.';
  const profile = MECHANISM_PROFILE[auction.mechanism];
  if (auction.status !== 'LIVE' && auction.status !== 'EXTENDED') return null;
  if (profile.bidEntry === 'STAY_IN') return 'The next round has to be advanced.';
  if (profile.bidEntry === 'ONE_SHOT' && !held.controlEvents.some((e) => e.kind === 'ENVELOPES_OPENED')) {
    return 'The envelopes are sealed until a controller opens them.';
  }
  if (profile.bidEntry === 'TURN_BASED') return 'The next turn has to be called.';
  return null;
}

/** The bidder row this counterparty holds in this auction, if any. */
function bidderIdFor(repository: Repository, held: AuctionRecord, query: Record<string, string | undefined>): Id | null {
  const roster = repository.biddersOf(held.auction.eventId);
  if (query.bidderId !== undefined) {
    return roster.some((b) => b.id === query.bidderId) ? query.bidderId : null;
  }
  if (query.counterpartyId !== undefined) {
    return roster.find((b) => b.counterpartyId === query.counterpartyId)?.id ?? null;
  }
  return null;
}

/**
 * Handle an auction route, or say it is not one.
 *
 * Returns null rather than a 404 so the caller can go on trying its own
 * routes — this is a section of the API, not the whole of it.
 */
export function handleAuctionRoute(
  repository: Repository, request: ApiRequest, segments: string[],
): ApiResponse | null {
  const [, collection, id, action] = segments;
  if (collection !== 'auction-events') return null;
  const method = request.method.toUpperCase();
  const query = request.query ?? {};

  if (method === 'GET' && id === undefined) {
    const rows = repository.allAuctions()
      .map((held) => summary(repository, held))
      .filter((row) => {
        if (query.status !== undefined && row.status !== query.status.toUpperCase()) return false;
        if (query.mechanism !== undefined && row.mechanism !== query.mechanism.toUpperCase()) return false;
        if (query.side !== undefined && row.side !== query.side.toUpperCase()) return false;
        return true;
      })
      .filter((row) => {
        // A supplier asking which auctions they are in gets exactly those.
        if (query.counterpartyId === undefined) return true;
        return repository.biddersOf(row.eventId)
          .some((bidder) => bidder.counterpartyId === query.counterpartyId);
      });
    return ok({ auctions: rows });
  }

  if (id === undefined) return notFound(`No route for ${method} ${request.path}.`);

  const held = repository.auction(id);
  if (!held) return notFound(`No auction on event "${id}".`);
  const state = stateOf(repository, held);

  if (method === 'GET' && action === undefined) {
    const openLot = held.lots.find((lot) => lot.status === 'LOT_OPEN') ?? held.lots[0] ?? null;
    return ok({
      ...summary(repository, held),
      auction: held.auction,
      lots: held.lots.map((lot) => ({
        ...lot,
        name: state.lotDetails[lot.lotId]?.name ?? null,
      })),
      bidders: state.bidders.map((bidder) => ({
        id: bidder.id,
        counterpartyId: bidder.counterpartyId,
        name: COUNTERPARTY_NAMES[bidder.counterpartyId] ?? bidder.counterpartyId,
        maskedLabel: bidder.maskedLabel,
        invitationStatus: bidder.invitationStatus,
        participationStatus: bidder.participationStatus,
        bidCount: held.bids.filter((bid) => bid.bidderId === bidder.id && bid.isValid).length,
      })),
      controlEvents: held.controlEvents,
      /**
       * The rules this mechanism actually has, read from the same table the
       * Setup pane renders. An integration configuring an auction should not
       * have to discover that half the fields it can set are ignored.
       */
      settings: settingsFor(held.auction).map((setting) => ({
        key: setting.key,
        group: setting.group,
        label: setting.label(held.auction),
        hint: setting.hint(held.auction),
        why: setting.why(held.auction),
        kind: setting.kind,
        min: setting.min ?? null,
        max: setting.max ?? null,
        options: setting.options ?? null,
        value: readSetting(held.auction, setting.key),
        locked: setting.locked ?? null,
      })),
      /** The same sentences the cockpit and the console read. */
      howItWorks: howItWorks(held.auction),
      bidderRules: bidderRules(held.auction),
      issues: mechanismIssues(held.auction),
      actions: availableActions(held.auction, {
        hasPendingLot: held.lots.some((lot) => lot.status === 'LOT_PENDING'),
        revealed: held.controlEvents.some((e) => e.kind === 'ENVELOPES_OPENED'),
        clockHeld: held.auction.status === 'PAUSED',
      }).map((spec) => spec.key),
      openLotId: openLot?.id ?? null,
    });
  }

  if (method === 'GET' && action === 'standing') {
    return ok({
      auctionId: held.auction.id,
      lots: held.lots.map((lot) => ({
        auctionLotId: lot.id,
        name: state.lotDetails[lot.lotId]?.name ?? null,
        status: lot.status,
        standing: buyerView(state, lot.id, COUNTERPARTY_NAMES),
      })),
    });
  }

  if (method === 'GET' && action === 'bidder-view') {
    const bidderId = bidderIdFor(repository, held, query);
    if (bidderId === null) {
      return badRequest('Pass bidderId or counterpartyId of a bidder invited to this auction.');
    }
    const openLot = held.lots.find((lot) => lot.status === 'LOT_OPEN') ?? held.lots[0] ?? null;
    if (openLot === null) return badRequest('This auction has no lots.');
    return ok({
      auctionId: held.auction.id,
      bidderId,
      auctionLotId: openLot.id,
      // Everything below this line is built by whitelist from the feedback
      // policy. A field the policy forbids is absent, not blank.
      ...bidderView(state, openLot.id, bidderId, COUNTERPARTY_NAMES),
      // The supplier's own projection carries the reference too, so a client
      // built on this API can show what the portal shows.
      auctionNumber: held.auction.auctionNumber,
      rules: bidderRules(held.auction),
      mechanism: held.auction.mechanism,
      bidEntry: MECHANISM_PROFILE[held.auction.mechanism].bidEntry,
    });
  }

  if (method === 'POST' && action === 'bids') {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const bidderId = bidderIdFor(repository, held, {
      bidderId: body.bidderId as string | undefined,
      counterpartyId: body.counterpartyId as string | undefined,
    });
    if (bidderId === null) {
      return badRequest('Pass bidderId or counterpartyId of a bidder invited to this auction.');
    }
    const bidValue = Number(body.bidValue);
    if (!Number.isFinite(bidValue)) return badRequest('bidValue must be a number.');

    const auctionLotId = typeof body.auctionLotId === 'string'
      ? body.auctionLotId
      : held.lots.find((lot) => lot.status === 'LOT_OPEN')?.id;
    if (auctionLotId === undefined) return badRequest('No lot is open, and none was named.');

    const result = submitBid({
      state,
      auctionLotId,
      bidderId,
      bidValue,
      userId: String(body.userId ?? `portal-${bidderId}`),
      source: 'API',
      clientTimestamp: typeof body.clientTimestamp === 'number' ? body.clientTimestamp : null,
      confirmed: body.confirmed === true,
    });
    repository.replaceAuction(recordOf(result.state));

    // A refused bid is still an answer, not a server error: the caller asked a
    // legitimate question and the rules said no. The ledger records the attempt.
    return result.accepted
      ? created({
        accepted: true,
        bid: result.state.bids[0] ?? null,
        standing: buyerView(result.state, auctionLotId, COUNTERPARTY_NAMES)
          .find((row) => row.bidderId === bidderId)?.rank ?? null,
      })
      : ok({
        accepted: false,
        rejectionCode: result.rejectionCode,
        message: result.message,
        requiresConfirmation: result.requiresConfirmation,
      });
  }

  if (method === 'POST' && action === 'control') {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const control = String(body.action ?? '').toUpperCase() as ControllerAction;
    const reason = String(body.reason ?? '');
    const permitted = availableActions(held.auction, {
      hasPendingLot: held.lots.some((lot) => lot.status === 'LOT_PENDING'),
      revealed: held.controlEvents.some((e) => e.kind === 'ENVELOPES_OPENED'),
      clockHeld: held.auction.status === 'PAUSED',
      windowOpen: true,
    }).map((spec) => spec.key as string);

    if (!permitted.includes(control)) {
      return badRequest(
        `"${control}" is not something this auction can be asked to do right now.`,
        permitted.map((key) => ({ field: 'action', message: key })),
      );
    }
    if (reason.trim() === '') {
      return badRequest('A controller action is written to the audit log with its reason. Give one.');
    }

    const next = controllerAction(
      state, control, String(body.actorId ?? 'api'), reason,
      {
        extendSec: typeof body.extendSec === 'number' ? body.extendSec : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
      },
    );
    repository.replaceAuction(recordOf(next));
    return ok({
      auction: next.auction,
      lots: next.lots,
      controlEvent: next.controlEvents[0],
      at: serverNow(),
    });
  }

  return notFound(`No route for ${method} ${request.path}.`);
}
