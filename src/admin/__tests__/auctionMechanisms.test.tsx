/**
 * The two sides of a live auction, per mechanism.
 *
 * Packs 18 and 19 are a coupled pair: the cockpit shows the controller
 * everything, the console shows the bidder only what the policy permits, and
 * both are reading one event. These tests render both against the same seeded
 * auctions and assert three things — that each mechanism gets the screen it
 * needs, that the controller's actions are the ones that mechanism actually
 * has, and that nothing the bidder must not see reaches their screen.
 *
 * The last one is the reason this file exists. A leak here is not a rendering
 * bug; it is a competitor's price on a supplier's screen.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuctionBoard } from '../AuctionBoard';
import { AuctionTab } from '../tabs/AuctionTab';
import { BiddingConsole } from '../../portal/BiddingConsole';
import {
  StoreProvider, auctionSummaries, initialState, reducer, type AppState,
} from '../../store/store';
import { MECHANISM_PROFILE } from '../../domain/auctionMechanics';
import { COUNTERPARTY_NAMES } from '../../data/seed';

const state = initialState();
const rows = auctionSummaries(state);

const clean = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/<!-- -->/g, '')
    .replace(/\s+/g, ' ');

const forMechanism = (mechanism: string) => {
  const row = rows.find((r) => r.auction.mechanism === mechanism);
  if (!row) throw new Error(`No seeded ${mechanism} auction — the demonstration needs one.`);
  return row;
};

const cockpit = (eventId: string, seed: AppState = state) =>
  clean(renderToString(
    <StoreProvider seed={seed}><AuctionTab eventId={eventId} /></StoreProvider>,
  ));

const console_ = (eventId: string, counterpartyId: string, seed: AppState = state) =>
  clean(renderToString(
    <StoreProvider seed={seed}>
      <BiddingConsole counterpartyId={counterpartyId} eventId={eventId} />
    </StoreProvider>,
  ));

/** The supplier the seeded auction's first bidder belongs to. */
const firstBidder = (eventId: string) => state.auctions[eventId].bidders[0].counterpartyId;

describe('the E-Auction section', () => {
  const html = clean(renderToString(
    <StoreProvider seed={state}><AuctionBoard onNavigate={() => {}} /></StoreProvider>,
  ));

  it('lists every auction, not only the one that happens to be running', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) expect(html).toContain(row.event.eventNumber);
  });

  it('names the mechanism on the row, because it decides everything behind it', () => {
    for (const row of rows) {
      expect(html).toContain(MECHANISM_PROFILE[row.auction.mechanism].label);
    }
  });

  it('runs several mechanisms at once, which is the point of the model', () => {
    expect(new Set(rows.map((r) => r.auction.mechanism)).size).toBeGreaterThanOrEqual(4);
  });

  it('explains all ten, so a mechanism is chosen rather than recognised', () => {
    for (const profile of Object.values(MECHANISM_PROFILE)) {
      expect(html).toContain(profile.label);
    }
  });

  it('says which auctions are waiting on a human', () => {
    // A Japanese round and a sealed envelope do not advance themselves.
    expect(html).toContain('waiting on you');
  });

  it('reports no standing where the format produces none', () => {
    expect(html).toContain('sealed');
  });
});

describe('the cockpit, per mechanism', () => {
  it('gives a Japanese auction its round, its field and its ladder', () => {
    const html = cockpit(forMechanism('JAPANESE').eventId);
    expect(html).toContain('Round');
    expect(html).toContain('Who is still in');
    expect(html).toContain('Drop-out ladder');
    // The controller drives this format; nothing moves without them.
    expect(html).toContain('Advance the round');
  });

  it('tells the controller a Japanese auction has no ranking', () => {
    const html = cockpit(forMechanism('JAPANESE').eventId);
    expect(html).toContain('has no ranking');
    expect(html).not.toContain('Live standing');
  });

  it('gives a Dutch auction a clock and no time to extend', () => {
    const html = cockpit(forMechanism('DUTCH').eventId);
    expect(html).toContain('Price on the clock');
    expect(html).toContain('Hold the clock');
    // The clock is the auction. There is nothing to add minutes to.
    expect(html).not.toContain('>Extend<');
  });

  it('keeps a sealed bid sealed from the controller too', () => {
    const html = cockpit(forMechanism('SEALED_BID').eventId);
    expect(html).toContain('Envelopes sealed');
    expect(html).toContain('Open the envelopes');
    // A count is not a disclosure; the values are.
    expect(html).toContain('Who has submitted');
    const submitted = state.auctions[forMechanism('SEALED_BID').eventId].bids;
    for (const bid of submitted) {
      expect(html).not.toContain(String(bid.bidValue));
    }
  });

  it('shows a multi-attribute auction the composite and its published weights', () => {
    const html = cockpit(forMechanism('MULTI_ATTRIBUTE').eventId);
    expect(html).toContain('Composite standing');
    expect(html).toContain('Lead time');
    expect(html).toContain('published to bidders');
  });

  it('gives an English auction the plain ranking and none of the above', () => {
    const html = cockpit(forMechanism('ENGLISH').eventId);
    expect(html).toContain('Live standing');
    expect(html).not.toContain('Drop-out ladder');
    expect(html).not.toContain('Envelopes sealed');
    expect(html).not.toContain('Advance the round');
  });

  it('always shows the controller real identities', () => {
    const row = forMechanism('JAPANESE');
    const html = cockpit(row.eventId);
    const first = state.auctions[row.eventId].bidders[0];
    expect(html).toContain(COUNTERPARTY_NAMES[first.counterpartyId]);
  });
});

