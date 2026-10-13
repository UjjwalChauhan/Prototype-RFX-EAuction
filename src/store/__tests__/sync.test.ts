/**
 * The seam between the two applications.
 *
 * Publishing on the buyer's side and the supplier seeing it is tested as a
 * chain in `domain/__tests__/publishToPortal.test.ts`. This tests the wire
 * underneath it, against the three ways it was found to lose a published
 * event in practice:
 *
 *   1. a second tab of the buyer's platform pushing a store that predates the
 *      publish, erasing it from the portal a second after it arrived;
 *   2. two tabs of one side invalidating each other's record of what they
 *      last sent, and re-sending identical documents at each other for ever;
 *   3. a client applying a half the other application had never written,
 *      blanking its own data the moment it connected.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM, deliberately outside the typed source tree.
import { createSyncStore, hash } from '../../../sync-core.mjs';

// ---------------------------------------------------------------------------
// A request and response pair small enough to drive the handler directly.

interface Reply { status: number; body: any }

function call(
  store: { handle: (req: any, res: any, path: string) => Promise<boolean> },
  method: string, path: string, body?: unknown, client?: string,
): Promise<Reply & { handled: boolean }> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const listeners: Record<string, ((chunk?: unknown) => void)[]> = {};
  const req = {
    method,
    headers: client ? { 'x-sync-client': client } : {},
    on(event: string, fn: (chunk?: unknown) => void) {
      (listeners[event] ??= []).push(fn);
      return req;
    },
    destroy() {},
  };

  return new Promise((resolve) => {
    let status = 0;
    const res = {
      writeHead(code: number) { status = code; return res; },
      end(payload?: string) {
        resolve({ status, body: payload ? JSON.parse(payload) : null, handled: true });
      },
    };
    void store.handle(req, res, path).then((handled) => {
      if (!handled) resolve({ status: 0, body: null, handled: false });
    });
    // The handler subscribes to the body stream before we can feed it.
    queueMicrotask(() => {
      for (const fn of listeners.data ?? []) fn(new TextEncoder().encode(raw));
      for (const fn of listeners.end ?? []) fn();
    });
  });
}

const state = (store: any) => call(store, 'GET', '/state').then((r) => r.body);

/** The buyer's half, as the platform pushes it. */
const adminHalf = (events: { id: string }[]) => ({
  events, lots: [], lineItems: [], termsDocuments: [], bidders: [], questionnaires: [],
});

const SEED = [{ id: 'evt-1' }, { id: 'evt-2' }];
const PUBLISHED = { id: 'evt-new' };

describe('what each side may write', () => {
  it('lets the buyer write the buyer’s half', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    expect((await state(store)).events).toHaveLength(2);
  });

  it('does not let the supplier write events', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    await call(store, 'POST', '/vendor', { events: [], responses: [{ id: 'r-1' }] }, 'portal');
    const held = await state(store);
    expect(held.events).toHaveLength(2);
    expect(held.responses).toHaveLength(1);
  });

  it('leaves a half alone when the push does not mention it', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    await call(store, 'POST', '/admin', { bidders: [{ id: 'eb-1' }] }, 'tab-a');
    expect((await state(store)).events).toHaveLength(2);
  });
});

describe('a second tab of the same application', () => {
  it('cannot erase an event another tab has just published', async () => {
    const store = createSyncStore();
    // One tab publishes.
    await call(store, 'POST', '/admin', adminHalf([PUBLISHED, ...SEED]), 'tab-a');
    // Another, open since before the publish, pushes what it still holds.
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-b');

    const held = await state(store);
    expect(held.events.map((e: { id: string }) => e.id)).toContain('evt-new');
    expect(held.events).toHaveLength(3);
  });

  it('updates a record it does know about rather than duplicating it', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf([{ id: 'evt-1', title: 'before' } as any]), 'tab-a');
    await call(store, 'POST', '/admin', adminHalf([{ id: 'evt-1', title: 'after' } as any]), 'tab-a');
    const held = await state(store);
    expect(held.events).toHaveLength(1);
    expect(held.events[0].title).toBe('after');
  });

  it('does not invalidate the other tab’s record of what it sent', async () => {
    const store = createSyncStore();
    const a = adminHalf([PUBLISHED, ...SEED]);
    await call(store, 'POST', '/admin', a, 'tab-a');
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-b');

    // Tab A polls: what it sent is still recorded against tab A, so it has no
    // reason to send it again. Keyed by side rather than by tab, this was the
    // pair of tabs re-pushing at each other for as long as both were open.
    const held = await state(store);
    expect(held.hashes['tab-a']).toBe(hash(JSON.stringify(a)));
    expect(held.hashes['tab-b']).toBeDefined();
  });

  it('forgets the oldest tabs rather than growing without limit', async () => {
    const store = createSyncStore();
    for (let i = 0; i < 40; i += 1) {
      await call(store, 'POST', '/admin', adminHalf(SEED), `tab-${i}`);
    }
    expect(Object.keys((await state(store)).hashes).length).toBeLessThanOrEqual(24);
  });
});

