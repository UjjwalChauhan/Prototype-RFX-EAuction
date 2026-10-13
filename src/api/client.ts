/**
 * Calling the API — over HTTP, or without leaving the tab.
 *
 * Both transports satisfy the same interface and run the same routes, so the
 * application does not know or care which one it has. The default is the
 * in-process one: the prototype must work when nothing else is running, and a
 * wizard that fails to publish because a side process is down would be a worse
 * demonstration than one that never had an API at all.
 *
 * Point `VITE_API_URL` at the API server and the same publish goes over the
 * wire instead, which is how the endpoints get exercised by the product rather
 * than only by curl.
 */
import { Repository, type ApiState } from './repository';
import { createRouter, type ApiRequest, type ApiResponse } from './router';
import type { AuctionListRow } from './auctionRoutes';
import type {
  CreatedEvents, SolicitationStage, SourcingEventInput, StageEventInput,
} from '../domain/stageEvents';
import type { Bid, SourcingEvent, Stage } from '../domain/types';

/** The path each stage's collection lives at. */
export const STAGE_PATH: Record<SolicitationStage, string> = {
  RFI: 'rfis', RFP: 'rfps', RFQ: 'rfqs', AUCTION: 'auctions',
};

export interface EventQuery {
  stage?: Stage;
  status?: string;
  parentId?: string;
  ownerId?: string;
}

/** Narrowing `GET /api/auction-events`. Every field is optional. */
export interface AuctionQuery {
  status?: string;
  mechanism?: string;
  side?: string;
  /** Only the auctions this supplier is invited to. */
  counterpartyId?: string;
}

/** A bid, as a client submits one. Name the bidder either way round. */
export interface PlaceBidBody {
  bidderId?: string;
  counterpartyId?: string;
  /** Defaults to whichever lot is open. */
  auctionLotId?: string;
  bidValue: number;
  userId?: string;
  /** A large improvement is refused once and accepted on the second ask. */
  confirmed?: boolean;
}

/**
 * What came of it.
 *
 * A refusal is a result, not an error: the rules said no, and the reason is
 * the part the bidder needs. Only a malformed request throws.
 */
export interface BidOutcome {
  accepted: boolean;
  bid?: Bid | null;
  standing?: number | null;
  rejectionCode?: string | null;
  message?: string | null;
  requiresConfirmation?: boolean;
}

export interface ControlBody {
  action: string;
  actorId: string;
  /** Written to the audit log before the action takes effect. Required. */
  reason: string;
  extendSec?: number;
  message?: string;
}

export interface SourcingApi {
  createSourcingEvent(input: SourcingEventInput): Promise<CreatedEvents>;
  createStageEvent(stage: SolicitationStage, input: StageEventInput): Promise<CreatedEvents>;
  issue(eventId: string): Promise<SourcingEvent>;
  listEvents(query?: EventQuery): Promise<SourcingEvent[]>;
  /** Every auction that has been created, whatever journey created it. */
  listAuctions(query?: AuctionQuery): Promise<AuctionListRow[]>;
  /** One auction, whole. Takes the ask's id or the auction's own. */
  auction(id: string): Promise<unknown>;
  /** What one bidder is permitted to see. Built by whitelist, server-side. */
  bidderView(id: string, who: { bidderId?: string; counterpartyId?: string }): Promise<unknown>;
  placeBid(id: string, body: PlaceBidBody): Promise<BidOutcome>;
  control(id: string, body: ControlBody): Promise<unknown>;
}

/** A refusal from the API, carrying the field errors that caused it. */
export class ApiError extends Error {
  readonly status: number;

  readonly details: unknown[];