describe('the console, per mechanism', () => {
  it('tells a Japanese bidder who has confirmed that they are in, and stops asking', () => {
    const row = forMechanism('JAPANESE');
    const html = console_(row.eventId, 'cp-voltek');
    expect(html).toContain('You are in at');
    expect(html).toContain('Confirmed for round');
    // Nothing to do is a state worth showing plainly, not an empty screen.
    expect(html).toContain('until the buyer advances the clock');
  });

  it('gives a Japanese bidder facing a new round the decision and its consequence', () => {
    const row = forMechanism('JAPANESE');
    // The controller advances the round; every console moves with it.
    const advanced = reducer(state, {
      type: 'CONTROLLER_ACTION', eventId: row.eventId,
      action: 'ADVANCE_ROUND', reason: 'Round two.',
    });
    const html = console_(row.eventId, 'cp-voltek', advanced);
    expect(html).toContain('Stay in at');
    expect(html).toContain('Leave the auction');
    // Doing nothing eliminates them. That cannot live in a help panel.
    expect(html).toContain('If you do nothing, you are out');
    expect(html).toContain('cannot rejoin');
  });

  it('shows a bidder who missed a round that they are out, and at what price', () => {
    const row = forMechanism('JAPANESE');
    let next = state;
    // Two rounds pass. Keystone confirmed neither, so they are gone.
    for (const reason of ['Round two.', 'Round three.']) {
      next = reducer(next, {
        type: 'CONTROLLER_ACTION', eventId: row.eventId, action: 'ADVANCE_ROUND', reason,
      });
    }
    const html = console_(row.eventId, 'cp-keystone', next);
    expect(html).toContain('You are out of this auction');
    expect(html).toContain('You cannot rejoin');
  });

  it('gives a Dutch bidder one button and the cost of waiting', () => {
    const row = forMechanism('DUTCH');
    const html = console_(row.eventId, firstBidder(row.eventId));
    expect(html).toContain('Accept at');
    expect(html).toContain('first company to press it wins');
    expect(html).not.toContain('Place bid');
  });

  it('gives a sealed bidder one submission and a receipt', () => {
    const row = forMechanism('SEALED_BID');
    // cp-nova has already submitted; the console must lock, not re-offer.
    expect(console_(row.eventId, 'cp-nova')).toContain('Your submission is in');
    expect(console_(row.eventId, 'cp-orion')).toContain('Your one submission');
  });

  it('shows a multi-attribute bidder the trade-off as they make it', () => {
    const row = forMechanism('MULTI_ATTRIBUTE');
    const html = console_(row.eventId, firstBidder(row.eventId));
    expect(html).toContain('Your score as it stands');
    expect(html).toContain('Lead time');
  });

  it('gives an English bidder the bid box and the figure to beat', () => {
    const row = forMechanism('ENGLISH');
    const html = console_(row.eventId, 'cp-abc');
    expect(html).toContain('Place bid');
    expect(html).toContain('take the lead');
  });

  it('shows every bidder the rules of their own auction, generated from it', () => {
    for (const row of rows) {
      const html = console_(row.eventId, firstBidder(row.eventId));
      expect(html).toContain('The rules of this auction');
    }
  });

  it('lets a supplier in more than one auction see which room they are in', () => {
    // cp-summit is in the Japanese steel auction and the sell-side Dutch one.
    const html = console_(forMechanism('JAPANESE').eventId, 'cp-summit');
    expect(html).toContain('You are in 2 auctions');
    expect(html).toContain('Japanese');
    expect(html).toContain('Dutch');
  });

  it('says so plainly when a supplier has no auction at all', () => {
    expect(console_('', 'cp-not-invited')).toContain('No auction is open for you');
  });
});

describe('the visibility boundary holds on every mechanism', () => {
  it('never puts a competitor’s name on a masked bidder’s screen', () => {
    for (const row of rows) {
      if (row.auction.identityPolicy !== 'MASKED') continue;
      const me = firstBidder(row.eventId);
      const html = console_(row.eventId, me);
      for (const bidder of state.auctions[row.eventId].bidders) {
        if (bidder.counterpartyId === me) continue;
        expect(html).not.toContain(COUNTERPARTY_NAMES[bidder.counterpartyId]);
      }
    }
  });

  it('never puts a competitor’s number on a blind bidder’s screen', () => {
    for (const row of rows) {
      if (row.auction.feedbackPolicy !== 'BLIND') continue;
      const me = firstBidder(row.eventId);
      const held = state.auctions[row.eventId];
      const myBidderId = held.bidders.find((b) => b.counterpartyId === me)!.id;
      const html = console_(row.eventId, me);

      /**
       * A value only one bidder holds is that bidder's number.
       *
       * A clock price everybody accepted is not: it is one number the whole
       * room is looking at, and excluding it is the difference between testing
       * the boundary and testing that a Japanese auction has a clock.
       */
      const holders = new Map<number, Set<string>>();
      for (const bid of held.bids) {
        holders.set(bid.bidValue, (holders.get(bid.bidValue) ?? new Set()).add(bid.bidderId));
      }
      for (const [value, bidders] of holders) {
        if (bidders.has(myBidderId) || bidders.size > 1) continue;
        expect(html).not.toContain(value.toLocaleString('en-IN'));
      }
    }
  });

  it('shows the controller what it withholds from the bidder', () => {
    const row = forMechanism('MULTI_ATTRIBUTE');
    const buyer = cockpit(row.eventId);
    const supplier = console_(row.eventId, firstBidder(row.eventId));
    const other = state.auctions[row.eventId].bidders[1];
    expect(buyer).toContain(COUNTERPARTY_NAMES[other.counterpartyId]);
    expect(supplier).not.toContain(COUNTERPARTY_NAMES[other.counterpartyId]);
  });
});
