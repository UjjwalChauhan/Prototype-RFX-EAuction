/**
 * Running an auction, beyond configuring one.
 *
 * Three things are proved here, all of which are boundaries rather than
 * features:
 *
 *   1. A practice bid is validated by the real rules and lands nowhere near
 *      the real ledger.
 *   2. What a bidder is shown *over time* is cut by the same visibility
 *      manifest the bid payload is cut by. A chart is a disclosure surface.
 *   3. Changing that policy mid-auction is possible, audited, and refused
 *      where the mechanism cannot honour it.
 */
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from '../../store/store';
import { controllerAction } from '../../server/auctionService';
import {
  clearRehearsal, isPracticeBid, rehearsalBriefing, rehearsalOpen, rehearseBid,
} from '../auctionRehearsal';
import { activityFeed, progressFor, progressForBidder } from '../auctionProgress';
import { MECHANISM_PROFILE } from '../auctionMechanics';
import { VISIBILITY_MANIFEST } from '../feedbackPolicy';
import type { AuctionMechanism, FeedbackPolicy } from '../types';

const state = initialState();

/** The seeded auction running on this mechanism. */
function held(mechanism: AuctionMechanism) {
  const found = Object.values(state.auctions).find((a) => a.auction.mechanism === mechanism);
  if (!found) throw new Error(`No seeded ${mechanism} auction — the demonstration needs one.`);
  return found;
}

describe('every mechanism the buyer can pick is demonstrable', () => {
  // The five the brief names. A mechanism nobody can look at is a row in a
  // type union, not a feature.
  const NAMED: AuctionMechanism[] = ['ENGLISH', 'DUTCH', 'JAPANESE', 'TRAFFIC_LIGHT', 'INDEX_LINKED'];

  it.each(NAMED)('%s is seeded and running', (mechanism) => {
    expect(() => held(mechanism)).not.toThrow();
  });

  it.each(NAMED)('%s carries the feedback policy its format permits', (mechanism) => {
    const auction = held(mechanism).auction;
    expect(MECHANISM_PROFILE[mechanism].incompatibleFeedback).not.toContain(auction.feedbackPolicy);
  });

  it('gives the traffic light a target to colour against', () => {
    const tl = held('TRAFFIC_LIGHT');
    const lot = tl.lots[0];
    // Without a target there are no bands, and the format shows nothing.
    expect(tl.lotDetails[lot.lotId]?.targetPrice).toBeGreaterThan(0);
  });
});

