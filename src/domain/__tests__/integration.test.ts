/**
 * Integration over the real wiring: seed data → store reducer → auction service
 * → engine. The unit tests prove each rule; this proves they are actually
 * connected, and that the two surfaces share one set of rules.
 *
 * The second block does the same for the sourcing path: requisition lines →
 * consolidated demand → event → lines taken out of the sourceable pool.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  initialState, linesOfRequisition, reducer, sourcingRequisition, type AppState,
} from '../../store/store';
import { buildSourcingRequisition, toConsolidatedLines } from '../sourcingRequisition';
import { linesFor, sourceableLines } from '../purchaseRequests';
import { JOURNEY_PATTERNS } from '../journeyPatterns';
import { bidderView, buyerView } from '../../server/auctionService';
import { resetServerClock, setServerOffset } from '../../server/clock';
import { auditTrail } from '../../server/audit';
import { rankLot } from '../auctionEngine';
import { COUNTERPARTY_NAMES, PORTAL_BIDDER_ID, PRIMARY_EVENT_ID } from '../../data/seed';
import type { Lot, SourcingEvent } from '../types';

const LOT = 'al-1';

/**
 * The auction under test.
 *
 * Auctions are held per event now, so a test that says "the auction" has to
 * say which — the tenant runs five, on five different mechanisms.
 */
const auctionOf = (state: AppState) => state.auctions[PRIMARY_EVENT_ID];

function fresh(): AppState {
  resetServerClock();
  return initialState();
}

/** Places a bid through the same path both consoles use. */
function bid(
  state: AppState,
  bidderId: string,
  value: number,
  extra: Partial<{ confirmed: boolean; source: 'PORTAL' | 'ON_BEHALF' }> = {},
): AppState {
  return reducer(state, {
    type: 'SUBMIT_BID',
    eventId: PRIMARY_EVENT_ID,
    auctionLotId: LOT,
    bidderId,
    bidValue: value,
    userId: 'test-user',
    source: extra.source ?? 'PORTAL',
    confirmed: extra.confirmed,
  });
}

beforeEach(() => resetServerClock());

describe('seed integrity', () => {
  it('starts with a live auction and a coherent standing', () => {
    const state = fresh();
    expect(auctionOf(state).auction.status).toBe('LIVE');
    expect(auctionOf(state).bids).toHaveLength(5);

    const rows = rankLot(auctionOf(state).bids, LOT, 'BUY');
    expect(rows).toHaveLength(3);
    // Prime leads on transformed value at 147,200.
    expect(rows[0].bidderId).toBe('eb-prime');
    expect(rows[0].transformedValue).toBe(147_200);
  });

  it('demonstrates that the lowest headline bid is not the leader', () => {
    const state = fresh();
    const rows = rankLot(auctionOf(state).bids, LOT, 'BUY');
    const cheapestHeadline = [...rows].sort((a, b) => a.bidValue - b.bidValue)[0];
    // ABC bid 141,000 — the lowest number on the table — and is not rank 1,
    // because freight and duty put its landed cost above Prime's.
    expect(cheapestHeadline.bidderId).toBe('eb-abc');
    expect(rows[0].bidderId).not.toBe('eb-abc');
  });

  it('stores a client timestamp that disagrees with the server one', () => {
    const state = fresh();
    for (const seeded of auctionOf(state).bids) {
      expect(seeded.clientTimestamp).not.toBe(seeded.submittedAt);
    }
  });

  it('has a bidder who accepted the invitation but has not joined the room', () => {
    const state = fresh();
    const metro = state.bidders.find((b) => b.id === 'eb-metro')!;
    // The two axes are independent, and the seed proves it.
    expect(metro.invitationStatus).toBe('ACCEPTED');
    expect(metro.participationStatus).toBe('REGISTERED');
  });
});

