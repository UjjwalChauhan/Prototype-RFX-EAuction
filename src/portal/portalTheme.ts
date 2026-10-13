/**
 * The supplier portal's own visual language.
 *
 * Kept separate from `design-system/tokens` on purpose: the admin platform is
 * the buyer's dense working tool and the portal is the supplier's, and they are
 * allowed to look like different products. Nothing here is imported by the
 * admin side, so changing one never moves the other.
 *
 * Values are taken from the portal design being replicated — an indigo primary,
 * amber count badges, title-case rail headings and a white ground.
 */
export const portal = {
  /** Ground and surfaces. */
  page: '#FFFFFF',
  rail: '#FFFFFF',
  card: '#FFFFFF',
  border: '#EFEFF1',
  borderSoft: '#F5F5F7',

  /** The one accent: the selected rail row, and numbers that carry weight. */
  primary: '#6366F1',
  primaryText: '#FFFFFF',

  /** Count badges on rail rows. */
  badge: '#F5A623',
  badgeText: '#FFFFFF',

  /** Type. */
  heading: '#111827',
  label: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',

  /** Metric chips, in the order the reference uses them. */
  chips: ['#6366F1', '#EC4899', '#3B82F6', '#6366F1', '#F5A623'],

  /**
   * The navigation, taken from the reference screen: a narrow workspace
   * switcher on the far left, then the labelled rail.
   */
  navInk: '#131A3A',
  navLabel: '#5B6178',
  navHeading: '#A3A8B8',
  navHover: '#F5F5FA',
  switcher: '#FFFFFF',
  switcherBorder: '#ECECF1',
  avatarBorder: '#E6E7EE',
  avatarLabel: '#4B5163',
} as const;

/** Rail geometry, so the shell and the nav agree on one set of widths. */
export const portalNav = {
  switcherWidth: 74,
  railWidth: 250,
  railCollapsed: 78,
  avatar: 42,
  rowHeight: 46,
  /** The reference sets its navigation in a geometric grotesque. */
  font: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
} as const;

export const portalRadius = {
  row: 12,
  card: 20,
  chip: 4,
} as const;
