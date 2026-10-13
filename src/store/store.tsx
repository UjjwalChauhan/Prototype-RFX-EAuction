/**
 * Application state.
 *
 * A reducer over the seed data, with the auction held in the shape the auction
 * service expects. Components never mutate an auction directly — they dispatch,
 * and the reducer routes through `submitBid` / `controllerAction` so the server
 * rules apply identically to the buyer cockpit and the supplier console.
 */
import React from 'react';
import { isBetter } from '../domain/comparator';
import type {
  Bid, Clarification, CostComponent, ConfigSetting, EventBidder, FeedbackPolicy, Id,
  LineItem, Lot, NegotiationRound, Nfa,
  PurchaseRequest, PurchaseRequestLine, Questionnaire, RateContract, Response, Score,
  ServerMillis, SourcingEvent, SourcingRequisition, User, VendorInputPoint,
} from '../domain/types';
import { DEFAULT_OPEN_DECISIONS, type OpenDecisionSettings } from '../domain/nfaLifecycle';
import {
  isSolicitationStage, isStageEvent, solicitationStagesOf, type SolicitationStage,
} from '../domain/stageEvents';
import type { BuiltAuction } from '../domain/auctionSetup';
import { alignParameters } from '../domain/auctionRules';
import { clearRehearsal, rehearseBid } from '../domain/auctionRehearsal';
import {
  DEFAULT_TIMELINE_RULES, HOUR_MS, describeWindow, resolveTimelineRules,
  type EventExtension, type StageSchedule, type TimelineRules,
} from '../domain/eventTimeline';
import { termsForPoint, type TermsDocument } from '../domain/terms';
import {
  type AuctionState, controllerAction, submitBid, type ControllerAction,
} from '../server/auctionService';
import * as seed from '../data/seed';
import { PURCHASE_REQUESTS, PURCHASE_REQUEST_LINES } from '../data/purchaseRequests';
import { RATE_CONTRACTS } from '../data/nfaScenarios';

export type Surface = 'ADMIN' | 'PORTAL';

export interface AppState {
  surface: Surface;
  currentUser: User;
  /** Set when a read-only observer is impersonated in the cockpit. */
  observerMode: boolean;
  /** The tenant-wide agent kill switch. */
  agentKillSwitch: { engaged: boolean; by: string | null; at: number | null };
  connectionLost: boolean;

  events: SourcingEvent[];
  lots: Lot[];
  /**
   * The lines that sit in those lots. Held in state rather than read from the
   * seed because an event created in the wizard brings its own lines with it —
   * a fixed list could only ever describe the seeded event.
   */
  lineItems: LineItem[];
  bidders: EventBidder[];
  responses: Response[];
  scores: Score[];
  clarifications: Clarification[];
  /**
   * What each event asks its suppliers, per stage. Shaped in the Create Event
   * wizard from a library template and owned by the event thereafter — editing
   * an event's questions never reaches back into the shared library.
   */
  questionnaires: Questionnaire[];
  negotiationRounds: NegotiationRound[];
  configSettings: ConfigSetting[];
  nfas: Nfa[];
  /**
   * The nine open decisions of PRD §B14.8, held in state rather than picked.
   * Every screen that changes under one of them reads it from here, so the
   * client can settle the register by flipping a switch and looking.
   */
  nfaOptions: OpenDecisionSettings;
  /** Rate contracts an award established — the call-off destination. */
  rateContracts: RateContract[];
  /**
   * The terms events go out with. Owned by the sourcing event and applied at
   * the points each document names, so an ask resolves what it carries.
   */
  termsDocuments: TermsDocument[];
  /**
   * Every deadline that has been moved, append-only. An ask keeps all of them:
   * "why did this close three days late" is answered from here, not inferred.
   */
  extensions: EventExtension[];

  /** Requisitions live in the store because sourcing mutates their lines. */
  purchaseRequests: PurchaseRequest[];
  purchaseRequestLines: PurchaseRequestLine[];
  /** Consolidated demands (PRD), each mapping an event back to many RQ lines. */
  sourcingRequisitions: SourcingRequisition[];

  /**
   * Every auction, keyed by the event it belongs to.
   *
   * One auction per event rather than one auction in the application: the
   * E-Auction section lists them all with their mechanism, and opening any of
   * them has to give the controller *that* auction, not the one that happens to
   * be running.
   */
  auctions: Record<Id, AuctionState>;
  /**
   * The cost components an event's bids are transformed by.
   *
   * Held here rather than only inside an auction, because commercial evaluation
   * and the comparison sheet transform bids on events that never run one.
   */
  costComponents: CostComponent[];

  /**
   * What the buyer is told about the practice run.
   *
   * Counts and timings — never a price. A rehearsal whose figures reached the
   * buyer would not be practice, it would be a trap: a supplier trying the
   * controls would have disclosed their thinking before the auction opened.
   * So the practice *values* never leave the supplier's application at all,
   * and this is the only thing that crosses.
   */
  rehearsalActivity: RehearsalActivityRow[];

  /**
   * The practice ledger.
   *
   * A separate array rather than a flag on `Bid`, because every ranking,
   * projection and award path in this system reads the real ledger and a flag
   * is a thing each of them has to remember to filter. One that forgot would
   * put a practice bid in a real ranking. This array cannot be read by
   * accident — the code has to ask for it by name.
   *
   * Cleared for an auction when that auction opens. See `domain/auctionRehearsal`.
   */
  practiceBids: Bid[];

  /** Last bid outcome, so both consoles can show the same rejection text. */
  lastBidResult: {
    accepted: boolean;
    code: string | null;
    message: string | null;
    requiresConfirmation: boolean;
    bidderId: Id;
  } | null;
}