describe('a push that never landed', () => {
  it('is detectable, because nothing is recorded against that tab', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    const held = await state(store);
    // The tab that never pushed finds no record and sends its half.
    expect(held.hashes['tab-never']).toBeUndefined();
  });

  it('is detectable after the seam restarts, because it holds nothing at all', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    await call(store, 'POST', '/reset');
    const held = await state(store);
    expect(held.hashes).toEqual({});
    expect(held.events).toEqual([]);
    expect(held.present).toEqual({ admin: false, vendor: false });
  });
});

describe('silence from the other application', () => {
  it('is reported as silence, not as an empty half', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    const held = await state(store);
    // The portal reads this and leaves its own data alone rather than
    // blanking itself because the supplier side has not spoken yet.
    expect(held.present).toEqual({ admin: true, vendor: false });
    expect(held.responses).toEqual([]);
  });

  it('turns into a written half the moment that side pushes', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/vendor', { responses: [] }, 'portal');
    // Deliberately empty: the supplier has answered nothing, and that is a
    // fact the buyer's platform should apply rather than ignore.
    expect((await state(store)).present.vendor).toBe(true);
  });
});

describe('the shape of the wire', () => {
  it('answers a preflight without a body', async () => {
    const store = createSyncStore();
    const reply = await call(store, 'OPTIONS', '/admin');
    expect(reply.status).toBe(204);
    expect(reply.body).toBeNull();
  });

  it('leaves paths that are not its own to whoever is behind it', async () => {
    const store = createSyncStore();
    expect((await call(store, 'GET', '/index.html')).handled).toBe(false);
  });

  it('refuses a body that is not JSON rather than falling over', async () => {
    const store = createSyncStore();
    const listeners: Record<string, ((chunk?: unknown) => void)[]> = {};
    const req = {
      method: 'POST', headers: {},
      on(event: string, fn: (chunk?: unknown) => void) {
        (listeners[event] ??= []).push(fn);
        return req;
      },
      destroy() {},
    };
    const reply = await new Promise<Reply>((resolve) => {
      let status = 0;
      const res = {
        writeHead(code: number) { status = code; return res; },
        end(payload?: string) { resolve({ status, body: payload ? JSON.parse(payload) : null }); },
      };
      void store.handle(req, res, '/admin');
      queueMicrotask(() => {
        for (const fn of listeners.data ?? []) fn(new TextEncoder().encode('not json'));
        for (const fn of listeners.end ?? []) fn();
      });
    });
    expect(reply.status).toBe(400);
  });

  it('bumps the version on every write, so a poll can skip work', async () => {
    const store = createSyncStore();
    expect((await state(store)).version).toBe(0);
    await call(store, 'POST', '/admin', adminHalf(SEED), 'tab-a');
    expect((await state(store)).version).toBe(1);
    await call(store, 'POST', '/vendor', { responses: [] }, 'portal');
    expect((await state(store)).version).toBe(2);
  });
});

/**
 * The practice run's one hard boundary.
 *
 * A supplier trying the controls before an auction opens must not thereby
 * disclose anything to the buyer. The counts cross so the controller can see
 * whether the field is ready; the figures do not cross at all — not hidden on
 * the buyer's screen, not present in the payload.
 */
describe('the practice run does not leak through the seam', () => {
  it('carries the counts the buyer needs', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/vendor', {
      responses: [], bids: [], participation: [],
      rehearsalActivity: [
        { id: 'eb-1', auctionId: 'auc-1', attempts: 4, accepted: 3, lastAt: 1_700_000_000_000 },
      ],
    }, 'portal');

    const seam = await state(store);
    expect(seam.rehearsalActivity).toHaveLength(1);
    expect(seam.rehearsalActivity[0].attempts).toBe(4);
    expect(seam.rehearsalActivity[0].accepted).toBe(3);
  });

  it('carries no price, because none is ever sent', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/vendor', {
      responses: [], bids: [], participation: [],
      rehearsalActivity: [
        { id: 'eb-1', auctionId: 'auc-1', attempts: 2, accepted: 2, lastAt: 1_700_000_000_000 },
      ],
    }, 'portal');

    const seam = await state(store);
    const row = seam.rehearsalActivity[0];
    // The shape itself is the boundary: there is no field a price could
    // travel in, so no future caller can start putting one there by mistake.
    expect(Object.keys(row).sort()).toEqual(
      ['accepted', 'attempts', 'auctionId', 'id', 'lastAt'],
    );
  });

  it('is written by the supplier, so a buyer push cannot fabricate it', async () => {
    const store = createSyncStore();
    await call(store, 'POST', '/admin', {
      events: [], lots: [], lineItems: [], termsDocuments: [], bidders: [],
      questionnaires: [], auctions: [],
      rehearsalActivity: [
        { id: 'eb-1', auctionId: 'auc-1', attempts: 99, accepted: 99, lastAt: 1 },
      ],
    }, 'platform');

    const seam = await state(store);
    // Ownership is split. The buyer's half does not include this key, so the
    // claim is discarded rather than merged.
    expect(seam.rehearsalActivity).toHaveLength(0);
  });
});
