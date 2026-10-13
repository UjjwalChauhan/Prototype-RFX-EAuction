/**
 * Rail icons, drawn rather than imported.
 *
 * Stroked outlines on a 24-grid with round caps, matching the icon set in the
 * portal design being replicated. Inline SVG because the artifact ships with
 * the page and an icon font would be one more thing to load for a dozen glyphs.
 */
import React from 'react';

function Glyph({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PortalIcon = {
  /** Home — a trend line inside a rounded tile, with the reference's corner dot. */
  home: () => (
    <Glyph>
      <path d="M20.6 10.2V16a4.6 4.6 0 0 1-4.6 4.6H8A4.6 4.6 0 0 1 3.4 16V8A4.6 4.6 0 0 1 8 3.4h5.6" />
      <path d="M7.6 14.6 10.4 11.4l2.2 2 2.6-3.4" />
      <circle cx="19.4" cy="5" r="2" fill="currentColor" stroke="none" />
    </Glyph>
  ),

  /** Documents — invoices, inputs. */
  document: () => (
    <Glyph>
      <rect x="4.6" y="2.9" width="14.8" height="18.2" rx="3.4" />
      <path d="M8.6 8.4h6.8M8.6 12h6.8M8.6 15.6h4" />
    </Glyph>
  ),

  /** The procurement bag — requests, offers, credit notes. */
  bag: () => (
    <Glyph>
      <path d="M4.4 9.1a2 2 0 0 1 2-2h11.2a2 2 0 0 1 2 2l-.7 9a3 3 0 0 1-3 2.8H8.1a3 3 0 0 1-3-2.8z" />
      <path d="M9 9.1V7.4a3 3 0 0 1 6 0v1.7" />
    </Glyph>
  ),

  /** Bars in a tile — ask advance, orders. */
  bars: () => (
    <Glyph>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.6" />
      <path d="M8.2 15.6v-3.2M12 15.6v-7.2M15.8 15.6v-4.6" />
    </Glyph>
  ),

  /** Ticketing — a conversation. */
  ticket: () => (
    <Glyph>
      <path d="M20.4 11.6c0 4-3.8 7.2-8.4 7.2a9.9 9.9 0 0 1-2.7-.37L4.6 20l1.1-3.5a6.8 6.8 0 0 1-2.1-4.9c0-4 3.8-7.2 8.4-7.2s8.4 3.2 8.4 7.2z" />
      <path d="M8.6 11.6h.01M12 11.6h.01M15.4 11.6h.01" strokeWidth="2.2" />
    </Glyph>
  ),

  /** Settlements — a card with its payment mark. */
  card: () => (
    <Glyph>
      <rect x="2.8" y="5.6" width="18.4" height="12.8" rx="3.6" />
      <path d="M2.8 10.2h11.4" />
      <circle cx="17.6" cy="14.2" r="2.1" />
    </Glyph>
  ),

  profile: () => (
    <Glyph>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M5.2 20a6.8 6.8 0 0 1 13.6 0" />
    </Glyph>
  ),

  /** The gear — reports and settings both use it in the reference. */
  gear: () => (
    <Glyph>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M18.9 14.6a1.5 1.5 0 0 0 .3 1.7l.05.05a1.9 1.9 0 1 1-2.7 2.7l-.05-.05a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.14a1.9 1.9 0 1 1-3.8 0V20a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.05.05a1.9 1.9 0 1 1-2.7-2.7l.05-.05a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9H3.5a1.9 1.9 0 1 1 0-3.8h.14a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.05-.05a1.9 1.9 0 1 1 2.7-2.7l.05.05a1.5 1.5 0 0 0 1.7.3h.07a1.5 1.5 0 0 0 .9-1.4V3.5a1.9 1.9 0 1 1 3.8 0v.14a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.05-.05a1.9 1.9 0 1 1 2.7 2.7l-.05.05a1.5 1.5 0 0 0-.3 1.7v.07a1.5 1.5 0 0 0 1.4.9h.14a1.9 1.9 0 1 1 0 3.8H20a1.5 1.5 0 0 0-1.4.9z" />
    </Glyph>
  ),

  bell: () => (
    <Glyph>
      <path d="M18 9.4a6 6 0 1 0-12 0c0 5.6-2.1 7-2.1 7h16.2S18 15 18 9.4z" />
      <path d="M13.7 19.6a2 2 0 0 1-3.4 0" />
    </Glyph>
  ),

  // --- workspace rail actions -------------------------------------------------

  plus: () => (
    <Glyph size={18}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Glyph>
  ),

  logout: () => (
    <Glyph size={18}>
      <path d="M9.6 20.5H6.2a2.4 2.4 0 0 1-2.4-2.4V5.9a2.4 2.4 0 0 1 2.4-2.4h3.4" />
      <path d="M15.6 16.4 20 12l-4.4-4.4" />
      <path d="M20 12H9.4" />
    </Glyph>
  ),

  chevronLeft: () => (
    <Glyph size={14}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Glyph>
  ),

  chevronRight: () => (
    <Glyph size={14}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Glyph>
  ),
};

/**
 * The product mark — the ring-and-stem monogram with its accent square, drawn
 * to the proportions of the reference rather than approximated with a letter.
 */
export function PortalWordmark({
  ink, accent, markOnly = false,
}: {
  ink: string; accent: string; markOnly?: boolean;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
      <svg width="46" height="44" viewBox="0 0 52 48" fill="none" aria-hidden focusable="false">
        <path
          d="M35 12.5a15.5 15.5 0 1 0 0 23"
          stroke={ink}
          strokeWidth="8.6"
          strokeLinecap="round"
        />
        <rect x="37.4" y="7.5" width="8.6" height="33" rx="4.3" fill={ink} />
        <rect x="45.6" y="0" width="6.4" height="6.4" rx="1.6" fill={accent} />
      </svg>
      {!markOnly && (
        <span
          style={{
            fontSize: 34, fontWeight: 700, letterSpacing: '-0.035em',
            color: ink, lineHeight: 1,
          }}
        >
          dice
        </span>
      )}
    </span>
  );
}
