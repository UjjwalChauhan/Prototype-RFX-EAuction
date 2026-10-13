/**
 * The rules of an auction, on the Setup pane and behind it.
 *
 * The pane used to show one fixed card of anti-gaming fields whatever the
 * mechanism was. Half of them did nothing in a Dutch auction and the two that
 * decide a Dutch auction — how fast the clock ticks, how far it may travel —
 * were constants in a panel where no buyer could reach them.
 *
 * So these assert both halves. That the pane offers the settings this
 * mechanism actually has and withholds the ones it cannot honour, and that a
 * setting the buyer changes reaches the thing it governs. A control that
 * renders and changes nothing is the failure mode this whole table exists to
 * prevent, and only the second half of that catches it.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuctionTab } from '../tabs/AuctionTab';
import { BiddingConsole } from '../../portal/BiddingConsole';
import { StoreProvider, initialState, reducer, type AppState } from '../../store/store';
import {
  AUCTION_SETTINGS, alignParameters, defaultParameters, numberParam,
  patchSetting, readSetting, settingsFor, settingsWithdrawn,
} from '../../domain/auctionRules';
import { MECHANISMS, MECHANISM_PROFILE } from '../../domain/auctionMechanics';
import { DEFAULT_ANTI_GAMING, placeBid } from '../../domain/auctionEngine';
import type { Auction, AuctionMechanism } from '../../domain/types';

const NOW = Date.now();

function auction(over: Partial<Auction> = {}): Auction {
  const mechanism = over.mechanism ?? 'ENGLISH';
  const profile = MECHANISM_PROFILE[mechanism];
  return {
    id: 'auc-1', auctionNumber: 'EA-2026-0001', eventId: 'evt-1', side: 'BUY',
    mechanism,
    clockOwner: profile.clockOwner,
    rounds: profile.rounds,
    feedbackPolicy: 'RANK_ONLY', identityPolicy: 'MASKED',
    lotStrategy: 'INDEPENDENT', biddingLevel: 'LOT',
    closePolicy: profile.defaultClosePolicy,
    transformation: 'NONE', proxyBidding: false,
    status: 'LIVE', startsAt: NOW - 60_000, endsAt: NOW + 3_600_000, extensionsUsed: 0,
    discloseTarget: false, trafficAmberBandPct: 5,
    antiGaming: { ...DEFAULT_ANTI_GAMING },
    parameters: defaultParameters(mechanism),
    startingPriceSource: 'Budget', targetPriceDerivation: null,
    ...over,
  };
}

const keys = (a: Auction, group?: 'CONDUCT' | 'PARAMETER') =>
  settingsFor(a, group).map((setting) => setting.key);

describe('which rules a mechanism actually has', () => {
  it('gives every mechanism something to configure', () => {
    for (const mechanism of MECHANISMS) {
      expect(keys(auction({ mechanism })).length, mechanism).toBeGreaterThan(0);
    }
  });

  it('withholds the improvement rules from a clock format, which never runs them', () => {
    // There is no standing bid to improve on: the clock sets the price and the
    // bidder only accepts it or stays in.
    for (const mechanism of ['DUTCH', 'JAPANESE'] as AuctionMechanism[]) {
      const shown = keys(auction({ mechanism }));
      expect(shown, mechanism).not.toContain('antiGaming.maxDecrementPct');
      expect(shown, mechanism).not.toContain('antiGaming.frontBufferPct');
      expect(shown, mechanism).not.toContain('antiGaming.confirmThresholdPct');
    }
  });

  it('withholds the soft close from a format that cannot extend', () => {
    // A Dutch auction ends on the first acceptance; there is no clock to push out.
    expect(keys(auction({ mechanism: 'DUTCH' }))).not.toContain('antiGaming.softCloseTriggerSec');
    expect(keys(auction({ mechanism: 'ENGLISH' }))).toContain('antiGaming.softCloseTriggerSec');
  });

  it('withholds the decrement from a single-shot format, which has nothing to improve on', () => {
    expect(keys(auction({ mechanism: 'SEALED_BID' }))).not.toContain('antiGaming.minDecrement');
    expect(keys(auction({ mechanism: 'ENGLISH' }))).toContain('antiGaming.minDecrement');
  });

  it('keeps what every auction needs, whatever the mechanism', () => {
    for (const mechanism of MECHANISMS) {
      const shown = keys(auction({ mechanism }));
      expect(shown, mechanism).toContain('antiGaming.minBiddersToStart');
      expect(shown, mechanism).toContain('antiGaming.tieBidPolicy');
    }
  });

  it('names the decrement for what it is in each mechanism', () => {
    const clock = AUCTION_SETTINGS.find((s) => s.key === 'antiGaming.minDecrement')!;
    // The same field is the clock step in a Dutch auction and a floor on
    // improvement in an English one. Calling both "minimum decrement" is how a
    // buyer sets the wrong number.
    expect(clock.label(auction({ mechanism: 'DUTCH' }))).toBe('Clock step');
    expect(clock.label(auction({ mechanism: 'ENGLISH' }))).toContain('decrement');
    expect(clock.label(auction({ mechanism: 'ENGLISH', side: 'SELL' }))).toContain('increment');
  });

  it('shows the amber band only where a traffic light is what bidders see', () => {
    expect(keys(auction({ feedbackPolicy: 'TRAFFIC_LIGHT' }))).toContain('trafficAmberBandPct');
    expect(keys(auction({ feedbackPolicy: 'RANK_ONLY' }))).not.toContain('trafficAmberBandPct');
  });

  it('gives each mechanism only its own parameters', () => {
    expect(keys(auction({ mechanism: 'DUTCH' }), 'PARAMETER'))
      .toEqual(['dutch.tickSeconds', 'dutch.limitPct']);
    expect(keys(auction({ mechanism: 'JAPANESE' }), 'PARAMETER'))
      .toEqual(['japanese.roundSeconds']);
    expect(keys(auction({ mechanism: 'ENGLISH' }), 'PARAMETER')).toEqual([]);
  });

  it('explains every rule twice — what it does, and what goes wrong without it', () => {
    for (const setting of AUCTION_SETTINGS) {
      const a = auction({ mechanism: 'ENGLISH' });
      // A locked control's hint is a statement — "Never permitted." — and
      // padding it out would make it read like a setting again.
      if (setting.locked === undefined) {
        expect(setting.hint(a).length, setting.key).toBeGreaterThan(20);
      }
      expect(setting.why(a).length, setting.key).toBeGreaterThan(40);
      // The second is not a restatement of the first.
      expect(setting.why(a), setting.key).not.toBe(setting.hint(a));
    }
  });

  it('accounts for what it withheld, rather than leaving a gap', () => {
    const gone = settingsWithdrawn(auction({ mechanism: 'DUTCH' })).map((s) => s.key);
    expect(gone).toContain('antiGaming.softCloseTriggerSec');
    expect(gone).toContain('antiGaming.maxDecrementPct');
  });
});

describe('reading and writing a rule', () => {
  it('writes to the right place without the caller knowing where that is', () => {
    const a = auction({ mechanism: 'DUTCH' });
    expect(patchSetting(a, 'antiGaming.frontBufferPct', 3).antiGaming?.frontBufferPct).toBe(3);
    expect(patchSetting(a, 'dutch.tickSeconds', 45).parameters?.['dutch.tickSeconds']).toBe(45);
    expect(patchSetting(a, 'trafficAmberBandPct', 9).trafficAmberBandPct).toBe(9);
  });

  it('reads a parameter back at its default when nothing has been stored', () => {
    const bare = auction({ mechanism: 'DUTCH', parameters: {} });
    expect(readSetting(bare, 'dutch.tickSeconds')).toBe(20);
    // A tick of zero is not a slow clock, it is a division by zero.
    expect(numberParam(auction({ mechanism: 'DUTCH', parameters: { 'dutch.tickSeconds': 0 } }), 'dutch.tickSeconds'))
      .toBe(20);
  });

  it('realigns the bag when the mechanism changes', () => {
    const dutch = auction({ mechanism: 'DUTCH', parameters: { 'dutch.tickSeconds': 45 } });
    const next = alignParameters({ ...dutch, mechanism: 'JAPANESE' });
    expect(next).toHaveProperty('japanese.roundSeconds');
    expect(next).not.toHaveProperty('dutch.tickSeconds');
  });
});

describe('a rule the buyer sets reaches the thing it governs', () => {
  const eventId = 'evt-sell-003';

  const withParameter = (key: string, value: number | boolean): AppState => {
    const base = initialState();
    const held = base.auctions[eventId];
    return reducer(base, {
      type: 'UPDATE_AUCTION',
      eventId,
      patch: { parameters: { ...held.auction.parameters, [key]: value } },
    });
  };

  const clean = (html: string) =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

  const cockpit = (state: AppState, id = eventId) => clean(renderToString(
    <StoreProvider seed={state}><AuctionTab eventId={id} /></StoreProvider>,
  ));

  it('moves the Dutch clock at the interval the buyer chose', () => {
    expect(cockpit(withParameter('dutch.tickSeconds', 45))).toContain('every 45 seconds');
    expect(cockpit(withParameter('dutch.tickSeconds', 5))).toContain('every 5 seconds');
  });

  it('tells the supplier the same interval, not a different one', () => {
    const state = withParameter('dutch.tickSeconds', 45);
    const bidder = state.auctions[eventId].bidders[0].counterpartyId;
    const html = clean(renderToString(
      <StoreProvider seed={state}>
        <BiddingConsole counterpartyId={bidder} eventId={eventId} />
      </StoreProvider>,
    ));
    expect(html).toContain('every 45 seconds');
  });

  it('stops the Dutch clock at the walk-away the buyer set', () => {
    // The seeded sell-side lot carries no floor, so the percentage decides it.
    const narrow = withParameter('dutch.limitPct', 10);
    const wide = withParameter('dutch.limitPct', 90);
    expect(cockpit(narrow)).not.toBe(cockpit(wide));
  });

  it('refuses a second sealed submission unless the buyer allowed one', () => {
    const base = initialState();
    const sealed = base.auctions['evt-rfq-039'];
    const lot = sealed.lots[0];
    const bidder = sealed.bidders.find(
      (b) => sealed.bids.some((bid) => bid.bidderId === b.id),
    )!;

    const attempt = (allow: boolean) => placeBid(
      {
        auction: { ...sealed.auction, parameters: { 'sealed.allowResubmission': allow } },
        auctionLot: lot,
        bidderId: bidder.id,
        bidValue: 1_000,
        existingBids: sealed.bids,
        costComponents: [],
        quantity: 1,
        lineCount: 1,
        lotCeiling: null,
        lotFloor: null,
        serverNow: NOW,
        confirmed: false,
      },
      { source: 'PORTAL', userId: 'u', clientTimestamp: null, ipHash: 'ip' },
    ).outcome;

    expect(attempt(false).accepted).toBe(false);
    expect(attempt(false).code).toBe('SUBMISSION_ALREADY_IN');
    expect(attempt(true).accepted).toBe(true);
  });

  it('publishes the multi-attribute weights only when the buyer says so', () => {
    const on = reducer(initialState(), {
      type: 'UPDATE_AUCTION',
      eventId: 'evt-rfp-012',
      patch: { parameters: { 'multiAttribute.publishWeights': false } },
    });
    expect(cockpit(on, 'evt-rfp-012')).toContain('NOT published');
    expect(cockpit(initialState(), 'evt-rfp-012')).toContain('published to bidders');
  });
});

describe('the Setup pane', () => {
  const clean = (html: string) =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
  /**
   * Setup is where an auction is configured. Once it is scheduled the tab
   * opens on the lobby instead, so this asks for the pane by name.
   */
  const setup = (eventId: string) => {
    const state = reducer(initialState(), {
      type: 'UPDATE_AUCTION', eventId, patch: { status: 'CONFIGURED' },
    });
    return clean(renderToString(
      <StoreProvider seed={state}><AuctionTab eventId={eventId} /></StoreProvider>,
    ));
  };

  it('offers a Dutch buyer the two numbers that decide a Dutch auction', () => {
    const html = setup('evt-sell-003');
    expect(html).toContain('Dutch parameters');
    expect(html).toContain('Clock tick');
    // Sell-side, so the limit is a reserve rather than a walk-away.
    expect(html).toContain('Reserve floor');
    // And the decrement is named for what it does here.
    expect(html).toContain('Clock step');
  });

  it('says where the rules it withheld went', () => {
    const html = setup('evt-sell-003');
    expect(html).toContain('cannot honour them');
    expect(html).toContain('Soft close trigger');
  });

  it('carries the reason behind every rule, not only its name', () => {
    expect(setup('evt-sell-003')).toContain('Why this matters');
  });

  it('shows the permanently-closed doors rather than hiding them', () => {
    const html = setup('evt-sell-003');
    expect(html).toContain('Allow bid withdrawal');
  });
});
