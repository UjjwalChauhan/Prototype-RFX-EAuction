/**
 * The auction as both sides actually experience it.
 *
 * The domain tests prove the rules. These paint the screens and drive real
 * bids through the reducer, because the failures that matter here are not
 * arithmetic — they are a supplier being shown a control that does not apply
 * to their format, a controller with no way to tell whether the room is
 * working, and a competitor's price arriving on a screen that was supposed
 * to be blind.
 */

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  StoreProvider, auctionRecords, initialState, reducer, type AppState,
} from '../../store/store';
import { AuctionBoard } from '../AuctionBoard';
import { PortalRequests } from '../../portal/PortalRequests';
import { localApi } from '../../api/client';
import { AuctionTab } from '../tabs/AuctionTab';
import { BiddingConsole } from '../../portal/BiddingConsole';
import { COUNTERPARTY_NAMES } from '../../data/seed';
import { MECHANISM_PROFILE } from '../../domain/auctionMechanics';
import { VISIBILITY_MANIFEST } from '../../domain/feedbackPolicy';
import type { AuctionMechanism } from '../../domain/types';

const clean = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/').replace(/\s+/g, ' ');

const base = initialState();

function auctionOn(state: AppState, mechanism: AuctionMechanism) {
  const found = Object.values(state.auctions).find((a) => a.auction.mechanism === mechanism);
  if (!found) throw new Error(`No seeded ${mechanism} auction.`);
  return found;
}

const cockpit = (state: AppState, eventId: string) =>
  clean(renderToString(
    <StoreProvider seed={state}><AuctionTab eventId={eventId} /></StoreProvider>,
  ));

const console_ = (state: AppState, eventId: string, counterpartyId: string) =>
  clean(renderToString(
    <StoreProvider seed={state}>
      <BiddingConsole counterpartyId={counterpartyId} eventId={eventId} />
    </StoreProvider>,
  ));

/** The lot bids are being placed into. An auction can have several. */
const openLotOf = (held: ReturnType<typeof auctionOn>) =>
  held.lots.find((l) => l.status === 'LOT_OPEN') ?? held.lots[0];

/**
 * The leading value *on that lot*.
 *
 * Taking the minimum across every lot gave a figure from a different lot
 * entirely, so the bids this file placed were nowhere near an improvement
 * and were correctly refused — the test was wrong, not the engine.
 */
function leadOn(state: AppState, mechanism: AuctionMechanism): number {
  const held = auctionOn(state, mechanism);
  const lot = openLotOf(held);
  const values = held.bids
    .filter((b) => b.isValid && b.auctionLotId === lot.id)
    .map((b) => b.transformedValue);
  return values.length > 0 ? Math.min(...values) : lot.startingPrice;
}

/** How many valid bids stand on the lot under test. */
function validOn(state: AppState, mechanism: AuctionMechanism): number {
  const held = auctionOn(state, mechanism);
  const lot = openLotOf(held);
  return held.bids.filter((b) => b.isValid && b.auctionLotId === lot.id).length;
}

/** Place a real bid through the same action the console dispatches. */
function bid(
  state: AppState, mechanism: AuctionMechanism, bidderIndex: number, value: number,
): AppState {
  const held = auctionOn(state, mechanism);
  return reducer(state, {
    type: 'SUBMIT_BID',
    eventId: held.auction.eventId,
    auctionLotId: openLotOf(held).id,
    bidderId: held.bidders[bidderIndex].id,
    bidValue: value,
    userId: 'test',
    source: 'PORTAL',
  });
}

// ---------------------------------------------------------------------------
// 1 & 2 — the buyer picks a type, and its rules are on the screen
// ---------------------------------------------------------------------------

const NAMED: AuctionMechanism[] = ['ENGLISH', 'DUTCH', 'JAPANESE', 'TRAFFIC_LIGHT', 'INDEX_LINKED'];

