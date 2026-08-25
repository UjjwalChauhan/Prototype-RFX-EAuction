/**
 * Pack 00 §3–5 — layout and data components.
 * C-CARD, C-KPI, C-TABS, C-TABLE, C-SPLIT, C-PROGRESS, C-EMPTY, C-STEPPER,
 * C-STAGE-RAIL.
 */
import React from 'react';
import { color, elevation, font, radius, type } from '../tokens';
import type { StageRailItem, StageRailState } from '../../domain/journeyPatterns';

// ---------------------------------------------------------------------------
// C-CARD
// ---------------------------------------------------------------------------

export function Card({
  children, title, hint, action, padded = true, style,
}: {
  children: React.ReactNode; title?: React.ReactNode; hint?: string;
  action?: React.ReactNode; padded?: boolean; style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        background: color.surface, border: `1px solid ${color.border}`,
        borderRadius: radius.card, boxShadow: elevation.card, ...style,
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap', padding: '14px 16px',
            borderBottom: `1px solid ${color.border}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ ...type.sectionHeading }}>{title}</div>
            {hint && <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>{hint}</div>}
          </div>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </header>
      )}
      <div style={{ padding: padded ? 16 : 0 }}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// C-KPI
// ---------------------------------------------------------------------------

export interface Kpi {
  icon: string;
  value: string;
  label: string;
  iconBg: string;
  iconFg: string;
  live?: boolean;
  valueColor?: string;
  valueSize?: number;
  onClick?: () => void;
  title?: string;
}

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(150px, 100%), 1fr))`,
        gap: 10,
      }}
    >
      {kpis.map((kpi) => (
        <button
          key={kpi.label}
          type="button"
          title={kpi.title}
          onClick={kpi.onClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
            background: color.surface, border: `1px solid ${color.border}`,
            borderRadius: radius.card, padding: '11px 13px',
            cursor: kpi.onClick ? 'pointer' : 'default',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 30, height: 30, borderRadius: radius.control, flexShrink: 0,
              background: kpi.iconBg, color: kpi.iconFg,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700,
              animation: kpi.live ? 'rfx-pulse 1.4s infinite' : undefined,
            }}
          >
            {kpi.icon}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: kpi.valueSize ?? 18, fontWeight: 600,
                color: kpi.valueColor ?? color.textPrimary,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {kpi.value}
            </span>
            <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary }}>
              {kpi.label}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-TABS
// ---------------------------------------------------------------------------

