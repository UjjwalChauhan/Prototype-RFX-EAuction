/**
 * Pack 05 — Event workspace shell.
 *
 * This is the shell eighteen packs inherit, so two things must hold: the tab
 * strip is derived from the pattern rather than fixed, and the stage rail shows
 * skipped and conditional stages rather than hiding them.
 */
import React from 'react';
import { color, money } from '../design-system/tokens';
import { Button, Chip, Pill } from '../design-system/components/primitives';
import { KpiRow, StageRail, Tabs, type Kpi } from '../design-system/components/layout';
import { EVENT_STATUS_PRESENTATION } from '../domain/statusMachine';
import { JOURNEY_PATTERNS, buildStageRail, workspaceTabs } from '../domain/journeyPatterns';
import { rankLot } from '../domain/auctionEngine';
import { formatCountdown, serverNow } from '../server/clock';
import { biddersForEvent, useStore } from '../store/store';
import { OverviewTab } from './tabs/OverviewTab';
import { ItemsLotsTab } from './tabs/ItemsLotsTab';
import { BiddersTab } from './tabs/BiddersTab';
import { QuestionnaireTab } from './tabs/QuestionnaireTab';
import { ClarificationsTab, TermsTab, ActivityTab } from './tabs/SmallTabs';
import { ResponsesTab } from './tabs/ResponsesTab';
import { EvaluationTab } from './tabs/EvaluationTab';
import { AuctionTab } from './tabs/AuctionTab';
import { NegotiationTab } from './tabs/NegotiationTab';
import { AwardTab } from './tabs/AwardTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import type { Route } from './AdminShell';
import type { Stage } from '../domain/types';

export interface WorkspaceChrome {
  title: string;
  subtitle: string;
  breadcrumb: React.ReactNode;
  primaryAction: React.ReactNode;
  tabs: React.ReactNode;
  stageRail: React.ReactNode;
  body: React.ReactNode;
}

/**
 * Returns the chrome pieces so AdminShell can place them, rather than nesting
 * a second shell inside the first.
 */