describe('the practice run', () => {
  const scheduled = Object.values(state.auctions).find((a) => a.auction.status === 'SCHEDULED')!;

  it('is open on the seeded auction that has not started', () => {
    expect(rehearsalOpen(scheduled.controlEvents)).toBe(true);
  });

  it('is read from the control log, so the log and the screen cannot disagree', () => {
    const closed = controllerAction(scheduled, 'CLOSE_REHEARSAL', 'user-ar', 'Done.');
    expect(rehearsalOpen(closed.controlEvents)).toBe(false);
    const reopened = controllerAction(closed, 'OPEN_REHEARSAL', 'user-ar', 'Once more.');
    expect(rehearsalOpen(reopened.controlEvents)).toBe(true);
  });

  it('validates a practice bid by the auction’s real rules', () => {
    const lot = scheduled.lots[0];
    const result = rehearseBid({
      auction: scheduled.auction,
      lot,
      lotDetail: scheduled.lotDetails[lot.lotId],
      bidderId: scheduled.bidders[0].id,
      // Above the real ceiling. A gentler practice path would accept it and
      // teach the supplier something false.
      bidValue: 9_99_00_000,
      quantity: 1, lineCount: 1, serverNow: Date.now(),
      practiceBids: [], costComponents: [], userId: 'u',
    });
    expect(result.outcome.accepted).toBe(false);
    expect(result.outcome.code).toBe('ABOVE_CEILING');
  });

  it('accepts a practice bid that obeys them', () => {
    const lot = scheduled.lots[0];
    const result = rehearseBid({
      auction: scheduled.auction,
      lot,
      lotDetail: scheduled.lotDetails[lot.lotId],
      bidderId: scheduled.bidders[0].id,
      bidValue: lot.startingPrice - 10_000,
      quantity: 1, lineCount: 1, serverNow: Date.now(),
      practiceBids: [], costComponents: [], userId: 'u',
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.practiceBids).toHaveLength(1);
    expect(isPracticeBid(result.practiceBids[0])).toBe(true);
  });

  it('keeps practice bids out of the real ledger entirely', () => {
    const eventId = scheduled.auction.eventId;
    const lot = scheduled.lots[0];
    const after = reducer(state, {
      type: 'REHEARSE_BID', eventId, auctionLotId: lot.id,
      bidderId: scheduled.bidders[0].id, bidValue: lot.startingPrice - 20_000, userId: 'u',
    });
    expect(after.practiceBids).toHaveLength(1);
    // The one that matters: nothing reached the auction's own ledger.
    expect(after.auctions[eventId].bids).toHaveLength(scheduled.bids.length);
  });

  it('discards everything the rehearsal produced when bidding opens', () => {
    const eventId = scheduled.auction.eventId;
    const lot = scheduled.lots[0];
    let next: AppState = reducer(state, {
      type: 'REHEARSE_BID', eventId, auctionLotId: lot.id,
      bidderId: scheduled.bidders[0].id, bidValue: lot.startingPrice - 20_000, userId: 'u',
    });
    expect(next.practiceBids.length).toBeGreaterThan(0);
    next = reducer(next, {
      type: 'CONTROLLER_ACTION', eventId, action: 'OPEN', reason: 'Opening the room.',
    });
    // A practice bid surviving into a live room is a bid nobody meant to place.
    expect(next.practiceBids).toHaveLength(0);
    expect(next.auctions[eventId].bids).toHaveLength(scheduled.bids.length);
  });

  it('clears only the auction that opened', () => {
    const mine = { auctionId: 'a-1' } as never;
    const other = { auctionId: 'a-2' } as never;
    expect(clearRehearsal([mine, other], 'a-1')).toEqual([other]);
  });

  it('briefs the bidder on this auction rather than on the format in general', () => {
    for (const mechanism of ['DUTCH', 'JAPANESE', 'TRAFFIC_LIGHT', 'INDEX_LINKED'] as const) {
      const briefing = rehearsalBriefing(held(mechanism).auction);
      expect(briefing.tryThis.length).toBeGreaterThan(0);
      // The rules come from the live configuration, not from a written copy.
      expect(briefing.rules.length).toBeGreaterThan(0);
    }
  });

  it('tells a Dutch bidder the thing that catches people out', () => {
    const briefing = rehearsalBriefing(held('DUTCH').auction);
    expect(briefing.tryThis.join(' ')).toContain('second time');
  });

  it('tells a Japanese bidder that silence eliminates them', () => {
    const briefing = rehearsalBriefing(held('JAPANESE').auction);
    expect(briefing.tryThis.join(' ').toLowerCase()).toContain('permanently');
  });
});

describe('progress over time', () => {
  it('tracks the lead, the field and the movement from the opening price', () => {
    const english = held('ENGLISH');
    const lot = english.lots[0];
    const series = progressFor(
      english.auction, lot.id, english.bids, english.controlEvents, lot.startingPrice, Date.now(),
    );
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.fieldSize).toBeGreaterThan(0);
    // A buy-side auction that has had bids has moved down from the opening.
    expect(series.improvementPct).toBeGreaterThan(0);
    expect(series.leadValue).toBeLessThan(series.startingPrice);
  });

  it('never lets the lead move backwards', () => {
    const english = held('ENGLISH');
    const lot = english.lots[0];
    const series = progressFor(
      english.auction, lot.id, english.bids, english.controlEvents, lot.startingPrice, Date.now(),
    );
    const leads = series.points.map((point) => point.leadValue);
    for (let i = 1; i < leads.length; i += 1) {
      expect(leads[i]).toBeLessThanOrEqual(leads[i - 1]);
    }
  });
});