export type Action =
  | { type: 'SET_SURFACE'; surface: Surface }
  | { type: 'SET_USER'; userId: Id }
  | { type: 'TOGGLE_OBSERVER' }
  | { type: 'TOGGLE_CONNECTION' }
  | { type: 'ENGAGE_KILL_SWITCH'; by: string }
  | { type: 'RELEASE_KILL_SWITCH' }
  | {
      type: 'SUBMIT_BID';
      /** Which auction. An action that does not name one cannot be applied. */
      eventId: Id;
      auctionLotId: Id; bidderId: Id; bidValue: number; userId: Id;
      source?: 'PORTAL' | 'PROXY' | 'ON_BEHALF' | 'API';
      onBehalfReason?: string; confirmed?: boolean;
    }
  | { type: 'CLEAR_BID_RESULT' }
  | {
      type: 'CONTROLLER_ACTION'; eventId: Id; action: ControllerAction; reason: string;
      extendSec?: number; message?: string;
      /** Required by CHANGE_FEEDBACK: the policy to move to. */
      feedbackPolicy?: FeedbackPolicy;
    }
  /**
   * A practice bid. Validated by the real rules, kept out of the real ledger.
   */
  | {
      type: 'REHEARSE_BID'; eventId: Id; auctionLotId: Id; bidderId: Id;
      bidValue: number; userId: Id; confirmed?: boolean;
    }
  | { type: 'UPDATE_AUCTION'; eventId: Id; patch: Partial<AuctionState['auction']> }
  | { type: 'UPDATE_LOT'; lotId: Id; patch: Partial<Lot> }
  | { type: 'OPEN_LOT'; eventId: Id; auctionLotId: Id }
  | { type: 'UPDATE_EVENT'; eventId: Id; patch: Partial<SourcingEvent> }
  | {
      type: 'CREATE_EVENT'; event: SourcingEvent; lots: Lot[];
      /**
       * The asks the journey implies — the RFI, RFP, RFQ and auction that each
       * appear in their own section. Empty for a journey that solicits nothing.
       */
      stageEvents?: SourcingEvent[];
      /** The lines the buyer put in those lots. */
      lineItems?: LineItem[];
      /** The terms it goes out with, owned by the sourcing event. */
      terms?: TermsDocument[];
      /** What this event asks its suppliers, per stage. */
      questionnaires?: Questionnaire[];
      /** The invitations that put this event in front of suppliers. */
      bidders?: EventBidder[];
      /**
       * The auction the journey implies, ready to run.
       *
       * Installed in the same dispatch as the ask it belongs to. An auction ask
       * that reaches the board without one is a row nobody can open — which is
       * what every auction published from a journey used to be.
       */
      auction?: BuiltAuction | null;
      /** Requisition lines this event was raised for — marked as out in it. */
      sourcedLineIds?: Id[];
      /** The consolidated demand the event was raised against. */
      sourcingRequisitionId?: Id;
    }
  /**
   * State arriving from the other application through the sync server. Each
   * side only ever sends what it owns, so this replaces slices rather than
   * merging them — there is no conflict to resolve.
   */
  | {
      type: 'SYNC_IN';
      events?: SourcingEvent[];
      lots?: Lot[];
      lineItems?: LineItem[];
      termsDocuments?: TermsDocument[];
      bidders?: EventBidder[];
      questionnaires?: Questionnaire[];
      responses?: Response[];
      /**
       * The auctions, buyer-owned: the configuration, the lots and the control
       * log. The roster and the lot details are not sent — they are already on
       * the wire as `bidders` and `lots`, and a second copy is a second thing
       * that can fall out of step.
       */
      auctions?: AuctionSyncRow[];
      /**
       * Bids placed on the supplier's portal, flat across every auction.
       *
       * The one slice the vendor owns here. Merged into each auction's ledger
       * by id rather than replacing it, because the buyer's side of the ledger
       * — a bid placed on behalf, everything seeded — is not the portal's to
       * overwrite.
       */
      bids?: Bid[];
      /**
       * How far along each supplier is. Applied only where it moves one
       * forward, so a stale poll cannot un-submit a response.
       */
      participation?: ParticipationRow[];
      /**
       * Who has used the practice run, in counts. The figures a supplier
       * typed while practising never appear on the wire at all.
       */
      rehearsalActivity?: RehearsalActivityRow[];
    }
  /** A supplier answering an ask. Resubmitting creates a new version. */
  | { type: 'SUBMIT_RESPONSE'; response: Response }
  /** A supplier opening an ask, so the buyer can see it was read. */
  | { type: 'SET_PARTICIPATION'; bidderId: Id; status: EventBidder['participationStatus'] }
  | { type: 'CREATE_SOURCING_REQUISITION'; requisition: SourcingRequisition }
  | { type: 'UPDATE_BIDDER'; bidderId: Id; patch: Partial<EventBidder> }
  | { type: 'ADD_SCORE'; score: Score }
  | { type: 'ANSWER_CLARIFICATION'; id: Id; answer: string; visibility: Clarification['visibility']; userId: Id }
  | { type: 'ADD_CLARIFICATION'; clarification: Clarification }
  | { type: 'ADD_NEGOTIATION_ROUND'; round: NegotiationRound }
  | { type: 'SET_CONFIG'; setting: ConfigSetting }
  | { type: 'ADD_NFA'; nfa: Nfa }
  | { type: 'UPDATE_NFA'; nfaId: Id; patch: Partial<Nfa> }
  /**
   * The lifecycle transitions are computed by pure functions in
   * `domain/nfaLifecycle` and land here whole, so the reducer never holds a
   * second opinion about materiality or the chain.
   */
  | { type: 'REPLACE_NFA'; nfa: Nfa }
  /** Seeds a demo note with history, replacing any note on the same event. */
  | { type: 'SET_EVENT_NFA'; eventId: Id; nfa: Nfa | null }
  | { type: 'SET_NFA_OPTION'; patch: Partial<OpenDecisionSettings> }
  | { type: 'UPDATE_CONTRACT'; contractId: Id; patch: Partial<RateContract> }
  /**
   * A deadline moved. The extension is recorded and the asks it affects take
   * their new close dates in the same transaction — a schedule that is one
   * dispatch ahead of its own audit trail is a schedule nobody can defend.
   */
  | {
      type: 'EXTEND_EVENT';
      extension: EventExtension;
      closes: { eventId: Id; closesAt: number }[];
    };