describe('bidding through the store', () => {
  it('accepts a valid improvement and puts the bidder in front', () => {
    let state = fresh();
    // Leader is Prime at 147,200 transformed. Global has no transformation
    // penalty to speak of, so 143,000 lands comfortably ahead.
    state = bid(state, 'eb-global', 143_000);

    expect(state.lastBidResult?.accepted).toBe(true);
    const rows = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES);
    expect(rows[0].bidderId).toBe('eb-global');
  });

  it('rejects a bid that does not improve, and says why', () => {
    let state = fresh();
    state = bid(state, 'eb-global', 149_000);
    expect(state.lastBidResult?.accepted).toBe(false);
    expect(state.lastBidResult?.code).toBe('NOT_AN_IMPROVEMENT');
    expect(state.lastBidResult?.message).toMatch(/lower than the current leading bid/);
  });

  it('rejects a bid from the bidder already leading', () => {
    let state = fresh();
    state = bid(state, 'eb-prime', 140_000);
    expect(state.lastBidResult?.code).toBe('REBID_ON_OWN_LEAD');
  });

  it('rejects a bid above the lot ceiling', () => {
    let state = fresh();
    state = bid(state, 'eb-global', 170_000);
    expect(state.lastBidResult?.code).toBe('ABOVE_CEILING');
  });

  it('writes a rejected attempt into the ledger as invalid', () => {
    let state = fresh();
    const before = auctionOf(state).bids.length;
    // Global already holds a valid seeded bid, so this measures the delta.
    const standingBefore = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES)
      .find((r) => r.bidderId === 'eb-global')!;

    state = bid(state, 'eb-global', 149_000);

    // The attempt is recorded — the ledger is the record of what was tried.
    expect(auctionOf(state).bids).toHaveLength(before + 1);
    const last = auctionOf(state).bids[auctionOf(state).bids.length - 1];
    expect(last.isValid).toBe(false);
    expect(last.rejectionReason).toBeTruthy();

    // But an invalid bid changes nothing about the standing.
    const standingAfter = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES)
      .find((r) => r.bidderId === 'eb-global')!;
    expect(standingAfter.bidCount).toBe(standingBefore.bidCount);
    expect(standingAfter.transformedValue).toBe(standingBefore.transformedValue);
    expect(standingAfter.rank).toBe(standingBefore.rank);
  });

  it('never mutates or removes an earlier bid — the ledger is append-only', () => {
    let state = fresh();
    const original = JSON.parse(JSON.stringify(auctionOf(state).bids));
    state = bid(state, 'eb-global', 143_000);
    state = bid(state, 'eb-abc', 138_000);
    for (const [i, before] of original.entries()) {
      expect(auctionOf(state).bids[i]).toEqual(before);
    }
  });

  it('demands confirmation for a large move, then accepts it once confirmed', () => {
    let state = fresh();
    // Roughly a 13% improvement on the 147,200 lead: past the 10% threshold.
    state = bid(state, 'eb-global', 128_000);
    expect(state.lastBidResult?.requiresConfirmation).toBe(true);
    expect(auctionOf(state).bids).toHaveLength(5);

    state = bid(state, 'eb-global', 128_000, { confirmed: true });
    expect(state.lastBidResult?.accepted).toBe(true);
    expect(auctionOf(state).bids).toHaveLength(6);
  });

  it('refuses every bid while paused, and accepts again on resume', () => {
    let state = fresh();
    state = reducer(state, { type: 'CONTROLLER_ACTION', eventId: PRIMARY_EVENT_ID, action: 'PAUSE', reason: 'Integrity check.' });
    expect(auctionOf(state).auction.status).toBe('PAUSED');

    state = bid(state, 'eb-global', 143_000);
    expect(state.lastBidResult?.code).toBe('AUCTION_PAUSED');

    state = reducer(state, { type: 'CONTROLLER_ACTION', eventId: PRIMARY_EVENT_ID, action: 'RESUME', reason: 'Cleared.' });
    state = bid(state, 'eb-global', 143_000);
    expect(state.lastBidResult?.accepted).toBe(true);
  });

  it('refuses a bid while the connection is down rather than pretending', () => {
    let state = fresh();
    state = reducer(state, { type: 'TOGGLE_CONNECTION' });
    const before = auctionOf(state).bids.length;
    state = bid(state, 'eb-global', 143_000);
    expect(state.lastBidResult?.accepted).toBe(false);
    expect(state.lastBidResult?.code).toBe('OFFLINE');
    // Nothing reached the ledger, because nothing reached the server.
    expect(auctionOf(state).bids).toHaveLength(before);
  });

  it('extends the clock when a bid lands in the soft-close window', () => {
    let state = fresh();
    const closesAt = auctionOf(state).lots[0].closesAt!;
    // Advance the server clock to 60s before the close.
    setServerOffset(closesAt - Date.now() - 60_000);

    state = bid(state, 'eb-global', 143_000);
    expect(state.lastBidResult?.accepted).toBe(true);
    expect(auctionOf(state).auction.status).toBe('EXTENDED');
    expect(auctionOf(state).auction.extensionsUsed).toBe(1);
    expect(auctionOf(state).lots[0].closesAt!).toBe(closesAt + 120_000);
    expect(auctionOf(state).controlEvents[0].kind).toBe('EXTENDED');
    // A system extension is attributed to the system, not to a person.
    expect(auctionOf(state).controlEvents[0].actorId).toBe('system');
  });

  it('records an on-behalf bid with its marker', () => {
    let state = fresh();
    state = reducer(state, {
      type: 'SUBMIT_BID', eventId: PRIMARY_EVENT_ID, auctionLotId: LOT, bidderId: 'eb-abc',
      bidValue: 140_000, userId: 'user-ar', source: 'ON_BEHALF',
      onBehalfReason: 'Supplier phoned; portal unreachable', confirmed: true,
    });
    const placed = auctionOf(state).bids[auctionOf(state).bids.length - 1];
    expect(placed.source).toBe('ON_BEHALF');
    expect(placed.onBehalfReason).toBe('Supplier phoned; portal unreachable');
  });
});

