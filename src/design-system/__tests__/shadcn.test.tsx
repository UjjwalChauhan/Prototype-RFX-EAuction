/**
 * The design system is shadcn's, and says so in two places.
 *
 * `global.css` holds the token layer the Tailwind classes resolve against;
 * `tokens.ts` holds the same palette for the screens that still style inline.
 * Two readings of one palette is a real hazard — the point of these tests is
 * that the day they disagree is the day a test fails, rather than the day
 * somebody notices two slightly different greys on one screen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { color, radius } from '../tokens';
import { Button, Checkbox, Pill, Select, TextInput, Toggle } from '../components/primitives';
import { Card, Table } from '../components/layout';
import { Modal, ValidationBanner } from '../components/domain';
import { EVENT_STATUS_PRESENTATION } from '../../domain/statusMachine';
/**
 * Read off disk rather than imported: Vitest does not process stylesheets, so
 * an import of a `.css` file comes back empty and every assertion below would
 * pass against nothing at all.
 */
const CSS = readFileSync(fileURLToPath(new URL('../global.css', import.meta.url)), 'utf8');

/** The value of a `--name:` declaration in the `:root` block. */
function cssVar(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return (match?.[1] ?? '').trim();
}

describe('one palette, read two ways', () => {
  it('declares the shadcn token layer against the Tailwind import', () => {
    expect(CSS).toContain('@import "tailwindcss"');
    expect(CSS).toContain('@theme inline');
    expect(CSS).toContain('--color-muted-foreground: var(--muted-foreground)');
  });

  it.each([
    ['primary', 'brandPrimary'],
    ['background', 'surface'],
    ['foreground', 'textPrimary'],
    ['muted', 'rowAlt'],
    ['muted-foreground', 'textSecondary'],
    ['border', 'border'],
    ['accent', 'brandPrimarySoft'],
    ['destructive', 'danger'],
  ] as const)('%s matches color.%s in tokens.ts', (variable, token) => {
    expect(cssVar(variable).toUpperCase()).toBe(color[token].toUpperCase());
  });

  it('keeps the ring on the brand rather than on a second accent', () => {
    expect(cssVar('ring')).toBe(cssVar('primary'));
  });

  it('derives the radius scale from shadcn\'s --radius', () => {
    // 0.5rem = 8px on the surface, one step down on a control.
    expect(cssVar('radius')).toBe('0.5rem');
    expect(radius.card).toBe(8);
    expect(radius.control).toBe(6);
  });
});

const paint = (node: Parameters<typeof renderToString>[0]) => renderToString(node);

describe('the components carry shadcn classes, not hard-coded colour', () => {
  it('builds the button from the variant table', () => {
    const primary = paint(<Button variant="primary">Go</Button>);
    expect(primary).toContain('bg-primary');
    expect(primary).toContain('text-primary-foreground');
    // shadcn disables by class rather than by dimming inline.
    expect(primary).toContain('disabled:opacity-50');
    expect(paint(<Button variant="secondary">Go</Button>)).toContain('border-input');
    expect(paint(<Button variant="tertiary">Go</Button>)).toContain('text-primary');
    expect(paint(<Button variant="destructive">Go</Button>)).toContain('bg-destructive');
  });

  it('rings every control on focus instead of leaving the browser outline', () => {
    for (const node of [
      <Button key="b">Go</Button>,
      <TextInput key="i" />,
      <Select key="s"><option>a</option></Select>,
      <Toggle key="t" checked onChange={() => {}} label="On" />,
      <Checkbox key="c" checked onChange={() => {}} label="On" />,
    ]) {
      expect(paint(node)).toContain('ring-ring');
    }
  });

  it('marks an invalid input for a screen reader, not only in red', () => {
    const html = paint(<TextInput invalid />);
    expect(html).toContain('aria-invalid');
    expect(html).toContain('border-destructive');
  });

  it('gives the card shadcn\'s surface', () => {
    const html = paint(<Card title="Journeys">body</Card>);
    expect(html).toContain('rounded-lg');
    expect(html).toContain('bg-card');
    expect(html).toContain('shadow-sm');
  });

  it('mutes the table header the way shadcn does', () => {
    const html = paint(
      <Table
        columns={[{ key: 'a', header: 'Event', render: () => 'x' }]}
        rows={[{ id: '1' }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(html).toContain('text-muted-foreground');
  });

  it('dims the page behind a dialog with a token, not an rgba literal', () => {
    const html = paint(<Modal open title="Sure?" onClose={() => {}}>body</Modal>);
    expect(html).toContain('bg-black/50');
    expect(html).not.toContain('rgba(17,24,39');
  });
});

describe('what the revamp deliberately did not change', () => {
  it('keeps the brand violet through the move to shadcn neutrals', () => {
    expect(color.brandPrimary).toBe('#6C5DD3');
  });

  it('still carries status as colour and icon and text, never colour alone', () => {
    const html = paint(<Pill presentation={EVENT_STATUS_PRESENTATION.OPEN} />);
    expect(html).toContain(EVENT_STATUS_PRESENTATION.OPEN.icon);
    expect(html).toContain(EVENT_STATUS_PRESENTATION.OPEN.label);
  });

  it('still names an error banner as an alert for assistive technology', () => {
    expect(paint(<ValidationBanner tone="error" title="No name">{''}</ValidationBanner>))
      .toContain('role="alert"');
  });
});
