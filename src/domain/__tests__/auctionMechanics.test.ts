/**
 * What each mechanism is, as rules rather than as screens.
 *
 * The assertions that matter here are about contradiction and consequence: a
 * sealed bid that reports a position is not sealed, a Dutch auction has no
 * time to extend, a Japanese proxy has no price to bid, and a second-price
 * award is a different number from the winning bid. Every one of those is a
 * way to lose money or a supplier, and all of them used to be enforced by
 * nothing but the shape of a screen.
 */
import { describe, expect, it } from 'vitest';
import {
  MECHANISMS, MECHANISM_PROFILE, asksForAPrice, availableActions, bidderRules,
  biddingOpen, compositeScore, dropOutLadder, dutchClock, howItWorks, indexedPrice,
  japaneseClockPrice, mechanismIssues, nextTurn, settleJapaneseRound, turnOrder,
  vickreyAward, type ScoredAttribute,
} from '../auctionMechanics';
import { DEFAULT_ANTI_GAMING } from '../auctionEngine';
import { defaultParameters } from '../auctionRules';
import type { Auction, AuctionMechanism, Side } from '../types';

const NOW = Date.UTC(2026, 8, 16, 9, 0, 0);

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
    status: 'LIVE', startsAt: NOW, endsAt: NOW + 3_600_000, extensionsUsed: 0,
    discloseTarget: false, trafficAmberBandPct: 5,
    antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 2 },
    parameters: defaultParameters(mechanism),
    startingPriceSource: 'Budget', targetPriceDerivation: null,
    ...over,
  };
}

const keys = (a: Auction, ctx = { hasPendingLot: false }) =>
  availableActions(a, ctx).map((action) => action.key);

describe('the library of mechanisms', () => {
  it('describes all ten', () => {
    expect(MECHANISMS).toHaveLength(10);
    for (const mechanism of MECHANISMS) {
      expect(MECHANISM_PROFILE[mechanism].label.length).toBeGreaterThan(0);
      expect(MECHANISM_PROFILE[mechanism].summary('BUY').length).toBeGreaterThan(0);
    }
  });

  it('ships Vickrey off, and says so rather than hiding it', () => {
    expect(MECHANISM_PROFILE.VICKREY.enabledByDefault).toBe(false);
    const issue = mechanismIssues(auction({ mechanism: 'VICKREY' }))
      .find((i) => i.field === 'mechanism')!;
    expect(issue.blocking).toBe(false);
    expect(issue.message).toContain('off by default');
  });

  it('reads direction from side rather than from the name', () => {
    const buy = MECHANISM_PROFILE.DUTCH.summary('BUY');
    const sell = MECHANISM_PROFILE.DUTCH.summary('SELL');
    expect(buy).toContain('rises');
    expect(sell).toContain('falls');
  });

  it('knows which formats ask for a number at all', () => {
    expect(asksForAPrice('ENGLISH')).toBe(true);
    expect(asksForAPrice('SEALED_BID')).toBe(true);
    // A clock sets the price; the bidder only stays or takes it.
    expect(asksForAPrice('JAPANESE')).toBe(false);
    expect(asksForAPrice('DUTCH')).toBe(false);
  });
});

