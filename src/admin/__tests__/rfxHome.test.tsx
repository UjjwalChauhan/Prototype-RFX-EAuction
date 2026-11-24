/**
 * RFX Home, painted.
 *
 * The page test guards the seams the domain tests cannot see: that every
 * section the buyer is promised is actually on the screen, that the charts
 * carry an accessible name rather than being a picture of a number, and that
 * the assistant states its limits where a buyer supervising it will read them.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import { RfxHome } from '../RfxHome';

function paint(): string {
  return renderToString(
    <StoreProvider>
      <RfxHome onNavigate={() => {}} />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

describe('the page answers the four questions in order', () => {
  const html = paint();

  it('opens on what needs the buyer, not on a chart', () => {
    expect(html.indexOf('Needs your action')).toBeGreaterThan(-1);
    expect(html.indexOf('Needs your action')).toBeLessThan(html.indexOf('Sourcing metrics'));
  });

  it('carries the pipeline, the funnel, the events and the performance figures', () => {
    for (const section of [
      'RFX pipeline', 'Demand to award', 'My events', 'Sourcing performance',
      'Open value by category', 'Coming up', 'Alerts',
    ]) {
      expect(html).toContain(section);
    }
  });

  it('greets with the whole name rather than a clipped initial', () => {
    expect(html).toMatch(/Good (morning|afternoon|evening), A\. Rahman/);
  });

  it('counts journeys once, saying so where the number could be doubted', () => {
    expect(html).toContain('the asks under one event are one piece of work, counted once');
  });
});

describe('the charts are readable without seeing them', () => {
  const html = paint();

  it('names the throughput chart for a screen reader', () => {
    expect(html).toContain('Journeys published and awarded per week over the last eight weeks');
  });

  it('offers a table view behind every chart', () => {
    expect(html.match(/Table view/g)?.length).toBe(4);
  });

  it('shows bid coverage per event as numbers, not only as bar lengths', () => {
    expect(html).toContain('Bid coverage by open event');
    expect(html).toMatch(/\d+ of \d+/);
  });
});

describe('the assistant is supervisable', () => {
  const html = paint();

  it('names the agent behind each offer', () => {
    expect(html).toContain('AI RFX Assistant');
    expect(html).toMatch(/AG-0\d/);
  });

  it('shows what the agent is not allowed to do, beside what it is offering', () => {
    expect(html).toContain('Cannot:');
  });

  it('says the ask box is arithmetic rather than a model', () => {
    expect(html).toContain("arithmetic over this tenant's records, not a model");
  });
});
