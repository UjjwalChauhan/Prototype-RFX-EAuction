/**
 * The supplier portal as its own application.
 *
 * Served on its own port so it is genuinely a separate product rather than a
 * tab inside the buyer's platform: different origin, different session, no
 * route back. It stays in step with the buyer's platform through the sync
 * server, not through shared browser state — which is the same shape the real
 * thing would have.
 */
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store/store';
import { useSync } from './store/sync';
import { PortalShell } from './portal/PortalShell';
import './design-system/global.css';

function VendorApp() {
  const status = useSync('vendor');
  return (
    <>
      {status !== 'live' && (
        <div
          role="status"
          style={{
            background: status === 'offline' ? '#7F1D1D' : '#1F2937',
            color: '#fff', padding: '8px 20px', fontSize: 13,
          }}
        >
          {status === 'offline' ? (
            <>
              <strong>This portal has lost its dev server.</strong>{' '}
              What is on screen may be out of date, and nothing the buyer has published since is
              reaching you. Start it again with <code>npm run dev:portal</code> (or{' '}
              <code>npm run dev:all</code> for both) and reload.
            </>
          ) : 'Connecting to the buyer…'}
        </div>
      )}
      <PortalShell standalone />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <VendorApp />
  </StoreProvider>,
);