describe('configuration the mechanism cannot honour', () => {
  it('refuses a sealed bid that reports a position', () => {
    const issues = mechanismIssues(auction({ mechanism: 'SEALED_BID', feedbackPolicy: 'RANK_ONLY' }));
    const blocking = issues.find((i) => i.field === 'feedbackPolicy')!;
    expect(blocking.blocking).toBe(true);
    expect(blocking.message).toContain('not sealed');
  });

  it('refuses a Dutch auction that reports anything', () => {
    expect(
      mechanismIssues(auction({ mechanism: 'DUTCH', feedbackPolicy: 'BEST_PRICE' }))
        .some((i) => i.blocking),
    ).toBe(true);
    expect(
      mechanismIssues(auction({ mechanism: 'DUTCH', feedbackPolicy: 'BLIND' }))
        .some((i) => i.blocking),
    ).toBe(false);
  });

  it('refuses a traffic-light auction with any other feedback', () => {
    expect(
      mechanismIssues(auction({ mechanism: 'TRAFFIC_LIGHT', feedbackPolicy: 'RANK_GAP' }))
        .some((i) => i.blocking),
    ).toBe(true);
  });

  it('refuses a clock owner the mechanism contradicts', () => {
    const issue = mechanismIssues(auction({ mechanism: 'DUTCH', feedbackPolicy: 'BLIND', clockOwner: 'BIDDER' }))
      .find((i) => i.field === 'clockOwner')!;
    expect(issue.blocking).toBe(true);
    // Getting this wrong inverts every directional label on both applications.
    expect(issue.message).toContain('direction derives wrongly');
  });

  it('warns about a proxy in a format with no price to proxy', () => {
    const issue = mechanismIssues(
      auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND', proxyBidding: true }),
    ).find((i) => i.field === 'proxyBidding')!;
    expect(issue.blocking).toBe(false);
    expect(issue.message).toContain('no number to automate');
  });

  it('passes a coherent configuration', () => {
    expect(mechanismIssues(auction()).filter((i) => i.blocking)).toEqual([]);
    expect(
      mechanismIssues(auction({ mechanism: 'SEALED_BID', feedbackPolicy: 'BLIND' }))
        .filter((i) => i.blocking),
    ).toEqual([]);
  });
});

describe('what the controller may do', () => {
  it('gives an English auction the universal set and nothing more', () => {
    expect(keys(auction())).toEqual([
      'BROADCAST', 'EXTEND', 'PAUSE', 'FORCE_CLOSE', 'ABORT',
    ]);
  });

  it('gives a Japanese auction a round to advance', () => {
    const open = availableActions(auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND' }), {
      hasPendingLot: false, windowOpen: false,
    });
    expect(open.map((a) => a.key)).toContain('ADVANCE_ROUND');
    expect(open.find((a) => a.key === 'ADVANCE_ROUND')!.hint).toContain('is out');
  });

  it('gives a Dutch auction a clock to hold, and no time to extend', () => {
    const acts = keys(auction({ mechanism: 'DUTCH', feedbackPolicy: 'BLIND' }));
    expect(acts).toContain('HOLD_CLOCK');
    // The clock *is* the auction; there is nothing to add minutes to.
    expect(acts).not.toContain('EXTEND');
  });

  it('offers to restart a held clock rather than to hold it twice', () => {
    const acts = availableActions(
      auction({ mechanism: 'DUTCH', feedbackPolicy: 'BLIND' }),
      { hasPendingLot: false, clockHeld: true },
    ).map((a) => a.key);
    expect(acts).toContain('RESUME_CLOCK');
    expect(acts).not.toContain('HOLD_CLOCK');
  });

  it('offers the envelopes once, and not after they are open', () => {
    const sealed = auction({ mechanism: 'SEALED_BID', feedbackPolicy: 'BLIND' });
    expect(keys(sealed)).toContain('OPEN_ENVELOPES');
    expect(
      availableActions(sealed, { hasPendingLot: false, revealed: true }).map((a) => a.key),
    ).not.toContain('OPEN_ENVELOPES');
  });

  it('makes opening the envelopes an irreversible, reasoned act', () => {
    const open = availableActions(auction({ mechanism: 'SEALED_BID', feedbackPolicy: 'BLIND' }))
      .find((a) => a.key === 'OPEN_ENVELOPES')!;
    expect(open.typedConfirmation).toBe(true);
    expect(open.reasonRequired).toBe(true);
  });

  it('hands over turns in a turn-based format', () => {
    const acts = availableActions(auction({ mechanism: 'RANK_COMPRESSION' }), {
      hasPendingLot: false, windowOpen: true,
    }).map((a) => a.key);
    expect(acts).toContain('CALL_TURN');
    expect(acts).toContain('SKIP_TURN');
  });

  it('offers the next lot only on a serial strategy that has one', () => {
    expect(keys(auction({ lotStrategy: 'SERIAL' }), { hasPendingLot: true })).toContain('OPEN_NEXT_LOT');
    expect(keys(auction({ lotStrategy: 'SERIAL' }), { hasPendingLot: false })).not.toContain('OPEN_NEXT_LOT');
    expect(keys(auction({ lotStrategy: 'PARALLEL' }), { hasPendingLot: true })).not.toContain('OPEN_NEXT_LOT');
  });

  it('offers only resume, message and abort while paused', () => {
    expect(keys(auction({ status: 'PAUSED' }))).toEqual(['RESUME', 'BROADCAST', 'ABORT']);
  });

  it('offers only the start before it starts, and nothing after it ends', () => {
    // An auction published from a journey is configured and scheduled, not
    // running. Offering nothing here left it that way for ever: the board said
    // "waiting on you" and the cockpit had no button to be waiting for.
    expect(keys(auction({ status: 'SCHEDULED' }))).toEqual(['OPEN', 'BROADCAST', 'ABORT']);
    expect(keys(auction({ status: 'LOBBY_OPEN' }))).toContain('OPEN');
    expect(keys(auction({ status: 'CLOSED' }))).toEqual([]);
  });

  it('stops offering the start once it has started', () => {
    expect(keys(auction({ status: 'LIVE' }))).not.toContain('OPEN');
    expect(keys(auction({ status: 'PAUSED' }))).not.toContain('OPEN');
  });

  it('requires a typed confirmation to end or void an auction', () => {
    const acts = availableActions(auction());
    expect(acts.find((a) => a.key === 'FORCE_CLOSE')!.typedConfirmation).toBe(true);
    expect(acts.find((a) => a.key === 'ABORT')!.typedConfirmation).toBe(true);
    expect(acts.find((a) => a.key === 'BROADCAST')!.typedConfirmation).toBe(false);
  });
});

