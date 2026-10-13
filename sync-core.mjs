/**
 * The seam between the two applications.
 *
 * The admin platform and the supplier portal run as separate origins, which is
 * the point — they are separate products with separate users, and nothing in
 * one should be reachable from the other by navigating. Separate origins also
 * mean they share no browser storage, so "an event published in admin appears
 * in the portal" needs somewhere outside both to hold it.
 *
 * This is that somewhere: the smallest possible stand-in for the server the
 * real product would have. It holds one document in memory and enforces one
 * rule — each side may only write what it owns. The buyer publishes events,
 * lots, lines, terms, invitations and questionnaires; the supplier writes
 * responses back. Neither can overwrite the other's half, so there is no
 * conflict to resolve and no last-write-wins surprise.
 *
 * Within a side, a push merges by id rather than replacing the collection. Two
 * tabs of the buyer's platform are two independent stores, and replacing meant
 * the older one erased what the newer one had just published every time it
 * pushed — the event appeared in the portal and vanished a second later. A
 * record is only ever added or updated here, never removed by someone who
 * simply had not heard of it.
 *
 * The handler lives here rather than in a server so it can be mounted in two
 * places with one implementation: on the Vite dev server that already serves
 * the buyer's platform, which is what makes the link work with no extra
 * process to start, and in `sync-server.mjs` for anyone who wants it on a port
 * of its own.
 *
 * It is deliberately not a database. Stop it and the demo starts fresh, which
 * is the right behaviour for a prototype.
 */

/**
 * The slice each side owns, and may therefore write.
 *
 * `auctions` is the buyer's: the mechanism, the lots and the control log are
 * decided on the platform and the portal only reads them. `bids` is the
 * supplier's, flat across every auction, and is merged into each ledger rather
 * than replacing it — a bid placed on the portal has to reach the cockpit, and
 * a bid the buyer placed on behalf must not be erased on the way.
 *
 * `participation` is the awkward one, and it is here because the alternative
 * was worse. The invitation rows belong to the buyer, who created them — but
 * whether a supplier has opened an ask or submitted against it is a fact only
 * the portal knows, and without a way back the buyer's Bidders tab reported
 * "not started" for a supplier whose answers were on the buyer's own screen.
 * So the status travels on its own, and the buyer applies it only where it
 * moves a supplier forward.
 */
const ADMIN_KEYS = [
  'events', 'lots', 'lineItems', 'termsDocuments', 'bidders', 'questionnaires', 'auctions',
];
const VENDOR_KEYS = ['responses', 'bids', 'participation', 'rehearsalActivity'];

const emptyFor = (keys) => Object.fromEntries(keys.map((key) => [key, []]));

/**
 * Fold an incoming collection into the one held, keyed by id.
 *
 * The pusher's order wins for what it knows about, so the collection reads the
 * way the application that sent it means it to; anything only the held copy
 * knows about keeps its place behind that.
 */
const mergeById = (held, incoming) => {
  if (!Array.isArray(incoming)) return held;
  const sent = new Set(incoming.map((row) => row?.id));
  return [...incoming, ...held.filter((row) => !sent.has(row?.id))];
};

/**
 * A cheap content hash, so each side can check that what the server holds is
 * really what it sent. Divergence otherwise goes unnoticed: a push that failed
 * leaves the two applications disagreeing with nothing to detect it.
 */