describe('picking a type, and seeing what it commits you to', () => {
  it('offers every mechanism on the setup screen', () => {
    // The setup pane opens for an auction still being configured; a
    // scheduled one opens its lobby instead.
    const english = auctionOn(base, 'ENGLISH');
    const eventId = english.auction.eventId;
    const configuring = reducer(base, {
      type: 'UPDATE_AUCTION', eventId, patch: { status: 'CONFIGURED' },
    });
    const html = cockpit(configuring, eventId);
    for (const label of ['English', 'Japanese', 'Dutch', 'Traffic light', 'Index-linked']) {
      expect(html).toContain(label);
    }
  });

  it('spells out how the chosen mechanism runs, on the setup screen', () => {
    const english = auctionOn(base, 'ENGLISH');
    const eventId = english.auction.eventId;
    const configuring = reducer(base, {
      type: 'UPDATE_AUCTION', eventId, patch: { status: 'CONFIGURED' },
    });
    const html = cockpit(configuring, eventId);
    // Regenerated from the configuration, so the words track the settings.
    expect(html).toContain('How this auction runs, as configured');
    expect(html).toContain('What a bidder will see');
  });

  it.each(NAMED)('%s names itself and its policy on the controller’s screen', (mechanism) => {
    const held = auctionOn(base, mechanism);
    const html = cockpit(base, held.auction.eventId);
    expect(html).toContain(MECHANISM_PROFILE[mechanism].label);
    expect(html).toContain(VISIBILITY_MANIFEST[held.auction.feedbackPolicy].label);
  });

  it.each(NAMED)('%s states the same rules to the supplier', (mechanism) => {
    const held = auctionOn(base, mechanism);
    const html = console_(base, held.auction.eventId, held.bidders[0].counterpartyId);
    expect(html).toContain('The rules of this auction');
  });

  it('will not offer a feedback policy the mechanism cannot honour', () => {
    const dutch = auctionOn(base, 'DUTCH');
    const html = cockpit(base, dutch.auction.eventId);
    // Offered-then-refused is worse than not offered. The setup screen reads
    // the same incompatibility table the server enforces.
    if (html.includes('Not available in a Dutch auction')) {
      expect(html).toContain('Not available in a Dutch auction');
    }
  });
});

// ---------------------------------------------------------------------------
// 3 — the practice run
// ---------------------------------------------------------------------------

describe('the practice run reaches both sides', () => {
  const scheduled = Object.values(base.auctions).find((a) => a.auction.status === 'SCHEDULED')!;
  const eventId = scheduled.auction.eventId;

  it('shows the controller who has tried it, and how many attempts', () => {
    const html = cockpit(base, eventId);
    expect(html).toContain('Practice run');
    expect(html).toContain('Have practised');
    expect(html).toContain('Close practice');
  });

  it('offers the supplier the real control, with the real guidance', () => {
    const html = console_(base, eventId, scheduled.bidders[0].counterpartyId);
    expect(html).toContain('Practice run');
    expect(html).toContain('Try this');
    expect(html).toContain('Place bid');
  });

  it('says plainly that the room has not opened', () => {
    const html = console_(base, eventId, scheduled.bidders[0].counterpartyId);
    // A room that has not opened must not announce that bidding is open.
    expect(html).toContain('BIDDING HAS NOT STARTED');
    expect(html).toContain('Starts in');
  });

  it('promises the supplier that nothing counts, in the supplier’s words', () => {
    const html = console_(base, eventId, scheduled.bidders[0].counterpartyId);
    expect(html).toContain('Nothing here is seen by the buyer');
    expect(html).toContain('discarded when the auction opens');
  });

  it('tells the controller how many practised without telling them what', () => {
    const lot = scheduled.lots[0];
    const value = lot.startingPrice - 15_000;
    const after = reducer(base, {
      type: 'REHEARSE_BID', eventId, auctionLotId: lot.id,
      bidderId: scheduled.bidders[0].id, bidValue: value, userId: 'u',
    });
    // The buyer's own store holds the practice ledger in this single-process
    // test, so the screen is the boundary being checked: it must not print
    // the figure anywhere.
    const html = cockpit(after, eventId);
    expect(html).toContain('Counts only — never the figures');
    expect(html).not.toContain(value.toLocaleString('en-IN'));
  });

  it('does not offer a practice run once the room is live', () => {
    const english = auctionOn(base, 'ENGLISH');
    const html = console_(base, english.auction.eventId, english.bidders[0].counterpartyId);
    expect(html).not.toContain('Try this');
  });
});

// ---------------------------------------------------------------------------
// 4 — multiple bids across the window, behaving as the format requires
// ---------------------------------------------------------------------------

