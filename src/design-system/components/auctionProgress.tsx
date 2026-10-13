/**
 * Drawing an auction as it moves.
 *
 * Presentational only, and deliberately so: everything here takes data that
 * has *already* been through the visibility projection. The chart does not
 * know what a feedback policy is and cannot be asked to hide a line, because
 * a line the viewer must not see is never passed to it. That is the same rule
 * the bid payload follows — absent, not hidden — and it has to hold here too,
 * since a competitor's price plotted on a chart is a competitor's price.
 *
 * Both applications render these. A supplier watching the lead pull away and
 * a controller watching the room go quiet are looking at one component with
 * different amounts of data in it.
 */
import { color, radius } from '../tokens';

export interface SeriesPoint {
  at: number;
  value: number;
}

export interface Line {
  points: SeriesPoint[];
  stroke: string;
  /** Drawn as a dashed line — used for the lead when it is not the viewer's. */
  dashed?: boolean;
  label: string;
  /** Round dots at each point. Off for dense series. */
  dots?: boolean;
}

export interface ChartMarker {
  at: number;
  label: string;
}

/**
 * A price-over-time chart, in plain SVG.
 *
 * No chart library: the shape is three polylines and some ticks, and a
 * dependency here would be several hundred kilobytes to draw them. The y axis
 * is inverted for a buy-side auction so that "good" is always up — a reverse
 * auction whose winning line sinks to the floor reads as a collapse to
 * everybody who has not been told otherwise.
 */
export function PriceChart({
  lines, markers = [], startingPrice, from, to, side, format, height = 180, emptyNote,
}: {
  lines: Line[];
  markers?: ChartMarker[];
  startingPrice: number;
  from: number;
  to: number;
  side: 'BUY' | 'SELL';
  format: (value: number) => string;
  height?: number;
  emptyNote?: string;
}) {
  const all = lines.flatMap((line) => line.points);
  if (all.length === 0) {
    return (
      <div
        style={{
          height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px dashed ${color.border}`, borderRadius: radius.card,
          fontSize: 12.5, color: color.textSecondary, textAlign: 'center', padding: 16,
        }}
      >
        {emptyNote ?? 'Nothing has been bid yet. The chart fills in as the room moves.'}
      </div>
    );
  }

  const values = [startingPrice, ...all.map((point) => point.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const span = Math.max(1, to - from);

  const W = 100;
  const H = 100;
  const x = (at: number) => ((at - from) / span) * W;
  /**
   * Good is up.
   *
   * On a buy-side auction a lower number is a better one, so the scale is
   * flipped. Without this the winning bid sits at the bottom of the frame and
   * every improvement looks like a decline.
   */
  const y = (value: number) => {
    const t = (value - yMin) / Math.max(1e-9, yMax - yMin);
    return side === 'BUY' ? t * H : (1 - t) * H;
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`Bidding over time. ${lines.map((l) => l.label).join(', ')}.`}
      >
        {/* The opening price, as the line everything is measured against. */}
        <line
          x1={0} x2={W} y1={y(startingPrice)} y2={y(startingPrice)}
          stroke={color.border} strokeWidth={0.4} strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        {markers.map((marker, i) => (
          <line
            key={`${marker.at}-${i}`}
            x1={x(marker.at)} x2={x(marker.at)} y1={0} y2={H}
            stroke={color.textMuted} strokeWidth={0.3} strokeDasharray="1 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {lines.map((line) => (
          <g key={line.label}>
            <polyline
              points={line.points.map((p) => `${x(p.at)},${y(p.value)}`).join(' ')}
              fill="none"
              stroke={line.stroke}
              strokeWidth={1.6}
              strokeDasharray={line.dashed ? '4 3' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {line.dots !== false && line.points.map((p, i) => (
              <circle
                key={i} cx={x(p.at)} cy={y(p.value)} r={2.2}
                fill={line.stroke} vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
      </svg>

      <div
        style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 6,
          fontSize: 10.5, color: color.textSecondary, fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>{new Date(from).toLocaleTimeString()}</span>
        <span>
          opened at {format(startingPrice)}
        </span>
        <span>{new Date(to).toLocaleTimeString()}</span>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {lines.map((line) => (
          <span key={line.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
            <span
              aria-hidden
              style={{
                width: 16, height: 0, borderTop: `2.5px ${line.dashed ? 'dashed' : 'solid'} ${line.stroke}`,
              }}
            />
            {line.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The activity feed
// ---------------------------------------------------------------------------

export interface FeedRow {
  at: number;
  text: string;
  tone: 'bid' | 'lead' | 'control' | 'mine' | 'rejected';
}

const TONE: Record<FeedRow['tone'], { dot: string; weight: number }> = {
  lead: { dot: color.successText, weight: 600 },
  mine: { dot: color.brandPrimary, weight: 600 },
  bid: { dot: color.textMuted, weight: 400 },
  control: { dot: color.accentPurple, weight: 500 },
  rejected: { dot: color.dangerText, weight: 400 },
};

/**
 * What just happened, newest first.
 *
 * The rows arrive already worded for their audience — the controller's feed
 * names companies, the supplier's does not — so this renders them verbatim
 * and makes no decisions of its own about disclosure.
 */
export function ActivityFeed({
  rows, emptyNote, height = 240,
}: { rows: FeedRow[]; emptyNote?: string; height?: number }) {
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: color.textSecondary, padding: '10px 0' }}>
        {emptyNote ?? 'Nothing has happened yet.'}
      </div>
    );
  }
  return (
    <div style={{ maxHeight: height, overflowY: 'auto' }} className="rfx-stack">
      {rows.map((row, i) => {
        const tone = TONE[row.tone];
        return (
          <div
            key={`${row.at}-${i}`}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 9, padding: '5px 0',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${color.border}`,
            }}
          >
            <span aria-hidden style={{ color: tone.dot, fontSize: 9, lineHeight: '16px' }}>●</span>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: tone.weight }}>{row.text}</span>
            <span
              style={{
                fontSize: 10.5, color: color.textSecondary, flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {new Date(row.at).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A single headline number with its caption. Used across the cockpit rail. */
export function Stat({
  label, value, tone, hint,
}: { label: string; value: string; tone?: 'good' | 'warn' | 'plain'; hint?: string }) {
  const fg = tone === 'good' ? color.successText : tone === 'warn' ? color.warningText : color.textPrimary;
  return (
    <div style={{ minWidth: 104 }}>
      <div style={{ fontSize: 10.5, color: color.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 650, color: fg, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}