export const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    /**
     * Collected as buffers and decoded once.
     *
     * Appending each chunk to a string decodes it in isolation, so a character
     * whose UTF-8 bytes straddle a chunk boundary — every '·' and '—' in this
     * data — is replaced by U+FFFD and the JSON no longer parses. The payload
     * has to be large enough to be split before it happens, which is exactly
     * when a real event has been added, so it presents as "publishing stopped
     * syncing" rather than as an encoding fault.
     */
    const chunks = [];
    let length = 0;
    req.on('data', (chunk) => {
      length += chunk.length;
      // A prototype does not need to defend hard, but it should not fall over.
      if (length > 32_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({ body: raw.length === 0 ? {} : JSON.parse(raw), raw });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

/**
 * One shared document and the four routes over it.
 *
 * `handle` answers true when it dealt with the request, so a caller can mount
 * it in front of anything else and fall through when the path is not ours.
 */
export function createSyncStore({ log = () => {} } = {}) {
  /** Written by the buyer, read by the supplier. */
  let fromAdmin = emptyFor(ADMIN_KEYS);
  /** Written by the supplier, read by the buyer. */
  let fromVendor = emptyFor(VENDOR_KEYS);
  /** Bumped on every write so a client can skip work when nothing has changed. */
  let version = 0;
  /**
   * The exact bytes each client last sent, hashed, so it can verify they
   * landed.
   *
   * Keyed by client rather than by side. Keyed by side, a second tab's push
   * made the first tab's recorded hash wrong, the first tab read that as a
   * failed push and sent again, and the two re-sent identical documents at
   * each other for as long as both were open.
   */
  let hashes = {};
  /**
   * Whether each side has ever written.
   *
   * Without this a client cannot tell "the other application has nothing" from
   * "the other application is not running yet", and applies an empty half over
   * its own seed — the portal blanks itself the moment it connects, before the
   * buyer's platform has said anything.
   */
  let present = { admin: false, vendor: false };

  const json = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      // Both dev origins, and any other the developer happens to use.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-sync-client',
      'cache-control': 'no-store',
    });
    res.end(status === 204 ? undefined : payload);
  };

  const write = (side, keys, held, body, raw, client) => {
    const next = Object.fromEntries(
      keys.map((key) => [key, key in body ? mergeById(held[key], body[key]) : held[key]]),
    );
    // One entry per client, oldest dropped, so a long demo cannot grow it.
    const kept = Object.entries({ ...hashes, [client]: hash(raw) }).slice(-24);
    hashes = Object.fromEntries(kept);
    present = { ...present, [side]: true };
    version += 1;
    return next;
  };

  /** Which tab is speaking. Anonymous clients share one slot, as they must. */
  const clientOf = (req, side) => {
    const header = req.headers['x-sync-client'];
    const id = Array.isArray(header) ? header[0] : header;
    return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : side;
  };

  /** Handle one request. Returns false when the path belongs to someone else. */
  async function handle(req, res, pathname) {
    if (pathname === '/state') {
      if (req.method === 'OPTIONS') { json(res, 204, {}); return true; }
      if (req.method !== 'GET') return false;
      json(res, 200, { version, hashes, present, ...fromAdmin, ...fromVendor });
      return true;
    }

    if (pathname !== '/admin' && pathname !== '/vendor' && pathname !== '/reset') return false;
    if (req.method === 'OPTIONS') { json(res, 204, {}); return true; }
    if (req.method !== 'POST') return false;

    try {
      if (pathname === '/admin') {
        const { body, raw } = await readBody(req);
        fromAdmin = write('admin', ADMIN_KEYS, fromAdmin, body, raw, clientOf(req, 'admin'));
        log(
          `admin push  v${version}  ${fromAdmin.events.length} events, `
          + `${fromAdmin.bidders.length} invitations, ${fromAdmin.questionnaires.length} questionnaires`,
        );
        json(res, 200, { version });
        return true;
      }

      if (pathname === '/vendor') {
        const { body, raw } = await readBody(req);
        fromVendor = write('vendor', VENDOR_KEYS, fromVendor, body, raw, clientOf(req, 'vendor'));
        log(`vendor push v${version}  ${fromVendor.responses.length} responses`);
        json(res, 200, { version });
        return true;
      }

      fromAdmin = emptyFor(ADMIN_KEYS);
      fromVendor = emptyFor(VENDOR_KEYS);
      hashes = {};
      present = { admin: false, vendor: false };
      version += 1;
      json(res, 200, { version });
      return true;
    } catch (error) {
      json(res, 400, { error: String(error?.message ?? error) });
      return true;
    }
  }

  return { handle };
}
