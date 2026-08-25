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
  Clarification, ConfigSetting, EventBidder, Id, Lot, NegotiationRound, Nfa, Response,
  Score, SourcingEvent, User,
} from '../domain/types';
import {
  type AuctionState, controllerAction, submitBid, type ControllerAction,
} from '../server/auctionService';
import * as seed from '../data/seed';

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
  | { type: 'CREATE_EVENT'; event: SourcingEvent; lots: Lot[] }
  | { type: 'UPDATE_BIDDER'; bidderId: Id; patch: Partial<EventBidder> }
  | { type: 'ADD_SCORE'; score: Score }
  | { type: 'ANSWER_CLARIFICATION'; id: Id; answer: string; visibility: Clarification['visibility']; userId: Id }
  | { type: 'ADD_CLARIFICATION'; clarification: Clarification }
  | { type: 'ADD_NEGOTIATION_ROUND'; round: NegotiationRound }
  | { type: 'SET_CONFIG'; setting: ConfigSetting }
  | { type: 'ADD_NFA'; nfa: Nfa }
  | { type: 'UPDATE_NFA'; nfaId: Id; patch: Partial<Nfa> };

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

    case 'CREATE_EVENT':
      return {
        ...state,
        events: [action.event, ...state.events],
        lots: [...state.lots, ...action.lots],
      };

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
