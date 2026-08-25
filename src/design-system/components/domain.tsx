/**
 * Pack 00 §6–7 — feedback, overlay and domain-specific components.
 * C-VALIDATION, C-MODAL-CONFIRM, C-DRAWER, C-AGENT, C-TOGGLE-CARD,
 * C-COUNTDOWN, C-RAIL, plus the traffic light.
 *
 * The four hardest to retrofit are the countdown, the agent card, the stage
 * rail's skipped state (in layout.tsx) and a traffic light that works without
 * colour — all four are here or alongside.
 */
import React from 'react';
import { color, elevation, font, radius } from '../tokens';
import { Button, Chip } from './primitives';
import { TRAFFIC_BAND_PRESENTATION, type TrafficBand } from '../../domain/feedbackPolicy';
import { formatCountdown, serverNow } from '../../server/clock';
import type { AutonomyLevel } from '../../domain/types';
import { AUTONOMY_LABELS } from '../../domain/agents';

// ---------------------------------------------------------------------------
// C-VALIDATION
// ---------------------------------------------------------------------------

export type ValidationTone = 'error' | 'warning' | 'info' | 'success';

export interface ValidationItem {
  tone: ValidationTone;
  text: string;
  /** Blocks the primary action rather than merely warning. */
  blocking?: boolean;
}

const VALIDATION_TONE: Record<ValidationTone, { icon: string; fg: string; bg: string; border: string }> = {
  error: { icon: '✕', fg: color.dangerText, bg: color.dangerSoft, border: '#FCA5A5' },
  warning: { icon: '●', fg: color.warningText, bg: color.warningSoft, border: '#FCD34D' },
  info: { icon: 'ⓘ', fg: color.infoText, bg: color.infoSoft, border: '#7DD3FC' },
  success: { icon: '✓', fg: color.successText, bg: color.successSoft, border: '#86EFAC' },
};

export function ValidationBanner({ tone, title, children, action }: {
  tone: ValidationTone; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  const t = VALIDATION_TONE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: radius.control, padding: '10px 13px',
      }}
    >
      <span aria-hidden style={{ color: t.fg, fontWeight: 700, fontSize: 13, lineHeight: '18px' }}>{t.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.fg }}>{title}</div>
        {children && (
          <div style={{ fontSize: 12, color: color.textBody, marginTop: 3, lineHeight: 1.5 }}>{children}</div>
        )}
      </div>
      {action}
    </div>
  );
}

