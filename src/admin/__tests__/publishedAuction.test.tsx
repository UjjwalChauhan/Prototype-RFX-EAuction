/**
 * An auction published from a journey, end to end.
 *
 * The reported failure: a Dutch auction created through "PR to Auction" did
 * not appear in the E-Auction section. It did not appear because it did not
 * exist — the journey created the auction *ask*, a row with a number and a
 * window, and nothing behind it for a cockpit to control or a supplier to bid
 * into.
 *
 * So these go the whole way: publish through the API the wizard calls, put the
 * result in the store the way the wizard does, and then look at both screens.
 * A test that stopped at the reducer would have passed before the fix as
 * easily as after it.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuctionBoard } from '../AuctionBoard';
import { AuctionTab } from '../tabs/AuctionTab';
import { BiddingConsole } from '../../portal/BiddingConsole';
import { PortalRequests } from '../../portal/PortalRequests';
import {
  StoreProvider, allBids, auctionRecords, auctionSyncRows, initialState, reducer,
  type AppState,
} from '../../store/store';
import { localApi } from '../../api/client';
import type { SourcingEventInput } from '../../domain/stageEvents';
import type { AuctionMechanism, FeedbackPolicy } from '../../domain/types';

const HOUR = 3_600_000;
const clean = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/<!-- -->/g, '')
    .replace(/\s+/g, ' ');

function input(
  mechanism: AuctionMechanism, feedbackPolicy: FeedbackPolicy, opensAt: number,
): SourcingEventInput {
  return {
    journeyPattern: 'JP-01',
    title: 'Copier paper — direct auction',
    category: 'Office & Administrative',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    sourceReference: 'PRD-2026-0004',
    lines: [
      { description: 'A4 copier paper', quantity: 12_000, uom: 'ream', baselinePrice: 9, lotName: 'Lot 1 · Paper' },
    ],
    bidders: [
      { counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-global' }, { counterpartyId: 'cp-nova' },
    ],
    auction: { mechanism, feedbackPolicy },
    timeline: { opensAt, closesInHours: 72 },
  };
}

/** Publish exactly the way the wizard does: through the API, then one dispatch. */
async function publish(
  mechanism: AuctionMechanism = 'DUTCH',
  feedbackPolicy: FeedbackPolicy = 'BLIND',
  { opensIn = 2 * HOUR, from = initialState() }: { opensIn?: number; from?: AppState } = {},
) {
  const family = await localApi({ events: from.events, auctions: auctionRecords(from) })
    .createSourcingEvent(input(mechanism, feedbackPolicy, Date.now() + opensIn));
  const state = reducer(from, {
    type: 'CREATE_EVENT',
    event: family.event,
    stageEvents: family.stageEvents,
    lots: family.lots,
    lineItems: family.lineItems,
    questionnaires: family.questionnaires,
    bidders: family.bidders,
    terms: family.terms,
    auction: family.auction,
    sourcedLineIds: family.sourcedLineIds,
  });
  const ask = family.stageEvents.find((stage) => stage.currentStage === 'AUCTION')!;
  return { state, family, eventId: ask.id, eventNumber: ask.eventNumber };
}

const board = (state: AppState) => clean(renderToString(
  <StoreProvider seed={state}><AuctionBoard onNavigate={() => {}} /></StoreProvider>,
));

const cockpit = (state: AppState, eventId: string) => clean(renderToString(
  <StoreProvider seed={state}><AuctionTab eventId={eventId} /></StoreProvider>,
));

const console_ = (state: AppState, eventId: string, counterpartyId: string) => clean(renderToString(
  <StoreProvider seed={state}>
    <BiddingConsole counterpartyId={counterpartyId} eventId={eventId} />
  </StoreProvider>,
));

