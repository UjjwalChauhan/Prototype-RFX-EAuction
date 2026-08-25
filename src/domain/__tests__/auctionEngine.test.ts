/**
 * The auction engine. These are the rules that decide who wins money, so each
 * anti-gaming control is tested for both the accepted and the rejected case.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ANTI_GAMING, checkCanStart, detectIdenticalBids, nextSequenceNumber,
  placeBid, rankLot, resetSequenceForTests, resolveProxies, validateBid,
  type BidAttempt,
} from '../auctionEngine';
import type { Auction, AuctionLot, Bid, CostComponent } from '../types';

const NOW = 1_700_000_000_000;

function auction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 'auc-1', eventId: 'evt-1', side: 'BUY',
    mechanism: 'ENGLISH', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
    feedbackPolicy: 'RANK_ONLY', identityPolicy: 'MASKED',
    lotStrategy: 'INDEPENDENT', biddingLevel: 'LOT', closePolicy: 'SOFT_EXTENSION',
    transformation: 'NONE', proxyBidding: false,
    status: 'LIVE', startsAt: NOW - 600_000, endsAt: NOW + 600_000,
    extensionsUsed: 0, discloseTarget: false, trafficAmberBandPct: 5,
    antiGaming: { ...DEFAULT_ANTI_GAMING },
    startingPriceSource: 'test', targetPriceDerivation: null,
    ...overrides,
  };
}

function lot(overrides: Partial<AuctionLot> = {}): AuctionLot {
  return {
    id: 'al-1', auctionId: 'auc-1', lotId: 'lot-1', status: 'LOT_OPEN',
    startingPrice: 150_000, opensAt: NOW - 600_000, closesAt: NOW + 600_000,
    ...overrides,
  };
}

function bid(overrides: Partial<Bid> = {}): Bid {
  return {
    id: `bid-${Math.random()}`, auctionId: 'auc-1', auctionLotId: 'al-1',
    lineItemId: null, bidderId: 'b1', bidValue: 145_000, transformedValue: 145_000,
    currency: 'USD', rankAtSubmission: 1, submittedAt: NOW - 60_000,
    source: 'PORTAL', submittedByUserId: 'u1', onBehalfReason: null,
    clientTimestamp: null, ipHash: 'ip-b1', isValid: true, rejectionReason: null,
    sequenceNumber: 1,
    ...overrides,
  };
}

function attempt(overrides: Partial<BidAttempt> = {}): BidAttempt {
  return {
    auction: auction(), auctionLot: lot(),
    lotCeiling: 160_000, lotFloor: 100_000,
    bidderId: 'b2', bidValue: 143_000,
    quantity: 1, lineCount: 1,
    serverNow: NOW, existingBids: [], costComponents: [],
    ...overrides,
  };
}

beforeEach(() => resetSequenceForTests(0));

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe('rankLot', () => {
  it('ranks on the transformed value, not the raw bid', () => {
    const bids = [
      // b1's raw bid is lowest, but its landed cost is highest.
      bid({ bidderId: 'b1', bidValue: 141_000, transformedValue: 149_850, sequenceNumber: 1 }),
      bid({ bidderId: 'b2', bidValue: 145_000, transformedValue: 147_200, sequenceNumber: 2 }),
    ];
    const rows = rankLot(bids, 'al-1', 'BUY');
    expect(rows.map((r) => r.bidderId)).toEqual(['b2', 'b1']);
    expect(rows[0].rank).toBe(1);
  });

  it('keeps only each bidder\'s best bid', () => {
    const bids = [
      bid({ bidderId: 'b1', bidValue: 149_000, transformedValue: 149_000, sequenceNumber: 1 }),
      bid({ bidderId: 'b1', bidValue: 143_000, transformedValue: 143_000, sequenceNumber: 2 }),
    ];
    const rows = rankLot(bids, 'al-1', 'BUY');
    expect(rows).toHaveLength(1);
    expect(rows[0].transformedValue).toBe(143_000);
    expect(rows[0].bidCount).toBe(2);
  });

  it('excludes rejected bids from the standing but keeps them in the ledger', () => {
    const bids = [
      bid({ bidderId: 'b1', transformedValue: 143_000, sequenceNumber: 1 }),
      bid({ bidderId: 'b2', transformedValue: 100_000, isValid: false, rejectionReason: 'below floor', sequenceNumber: 2 }),
    ];
    const rows = rankLot(bids, 'al-1', 'BUY');
    expect(rows.map((r) => r.bidderId)).toEqual(['b1']);
  });

  it('breaks a tie on sequence number, so the earlier bid leads', () => {
    const bids = [
      bid({ bidderId: 'b2', transformedValue: 143_000, sequenceNumber: 7, submittedAt: NOW }),
      bid({ bidderId: 'b1', transformedValue: 143_000, sequenceNumber: 3, submittedAt: NOW }),
    ];
    const rows = rankLot(bids, 'al-1', 'BUY', 'FIRST_IN_WINS');
    expect(rows[0].bidderId).toBe('b1');
  });

  it('inverts on SELL', () => {
    const bids = [
      bid({ bidderId: 'b1', transformedValue: 150_000, sequenceNumber: 1 }),
      bid({ bidderId: 'b2', transformedValue: 158_000, sequenceNumber: 2 }),
    ];
    expect(rankLot(bids, 'al-1', 'SELL')[0].bidderId).toBe('b2');
    expect(rankLot(bids, 'al-1', 'BUY')[0].bidderId).toBe('b1');
  });

  it('ignores bids on other lots', () => {
    const bids = [
      bid({ bidderId: 'b1', auctionLotId: 'al-2', transformedValue: 1, sequenceNumber: 1 }),
      bid({ bidderId: 'b2', auctionLotId: 'al-1', transformedValue: 143_000, sequenceNumber: 2 }),
    ];
    expect(rankLot(bids, 'al-1', 'BUY').map((r) => r.bidderId)).toEqual(['b2']);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateBid — state gates', () => {
  it('rejects while the auction is paused, not merely in the UI', () => {
    const outcome = validateBid(attempt({ auction: auction({ status: 'PAUSED' }) }));
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe('AUCTION_PAUSED');
  });

  it('rejects when the auction is not live', () => {
    expect(validateBid(attempt({ auction: auction({ status: 'SCHEDULED' }) })).code).toBe('AUCTION_NOT_LIVE');
    expect(validateBid(attempt({ auction: auction({ status: 'CLOSED' }) })).code).toBe('AUCTION_NOT_LIVE');
  });

  it('accepts while EXTENDED, because an extension is still open bidding', () => {
    expect(validateBid(attempt({ auction: auction({ status: 'EXTENDED' }) })).accepted).toBe(true);
  });

  it('rejects when the lot has not opened', () => {
    expect(validateBid(attempt({ auctionLot: lot({ status: 'LOT_PENDING' }) })).code).toBe('LOT_NOT_OPEN');
  });

  it('rejects a bid after the server-side deadline', () => {
    const outcome = validateBid(attempt({ serverNow: NOW + 700_000 }));
    expect(outcome.code).toBe('PAST_DEADLINE');
  });
});

describe('validateBid — hard bounds', () => {
  it('rejects above the ceiling and below the floor at entry', () => {
    expect(validateBid(attempt({ bidValue: 161_000 })).code).toBe('ABOVE_CEILING');
    expect(validateBid(attempt({ bidValue: 99_000 })).code).toBe('BELOW_FLOOR');
  });

  it('accepts exactly on the bound', () => {
    expect(validateBid(attempt({ bidValue: 160_000 })).accepted).toBe(true);
    expect(validateBid(attempt({ bidValue: 100_000, existingBids: [] })).accepted).toBe(true);
  });

  it('applies no bound when none is configured', () => {
    expect(validateBid(attempt({ bidValue: 5_000_000, lotCeiling: null, lotFloor: null })).accepted).toBe(true);
  });
});

describe('validateBid — improvement rules', () => {
  const leading = [bid({ bidderId: 'b1', bidValue: 145_000, transformedValue: 145_000, sequenceNumber: 1 })];

  it('rejects a bid that does not improve on the lead', () => {
    const outcome = validateBid(attempt({ bidValue: 146_000, existingBids: leading }));
    expect(outcome.code).toBe('NOT_AN_IMPROVEMENT');
  });

  it('rejects an equal bid', () => {
    expect(validateBid(attempt({ bidValue: 145_000, existingBids: leading })).code).toBe('NOT_AN_IMPROVEMENT');
  });

  it('rejects a decrement below the minimum', () => {
    // 1% of 145,000 is 1,450; a 500 improvement is short of it.
    const outcome = validateBid(attempt({ bidValue: 144_500, existingBids: leading }));
    expect(outcome.code).toBe('BELOW_MIN_DECREMENT');
  });

  it('accepts a decrement exactly at the minimum', () => {
    expect(validateBid(attempt({ bidValue: 143_550, existingBids: leading })).accepted).toBe(true);
  });

  it('supports an absolute minimum decrement', () => {
    const absolute = auction({
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'ABSOLUTE', minDecrement: 2_000 },
    });
    expect(validateBid(attempt({ auction: absolute, bidValue: 144_000, existingBids: leading })).code)
      .toBe('BELOW_MIN_DECREMENT');
    expect(validateBid(attempt({ auction: absolute, bidValue: 143_000, existingBids: leading })).accepted)
      .toBe(true);
  });

  it('rejects an improvement beyond the maximum guard', () => {
    // A 26% drop trips the 25% fat-finger guard.
    const outcome = validateBid(attempt({ bidValue: 107_000, existingBids: leading }));
    expect(outcome.code).toBe('ABOVE_MAX_DECREMENT');
  });

  it('demands typed confirmation for a large but legal improvement', () => {
    // 15% improvement: past the 10% confirm threshold, inside the 25% guard.
    const outcome = validateBid(attempt({ bidValue: 123_000, existingBids: leading }));
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe('NEEDS_TYPED_CONFIRMATION');
    expect(outcome.requiresConfirmation).toBe(true);
  });

  it('accepts the same bid once confirmed', () => {
    const outcome = validateBid(attempt({ bidValue: 123_000, existingBids: leading, confirmed: true }));
    expect(outcome.accepted).toBe(true);
  });

  it('refuses a rebid from the bidder already holding the lead', () => {
    const outcome = validateBid(attempt({ bidderId: 'b1', bidValue: 140_000, existingBids: leading }));
    expect(outcome.code).toBe('REBID_ON_OWN_LEAD');
  });

  it('enforces the front buffer when one is set', () => {
    const buffered = auction({
      antiGaming: { ...DEFAULT_ANTI_GAMING, frontBufferPct: 5, minDecrement: 0.1 },
    });
    // A 1% improvement lands inside a 5% buffer ahead of the lead.
    expect(validateBid(attempt({ auction: buffered, bidValue: 143_550, existingBids: leading })).code)
      .toBe('INSIDE_FRONT_BUFFER');
    // A 6% improvement clears it.
    expect(validateBid(attempt({ auction: buffered, bidValue: 136_300, existingBids: leading })).accepted)
      .toBe(true);
  });

  it('inverts the improvement test on SELL', () => {
    const sell = auction({ side: 'SELL' });
    const sellLead = [bid({ bidderId: 'b1', bidValue: 150_000, transformedValue: 150_000, sequenceNumber: 1 })];
    // Lower is worse on SELL.
    expect(validateBid(attempt({ auction: sell, bidValue: 148_000, existingBids: sellLead, lotCeiling: null }))
      .code).toBe('NOT_AN_IMPROVEMENT');
    // Higher is better, and 3.3% clears the 1% minimum.
    expect(validateBid(attempt({ auction: sell, bidValue: 155_000, existingBids: sellLead, lotCeiling: null }))
      .accepted).toBe(true);
  });

  it('applies no improvement rule to a single-shot mechanism', () => {
    const sealed = auction({ mechanism: 'SEALED_BID', rounds: 'SINGLE', closePolicy: 'REVEAL_AT_TIME' });
    // A worse-than-leading sealed bid is still a valid submission.
    expect(validateBid(attempt({ auction: sealed, bidValue: 149_000, existingBids: leading })).accepted)
      .toBe(true);
  });

  it('ranks against the transformed value when transformation is on', () => {
    const transforming = auction({ transformation: 'SUPPLIER_SPECIFIC' });
    const components: CostComponent[] = [{
      id: 'cc-1', eventId: 'evt-1', name: 'Freight', basis: 'LUMP_SUM',
      valueByBidder: { b2: 10_000 }, source: 'test', agentProposed: false,
    }];
    // 143,000 + 10,000 freight = 153,000, which is worse than the 145,000 lead.
    const outcome = validateBid(attempt({
      auction: transforming, bidValue: 143_000, existingBids: leading, costComponents: components,
    }));
    expect(outcome.code).toBe('NOT_AN_IMPROVEMENT');
  });
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

describe('placeBid', () => {
  it('appends an accepted bid with a server timestamp and a sequence number', () => {
    const result = placeBid(attempt(), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: NOW + 90_000, ipHash: 'ip-b2',
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.bid).not.toBeNull();
    expect(result.bid!.submittedAt).toBe(NOW);
    // The client clock is stored but never used as authority.
    expect(result.bid!.clientTimestamp).toBe(NOW + 90_000);
    expect(result.bid!.sequenceNumber).toBeGreaterThan(0);
  });

  it('writes a rejected attempt to the ledger, marked invalid with its reason', () => {
    const result = placeBid(attempt({ bidValue: 200_000 }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.outcome.accepted).toBe(false);
    expect(result.bid).not.toBeNull();
    expect(result.bid!.isValid).toBe(false);
    expect(result.bid!.rejectionReason).toBeTruthy();
  });

  it('does not write a bid that is merely awaiting confirmation', () => {
    const leading = [bid({ bidderId: 'b1', transformedValue: 145_000, sequenceNumber: 1 })];
    const result = placeBid(attempt({ bidValue: 123_000, existingBids: leading }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.bid).toBeNull();
    expect(result.outcome.requiresConfirmation).toBe(true);
  });

  it('extends the clock when a bid lands inside the soft-close window', () => {
    const closing = lot({ closesAt: NOW + 60_000 });
    const result = placeBid(attempt({ auctionLot: closing }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.extendedTo).toBe(NOW + 60_000 + 120_000);
  });

  it('does not extend when the bid is comfortably before the close', () => {
    const result = placeBid(attempt(), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.extendedTo).toBeNull();
  });

  it('does not extend under a hard close, so sniping succeeds there', () => {
    const hard = auction({ closePolicy: 'HARD' });
    const result = placeBid(attempt({ auction: hard, auctionLot: lot({ closesAt: NOW + 5_000 }) }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.extendedTo).toBeNull();
  });

  it('respects a cap on the number of extensions', () => {
    const capped = auction({
      extensionsUsed: 3,
      antiGaming: { ...DEFAULT_ANTI_GAMING, maxExtensions: 3 },
    });
    const result = placeBid(attempt({ auction: capped, auctionLot: lot({ closesAt: NOW + 30_000 }) }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.extendedTo).toBeNull();
  });

  it('flags a bid placed inside the sniping threshold', () => {
    const result = placeBid(attempt({ auctionLot: lot({ closesAt: NOW + 8_000 }) }), {
      source: 'PORTAL', userId: 'u1', clientTimestamp: null, ipHash: 'ip-b2',
    });
    expect(result.integrityFlags.some((f) => f.kind === 'SNIPING')).toBe(true);
  });

  it('records an on-behalf reason on the bid', () => {
    const result = placeBid(attempt(), {
      source: 'ON_BEHALF', userId: 'buyer-1', clientTimestamp: null, ipHash: 'ip-buyer',
      onBehalfReason: 'Supplier phoned; portal unreachable',
    });
    expect(result.bid!.source).toBe('ON_BEHALF');
    expect(result.bid!.onBehalfReason).toBe('Supplier phoned; portal unreachable');
  });
});

describe('nextSequenceNumber', () => {
  it('is monotonic, so a millisecond collision still resolves deterministically', () => {
    resetSequenceForTests(0);
    const first = nextSequenceNumber();
    const second = nextSequenceNumber();
    expect(second).toBeGreaterThan(first);
  });
});

// ---------------------------------------------------------------------------
// Integrity and start guards
// ---------------------------------------------------------------------------

describe('detectIdenticalBids', () => {
  it('flags two bidders at the same value inside the window', () => {
    const bids = [
      bid({ bidderId: 'b1', bidValue: 143_000, submittedAt: NOW }),
      bid({ bidderId: 'b2', bidValue: 143_000, submittedAt: NOW + 2_000 }),
    ];
    expect(detectIdenticalBids(bids, 5)).toHaveLength(1);
  });

  it('does not flag the same bidder repeating a value', () => {
    const bids = [
      bid({ bidderId: 'b1', bidValue: 143_000, submittedAt: NOW }),
      bid({ bidderId: 'b1', bidValue: 143_000, submittedAt: NOW + 1_000 }),
    ];
    expect(detectIdenticalBids(bids, 5)).toHaveLength(0);
  });

  it('does not flag identical values outside the window', () => {
    const bids = [
      bid({ bidderId: 'b1', bidValue: 143_000, submittedAt: NOW }),
      bid({ bidderId: 'b2', bidValue: 143_000, submittedAt: NOW + 60_000 }),
    ];
    expect(detectIdenticalBids(bids, 5)).toHaveLength(0);
  });
});

describe('checkCanStart', () => {
  it('warns but permits below the minimum under WARN_AND_JUSTIFY', () => {
    const check = checkCanStart(auction(), 2, 2, true);
    expect(check.canStart).toBe(true);
    expect(check.requiresJustification).toBe(true);
    expect(check.warnings.length).toBeGreaterThan(0);
  });

  it('blocks below the minimum under BLOCK', () => {
    const blocking = auction({
      antiGaming: { ...DEFAULT_ANTI_GAMING, belowMinPolicy: 'BLOCK' },
    });
    const check = checkCanStart(blocking, 2, 2, true);
    expect(check.canStart).toBe(false);
    expect(check.blockers.length).toBeGreaterThan(0);
  });

  it('warns that fewer than three bidders is the wrong instrument', () => {
    const check = checkCanStart(auction(), 2, 2, true);
    expect(check.warnings.some((w) => w.includes('not the right instrument'))).toBe(true);
  });

  it('warns about registered bidders who have not joined', () => {
    const check = checkCanStart(auction(), 3, 5, true);
    expect(check.warnings.some((w) => w.includes('have not joined'))).toBe(true);
  });

  it('warns when a dry run is outstanding', () => {
    const check = checkCanStart(auction(), 4, 4, false);
    expect(check.warnings.some((w) => w.includes('dry run'))).toBe(true);
  });

  it('is clean with a healthy field', () => {
    const check = checkCanStart(auction(), 5, 5, true);
    expect(check.canStart).toBe(true);
    expect(check.warnings).toHaveLength(0);
  });
});

describe('resolveProxies', () => {
  const instruction = {
    id: 'p1', auctionId: 'auc-1', auctionLotId: 'al-1', bidderId: 'b1',
    ceiling: 140_000, step: 500, active: true,
  };

  it('improves by one step on BUY without crossing the ceiling', () => {
    expect(resolveProxies([instruction], 145_000, 'BUY')).toEqual([
      { bidderId: 'b1', bidValue: 144_500 },
    ]);
  });

  it('stops rather than crossing the ceiling', () => {
    expect(resolveProxies([instruction], 140_200, 'BUY')).toEqual([]);
  });

  it('bids exactly at the ceiling when the step lands there', () => {
    expect(resolveProxies([instruction], 140_500, 'BUY')).toEqual([
      { bidderId: 'b1', bidValue: 140_000 },
    ]);
  });

  it('ignores an inactive instruction', () => {
    expect(resolveProxies([{ ...instruction, active: false }], 145_000, 'BUY')).toEqual([]);
  });

  it('moves upward on SELL, capped by the ceiling', () => {
    const sellProxy = { ...instruction, ceiling: 160_000 };
    expect(resolveProxies([sellProxy], 155_000, 'SELL')).toEqual([
      { bidderId: 'b1', bidValue: 155_500 },
    ]);
    expect(resolveProxies([sellProxy], 159_900, 'SELL')).toEqual([]);
  });
});
