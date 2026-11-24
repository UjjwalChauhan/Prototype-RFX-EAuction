/**
 * The Employee Portal.
 *
 * The buying organisation's employees act here on what the corporate portal
 * sends them: events held for their DoA level before suppliers are invited,
 * award NFAs, and asks they were named to evaluate. It reads and writes the
 * same store as the corporate portal, so a decision taken here is on the
 * buyer's screen the moment it is taken — and the other way round.
 *
 * "Switch Login" stands in for signing in as someone else, so one person can
 * walk an event from submission through every approver and evaluator.
 */
import React from 'react';
import { useStore } from '../store/store';
import { EMPLOYEES, SEEDED_EVALUATION, employeeById, type Employee } from '../data/employees';
import {
  approvalItems, awaiting, evaluationTasks, type EvaluationTask, type StageAssignment,
} from '../domain/employeePortal';
import { ApprovalCard, ApprovalDrawer, ApprovalsPage } from './EmployeeApprovals';
import { CommercialWorkspace, EvaluationsPage, TechnicalWorkspace, isTaskDone, readyTasks, taskStatus } from './EmployeeEvaluation';
import { Avatar, DiceMark, FabMark, Icon, fDate, useToasts } from './employeeUi';
import './employee.css';

type Page = 'home' | 'team' | 'mine' | 'evaluations' | 'workspace'
  | 'analytics' | 'inbox' | 'expense' | 'cards' | 'procure' | 'travel' | 'reports';

const PERSONA_KEY = 'rfx.employee.persona';

function savedPersona(): string {
  try {
    const id = window.localStorage.getItem(PERSONA_KEY);
    return id && employeeById(id) ? id : 'user-ar';
  } catch {
    return 'user-ar';
  }
}

