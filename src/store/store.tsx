/**
 * Application state.
 *
 * A reducer over the seed data, with the auction held in the shape the auction
 * service expects. Components never mutate an auction directly — they dispatch,
 * and the reducer routes through `submitBid` / `controllerAction` so the server
 * rules apply identically to the buyer cockpit and the supplier console.
 */
import React from 'react';
import type {
  Clarification, ConfigSetting, EventBidder, Id, Lot, NegotiationRound, Nfa,
  PurchaseRequest, PurchaseRequestLine, RateContract, Response, Score,
  SourcingEvent, SourcingRequisition, User,
} from '../domain/types';
import { DEFAULT_OPEN_DECISIONS, type OpenDecisionSettings } from '../domain/nfaLifecycle';
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
  bidders: EventBidder[];
  responses: Response[];
  scores: Score[];
  clarifications: Clarification[];
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

  /** Requisitions live in the store because sourcing mutates their lines. */
  purchaseRequests: PurchaseRequest[];
  purchaseRequestLines: PurchaseRequestLine[];
  /** Consolidated demands (PRD), each mapping an event back to many RQ lines. */
  sourcingRequisitions: SourcingRequisition[];

  auction: AuctionState;

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
      auctionLotId: Id; bidderId: Id; bidValue: number; userId: Id;
      source?: 'PORTAL' | 'PROXY' | 'ON_BEHALF' | 'API';
      onBehalfReason?: string; confirmed?: boolean;
    }
  | { type: 'CLEAR_BID_RESULT' }
  | { type: 'CONTROLLER_ACTION'; action: ControllerAction; reason: string; extendSec?: number; message?: string }
  | { type: 'UPDATE_AUCTION'; patch: Partial<AuctionState['auction']> }
  | { type: 'UPDATE_LOT'; lotId: Id; patch: Partial<Lot> }
  | { type: 'OPEN_LOT'; auctionLotId: Id }
  | { type: 'UPDATE_EVENT'; eventId: Id; patch: Partial<SourcingEvent> }
  | {
      type: 'CREATE_EVENT'; event: SourcingEvent; lots: Lot[];
      /** Requisition lines this event was raised for — marked as out in it. */
      sourcedLineIds?: Id[];
      /** The consolidated demand the event was raised against. */
      sourcingRequisitionId?: Id;
    }
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
  | { type: 'UPDATE_CONTRACT'; contractId: Id; patch: Partial<RateContract> };

export function initialState(): AppState {
  return {
    surface: 'ADMIN',
    currentUser: seed.CURRENT_USER,
    observerMode: false,
    agentKillSwitch: { engaged: false, by: null, at: null },
    connectionLost: false,

    events: seed.EVENTS,
    lots: seed.LOTS,
    bidders: seed.EVENT_BIDDERS,
    responses: seed.RESPONSES,
    scores: seed.SCORES,
    clarifications: seed.CLARIFICATIONS,
    negotiationRounds: seed.NEGOTIATION_ROUNDS,
    configSettings: seed.CONFIG_SETTINGS,
    nfas: [],
    nfaOptions: DEFAULT_OPEN_DECISIONS,
    rateContracts: RATE_CONTRACTS,

    purchaseRequests: PURCHASE_REQUESTS,
    purchaseRequestLines: PURCHASE_REQUEST_LINES,
    sourcingRequisitions: [],

    auction: {
      auction: seed.AUCTION,
      lots: seed.AUCTION_LOTS,
      lotDetails: Object.fromEntries(seed.LOTS.map((l) => [l.id, l])),
      bids: seed.SEED_BIDS,
      bidders: seed.EVENT_BIDDERS,
      costComponents: seed.COST_COMPONENTS,
      controlEvents: [],
      integrityFlags: [],
    },

    lastBidResult: null,
  };
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
      const result = submitBid({
        state: state.auction,
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
        auction: result.state,
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

    case 'CONTROLLER_ACTION': {
      const next = controllerAction(
        state.auction, action.action, state.currentUser.id, action.reason,
        { extendSec: action.extendSec, message: action.message },
      );
      let events = state.events;
      if (action.action === 'FORCE_CLOSE' || action.action === 'ABORT') {
        events = events.map((e) =>
          e.id === next.auction.eventId ? { ...e, status: 'AUCTION_CLOSED' as const } : e,
        );
      }
      return { ...state, auction: next, events };
    }

    case 'UPDATE_AUCTION':
      return {
        ...state,
        auction: { ...state.auction, auction: { ...state.auction.auction, ...action.patch } },
      };

    case 'UPDATE_LOT': {
      const lots = state.lots.map((l) => (l.id === action.lotId ? { ...l, ...action.patch } : l));
      return {
        ...state,
        lots,
        auction: {
          ...state.auction,
          lotDetails: Object.fromEntries(lots.map((l) => [l.id, l])),
        },
      };
    }

    case 'OPEN_LOT':
      return {
        ...state,
        auction: {
          ...state.auction,
          lots: state.auction.lots.map((l) =>
            l.id === action.auctionLotId ? { ...l, status: 'LOT_OPEN' as const } : l,
          ),
        },
      };

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

      return {
        ...state,
        events: [action.event, ...state.events],
        lots: [...state.lots, ...action.lots],
        purchaseRequestLines,
        sourcingRequisitions: state.sourcingRequisitions.map((r) =>
          r.id === action.sourcingRequisitionId ? { ...r, eventId: action.event.id } : r,
        ),
      };
    }

    case 'UPDATE_BIDDER': {
      const bidders = state.bidders.map((b) =>
        b.id === action.bidderId ? { ...b, ...action.patch } : b,
      );
      return { ...state, bidders, auction: { ...state.auction, bidders } };
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState);
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

export function lotsForEvent(state: AppState, eventId: Id): Lot[] {
  return state.lots.filter((l) => l.eventId === eventId);
}

export function biddersForEvent(state: AppState, eventId: Id): EventBidder[] {
  return state.bidders.filter((b) => b.eventId === eventId);
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