describe('publishing a direct auction from a requisition', () => {
  it('creates an auction, not only the ask it hangs off', async () => {
    const { state, eventId } = await publish();
    expect(state.auctions[eventId]).toBeDefined();
    expect(state.auctions[eventId].auction.mechanism).toBe('DUTCH');
  });

  it('puts it in the E-Auction section, which is where it was missing', async () => {
    const { state, eventNumber } = await publish();
    const html = board(state);
    expect(html).toContain(eventNumber);
    expect(html).toContain('Dutch');
  });

  it('opens the lot at the value the requisition carried', async () => {
    const { state, eventId } = await publish();
    // 12,000 reams at ₹9 — the indicative PR price becomes the start price.
    expect(state.auctions[eventId].lots[0].startingPrice).toBe(108_000);
  });

  it('invites the auction ask’s shortlist into the room, and nobody else', async () => {
    const { state, eventId } = await publish();
    const roster = state.auctions[eventId].bidders;
    expect(roster.map((b) => b.counterpartyId).sort())
      .toEqual(['cp-abc', 'cp-global', 'cp-nova']);
    for (const bidder of roster) expect(bidder.eventId).toBe(eventId);
  });

  it('derives the mechanism’s own rules rather than taking the defaults', async () => {
    const { state, eventId } = await publish();
    const { auction } = state.auctions[eventId];
    // A Dutch clock is the system's and it ends on the first acceptance.
    expect(auction.clockOwner).toBe('SYSTEM');
    expect(auction.closePolicy).toBe('FIRST_ACCEPT');
  });

  it('leaves a journey with no auction stage without one', async () => {
    const family = await localApi({ events: initialState().events }).createSourcingEvent({
      ...input('ENGLISH', 'RANK_ONLY', Date.now() + HOUR), journeyPattern: 'JP-02',
    });
    expect(family.auction).toBeNull();
  });
});

describe('running the auction that was published', () => {
  it('opens scheduled, and says on the board that it is waiting on a controller', async () => {
    const { state, eventId } = await publish();
    expect(state.auctions[eventId].auction.status).toBe('SCHEDULED');
    expect(board(state)).toContain('waiting on you');
  });

  it('opens the cockpit on the lobby, where it can be started', async () => {
    const { state, eventId } = await publish();
    const html = cockpit(state, eventId);
    expect(html).toContain('Start the auction');
    expect(html).toContain('Open bidding');
    // The room it names is this auction's, not the seeded one's.
    expect(html).toContain('3 bidders');
  });

  it('goes live on that action, with the reason in the log', async () => {
    const { state, eventId } = await publish();
    const live = reducer(state, {
      type: 'CONTROLLER_ACTION', eventId, action: 'OPEN', reason: 'The field is ready.',
    });
    const held = live.auctions[eventId];
    expect(held.auction.status).toBe('LIVE');
    expect(held.lots[0].status).toBe('LOT_OPEN');
    expect(held.controlEvents[0]).toMatchObject({ kind: 'OPENED', reason: 'The field is ready.' });
  });

  it('is already live when its window has come round', async () => {
    const { state, eventId } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    expect(state.auctions[eventId].auction.status).toBe('LIVE');
  });
});

describe('the supplier’s side of the same auction', () => {
  const opened = async (mechanism: AuctionMechanism, policy: FeedbackPolicy) => {
    const { state, eventId } = await publish(mechanism, policy, { opensIn: -HOUR });
    return { state, eventId };
  };

  it('reaches the console of every supplier who was invited', async () => {
    const { state, eventId } = await opened('ENGLISH', 'RANK_ONLY');
    const html = console_(state, eventId, 'cp-abc');
    expect(html).toContain('Place bid');
    expect(html).not.toContain('No auction is open for you');
  });

  it('gives a Dutch bidder the clock rather than a bid box', async () => {
    const { state, eventId } = await opened('DUTCH', 'BLIND');
    const html = console_(state, eventId, 'cp-abc');
    expect(html).toContain('Accept at');
    expect(html).not.toContain('Place bid');
  });

  it('takes a bid and ranks it', async () => {
    const { state, eventId } = await opened('ENGLISH', 'RANK_ONLY');
    const lotId = state.auctions[eventId].lots[0].id;
    const bidderId = state.auctions[eventId].bidders
      .find((b) => b.counterpartyId === 'cp-abc')!.id;
    const next = reducer(state, {
      type: 'SUBMIT_BID',
      eventId,
      auctionLotId: lotId,
      bidderId,
      bidValue: 99_000,
      userId: 'portal-cp-abc',
    });
    expect(next.lastBidResult?.accepted).toBe(true);
    expect(next.auctions[eventId].bids).toHaveLength(1);
  });

  it('says so plainly to a supplier who was not invited to it', async () => {
    const { state, eventId } = await opened('ENGLISH', 'RANK_ONLY');
    expect(console_(state, eventId, 'cp-summit')).not.toContain('Place bid');
  });
});

