/**
 * The API, as a function.
 *
 * `handle(request)` in, `{ status, body }` out — no framework, no node types,
 * no browser types. That is what lets the same routes run in two places: the
 * HTTP server hands it a parsed request, and the browser calls it directly
 * when no server is running. There is one implementation of what these routes
 * mean, so the two transports cannot drift apart.
 *
 * The shape follows the wizard rather than the database. `POST
 * /api/sourcing-events` takes exactly what the nine steps collect and creates
 * the whole family — the umbrella plus the RFI, RFP, RFQ and auction the
 * chosen journey implies. The per-stage routes exist for the other half of the
 * job: adding one ask to an event that already exists, or raising a standalone
 * one without going through a journey.
 */
import { ALL_PATTERNS, JOURNEY_PATTERNS } from '../domain/journeyPatterns';
import {
  DEFAULT_PATTERN_FOR, InvalidEventInput, SOLICITATION_STAGES, createSourcingEvent,
  createStageEvent, isSolicitationStage, issueStageEvent, solicitationStagesOf, stageWindows,
  validateSourcingEventInput,
  type BidderInput, type CreatedEvents, type SolicitationStage, type SourcingEventInput,
  type StageEventInput,
} from '../domain/stageEvents';
import type { Repository } from './repository';
import { AUCTION_ROUTES, handleAuctionRoute } from './auctionRoutes';
import {
  applyExtension, describeWindow, extensionIssues, resolveTimelineRules,
  type ExtensionRequest, type TimelineRules,
} from '../domain/eventTimeline';
import type { SourcingEvent, Stage } from '../domain/types';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface RouteDoc {
  method: string;
  path: string;
  summary: string;
}

/** The stage each per-stage collection creates. */
export const STAGE_ROUTES: Record<string, SolicitationStage> = {
  rfis: 'RFI', rfps: 'RFP', rfqs: 'RFQ', auctions: 'AUCTION',
};

export const ROUTES: RouteDoc[] = [
  { method: 'GET', path: '/api', summary: 'This list.' },
  { method: 'GET', path: '/api/health', summary: 'Liveness, and how much the store holds.' },
  {
    method: 'GET', path: '/api/journeys',
    summary: 'The journey patterns, and the stage events each one creates.',
  },
  {
    method: 'POST', path: '/api/sourcing-events',
    summary: 'Create a sourcing event and every ask its journey implies.',
  },
  { method: 'GET', path: '/api/sourcing-events', summary: 'The umbrellas on the board.' },
  {
    method: 'GET', path: '/api/sourcing-events/:id',
    summary: 'One umbrella with its asks, basket, invitations and questionnaires.',
  },
  { method: 'GET', path: '/api/events', summary: 'Every event. Filter with ?stage= &status= &parentId=.' },
  { method: 'GET', path: '/api/events/:id', summary: 'One event with everything attached to it.' },
  { method: 'POST', path: '/api/events/:id/issue', summary: 'Issue a planned ask.' },
  {
    method: 'GET', path: '/api/events/:id/timeline',
    summary: 'The schedule, the rules it is governed by, and every extension granted.',
  },
  {
    method: 'POST', path: '/api/events/:id/extend',
    summary: 'Move a deadline. Refused when the rules the event was published under say no.',
  },
  { method: 'POST', path: '/api/rfis', summary: 'Create one RFI. Pass parentEventId to attach it.' },
  { method: 'GET', path: '/api/rfis', summary: 'Every RFI.' },
  { method: 'POST', path: '/api/rfps', summary: 'Create one RFP.' },
  { method: 'GET', path: '/api/rfps', summary: 'Every RFP.' },
  { method: 'POST', path: '/api/rfqs', summary: 'Create one RFQ.' },
  { method: 'GET', path: '/api/rfqs', summary: 'Every RFQ.' },
  { method: 'POST', path: '/api/auctions', summary: 'Create one auction ask.' },
  { method: 'GET', path: '/api/auctions', summary: 'Every auction ask.' },
  // The auctions themselves — the mechanism, the roster and the two ledgers —
  // rather than the asks they hang off. See `api/auctionRoutes`.
  ...AUCTION_ROUTES,
  { method: 'POST', path: '/api/reset', summary: 'Back to the seed. Demonstration convenience.' },
];

