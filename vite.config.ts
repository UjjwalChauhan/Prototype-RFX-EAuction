import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error — plain ESM, deliberately outside the typed source tree.
import { sync } from './vite-plugin-sync.mjs';

/**
 * The buyer's platform, and with it the sync seam the supplier portal reads
 * from at `/__sync`. Holding it here means the link between the two
 * applications is up whenever the buyer's platform is, with nothing else to
 * start and nothing to forget.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), sync()],
  server: {
    port: 5180,
    /**
     * Fail rather than drift. The supplier portal no longer depends on this
     * port — both dev servers share the seam through one file — but a buyer's
     * platform that wandered to 5182 is still one nobody can find.
     */
    strictPort: true,
    open: true,
  },
});