describe('crossing to the supplier’s portal', () => {
  /**
   * The seam sends the auction one way and the bids the other. Neither side
   * sends what it does not own, so this is the whole contract: the portal can
   * bid into an auction it never created, and the platform sees that bid.
   */
  it('carries a published auction to the portal, roster and all', async () => {
    const { state, eventId } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    // A portal that has never heard of this event.
    const portal = reducer(initialState(), {
      type: 'SYNC_IN',
      events: state.events,
      lots: state.lots,
      lineItems: state.lineItems,
      bidders: state.bidders,
      auctions: auctionSyncRows(state),
    });
    expect(portal.auctions[eventId]).toBeDefined();
    expect(portal.auctions[eventId].bidders.map((b) => b.counterpartyId)).toContain('cp-abc');
    expect(console_(portal, eventId, 'cp-abc')).toContain('Place bid');
  });

  it('carries the bid the supplier places back to the platform', async () => {
    const { state, eventId } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    const portal = reducer(initialState(), {
      type: 'SYNC_IN',
      events: state.events,
      lots: state.lots,
      lineItems: state.lineItems,
      bidders: state.bidders,
      auctions: auctionSyncRows(state),
    });
    const bid = reducer(portal, {
      type: 'SUBMIT_BID',
      eventId,
      auctionLotId: portal.auctions[eventId].lots[0].id,
      bidderId: portal.auctions[eventId].bidders.find((b) => b.counterpartyId === 'cp-abc')!.id,
      bidValue: 99_000,
      userId: 'portal-cp-abc',
    });
    expect(bid.auctions[eventId].bids).toHaveLength(1);

    const platform = reducer(state, { type: 'SYNC_IN', bids: allBids(bid) });
    expect(platform.auctions[eventId].bids.map((b) => b.bidValue)).toContain(99_000);
  });

  it('does not lose a bid the portal has placed but the platform has not seen', async () => {
    const { state, eventId } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    const rows = auctionSyncRows(state);
    let portal = reducer(initialState(), {
      type: 'SYNC_IN', events: state.events, lots: state.lots, bidders: state.bidders, auctions: rows,
    });
    portal = reducer(portal, {
      type: 'SUBMIT_BID',
      eventId,
      auctionLotId: portal.auctions[eventId].lots[0].id,
      bidderId: portal.auctions[eventId].bidders.find((b) => b.counterpartyId === 'cp-abc')!.id,
      bidValue: 99_000,
      userId: 'portal-cp-abc',
    });
    // The next poll arrives before the platform has acknowledged the bid.
    const after = reducer(portal, { type: 'SYNC_IN', auctions: rows });
    expect(after.auctions[eventId].bids).toHaveLength(1);
  });
});

describe('finding the auction from the supplier’s rail', () => {
  /**
   * An auction is the one ask with nothing to fill in. Opening it the way the
   * written asks open — as a form — showed a supplier an empty questionnaire
   * for the event they were supposed to be bidding in, and the console had no
   * route into it from anywhere on the portal.
   */
  const offers = (state: AppState, entered: string[]) => clean(renderToString(
    <StoreProvider seed={state}>
      <PortalRequests
        counterpartyId="cp-abc"
        points={['AUCTION']}
        heading="Offers"
        blurb=""
        onEnterAuction={(id) => entered.push(id)}
      />
    </StoreProvider>,
  ));

  it('offers the room rather than a form for an auction that has one', async () => {
    const { state } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    const html = offers(state, []);
    expect(html).toContain('Enter the auction room');
    expect(html).toContain('Copier paper');
  });

  it('still opens a written ask as a form', async () => {
    const { state } = await publish('ENGLISH', 'RANK_ONLY', { opensIn: -HOUR });
    const html = clean(renderToString(
      <StoreProvider seed={state}>
        <PortalRequests counterpartyId="cp-abc" points={['RFQ']} heading="Requests" blurb="" />
      </StoreProvider>,
    ));
    expect(html).not.toContain('Enter the auction room');
  });
});