describe('Japanese', () => {
  it('steps the clock away from the bidder each round', () => {
    const a = auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND' });
    expect(japaneseClockPrice(a, 100_000, 1)).toBe(100_000);
    expect(japaneseClockPrice(a, 100_000, 2)).toBe(98_000);
    expect(japaneseClockPrice(a, 100_000, 3)).toBeCloseTo(96_040, 0);
  });

  it('steps the other way on a sell-side event', () => {
    const a = auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND', side: 'SELL' as Side });
    expect(japaneseClockPrice(a, 100_000, 2)).toBe(102_000);
  });

  it('puts out anyone who did not confirm, at the price they last held', () => {
    const before = {
      round: 3, clockPrice: 96_000,
      confirmed: ['b1'], standing: ['b1', 'b2', 'b3'],
      exited: [], settled: false, winnerId: null,
    };
    const after = settleJapaneseRound(before, NOW);
    expect(after.standing).toEqual(['b1']);
    expect(after.exited.map((e) => e.bidderId)).toEqual(['b2', 'b3']);
    expect(after.exited[0].price).toBe(96_000);
    expect(after.settled).toBe(true);
    expect(after.winnerId).toBe('b1');
  });

  it('builds the drop-out ladder in the order they left', () => {
    const ladder = dropOutLadder({
      round: 4, clockPrice: 90_000, confirmed: [], standing: ['b1'],
      exited: [
        { bidderId: 'b3', price: 98_000, round: 2, at: NOW + 200 },
        { bidderId: 'b2', price: 94_000, round: 3, at: NOW + 100 },
      ],
      settled: true, winnerId: 'b1',
    });
    // The ladder is the format's product: where each supplier's floor sits.
    expect(ladder.map((e) => e.bidderId)).toEqual(['b3', 'b2']);
    expect(ladder.map((e) => e.position)).toEqual([1, 2]);
  });
});