export function Tabs({
  tabs, active, onChange, counts = {},
}: {
  tabs: string[]; active: string; onChange: (tab: string) => void;
  counts?: Record<string, number | string>;
}) {
  return (
    <div
      role="tablist"
      className="rfx-scroll-x"
      style={{
        display: 'flex', gap: 2, borderBottom: `1px solid ${color.border}`,
        background: color.surface, paddingInline: 8,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              padding: '11px 13px', fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? color.textPrimary : color.textSecondary,
              borderBottom: `2px solid ${isActive ? color.brandPrimary : 'transparent'}`,
              display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}
          >
            {tab}
            {counts[tab] !== undefined && (
              <span
                style={{
                  fontSize: 10.5, fontWeight: 700, borderRadius: radius.pill,
                  padding: '1px 6px',
                  background: isActive ? color.brandPrimarySoft : color.neutralSoft,
                  color: isActive ? color.brandPrimary : color.textSecondary,
                }}
              >
                {counts[tab]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-TABLE
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => React.ReactNode;
  /** Numeric columns get tabular figures and right alignment. */
  numeric?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowStyle?: (row: T, index: number) => React.CSSProperties | undefined;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  /** Rendered in place of rows when there are none. */
  empty?: React.ReactNode;
  loading?: boolean;
  loadingRows?: number;
  /** Sticky left columns, for the line-item comparison grid. */
  stickyLeft?: number;
}

export function Table<T>({
  columns, rows, rowKey, rowStyle, onRowClick, dense, empty, loading, loadingRows = 6,
}: TableProps<T>) {
  const rowHeight = dense ? 34 : 44;

  if (loading) {
    return (
      <div style={{ padding: 12 }}>
        {Array.from({ length: loadingRows }).map((_, i) => (
          <div key={i} className="rfx-skeleton" style={{ height: rowHeight - 12, marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="rfx-scroll-x">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: dense ? 12.5 : 13 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  ...type.tableHeader,
                  textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                  color: color.textSecondary,
                  padding: '9px 12px',
                  borderBottom: `1px solid ${color.border}`,
                  width: col.width,
                  whiteSpace: 'nowrap',
                  background: color.surface,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="rfx-row"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                height: rowHeight,
                cursor: onRowClick ? 'pointer' : 'default',
                borderBottom: `1px solid ${color.border}`,
                ...rowStyle?.(row, index),
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: '8px 12px',
                    textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                    fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined,
                    fontFamily: col.numeric ? font.mono : undefined,
                    color: color.textPrimary,
                    verticalAlign: 'middle',
                  }}
                >
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-EMPTY
// ---------------------------------------------------------------------------

export function Empty({
  icon = '▤', title, hint, action, tone = 'neutral',
}: {
  icon?: string; title: string; hint?: string; action?: React.ReactNode;
  tone?: 'neutral' | 'danger' | 'permission';
}) {
  const tint = tone === 'danger' ? color.dangerSoft : tone === 'permission' ? color.warningSoft : color.neutralSoft;
  const fg = tone === 'danger' ? color.dangerText : tone === 'permission' ? color.warningText : color.textMuted;
  return (
    <div style={{ padding: '46px 24px', textAlign: 'center' }}>
      <div
        aria-hidden
        style={{
          width: 46, height: 46, borderRadius: radius.card, margin: '0 auto 12px',
          background: tint, color: fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: color.textPrimary }}>{title}</div>
      {hint && (
        <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 5, maxWidth: 420, marginInline: 'auto' }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-PROGRESS
// ---------------------------------------------------------------------------

export function Progress({
  value, max = 100, tone = color.brandPrimary, height = 6, label,
}: { value: number; max?: number; tone?: string; height?: number; label?: string }) {
  const pctValue = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: color.textSecondary, marginBottom: 4 }}>
          <span>{label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pctValue.toFixed(0)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        style={{ height, background: color.neutralSoft, borderRadius: radius.pill, overflow: 'hidden' }}
      >
        <div style={{ width: `${pctValue}%`, height: '100%', background: tone, borderRadius: radius.pill }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-SPLIT — two or three panes
// ---------------------------------------------------------------------------

export function Split({
  left, centre, right, leftWidth = '240px', rightWidth = '300px', gap = 12,
}: {
  left?: React.ReactNode; centre: React.ReactNode; right?: React.ReactNode;
  leftWidth?: string; rightWidth?: string; gap?: number;
}) {
  const columns = [left ? `minmax(0, ${leftWidth})` : null, 'minmax(0, 1fr)', right ? `minmax(0, ${rightWidth})` : null]
    .filter(Boolean)
    .join(' ');
  // `min-width: 0` keeps a wide pane inside its own track instead of letting it
  // bleed over the neighbouring one.
  const pane: React.CSSProperties = { minWidth: 0 };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap, alignItems: 'start' }}>
      {left && <div style={pane}>{left}</div>}
      <div style={pane}>{centre}</div>
      {right && <div style={pane}>{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-STEPPER
// ---------------------------------------------------------------------------

export function Stepper({
  steps, current, onGo,
}: { steps: string[]; current: number; onGo?: (index: number) => void }) {
  return (
    <div className="rfx-scroll-x" style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBlock: 4 }}>
      {steps.map((step, i) => {
        const done = i < current;
        const isCurrent = i === current;
        const reachable = i <= current;
        return (
          <React.Fragment key={step}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onGo?.(i)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                border: 'none', background: 'transparent',
                cursor: reachable ? 'pointer' : 'default', padding: '4px 2px',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: done ? color.success : isCurrent ? color.brandPrimarySoft : color.neutralSoft,
                  color: done ? '#fff' : isCurrent ? color.brandPrimary : color.textMuted,
                  border: isCurrent ? `2px solid ${color.brandPrimary}` : 'none',
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: isCurrent ? 700 : 400,
                  color: isCurrent ? color.brandPrimary : done ? color.textPrimary : color.textMuted,
                }}
              >
                {step}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                style={{
                  width: 20, height: 2, borderRadius: 1, flexShrink: 0,
                  background: done ? color.success : color.border,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-STAGE-RAIL — skipped stages are shown, not hidden
// ---------------------------------------------------------------------------

const STAGE_STATE_STYLE: Record<StageRailState, {
  bg: string; fg: string; border: string; labelColor: string; weight: number;
  mark: string; strike: boolean; hint: string;
}> = {
  DONE: { bg: color.success, fg: '#fff', border: 'none', labelColor: color.textPrimary, weight: 500, mark: '✓', strike: false, hint: 'Completed' },
  CURRENT: { bg: color.brandPrimarySoft, fg: color.brandPrimary, border: `2px solid ${color.brandPrimary}`, labelColor: color.brandPrimary, weight: 700, mark: '●', strike: false, hint: 'Current stage' },
  PENDING: { bg: color.neutralSoft, fg: color.textMuted, border: 'none', labelColor: color.textMuted, weight: 400, mark: '○', strike: false, hint: 'Not yet reached' },
  SKIPPED: { bg: color.neutralSoft, fg: color.textMuted, border: `1px dashed ${color.borderStrong}`, labelColor: color.textMuted, weight: 400, mark: '–', strike: true, hint: 'Skipped' },
  CONDITIONAL: { bg: color.warningSoft, fg: color.warningText, border: `1px dashed ${color.warning}`, labelColor: color.warningText, weight: 500, mark: '?', strike: false, hint: 'Runs only if the condition is met' },
};

export function StageRail({ items }: { items: StageRailItem[] }) {
  return (
    <div
      className="rfx-scroll-x"
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '10px 14px', background: color.surface,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      {items.map((item, i) => {
        const s = STAGE_STATE_STYLE[item.state];
        const tooltip = item.note ? `${s.hint} — ${item.note}` : s.hint;
        return (
          <React.Fragment key={item.stage}>
            <span
              title={tooltip}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', position: 'relative' }}
            >
              <span
                aria-hidden
                style={{
                  width: 20, height: 20, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: s.bg, color: s.fg, border: s.border,
                }}
              >
                {s.mark}
              </span>
              <span
                style={{
                  fontSize: 12, fontWeight: s.weight, color: s.labelColor,
                  textDecoration: s.strike ? 'line-through' : 'none',
                }}
              >
                {item.label}
              </span>
              <span className="rfx-sr-only">{tooltip}</span>
            </span>
            {i < items.length - 1 && (
              <span aria-hidden style={{ width: 16, height: 1, background: color.border, flexShrink: 0 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