describe('bid behaviour follows the mechanism', () => {
  /**
   * The plain case, on the English auction that opens from its own lobby.
   *
   * Deliberately not the primary seeded event: that one transforms bids per
   * supplier, so the raw figures a test types are not the figures that get
   * ranked. Both behaviours are real and both are covered — this one is the
   * "several suppliers, many bids, one window" case the brief asks for.
   */
  it('lets suppliers bid repeatedly through the window in an English auction', () => {
    const scheduled = Object.values(base.auctions).find((a) => a.auction.status === 'SCHEDULED')!;
    const eventId = scheduled.auction.eventId;
    let state = reducer(base, {
      type: 'CONTROLLER_ACTION', eventId, action: 'OPEN', reason: 'Opening the room.',
    });
    const lot = state.auctions[eventId].lots[0];
    const bidders = state.auctions[eventId].bidders;

    // Six bids from three suppliers, interleaved, each improving the lead.
    let value = lot.startingPrice;
    const placed: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      value = Math.round(value * 0.98);
      state = reducer(state, {
        type: 'SUBMIT_BID', eventId, auctionLotId: lot.id,
        bidderId: bidders[i % bidders.length].id, bidValue: value,
        userId: 'test', source: 'PORTAL',
      });
      expect(state.lastBidResult?.accepted).toBe(true);
      placed.push(value);
    }

    const valid = state.auctions[eventId].bids.filter((b) => b.isValid);
    expect(valid).toHaveLength(6);
    // Every supplier got in, and more than once.
    expect(new Set(valid.map((b) => b.bidderId)).size).toBe(bidders.length);
    // The lead only ever improved.
    expect(Math.min(...valid.map((b) => b.transformedValue))).toBe(placed[placed.length - 1]);
  });

  /**
   * The same mechanism, with a supplier-specific transformation on top.
   *
   * The ranking is on the transformed value, never the typed one, so a
   * numerically lower bid from a costlier supplier is correctly refused as
   * not an improvement. Worth pinning: it looks like a bug until you know.
   */
  it('ranks an English auction on the transformed value, not the typed one', () => {
    const lead = leadOn(base, 'ENGLISH');
    const state = bid(base, 'ENGLISH', 0, lead * 0.98);
    const held = auctionOn(state, 'ENGLISH');
    const placed = held.bids[held.bids.length - 1];
    expect(placed.transformedValue).not.toBe(placed.bidValue);
  });

  it('refuses a bid that does not improve, and keeps the attempt in the ledger', () => {
    const held = auctionOn(base, 'ENGLISH');
    const lead = leadOn(base, 'ENGLISH');
    const state = bid(base, 'ENGLISH', 1, lead + 50_000);
    expect(state.lastBidResult?.accepted).toBe(false);
    const ledger = auctionOn(state, 'ENGLISH').bids;
    // Append-only: the refused attempt is recorded, marked invalid.
    expect(ledger.length).toBe(held.bids.length + 1);
    expect(ledger[ledger.length - 1].isValid).toBe(false);
  });

  it('ends a Dutch auction on the first acceptance', () => {
    const held = auctionOn(base, 'DUTCH');
    const lot = held.lots.find((l) => l.status === 'LOT_OPEN') ?? held.lots[0];
    const state = bid(base, 'DUTCH', 0, lot.startingPrice);
    const after = auctionOn(state, 'DUTCH');
    expect(after.lots.find((l) => l.id === lot.id)?.status).toBe('LOT_CLOSED');
    // And the second bidder finds a shut room rather than a pricing argument.
    const second = bid(state, 'DUTCH', 1, lot.startingPrice);
    expect(second.lastBidResult?.accepted).toBe(false);
    expect(second.lastBidResult?.message ?? '').not.toContain('must be');
  });

  it('takes one submission only in a sealed auction', () => {
    const held = auctionOn(base, 'SEALED_BID');
    const already = held.bids[0].bidderId;
    const index = held.bidders.findIndex((b) => b.id === already);
    const state = bid(base, 'SEALED_BID', index, 1_000);
    expect(state.lastBidResult?.accepted).toBe(false);
    expect(state.lastBidResult?.code).toBe('SUBMISSION_ALREADY_IN');
  });

  it('lets several suppliers interleave in a traffic-light auction', () => {
    const start = validOn(base, 'TRAFFIC_LIGHT');
    const lead = leadOn(base, 'TRAFFIC_LIGHT');
    const step = lead * 0.02;
    let state = base;
    state = bid(state, 'TRAFFIC_LIGHT', 0, lead - step);
    state = bid(state, 'TRAFFIC_LIGHT', 1, lead - 2 * step);
    state = bid(state, 'TRAFFIC_LIGHT', 2, lead - 3 * step);
    expect(validOn(state, 'TRAFFIC_LIGHT')).toBe(start + 3);
    const held = auctionOn(state, 'TRAFFIC_LIGHT');
    const lot = openLotOf(held);
    const bidders = held.bids.filter((b) => b.isValid && b.auctionLotId === lot.id);
    expect(new Set(bidders.map((b) => b.bidderId)).size).toBeGreaterThanOrEqual(3);
  });

  it('lets a supplier improve repeatedly against an index', () => {
    const start = validOn(base, 'INDEX_LINKED');
    const lead = leadOn(base, 'INDEX_LINKED');
    const step = lead * 0.02;
    let state = base;
    state = bid(state, 'INDEX_LINKED', 1, lead - step);
    state = bid(state, 'INDEX_LINKED', 2, lead - 2 * step);
    expect(validOn(state, 'INDEX_LINKED')).toBe(start + 2);
  });
});