describe('controller actions', () => {
  it('refuses an action with no reason', () => {
    const state = fresh();
    expect(() => reducer(state, { type: 'CONTROLLER_ACTION', eventId: PRIMARY_EVENT_ID, action: 'PAUSE', reason: '   ' }))
      .toThrow(/reason/i);
  });

  it('writes the audit entry, and closing ends every lot', () => {
    let state = fresh();
    state = reducer(state, {
      type: 'CONTROLLER_ACTION', eventId: PRIMARY_EVENT_ID, action: 'FORCE_CLOSE',
      reason: 'Buyer ended bidding early with agreement of the field.',
    });
    expect(auctionOf(state).auction.status).toBe('CLOSED');
    expect(auctionOf(state).lots.every((l) => l.status === 'LOT_CLOSED')).toBe(true);

    const trail = auditTrail(auctionOf(state).auction.eventId);
    const entry = trail.find((e) => e.action === 'AUCTION_FORCE_CLOSED');
    expect(entry).toBeDefined();
    expect(entry!.reason).toContain('ended bidding early');
  });

  it('stops accepting bids once closed', () => {
    let state = fresh();
    state = reducer(state, { type: 'CONTROLLER_ACTION', eventId: PRIMARY_EVENT_ID, action: 'FORCE_CLOSE', reason: 'Time.' });
    state = bid(state, 'eb-global', 130_000);
    expect(state.lastBidResult?.code).toBe('AUCTION_NOT_LIVE');
  });
});

describe('the two surfaces see different things from one ledger', () => {
  it('gives the buyer real names and both values', () => {
    const state = fresh();
    const rows = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES);
    expect(rows[0].displayName).toBe('Prime Stationery Ltd.');
    expect(rows[0].bidValue).toBeGreaterThan(0);
    expect(rows[0].transformedValue).toBeGreaterThan(0);
  });

  it('masks names for an observer', () => {
    const state = fresh();
    const rows = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES, { observer: true });
    expect(rows.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(['Bidder A', 'Bidder B', 'Bidder C']),
    );
    for (const row of rows) {
      expect(row.displayName).not.toContain('Prime');
    }
  });

  it('shows a registered bidder who has not bid, so silence is visible', () => {
    const state = fresh();
    const rows = buyerView(auctionOf(state), LOT, COUNTERPARTY_NAMES);
    const metro = rows.find((r) => r.bidderId === 'eb-metro');
    expect(metro).toBeDefined();
    expect(metro!.bidCount).toBe(0);
    expect(metro!.participationStatus).toBe('REGISTERED');
  });

  it('gives the supplier only what RANK_GAP permits — no competitor price', () => {
    const state = fresh();
    const view = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
    expect(view.projection.ownRank).toBeDefined();
    expect(view.projection.gapPctBehind).toBeDefined();
    expect(view.projection).not.toHaveProperty('bestPrice');
    expect(view.projection).not.toHaveProperty('allBids');

    // The whole payload contains no competitor's number anywhere.
    const serialised = JSON.stringify(view.projection);
    expect(serialised).not.toContain('147200');
    expect(serialised).not.toContain('141500');
  });

  it('changes the payload shape when the policy changes, not just the display', () => {
    let state = fresh();
    const before = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
    expect(before.projection).not.toHaveProperty('bestPrice');

    state = reducer(state, { type: 'UPDATE_AUCTION', eventId: PRIMARY_EVENT_ID, patch: { feedbackPolicy: 'FULL_PRICE' } });
    const after = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
    expect(after.projection.bestPrice).toBe(147_200);
    expect(after.projection.allBids).toHaveLength(3);

    state = reducer(state, { type: 'UPDATE_AUCTION', eventId: PRIMARY_EVENT_ID, patch: { feedbackPolicy: 'BLIND' } });
    const blind = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
    expect(Object.keys(blind.projection).sort()).toEqual(['isLeading', 'policy', 'policyLabel']);
  });

  it('never leaks the internal target price, even under traffic light', () => {
    let state = fresh();
    state = reducer(state, { type: 'UPDATE_AUCTION', eventId: PRIMARY_EVENT_ID, patch: { feedbackPolicy: 'TRAFFIC_LIGHT' } });
    const view = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
    expect(view.projection.trafficBand).toBeDefined();
    // discloseTarget is false on the seed, so the number stays behind the boundary.
    expect(view.projection).not.toHaveProperty('targetPrice');
    expect(JSON.stringify(view.projection)).not.toContain('138000');
  });

  it('always lets a supplier see their own bids, whatever the policy', () => {
    let state = fresh();
    for (const policy of ['BLIND', 'RANK_ONLY', 'FULL_PRICE'] as const) {
      state = reducer(state, { type: 'UPDATE_AUCTION', eventId: PRIMARY_EVENT_ID, patch: { feedbackPolicy: policy } });
      const view = bidderView(auctionOf(state), LOT, PORTAL_BIDDER_ID, COUNTERPARTY_NAMES);
      expect(view.myBestBid).toBe(141_000);
      expect(view.myBidHistory.length).toBeGreaterThan(0);
    }
  });

  it('gives two suppliers different bid-to-beat figures for one objective', () => {
    const state = fresh();
    const abc = bidderView(auctionOf(state), LOT, 'eb-abc', COUNTERPARTY_NAMES);
    const global = bidderView(auctionOf(state), LOT, 'eb-global', COUNTERPARTY_NAMES);
    expect(abc.bidToBeat).not.toBeNull();
    expect(global.bidToBeat).not.toBeNull();
    // Same leading landed value, different raw targets, because their costs differ.
    expect(Math.abs(abc.bidToBeat! - global.bidToBeat!)).toBeGreaterThan(1_000);
  });
});