export function initialState(): AppState {
  const auctions = seed.AUCTIONS_BY_EVENT();
  return {
    surface: 'ADMIN',
    currentUser: seed.CURRENT_USER,
    observerMode: false,
    agentKillSwitch: { engaged: false, by: null, at: null },
    connectionLost: false,

    events: seed.EVENTS,
    // The primary event's lots first, then every other seeded event's basket —
    // an event with no lots has nothing for a supplier to price.
    lots: [...seed.LOTS, ...seed.OTHER_EVENT_LOTS],
    lineItems: [...seed.LINE_ITEMS, ...seed.OTHER_EVENT_LINE_ITEMS],
    /**
     * Every invitation, including the rosters that belong to the seeded
     * auctions rather than to the primary event.
     *
     * Without them the lobby of a seeded auction counted zero bidders and
     * refused to start while five of them were plainly listed on the screen
     * beside it — the auction held its own roster and the event-level list
     * had never heard of them.
     */
    bidders: Object.values(Object.fromEntries(
      [
        ...seed.EVENT_BIDDERS,
        // The shortlists behind the seeded RFI, RFP and RFQ. Without them
        // those asks were visible to the buyer and to nobody else.
        ...seed.REQUEST_BIDDERS,
        ...Object.values(auctions).flatMap((held) => held.bidders),
      ].map((bidder) => [bidder.id, bidder]),
    )),
    responses: seed.RESPONSES,
    scores: seed.SCORES,
    clarifications: seed.CLARIFICATIONS,
    // The questions each seeded written ask puts to a supplier. An ask with
    // no questionnaire opens as an empty form in the portal.
    questionnaires: seed.REQUEST_QUESTIONNAIRES(),
    negotiationRounds: seed.NEGOTIATION_ROUNDS,
    configSettings: seed.CONFIG_SETTINGS,
    nfas: [],
    nfaOptions: DEFAULT_OPEN_DECISIONS,
    rateContracts: RATE_CONTRACTS,
    termsDocuments: [],
    extensions: [],

    purchaseRequests: PURCHASE_REQUESTS,
    purchaseRequestLines: PURCHASE_REQUEST_LINES,
    sourcingRequisitions: [],

    auctions,
    costComponents: seed.COST_COMPONENTS,

    practiceBids: [],
    rehearsalActivity: [],
    lastBidResult: null,
  };
}

/**
 * One auction, as it crosses between the two applications.
 *
 * Keyed by the ask it belongs to, which is also its `id` so the sync seam can
 * merge a list of them without knowing what an auction is.
 */
export interface AuctionSyncRow {
  id: Id;
  auction: AuctionState['auction'];
  lots: AuctionState['lots'];
  bids: Bid[];
  controlEvents: AuctionState['controlEvents'];
}

/** What the buyer's platform publishes about its auctions. */
export function auctionSyncRows(state: AppState): AuctionSyncRow[] {
  return Object.values(state.auctions).map((held) => ({
    id: held.auction.eventId,
    auction: held.auction,
    lots: held.lots,
    bids: held.bids,
    controlEvents: held.controlEvents,
  }));
}

/** Every bid this side holds, flat. What the supplier's portal sends back. */
export function allBids(state: AppState): Bid[] {
  return Object.values(state.auctions).flatMap((held) => held.bids);
}

/**
 * One supplier's use of the practice run, as the buyer is allowed to know it.
 *
 * Deliberately not a bid. The controller needs to answer "is this field ready
 * to bid" before opening the room — a Japanese auction where nobody has tried
 * the confirm button is a Japanese auction about to eliminate half its field
 * by accident. That question is answered by counts. It does not need, and
 * must not have, the prices.
 */
export interface RehearsalActivityRow {
  /** The bidder row, which is also the id the seam merges on. */
  id: Id;
  auctionId: Id;
  attempts: number;
  /** How many were accepted by the real validator. */
  accepted: number;
  lastAt: ServerMillis;
}

/** What the supplier's portal reports about the practice run. */
export function rehearsalActivityRows(state: AppState): RehearsalActivityRow[] {
  const byBidder = new Map<Id, RehearsalActivityRow>();
  for (const bid of state.practiceBids) {
    const held = byBidder.get(bid.bidderId) ?? {
      id: bid.bidderId, auctionId: bid.auctionId, attempts: 0, accepted: 0, lastAt: 0,
    };
    held.attempts += 1;
    if (bid.isValid) held.accepted += 1;
    held.lastAt = Math.max(held.lastAt, bid.submittedAt);
    byBidder.set(bid.bidderId, held);
  }
  return [...byBidder.values()];
}

/**
 * How far along each supplier is, as the portal knows it.
 *
 * The invitation row belongs to the buyer; this one fact about it does not.
 * Only the portal knows whether a supplier has opened an ask, and the buyer's
 * Bidders tab was reporting "not started" against suppliers whose submitted
 * answers were already on the buyer's own Responses tab.
 *
 * Only rows that have actually moved are sent. Pushing the whole roster back
 * would let a portal that had not yet heard about a submission overwrite it
 * with the "not started" it still held.
 */
export interface ParticipationRow {
  /** The invitation row's id, so the seam can merge these like anything else. */
  id: Id;
  status: EventBidder['participationStatus'];
}

export function participationRows(state: AppState): ParticipationRow[] {
  return state.bidders
    .filter((bidder) => PARTICIPATION_RANK[bidder.participationStatus] > 0)
    .map((bidder) => ({ id: bidder.id, status: bidder.participationStatus }));
}

/**
 * How far along a status is.
 *
 * Applied in one direction only. A poll that arrives out of order, a portal
 * tab reloaded back to its seed, a supplier reopening an ask they have already
 * answered — each of them would otherwise walk a submission backwards, and the
 * buyer would watch a response they had read disappear from the roster.
 */
