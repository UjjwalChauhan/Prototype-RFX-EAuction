/**
 * The sync seam, mounted on the dev server that is already running.
 *
 * The two applications need somewhere outside both of them to hold what they
 * share. Making that a process of its own was honest about the architecture
 * and dishonest about the failure: forget to start it and the supplier portal
 * shows its own seed, which looks exactly like a working portal until you
 * publish something and nothing arrives.
 *
 * So it is mounted here instead, under `/__sync`, on the buyer's dev server.
 * The portal proxies the same path to it, which makes the call same-origin on
 * both sides — no port to remember, no process to start, and no CORS.
 *
 * `sync-server.mjs` still runs the identical handler on a port of its own for
 * anyone who wants the seam visible as a server; point the clients at it with
 * VITE_SYNC_URL.
 */
import { createSyncStore } from './sync-core.mjs';

const BASE = '/__sync';

export function sync({ quiet = false } = {}) {
  return {
    name: 'rfx-sync',
    configureServer(server) {
      const store = createSyncStore({
        log: quiet ? undefined : (line) => server.config.logger.info(`  sync  ${line}`),
      });
      // Registered before Vite's own middleware so the SPA fallback never sees
      // these paths and answers them with index.html.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(BASE)) return next();
        const pathname = url.pathname.slice(BASE.length) || '/state';
        store.handle(req, res, pathname).then((handled) => {
          if (!handled) next();
        }, next);
      });
      server.config.logger.info(`  ➜  Sync:    http://localhost:${server.config.server.port}${BASE}/state`);
    },
  };
}

export default sync;