describe('Dutch', () => {
  const a = auction({
    mechanism: 'DUTCH', feedbackPolicy: 'BLIND',
    antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'ABSOLUTE', minDecrement: 1_000 },
  });

  it('computes the price from the start time, so a late joiner sees the same number', () => {
    expect(dutchClock(a, 100_000, 130_000, 20, NOW).price).toBe(100_000);
    expect(dutchClock(a, 100_000, 130_000, 20, NOW + 60_000).price).toBe(103_000);
    // Two clients, same instant, same answer — a counted clock drifts, and a
    // drifting clock decides a first-acceptance auction.
    expect(dutchClock(a, 100_000, 130_000, 20, NOW + 61_000).price)
      .toBe(dutchClock(a, 100_000, 130_000, 20, NOW + 69_000).price);
  });

  it('stops at the buyer’s limit and says so', () => {
    const clock = dutchClock(a, 100_000, 105_000, 20, NOW + 60 * 60_000);
    expect(clock.price).toBe(105_000);
    expect(clock.atLimit).toBe(true);
  });

  it('walks the other way on a sell-side event', () => {
    const sell = { ...a, side: 'SELL' as Side };
    expect(dutchClock(sell, 100_000, 70_000, 20, NOW + 60_000).price).toBe(97_000);
  });
});

describe('Vickrey', () => {
  it('awards the best bidder at the second-best price', () => {
    const result = vickreyAward(
      [{ bidderId: 'b1', value: 90 }, { bidderId: 'b2', value: 95 }, { bidderId: 'b3', value: 110 }],
      'BUY',
    )!;
    expect(result.winnerId).toBe('b1');
    expect(result.winningBid).toBe(90);
    // The two are different numbers, and the order must carry the second.
    expect(result.awardPrice).toBe(95);
  });

  it('awards a single bidder at their own price, there being no second', () => {
    expect(vickreyAward([{ bidderId: 'b1', value: 90 }], 'BUY')!.awardPrice).toBe(90);
  });

  it('inverts on a sell-side event', () => {
    const result = vickreyAward(
      [{ bidderId: 'b1', value: 90 }, { bidderId: 'b2', value: 120 }], 'SELL',
    )!;
    expect(result.winnerId).toBe('b2');
    expect(result.awardPrice).toBe(90);
  });
});

describe('rank compression', () => {
  it('puts the worst position first', () => {
    const order = turnOrder(
      [
        { bidderId: 'lead', transformedValue: 90 },
        { bidderId: 'last', transformedValue: 130 },
        { bidderId: 'mid', transformedValue: 110 },
      ],
      'BUY',
    );
    expect(order).toEqual(['last', 'mid', 'lead']);
  });

  it('runs out of turns rather than looping silently', () => {
    const state = { order: ['a', 'b'], activeBidderId: 'b', turnEndsAt: null, round: 1, passed: [] };
    expect(nextTurn(state)).toBeNull();
    expect(nextTurn({ ...state, activeBidderId: null })).toBe('a');
  });
});

describe('multi-attribute', () => {
  const scheme: ScoredAttribute[] = [
    { key: 'price', label: 'Price', unit: '₹', weight: 60, betterIs: 'LOWER', best: 100, worst: 200 },
    { key: 'lead', label: 'Lead time', unit: 'days', weight: 40, betterIs: 'LOWER', best: 5, worst: 25 },
  ];

  it('normalises weights and shows what each attribute contributed', () => {
    const score = compositeScore({ price: 100, lead: 25 }, scheme);
    expect(score.contributions.map((c) => c.weight)).toEqual([60, 40]);
    expect(score.contributions[0].score).toBe(100);
    expect(score.contributions[1].score).toBe(0);
    expect(score.total).toBeCloseTo(60, 5);
  });

  it('lets a better lead time beat a cheaper price', () => {
    const cheap = compositeScore({ price: 100, lead: 25 }, scheme).total;
    const fast = compositeScore({ price: 160, lead: 5 }, scheme).total;
    expect(fast).toBeGreaterThan(cheap);
  });

  it('clamps an offer outside the declared range rather than scoring above 100', () => {
    expect(compositeScore({ price: 50, lead: 1 }, scheme).total).toBeCloseTo(100, 5);
  });
});