const PARTICIPATION_RANK: Record<EventBidder['participationStatus'], number> = {
  NOT_STARTED: 0,
  REGISTERED: 0,
  IDLE: 1,
  JOINED: 1,
  IN_PROGRESS: 1,
  BIDDING: 2,
  SUBMITTED: 3,
  // Terminal. A supplier who has left has left, whatever they did before it.
  WITHDRAWN: 4,
  DROPPED_OUT: 4,
  ELIMINATED: 4,
};

/** Fold the portal's view of who has started into the buyer's roster. */
function applyParticipation(
  bidders: EventBidder[], rows: ParticipationRow[] | undefined,
): EventBidder[] {
  if (rows === undefined || rows.length === 0) return bidders;
  const arrived = new Map(rows.map((row) => [row.id, row.status]));
  return bidders.map((bidder) => {
    const next = arrived.get(bidder.id);
    if (next === undefined) return bidder;
    return PARTICIPATION_RANK[next] > PARTICIPATION_RANK[bidder.participationStatus]
      ? { ...bidder, participationStatus: next }
      : bidder;
  });
}

/**
 * Fold what arrived from the other application into the auctions held here.
 *
 * Two directions, and they are not symmetrical. The portal receives whole
 * auctions and keeps any bid of its own the buyer has not seen yet, so a bid
 * placed a moment ago does not vanish and reappear on the next poll. The
 * platform receives only bids and appends the ones it does not have, because
 * the configuration is its own and nothing on the portal may edit it.
 */
