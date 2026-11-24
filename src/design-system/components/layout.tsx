/**
 * Pack 00 §3–5 — layout and data components, on shadcn/ui's anatomy.
 * C-CARD, C-KPI, C-TABS, C-TABLE, C-SPLIT, C-PROGRESS, C-EMPTY, C-STEPPER,
 * C-STAGE-RAIL.
 *
 * Card, Table, Tabs and Progress are shadcn's components of those names;
 * Stepper and StageRail have no shadcn equivalent and are built from the same
 * tokens so they sit in the same system. Props are unchanged throughout.
 *
 * One deliberate departure: shadcn's Table rules every row. This one keeps its
 * zebra, for the reason recorded at the row — at eleven columns a line under
 * every row turns the table into a grid of boxes and the eye loses the row it
 * was tracking. Everything else about the table is shadcn's: muted headers,
 * the hover, the padding scale.
 */
import React from 'react';
import { color, font, type } from '../tokens';
import { cn } from '../cn';
import type { StageRailItem, StageRailState } from '../../domain/journeyPatterns';

// ---------------------------------------------------------------------------
// C-CARD
// ---------------------------------------------------------------------------

export function Card({
  children, title, hint, action, padded = true, style, collapsed, onToggle,
}: {
  children: React.ReactNode; title?: React.ReactNode; hint?: string;
  action?: React.ReactNode; padded?: boolean; style?: React.CSSProperties;
  /** With `onToggle`, the title becomes a disclosure button and the body hides. */
  collapsed?: boolean; onToggle?: () => void;
}) {
  const heading = (
    <>
      <div className="leading-none tracking-tight" style={{ ...type.sectionHeading }}>{title}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  return (
    <section
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      style={style}
    >
      {(title || action) && (
        <header
          className={cn(
            'flex flex-wrap items-start justify-between gap-3 px-4 py-3.5',
            !collapsed && 'border-b border-border',
          )}
        >
          {onToggle ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={onToggle}
              className="flex min-w-0 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg
                width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
                className="mt-px shrink-0 text-muted-foreground transition-transform"
                style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <span className="min-w-0">{heading}</span>
            </button>
          ) : (
            <div className="min-w-0">{heading}</div>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {!collapsed && <div className={padded ? 'p-4' : undefined}>{children}</div>}
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
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left',
            'shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kpi.onClick ? 'cursor-pointer hover:bg-accent/50' : 'cursor-default',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'inline-flex size-[30px] shrink-0 items-center justify-center rounded-md text-sm font-bold',
              kpi.live && 'animate-pulse',
            )}
            style={{ background: kpi.iconBg, color: kpi.iconFg }}
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
            <span className="block text-[11.5px] text-muted-foreground">
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
      className="rfx-scroll-x flex gap-0.5 border-b border-border bg-card"
      style={{ paddingInline: 8 }}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px]',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
            {counts[tab] !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10.5px] font-bold',
                  isActive ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground',
                )}
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
  header: React.ReactNode;
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
  /**
   * Renders a full-width panel beneath a row. A row is expanded only when
   * `isExpanded` says so, so the table stays a controlled component and the
   * caller owns which rows are open.
   */
  renderExpanded?: (row: T, index: number) => React.ReactNode;
  isExpanded?: (row: T, index: number) => boolean;
  /**
   * One cell per column, rendered in a `tfoot` under the rows. Totals belong
   * under the column they total, not in a sentence beside the table.
   */
  footer?: React.ReactNode[];
}

export function Table<T>({
  columns, rows, rowKey, rowStyle, onRowClick, dense, empty, loading, loadingRows = 6,
  renderExpanded, isExpanded, footer,
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
      <table
        className="w-full caption-bottom border-collapse"
        style={{ fontSize: dense ? 12.5 : 13 }}
      >
        <thead className="[&_tr]:border-b [&_tr]:border-border">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="whitespace-nowrap border-b border-border bg-card px-2.5 py-2.5 text-[11px] font-medium text-muted-foreground"
                style={{
                  textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const expanded = isExpanded?.(row, index) ?? false;
            return (
              <React.Fragment key={rowKey(row, index)}>
                <tr
                  className={cn('rfx-row transition-colors', onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{
                    height: rowHeight,
                    /**
                     * Zebra rather than a rule under every row: at this density
                     * a line per row turns the table into a grid of boxes, and
                     * the eye loses the row it was tracking across.
                     */
                    background: expanded
                      ? color.brandPrimarySoft
                      : index % 2 === 1 ? color.rowAlt : undefined,
                    ...rowStyle?.(row, index),
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-2.5 py-2 align-middle text-[11.5px] text-foreground',
                        col.numeric && '[font-variant-numeric:tabular-nums]',
                      )}
                      style={{
                        textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                        fontFamily: col.numeric ? font.mono : undefined,
                      }}
                    >
                      {col.render(row, index)}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpanded && (
                  <tr style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td colSpan={columns.length} style={{ padding: 0, background: color.surfacePage }}>
                      {renderExpanded(row, index)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-border bg-muted/50">
              {columns.map((col, index) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-2.5 py-2 align-middle text-[11.5px] font-medium text-foreground',
                    col.numeric && '[font-variant-numeric:tabular-nums]',
                  )}
                  style={{ textAlign: col.align ?? (col.numeric ? 'right' : 'left') }}
                >
                  {footer[index]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
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
    <div className="px-6 py-12 text-center">
      <div
        aria-hidden
        className="mx-auto mb-3 flex size-[46px] items-center justify-center rounded-lg text-xl"
        style={{ background: tint, color: fg }}
      >
        {icon}
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {hint && (
        <div className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] text-muted-foreground">
          {hint}
        </div>
      )}
      {action && <div className="mt-3.5">{action}</div>}
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
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{label}</span>
          <span className="[font-variant-numeric:tabular-nums]">{pctValue.toFixed(0)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        className="w-full overflow-hidden rounded-full bg-muted"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pctValue}%`, background: tone }}
        />
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
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-0.5 py-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                reachable ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'inline-flex size-[22px] items-center justify-center rounded-full text-[11px] font-bold',
                  done && 'text-white',
                  isCurrent && 'border-2 border-primary bg-accent text-primary',
                  !done && !isCurrent && 'bg-muted text-muted-foreground',
                )}
                style={done ? { background: color.success } : undefined}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={cn(
                  'text-[12.5px]',
                  isCurrent ? 'font-bold text-primary' : done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="h-0.5 w-5 shrink-0 rounded-sm"
                style={{ background: done ? color.success : color.border }}
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
      className="rfx-scroll-x flex items-center gap-1 border-b border-border bg-card px-3.5 py-2.5"
    >
      {items.map((item, i) => {
        const s = STAGE_STATE_STYLE[item.state];
        const tooltip = item.note ? `${s.hint} — ${item.note}` : s.hint;
        return (
          <React.Fragment key={item.stage}>
            <span
              title={tooltip}
              className="relative inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <span
                aria-hidden
                className="inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: s.bg, color: s.fg, border: s.border }}
              >
                {s.mark}
              </span>
              <span
                className={cn('text-xs', s.strike && 'line-through')}
                style={{ fontWeight: s.weight, color: s.labelColor }}
              >
                {item.label}
              </span>
              <span className="rfx-sr-only">{tooltip}</span>
            </span>
            {i < items.length - 1 && (
              <span aria-hidden className="h-px w-4 shrink-0 bg-border" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
