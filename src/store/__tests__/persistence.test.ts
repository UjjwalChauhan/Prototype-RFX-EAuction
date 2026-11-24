/**
 * Records created in one tab — an event and its RFI, RFP and RFQ — are saved
 * in the browser and read back by every other tab and after a reload. Which
 * portal a tab is showing is that tab's own and is never shared.
 */
import { describe, expect, it } from 'vitest';
import { initialState, parsePersisted, reducer, serializeState } from '../store';

describe('persistence', () => {
  const created = () => {
    const base = initialState();
    const parent = { ...base.events[0], id: 'evt-new', eventNumber: 'SRC-2026-0001', parentEventId: null };
    const rfi = { ...parent, id: 'evt-new-rfi', eventNumber: 'RFI-2026-0001', currentStage: 'RFI' as const, parentEventId: 'evt-new' };
    return { ...base, surface: 'EMPLOYEE' as const, events: [...base.events, parent, rfi] };
  };

  it('saves the event family and reads it back, without the tab’s portal', () => {
    const restored = parsePersisted(serializeState(created()));
    expect(restored?.events?.map((e) => e.eventNumber)).toEqual(expect.arrayContaining(['SRC-2026-0001', 'RFI-2026-0001']));
    expect(restored).not.toHaveProperty('surface');
  });

  it('sets aside data saved under another shape, and anything unreadable', () => {
    expect(parsePersisted(JSON.stringify({ shape: 'old', state: { events: [] } }))).toBeNull();
    expect(parsePersisted('{not json')).toBeNull();
    expect(parsePersisted(null)).toBeNull();
  });

  it('takes another tab’s records but keeps showing this tab’s portal', () => {
    const other = parsePersisted(serializeState(created()))!;
    const here = { ...initialState(), surface: 'ADMIN' as const };
    const next = reducer(here, { type: 'HYDRATE', state: other });
    expect(next.surface).toBe('ADMIN');
    expect(next.events.some((e) => e.eventNumber === 'RFI-2026-0001')).toBe(true);
  });
});