export function ValidationList({ items }: { items: ValidationItem[] }) {
  return (
    <ul className="rfx-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
      {items.map((item, i) => {
        const t = VALIDATION_TONE[item.tone];
        return (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
            <span aria-hidden style={{ color: t.fg, fontWeight: 700 }}>{t.icon}</span>
            <span style={{ color: item.blocking ? color.dangerText : color.textBody }}>
              {item.text}
              {item.blocking && <strong> — blocks publish</strong>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// C-MODAL-CONFIRM
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmTone?: 'primary' | 'destructive';
  confirmDisabled?: boolean;
  width?: number;
}

export function Modal({
  open, title, children, onClose, onConfirm, confirmLabel = 'Confirm',
  confirmTone = 'primary', confirmDisabled, width = 460,
}: ModalProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, zIndex: 500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: radius.card, boxShadow: elevation.overlay,
          width: '100%', maxWidth: width, maxHeight: '86vh', overflow: 'auto',
        }}
      >
        <header style={{ padding: '15px 18px', borderBottom: `1px solid ${color.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        </header>
        <div style={{ padding: 18, fontSize: 13, color: color.textBody, lineHeight: 1.6 }}>{children}</div>
        <footer
          style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '12px 18px', borderTop: `1px solid ${color.border}`,
          }}
        >
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {onConfirm && (
            <Button variant={confirmTone} onClick={onConfirm} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * A destructive action that requires the user to type a phrase. Used for the
 * agent kill switch, force close and abort.
 */
export function TypedConfirmModal({
  open, title, phrase, description, onClose, onConfirm, confirmLabel,
}: {
  open: boolean; title: string; phrase: string; description: React.ReactNode;
  onClose: () => void; onConfirm: (reason: string) => void; confirmLabel: string;
}) {
  const [typed, setTyped] = React.useState('');
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { if (open) { setTyped(''); setReason(''); } }, [open]);
  const ready = typed.trim().toUpperCase() === phrase.toUpperCase() && reason.trim().length > 3;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      onConfirm={() => onConfirm(reason)}
      confirmLabel={confirmLabel}
      confirmTone="destructive"
      confirmDisabled={!ready}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <div>{description}</div>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: color.textSecondary, marginBottom: 4 }}>
            Reason — written to the audit log before this takes effect
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            style={{
              width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
              padding: '7px 10px', fontSize: 13, resize: 'vertical',
            }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: color.textSecondary, marginBottom: 4 }}>
            Type <strong style={{ fontFamily: font.mono }}>{phrase}</strong> to continue
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
              padding: '7px 10px', fontSize: 13, fontFamily: font.mono,
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// C-DRAWER
// ---------------------------------------------------------------------------

export function Drawer({
  open, title, subtitle, children, onClose, width = 460, footer,
}: {
  open: boolean; title: string; subtitle?: string; children: React.ReactNode;
  onClose: () => void; width?: number; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.32)', zIndex: 450 }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        aria-label={title}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: width,
          background: '#fff', boxShadow: elevation.overlay,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 12, padding: '15px 18px', borderBottom: `1px solid ${color.border}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <span style={{ flexShrink: 0 }}>
            <Button variant="icon" onClick={onClose} aria-label="Close">✕</Button>
          </span>
        </header>
        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>{children}</div>
        {footer && (
          <footer style={{ padding: '12px 18px', borderTop: `1px solid ${color.border}` }}>{footer}</footer>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-AGENT — every agent surface carries the same five things
// ---------------------------------------------------------------------------

export interface AgentCardProps {
  code: string;
  name: string;
  autonomy: AutonomyLevel;
  confidence: number | null;
  summary: string;
  /** Cited, clickable inputs behind the "why" expander. */
  evidence: { label: string; detail: string }[];
  onAccept?: () => void;
  onModify?: () => void;
  onReject?: () => void;
  decided?: 'ACCEPTED' | 'MODIFIED' | 'REJECTED' | null;
  /** Mandate breaches shown inline — the agent stopped rather than proceeded. */
  breaches?: string[];
}

export function AgentCard({
  code, name, autonomy, confidence, summary, evidence,
  onAccept, onModify, onReject, decided, breaches = [],
}: AgentCardProps) {
  const [whyOpen, setWhyOpen] = React.useState(false);
  return (
    <div
      style={{
        border: `1px solid ${color.accentPurpleSoft}`, borderLeft: `3px solid ${color.accentPurple}`,
        borderRadius: radius.control, background: '#FDFCFF', padding: '11px 13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden style={{ color: color.accentPurple, fontSize: 13 }}>✦</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: color.accentPurpleText }}>{name}</span>
        <Chip tone="purple">{code}</Chip>
        <Chip tone="neutral" title="Autonomy level at execution">{AUTONOMY_LABELS[autonomy]}</Chip>
        {confidence !== null && (
          <Chip tone={confidence >= 0.75 ? 'brand' : 'gold'} title="Model confidence">
            {(confidence * 100).toFixed(0)}% confidence
          </Chip>
        )}
        {decided && (
          <Chip tone={decided === 'REJECTED' ? 'danger' : 'brand'}>{decided.toLowerCase()}</Chip>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: color.textBody, marginTop: 7, lineHeight: 1.55 }}>{summary}</div>

      {breaches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <ValidationBanner tone="warning" title="Outside mandate — escalated, not executed">
            <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
              {breaches.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </ValidationBanner>
        </div>
      )}

      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        style={{
          border: 'none', background: 'transparent', color: color.brandPrimary,
          fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '7px 0 0',
        }}
      >
        {whyOpen ? '▾' : '▸'} Why this suggestion
      </button>
      {whyOpen && (
        <ul style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: 11.5, color: color.textSecondary, lineHeight: 1.6 }}>
          {evidence.map((e) => (
            <li key={e.label}>
              <a href="#evidence" onClick={(ev) => ev.preventDefault()}>{e.label}</a> — {e.detail}
            </li>
          ))}
        </ul>
      )}

      {!decided && (onAccept || onModify || onReject) && (
        <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
          {onAccept && <Button size="small" variant="primary" onClick={onAccept}>Accept</Button>}
          {onModify && <Button size="small" variant="secondary" onClick={onModify}>Modify</Button>}
          {onReject && <Button size="small" variant="tertiary" onClick={onReject}>Reject</Button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-TOGGLE-CARD — a setting with its resolved scope always visible
// ---------------------------------------------------------------------------

export function ToggleCard({
  title, description, children, resolvedFrom, isLocked, lockedBy, onViewChain,
}: {
  title: string; description?: string; children: React.ReactNode;
  resolvedFrom?: string; isLocked?: boolean; lockedBy?: string | null;
  onViewChain?: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${color.border}`, borderRadius: radius.control,
        background: '#fff', padding: '12px 14px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {isLocked && <span title={`Locked at ${lockedBy} scope`}>🔒</span>}
        </div>
        {description && (
          <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
        {resolvedFrom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
            <Chip tone={isLocked ? 'danger' : 'neutral'} icon={isLocked ? '🔒' : '●'}>
              from {resolvedFrom}
            </Chip>
            {onViewChain && (
              <button
                type="button"
                onClick={onViewChain}
                style={{ border: 'none', background: 'none', color: color.brandPrimary, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                View inheritance chain
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-COUNTDOWN — corrected against the server clock continuously
// ---------------------------------------------------------------------------

export function Countdown({
  closesAt, size = 22, label, onExpire, paused, onDark,
}: {
  closesAt: number | null; size?: number; label?: string;
  onExpire?: () => void; paused?: boolean;
  /** Set on a dark surface — the neutral state is near-black otherwise. */
  onDark?: boolean;
}) {
  const [now, setNow] = React.useState(() => serverNow());

  React.useEffect(() => {
    if (paused) return;
    // Re-read the server clock every tick rather than decrementing locally, so
    // a drifting client cannot show a bidder more time than they have.
    const timer = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(timer);
  }, [paused]);

  const remaining = closesAt === null ? null : closesAt - now;
  const expired = remaining !== null && remaining <= 0;

  React.useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  const urgent = remaining !== null && remaining <= 60_000;
  const warn = remaining !== null && remaining <= 5 * 60_000;

  return (
    <div>
      {label && (
        <div style={{ fontSize: 11, color: onDark ? '#94A3B8' : color.textSecondary, marginBottom: 2 }}>{label}</div>
      )}
      <div
        aria-live={urgent ? 'assertive' : 'polite'}
        style={{
          fontFamily: font.mono, fontSize: size, fontWeight: 700,
          color: paused
            ? (onDark ? '#94A3B8' : color.textMuted)
            : urgent ? (onDark ? '#FCA5A5' : color.dangerText)
            : warn ? (onDark ? '#FCD34D' : color.warningText)
            : (onDark ? '#FFFFFF' : color.textPrimary),
          animation: urgent && !paused ? 'rfx-pulse 1s infinite' : undefined,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {paused ? 'PAUSED' : remaining === null ? '—' : formatCountdown(remaining)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Traffic light — meaning survives without colour
// ---------------------------------------------------------------------------

export function TrafficLight({ band, showLabel = true }: { band: TrafficBand; showLabel?: boolean }) {
  const p = TRAFFIC_BAND_PRESENTATION[band];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, position: 'relative',
        background: p.soft, borderRadius: radius.control,
        padding: '6px 11px', border: `1px solid ${p.hex}33`,
      }}
    >
      {/* Colour, shape and text all carry the meaning independently. */}
      <span aria-hidden style={{ color: p.hex, fontSize: 15, lineHeight: 1 }}>{p.icon}</span>
      {showLabel && (
        <span style={{ fontSize: 12, fontWeight: 600, color: p.hex }}>{p.label}</span>
      )}
      <span className="rfx-sr-only">{band}: {p.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// C-RAIL — a contextual left rail of items
// ---------------------------------------------------------------------------

export interface RailItem {
  id: string;
  label: string;
  meta?: string;
  badge?: React.ReactNode;
}

export function Rail({
  title, items, activeId, onSelect,
}: { title: string; items: RailItem[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <nav
      aria-label={title}
      style={{
        background: color.surface, border: `1px solid ${color.border}`,
        borderRadius: radius.card, overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
          color: color.textSecondary, padding: '10px 13px',
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        {title}
      </div>
      <div>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              className="rfx-navrow"
              onClick={() => onSelect(item.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: '9px 13px',
                background: active ? color.brandPrimarySoft : 'transparent',
                borderLeft: `3px solid ${active ? color.brandPrimary : 'transparent'}`,
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block', fontSize: 12.5,
                    fontWeight: active ? 600 : 400,
                    color: active ? color.brandPrimary : color.textBody,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </span>
                {item.meta && (
                  <span style={{ display: 'block', fontSize: 11, color: color.textSecondary, marginTop: 1 }}>
                    {item.meta}
                  </span>
                )}
              </span>
              {item.badge}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
