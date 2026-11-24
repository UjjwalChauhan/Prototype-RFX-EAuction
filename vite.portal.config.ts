import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// @ts-expect-error — plain ESM, deliberately outside the typed source tree.
import { sync } from './vite-plugin-sync.mjs';

/**
 * The supplier portal runs as its own origin on its own port. Separate origins
 * are the point: the two applications share nothing but the sync seam.
 *
 * That seam is mounted here as well as on the buyer's platform, over the same
 * file (see `vite-plugin-sync.mjs`). The portal used to proxy `/__sync` to the
 * buyer's dev server at port 5180, which meant a buyer on any other port — or
 * not started yet — left suppliers looking at their seed with nothing the
 * buyer had published. Reading the shared file directly removes that link.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), sync()],
  server: {
    port: 5181,
    // A portal that drifted to another port is one nobody can find.
    strictPort: true,
    open: '/portal.html',
  },
  build: { rollupOptions: { input: 'portal.html' }, outDir: 'dist-portal' },
});