  constructor(status: number, message: string, details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function unwrap(response: ApiResponse): unknown {
  if (response.status >= 400) {
    const body = response.body as { error?: string; details?: unknown[] };
    throw new ApiError(response.status, body?.error ?? 'The request was refused.', body?.details ?? []);
  }
  return response.body;
}

/** Drop what was not asked for, so an absent filter is absent from the URL. */
const toQuery = (
  query: EventQuery | AuctionQuery | { bidderId?: string; counterpartyId?: string } = {},
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  ) as Record<string, string>;

// ---------------------------------------------------------------------------
// In-process
// ---------------------------------------------------------------------------

/**
 * The API without a network.
 *
 * `seed` is a snapshot of whatever the caller already holds — in the browser,
 * the store — so numbering continues from the events on screen rather than
 * restarting at one.
 */
export function localApi(
  seed: Partial<ApiState> = {},
  options: { now?: () => number; idPrefix?: (now: number) => string } = {},
): SourcingApi {
  const handle = createRouter({ repository: new Repository(seed), ...options });
  const call = (request: ApiRequest) => unwrap(handle(request));

  return {
    async createSourcingEvent(input) {
      return call({ method: 'POST', path: '/api/sourcing-events', body: input }) as CreatedEvents;
    },
    async createStageEvent(stage, input) {
      return call({ method: 'POST', path: `/api/${STAGE_PATH[stage]}`, body: input }) as CreatedEvents;
    },
    async issue(eventId) {
      const body = call({ method: 'POST', path: `/api/events/${eventId}/issue` }) as { event: SourcingEvent };
      return body.event;
    },
    async listEvents(query) {
      const body = call({ method: 'GET', path: '/api/events', query: toQuery(query) }) as { events: SourcingEvent[] };
      return body.events;
    },
    async listAuctions(query) {
      const body = call({
        method: 'GET', path: '/api/auction-events', query: toQuery(query),
      }) as { auctions: AuctionListRow[] };
      return body.auctions;
    },
    async auction(id) {
      return call({ method: 'GET', path: `/api/auction-events/${id}` });
    },
    async bidderView(id, who) {
      return call({
        method: 'GET', path: `/api/auction-events/${id}/bidder-view`, query: toQuery(who),
      });
    },
    async placeBid(id, body) {
      return call({ method: 'POST', path: `/api/auction-events/${id}/bids`, body }) as BidOutcome;
    },
    async control(id, body) {
      return call({ method: 'POST', path: `/api/auction-events/${id}/control`, body });
    },
  };
}

// ---------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------

export const DEFAULT_API_URL = 'http://localhost:5176';

/** The API server's address, when the app has been pointed at one. */
export function configuredApiUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const url = env?.VITE_API_URL;
  return url === undefined || url.trim() === '' ? null : url.replace(/\/$/, '');
}

export function httpApi(baseUrl: string = DEFAULT_API_URL): SourcingApi {
  const root = baseUrl.replace(/\/$/, '');

  const call = async (
    method: string, path: string, body?: unknown, query: Record<string, string> = {},
  ): Promise<unknown> => {
    const search = new URLSearchParams(query).toString();
    const response = await fetch(`${root}${path}${search ? `?${search}` : ''}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = payload as { error?: string; details?: unknown[] };
      throw new ApiError(
        response.status, failure.error ?? `${method} ${path} failed.`, failure.details ?? [],
      );
    }
    return payload;
  };

  return {
    async createSourcingEvent(input) {
      return await call('POST', '/api/sourcing-events', input) as CreatedEvents;
    },
    async createStageEvent(stage, input) {
      return await call('POST', `/api/${STAGE_PATH[stage]}`, input) as CreatedEvents;
    },
    async issue(eventId) {
      const body = await call('POST', `/api/events/${eventId}/issue`) as { event: SourcingEvent };
      return body.event;
    },
    async listEvents(query) {
      const body = await call('GET', '/api/events', undefined, toQuery(query)) as { events: SourcingEvent[] };
      return body.events;
    },
    async listAuctions(query) {
      const body = await call(
        'GET', '/api/auction-events', undefined, toQuery(query),
      ) as { auctions: AuctionListRow[] };
      return body.auctions;
    },
    async auction(id) {
      return await call('GET', `/api/auction-events/${id}`);
    },
    async bidderView(id, who) {
      return await call('GET', `/api/auction-events/${id}/bidder-view`, undefined, toQuery(who));
    },
    async placeBid(id, body) {
      return await call('POST', `/api/auction-events/${id}/bids`, body) as BidOutcome;
    },
    async control(id, body) {
      return await call('POST', `/api/auction-events/${id}/control`, body);
    },
  };
}

/**
 * The API the application should use.
 *
 * HTTP when it has been pointed at a server, in-process otherwise. The seed is
 * only meaningful for the in-process transport — a server keeps its own.
 */
export function sourcingApi(seed: Partial<ApiState> = {}): SourcingApi {
  const url = configuredApiUrl();
  return url === null ? localApi(seed) : httpApi(url);
}
