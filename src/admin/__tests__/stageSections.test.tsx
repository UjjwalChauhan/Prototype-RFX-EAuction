/**
 * Where a published family turns up on screen.
 *
 * The point of creating an RFI, an RFP, an RFQ and an auction from one publish
 * is that each is findable where a buyer looks for it — and that the board does
 * not turn into four rows saying the same thing. Both halves are checked here,
 * by painting the screens rather than by inspecting state.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider, initialState, reducer, type AppState } from '../../store/store';
import { localApi } from '../../api/client';
import { StageList } from '../../admin/IntakeAndLists';
import { SourcingBoard } from '../../admin/SourcingBoard';
import { OverviewTab } from '../../admin/tabs/OverviewTab';
import { ItemsLotsTab } from '../../admin/tabs/ItemsLotsTab';

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

async function published(): Promise<{ state: AppState; family: Awaited<ReturnType<ReturnType<typeof localApi>['createSourcingEvent']>> }> {
  const before = initialState();
  const family = await localApi({ events: before.events }, { now: () => NOW }).createSourcingEvent({
    journeyPattern: 'JP-05',
    title: 'Facilities Management 2026',
    category: 'Facilities', businessUnit: 'Corporate Services', ownerId: 'user-ar',
    lines: [{ description: 'HVAC maintenance', quantity: 96, uom: 'visit', baselinePrice: 2400, lotName: 'Lot 1 · Hard services' }],
    bidders: [{ counterpartyId: 'cp-abc' }],
    timeline: { closesInHours: 72 },
  });
  const state = reducer(before, {
    type: 'CREATE_EVENT', event: family.event, stageEvents: family.stageEvents,
    lots: family.lots, lineItems: family.lineItems, bidders: family.bidders,
    questionnaires: family.questionnaires, sourcedLineIds: [],
  });
  return { state, family };
}

const paint = (state: AppState, node: React.ReactNode) =>
  renderToString(<StoreProvider seed={state}>{node}</StoreProvider>)
    .replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'");

describe('the screens', () => {
  it('lists the RFI in the RFI section, under its event', async () => {
    const { state, family } = await published();
    const html = paint(state, <StageList stage="RFI" onNavigate={() => {}} />);
    expect(html).toContain(family.stageEvents[0].eventNumber);
    expect(html).toContain(`under ${family.event.eventNumber}`);
  });

  it('lists the planned RFP as planned', async () => {
    const { state, family } = await published();
    const html = paint(state, <StageList stage="RFP" onNavigate={() => {}} />);
    expect(html).toContain(family.stageEvents[1].eventNumber);
    expect(html).toContain('planned');
  });

  it('shows the umbrella on the board with an asks chip, and no asks as rows', async () => {
    const { state, family } = await published();
    const html = paint(state, <SourcingBoard onNavigate={() => {}} />);
    expect(html).toContain(family.event.eventNumber);
    expect(html).toContain('4 asks');
    // The ask numbers appear once each, in the chip's tooltip — never as rows
    // of their own, which is the thing that would double-count the work.
    for (const ask of family.stageEvents) {
      expect(html.split(ask.eventNumber)).toHaveLength(2);
    }
  });

  it('shows the family on the event overview', async () => {
    const { state, family } = await published();
    const html = paint(state, <OverviewTab eventId={family.event.id} onGoTab={() => {}} />);
    expect(html).toContain('Asks under this event');
    expect(html).toContain(family.stageEvents[2].eventNumber);
  });

  it('shows the parent basket on an ask', async () => {
    const { state, family } = await published();
    const html = paint(state, <ItemsLotsTab eventId={family.stageEvents[0].id} />);
    expect(html).toContain('HVAC maintenance');
    expect(html).toContain('Lot 1 · Hard services');
  });
});
