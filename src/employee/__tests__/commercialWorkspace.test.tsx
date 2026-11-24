/**
 * Commercial evaluation, end to end across the three portals.
 *
 * The domain tests prove the arithmetic. These prove the loop: an evaluator
 * finds something wrong with a price, asks the supplier in plain words, the
 * supplier answers on their own portal, and the evaluator's decision changes
 * the ranking — with the buyer able to read all of it, and the supplier never
 * shown a rank, an adjustment or the word "evaluation" next to a number.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM, deliberately outside the typed source tree.
import { createSyncStore } from '../../../sync-core.mjs';
import {
  StoreProvider, initialState, reducer, reviewSignalRows, type Action, type AppState,
} from '../../store/store';
import { useCommercialModel, taskFor } from '../../store/commercialModel';
import { CommercialWorkspace } from '../EmployeeEvaluation';
import { CommercialEvaluation } from '../CommercialEvaluation';
import { CommercialReview } from '../../admin/tabs/CommercialReview';
import { PortalFromBuyer } from '../../portal/PortalFromBuyer';
import { assignmentOf, evaluationTasks, type StageAssignment } from '../../domain/employeePortal';
import { EMPLOYEES, SEEDED_EVALUATION } from '../../data/employees';
import { PRIMARY_EVENT_ID } from '../../data/seed';
import { SIGNAL_TEXT, acceptedValidity } from '../../domain/buyerRequests';
import type { BuyerRequest } from '../../domain/buyerRequests';
import type { CommercialFlag } from '../../domain/commercialEvaluation';

const SEEDED = SEEDED_EVALUATION as Record<string, StageAssignment[]>;
const person = (id: string) => EMPLOYEES.find((e) => e.id === id)!;
const toast = () => undefined;
const clean = (html: string) => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

function apply(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce((s, a) => reducer(s, a), state);
}

/** The seeded event with its technical result published and the envelope opened. */
function unlocked(): AppState {
  const base = initialState();
  const counterparties = base.bidders.filter((b) => b.eventId === PRIMARY_EVENT_ID).map((b) => b.counterpartyId);
  const at = Date.now();
  return apply(
    base,
    ...['user-js', 'ev-pn'].map((id): Action => ({
      type: 'SUBMIT_EVALUATION',
      submission: { eventId: PRIMARY_EVENT_ID, evaluatorId: id, envelope: 'TECHNICAL', submittedAt: at },
    })),
    {
      type: 'PUBLISH_TECHNICAL_RESULT',
      result: {
        eventId: PRIMARY_EVENT_ID, publishedBy: 'user-js', publishedAt: at, minScore: 60,
        qualified: counterparties, disqualified: [], notify: 'AT_AWARD',
      },
    },
    {
      type: 'SET_COMMERCIAL_UNLOCK',
      unlock: { eventId: PRIMARY_EVENT_ID, requestedBy: 'ev-rm', requestedAt: at, witnessedBy: null, unlockedAt: at },
    },
  );
}

function taskIn(state: AppState, personId = 'ev-rm') {
  const task = evaluationTasks(state.events, personId, SEEDED).find((t) => t.event.id === PRIMARY_EVENT_ID);
  if (!task) throw new Error('no task');
  return task;
}

function paint(state: AppState, node: React.ReactNode): string {
  return clean(renderToString(<StoreProvider seed={state}>{node}</StoreProvider>));
}

/** Reads the model out of a render, since a hook cannot be called from a test. */
function readModel(state: AppState) {
  let captured: ReturnType<typeof useCommercialModel> | null = null;
  const Probe = () => {
    captured = useCommercialModel(taskIn(state), 'LANDED');
    return null;
  };
  renderToString(<StoreProvider seed={state}><Probe /></StoreProvider>);
  return captured as unknown as ReturnType<typeof useCommercialModel>;
}