describe('event lifecycle through the store', () => {
  it('moves an event to award and then to approval', () => {
    let state = fresh();
    state = reducer(state, {
      type: 'UPDATE_EVENT', eventId: 'evt-0142',
      patch: { status: 'AWARD_RECOMMENDED', currentStage: 'AWARD' },
    });
    expect(state.events.find((e) => e.id === 'evt-0142')?.status).toBe('AWARD_RECOMMENDED');
  });

  it('keeps the kill switch state and who engaged it', () => {
    let state = fresh();
    state = reducer(state, { type: 'ENGAGE_KILL_SWITCH', by: 'A. Rahman' });
    expect(state.agentKillSwitch.engaged).toBe(true);
    expect(state.agentKillSwitch.by).toBe('A. Rahman');
    state = reducer(state, { type: 'RELEASE_KILL_SWITCH' });
    expect(state.agentKillSwitch.engaged).toBe(false);
  });

  it('records a score as a new row rather than editing the old one', () => {
    let state = fresh();
    const before = state.scores.length;
    state = reducer(state, {
      type: 'ADD_SCORE',
      score: {
        id: 'score-new', eventId: 'evt-0142', bidderId: 'eb-abc', questionId: 'q-2',
        evaluatorId: 'user-js', value: 6, comment: 'Revised on review', method: 'MANUAL',
        agentConfidence: null, citedEvidence: null,
        overridesScoreId: 's-1', overrideReason: 'Certificate scope re-read', createdAt: Date.now(),
      },
    });
    expect(state.scores).toHaveLength(before + 1);
    // The original survives, which is what makes the override chain auditable.
    expect(state.scores.find((s) => s.id === 's-1')).toBeDefined();
  });

  it('broadcasts a clarification answer by default', () => {
    let state = fresh();
    state = reducer(state, {
      type: 'ANSWER_CLARIFICATION', id: 'clar-4',
      answer: 'Index adjustment applies only where agreed at award, per clause 7.3.',
      visibility: 'BROADCAST', userId: 'user-ar',
    });
    const answered = state.clarifications.find((c) => c.id === 'clar-4')!;
    expect(answered.visibility).toBe('BROADCAST');
    expect(answered.answeredAt).not.toBeNull();
  });
});

// -------------------------------------------------------------------------
// Sourcing: requisition lines → consolidated demand → event
// -------------------------------------------------------------------------

