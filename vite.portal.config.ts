import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The supplier portal runs as its own origin on its own port. Separate origins
 * are the point: the two applications share nothing but the sync seam.
 *
 * That seam is proxied rather than called across origins. The portal asks its
 * own server for `/__sync/...`, which passes the call to the buyer's platform
 * where the shared document lives — so the portal needs no address for the
 * buyer, and the call is same-origin on both sides.
 *
 * Both ports are pinned. Letting either drift to the next free one breaks the
 * link in the least visible way there is — see `strictPort` below.
 */

/** Where the buyer's platform lives. `vite.config.ts` pins it to 5180. */
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5180';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // Same reason as the buyer's platform: a portal that drifted to another
    // port is a portal the buyer's proxy cannot be pointed at either.
    strictPort: true,
    open: '/portal.html',
    proxy: {
      '/__sync': {
        // The buyer's platform, on the port `vite.config.ts` gives it.
        target: ADMIN_URL,
        /**
         * A refused connection means the buyer's platform is not running.
         *
         * The portal says so in its own words on the page, so this must not be
         * an unhandled error — but it must not be silent either. Swallowing it
         * entirely left the one person who could fix it, looking at the one
         * terminal that knew, reading nothing at all. Said once, then quiet.
         */
        configure: (proxy) => {
          let told = false;
          proxy.on('error', () => {
            if (told) return;
            told = true;
            console.warn(
              `\n  sync  no buyer platform at ${ADMIN_URL} — the portal will show its own seeded`
              + '\n        data and nothing the buyer publishes. Start it with `npm run dev`.\n',
            );
          });
          // Reset once it answers again, so a later outage is reported too.
          proxy.on('proxyRes', () => { told = false; });
        },
      },
    },
  },
  build: { rollupOptions: { input: 'portal.html' }, outDir: 'dist-portal' },
});