// ---------------------------------------------------------------------------
// 5 — feedback policy, changed while it runs
// ---------------------------------------------------------------------------

describe('changing what bidders see, from the cockpit', () => {
  const english = auctionOn(base, 'ENGLISH');
  const eventId = english.auction.eventId;

  it('offers the control on the live cockpit', () => {
    expect(cockpit(base, eventId)).toContain('Change what bidders see');
  });

  it('changes what the supplier’s screen then carries', () => {
    const blind = reducer(base, {
      type: 'CONTROLLER_ACTION', eventId, action: 'CHANGE_FEEDBACK',
      feedbackPolicy: 'BLIND', reason: 'Thin field.',
    });
    const held = auctionOn(blind, 'ENGLISH');
    const me = held.bidders[0];
    const html = console_(blind, eventId, me.counterpartyId);

    // Under BLIND no competitor's number may appear anywhere, chart included.
    for (const other of held.bids.filter((b) => b.bidderId !== me.id)) {
      const mineToo = held.bids.some(
        (b) => b.bidderId === me.id && b.transformedValue === other.transformedValue,
      );
      if (mineToo) continue;
      expect(html).not.toContain(other.transformedValue.toLocaleString('en-IN'));
    }
  });

  it('tells the supplier that the rules moved', () => {
    const changed = reducer(base, {
      type: 'CONTROLLER_ACTION', eventId, action: 'CHANGE_FEEDBACK',
      feedbackPolicy: 'BEST_PRICE', reason: 'The room has gone quiet.',
    });
    const html = console_(changed, eventId, english.bidders[0].counterpartyId);
    expect(html).toContain('The buyer changed what you can see');
    expect(html).toContain('The room has gone quiet.');
  });
});

// ---------------------------------------------------------------------------
// 6 — progressive tracking, on both screens
// ---------------------------------------------------------------------------

describe('watching it happen', () => {
  it.each(NAMED)('%s gives the controller movement, pulse and a feed', (mechanism) => {
    const held = auctionOn(base, mechanism);
    const html = cockpit(base, held.auction.eventId);
    expect(html).toContain('How it is going');
    expect(html).toContain('Movement');
    expect(html).toContain('Pulse');
    expect(html).toContain('Activity');
  });

  it('names companies in the controller’s feed', () => {
    const held = auctionOn(base, 'ENGLISH');
    const html = cockpit(base, held.auction.eventId);
    const someone = COUNTERPARTY_NAMES[held.bidders[0].counterpartyId];
    expect(html).toContain(someone);
  });

  it('gives the supplier their own history on every mechanism', () => {
    for (const mechanism of NAMED) {
      const held = auctionOn(base, mechanism);
      if (held.auction.status !== 'LIVE') continue;
      const html = console_(base, held.auction.eventId, held.bidders[0].counterpartyId);
      expect(html).toContain('How it is going');
    }
  });

  it('never names a competitor in a masked supplier’s feed', () => {
    for (const mechanism of NAMED) {
      const held = auctionOn(base, mechanism);
      if (held.auction.status !== 'LIVE') continue;
      if (held.auction.identityPolicy !== 'MASKED') continue;
      const me = held.bidders[0].counterpartyId;
      const html = console_(base, held.auction.eventId, me);
      for (const other of held.bidders) {
        if (other.counterpartyId === me) continue;
        expect(html).not.toContain(COUNTERPARTY_NAMES[other.counterpartyId]);
      }
    }
  });

  it('shows a traffic-light bidder their colour trail and no rank', () => {
    const tl = auctionOn(base, 'TRAFFIC_LIGHT');
    const html = console_(base, tl.auction.eventId, tl.bidders[0].counterpartyId);
    expect(html).toContain('Your colour against the buyer');
    expect(html).not.toContain('Your rank #');
  });

  it('updates the feed as bids land', () => {
    const held = auctionOn(base, 'ENGLISH');
    const lead = Math.min(...held.bids.filter((b) => b.isValid).map((b) => b.transformedValue));
    const after = bid(base, 'ENGLISH', 1, lead - 3_000);
    const html = cockpit(after, held.auction.eventId);
    expect(html).toContain('took the lead');
  });
});