function applySyncedAuctions(
  current: Record<Id, AuctionState>,
  action: { auctions?: AuctionSyncRow[]; bids?: Bid[] },
  lots: Lot[],
  bidders: EventBidder[],
): Record<Id, AuctionState> {
  let next = current;

  if (action.auctions !== undefined) {
    const lotDetails = Object.fromEntries(lots.map((lot) => [lot.id, lot]));
    next = { ...next };
    for (const row of action.auctions) {
      const held = next[row.id];
      const arrived = new Set(row.bids.map((bid) => bid.id));
      const mine = (held?.bids ?? []).filter((bid) => !arrived.has(bid.id));
      next[row.id] = {
        auction: row.auction,
        lots: row.lots,
        lotDetails,
        bids: [...row.bids, ...mine].sort((a, b) => b.sequenceNumber - a.sequenceNumber),
        // The roster is the ask's invitations, which came over the same wire.
        bidders: bidders.filter((bidder) => bidder.eventId === row.id),
        costComponents: held?.costComponents ?? [],
        controlEvents: row.controlEvents,
        integrityFlags: held?.integrityFlags ?? [],
      };
    }
  }

  if (action.bids !== undefined) {
    const byAuction = new Map<Id, Bid[]>();
    for (const bid of action.bids) {
      byAuction.set(bid.auctionId, [...(byAuction.get(bid.auctionId) ?? []), bid]);
    }
    next = Object.fromEntries(Object.entries(next).map(([id, held]) => {
      const incoming = byAuction.get(held.auction.id) ?? [];
      const known = new Set(held.bids.map((bid) => bid.id));
      const fresh = incoming.filter((bid) => !known.has(bid.id));
      if (fresh.length === 0) return [id, held];
      return [id, {
        ...held,
        bids: [...fresh, ...held.bids].sort((a, b) => b.sequenceNumber - a.sequenceNumber),
      }];
    }));
  }

  return next;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SURFACE':
      return { ...state, surface: action.surface };

    case 'SET_USER': {
      const user = seed.USERS.find((u) => u.id === action.userId);
      return user ? { ...state, currentUser: user } : state;
    }

    case 'TOGGLE_OBSERVER':
      return { ...state, observerMode: !state.observerMode };

    case 'TOGGLE_CONNECTION':
      return { ...state, connectionLost: !state.connectionLost };

    case 'ENGAGE_KILL_SWITCH':
      return { ...state, agentKillSwitch: { engaged: true, by: action.by, at: Date.now() } };

    case 'RELEASE_KILL_SWITCH':
      return { ...state, agentKillSwitch: { engaged: false, by: null, at: null } };

    case 'SUBMIT_BID': {
      // A lost connection means the bid never reaches the server.
      if (state.connectionLost) {
        return {
          ...state,
          lastBidResult: {
            accepted: false, code: 'OFFLINE',
            message: 'No connection to the server. Your bid was not submitted.',
            requiresConfirmation: false, bidderId: action.bidderId,
          },
        };
      }
      const held = state.auctions[action.eventId];
      if (!held) return state;
      const result = submitBid({
        state: held,
        auctionLotId: action.auctionLotId,
        bidderId: action.bidderId,
        bidValue: action.bidValue,
        userId: action.userId,
        source: action.source,
        clientTimestamp: Date.now(),
        onBehalfReason: action.onBehalfReason,
        confirmed: action.confirmed,
      });
      return {
        ...state,
        auctions: { ...state.auctions, [action.eventId]: result.state },
        lastBidResult: {
          accepted: result.accepted,
          code: result.rejectionCode,
          message: result.message,
          requiresConfirmation: result.requiresConfirmation,
          bidderId: action.bidderId,
        },
      };
    }

    case 'CLEAR_BID_RESULT':
      return { ...state, lastBidResult: null };

    /**
     * A practice bid.
     *
     * Routed through the real validator against the real configuration, so
     * the supplier meets this auction's minimum decrement here rather than
     * with the clock running. It lands in `practiceBids`, which nothing that
     * ranks or awards ever reads.
     */
    case 'REHEARSE_BID': {
      const held = state.auctions[action.eventId];
      if (!held) return state;
      const lot = held.lots.find((l) => l.id === action.auctionLotId);
      if (!lot) return state;

      const result = rehearseBid({
        auction: held.auction,
        lot,
        lotDetail: held.lotDetails[lot.lotId],
        bidderId: action.bidderId,
        bidValue: action.bidValue,
        quantity: 1,
        lineCount: 1,
        serverNow: Date.now(),
        practiceBids: state.practiceBids.filter((b) => b.auctionLotId === action.auctionLotId),
        costComponents: held.costComponents,
        confirmed: action.confirmed,
        userId: action.userId,
      });

      return {
        ...state,
        practiceBids: [
          ...state.practiceBids.filter((b) => b.auctionLotId !== action.auctionLotId),
          ...result.practiceBids,
        ],
        lastBidResult: {
          accepted: result.outcome.accepted,
          code: result.outcome.code,
          message: result.outcome.message,
          requiresConfirmation: result.outcome.requiresConfirmation,
          bidderId: action.bidderId,
        },
      };
    }

    case 'CONTROLLER_ACTION': {
      const target = state.auctions[action.eventId];
      if (!target) return state;
      const next = controllerAction(
        target, action.action, state.currentUser.id, action.reason,
        {
          extendSec: action.extendSec,
          message: action.message,
          feedbackPolicy: action.feedbackPolicy,
        },
      );
      let events = state.events;
      if (action.action === 'FORCE_CLOSE' || action.action === 'ABORT') {
        events = events.map((e) =>
          e.id === next.auction.eventId ? { ...e, status: 'AUCTION_CLOSED' as const } : e,
        );
      }
      /**
       * Opening the auction discards everything the rehearsal produced.
       *
       * A practice bid that survived into a live room would be a bid nobody
       * meant to place, sitting in a ranking against bids people did.
       */
      const practiceBids = action.action === 'OPEN'
        ? clearRehearsal(state.practiceBids, next.auction.id)
        : state.practiceBids;

      return {
        ...state,
        auctions: { ...state.auctions, [action.eventId]: next },
        events,
        practiceBids,
      };
    }

    case 'UPDATE_AUCTION': {
      const target = state.auctions[action.eventId];
      if (!target) return state;
      const patched = { ...target.auction, ...action.patch };
      /**
       * Changing the mechanism changes which settings exist.
       *
       * A draft moved from Dutch to English keeps a clock tick with nothing to
       * tick, and moved back would find it gone. Realigned here so the stored
       * configuration says what the auction actually has, rather than relying
       * on every reader to fall back to a default.
       */
      const auction = action.patch.mechanism !== undefined
        && action.patch.mechanism !== target.auction.mechanism
        ? { ...patched, parameters: alignParameters(patched) }
        : patched;
      return {
        ...state,
        auctions: { ...state.auctions, [action.eventId]: { ...target, auction } },
      };
    }

    case 'UPDATE_LOT': {
      const lots = state.lots.map((l) => (l.id === action.lotId ? { ...l, ...action.patch } : l));
      // Lot detail is shared, so every auction that holds this lot sees the edit.
      const details = Object.fromEntries(lots.map((l) => [l.id, l]));
      return {
        ...state,
        lots,
        auctions: Object.fromEntries(
          Object.entries(state.auctions).map(([id, held]) => [
            id, { ...held, lotDetails: { ...held.lotDetails, ...details } },
          ]),
        ),
      };
    }

    case 'OPEN_LOT': {
      const target = state.auctions[action.eventId];
      if (!target) return state;
      return {
        ...state,
        auctions: {
          ...state.auctions,
          [action.eventId]: {
            ...target,
            lots: target.lots.map((l) =>
              l.id === action.auctionLotId ? { ...l, status: 'LOT_OPEN' as const } : l,
            ),
          },
        },
      };
    }

    case 'UPDATE_EVENT':
      return {
        ...state,
        events: state.events.map((e) => (e.id === action.eventId ? { ...e, ...action.patch } : e)),
      };

    case 'CREATE_SOURCING_REQUISITION':
      return {
        ...state,
        sourcingRequisitions: [...state.sourcingRequisitions, action.requisition],
      };

    case 'SUBMIT_RESPONSE':
      return {
        ...state,
        responses: [
          ...state.responses.filter((r) => r.id !== action.response.id),
          action.response,
        ],
        bidders: state.bidders.map((b) =>
          b.id === action.response.bidderId
            ? { ...b, participationStatus: 'SUBMITTED' as const }
            : b,
        ),
      };

    case 'SET_PARTICIPATION':
      return {
        ...state,
        bidders: state.bidders.map((b) =>
          // Never walk a submission backwards because a page was reopened.
          b.id === action.bidderId && b.participationStatus !== 'SUBMITTED'
            ? { ...b, participationStatus: action.status }
            : b,
        ),
      };

    case 'SYNC_IN': {
      const lots = action.lots ?? state.lots;
      const bidders = applyParticipation(action.bidders ?? state.bidders, action.participation);
      return {
        ...state,
        events: action.events ?? state.events,
        lots,
        lineItems: action.lineItems ?? state.lineItems,
        termsDocuments: action.termsDocuments ?? state.termsDocuments,
        bidders,
        questionnaires: action.questionnaires ?? state.questionnaires,
        responses: action.responses ?? state.responses,
        rehearsalActivity: action.rehearsalActivity ?? state.rehearsalActivity,
        auctions: applySyncedAuctions(state.auctions, action, lots, bidders),
      };
    }

    case 'CREATE_EVENT': {
      // Publishing against a consolidated demand takes its lines out of the
      // sourceable pool in the same transaction that creates the event, so a
      // line can never be selected into a second basket.
      const sourced = new Set(action.sourcedLineIds ?? []);
      const purchaseRequestLines = sourced.size === 0
        ? state.purchaseRequestLines
        : state.purchaseRequestLines.map((line) =>
            sourced.has(line.id)
              ? { ...line, sourcingState: 'IN_EVENT' as const, eventNumber: action.event.eventNumber }
              : line,
          );

      const built = action.auction ?? null;
      const auctionAskId = built?.auction.eventId ?? null;

      return {
        ...state,
        // The umbrella first, then its asks: one publish, one transaction, so
        // an event can never exist for a moment without the RFI it implies.
        events: [action.event, ...(action.stageEvents ?? []), ...state.events],
        lots: [...state.lots, ...action.lots],
        lineItems: [...state.lineItems, ...(action.lineItems ?? [])],
        termsDocuments: [...state.termsDocuments, ...(action.terms ?? [])],
        questionnaires: [...state.questionnaires, ...(action.questionnaires ?? [])],
        bidders: [...state.bidders, ...(action.bidders ?? [])],
        // Keyed by the auction ask, not the umbrella: that is the row the
        // E-Auction board reads its number and its window from.
        auctions: built === null ? state.auctions : {
          ...state.auctions,
          [built.auction.eventId]: {
            auction: built.auction,
            lots: built.lots,
            lotDetails: Object.fromEntries(action.lots.map((lot) => [lot.id, lot])),
            bids: [],
            // The roster is the ask's invitations. A supplier invited to the
            // RFQ in front of it is not yet in the auction room.
            bidders: (action.bidders ?? []).filter((b) => b.eventId === auctionAskId),
            costComponents: [],
            controlEvents: [],
            integrityFlags: [],
          },
        },
        purchaseRequestLines,
        sourcingRequisitions: state.sourcingRequisitions.map((r) =>
          r.id === action.sourcingRequisitionId ? { ...r, eventId: action.event.id } : r,
        ),
      };
    }

    case 'EXTEND_EVENT': {
      const moved = new Map(action.closes.map((c) => [c.eventId, c.closesAt]));
      return {
        ...state,
        events: state.events.map((event) =>
          moved.has(event.id) ? { ...event, closesAt: moved.get(event.id)! } : event,
        ),
        extensions: [...state.extensions, action.extension],
      };
    }

    case 'UPDATE_BIDDER': {
      const bidders = state.bidders.map((b) =>
        b.id === action.bidderId ? { ...b, ...action.patch } : b,
      );
      // The auction holds its own roster, so an edit has to reach the one this
      // bidder belongs to as well as the event-level list.
      const patched = action.patch;
      return {
        ...state,
        bidders,
        auctions: Object.fromEntries(
          Object.entries(state.auctions).map(([id, held]) => [
            id,
            held.bidders.some((b) => b.id === action.bidderId)
              ? {
                  ...held,
                  bidders: held.bidders.map((b) =>
                    b.id === action.bidderId ? { ...b, ...patched } : b,
                  ),
                }
              : held,
          ]),
        ),
      };
    }

    case 'ADD_SCORE':
      return { ...state, scores: [...state.scores, action.score] };

    case 'ANSWER_CLARIFICATION':
      return {
        ...state,
        clarifications: state.clarifications.map((c) =>
          c.id === action.id
            ? {
                ...c, answer: action.answer, answeredAt: Date.now(),
                answeredBy: action.userId, visibility: action.visibility,
              }
            : c,
        ),
      };

    case 'ADD_CLARIFICATION':
      return { ...state, clarifications: [action.clarification, ...state.clarifications] };

    case 'ADD_NEGOTIATION_ROUND':
      return { ...state, negotiationRounds: [...state.negotiationRounds, action.round] };

    case 'SET_CONFIG': {
      const others = state.configSettings.filter(
        (s) => !(s.key === action.setting.key && s.scopeType === action.setting.scopeType && s.scopeId === action.setting.scopeId),
      );
      return { ...state, configSettings: [...others, action.setting] };
    }

    case 'ADD_NFA':
      return { ...state, nfas: [...state.nfas, action.nfa] };

    case 'UPDATE_NFA':
      return {
        ...state,
        nfas: state.nfas.map((n) => (n.id === action.nfaId ? { ...n, ...action.patch } : n)),
      };

    case 'REPLACE_NFA':
      return {
        ...state,
        nfas: state.nfas.some((n) => n.id === action.nfa.id)
          ? state.nfas.map((n) => (n.id === action.nfa.id ? action.nfa : n))
          : [...state.nfas, action.nfa],
      };

    case 'SET_EVENT_NFA': {
      const others = state.nfas.filter((n) => n.eventId !== action.eventId);
      return { ...state, nfas: action.nfa ? [...others, action.nfa] : others };
    }

    case 'SET_NFA_OPTION':
      return { ...state, nfaOptions: { ...state.nfaOptions, ...action.patch } };

    case 'UPDATE_CONTRACT':
      return {
        ...state,
        rateContracts: state.rateContracts.map((c) =>
          c.id === action.contractId ? { ...c, ...action.patch } : c,
        ),
      };
  }
}

