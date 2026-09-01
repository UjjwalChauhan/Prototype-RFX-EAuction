/**
 * Pack 28 — the screens render, and render the things that must not be lost.
 *
 * The domain tests prove the rules. These prove the rules reach the page: that
 * a superseded approval is actually struck in the markup, that the drift notice
 * shows both chains, that the blocked-action panel says why and offers a route,
 * and that all nine open decisions are on the sheet. Server rendering is enough
 * for that — every one of these is a first-paint fact, not an interaction.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../../store/store';
import { ItemsLotsTab } from '../../tabs/ItemsLotsTab';
import { AwardTab } from '../../tabs/AwardTab';
import { ApprovalsTab } from '../../tabs/ApprovalsTab';
import { RevisionControl, RevisionDrawer } from '../RevisionDrawer';
import { ChainHistory } from '../ChainHistory';
import { AmendmentEditor } from '../Amendment';
import { RecallControl, RejectionAftermathPanel } from '../RecallAndRejection';
import { PostApprovalCorrection } from '../PostApprovalCorrection';
import { ScopeChangePanel } from '../ScopeChangePanel';
import { QuantityAdjustmentPanel } from '../QuantityAdjustment';
import { OpenDecisionSheet } from '../OpenDecisionSheet';
import {
  RATE_CONTRACTS, UNQUOTED_ITEM, buildScenarioNfa, type NfaScenarioId,
} from '../../../data/nfaScenarios';
import { DEFAULT_OPEN_DECISIONS, currentRevision } from '../../../domain/nfaLifecycle';
import { simulate } from '../../../domain/doa';
import { DOA_RULES, PRIMARY_EVENT_ID } from '../../../data/seed';

const settings = DEFAULT_OPEN_DECISIONS;
const liveDoa = simulate(
  DOA_RULES,
  { value: 141_500, category: 'Indirect', businessUnit: 'Corporate Services' },
);
const noop = () => {};

/** React splits interpolated text with comment markers; readers do not. */
function text(node: React.ReactElement): string {
  return renderToString(node).replace(/<!-- -->/g, '');
}

const SCENARIOS: NfaScenarioId[] = [
  'SINGLE_REVISION', 'THREE_REVISIONS', 'REJECTED_WITH_SUCCESSOR', 'APPROVED_AWAITING_CORRECTION',
];

describe.each(SCENARIOS)('%s', (scenario) => {
  const nfa = buildScenarioNfa(scenario, PRIMARY_EVENT_ID);

  it('opens a revision drawer naming every revision', () => {
    const html = text(
      <RevisionDrawer open nfa={nfa} onClose={noop} liveDoa={liveDoa} settings={settings} currency="USD" />,
    );
    expect(html).toContain('Revision history');
    for (const revision of nfa.revisions) {
      expect(html).toContain(`Revision ${revision.number}`);
    }
  });

  it('names the revision count on the control', () => {
    expect(text(<RevisionControl nfa={nfa} onOpen={noop} />))
      .toContain(`Revision ${nfa.revisions.length} of ${nfa.revisions.length}`);
  });

  it('renders the chain history', () => {
    expect(text(<ChainHistory nfa={nfa} settings={settings} />)).toContain('Chain history');
  });

  it('renders a recall control that explains itself either way', () => {
    const html = text(
      <RecallControl
        nfa={nfa} settings={settings} onSettingsChange={noop} onRecall={noop} disabledByRole={false}
      />,
    );
    expect(html).toContain('Recall this note');
    expect(html).toMatch(/Recall is (not )?available/);
  });
});