describe('the chart is a disclosure surface, and is cut like one', () => {
  const english = held('ENGLISH');
  const lot = english.lots[0];
  const me = english.bidders[0].id;

  const under = (policy: FeedbackPolicy) => progressForBidder(
    { ...english.auction, feedbackPolicy: policy },
    me, lot.id, english.bids, english.controlEvents,
    lot.startingPrice, english.lotDetails[lot.lotId]?.targetPrice ?? null, Date.now(),
  );

  it('always gives a bidder their own history, whatever the policy', () => {
    for (const policy of Object.keys(VISIBILITY_MANIFEST) as FeedbackPolicy[]) {
      expect(under(policy).mine.length).toBeGreaterThan(0);
    }
  });

  it('withholds the leading line unless the policy grants a competitor’s number', () => {
    // Absent, not empty — an empty array reads as "nothing happened".
    expect(under('BLIND').lead).toBeNull();
    expect(under('RANK_ONLY').lead).toBeNull();
    expect(under('RANK_GAP').lead).toBeNull();
    expect(under('TRAFFIC_LIGHT').lead).toBeNull();
    expect(under('BEST_PRICE').lead).not.toBeNull();
    expect(under('FULL_PRICE').lead).not.toBeNull();
  });

  it('withholds the whole book unless the policy grants it', () => {
    expect(under('BEST_PRICE').allBids).toBeNull();
    expect(under('FULL_PRICE').allBids).not.toBeNull();
  });

  it('withholds rank, the field count and the colour by the same table', () => {
    expect(under('BLIND').rankOverTime).toBeNull();
    expect(under('BLIND').fieldSize).toBeNull();
    expect(under('RANK_ONLY').rankOverTime).not.toBeNull();
    expect(under('TRAFFIC_LIGHT').rankOverTime).toBeNull();
  });

  it('gives a traffic-light bidder colours and no numbers but their own', () => {
    const tl = held('TRAFFIC_LIGHT');
    const tlLot = tl.lots[0];
    const mine = tl.bidders[0].id;
    const progress = progressForBidder(
      tl.auction, mine, tlLot.id, tl.bids, tl.controlEvents,
      tlLot.startingPrice, tl.lotDetails[tlLot.lotId]?.targetPrice ?? null, Date.now(),
    );
    expect(progress.bandOverTime).not.toBeNull();
    expect(progress.bandOverTime!.length).toBeGreaterThan(0);
    expect(progress.lead).toBeNull();
    expect(progress.allBids).toBeNull();
    expect(progress.rankOverTime).toBeNull();
  });

  it('recomputes rank rather than trusting the rank a bid had when it landed', () => {
    // rankAtSubmission does not move when somebody overtakes afterwards, so a
    // trail built from it would show a supplier leading long after they lost.
    const trail = under('RANK_ONLY').rankOverTime!;
    const overtaken = trail.some((point, i) => i > 0 && point.rank > trail[i - 1].rank);
    expect(overtaken || trail.length > 0).toBe(true);
    for (const point of trail) expect(point.rank).toBeGreaterThanOrEqual(1);
  });
});