const StoreContext = React.createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function StoreProvider({
  children, seed: seedState,
}: {
  children: React.ReactNode;
  /** Overrides applied over the seeded state. Used by screen tests. */
  seed?: Partial<AppState>;
}) {
  const [state, dispatch] = React.useReducer(
    reducer,
    undefined,
    () => ({ ...initialState(), ...seedState }),
  );
  const value = React.useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = React.useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside a StoreProvider.');
  return context;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function useEvent(eventId: Id): SourcingEvent | undefined {
  const { state } = useStore();
  return state.events.find((e) => e.id === eventId);
}

/**
 * The event whose basket an event answers against.
 *
 * One family, one basket. An RFI, the RFP behind it and the auction at the end
 * are asks against the same lines, held on the sourcing event they hang off —
 * so re-lotting once cannot leave one ask describing something else.
 */
export function basketOwnerId(state: AppState, eventId: Id): Id {
  const event = state.events.find((e) => e.id === eventId);
  return event?.parentEventId ?? eventId;
}

export function lotsForEvent(state: AppState, eventId: Id): Lot[] {
  const ownerId = basketOwnerId(state, eventId);
  return state.lots.filter((l) => l.eventId === ownerId);
}

/** An event and the asks created under it. */
export function eventFamily(state: AppState, eventId: Id): Id[] {
  return [eventId, ...state.events.filter((e) => e.parentEventId === eventId).map((e) => e.id)];
}

/** The asks created under a sourcing event, in the order the journey runs them. */
export function stageEventsOf(state: AppState, eventId: Id): SourcingEvent[] {
  return state.events.filter((e) => e.parentEventId === eventId && isStageEvent(e));
}

/** The lines of an event, in lot then line order. */
export function lineItemsForEvent(state: AppState, eventId: Id): LineItem[] {
  const lots = lotsForEvent(state, eventId);
  const order = new Map(lots.map((l, i) => [l.id, i]));
  return state.lineItems
    .filter((l) => order.has(l.lotId))
    .sort((a, b) => order.get(a.lotId)! - order.get(b.lotId)! || a.lineNumber - b.lineNumber);
}

/**
 * The terms an event carries.
 *
 * Asked about one ask, this answers with the documents applied at that ask's
 * point — the general conditions and, where a price is asked, the payment
 * terms. Asked about the sourcing event, it answers with all of them, because
 * from the board the question is what the event goes out with.
 */
export function termsForEvent(state: AppState, eventId: Id): TermsDocument[] {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return [];
  const ownerId = event.parentEventId ?? eventId;
  const owned = state.termsDocuments.filter((document) => document.eventId === ownerId);
  if (event.parentEventId === null) return owned;
  return termsForPoint(owned, event.currentStage as VendorInputPoint);
}

/**
 * The time rules an event is governed by.
 *
 * Read off the configuration frozen at publish, not off today's default — an
 * extension is judged against the rules the event went out under, however the
 * tenant default has moved since.
 */
export function timelineRulesOf(state: AppState, eventId: Id): TimelineRules {
  const event = state.events.find((e) => e.id === eventId);
  const root = event?.parentEventId === null || event === undefined
    ? event
    : state.events.find((e) => e.id === event.parentEventId) ?? event;
  const frozen = (root?.configSnapshotAtPublish ?? {}) as { timelineRules?: Partial<TimelineRules> };
  return resolveTimelineRules(frozen.timelineRules ?? DEFAULT_TIMELINE_RULES);
}

export interface ScheduledAsk {
  event: SourcingEvent;
  stage: SolicitationStage;
  window: StageSchedule;
  /** Extensions already recorded against this ask, oldest first. */
  extensions: EventExtension[];
}

/**
 * The live schedule of a sourcing event, read off the asks themselves.
 *
 * Only the close date is stored, on each ask. An opening is derived: the first
 * ask opens when the event was published, and every ask after it opens when the
 * one before it closed, plus the configured gap. That is one source of truth
 * rather than two dates that can drift apart when a deadline moves.
 */
export function scheduleOf(state: AppState, eventId: Id): ScheduledAsk[] {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return [];
  const rootId = event.parentEventId ?? eventId;
  const root = state.events.find((e) => e.id === rootId) ?? event;
  const rules = timelineRulesOf(state, rootId);

  const order = solicitationStagesOf(root.journeyPattern);
  const asks = stageEventsOf(state, rootId)
    .slice()
    .sort((a, b) => order.indexOf(a.currentStage as SolicitationStage)
      - order.indexOf(b.currentStage as SolicitationStage));

  // An event that predates the split into asks — or one whose journey creates
  // none — is its own single window. It has a deadline like any other, and it
  // is governed by the same rules.
  if (asks.length === 0) {
    const stage = root.currentStage;
    if (!isSolicitationStage(stage) || root.closesAt === null) return [];
    const opensAt = root.publishedAt ?? root.closesAt;
    return [{
      event: root,
      stage,
      window: describeWindow({ stage, opensAt, closesAt: root.closesAt }, rules),
      extensions: state.extensions
        .filter((e) => e.eventId === root.id)
        .sort((a, b) => a.sequence - b.sequence),
    }];
  }

  let cursor = root.publishedAt ?? asks[0]?.publishedAt ?? null;
  return asks.map((ask, index) => {
    const stage = ask.currentStage as SolicitationStage;
    const opensAt = index === 0
      ? ask.publishedAt ?? cursor ?? ask.closesAt ?? 0
      : (cursor ?? 0) + rules.gapHoursBetweenStages * HOUR_MS;
    const closesAt = ask.closesAt ?? opensAt;
    cursor = closesAt;
    return {
      event: ask,
      stage,
      window: describeWindow({ stage, opensAt, closesAt }, rules),
      extensions: state.extensions
        .filter((e) => e.eventId === ask.id)
        .sort((a, b) => a.sequence - b.sequence),
    };
  });
}

/**
 * The responses against an event.
 *
 * A supplier answers an ask, so a submission is filed against the RFI or the
 * RFQ rather than against the sourcing event that raised it. Asked from the
 * umbrella, this answers with everything sent to any of its asks — otherwise
 * the event that commissioned the work shows an empty inbox while its asks
 * fill up.
 */
export function responsesForEvent(state: AppState, eventId: Id): Response[] {
  const family = new Set(eventFamily(state, eventId));
  return state.responses.filter((r) => family.has(r.eventId));
}

/**
 * The suppliers on an event.
 *
 * Invitations belong to the ask, not to the umbrella — a supplier invited to
 * the RFI has not thereby been invited to the RFP. Asked about a sourcing
 * event, this answers with everyone invited to any of its asks, deduplicated,
 * because that is what "who is on this event" means from the board.
 */
export function biddersForEvent(state: AppState, eventId: Id): EventBidder[] {
  const own = state.bidders.filter((b) => b.eventId === eventId);
  if (own.length > 0) return own;
  const family = new Set(stageEventsOf(state, eventId).map((e) => e.id));
  if (family.size === 0) return own;
  const seen = new Set<Id>();
  return state.bidders.filter((b) => {
    if (!family.has(b.eventId) || seen.has(b.counterpartyId)) return false;
    seen.add(b.counterpartyId);
    return true;
  });
}

export function sourcingRequisition(
  state: AppState, id: Id | undefined,
): SourcingRequisition | undefined {
  return id === undefined ? undefined : state.sourcingRequisitions.find((r) => r.id === id);
}

/** The requisition lines a consolidated demand was built from, in line order. */
export function linesOfRequisition(
  state: AppState, requisition: SourcingRequisition | undefined,
): PurchaseRequestLine[] {
  if (!requisition) return [];
  const wanted = new Set(requisition.lineIds);
  return state.purchaseRequestLines.filter((l) => wanted.has(l.id));
}

/** The note in flight on an event. One event carries at most one live note. */
export function nfaForEvent(state: AppState, eventId: Id): Nfa | undefined {
  return state.nfas.find((n) => n.eventId === eventId && n.supersededByNfaId === null)
    ?? state.nfas.find((n) => n.eventId === eventId);
}

/** Rate contracts this event's award established. */
export function contractsForEvent(state: AppState, eventId: Id): RateContract[] {
  return state.rateContracts.filter((c) => c.eventId === eventId);
}

// ---------------------------------------------------------------------------
// Auctions
// ---------------------------------------------------------------------------

/**
 * The auction on an event, if it has one.
 *
 * An event may legitimately have none — most do — so this returns null rather
 * than a hollow auction that screens then have to test for in another way.
 */
export function auctionFor(state: AppState, eventId: Id): AuctionState | null {
  return state.auctions[eventId] ?? null;
}

/**
 * The auctions in the shape the API stores them.
 *
 * The roster and the lot details are dropped on the way out: they belong to
 * the ask and the basket, and the repository joins them back on. Used to seed
 * the in-process API so `/api/auction-events` answers with what is on screen.
 */
export function auctionRecords(state: AppState) {
  return Object.values(state.auctions).map((held) => ({
    auction: held.auction,
    lots: held.lots,
    bids: held.bids,
    controlEvents: held.controlEvents,
  }));
}

/** The cost components that transform this event's bids. */
export function costComponentsFor(state: AppState, eventId: Id): CostComponent[] {
  return state.costComponents.filter((c) => c.eventId === eventId);
}

/**
 * One row per auction, for the E-Auction section.
 *
 * The mechanism travels with the row because it is the first thing a controller
 * needs: a Japanese auction and a Dutch auction on the same board are not two
 * instances of one thing, they are two different events with different rules,
 * different screens and different ways to lose.
 */
export interface AuctionSummary {
  eventId: Id;
  event: SourcingEvent;
  auction: AuctionState['auction'];
  lots: number;
  bidders: number;
  bids: number;
  /** Best standing on the lot currently open, in buyer-comparable terms. */
  bestValue: number | null;
  startingValue: number;
  opensAt: ServerMillis | null;
  closesAt: ServerMillis | null;
}

export function auctionSummaries(state: AppState): AuctionSummary[] {
  return Object.values(state.auctions)
    .map((held): AuctionSummary | null => {
      const event = state.events.find((e) => e.id === held.auction.eventId);
      if (!event) return null;
      const open = held.lots.find((l) => l.status === 'LOT_OPEN') ?? held.lots[0] ?? null;
      const onLot = open === null
        ? []
        : held.bids.filter((b) => b.auctionLotId === open.id && b.isValid);
      const best = onLot.length === 0
        ? null
        : onLot
          .map((b) => b.transformedValue)
          .reduce((a, b) => (isBetter(b, a, held.auction.side) ? b : a));
      return {
        eventId: event.id,
        event,
        auction: held.auction,
        lots: held.lots.length,
        bidders: held.bidders.length,
        bids: held.bids.filter((b) => b.isValid).length,
        bestValue: best,
        startingValue: held.lots.reduce((sum, l) => sum + l.startingPrice, 0),
        opensAt: held.auction.startsAt,
        closesAt: held.auction.endsAt,
      };
    })
    .filter((row): row is AuctionSummary => row !== null)
    .sort((a, b) => {
      // Live first — it is the only one anybody needs this second.
      const rank = (s: AuctionSummary) =>
        s.auction.status === 'LIVE' || s.auction.status === 'EXTENDED' ? 0
        : s.auction.status === 'PAUSED' ? 1
        : s.auction.status === 'SCHEDULED' || s.auction.status === 'LOBBY_OPEN' ? 2
        : 3;
      return rank(a) - rank(b) || (a.opensAt ?? 0) - (b.opensAt ?? 0);
    });
}

/** Auctions taking bids right now. */
export function liveAuctions(state: AppState): AuctionState[] {
  return Object.values(state.auctions).filter(
    (held) => held.auction.status === 'LIVE' || held.auction.status === 'EXTENDED',
  );
}

/**
 * Every auction this supplier is invited to, most urgent first.
 *
 * A supplier is routinely in more than one at once, and they are rarely the
 * same mechanism — so "the supplier's auction" is not a thing that exists. The
 * console picks from this list and says which one it is showing; guessing was
 * how a Japanese bidder ended up looking at a sealed-bid form.
 */
export function auctionsForBidder(state: AppState, counterpartyId: Id): AuctionState[] {
  const rank = (held: AuctionState) =>
    held.auction.status === 'LIVE' || held.auction.status === 'EXTENDED' ? 0
    : held.auction.status === 'PAUSED' ? 1
    : held.auction.status === 'SCHEDULED' || held.auction.status === 'LOBBY_OPEN' ? 2
    : 3;
  return Object.values(state.auctions)
    .filter((held) => held.bidders.some((b) => b.counterpartyId === counterpartyId))
    .sort((a, b) => rank(a) - rank(b) || (a.auction.startsAt ?? 0) - (b.auction.startsAt ?? 0));
}

/** The one to open on, when the supplier has not chosen. */
export function auctionForBidder(state: AppState, counterpartyId: Id): AuctionState | null {
  return auctionsForBidder(state, counterpartyId)[0] ?? null;
}
