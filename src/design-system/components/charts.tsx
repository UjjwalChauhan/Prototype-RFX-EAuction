/**
 * C-CHARTS — the three shapes this product actually plots.
 *
 * Inline SVG rather than a charting library, for the same reason the rest of
 * this design system is hand-built: every mark has to answer to a token, and
 * a library's defaults are a second palette nobody maintains. Each chart is a
 * pure function of its numbers, renders identically on the server, and carries
 * its own accessible name — a trend the eye reads has to be a sentence a
 * screen reader can read too.
 *
 * None of them invent a scale. A chart with no data renders as an explicit
 * empty state rather than a flat line at zero, because a flat line is a claim.
 */
import { color, font } from '../tokens';

// ---------------------------------------------------------------------------
// C-SPARKLINE — a trend small enough to sit beside the number it describes
// ---------------------------------------------------------------------------

/**
 * Scale a series into the box, leaving a pixel of air top and bottom so the
 * extremes are not clipped by the stroke. A flat series sits on the midline
 * rather than on the floor: zero is a value, not an absence.
 */
function pathOf(points: number[], width: number, height: number, pad = 2): string {
  if (points.length === 0) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const stepX = points.length === 1 ? 0 : (width - pad * 2) / (points.length - 1);
  return points
    .map((value, index) => {
      const x = pad + index * stepX;
      const y = span === 0
        ? height / 2
        : height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function Sparkline({
  points, tone = color.brandPrimary, width = 64, height = 24, label,
}: {
  points: number[];
  tone?: string;
  width?: number;
  height?: number;
  /** What the line says, for anyone who cannot see it. */
  label: string;
}) {
  if (points.length < 2) return null;
  const line = pathOf(points, width, height);
  const last = points[points.length - 1];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const lastY = max === min
    ? height / 2
    : height - 2 - ((last - min) / (max - min)) * (height - 4);
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={`${line} L${width - 2},${height} L2,${height} Z`} fill={tone} opacity={0.1} />
      <path d={line} fill="none" stroke={tone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width - 2} cy={lastY} r={2} fill={tone} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// C-AREA-CHART — one or more series over a shared, labelled axis
// ---------------------------------------------------------------------------

export interface ChartSeries {
  name: string;
  tone: string;
  points: number[];
}

export function AreaChart({
  series, labels, height = 150, formatValue, caption,
}: {
  series: ChartSeries[];
  /** One label per point. Only the first, middle and last are drawn. */
  labels: string[];
  height?: number;
  formatValue: (value: number) => string;
  caption: string;
}) {
  const width = 560;
  const plot = height - 22;
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return (
      <div style={{ fontSize: 12, color: color.textMuted, padding: '20px 0' }}>
        Nothing has been published or awarded in this window yet.
      </div>
    );
  }
  const max = Math.max(...all, 1);
  // A shared ceiling across every series, so two lines on one axis compare.
  const scaled = (points: number[]) => points.map((p) => (p / max) * 100);
  const ticks = [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels[labels.length - 1]];

  return (
    <div>
      <svg
        role="img"
        aria-label={caption}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height }}
      >
        {/* Two rules only: the ceiling and the floor. A grid behind six points
            is more ink than the data it is measuring. */}
        {[0, plot].map((y) => (
          <line key={y} x1={0} x2={width} y1={y} y2={y} stroke={color.border} strokeWidth={1} />
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={`${pathOf(scaled(s.points), width, plot, 3)} L${width - 3},${plot} L3,${plot} Z`}
            fill={s.tone}
            opacity={0.12}
          />
        ))}
        {series.map((s) => (
          <path
            key={`${s.name}-line`}
            d={pathOf(scaled(s.points), width, plot, 3)}
            fill="none"
            stroke={s.tone}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10.5, color: color.textMuted, marginTop: 4,
        }}
      >
        {ticks.map((tick, index) => <span key={`${tick}-${index}`}>{tick}</span>)}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: s.tone }} />
            <span style={{ color: color.textSecondary }}>{s.name}</span>
            <strong style={{ fontFamily: font.mono, fontSize: 11.5 }}>
              {formatValue(s.points.reduce((a, b) => a + b, 0))}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C-DONUT — a composition, with the total in the hole
// ---------------------------------------------------------------------------

export interface DonutSlice {
  label: string;
  value: number;
  tone: string;
}

export function Donut({
  slices, total, caption, size = 150,
}: { slices: DonutSlice[]; total: string; caption: string; size?: number }) {
  const sum = slices.reduce((a, s) => a + s.value, 0);
  if (sum === 0) {
    return <div style={{ fontSize: 12, color: color.textMuted }}>No value to break down yet.</div>;
  }
  const radius = size / 2 - 11;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg role="img" aria-label={caption} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {slices.map((slice) => {
              const length = (slice.value / sum) * circumference;
              const dash = (
                <circle
                  key={slice.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.tone}
                  strokeWidth={16}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-consumed}
                />
              );
              consumed += length;
              return dash;
            })}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
          <span style={{ fontSize: 10, color: color.textMuted }}>total</span>
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 5, minWidth: 0, flex: 1 }}>
        {slices.map((slice) => (
          <li key={slice.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: slice.tone, flexShrink: 0 }} />
            <span style={{ color: color.textSecondary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {slice.label}
            </span>
            <span style={{ fontFamily: font.mono, fontSize: 11, color: color.textPrimary }}>
              {((slice.value / sum) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
