/**
 * The auctions, over the API.
 *
 * The bug these exist for: a Dutch auction published from a requisition
 * created an ask and no auction, so it appeared on the sourcing board and
 * nowhere in the E-Auction section, and nothing a supplier could bid into
 * existed at all. The first test here is that publishing a journey with an
 * auction stage produces an auction.
 *
 * The rest are the boundary. `/standing` names everyone because a buyer is
 * entitled to that; `/bidder-view` goes through the feedback policy and must
 * not contain a competitor's number the policy forbids — not hidden in the
 * response, absent from it.
 */
import { describe, expect, it } from 'vitest';
import { Repository } from '../repository';
import { createRouter, type ApiRequest } from '../router';
import type { SourcingEventInput } from '../../domain/stageEvents';

/**
 * The window has to straddle the real clock.
 *
 * The router takes an injected `now`, but a bid is timed by `serverNow()` — the
 * server's own clock is the only authority on whether a window is open, and a
 * test that could pin it would be testing something the product does not do.
 * So the fixtures are built around the present moment rather than a fixed date.
 */
const NOW = Date.now();
const HOUR = 3_600_000;

let published = 0;

function api() {
  const repository = new Repository();
  const handle = createRouter({
    repository,
    now: () => NOW,
    // Distinct per publish: two events sharing an id prefix share their
    // bidder rows, and the roster is what half of these routes read.
    idPrefix: () => { published += 1; return `evt-t${published}`; },
  });
  return {
    repository,
    post: (path: string, body?: unknown) => handle({ method: 'POST', path, body }),
    get: (path: string, query: Record<string, string> = {}) =>
      handle({ method: 'GET', path, query } as ApiRequest),
  };
}

