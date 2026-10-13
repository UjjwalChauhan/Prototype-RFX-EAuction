/**
 * The API server.
 *
 * A thin shell: parse the request, hand it to `src/api/server.ts`, write back
 * what comes out. Every decision about what a route means lives in TypeScript
 * next to the domain it acts on, which is why this file has no route table of
 * its own and no rules to keep in step with the application.
 *
 * It loads that TypeScript through Vite rather than a build step, so the API
 * and the app are always running the same source — edit a handler, curl it
 * again, no rebuild.
 *
 *   npm run api          the API on :5176
 *   npm run dev:all      the API, the sync server and both applications
 *
 * Everything it holds is in memory. Restart it and it is back to the seed.
 */
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';

const PORT = Number(process.env.API_PORT ?? 5176);

const vite = await createVite({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
});

const { createApi } = await vite.ssrLoadModule('/src/api/server.ts');
const { handle } = createApi();

const send = (res, status, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // A prototype API is called from browsers, notebooks and curl alike.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 8_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (raw.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return send(res, 400, { error: String(error.message ?? error) });
  }

  try {
    const response = handle({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    return send(res, response.status, response.body);
  } catch (error) {
    // A handler that throws is a defect, not a client mistake. Say so plainly
    // rather than returning a 400 that blames the caller.
    console.error(error);
    return send(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(PORT, () => {
  console.log(`RFx API on http://localhost:${PORT}`);
  console.log('  GET  /api                     every route, with a one-line summary');
  console.log('  GET  /api/journeys            the patterns, and what each one creates');
  console.log('  POST /api/sourcing-events     one wizard payload → the whole family');
  console.log('  POST /api/rfis|rfps|rfqs|auctions   one ask, standalone or under a parent');
  console.log('  GET  /api/events?stage=RFI    what the RFI section lists');
  console.log('  POST /api/events/:id/issue    issue a planned ask');
});