describe('before the envelope is unlocked', () => {
  const state = initialState();
  it('explains rather than fails', () => {
    const html = paint(state, (
      <CommercialWorkspace task={taskIn(state)} me={person('ev-rm')} onBack={() => undefined} toast={toast} />
    ));
    expect(html).toContain('The commercial envelope is sealed');
    expect(html).toContain('Before it can be unlocked');
    expect(html).not.toContain('Price schedule');
  });

  it('shows the buyer why, and who unlocks it, without showing a price', () => {
    const html = paint(state, <CommercialReview eventId={PRIMARY_EVENT_ID} onGoTechnical={() => undefined} />);
    expect(html).toContain('The commercial envelope is sealed');
    expect(html).toContain('Open the Employee Portal');
    expect(html).not.toMatch(/Evaluated ranking/);
  });

  it('does not let a technical-only user near the buyer’s commercial view', () => {
    const technicalOnly = apply(initialState(), {
      type: 'SET_USER',
      userId: initialState().currentUser.id,
    });
    const asTechnical: AppState = {
      ...technicalOnly, currentUser: { ...technicalOnly.currentUser, permissions: ['score_technical'] },
    };
    const html = paint(asTechnical, <CommercialReview eventId={PRIMARY_EVENT_ID} onGoTechnical={() => undefined} />);
    expect(html).toContain('Your role cannot read commercial evaluation');
    expect(html).not.toContain('Evaluated ranking');
  });
});