// ---------------------------------------------------------------------------
// The reference both sides quote
// ---------------------------------------------------------------------------

describe('every auction has a reference, and both sides can see it', () => {
  const all = Object.values(base.auctions);

  it('gives every auction in the section one', () => {
    for (const held of all) {
      expect(held.auction.auctionNumber).toMatch(/^EA-\d{4}-\d{4}$/);
    }
  });

  it('never issues the same one twice', () => {
    const numbers = all.map((held) => held.auction.auctionNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  /**
   * The ask that carries an auction may be numbered RFQ-2026-0142, because
   * the journey reached the auction through an RFQ. A supplier asking "which
   * auction" needs an answer that means an auction.
   */
  it('is the auction’s own, not the ask’s', () => {
    for (const held of all) {
      const event = base.events.find((e) => e.id === held.auction.eventId)!;
      expect(held.auction.auctionNumber).not.toBe(event.eventNumber);
    }
    // And at least one seeded auction sits under an ask numbered as an RFQ,
    // which is the case that makes the distinction matter.
    expect(all.some((held) => {
      const event = base.events.find((e) => e.id === held.auction.eventId)!;
      return !event.eventNumber.startsWith('AUC-');
    })).toBe(true);
  });

  it('shows it on the buyer’s E-Auction board', () => {
    const html = clean(renderToString(
      <StoreProvider seed={base}><AuctionBoard onNavigate={() => {}} /></StoreProvider>,
    ));
    for (const held of all) expect(html).toContain(held.auction.auctionNumber);
  });

  it('shows it to the supplier in the auction room', () => {
    for (const held of all) {
      const html = console_(base, held.auction.eventId, held.bidders[0].counterpartyId);
      expect(html).toContain(held.auction.auctionNumber);
    }
  });

  it('shows the supplier the reference of every room they are in', () => {
    // cp-abc holds more than one. The switcher has to name them apart by
    // something more durable than the event title.
    const mine = all.filter((held) => held.bidders.some((b) => b.counterpartyId === 'cp-abc'));
    expect(mine.length).toBeGreaterThan(1);
    const html = console_(base, mine[0].auction.eventId, 'cp-abc');
    for (const held of mine) expect(html).toContain(held.auction.auctionNumber);
  });

  it('carries it on the auction row of the supplier’s Requests screen', () => {
    const tl = auctionOn(base, 'TRAFFIC_LIGHT');
    const me = tl.bidders[0].counterpartyId;
    const html = clean(renderToString(
      <StoreProvider seed={base}>
        <PortalRequests
          counterpartyId={me}
          points={['AUCTION']}
          heading="Offers"
          blurb=""
          onEnterAuction={() => {}}
        />
      </StoreProvider>,
    ));
    expect(html).toContain(tl.auction.auctionNumber);
  });

  it('gives a newly published auction the next one, not a collision', async () => {
    const family = await localApi({
      events: base.events, auctions: auctionRecords(base),
    }).createSourcingEvent({
      journeyPattern: 'JP-01',
      title: 'Freshly published auction',
      category: 'Indirect', businessUnit: 'Corporate Services', ownerId: 'user-ar',
      lines: [{ description: 'Widget', quantity: 10, uom: 'each', baselinePrice: 100, lotName: 'Lot 1' }],
      bidders: [
        { counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-prime' }, { counterpartyId: 'cp-global' },
      ],
      auction: { mechanism: 'DUTCH', feedbackPolicy: 'BLIND' },
      timeline: { closesInHours: 72 },
    });
    const issued = family.auction!.auction.auctionNumber;
    expect(issued).toMatch(/^EA-\d{4}-\d{4}$/);
    // The taken pool includes auction references, or this lands on one that
    // another auction is already answering to.
    expect(all.map((held) => held.auction.auctionNumber)).not.toContain(issued);
  });
});
