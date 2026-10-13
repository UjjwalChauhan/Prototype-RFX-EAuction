/**
 * The sync seam as a server of its own.
 *
 * The same handler the buyer's dev server mounts at `/__sync` (see
 * `vite-plugin-sync.mjs`), on a port instead. Nothing needs this in the normal
 * demo — the link works with `npm run dev` and `npm run dev:portal` alone —
 * but it is here for when you want the seam to be a thing you can see, curl
 * and restart independently:
 *
 *   npm run sync
 *   VITE_SYNC_URL=http://localhost:5175 npm run dev
 *   VITE_SYNC_URL=http://localhost:5175 npm run dev:portal
 *
 * It is deliberately not a database. Stop it and the demo starts fresh.
 */
import { createServer } from 'node:http';
import { createSyncStore } from './sync-core.mjs';

const PORT = Number(process.env.SYNC_PORT ?? 5175);

const store = createSyncStore({ log: (line) => console.log(line) });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handled = await store.handle(req, res, url.pathname);
  if (handled) return;
  res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`sync server on http://localhost:${PORT}`);
  console.log('  GET  /state   everything both sides can see');
  console.log('  POST /admin   buyer publishes events, lots, lines, terms, invitations, questionnaires');
  console.log('  POST /vendor  supplier writes responses back');
});