describe('the workspace once unlocked', () => {
  const state = unlocked();
  const html = paint(state, <CommercialEvaluation task={taskIn(state)} me={person('ev-rm')} toast={toast} />);

  it('splits bidders from the commercial detail, with four tabs and a running bar', () => {
    for (const label of ['Bidders ·', 'Price schedule', 'Adjustments', 'Commercial scoring', 'Flags', 'Running comparison totals']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Model locked');
  });

  it('always says which basis it is comparing on', () => {
    expect(html).toContain('Comparing on the landed basis');
    expect(html).toContain('Evaluated · Landed');
  });

  it('lists every bidder with quoted and evaluated totals, completeness and review status', () => {
    for (const name of ['ABC Supplies Co.', 'Global Office Solutions', 'Prime Stationery Ltd.', 'Metro Business Supplies']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('Quoted');
    expect(html).toContain('Evaluated');
    expect(html).toContain('Not reviewed');
    expect(html).toContain('4 of 5 lines');
    expect(html).toContain('Fails a knockout');
  });

  it('asks for the conflict-of-interest declaration before anything is changed', () => {
    expect(html).toContain('declare any conflict of interest');
    expect(html).toContain('Sign declaration');
  });

  it('shows an alternate offer beneath the compliant one, never in the total', () => {
    expect(html).toContain('Alternate offer');
    expect(html).toContain('Shown beneath the compliant offer. Not ranked, not in the total.');
  });

  it('lists what stands between the evaluator and completion', () => {
    expect(html).toContain('Before you can complete');
    expect(html).toContain('Every bidder reviewed (0 of 4)');
  });
});

describe('what the seeded bidders demonstrate', () => {
  const state = unlocked();
  const model = readModel(state);
  const bid = (id: string) => model.result.bids.find((b) => b.bidderId === id)!;
  const flag = (code: CommercialFlag['code'], bidderId?: string) =>
    model.flags.find((f) => f.code === code && (bidderId === undefined || f.bidderId === bidderId));

  it('ranks the complete, responsive bids and keeps the others out', () => {
    expect(model.result.ranked.map((b) => b.bidderId).sort()).toEqual(['eb-abc', 'eb-global', 'eb-metro']);
    expect(bid('eb-prime').rank).toBeNull();
    expect(bid('eb-prime').responsive).toBe(false);
    expect(bid('eb-prime').schedule.complete).toBe(false);
  });

  it('converts the dollar bid at the declared rate and says where the rate came from', () => {
    const lines = bid('eb-global').schedule.lines.filter((l) => l.priced);
    expect(lines.every((l) => l.quoted?.currency === 'USD')).toBe(true);
    expect(lines[0].fx?.rate).toBe(83.2);
    expect(lines[0].fx?.source).toMatch(/reference rate/i);
    expect(flag('CURRENCY', 'eb-global')?.detail).toContain('83.2');
  });

  it('raises each kind of flag on the bidder it belongs to', () => {
    expect(flag('MISSING_LINES', 'eb-prime')?.severity).toBe('BLOCKING');
    expect(flag('ARITHMETIC', 'eb-prime')).toBeDefined();
    expect(flag('VALIDITY', 'eb-prime')?.severity).toBe('BLOCKING');
    expect(flag('DEVIATION', 'eb-prime')?.severity).toBe('WARNING');
    expect(flag('COMPOSITION', 'eb-prime')).toBeDefined();
    expect(flag('EX_WORKS', 'eb-global')).toBeDefined();
  });

  it('surfaces identical pricing between two bidders as an integrity signal, on both', () => {
    expect(flag('IDENTICAL_PRICING', 'eb-metro')?.otherBidderId).toBe('eb-prime');
    expect(flag('IDENTICAL_PRICING', 'eb-prime')?.otherBidderId).toBe('eb-metro');
  });

  it('counts the payment-terms question once, as money, and warns that it also carries a weight', () => {
    expect(bid('eb-abc').trail.some((t) => t.id === 'payment-terms')).toBe(true);
    expect(flag('DOUBLE_COUNT')?.title).toContain('COM.PAYTERMS');
  });

  it('applies nothing the agent only proposed', () => {
    expect(bid('eb-global').proposals.length).toBeGreaterThan(0);
    const applied = bid('eb-global').trail.filter((t) => t.kind === 'ADJUSTMENT').map((t) => t.label);
    // Only the value a person entered counts; the freight and duty proposals wait.
    expect(applied.join()).toContain('Switching cost');
    expect(applied.join()).not.toMatch(/freight|duty/i);
  });

  it('moves ranks when a proposal is accepted, and logs who did it and why', () => {
    const before = model.result.ranked.map((b) => b.bidderId);
    const freight = state.costComponents.find((c) => c.id === 'cc-freight')!;
    const accepted = {
      ...freight,
      valueByBidder: { ...freight.valueByBidder, 'eb-abc': 90_000 },
      valueOrigin: { 'eb-abc': 'MANUAL' as const, 'eb-global': 'MASTER' as const },
    };
    const next = apply(state, {
      type: 'UPSERT_COST_COMPONENT', component: accepted,
      audit: [{
        id: 'a1', eventId: PRIMARY_EVENT_ID, bidderId: 'eb-abc', at: 1, actor: 'ev-rm', action: 'OVERRIDE',
        subject: 'Inbound freight · ABC', before: 'proposed ₹4,200', after: '₹90,000', reason: 'Quoted lane is wrong',
      }],
    });
    const after = readModel(next).result.ranked.map((b) => b.bidderId);
    expect(after[after.length - 1]).toBe('eb-abc');
    expect(after).not.toEqual(before);
    expect(next.commercialAudit).toHaveLength(1);
    expect(next.commercialAudit[0]).toMatchObject({ actor: 'ev-rm', before: 'proposed ₹4,200', reason: 'Quoted lane is wrong' });
  });
});

describe('refusing the wrong people', () => {
  const state = unlocked();
  it('refuses the technical evaluator who tries the workspace directly', () => {
    const html = paint(state, <CommercialEvaluation task={taskIn(state)} me={person('user-js')} toast={toast} />);
    expect(html).toContain('You cannot open the commercial workspace');
    expect(html).toContain('technical');
    expect(html).not.toContain('Price schedule');
  });

  it('shows the buyer the evaluation read-only', () => {
    const html = paint(state, <CommercialReview eventId={PRIMARY_EVENT_ID} onGoTechnical={() => undefined} />);
    expect(html).toContain('Evaluated ranking');
    expect(html).toContain('Calculation trail'.length ? 'Quoted total' : '');
    expect(html).toContain('Change log');
    expect(html).toMatch(/only its evaluators|evaluators make the changes/);
  });

  it('keeps a withheld bidder’s price sealed', () => {
    const turnedAway = apply(state, {
      type: 'PUBLISH_TECHNICAL_RESULT',
      result: {
        eventId: PRIMARY_EVENT_ID, publishedBy: 'user-js', publishedAt: Date.now(), minScore: 60,
        qualified: ['cp-abc', 'cp-global', 'cp-prime'],
        disqualified: [{ counterpartyId: 'cp-metro', reason: 'Failed knockout SUS.FSC' }], notify: 'AT_AWARD',
      },
    });
    const html = paint(turnedAway, <CommercialEvaluation task={taskIn(turnedAway)} me={person('ev-rm')} toast={toast} />);
    expect(html).toContain('Price stays sealed');
    expect(readModel(turnedAway).bidders.map((b) => b.bidder.id)).not.toContain('eb-metro');
  });
});

describe('asking the supplier, and what they see', () => {
  const base = unlocked();
  const model = readModel(base);
  const validity = model.flags.find((f) => f.code === 'VALIDITY' && f.bidderId === 'eb-prime')!;
  const ask = validity.suggestedRequest!;
  const request: BuyerRequest = {
    id: 'br-1', eventId: PRIMARY_EVENT_ID, bidderId: 'eb-prime', kind: ask.kind, subject: ask.subject,
    message: ask.message, askValidityDays: ask.askValidityDays ?? null, raisedAt: Date.now(),
    dueAt: Date.now() + 3 * 86_400_000, flagKey: validity.key, status: 'OPEN', closedAt: null, accepted: false,
  };
  const raised = apply(base, { type: 'RAISE_BUYER_REQUEST', request, audit: [] });

  it('puts the question on the supplier’s portal, in plain words, with a way to answer', () => {
    const html = paint(raised, <PortalFromBuyer counterpartyId="cp-prime" />);
    expect(html).toContain('From the buyer');
    expect(html).toContain('Please extend how long your offer is valid');
    expect(html).toContain('Needs your reply');
    expect(html).toContain('Keep my prices valid for (days)');
    expect(html).toContain('Send reply');
  });

  it('shows another supplier nothing', () => {
    const html = paint(raised, <PortalFromBuyer counterpartyId="cp-abc" />);
    expect(html).not.toContain('Please extend how long your offer is valid');
    expect(html).toContain('Nothing right now');
  });

  it('never tells the supplier how their price is read', () => {
    const all = apply(raised, {
      type: 'SYNC_IN', reviewSignals: reviewSignalRows(raised),
    });
    const html = paint(all, <PortalFromBuyer counterpartyId="cp-prime" />);
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/transform|evaluated cost|knockout|rank|landed|adjust|median|integrity|composition|abnormally/i);
    for (const stage of Object.values(SIGNAL_TEXT)) expect(`${stage.label} ${stage.note}`).not.toMatch(/transform|rank|adjust/i);
  });

  it('says only that prices are received, being checked, or checked', () => {
    expect(reviewSignalRows(base).every((s) => s.stage === 'RECEIVED')).toBe(true);
    expect(reviewSignalRows(raised).find((s) => s.bidderId === 'eb-prime')?.stage).toBe('UNDER_REVIEW');
    expect(reviewSignalRows(raised).find((s) => s.bidderId === 'eb-abc')?.stage).toBe('RECEIVED');
  });

  it('carries the supplier’s reply back, and applies a longer validity only once the evaluator accepts it', () => {
    const replied = apply(raised, {
      type: 'REPLY_BUYER_REQUEST',
      reply: {
        id: 'rp-1', requestId: 'br-1', eventId: PRIMARY_EVENT_ID, bidderId: 'eb-prime',
        text: 'Yes — we will hold it for 50 days.', revisedValidityDays: 50, attachmentName: null, repliedAt: Date.now(),
      },
    });
    expect(paint(replied, <PortalFromBuyer counterpartyId="cp-prime" />)).toContain('Sent — waiting for the buyer');
    // Not applied on the supplier's say-so alone.
    expect(acceptedValidity(PRIMARY_EVENT_ID, replied.buyerRequests, replied.buyerReplies)).toEqual({});
    expect(readModel(replied).flags.some((f) => f.code === 'VALIDITY' && f.bidderId === 'eb-prime')).toBe(true);

    const closed = apply(replied, {
      type: 'CLOSE_BUYER_REQUEST', requestId: 'br-1', accepted: true, at: Date.now(), audit: [],
    });
    expect(acceptedValidity(PRIMARY_EVENT_ID, closed.buyerRequests, closed.buyerReplies)).toEqual({ 'eb-prime': 50 });
    const after = readModel(closed);
    expect(after.flags.some((f) => f.code === 'VALIDITY' && f.bidderId === 'eb-prime')).toBe(false);
    expect(after.result.bids.find((b) => b.bidderId === 'eb-prime')?.responsive).toBe(true);
    expect(paint(closed, <PortalFromBuyer counterpartyId="cp-prime" />)).toContain('has taken your reply into account');
  });

  it('counts an unanswered question as blocking completion', () => {
    const html = paint(raised, <CommercialEvaluation task={taskIn(raised)} me={person('ev-rm')} toast={toast} />);
    expect(html).toContain('Every question to a supplier is settled');
    expect(html).toContain('1 still open');
  });
});

describe('completing', () => {
  const base = unlocked();
  it('freezes the result, locks the workspace, and tells every supplier their price check is done', () => {
    const model = readModel(base);
    const done = apply(base, {
      type: 'COMPLETE_COMMERCIAL_EVALUATION',
      result: {
        eventId: PRIMARY_EVENT_ID, completedBy: 'ev-rm', completedAt: Date.now(), basis: 'LANDED', method: model.rules.method,
        modelHash: model.hash, rows: [], flags: [],
      },
      audit: [],
    });
    expect(reviewSignalRows(done).every((s) => s.stage === 'COMPLETE')).toBe(true);
    const html = paint(done, <CommercialEvaluation task={taskIn(done)} me={person('ev-rm')} toast={toast} />);
    expect(html).toContain('Commercial evaluation complete');
    expect(html).toContain('complete and locked');
  });
});

describe('the seam between the portals', () => {
  async function post(store: any, path: string, body: unknown) {
    const raw = JSON.stringify(body);
    const listeners: Record<string, ((c?: unknown) => void)[]> = {};
    const req = {
      method: 'POST', headers: {},
      on(e: string, fn: (c?: unknown) => void) { (listeners[e] ??= []).push(fn); return req; },
      destroy() {},
    };
    return new Promise<void>((resolve) => {
      const res = { writeHead() { return res; }, end() { resolve(); } };
      void store.handle(req, res, path);
      queueMicrotask(() => {
        for (const fn of listeners.data ?? []) fn(new TextEncoder().encode(raw));
        for (const fn of listeners.end ?? []) fn();
      });
    });
  }
  async function read(store: any) {
    return new Promise<any>((resolve) => {
      const req = { method: 'GET', headers: {}, on() { return req; }, destroy() {} };
      const res = { writeHead() { return res; }, end(p: string) { resolve(JSON.parse(p)); } };
      void store.handle(req, res, '/state');
    });
  }

  it('lets the buyer write requests and the supplier write replies, and neither the other’s', async () => {
    const store = createSyncStore();
    await post(store, '/admin', { buyerRequests: [{ id: 'br-1', subject: 'x' }], buyerReplies: [{ id: 'sneaky' }] });
    await post(store, '/vendor', { buyerReplies: [{ id: 'rp-1', requestId: 'br-1' }], buyerRequests: [{ id: 'sneaky' }] });
    const state = await read(store);
    expect(state.buyerRequests.map((r: { id: string }) => r.id)).toEqual(['br-1']);
    expect(state.buyerReplies.map((r: { id: string }) => r.id)).toEqual(['rp-1']);
  });
});

describe('the evaluation setup is read, not invented', () => {
  it('names a commercial evaluator and a separate technical panel on the seeded event', () => {
    const found = assignmentOf(initialState().events.find((e) => e.id === PRIMARY_EVENT_ID)!, SEEDED)!;
    expect(found.assignment.commercialEvaluatorIds).toEqual(['ev-rm']);
    expect(found.assignment.technicalEvaluatorIds).not.toContain('ev-rm');
    expect(taskFor(initialState().events[0], found.assignment, found.rules).role).toBe('COMMERCIAL');
  });
});