export interface RouterOptions {
  repository: Repository;
  /** Injected so a test can pin the clock and the ids that come from it. */
  now?: () => number;
  /** Overridden in tests to make created ids predictable. */
  idPrefix?: (now: number) => string;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
const badRequest = (message: string, details: unknown[] = []): ApiResponse =>
  ({ status: 400, body: { error: message, details } });
const notFound = (message: string): ApiResponse => ({ status: 404, body: { error: message } });

/** An event with everything that hangs off it — what a detail screen needs. */
function detail(repository: Repository, event: SourcingEvent) {
  const basket = repository.basketOf(event);
  return {
    event,
    stageEvents: repository.children(event.id),
    parent: event.parentEventId === null ? null : repository.event(event.parentEventId) ?? null,
    lots: basket.lots,
    lineItems: basket.lineItems,
    bidders: repository.biddersOf(event.id),
    questionnaires: repository.questionnairesOf(event.id),
  };
}

function listEvents(
  repository: Repository, query: Record<string, string | undefined>,
): SourcingEvent[] {
  const { stage, status, parentId, ownerId } = query;
  return repository.snapshot().events.filter((event) => {
    if (stage !== undefined && event.currentStage !== (stage.toUpperCase() as Stage)) return false;
    if (status !== undefined && event.status !== status.toUpperCase()) return false;
    if (parentId !== undefined && event.parentEventId !== parentId) return false;
    if (ownerId !== undefined && event.ownerId !== ownerId) return false;
    return true;
  });
}

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}


/**
 * The shortlist an added ask starts from.
 *
 * Everything else an ask inherits — its title, owner, category and basket —
 * the domain fills in from the umbrella. The shortlist cannot be filled in
 * there, because it is not on the umbrella: invitations belong to the asks,
 * so this reads them off the asks already under it.
 */
function inheritedShortlist(parent: SourcingEvent, repository: Repository): BidderInput[] {
  const inherited: BidderInput[] = [];
  for (const bidder of repository.children(parent.id).flatMap((c) => repository.biddersOf(c.id))) {
    if (inherited.some((b) => b.counterpartyId === bidder.counterpartyId)) continue;
    inherited.push({
      counterpartyId: bidder.counterpartyId,
      isProvisional: bidder.isProvisional,
      qualificationSnapshot: bidder.qualificationSnapshot,
      performanceRatingSnapshot: bidder.performanceRatingSnapshot,
    });
  }
  return inherited;
}


/**
 * The schedule of an event's family, read off the asks themselves.
 *
 * Only a close date is stored on each ask; an opening follows the one before
 * it. The same derivation the application uses, so the API and the screen
 * cannot report different dates.
 */
function timelineOf(repository: Repository, event: SourcingEvent) {
  const rootId = event.parentEventId ?? event.id;
  const root = repository.event(rootId) ?? event;
  const frozen = (root.configSnapshotAtPublish ?? {}) as { timelineRules?: Partial<TimelineRules> };
  const rules = resolveTimelineRules(frozen.timelineRules);

  const order = solicitationStagesOf(root.journeyPattern);
  const asks = repository.children(rootId)
    .filter((ask) => isSolicitationStage(ask.currentStage))
    .sort((a, b) => order.indexOf(a.currentStage as SolicitationStage)
      - order.indexOf(b.currentStage as SolicitationStage));

  const scheduled = asks.length > 0
    ? asks
    : isSolicitationStage(root.currentStage) && root.closesAt !== null ? [root] : [];

  let cursor = root.publishedAt ?? scheduled[0]?.publishedAt ?? null;
  const windows = scheduled.map((ask, index) => {
    const stage = ask.currentStage as SolicitationStage;
    const opensAt = index === 0
      ? ask.publishedAt ?? cursor ?? ask.closesAt ?? 0
      : (cursor ?? 0) + rules.gapHoursBetweenStages * 3_600_000;
    const closesAt = ask.closesAt ?? opensAt;
    cursor = closesAt;
    return { ask, window: describeWindow({ stage, opensAt, closesAt }, rules) };
  });

  return { root, rules, windows };
}

