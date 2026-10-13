/**
 * The API, exercised the way a caller meets it.
 *
 * Through `handle` rather than through the domain functions underneath, because
 * the things that go wrong at this layer are its own: a 404 that should have
 * been a 400, a refusal with no field named, a second RFP accepted onto an
 * event that already had one, a list that answers with the whole table.
 *
 * The HTTP server is a shell over this function, so what passes here is what
 * curl gets.
 */
import { describe, expect, it } from 'vitest';
import { Repository } from '../repository';
import { createRouter, ROUTES, type ApiRequest } from '../router';
import { localApi } from '../client';
import type { SourcingEventInput } from '../../domain/stageEvents';
import type { SourcingEvent } from '../../domain/types';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

function api(seed: SourcingEvent[] = []) {
  const repository = new Repository({ events: seed });
  const handle = createRouter({
    repository, now: () => NOW, idPrefix: () => 'evt-test',
  });
  return {
    repository,
    call: (request: ApiRequest) => handle(request),
    post: (path: string, body?: unknown) => handle({ method: 'POST', path, body }),
    get: (path: string, query: Record<string, string> = {}) =>
      handle({ method: 'GET', path, query }),
  };
}

function ladder(over: Partial<SourcingEventInput> = {}): SourcingEventInput {
  return {
    journeyPattern: 'JP-05',
    title: 'Facilities Management 2026',
    category: 'Facilities',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    lines: [
      { description: 'HVAC maintenance', quantity: 96, uom: 'visit', baselinePrice: 2_400, lotName: 'Lot 1 · Hard services' },
    ],
    bidders: [{ counterpartyId: 'cp-abc' }, { counterpartyId: 'cp-global' }],
    timeline: { closesInHours: 72 },
    ...over,
  };
}

describe('the routes it answers', () => {
  it('describes itself', () => {
    const { get } = api();
    const body = get('/api').body as { routes: typeof ROUTES };
    expect(body.routes.length).toBe(ROUTES.length);
    expect(body.routes.some((r) => r.path === '/api/sourcing-events')).toBe(true);
  });

  it('reports what a journey will create before anything is posted', () => {
    const { get } = api();
    const body = get('/api/journeys').body as { journeys: { id: string; creates: string[] }[] };
    expect(body.journeys.find((j) => j.id === 'JP-05')?.creates)
      .toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(body.journeys.find((j) => j.id === 'JP-08')?.creates).toEqual([]);
  });

  it('refuses a route it does not have, rather than guessing', () => {
    const { call } = api();
    expect(call({ method: 'GET', path: '/api/nonsense' }).status).toBe(404);
    expect(call({ method: 'DELETE', path: '/api/events' }).status).toBe(404);
  });
});

