/**
 * Application root.
 *
 * Two surfaces that are genuinely separate applications: the Admin Platform and
 * the Vendor Portal. Nothing in one is reachable from the other in production —
 * the switch in this build exists only so both can be demonstrated from one
 * running app, and it is the one seam that would not ship.
 */
import React from 'react';
import { StoreProvider, useStore } from './store/store';
import { useSync, type SyncStatus } from './store/sync';
import { AdminShell, type Route } from './admin/AdminShell';
import { SourcingBoard } from './admin/SourcingBoard';
import { CreateEventWizard } from './admin/CreateEventWizard';
import { useEventWorkspace } from './admin/EventWorkspace';
import { ConfigurationStudio, DoaAndAgents } from './admin/ConfigurationStudio';
import { ApprovalInbox, IntakeWorkbench, StageList } from './admin/IntakeAndLists';
import { AuctionBoard } from './admin/AuctionBoard';
import { PurchaseRequests } from './admin/PurchaseRequests';
import { PortalShell } from './portal/PortalShell';
import { Card, Empty } from './design-system/components/layout';
import { Button } from './design-system/components/primitives';

export function App() {
  return (
    <StoreProvider>
      <Surfaces />
    </StoreProvider>
  );
}

function Surfaces() {
  const { state } = useStore();
  // Publishes what the buyer owns to the sync seam, so the supplier portal
  // running on its own origin sees events the moment they are published.
  const sync = useSync('admin');
  return (
    <>
      <SyncBanner status={sync} />
      {state.surface === 'PORTAL' ? <PortalShell /> : <AdminApp />}
    </>
  );
}

/**
 * Say when publishing is not reaching the supplier portal.
 *
 * The portal seeds itself with the same demonstration data this platform holds,
 * so a broken link looks exactly like a working one from over there: everything
 * old is present and nothing new ever arrives. The buyer is the one who needs
 * telling, because the buyer is the one pressing publish.
 */
function SyncBanner({ status }: { status: SyncStatus }) {
  if (status === 'live') return null;
  const offline = status === 'offline';
  return (
    <div
      role="status"
      style={{
        background: offline ? '#7F1D1D' : '#1F2937',
        color: '#fff', padding: '8px 20px', fontSize: 13,
      }}
    >
      {offline
        ? 'The supplier portal is not connected — anything you publish stays on this machine until it is. The portal reads the seam this dev server holds at /__sync.'
        : 'Connecting the supplier portal…'}
    </div>
  );
}

function AdminApp() {
  const [route, setRoute] = React.useState<Route>({ name: 'board' });

  // The event workspace supplies its own chrome — tab strip, stage rail and
  // primary action — so the shell places them rather than nesting a second shell.
  const workspace = useEventWorkspace(
    route.name === 'event' ? route.eventId : '',
    route.name === 'event' ? route.tab : undefined,
    setRoute,
  );

  if (route.name === 'event') {
    if (!workspace) {
      return (
        <AdminShell route={route} onNavigate={setRoute} title="Event not found">
          <Card>
            <Empty
              icon="!"
              tone="danger"
              title="That event does not exist"
              hint="It may have been cancelled, or the link is stale."
              action={<Button variant="primary" onClick={() => setRoute({ name: 'board' })}>Back to the board</Button>}
            />
          </Card>
        </AdminShell>
      );
    }
    return (
      <AdminShell
        route={route}
        onNavigate={setRoute}
        title={workspace.title}
        subtitle={workspace.subtitle}
        breadcrumb={workspace.breadcrumb}
        primaryAction={workspace.primaryAction}
        tabs={workspace.tabs}
        stageRail={workspace.stageRail}
      >
        {workspace.body}
      </AdminShell>
    );
  }

  const chrome: Record<string, { title: string; subtitle?: string; body: React.ReactNode }> = {
    board: {
      title: 'Sourcing',
      subtitle: 'Every event, at every stage, in one place.',
      body: <SourcingBoard onNavigate={setRoute} />,
    },
    requests: {
      title: 'Purchase Request',
      subtitle: 'Requisitions and their lines. Open a request to see every item in it.',
      body: <PurchaseRequests onNavigate={setRoute} />,
    },
    intake: {
      title: 'Intake',
      subtitle: 'PR workbench — unsourced demand at requisition-line level.',
      body: <IntakeWorkbench onNavigate={setRoute} />,
    },
    create: {
      title: 'Create Event',
      subtitle: route.name === 'create' && route.prdId
        ? 'Raised against a consolidated demand — basics and lines are populated from the requisitions.'
        : 'The stepper reshapes to the journey pattern without losing what you have entered.',
      body: (
        <CreateEventWizard
          onNavigate={setRoute}
          prdId={route.name === 'create' ? route.prdId : undefined}
        />
      ),
    },
    approvals: {
      title: 'Approval Requests',
      subtitle: 'Award NFAs routed to your DoA levels.',
      body: <ApprovalInbox onNavigate={setRoute} />,
    },
    config: {
      title: 'Configuration Studio',
      subtitle: 'Fourteen domains across four scopes. The narrowest scope that defines a value wins.',
      body: <ConfigurationStudio />,
    },
    agents: {
      title: 'DoA Matrix & Agent Console',
      subtitle: 'Simulate an approval chain, and set what each agent may do.',
      body: <DoaAndAgents />,
    },
  };

  if (route.name === 'list') {
    const labels = {
      RFI: 'Requests for Information',
      RFP: 'Requests for Proposal',
      RFQ: 'Requests for Quotation',
      AUCTION: 'E-Auctions',
    } as const;
    return (
      <AdminShell
        route={route}
        onNavigate={setRoute}
        title={labels[route.stage]}
        subtitle={
          route.stage === 'AUCTION'
            ? 'Every auction in the tenant, with the mechanism that governs it.'
            : 'A filtered view of sourcing events — not a separate object.'
        }
      >
        {route.stage === 'AUCTION'
          ? <AuctionBoard onNavigate={setRoute} />
          : <StageList stage={route.stage} onNavigate={setRoute} />}
      </AdminShell>
    );
  }

  const current = chrome[route.name] ?? chrome.board;
  return (
    <AdminShell
      route={route}
      onNavigate={setRoute}
      title={current.title}
      subtitle={current.subtitle}
    >
      {current.body}
    </AdminShell>
  );
}