export function EmployeePortal() {
  const { state, dispatch } = useStore();
  const [meId, setMeId] = React.useState(savedPersona);
  const me = employeeById(meId) ?? EMPLOYEES[0];
  const [page, setPage] = React.useState<Page>('home');
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [task, setTask] = React.useState<{ eventId: string; role: EvaluationTask['role']; bidderId?: string } | null>(null);
  const [pop, setPop] = React.useState<'switch' | 'profile' | 'bell' | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);
  const [approvalsOpen, setApprovalsOpen] = React.useState(true);
  const [toasts, toast] = useToasts();

  const items = approvalItems({
    events: state.events, nfas: state.nfas, requests: state.approvalRequests, notes: state.approvalNotes,
    nameOf: (id) => employeeById(id)?.name ?? (id === state.currentUser.id ? state.currentUser.name : id),
  });
  const waiting = items.filter((i) => i.status === 'PENDING' && awaiting(i, me.name));
  const tasks = evaluationTasks(state.events, me.id, SEEDED_EVALUATION as Record<string, StageAssignment[]>);
  // A task counts only once a bidder has submitted: before that it holds no envelopes.
  const openTasks = readyTasks(tasks, state).filter((t) => !isTaskDone(t, me, state));
  const open = items.find((i) => i.key === openKey) ?? null;
  const activeTask = task ? tasks.find((t) => t.event.id === task.eventId && t.role === task.role) ?? null : null;

  const go = (next: Page) => {
    setPage(next);
    setPop(null);
    setNavOpen(false);
    if (next === 'team' || next === 'mine') setApprovalsOpen(true);
    window.scrollTo?.(0, 0);
  };
  const switchTo = (id: string) => {
    setMeId(id);
    try { window.localStorage.setItem(PERSONA_KEY, id); } catch { /* the persona is a convenience */ }
    setPop(null);
    setOpenKey(null);
    setTask(null);
    if (page === 'workspace') setPage('evaluations');
    toast(`Logged in as ${employeeById(id)?.name}`, 'swap');
  };
  const openTask = (t: EvaluationTask, bidderId?: string) => { setTask({ eventId: t.event.id, role: t.role, bidderId }); go('workspace'); };
  const soon = (what: string) => toast(`${what} isn't part of this prototype`, 'info');

  React.useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.pop, [data-pop]')) setPop(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pop]);

  const topBar = (title: string, crumb?: string) => (
    <div className="top">
      <button type="button" className="icon-btn mobile-nav" aria-label="Menu" onClick={() => setNavOpen(true)}><Icon name="menu" size={24} /></button>
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
      </div>
      <div className="top-right">
        <button type="button" className="guides" onClick={() => soon('Guides & Videos')}><Icon name="book" size={18} /><span>Guides &amp; Videos</span></button>
        <button type="button" className="spark" aria-label="Dice AI" onClick={() => soon('Dice AI')}><Icon name="sparkle" size={18} /></button>
        <button type="button" className="icon-btn hide-sm" data-pop aria-label="Notifications" onClick={() => setPop(pop === 'bell' ? null : 'bell')}>
          <Icon name="bell" size={24} />{(waiting.length > 0 || openTasks.length > 0) && <span className="dot" />}
        </button>
        <button type="button" className="switch" data-pop onClick={() => setPop(pop === 'switch' ? null : 'switch')}>Switch Login</button>
        <button type="button" className="icon-btn hide-sm" aria-label="Back to the corporate portal" title="Back to the corporate portal" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}><Icon name="logout" size={24} /></button>
        <button type="button" className="icon-btn hide-sm" data-pop aria-label="Profile" onClick={() => setPop(pop === 'profile' ? null : 'profile')}><Icon name="user" size={24} /></button>
        {pop === 'switch' && (
          <div className="pop" style={{ right: 80, width: 300 }}>
            <div className="ph">Log in as</div>
            {EMPLOYEES.map((p) => (
              <button type="button" key={p.id} className={`opt ${p.id === me.id ? 'on' : ''}`} onClick={() => switchTo(p.id)}>
                <span className="persona"><Avatar name={p.name} /><span>{p.name}<small>{p.role} · {p.dept}</small></span></span>
              </button>
            ))}
          </div>
        )}
        {pop === 'profile' && (
          <div className="pop" style={{ right: 0 }}>
            <div className="ph">{me.name}</div>
            <button type="button" className="opt" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}><Icon name="swap" size={16} /> Corporate portal</button>
          </div>
        )}
        {pop === 'bell' && (
          <div className="pop" style={{ right: 150, width: 320 }}>
            <div className="ph">Waiting on you</div>
            {waiting.length + openTasks.length === 0 && <div style={{ padding: 10, color: 'var(--muted)', fontSize: 13 }}>You are all caught up.</div>}
            {waiting.slice(0, 5).map((i) => (
              <button type="button" key={i.key} className="opt" onClick={() => { setOpenKey(i.key); setPop(null); }}>
                <Icon name="clock" size={16} /><span><b>{i.reference}</b><br /><small style={{ color: 'var(--muted)' }}>{i.kind === 'EVENT' ? 'Event approval' : 'Award approval'} · {i.raisedByName}</small></span>
              </button>
            ))}
            {openTasks.slice(0, 5).map((t) => (
              <button type="button" key={`${t.event.id}-${t.role}`} className="opt" onClick={() => openTask(t)}>
                <Icon name="scale" size={16} /><span><b>{t.event.eventNumber}</b><br /><small style={{ color: 'var(--muted)' }}>{t.role === 'TECHNICAL' ? 'Technical' : 'Commercial'} evaluation</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const navItem = (key: Page, label: string, icon: string, chev?: boolean, badge?: number) => (
    <button type="button" className={`nav-item ${page === key ? 'active' : ''}`} title={label} onClick={() => go(key)}>
      <Icon name={icon} size={22} stroke={1.5} /><span className="lbl">{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
      {chev && <span className="chev"><Icon name="chevDown" size={18} /></span>}
    </button>
  );

  let body: React.ReactNode;
  if (page === 'home') {
    body = (
      <Home
        me={me}
        topBar={topBar(`Welcome, ${me.name.replace(/^[A-Z]\.\s*/, '')}`)}
        waiting={waiting}
        tasks={openTasks}
        onOpen={setOpenKey}
        onTask={openTask}
        onGo={go}
        soon={soon}
      />
    );
  } else if (page === 'team' || page === 'mine') {
    body = (
      <ApprovalsPage
        key={`${page}-${me.id}`}
        page={page}
        items={items}
        me={me}
        onOpen={setOpenKey}
        toast={toast}
        header={topBar(page === 'team' ? 'Team Approvals' : 'My Approvals')}
      />
    );
  } else if (page === 'evaluations') {
    body = <EvaluationsPage key={me.id} tasks={tasks} me={me} onOpen={openTask} header={topBar('Evaluations', 'Procure to Pay · Sourcing')} />;
  } else if (page === 'workspace') {
    body = activeTask ? (
      <>
        {topBar(activeTask.role === 'TECHNICAL' ? 'Technical evaluation' : 'Commercial evaluation', `Evaluations · ${activeTask.event.eventNumber}`)}
        {activeTask.role === 'TECHNICAL'
          ? <TechnicalWorkspace key={`${activeTask.event.id}-${me.id}-${task?.bidderId ?? ''}`} task={activeTask} me={me} initialBidderId={task?.bidderId} onBack={() => go('evaluations')} toast={toast} />
          : <CommercialWorkspace key={`${activeTask.event.id}-${me.id}`} task={activeTask} me={me} onBack={() => go('evaluations')} toast={toast} />}
      </>
    ) : (
      <>
        {topBar('Evaluations')}
        <div className="placeholder"><div className="big">{me.name} does not evaluate this ask</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('evaluations')}>Back to Evaluations</button>
        </div>
      </>
    );
  } else {
    const names: Record<string, string> = {
      analytics: 'Analytics', inbox: 'Inbox', expense: 'Expense', cards: 'Cards', procure: 'Procure to Pay', travel: 'Travel', reports: 'Reports',
    };
    body = (
      <>
        {topBar(names[page])}
        <div className="placeholder">
          <div className="big">{names[page]}</div>
          Not part of this prototype — head to <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('team')}>Team Approvals</button> or <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('evaluations')}>Evaluations</button>
        </div>
      </>
    );
  }

  return (
    <div className={`ep ${collapsed ? 'collapsed' : ''} ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Employee portal navigation">
        <div className="logo"><DiceMark size={36} /><span className="word">dice</span></div>
        <div className="who">
          <div className="who-name">{me.name} <span className="cur">₹</span></div>
          <div className="who-mail">{me.email}</div>
          <div className="who-role">{me.role} · {me.dept}</div>
        </div>
        {navItem('home', 'Home', 'home')}
        {navItem('analytics', 'Analytics', 'analytics')}
        {navItem('inbox', 'Inbox', 'inbox')}
        <div className={`nav-group ${approvalsOpen ? 'open' : ''}`}>
          <button type="button" className="nav-item" title="Approvals" onClick={() => setApprovalsOpen(!approvalsOpen)}>
            <Icon name="layers" size={22} stroke={1.5} /><span className="lbl">Approvals</span>
            <span className="chev"><Icon name={approvalsOpen ? 'chevUp' : 'chevDown'} size={18} /></span>
          </button>
          {approvalsOpen && (
            <div className="nav-sub">
              <button type="button" className={page === 'team' ? 'active' : ''} onClick={() => go('team')}>
                Team Approvals {waiting.length > 0 && <span className="badge">{waiting.length}</span>}
              </button>
              <button type="button" className={page === 'mine' ? 'active' : ''} onClick={() => go('mine')}>My Approvals</button>
            </div>
          )}
        </div>
        {navItem('evaluations', 'Evaluations', 'scale', false, openTasks.length)}
        {navItem('expense', 'Expense', 'coins', true)}
        {navItem('cards', 'Cards', 'card', true)}
        {navItem('procure', 'Procure to Pay', 'procure', true)}
        {navItem('travel', 'Travel', 'briefcase', true)}
        {navItem('reports', 'Reports', 'report')}
        <div className="nav-corp">
          <button type="button" className="nav-item" title="Corporate portal" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'ADMIN' })}>
            <Icon name="swap" size={22} stroke={1.5} /><span className="lbl">Corporate portal</span>
          </button>
        </div>
      </aside>
      <main className="main">{body}</main>
      <button type="button" className="collapse-btn" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}><Icon name="chevLeft" size={20} stroke={2} /></button>
      <button type="button" className="fab" aria-label="Dice assistant" onClick={() => soon('The Dice assistant')}><FabMark /></button>
      {open && <ApprovalDrawer key={`${open.key}-${me.id}`} item={open} me={me} onClose={() => setOpenKey(null)} toast={toast} />}
      {toasts}
    </div>
  );
}

function Home({ me, topBar, waiting, tasks, onOpen, onTask, onGo, soon }: {
  me: Employee;
  topBar: React.ReactNode;
  waiting: ReturnType<typeof approvalItems>;
  tasks: EvaluationTask[];
  onOpen: (key: string) => void;
  onTask: (task: EvaluationTask) => void;
  onGo: (page: Page) => void;
  soon: (what: string) => void;
}) {
  const { state } = useStore();
  const row = React.useRef<HTMLDivElement>(null);
  const quick = (icon: string, label: string) => (
    <button type="button" key={label} onClick={() => soon(label)}><span className="circ"><Icon name={icon} size={22} stroke={1.4} /></span>{label}</button>
  );
  const travel = (bg: string, emoji: string, label: string, isNew?: boolean) => (
    <button type="button" key={label} onClick={() => soon(label)}>
      <span className="circ" style={{ background: bg }}>{isNew && <span className="new">New</span>}{emoji}</span>{label}
    </button>
  );
  return (
    <>
      {topBar}
      <div className="h2">Expense</div>
      <div className="quick">{quick('receipt', 'Add Expense')}{quick('receipt', 'Bulk Add Expense')}{quick('layers', 'Create Voucher')}{quick('db', 'Request Advance')}{quick('gauge', 'Log Miles')}</div>
      <div className="h2">Travel</div>
      <div className="quick travel">
        <button type="button" onClick={() => soon('Request New Trip')}><span className="circ" style={{ background: 'var(--primary)', color: '#fff' }}><Icon name="plus" size={22} stroke={2} /></span>Request New Trip</button>
        {travel('linear-gradient(160deg,#8EB6E8,#E9A9B6)', '✈️', 'Flights')}
        {travel('linear-gradient(160deg,#E7D8C9,#9B7E63)', '🛏️', 'Stays')}
        {travel('linear-gradient(160deg,#D9DDE4,#8A97AA)', '🚆', 'Trains')}
        {travel('linear-gradient(160deg,#5FB0E5,#2E7D4F)', '🌏', 'Visa', true)}
      </div>
      <div className="h2">Apps</div>
      <div className="apps">
        <button type="button" className="app-tile" onClick={() => onGo('team')}><span className="ic"><DiceMark size={30} ink="#fff" /></span>Sourcing Approvals</button>
        <button type="button" className="app-tile" onClick={() => onGo('evaluations')}><span className="ic"><DiceMark size={30} ink="#fff" /></span>Bid Evaluation</button>
      </div>

      <div className="h2">
        <span className="grow">Pending Approvals</span>
        <button type="button" className="ghost-sm" onClick={() => onGo('team')}>View All</button>
        <button type="button" className="round-sm" aria-label="Previous" onClick={() => row.current?.scrollBy({ left: -300 })}><Icon name="chevLeft" size={16} /></button>
        <button type="button" className="round-sm" aria-label="Next" onClick={() => row.current?.scrollBy({ left: 300 })}><Icon name="chevRight" size={16} /></button>
      </div>
      {waiting.length > 0
        ? <div className="pa-row" ref={row}>{waiting.map((i) => <ApprovalCard key={i.key} item={i} onOpen={onOpen} />)}</div>
        : <div className="empty">Nothing waiting on {me.name}. Events submitted for approval in the corporate portal appear here when they reach your level.</div>}

      <div className="h2"><span className="grow">Evaluations assigned to you</span><button type="button" className="ghost-sm" onClick={() => onGo('evaluations')}>View All</button></div>
      {tasks.length > 0 ? (
        <div className="pa-row">
          {tasks.map((t) => (
            <button type="button" key={`${t.event.id}-${t.role}`} className="pa-card" onClick={() => onTask(t)}>
              <span className="m">{t.role === 'TECHNICAL' ? 'Technical envelope' : 'Commercial envelope'}</span>
              <span className="t">{t.event.eventNumber}</span>
              <span className="m">{t.event.title}</span>
              <span className="foot">
                <span className="m">Closes {fDate(t.event.closesAt)}</span>
                <span className={`tag ${t.role === 'TECHNICAL' ? 'p' : 'w'}`}><Icon name={t.role === 'TECHNICAL' ? 'scale' : 'coins'} size={12} />{taskStatus(t, me, state).label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : <div className="empty">No evaluations assigned to {me.name}. Evaluators are named on step 5 of Create sourcing event.</div>}
    </>
  );
}