describe('POST /api/sourcing-events', () => {
  it('creates the umbrella and every ask the journey implies', () => {
    const { post } = api();
    const response = post('/api/sourcing-events', ladder());
    expect(response.status).toBe(201);
    const body = response.body as {
      event: SourcingEvent; stageEvents: SourcingEvent[];
      schedule: { stage: string; status: string; closesAt: number }[];
    };
    expect(body.event.eventNumber).toBe('SRC-2026-0001');
    expect(body.stageEvents.map((s) => s.currentStage)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(body.schedule.map((s) => s.status)).toEqual(['PUBLISHED', 'DRAFT', 'DRAFT', 'DRAFT']);
  });

  it('stores what it created, so the next request can see it', () => {
    const { post, get } = api();
    post('/api/sourcing-events', ladder());
    const board = get('/api/sourcing-events').body as { events: SourcingEvent[] };
    expect(board.events).toHaveLength(1);
    const rfis = get('/api/events', { stage: 'RFI' }).body as { events: SourcingEvent[] };
    expect(rfis.events.map((e) => e.eventNumber)).toEqual(['RFI-2026-0001']);
  });

  it('refuses invalid input with the fields that are wrong', () => {
    const { post } = api();
    const response = post('/api/sourcing-events', { journeyPattern: 'JP-05', lines: [] });
    expect(response.status).toBe(400);
    const body = response.body as { error: string; details: { field: string }[] };
    expect(body.details.map((d) => d.field)).toEqual(
      expect.arrayContaining(['title', 'category', 'businessUnit', 'ownerId', 'lines', 'bidders']),
    );
  });

  it('refuses a body that is not an object', () => {
    const { post } = api();
    expect(post('/api/sourcing-events', ['not', 'an', 'object']).status).toBe(400);
    expect(post('/api/sourcing-events').status).toBe(400);
  });

  it('numbers around what the store already holds', () => {
    const { post } = api([
      { eventNumber: 'RFI-2026-0007', parentEventId: null } as SourcingEvent,
    ]);
    const body = post('/api/sourcing-events', ladder()).body as { stageEvents: SourcingEvent[] };
    expect(body.stageEvents[0].eventNumber).toBe('RFI-2026-0008');
  });
});

describe('the per-stage routes', () => {
  it('creates a standalone ask with an umbrella of its own', () => {
    const { post } = api();
    const response = post('/api/rfqs', {
      title: 'Spot buy — safety boots',
      category: 'Indirect',
      businessUnit: 'Operations',
      ownerId: 'user-js',
      lines: [{ description: 'Safety boots', quantity: 300, uom: 'pair', baselinePrice: 48, lotName: 'Lot 1 · PPE' }],
      bidders: [{ counterpartyId: 'cp-abc' }],
    });
    expect(response.status).toBe(201);
    const body = response.body as { event: SourcingEvent; stageEvents: SourcingEvent[]; lots: unknown[] };
    expect(body.event.parentEventId).toBeNull();
    expect(body.event.journeyPattern).toBe('JP-02');
    expect(body.stageEvents.map((s) => s.currentStage)).toEqual(['RFQ']);
    expect(body.lots).toHaveLength(1);
  });

  it('adds an ask to an event that already exists, restating almost nothing', () => {
    const { post } = api();
    const parent = (post('/api/sourcing-events', ladder({ journeyPattern: 'JP-02' })).body as {
      event: SourcingEvent;
    }).event;

    const response = post('/api/auctions', {
      parentEventId: parent.id,
      auction: { mechanism: 'JAPANESE' },
      timeline: { closesInHours: 2 },
    });
    expect(response.status).toBe(201);
    const body = response.body as { event: SourcingEvent; bidders: { counterpartyId: string }[]; lots: unknown[] };
    expect(body.event.parentEventId).toBe(parent.id);
    expect(body.event.ownerId).toBe(parent.ownerId);
    expect(body.event.title).toBe(`${parent.title} — Auction`);
    // The shortlist comes off the asks already under the umbrella.
    expect(body.bidders.map((b) => b.counterpartyId)).toEqual(['cp-abc', 'cp-global']);
    // And the basket stays where it was.
    expect(body.lots).toEqual([]);
  });

  it('refuses a second ask of the same kind on one event', () => {
    const { post } = api();
    const parent = (post('/api/sourcing-events', ladder()).body as { event: SourcingEvent }).event;
    const response = post('/api/rfps', { parentEventId: parent.id });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('already has an RFP');
  });

  it('refuses to hang an ask off another ask', () => {
    const { post } = api();
    const family = post('/api/sourcing-events', ladder()).body as { stageEvents: SourcingEvent[] };
    const response = post('/api/rfps', { parentEventId: family.stageEvents[0].id });
    expect(response.status).toBe(400);
  });

  it('says so when the parent does not exist', () => {
    const { post } = api();
    expect(post('/api/rfis', { parentEventId: 'evt-nope' }).status).toBe(404);
  });

  it('lists only its own kind', () => {
    const { post, get } = api();
    post('/api/sourcing-events', ladder());
    const auctions = get('/api/auctions').body as { events: SourcingEvent[] };
    expect(auctions.events.map((e) => e.currentStage)).toEqual(['AUCTION']);
  });
});

describe('issuing a planned ask', () => {
  it('publishes it, once', () => {
    const { post, get } = api();
    const family = post('/api/sourcing-events', ladder()).body as { stageEvents: SourcingEvent[] };
    const planned = family.stageEvents[1];
    expect(planned.status).toBe('DRAFT');

    const issued = post(`/api/events/${planned.id}/issue`);
    expect(issued.status).toBe(200);
    expect((issued.body as { event: SourcingEvent }).event.status).toBe('PUBLISHED');

    const again = post(`/api/events/${planned.id}/issue`);
    expect(again.status).toBe(400);

    const stored = get(`/api/events/${planned.id}`).body as { event: SourcingEvent };
    expect(stored.event.status).toBe('PUBLISHED');
  });

  it('404s on an event that is not there', () => {
    const { post } = api();
    expect(post('/api/events/evt-nope/issue').status).toBe(404);
  });
});

describe('reading one event back', () => {
  it('answers an ask with the basket its parent holds', () => {
    const { post, get } = api();
    const family = post('/api/sourcing-events', ladder()).body as {
      event: SourcingEvent; stageEvents: SourcingEvent[];
    };
    const ask = family.stageEvents[0];
    const body = get(`/api/events/${ask.id}`).body as {
      event: SourcingEvent; parent: SourcingEvent | null; lots: unknown[]; lineItems: unknown[];
    };
    expect(body.parent?.id).toBe(family.event.id);
    expect(body.lots).toHaveLength(1);
    expect(body.lineItems).toHaveLength(1);
  });

  it('points a caller at the right route when they ask for an ask as an event', () => {
    const { post, get } = api();
    const family = post('/api/sourcing-events', ladder()).body as { stageEvents: SourcingEvent[] };
    const response = get(`/api/sourcing-events/${family.stageEvents[0].id}`);
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('/api/events/');
  });

  it('filters by stage, status and parent', () => {
    const { post, get } = api();
    const family = post('/api/sourcing-events', ladder()).body as { event: SourcingEvent };
    expect((get('/api/events', { parentId: family.event.id }).body as { events: SourcingEvent[] }).events)
      .toHaveLength(4);
    expect((get('/api/events', { status: 'draft' }).body as { events: SourcingEvent[] }).events)
      .toHaveLength(3);
    expect((get('/api/events', { stage: 'rfq' }).body as { events: SourcingEvent[] }).events)
      .toHaveLength(1);
  });
});

describe('the in-process client', () => {
  it('runs the same routes without a network', async () => {
    const client = localApi({}, { now: () => NOW });
    const family = await client.createSourcingEvent(ladder());
    expect(family.stageEvents).toHaveLength(4);
    const rfis = await client.listEvents({ stage: 'RFI' });
    expect(rfis.map((e) => e.eventNumber)).toEqual(['RFI-2026-0001']);
    const issued = await client.issue(family.stageEvents[1].id);
    expect(issued.status).toBe('PUBLISHED');
  });

  it('raises a refusal as an error carrying the field errors', async () => {
    const client = localApi();
    await expect(client.createSourcingEvent({ journeyPattern: 'JP-05' } as SourcingEventInput))
      .rejects.toMatchObject({ name: 'ApiError', status: 400 });
  });

  it('continues numbering from the events it was seeded with', async () => {
    const client = localApi({
      events: [{ eventNumber: 'SRC-2026-0003', parentEventId: null } as SourcingEvent],
    }, { now: () => NOW });
    const family = await client.createSourcingEvent(ladder());
    expect(family.event.eventNumber).toBe('SRC-2026-0004');
  });
});

describe('resetting', () => {
  it('goes back to what it was seeded with', () => {
    const { post, get } = api([{ eventNumber: 'SRC-2026-0001', parentEventId: null } as SourcingEvent]);
    post('/api/sourcing-events', ladder());
    expect((get('/api/events').body as { events: SourcingEvent[] }).events.length).toBe(6);
    post('/api/reset');
    expect((get('/api/events').body as { events: SourcingEvent[] }).events.length).toBe(1);
  });
});

describe('the timeline routes', () => {
  /** A ladder published with tight rules, so the refusals are easy to provoke. */
  function withRules(rules: Record<string, unknown>) {
    const { post, get } = api();
    const family = post('/api/sourcing-events', {
      ...ladder(),
      timeline: { closesInHours: 72, rules },
    }).body as { event: SourcingEvent; stageEvents: SourcingEvent[] };
    return { post, get, family };
  }

  const narrative = 'Two clarifications on the specification are still unanswered.';

  it('reports the schedule, the rules and what has been used', () => {
    const { get, family } = withRules({ maxExtensions: 1, clarificationCutoffHours: 12 });
    const rfi = family.stageEvents[0];
    const body = get(`/api/events/${rfi.id}/timeline`).body as {
      rules: { maxExtensions: number };
      schedule: { stage: string; closesAt: number; clarificationsCloseAt: number; extensionsUsed: number }[];
      extensions: unknown[];
    };
    expect(body.rules.maxExtensions).toBe(1);
    expect(body.schedule.map((s) => s.stage)).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(body.schedule[0].closesAt - body.schedule[0].clarificationsCloseAt).toBe(12 * 3_600_000);
    expect(body.extensions).toEqual([]);
  });

  it('moves the deadline and shifts the asks behind it', () => {
    const { post, get, family } = withRules({ maxExtensions: 2, cascade: 'SHIFT' });
    const rfi = family.stageEvents[0];
    const before = (get(`/api/events/${rfi.id}/timeline`).body as { schedule: { closesAt: number }[] }).schedule;

    const response = post(`/api/events/${rfi.id}/extend`, {
      addHours: 24, reason: 'CLARIFICATION_PENDING', narrative, requestedBy: 'user-ar',
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      extension: { sequence: number; addedHours: number };
      schedule: { closesAt: number }[];
    };
    expect(body.extension).toMatchObject({ sequence: 1, addedHours: 24 });
    for (let i = 0; i < before.length; i += 1) {
      expect(body.schedule[i].closesAt).toBe(before[i].closesAt + 24 * 3_600_000);
    }
  });

  it('keeps the extension, so the next read sees it', () => {
    const { post, get, family } = withRules({ maxExtensions: 2 });
    const rfi = family.stageEvents[0];
    post(`/api/events/${rfi.id}/extend`, {
      addHours: 24, reason: 'SUPPLIER_REQUEST', narrative, requestedBy: 'user-ar',
    });
    const body = get(`/api/events/${rfi.id}/timeline`).body as {
      schedule: { extensionsUsed: number }[]; extensions: { reason: string }[];
    };
    expect(body.schedule[0].extensionsUsed).toBe(1);
    expect(body.extensions.map((e) => e.reason)).toEqual(['SUPPLIER_REQUEST']);
  });

  it('refuses what the rules refuse, naming the field', () => {
    const { post, family } = withRules({ maxExtensions: 1, maxExtensionHoursEach: 24 });
    const rfi = family.stageEvents[0];
    const short = post(`/api/events/${rfi.id}/extend`, {
      addHours: 24, reason: 'OTHER', narrative: 'more time', requestedBy: 'user-ar',
    });
    expect(short.status).toBe(400);
    expect((short.body as { details: { field: string }[] }).details[0].field).toBe('narrative');

    post(`/api/events/${rfi.id}/extend`, {
      addHours: 24, reason: 'OTHER', narrative, requestedBy: 'user-ar',
    });
    const second = post(`/api/events/${rfi.id}/extend`, {
      addHours: 4, reason: 'OTHER', narrative, requestedBy: 'user-ar',
    });
    expect(second.status).toBe(400);
    expect((second.body as { details: { message: string }[] }).details[0].message)
      .toContain('All 1 extensions have been used');
  });

  it('will not extend an ask that has not been issued', () => {
    const { post, family } = withRules({ maxExtensions: 2 });
    const rfp = family.stageEvents[1];
    const response = post(`/api/events/${rfp.id}/extend`, {
      addHours: 12, reason: 'OTHER', narrative, requestedBy: 'user-ar',
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('has not been issued yet');
  });

  it('will not extend the umbrella, which has no deadline of its own', () => {
    const { post, family } = withRules({});
    const response = post(`/api/events/${family.event.id}/extend`, {
      addHours: 12, reason: 'OTHER', narrative, requestedBy: 'user-ar',
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('is not an ask');
  });

  it('insists on knowing who asked', () => {
    const { post, family } = withRules({ maxExtensions: 2 });
    const response = post(`/api/events/${family.stageEvents[0].id}/extend`, {
      addHours: 12, reason: 'OTHER', narrative,
    });
    expect(response.status).toBe(400);
    expect((response.body as { details: { field: string }[] }).details[0].field).toBe('requestedBy');
  });
});