describe('index-linked', () => {
  it('resolves a premium to money', () => {
    const link = { name: 'X', source: 'Y', value: 200_000, asOf: NOW, offsetType: 'PCT' as const };
    expect(indexedPrice(link, 5)).toBe(210_000);
    expect(indexedPrice(link, -2.5)).toBe(195_000);
    expect(indexedPrice({ ...link, offsetType: 'ABSOLUTE' }, 1_500)).toBe(201_500);
  });
});

describe('what both screens read', () => {
  it('regenerates the explanation from the configuration', () => {
    const blind = howItWorks(auction({ feedbackPolicy: 'BLIND' })).join(' ');
    const full = howItWorks(auction({ feedbackPolicy: 'FULL_PRICE' })).join(' ');
    // Help that does not track the settings is worse than none — it is believed.
    expect(howItWorks(auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND' })).join(' '))
      .toContain('drop-out ladder');
    expect(blind).not.toBe(howItWorks(auction({ mechanism: 'DUTCH', feedbackPolicy: 'BLIND' })).join(' '));
    expect(full.length).toBeGreaterThan(0);
  });

  it('tells a Japanese bidder the consequence of doing nothing', () => {
    const rules = bidderRules(auction({ mechanism: 'JAPANESE', feedbackPolicy: 'BLIND' })).join(' ');
    expect(rules).toContain('out of this auction for good');
    expect(rules).toContain('cannot rejoin');
  });

  it('tells a Vickrey bidder the rule before they bid', () => {
    expect(bidderRules(auction({ mechanism: 'VICKREY', feedbackPolicy: 'BLIND' })).join(' '))
      .toContain('second-best price');
  });

  it('describes the feedback policy in the supplier’s words, never the code', () => {
    for (const policy of ['FULL_PRICE', 'BEST_PRICE', 'RANK_ONLY', 'RANK_GAP', 'TRAFFIC_LIGHT', 'BLIND'] as const) {
      const rules = bidderRules(auction({ feedbackPolicy: policy })).join(' ');
      expect(rules).not.toContain(policy);
      expect(rules).not.toContain('_');
    }
  });

  it('never promises a proxy in a format that has none', () => {
    for (const mechanism of MECHANISMS) {
      const profile = MECHANISM_PROFILE[mechanism];
      if (profile.proxySupported) continue;
      const rules = bidderRules(
        auction({ mechanism: mechanism as AuctionMechanism, feedbackPolicy: 'BLIND', proxyBidding: true }),
      ).join(' ');
      expect(rules).not.toContain('bid for you');
    }
  });
});

describe('whether a bidder may act', () => {
  it('opens only while it is running', () => {
    expect(biddingOpen('LIVE').open).toBe(true);
    expect(biddingOpen('EXTENDED').open).toBe(true);
    expect(biddingOpen('PAUSED').open).toBe(false);
    expect(biddingOpen('SCHEDULED').open).toBe(false);
  });

  it('says why in the supplier’s words, not in a status code', () => {
    expect(biddingOpen('PAUSED').reason).toContain('paused');
    expect(biddingOpen('ABORTED').reason).toContain('No result');
    for (const status of ['PAUSED', 'SCHEDULED', 'CLOSED', 'ABORTED', 'CANCELLED'] as const) {
      expect(biddingOpen(status).reason).not.toContain(status);
    }
  });
});