/**
 * Build the API over one repository.
 *
 * Returned as a closure rather than a class because there is nothing to hold
 * but the repository and the clock, and a function is easier to hand to a test.
 */
export function createRouter({
  repository,
  now = () => Date.now(),
  idPrefix = (at) => `evt-${at}`,
}: RouterOptions) {
  const createFamily = (input: SourcingEventInput): ApiResponse => {
    const errors = validateSourcingEventInput(input);
    if (errors.length > 0) return badRequest('The event could not be created.', errors);
    const at = now();
    const family = createSourcingEvent(input, {
      now: at, takenNumbers: repository.takenNumbers(), idPrefix: idPrefix(at),
    });
    repository.save(family);
    return created(withSchedule(family));
  };

  /** The schedule is derived, so it is returned rather than stored twice. */
  const withSchedule = (family: CreatedEvents) => ({
    ...family,
    schedule: family.stageEvents.map((stage) => ({
      stage: stage.currentStage,
      eventId: stage.id,
      eventNumber: stage.eventNumber,
      status: stage.status,
      opensAt: stage.publishedAt ?? stage.configSnapshotAtPublish?.opensAt ?? null,
      closesAt: stage.closesAt,
    })),
  });

  const createOneStage = (stage: SolicitationStage, body: unknown): ApiResponse => {
    const input = asObject(body);
    if (input === null) return badRequest('A JSON object body is required.');
    const stageInput = input as unknown as StageEventInput;

    const parentId = stageInput.parentEventId ?? null;
    const parent = parentId === null ? null : repository.event(parentId) ?? null;
    if (parentId !== null && parent === null) {
      return notFound(`No sourcing event with id "${parentId}".`);
    }
    if (parent && parent.parentEventId !== null) {
      return badRequest('An ask cannot hang off another ask — pass the sourcing event.');
    }
    if (parent && repository.children(parent.id).some((c) => c.currentStage === stage)) {
      return badRequest(`${parent.eventNumber} already has ${stage === 'AUCTION' ? 'an auction' : `an ${stage}`}.`);
    }

    // A standalone ask still runs some journey; without one named, it runs the
    // journey that stage belongs to on its own.
    const journeyPattern = stageInput.journeyPattern
      ?? parent?.journeyPattern
      ?? DEFAULT_PATTERN_FOR[stage];
    const resolvedInput: StageEventInput = parent === null
      ? { ...stageInput, journeyPattern }
      : {
        ...stageInput,
        journeyPattern,
        bidders: stageInput.bidders ?? inheritedShortlist(parent, repository),
      };

    const errors = validateSourcingEventInput(
      parent === null
        ? { ...resolvedInput, lines: resolvedInput.lines ?? [] }
        : {
          // The umbrella fills the rest in; validating without it would refuse
          // a request the domain accepts.
          ...resolvedInput,
          title: resolvedInput.title ?? parent.title,
          category: resolvedInput.category ?? parent.category,
          businessUnit: resolvedInput.businessUnit ?? parent.businessUnit,
          ownerId: resolvedInput.ownerId ?? parent.ownerId,
          side: resolvedInput.side ?? parent.side,
          lines: resolvedInput.lines ?? [],
        },
      // An ask joining an existing event is scheduled on its own, so only its
      // window is checked — not the journey's whole ladder.
      { requireLines: parent === null, stages: parent === null ? undefined : [stage] },
    );
    if (errors.length > 0) return badRequest('The event could not be created.', errors);

    const at = now();
    try {
      const family = createStageEvent(
        {
          stage,
          input: resolvedInput,
          parent,
          // An auction added to an event that already exists opens on that
          // event's basket, which only the repository can supply.
          basket: parent === null ? undefined : repository.basketOf(parent),
        },
        { now: at, takenNumbers: repository.takenNumbers(), idPrefix: parent ? undefined : idPrefix(at) },
      );
      repository.save(family);
      return created(withSchedule(family));
    } catch (error) {
      if (error instanceof InvalidEventInput) {
        return badRequest('The event could not be created.', error.errors);
      }
      throw error;
    }
  };


  /**
   * Move a deadline through the API.
   *
   * Gated by exactly the functions the extend dialog is gated by. An
   * integration that could extend past a limit the UI enforces would make the
   * limit decorative.
   */
  const extendAsk = (event: SourcingEvent, body: unknown): ApiResponse => {
    const input = asObject(body);
    if (input === null) return badRequest('A JSON object body is required.');
    if (!isSolicitationStage(event.currentStage)) {
      return badRequest(`${event.eventNumber} is not an ask, so it has no response deadline.`);
    }

    const { rules, windows } = timelineOf(repository, event);
    const index = windows.findIndex(({ ask }) => ask.id === event.id);
    if (index === -1) return badRequest(`${event.eventNumber} is not on its own event's schedule.`);
    const { window } = windows[index];

    const at = now();
    const requestedBy = String(input.requestedBy ?? '');
    const newCloseAt = typeof input.newCloseAt === 'number'
      ? input.newCloseAt
      : typeof input.addHours === 'number'
        ? Math.max(window.closesAt, at) + input.addHours * 3_600_000
        : NaN;
    if (!Number.isFinite(newCloseAt)) {
      return badRequest('Give either newCloseAt (epoch millis) or addHours.');
    }

    const extensionRequest: ExtensionRequest = {
      eventId: event.id,
      stage: window.stage,
      currentCloseAt: typeof input.currentCloseAt === 'number' ? input.currentCloseAt : window.closesAt,
      newCloseAt,
      reason: (input.reason as ExtensionRequest['reason']) ?? 'OTHER',
      narrative: String(input.narrative ?? ''),
      notifyChannels: (input.notifyChannels as ExtensionRequest['notifyChannels']) ?? rules.notifyChannels,
      notifyAudience: (input.notifyAudience as ExtensionRequest['notifyAudience']) ?? rules.notifyAudience,
      corrigendumReference: (input.corrigendumReference as string | null) ?? null,
      reopenClarifications: input.reopenClarifications !== false,
      requestedBy,
      approvedBy: (input.approvedBy as string | null) ?? null,
    };

    const context = {
      history: repository.extensionsOf(event.id),
      rules,
      now: at,
      window,
      nextOpensAt: windows[index + 1]?.window.opensAt ?? null,
      issued: event.status !== 'DRAFT',
    };

    if (requestedBy === '') {
      return badRequest('The event could not be extended.', [
        { field: 'requestedBy', message: 'Say who is asking for the extension.' },
      ]);
    }

    const issues = extensionIssues(extensionRequest, context).filter((issue) => issue.blocking);
    if (issues.length > 0) {
      return badRequest('The event could not be extended.', issues);
    }

    const result = applyExtension(
      extensionRequest, context, windows.map(({ window: each }) => each),
    );
    const closes = windows
      .map(({ ask }, i) => ({ eventId: ask.id, closesAt: result.schedule[i].closesAt }))
      .filter((close, i) => close.closesAt !== windows[i].window.closesAt);
    repository.recordExtension(result.extension, closes);

    return ok({
      extension: result.extension,
      schedule: windows.map(({ ask }, i) => ({
        stage: result.schedule[i].stage,
        eventId: ask.id,
        eventNumber: ask.eventNumber,
        opensAt: result.schedule[i].opensAt,
        closesAt: result.schedule[i].closesAt,
      })),
    });
  };

  return function handle(request: ApiRequest): ApiResponse {
    const method = request.method.toUpperCase();
    const query = request.query ?? {};
    const segments = request.path.split('/').filter(Boolean);

    if (segments[0] !== 'api') return notFound(`No route for ${method} ${request.path}.`);
    const [, collection, id, action] = segments;

    const auctionResponse = handleAuctionRoute(repository, request, segments);
    if (auctionResponse !== null) return auctionResponse;

    if (collection === undefined) {
      if (method === 'GET') return ok({ routes: ROUTES });
      return notFound(`No route for ${method} ${request.path}.`);
    }

    if (collection === 'health' && method === 'GET') {
      const state = repository.snapshot();
      return ok({
        status: 'ok',
        now: now(),
        counts: {
          events: state.events.length,
          lots: state.lots.length,
          lineItems: state.lineItems.length,
          bidders: state.bidders.length,
          questionnaires: state.questionnaires.length,
          auctions: state.auctions.length,
        },
      });
    }

    if (collection === 'journeys' && method === 'GET') {
      return ok({
        journeys: ALL_PATTERNS.map((pattern) => ({
          id: pattern.id,
          name: pattern.name,
          description: pattern.description,
          side: pattern.side,
          stages: pattern.stages,
          wizardSteps: pattern.wizardSteps,
          /** What a publish against this journey will create. */
          creates: solicitationStagesOf(pattern.id),
        })),
      });
    }

    if (collection === 'reset' && method === 'POST') {
      repository.reset();
      return ok({ status: 'reset' });
    }

    if (collection === 'sourcing-events') {
      if (method === 'POST' && id === undefined) {
        const input = asObject(request.body);
        if (input === null) return badRequest('A JSON object body is required.');
        return createFamily(input as unknown as SourcingEventInput);
      }
      if (method === 'GET' && id === undefined) {
        return ok({
          events: repository.snapshot().events.filter((event) => event.parentEventId === null),
        });
      }
      if (method === 'GET' && id !== undefined) {
        const event = repository.event(id);
        if (!event) return notFound(`No sourcing event with id "${id}".`);
        if (event.parentEventId !== null) {
          return badRequest(`${event.eventNumber} is an ask, not a sourcing event. Fetch it at /api/events/${id}.`);
        }
        return ok(detail(repository, event));
      }
    }

    if (collection === 'events') {
      if (method === 'GET' && id === undefined) return ok({ events: listEvents(repository, query) });
      if (id !== undefined) {
        const event = repository.event(id);
        if (!event) return notFound(`No event with id "${id}".`);
        if (method === 'GET' && action === undefined) return ok(detail(repository, event));
        if (method === 'GET' && action === 'timeline') {
          const { root, rules, windows } = timelineOf(repository, event);
          return ok({
            eventId: root.id,
            eventNumber: root.eventNumber,
            rules,
            schedule: windows.map(({ ask, window }) => ({
              stage: window.stage,
              eventId: ask.id,
              eventNumber: ask.eventNumber,
              status: ask.status,
              opensAt: window.opensAt,
              closesAt: window.closesAt,
              durationHours: window.durationHours,
              clarificationsCloseAt: window.clarificationsCloseAt,
              extensionsUsed: repository.extensionsOf(ask.id).length,
            })),
            extensions: windows.flatMap(({ ask }) => repository.extensionsOf(ask.id)),
          });
        }

        if (method === 'POST' && action === 'extend') {
          return extendAsk(event, request.body);
        }

        if (method === 'POST' && action === 'issue') {
          if (event.status !== 'DRAFT') {
            return badRequest(`${event.eventNumber} has already been issued.`);
          }
          const issued = issueStageEvent(event, now());
          repository.replaceEvent(issued);
          return ok({ event: issued });
        }
      }
    }

    const stage = collection === undefined ? undefined : STAGE_ROUTES[collection];
    if (stage !== undefined) {
      if (method === 'POST' && id === undefined) return createOneStage(stage, request.body);
      if (method === 'GET' && id === undefined) {
        return ok({ events: listEvents(repository, { ...query, stage }) });
      }
    }

    return notFound(`No route for ${method} ${request.path}.`);
  };
}

export type Handler = ReturnType<typeof createRouter>;

/** Everything the API needs to describe itself, for a docs page or a README. */
export const API_SUMMARY = {
  routes: ROUTES,
  stages: SOLICITATION_STAGES,
  journeys: Object.keys(JOURNEY_PATTERNS),
  /** Exported so a caller can show the schedule before it posts anything. */
  previewSchedule: stageWindows,
};