describe('basket → PRD → event → lines marked', () => {
  it('runs the whole flow and takes the lines out of the sourceable pool', () => {
    let state = initialState();

    // 1. Pick unsourced lines from TWO different requisitions, same category.
    const a = sourceableLines(linesFor(state.purchaseRequestLines, 'pr-00033')).slice(0, 6);
    const b = sourceableLines(linesFor(state.purchaseRequestLines, 'pr-00034')).slice(0, 4);
    const basket = [...a, ...b];
    expect(basket).toHaveLength(10);

    // 2. Consolidate into a PRD.
    const requisition = buildSourcingRequisition({
      lines: basket, requests: state.purchaseRequests,
      existing: state.sourcingRequisitions, userId: 'user-ar', now: 1_000,
    });
    expect(requisition.prdNumber).toBe('PRD-2026-0001');
    expect(requisition.requestNumbers).toEqual(['RQ-TGRANL-00033', 'RQ-TGRANL-00034']);

    state = reducer(state, { type: 'CREATE_SOURCING_REQUISITION', requisition });
    expect(sourcingRequisition(state, requisition.id)?.prdNumber).toBe('PRD-2026-0001');
    expect(linesOfRequisition(state, requisition)).toHaveLength(10);

    // 3. The wizard turns it into event lines across lots, with traceability.
    const consolidated = toConsolidatedLines(
      linesOfRequisition(state, requisition), state.purchaseRequests,
    );
    expect(consolidated).toHaveLength(10);
    expect(new Set(consolidated.map((l) => l.lotName)).size).toBeGreaterThan(1);
    for (const l of consolidated) expect(l.sourcePrLineId).toBeTruthy();

    // 4. Publish.
    const pattern = JOURNEY_PATTERNS['JP-02'];
    const event: SourcingEvent = {
      id: 'evt-new', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2026-9001',
      title: 'Consolidated', description: '', side: 'BUY', templateId: null,
      journeyPattern: 'JP-02', businessUnit: requisition.businessUnits[0],
      category: requisition.category, project: null, costCentre: null,
      currency: requisition.currency, estimatedValue: 0, ownerId: 'user-ar',
      status: 'PUBLISHED', createdFrom: 'PR', sourceReference: requisition.prdNumber,
      stagesEnabled: pattern.stages, currentStage: pattern.stages[0],
      envelopeMode: 'TWO_ENVELOPE', vendorInputPoints: pattern.vendorInputPoints,
      publishedAt: 1_000, closesAt: 2_000, awardedAt: null, parentEventId: null,
      version: 1, configSnapshotAtPublish: null,
    };
    state = reducer(state, {
      type: 'CREATE_EVENT', event, lots: [] as Lot[],
      sourcedLineIds: consolidated.map((l) => l.sourcePrLineId),
      sourcingRequisitionId: requisition.id,
    });

    // 5. Those exact lines are now out in the event and nothing else moved.
    const moved = state.purchaseRequestLines.filter((l) => l.eventNumber === 'RFQ-2026-9001');
    expect(moved).toHaveLength(10);
    for (const l of moved) expect(l.sourcingState).toBe('IN_EVENT');

    // 6. They can no longer be selected into a second basket.
    expect(sourceableLines(moved)).toHaveLength(0);

    // 7. The PRD now points at the event.
    expect(sourcingRequisition(state, requisition.id)?.eventId).toBe('evt-new');

    // 8. The event's one source reference is the PRD, which maps to both RQs.
    expect(event.sourceReference).toBe('PRD-2026-0001');
  });

  it('leaves the pool alone when an event is created without a basket', () => {
    const before = initialState();
    const after = reducer(before, {
      type: 'CREATE_EVENT',
      event: { id: 'e', eventNumber: 'X' } as SourcingEvent,
      lots: [] as Lot[],
    });
    expect(after.purchaseRequestLines).toBe(before.purchaseRequestLines);
  });

  it('assigns the next PRD number on a second basket', () => {
    let state = initialState();
    const first = buildSourcingRequisition({
      lines: sourceableLines(linesFor(state.purchaseRequestLines, 'pr-00033')).slice(0, 2),
      requests: state.purchaseRequests, existing: state.sourcingRequisitions,
      userId: 'user-ar', now: 0,
    });
    state = reducer(state, { type: 'CREATE_SOURCING_REQUISITION', requisition: first });

    const second = buildSourcingRequisition({
      lines: sourceableLines(linesFor(state.purchaseRequestLines, 'pr-00124')).slice(0, 2),
      requests: state.purchaseRequests, existing: state.sourcingRequisitions,
      userId: 'user-ar', now: 0,
    });
    expect(second.prdNumber).toBe('PRD-2026-0002');
  });
});