/** JP-01 — a requisition straight into a live auction. The reported case. */
function directAuction(over: Partial<SourcingEventInput> = {}): SourcingEventInput {
  return {
    journeyPattern: 'JP-01',
    title: 'Copier paper — direct auction',
    category: 'Office & Administrative',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    sourceReference: 'PRD-2026-0004',
    lines: [
      { description: 'A4 copier paper', quantity: 12_000, uom: 'ream', baselinePrice: 9, lotName: 'Lot 1 · Paper' },
      { description: 'Ballpoint pen', quantity: 900, uom: 'box', baselinePrice: 19, lotName: 'Lot 2 · Writing' },
    ],
    bidders: [
      { counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-global' }, { counterpartyId: 'cp-nova' },
    ],
    auction: { mechanism: 'DUTCH', feedbackPolicy: 'BLIND' },
    // Scheduled for later, which is what the wizard does: it opens the window
    // at the next whole hour. So it is published not-yet-running, and somebody
    // has to start it — the case the OPEN action exists for.
    timeline: { opensAt: NOW + 2 * HOUR, closesInHours: 72 },
    ...over,
  };
}

/** The same journey, open now, so a bid placed in this test is inside it. */
const openNow = (over: Partial<SourcingEventInput> = {}): SourcingEventInput =>
  directAuction({ timeline: { opensAt: NOW - HOUR, closesInHours: 72 }, ...over });

const auctionAskOf = (created: unknown) =>
  (created as { stageEvents: { id: string; currentStage: string }[] })
    .stageEvents.find((stage) => stage.currentStage === 'AUCTION')!;

describe('publishing a journey that runs an auction', () => {
  it('creates the auction, not only the ask it hangs off', () => {
    const { post } = api();
    const response = post('/api/sourcing-events', directAuction());
    expect(response.status).toBe(201);
    const body = response.body as { auction: { auction: { mechanism: string } } | null };
    expect(body.auction).not.toBeNull();
    expect(body.auction!.auction.mechanism).toBe('DUTCH');
  });

  it('puts it on the list every auction appears on', () => {
    const { post, get } = api();
    post('/api/sourcing-events', directAuction());
    const { auctions } = get('/api/auction-events').body as { auctions: { mechanism: string; eventNumber: string }[] };
    expect(auctions).toHaveLength(1);
    expect(auctions[0].mechanism).toBe('DUTCH');
    expect(auctions[0].eventNumber).toMatch(/^AUC-/);
  });

  it('opens each lot at the value of what is in it', () => {
    const { post, get } = api();
    const created = post('/api/sourcing-events', directAuction()).body;
    const detail = get(`/api/auction-events/${auctionAskOf(created).id}`).body as {
      lots: { name: string; startingPrice: number }[];
    };
    // 12,000 reams at ₹9 and 900 boxes at ₹19 — the requisition's own figures.
    expect(detail.lots.map((lot) => lot.startingPrice)).toEqual([108_000, 17_100]);
    expect(detail.lots[0].name).toBe('Lot 1 · Paper');
  });

  it('derives the clock and the close from the mechanism, not from a form', () => {
    const { post, get } = api();
    const created = post('/api/sourcing-events', directAuction()).body;
    const detail = get(`/api/auction-events/${auctionAskOf(created).id}`).body as {
      auction: { clockOwner: string; closePolicy: string; proxyBidding: boolean };
    };
    // A Dutch clock is the system's, it ends on the first acceptance, and there
    // is no price to proxy. None of those were asked for.
    expect(detail.auction.clockOwner).toBe('SYSTEM');
    expect(detail.auction.closePolicy).toBe('FIRST_ACCEPT');
    expect(detail.auction.proxyBidding).toBe(false);
  });

  it('refuses to publish a feedback policy the mechanism contradicts', () => {
    const { post, get } = api();
    const created = post(
      '/api/sourcing-events',
      directAuction({ auction: { mechanism: 'SEALED_BID', feedbackPolicy: 'FULL_PRICE' } }),
    ).body;
    const detail = get(`/api/auction-events/${auctionAskOf(created).id}`).body as {
      auction: { feedbackPolicy: string };
    };
    // A sealed bid that reports every price is not a sealed bid.
    expect(detail.auction.feedbackPolicy).toBe('BLIND');
  });

  it('creates nothing for a journey with no auction in it', () => {
    const { post, get } = api();
    const response = post('/api/sourcing-events', {
      ...directAuction(), journeyPattern: 'JP-02', auction: undefined,
    });
    expect(response.status).toBe(201);
    expect((response.body as { auction: unknown }).auction).toBeNull();
    expect((get('/api/auction-events').body as { auctions: unknown[] }).auctions).toEqual([]);
  });
});

describe('running it', () => {
  const started = () => {
    const harness = api();
    const created = harness.post('/api/sourcing-events', directAuction()).body;
    const eventId = auctionAskOf(created).id;
    return { ...harness, eventId };
  };

  it('starts scheduled, and says who it is waiting for', () => {
    const { get, eventId } = started();
    const row = (get('/api/auction-events').body as { auctions: { status: string; waitingOn: string }[] }).auctions[0];
    expect(row.status).toBe('SCHEDULED');
    expect(row.waitingOn).toContain('a controller starts it');
    expect(eventId).toContain('auction');
  });

  it('opens on a controller action, with the reason in the log', () => {
    const { post, get, eventId } = started();
    const response = post(`/api/auction-events/${eventId}/control`, {
      action: 'OPEN', actorId: 'user-mp', reason: 'Field is ready.',
    });
    expect(response.status).toBe(200);
    const detail = get(`/api/auction-events/${eventId}`).body as {
      auction: { status: string };
      lots: { status: string }[];
      controlEvents: { kind: string; reason: string }[];
    };
    expect(detail.auction.status).toBe('LIVE');
    expect(detail.lots[0].status).toBe('LOT_OPEN');
    expect(detail.controlEvents[0]).toMatchObject({ kind: 'OPENED', reason: 'Field is ready.' });
  });

  it('refuses a controller action this auction cannot be asked for', () => {
    const { post, eventId } = started();
    // A Dutch auction has no round to advance.
    const response = post(`/api/auction-events/${eventId}/control`, {
      action: 'ADVANCE_ROUND', actorId: 'user-mp', reason: 'Next.',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a controller action with no reason, because the log needs one', () => {
    const { post, eventId } = started();
    const response = post(`/api/auction-events/${eventId}/control`, {
      action: 'OPEN', actorId: 'user-mp', reason: '  ',
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('audit log');
  });
});

describe('bidding through the API', () => {
  const live = (over: Partial<SourcingEventInput> = {}) => {
    const harness = api();
    const created = harness.post('/api/sourcing-events', openNow(over)).body;
    return { ...harness, eventId: auctionAskOf(created).id };
  };

  it('takes a bid named by the supplier rather than by their invitation row', () => {
    const { post, eventId } = live();
    const response = post(`/api/auction-events/${eventId}/bids`, {
      counterpartyId: 'cp-abc', bidValue: 99_000,
    });
    expect(response.status).toBe(201);
    expect((response.body as { accepted: boolean }).accepted).toBe(true);
  });

  it('refuses a supplier who was never invited, by name', () => {
    const { post, eventId } = live();
    const response = post(`/api/auction-events/${eventId}/bids`, {
      counterpartyId: 'cp-not-invited', bidValue: 99_000,
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('invited');
  });

  it('answers a refused bid with the reason rather than an error', () => {
    // English, because a Dutch auction has no second bid to refuse — the
    // first acceptance closes it. See the Dutch case below.
    const { post, eventId } = live({ auction: { mechanism: 'ENGLISH', feedbackPolicy: 'RANK_ONLY' } });
    post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-abc', bidValue: 99_000 });
    // Worse than their own standing bid, on a buy-side auction.
    const response = post(`/api/auction-events/${eventId}/bids`, {
      counterpartyId: 'cp-abc', bidValue: 105_000,
    });
    expect(response.status).toBe(200);
    const body = response.body as { accepted: boolean; message: string | null };
    expect(body.accepted).toBe(false);
    expect(body.message).toBeTruthy();
  });

  /**
   * The format's whole proposition. Before this, the lot stayed open and the
   * second acceptance was refused by the improvement rule — "your bid must be
   * lower than the current leading bid" — which describes a competition a
   * Dutch auction does not hold, and gives the bidder nothing to act on.
   */
  it('closes a Dutch lot on the first acceptance', () => {
    const { post, get, eventId } = live();
    const first = post(`/api/auction-events/${eventId}/bids`, {
      counterpartyId: 'cp-abc', bidValue: 99_000,
    });
    expect((first.body as { accepted: boolean }).accepted).toBe(true);

    const detail = get(`/api/auction-events/${eventId}`).body as {
      lots: { status: string }[];
    };
    expect(detail.lots[0].status).toBe('LOT_CLOSED');

    const second = post(`/api/auction-events/${eventId}/bids`, {
      counterpartyId: 'cp-global', bidValue: 95_000,
    });
    const body = second.body as { accepted?: boolean; message?: string; error?: string };
    expect(body.accepted).not.toBe(true);
    // And it says the lot is shut, rather than asking for a better price.
    expect(`${body.message ?? body.error ?? ''}`.toLowerCase()).not.toContain('must be lower');
  });

  it('keeps the ledger, so the standing is answerable afterwards', () => {
    const { post, get, eventId } = live();
    post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-abc', bidValue: 99_000 });
    const standing = get(`/api/auction-events/${eventId}/standing`).body as {
      lots: { standing: { displayName: string; bidCount: number }[] }[];
    };
    const bidded = standing.lots[0].standing.filter((row) => row.bidCount > 0);
    expect(bidded).toHaveLength(1);
    expect(bidded[0].displayName).toBeTruthy();
  });
});

describe('the boundary between the two views', () => {
  const withBids = () => {
    const harness = api();
    const created = harness.post(
      '/api/sourcing-events',
      openNow({ auction: { mechanism: 'ENGLISH', feedbackPolicy: 'RANK_ONLY' } }),
    ).body;
    const eventId = auctionAskOf(created).id;
    harness.post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-abc', bidValue: 100_000 });
    harness.post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-global', bidValue: 97_000 });
    return { ...harness, eventId };
  };

  it('gives the buyer every name and every number', () => {
    const { get, eventId } = withBids();
    const json = JSON.stringify(get(`/api/auction-events/${eventId}/standing`).body);
    expect(json).toContain('97000');
    expect(json).toContain('100000');
  });

  it('never sends a bidder a competitor’s number the policy forbids', () => {
    const { get, eventId } = withBids();
    const response = get(`/api/auction-events/${eventId}/bidder-view`, { counterpartyId: 'cp-abc' });
    expect(response.status).toBe(200);
    const json = JSON.stringify(response.body);
    // cp-abc bid 100,000 and may see it. 97,000 is somebody else's, and under
    // rank-only it is not withheld on the page — it is not in the payload.
    expect(json).toContain('100000');
    expect(json).not.toContain('97000');
  });

  it('does not hand a rank-only bidder the price to beat, which is the same number', () => {
    const { get, eventId } = withBids();
    const body = get(`/api/auction-events/${eventId}/bidder-view`, { counterpartyId: 'cp-abc' }).body as {
      bidToBeat: number | null; requiredImprovement: number | null;
    };
    // 97,000 plus the decrement, and a bidder can invert it in one step.
    expect(body.bidToBeat).toBeNull();
    expect(body.requiredImprovement).toBeNull();
  });

  it('does hand it over where the policy discloses the leading price', () => {
    const harness = api();
    const created = harness.post('/api/sourcing-events', openNow({
      auction: { mechanism: 'ENGLISH', feedbackPolicy: 'BEST_PRICE' },
    })).body;
    const eventId = auctionAskOf(created).id;
    harness.post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-abc', bidValue: 100_000 });
    harness.post(`/api/auction-events/${eventId}/bids`, { counterpartyId: 'cp-global', bidValue: 97_000 });
    const body = harness.get(`/api/auction-events/${eventId}/bidder-view`, { counterpartyId: 'cp-abc' }).body as {
      bidToBeat: number | null;
    };
    expect(body.bidToBeat).not.toBeNull();
  });

  it('tells a bidder their own rank, which rank-only is for', () => {
    const { get, eventId } = withBids();
    const body = get(`/api/auction-events/${eventId}/bidder-view`, { counterpartyId: 'cp-abc' }).body as {
      projection: { ownRank: number | null };
    };
    expect(body.projection.ownRank).toBe(2);
  });

  it('refuses to answer for a supplier who is not in this auction', () => {
    const { get, eventId } = withBids();
    expect(get(`/api/auction-events/${eventId}/bidder-view`, { counterpartyId: 'cp-nowhere' }).status)
      .toBe(400);
  });
});

describe('finding an auction', () => {
  it('answers to the ask’s id and to the auction’s own', () => {
    const { post, get } = api();
    const created = post('/api/sourcing-events', directAuction()).body;
    const eventId = auctionAskOf(created).id;
    const byAsk = get(`/api/auction-events/${eventId}`).body as { auctionId: string };
    expect(get(`/api/auction-events/${byAsk.auctionId}`).status).toBe(200);
  });

  it('narrows to the auctions one supplier is actually in', () => {
    const { post, get } = api();
    post('/api/sourcing-events', directAuction());
    post('/api/sourcing-events', directAuction({
      title: 'Steel', bidders: [{ counterpartyId: 'cp-summit' }, { counterpartyId: 'cp-voltek' }],
    }));
    const mine = get('/api/auction-events', { counterpartyId: 'cp-summit' }).body as { auctions: unknown[] };
    expect(mine.auctions).toHaveLength(1);
  });

  it('says plainly when there is no auction on an event', () => {
    const { get } = api();
    expect(get('/api/auction-events/evt-nothing').status).toBe(404);
  });
});

/**
 * The reference an integrator joins on.
 *
 * `auctionId` is a slug; `auctionNumber` is what a person quotes. Both are on
 * the wire, because a client that has only the slug cannot show a supplier
 * anything they could read out over the phone.
 */
describe('the auction reference', () => {
  const live = () => {
    const harness = api();
    const created = harness.post('/api/sourcing-events', openNow()).body;
    return { ...harness, eventId: auctionAskOf(created).id };
  };

  it('is on every row of the list', () => {
    const { get } = live();
    const rows = (get('/api/auction-events').body as { auctions: { auctionNumber: string }[] }).auctions;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.auctionNumber).toMatch(/^EA-\d{4}-\d{4}$/);
  });

  it('is on the detail, and is not the ask’s number', () => {
    const { get, eventId } = live();
    const detail = get(`/api/auction-events/${eventId}`).body as {
      auctionNumber: string; eventNumber: string;
    };
    expect(detail.auctionNumber).toMatch(/^EA-\d{4}-\d{4}$/);
    expect(detail.auctionNumber).not.toBe(detail.eventNumber);
  });

  it('reaches the supplier’s own projection', () => {
    const { get, eventId } = live();
    const view = get(`/api/auction-events/${eventId}/bidder-view`, {
      counterpartyId: 'cp-abc',
    }).body as { auctionNumber: string };
    expect(view.auctionNumber).toMatch(/^EA-\d{4}-\d{4}$/);
  });

  it('differs between two auctions published one after the other', () => {
    const harness = api();
    const first = harness.post('/api/sourcing-events', openNow()).body;
    const second = harness.post('/api/sourcing-events', openNow()).body;
    const numberOf = (created: unknown) => {
      const id = auctionAskOf(created).id;
      return (harness.get(`/api/auction-events/${id}`).body as { auctionNumber: string })
        .auctionNumber;
    };
    expect(numberOf(first)).not.toBe(numberOf(second));
  });
});