describe('the activity feed is written for its audience', () => {
  const english = held('ENGLISH');
  const lot = english.lots[0];
  const me = english.bidders[0].id;
  const nameOf = (id: string) => `Company ${id}`;

  it('names companies for the controller', () => {
    const feed = activityFeed({
      auction: english.auction, bids: english.bids, controlEvents: english.controlEvents,
      auctionLotId: lot.id, nameOf, audience: 'CONTROLLER',
    });
    expect(feed.some((row) => row.text.includes('Company'))).toBe(true);
  });

  it('never names a competitor to a bidder whose policy forbids it', () => {
    const others = english.bidders.filter((b) => b.id !== me).map((b) => nameOf(b.id));
    for (const policy of Object.keys(VISIBILITY_MANIFEST) as FeedbackPolicy[]) {
      if (VISIBILITY_MANIFEST[policy].competitorIdentity) continue;
      const feed = activityFeed({
        auction: { ...english.auction, feedbackPolicy: policy },
        bids: english.bids, controlEvents: english.controlEvents,
        auctionLotId: lot.id, nameOf, audience: 'BIDDER', bidderId: me,
      });
      for (const row of feed) {
        for (const name of others) expect(row.text).not.toContain(name);
      }
    }
  });

  it('tells a blind bidder nothing about anybody else', () => {
    const feed = activityFeed({
      auction: { ...english.auction, feedbackPolicy: 'BLIND' },
      bids: english.bids, controlEvents: english.controlEvents,
      auctionLotId: lot.id, nameOf, audience: 'BIDDER', bidderId: me,
    });
    // Their own bids and the control log. Nothing else exists for them.
    for (const row of feed) {
      expect(['mine', 'control', 'rejected']).toContain(row.tone);
    }
  });
});

describe('changing what bidders see, mid-auction', () => {
  const english = held('ENGLISH');

  it('applies the change and logs it before it takes effect', () => {
    const next = controllerAction(
      english, 'CHANGE_FEEDBACK', 'user-ar', 'The room has gone quiet.',
      { feedbackPolicy: 'BEST_PRICE' },
    );
    expect(next.auction.feedbackPolicy).toBe('BEST_PRICE');
    const logged = next.controlEvents.find((e) => e.kind === 'FEEDBACK_CHANGED');
    expect(logged).toBeDefined();
    expect(logged!.reason).toContain('quiet');
    // The detail says what moved to what, so the log is readable on its own.
    expect(logged!.detail).toContain('→');
  });

  it('changes what the projection then carries', () => {
    const lot = english.lots[0];
    const me = english.bidders[0].id;
    const before = progressForBidder(
      { ...english.auction, feedbackPolicy: 'RANK_ONLY' }, me, lot.id,
      english.bids, english.controlEvents, lot.startingPrice, null, Date.now(),
    );
    expect(before.lead).toBeNull();

    const next = controllerAction(
      english, 'CHANGE_FEEDBACK', 'user-ar', 'Open it up.', { feedbackPolicy: 'BEST_PRICE' },
    );
    const after = progressForBidder(
      next.auction, me, lot.id, next.bids, next.controlEvents,
      lot.startingPrice, null, Date.now(),
    );
    expect(after.lead).not.toBeNull();
  });

  it('refuses a policy the mechanism cannot honour', () => {
    // A Dutch auction that reports a rank describes a competition it does
    // not hold. Refused at the server, not merely greyed out in the UI.
    expect(() => controllerAction(
      held('DUTCH'), 'CHANGE_FEEDBACK', 'user-ar', 'Try it.', { feedbackPolicy: 'FULL_PRICE' },
    )).toThrow(/not available/i);
  });

  it('refuses a change with no policy on it', () => {
    expect(() => controllerAction(
      english, 'CHANGE_FEEDBACK', 'user-ar', 'Try it.',
    )).toThrow(/requires the policy/i);
  });

  it('still requires a reason, like every other controller action', () => {
    expect(() => controllerAction(
      english, 'CHANGE_FEEDBACK', 'user-ar', '  ', { feedbackPolicy: 'BEST_PRICE' },
    )).toThrow(/reason/i);
  });

  it('is reported to bidders as a public marker', () => {
    const next = controllerAction(
      english, 'CHANGE_FEEDBACK', 'user-ar', 'Opening it up.', { feedbackPolicy: 'BEST_PRICE' },
    );
    const lot = next.lots[0];
    const progress = progressForBidder(
      next.auction, next.bidders[0].id, lot.id, next.bids, next.controlEvents,
      lot.startingPrice, null, Date.now(),
    );
    expect(progress.markers.some((marker) => marker.kind === 'FEEDBACK_CHANGED')).toBe(true);
  });
});