describe('the states the pack turns on', () => {
  it('strikes a superseded approval and keeps the delegation and escalation visible', () => {
    const nfa = buildScenarioNfa('THREE_REVISIONS', PRIMARY_EVENT_ID);
    const html = text(<ChainHistory nfa={nfa} settings={settings} />);
    expect(html).toContain('rfx-superseded');
    expect(html).toContain('delegated to L. Fernandes');
    expect(html).toContain('escalated from M. Prasad');
    // Struck, not dropped: the earlier holder is still named.
    expect(html).toContain('Discarded by recall');
  });

  it('shows both chains when the DoA matrix has moved since a revision was decided', () => {
    const nfa = buildScenarioNfa('THREE_REVISIONS', PRIMARY_EVENT_ID);
    const html = text(
      <RevisionDrawer open nfa={nfa} onClose={noop} liveDoa={liveDoa} settings={settings} currency="USD" />,
    );
    expect(html).toContain('The DoA matrix has changed since this revision was decided');
    expect(html).toContain('As decided:');
    expect(html).toContain('Live matrix today:');
  });

  it('gives the buyer the rejection reason and the aftermath', () => {
    const nfa = buildScenarioNfa('REJECTED_WITH_SUCCESSOR', PRIMARY_EVENT_ID);
    const html = text(
      <RejectionAftermathPanel
        nfa={nfa} settings={settings} onSettingsChange={noop}
        onRaiseSuccessor={noop} onCancelEvent={noop}
      />,
    );
    expect(html).toContain('Rejection reason');
    expect(html).toContain('Cancelled');
    expect(html).toContain('frozen and retained');
  });

  it('offers the correction panel on an approved, not-yet-executed award', () => {
    const nfa = buildScenarioNfa('APPROVED_AWAITING_CORRECTION', PRIMARY_EVENT_ID);
    const html = text(
      <PostApprovalCorrection
        nfa={nfa} settings={settings} onSettingsChange={noop} onErratum={noop} onNewRevision={noop}
        canAuthor authorName="A. Rahman" authorId="user-ar"
      />,
    );
    expect(html).toContain('Correct an approved award');
    expect(html).toContain('Cost centre');
  });

  it('states the change class before anything is submitted', () => {
    const nfa = buildScenarioNfa('THREE_REVISIONS', PRIMARY_EVENT_ID);
    const live = currentRevision(nfa)!;
    const unchanged = text(
      <AmendmentEditor
        base={live.document} draft={live.document} onChange={noop} steps={live.steps}
        settings={settings} currency="USD" onSubmit={noop} canSubmit
      />,
    );
    expect(unchanged).toContain('No change yet');

    const material = text(
      <AmendmentEditor
        base={live.document}
        draft={{ ...live.document, allocations: live.document.allocations.map((a, i) => (i === 0 ? { ...a, sharePct: 50 } : a)) }}
        onChange={noop} steps={live.steps} settings={settings} currency="USD"
        onSubmit={noop} canSubmit
      />,
    );
    expect(material).toContain('Material');
    expect(material).toContain('chain restarts at level 1');
  });

  it('explains a blocked scope change and offers a route, with the ceiling headroom', () => {
    const html = text(
      <ScopeChangePanel
        open onClose={noop} settings={settings} onSettingsChange={noop} onRoute={noop}
        context={{
          kind: 'ADD_LINE', eventStatus: 'AWARDED', origin: 'ITEMS_AND_LOTS',
          itemDescription: UNQUOTED_ITEM.description, itemCategory: UNQUOTED_ITEM.category,
          itemValue: UNQUOTED_ITEM.estimatedValue, currency: 'USD', contract: RATE_CONTRACTS[0],
        }}
      />,
    );
    expect(html).toContain('never quoted');
    expect(html).toContain('Create a new sourcing event');
    expect(html).toContain('RC-2026-0088');
    expect(html).toContain('Ceiling headroom');
  });

  it('leaves the call-off out — not disabled — when no contract covers the line', () => {
    const html = text(
      <ScopeChangePanel
        open onClose={noop} settings={settings} onSettingsChange={noop} onRoute={noop}
        context={{
          kind: 'ADD_LINE', eventStatus: 'AWARDED', origin: 'AWARD_SCENARIOS',
          itemDescription: 'External legal counsel', itemCategory: 'Professional Services',
          itemValue: 40_800, currency: 'USD', contract: RATE_CONTRACTS[0],
        }}
      />,
    );
    expect(html).not.toContain('RC-2026-0088');
    expect(html).toContain('No call-off destination');
  });

  it('renders the tolerance window and both reconciliations', () => {
    const html = text(
      <QuantityAdjustmentPanel
        awardedQuantity={12_000} lineDescription="A4 copier paper" lineTotalQuantity={14_000}
        prQuantity={12_000} unitPrice={8.67} currency="USD" tolerancePct={10}
        settings={settings} onSettingsChange={noop} onRouteOutOfTolerance={noop}
        onApply={noop} readOnly={false}
      />,
    );
    expect(html).toContain('Tolerance window');
    expect(html).toContain('Against the line&#x27;s total quantity');
    expect(html).toContain('Bound: 10,800 – 13,200');
    expect(html).toContain('Restrict RFQ PO Quantity');
  });

  it('puts all nine open decisions on one sheet, each with its screen effect', () => {
    const html = text(<OpenDecisionSheet open onClose={noop} settings={settings} onChange={noop} />);
    for (const id of ['OD-01', 'OD-02', 'OD-03', 'OD-04', 'OD-05', 'OD-06', 'OD-07', 'OD-08', 'OD-09']) {
      expect(html).toContain(id);
    }
  });
});

describe('the tabs still render inside the store', () => {
  it('approvals, items & lots and award', () => {
    expect(text(<StoreProvider><ApprovalsTab eventId={PRIMARY_EVENT_ID} /></StoreProvider>))
      .toContain('No approval in flight');
    expect(text(<StoreProvider><ItemsLotsTab eventId={PRIMARY_EVENT_ID} /></StoreProvider>))
      .toContain('Lot strategy');
    expect(text(<StoreProvider><AwardTab eventId={PRIMARY_EVENT_ID} onGoTab={noop} /></StoreProvider>).length)
      .toBeGreaterThan(500);
  });
});
