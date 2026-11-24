/**
 * Small pieces every Employee Portal screen uses: the icon set, avatars,
 * formatting, and the toast. Kept apart from the screens so the approvals
 * inbox and the evaluation workspaces read the same way.
 */
import React from 'react';

const PATHS: Record<string, string> = {
  home: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  analytics: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  procure: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 4V2M16 4V2M8 14h5"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  scale: '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>', chevUp: '<path d="m18 15-6-6-6 6"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>', chevRight: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sort: '<path d="M3 16l4 4 4-4M7 20V4M14 8h7M14 12h5M14 16h3"/>',
  filter: '<path d="M3 6h18M7 12h10M10 18h4"/>',
  export: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9M8 16l4-4 4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  sparkle: '<path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 3v4M17 5h4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  swap: '<path d="M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
};

export function Icon({ name, size = 20, stroke = 1.7 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg
      className="i" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? '' }}
    />
  );
}

export function DiceMark({ size = 34, ink = '#1D1D22' }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden>
      <path d="M23 9v11a8.5 8.5 0 1 1-8.5-8.5" stroke={ink} strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="25.5" cy="3.8" r="2.6" fill="#6C5DD3" />
    </svg>
  );
}

export function FabMark() {
  const fills = ['#6C5DD3', '#8E7FF0', '#4F7BEA', '#7DA7FF', '#A08CF5', '#5B4CC4'];
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
      <g transform="translate(17 17)">
        {[0, 60, 120, 180, 240, 300].map((a, i) => (
          <path key={a} transform={`rotate(${a})`} d="M0 0 C 2 -8, 8 -12, 13 -10 C 8 -6, 4 -3, 0 0Z" fill={fills[i]} />
        ))}
      </g>
    </svg>
  );
}

const AVATAR_COLORS = ['#3F8C55', '#2E6E5E', '#5B8C3A', '#6C5DD3', '#C2662D', '#3B6FB6', '#9B4F96', '#B5893A'];

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const bg = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return <span className={`av ${large ? 'lg' : ''}`} style={{ background: bg }} aria-hidden>{name.replace(/^[A-Z]\.\s*/, '')[0] ?? name[0]}</span>;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fDate(at: number | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export function fTime(at: number | null | undefined): string {
  if (!at) return '—';
  const d = new Date(at);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap} ${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

export function dur(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '< 1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function amount(value: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** One short message at the foot of the screen, gone on its own. */
export type Toast = (message: string, icon?: string) => void;

export function useToasts(): [React.ReactNode, Toast] {
  const [items, setItems] = React.useState<{ id: number; message: string; icon: string }[]>([]);
  const toast = React.useCallback<Toast>((message, icon = 'check') => {
    const id = Date.now() + Math.random();
    // Three at most: a burst of actions should not bury the screen.
    setItems((list) => [...list, { id, message, icon }].slice(-3));
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 2800);
  }, []);
  const node = (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className="toast"><Icon name={t.icon} size={16} stroke={2} />{t.message}</div>)}
    </div>
  );
  return [node, toast];
}

/** The portal's modal, matching the Dice look rather than the buyer platform's. */
export function EpModal({ title, lead, children, confirm, confirmTone = 'primary', onConfirm, onClose, wide, confirmDisabled }: {
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  confirm: string;
  confirmTone?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose: () => void;
  wide?: boolean;
  confirmDisabled?: boolean;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {lead && <p>{lead}</p>}
          <button type="button" className="x" onClick={onClose} aria-label="Close"><Icon name="x" size={20} stroke={2.4} /></button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        <div className="modal-foot">
          <button
            type="button"
            className={`btn ${confirmTone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirm}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