export function useEventWorkspace(
  eventId: string,
  activeTab: string | undefined,
  onNavigate: (route: Route) => void,
): WorkspaceChrome | null {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return null;

  const pattern = JOURNEY_PATTERNS[event.journeyPattern];
  const tabs = workspaceTabs(event.stagesEnabled);
  const tab = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];

  const bidders = biddersForEvent(state, eventId);

  // Stages the pattern does not include are shown as skipped, with a reason,
  // because the NFA has to record every stage that did not happen.
  const allStages: Stage[] = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'];
  const skipReasons: Partial<Record<Stage, string>> = {};
  for (const stage of allStages) {
    if (!event.stagesEnabled.includes(stage)) {
      skipReasons[stage] = `Not part of ${pattern.name}`;
    }
  }
  const conditional: Stage[] =
    event.journeyPattern === 'JP-04' && event.stagesEnabled.includes('AUCTION') ? ['AUCTION'] : [];

  const railItems = buildStageRail(event.stagesEnabled, event.currentStage, conditional, skipReasons);

  const isPrimaryAuction = state.auction.auction.eventId === eventId;
  const liveRank = isPrimaryAuction
    ? rankLot(state.auction.bids, 'al-1', event.side, state.auction.auction.antiGaming.tieBidPolicy)
    : [];
  const bestBid = liveRank[0]?.transformedValue ?? null;

  const kpiVariant =
    event.currentStage === 'AUCTION' ? 'auction'
    : event.currentStage === 'EVALUATION' ? 'evaluation'
    : event.currentStage === 'AWARD' || event.currentStage === 'APPROVAL' ? 'award'
    : 'solicitation';

  const kpis: Kpi[] = ((): Kpi[] => {
    const responded = bidders.filter(
      (b) => b.participationStatus === 'SUBMITTED' || b.participationStatus === 'BIDDING',
    ).length;
    switch (kpiVariant) {
      case 'auction':
        return [
          { icon: '$', value: money(state.auction.lots[0]?.startingPrice ?? event.estimatedValue, event.currency), label: 'Starting price', iconBg: color.successSoft, iconFg: color.successText },
          {
            icon: '$',
            value: bestBid === null ? '—' : money(bestBid, event.currency),
            label: `Best ${event.side === 'BUY' ? 'landed' : 'offered'} value`,
            iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary, valueColor: color.brandPrimary,
          },
          { icon: '◱', value: `${bidders.filter((b) => b.participationStatus === 'BIDDING' || b.participationStatus === 'JOINED').length}/${bidders.length}`, label: 'Bidders joined', iconBg: color.accentPurpleSoft, iconFg: color.accentPurpleText },
          {
            icon: '◷',
            value: state.auction.lots[0]?.closesAt ? formatCountdown(state.auction.lots[0].closesAt - serverNow()) : '—',
            label: 'Time remaining', iconBg: color.dangerSoft, iconFg: color.dangerText,
            live: state.auction.auction.status === 'LIVE', valueColor: color.dangerText,
          },
        ];
      case 'evaluation':
        return [
          { icon: '✓', value: String(bidders.filter((b) => b.qualificationStatus === 'QUALIFIED').length), label: 'Technically qualified', iconBg: color.successSoft, iconFg: color.successText },
          { icon: '◷', value: String(bidders.length - state.scores.filter((s) => s.eventId === eventId).length / 2), label: 'Awaiting scores', iconBg: color.warningSoft, iconFg: color.warningText },
          { icon: '◱', value: '1/2', label: 'Evaluators complete', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary },
          { icon: '$', value: bestBid === null ? '—' : money(bestBid, event.currency), label: 'Best transformed value', iconBg: color.infoSoft, iconFg: color.infoText },
        ];
      case 'award':
        return [
          { icon: '$', value: money(bestBid ?? event.estimatedValue, event.currency), label: 'Recommended value', iconBg: color.successSoft, iconFg: color.successText },
          { icon: '↓', value: money(event.estimatedValue - (bestBid ?? event.estimatedValue), event.currency), label: 'Savings vs baseline', iconBg: color.successSoft, iconFg: color.successText, valueColor: color.successText },
          { icon: '✓', value: 'L1 / 3', label: 'Approval level', iconBg: color.warningSoft, iconFg: color.warningText },
          { icon: '◷', value: '5 days', label: 'To award target', iconBg: color.infoSoft, iconFg: color.infoText },
        ];
      default:
        return [
          { icon: '◱', value: String(bidders.length), label: 'Bidders invited', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary },
          { icon: '✓', value: String(responded), label: 'Responded', iconBg: color.successSoft, iconFg: color.successText },
          { icon: '◷', value: String(bidders.length - responded), label: 'Pending', iconBg: color.warningSoft, iconFg: color.warningText },
          {
            icon: '$',
            value: money(event.estimatedValue, event.currency, { compact: true }),
            label: `${event.side === 'BUY' ? 'Estimated' : 'Reserve'} value`,
            iconBg: color.infoSoft, iconFg: color.infoText,
          },
        ];
    }
  })();

  const goTab = (next: string) => onNavigate({ name: 'event', eventId, tab: next });

  const body = (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <KpiRow kpis={kpis} />
      {tab === 'Overview' && <OverviewTab eventId={eventId} onGoTab={goTab} />}
      {tab === 'Items & Lots' && <ItemsLotsTab eventId={eventId} />}
      {tab === 'Questionnaire' && <QuestionnaireTab eventId={eventId} />}
      {tab === 'Bidders' && <BiddersTab eventId={eventId} />}
      {tab === 'Terms' && <TermsTab eventId={eventId} />}
      {tab === 'Clarifications' && <ClarificationsTab eventId={eventId} />}
      {tab === 'Responses' && <ResponsesTab eventId={eventId} />}
      {tab === 'Evaluation' && <EvaluationTab eventId={eventId} />}
      {tab === 'Negotiation' && <NegotiationTab eventId={eventId} />}
      {tab === 'Auction' && <AuctionTab eventId={eventId} />}
      {tab === 'Award' && <AwardTab eventId={eventId} onGoTab={goTab} />}
      {tab === 'Approvals' && <ApprovalsTab eventId={eventId} />}
      {tab === 'Activity' && <ActivityTab eventId={eventId} />}
    </div>
  );

  const counts: Record<string, number | string> = {
    Bidders: bidders.length,
    Clarifications: state.clarifications.filter((c) => c.eventId === eventId && c.answer === null).length || '',
    Responses: state.responses.filter((r) => r.eventId === eventId && r.submittedAt !== null).length,
  };

  return {
    title: event.title,
    subtitle: `${event.eventNumber} · ${pattern.name}${event.sourceReference ? ` · from ${event.sourceReference}` : ''}`,
    breadcrumb: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'board' })}
          style={{ border: 'none', background: 'none', color: color.brandPrimary, cursor: 'pointer', fontSize: 11.5, padding: 0 }}
        >
          Sourcing
        </button>
        <span aria-hidden style={{ color: color.borderStrong }}>›</span>
        <span style={{ color: color.textPrimary, fontWeight: 600 }}>{event.eventNumber}</span>
      </span>
    ),
    primaryAction: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill
          presentation={EVENT_STATUS_PRESENTATION[event.status]}
          live={event.status === 'AUCTION_LIVE'}
        />
        {event.side === 'SELL' && <Chip tone="purple" title="Sell-side: highest bid wins">SELL</Chip>}
        {event.envelopeMode === 'TWO_ENVELOPE' && <Chip tone="neutral" icon="🔒">two envelope</Chip>}
        {event.status === 'AUCTION_LIVE' && (
          <Button variant="primary" onClick={() => goTab('Auction')}>Open cockpit →</Button>
        )}
      </div>
    ),
    tabs: <Tabs tabs={tabs} active={tab} onChange={goTab} counts={counts} />,
    stageRail: <StageRail items={railItems} />,
    body,
  };
}
