import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error — plain ESM, deliberately outside the typed source tree.
import { sync } from './vite-plugin-sync.mjs';

/**
 * The buyer's platform, and with it the sync seam the supplier portal reads
 * from at `/__sync`. Holding it here means the link between the two
 * applications is up whenever the buyer's platform is, with nothing else to
 * start and nothing to forget.
 */
export default defineConfig({
  plugins: [react(), sync()],
  server: {
    port: 5180,
    /**
     * Fail rather than drift.
     *
     * Without this Vite walks to the next free port when 5180 is taken — and
     * the portal proxies `/__sync` to 5180 by address, so the buyer's platform
     * quietly ends up on 5182 with the supplier portal talking to nothing. The
     * failure looks exactly like a working link from the portal's side: the
     * seeded events are all there and nothing new ever arrives. A refused
     * start is far easier to act on.
     */
    strictPort: true,
    open: true,
  },
});
