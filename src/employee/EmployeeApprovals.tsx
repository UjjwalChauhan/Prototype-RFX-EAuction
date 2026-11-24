/**
 * Approvals on the Employee Portal.
 *
 * Two kinds of request land in one inbox: a sourcing event held for its DoA
 * chain before any supplier is invited, and an award NFA. Both are decided
 * here and written back to the shared store, so the buyer's platform shows the
 * outcome the moment it is taken — the event goes out, or the award lands.
 *
 * Bulk approval is offered for event releases only. An award is decided on its
 * own facts; the buyer platform's inbox says the same and so does this one.
 */
import React from 'react';
import {
  biddersForEvent, lineItemsForEvent, stageEventsOf, termsForEvent, useStore,
} from '../store/store';
import { COUNTERPARTIES } from '../data/seed';
import { employeeByName, employeeById } from '../data/employees';
import { JOURNEY_PATTERNS, STAGE_LABELS } from '../domain/journeyPatterns';
import { directionLabel } from '../domain/comparator';
import { applyDecision, rejectionAftermath } from '../domain/nfaLifecycle';
import {
  actedBy, awaiting, currentHolder, decideEventApproval,
  type ApprovalItem, type ApprovalNote, type StageAssignment,
} from '../domain/employeePortal';
import type { Employee } from '../data/employees';
import {
  Avatar, EpModal, Icon, amount, downloadCsv, dur, fDate, fTime, type Toast,
} from './employeeUi';

const KIND_LABEL: Record<ApprovalItem['kind'], { type: string; approval: string }> = {
  EVENT: { type: 'sourcing-event-release', approval: 'Sourcing Event Approval' },
  AWARD: { type: 'award-nfa', approval: 'Award NFA Approval' },
};

export function StatusChip({ item }: { item: ApprovalItem }) {
  const map: Record<ApprovalItem['status'], [string, string]> = {
    PENDING: ['s-pending', 'Approval Pending'],
    ON_HOLD: ['s-hold', 'On Hold'],
    APPROVED: ['s-approved', 'Approved'],
    DECLINED: ['s-declined', 'Declined'],
    RETURNED: ['s-hold', 'Returned'],
  };
  const [cls, label] = map[item.status];
  return <span className={`status ${cls}`}>{label}</span>;
}

/** Everything an approver can do, written back to the shared store. */
export function useApprovalActions(me: Employee, toast: Toast) {
  const { state, dispatch } = useStore();

  const note = (item: ApprovalItem, kind: ApprovalNote['kind'], text: string) => dispatch({
    type: 'ADD_APPROVAL_NOTE',
    note: { id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: item.key, kind, byName: me.name, at: Date.now(), text },
  });

  const decide = (item: ApprovalItem, decision: 'APPROVED' | 'DECLINED', comment: string) => {
    if (item.currentLevel === null) return;
    // A held request is released by the decision on it, so the next level
    // does not inherit a hold it never placed.
    if (item.status === 'ON_HOLD') note(item, 'UNHOLD', 'Released by the decision');
    const at = Date.now();
    if (item.kind === 'EVENT') {
      const request = state.approvalRequests.find((r) => r.id === item.refId);
      if (!request) return;
      const next = decideEventApproval(request, item.currentLevel, decision, comment, at);
      dispatch({ type: 'DECIDE_EVENT_APPROVAL', request: next, at });
      return next.status;
    }
    const nfa = state.nfas.find((n) => n.id === item.refId);
    if (!nfa) return;
    const next = applyDecision({
      nfa, level: item.currentLevel, decision: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      comment, actorName: me.name, at,
    });
    dispatch({ type: 'REPLACE_NFA', nfa: next });
    if (next.status === 'APPROVED') {
      dispatch({ type: 'UPDATE_EVENT', eventId: item.eventId, patch: { status: 'AWARDED', awardedAt: at } });
    } else if (next.status === 'REJECTED') {
      dispatch({
        type: 'UPDATE_EVENT', eventId: item.eventId,
        patch: { status: rejectionAftermath(state.nfaOptions).eventStatus, currentStage: 'AWARD' },
      });
    }
    return next.status === 'REJECTED' ? 'DECLINED' : next.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
  };

  return {
    decide,
    hold: (item: ApprovalItem, reason: string, ask: boolean) => {
      note(item, 'HOLD', reason);
      if (ask) note(item, 'CLARIFICATION', reason);
      toast(`${item.reference} moved to Hold`, 'pause');
    },
    release: (item: ApprovalItem, comment: string) => {
      note(item, 'UNHOLD', comment);
      toast(`${item.reference} moved back to Pending`, 'play');
    },
    clarify: (item: ApprovalItem, text: string) => {
      note(item, 'CLARIFICATION', text);
      toast(`Sent to ${item.raisedByName} on the corporate portal`, 'send');
    },
  };
}

type Modal = { kind: 'approve' | 'decline' | 'hold' | 'unhold'; items: ApprovalItem[] } | null;

/** Approve / Decline / Hold / Release — one modal, the reason required where it should be. */
function DecisionModal({ modal, me, onClose, onDone, actions }: {
  modal: NonNullable<Modal>;
  me: Employee;
  onClose: () => void;
  onDone: (message: string, icon: string) => void;
  actions: ReturnType<typeof useApprovalActions>;
}) {
  const [text, setText] = React.useState('');
  const [ask, setAsk] = React.useState(true);
  const [invalid, setInvalid] = React.useState(false);
  const many = modal.items.length > 1;
  const first = modal.items[0];
  const required = modal.kind === 'decline' || modal.kind === 'hold';
  const chips = modal.kind === 'decline'
    ? ['Budget not available', 'Value above the estimate', 'Supplier shortlist too narrow', 'Documents incomplete']
    : modal.kind === 'hold' ? ['Awaiting revised estimate', 'Need the comparison sheet', 'Confirm budget line with Finance'] : [];

  const confirm = () => {
    if (required && !text.trim()) { setInvalid(true); return; }
    if (modal.kind === 'hold') { actions.hold(first, text.trim(), ask); onDone('', ''); return; }
    if (modal.kind === 'unhold') { actions.release(first, text.trim()); onDone('', ''); return; }
    const outcomes = modal.items.map((item) => actions.decide(item, modal.kind === 'approve' ? 'APPROVED' : 'DECLINED', text.trim()));
    const next = currentHolderAfter(first);
    onDone(
      modal.kind === 'decline'
        ? (many ? `${modal.items.length} requests declined` : `${first.reference} declined`)
        : many ? `${modal.items.length} requests approved`
          : outcomes[0] === 'APPROVED'
            ? first.kind === 'EVENT' ? `${first.reference} approved · released to suppliers` : `${first.reference} approved · award confirmed`
            : `${first.reference} approved · sent to ${next ?? 'the next level'}`,
      modal.kind === 'decline' ? 'x' : 'check',
    );
  };

  const head = {
    approve: { h: 'Approve', p: many ? `Approve these ${modal.items.length} event releases?` : first.kind === 'EVENT' && first.steps.filter((s) => s.decision === 'PENDING').length === 1 ? 'You are the last level. Approving publishes the event and invites its suppliers.' : 'Are you sure you want to approve this request?', btn: 'Approve' },
    decline: { h: 'Decline', p: many ? `Decline ${modal.items.length} requests? ${first.raisedByName} will be notified.` : `${first.raisedByName} will be notified with your reason.${first.kind === 'EVENT' ? ' The event goes back to draft and no supplier is invited.' : ''}`, btn: 'Decline' },
    hold: { h: 'Hold Approval', p: 'The request moves to your Hold tab. You can approve, decline or release it later.', btn: 'Put on Hold' },
    unhold: { h: 'Release Hold', p: 'The request goes back to your Pending queue.', btn: 'Release Hold' },
  }[modal.kind];

  return (
    <EpModal
      title={head.h}
      lead={head.p}
      confirm={head.btn}
      confirmTone={modal.kind === 'decline' ? 'danger' : 'primary'}
      onConfirm={confirm}
      onClose={onClose}
    >
      {many && (
        <div className="mini-list">
          {modal.items.map((i) => <div key={i.key}>{i.reference} · <span style={{ color: 'var(--muted)' }}>{i.title}</span></div>)}
        </div>
      )}
      <div className={`field ${invalid ? 'invalid' : ''}`}>
        <label htmlFor="ep-note">
          {modal.kind === 'decline' ? 'Reason' : modal.kind === 'hold' ? 'Reason for hold' : 'Comment (optional)'}
          {required && <span className="req"> *</span>}
        </label>
        <textarea
          id="ep-note"
          autoFocus
          value={text}
          onChange={(e) => { setText(e.target.value); setInvalid(false); }}
          placeholder={modal.kind === 'approve' ? `A note for ${first.raisedByName} and the next approver` : modal.kind === 'decline' ? 'Why is this request being declined?' : modal.kind === 'hold' ? 'e.g. Awaiting the revised estimate' : 'e.g. Revised estimate received'}
        />
        {invalid && <span className="err">Please add a reason.</span>}
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => <button type="button" key={c} onClick={() => { setText(c); setInvalid(false); }}>{c}</button>)}
        </div>
      )}
      {modal.kind === 'hold' && (
        <div className="field" style={{ marginTop: 14 }}>
          <label><input type="checkbox" className="chk" checked={ask} onChange={(e) => setAsk(e.target.checked)} style={{ verticalAlign: -3, marginRight: 6 }} />Also send this as a clarification to {first.raisedByName}</label>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12 }}>Recorded as {me.name} ({me.role}).</div>
    </EpModal>
  );
}

function currentHolderAfter(item: ApprovalItem): string | null {
  const pending = item.steps.filter((s) => s.decision === 'PENDING' && s.level !== item.currentLevel);
  return pending[0]?.holderName ?? null;
}

/** The approvals list: Team Approvals (Pending / Hold / Completed) or My Approvals. */
export function ApprovalsPage({ page, items, me, onOpen, toast, header }: {
  page: 'team' | 'mine';
  items: ApprovalItem[];
  me: Employee;
  onOpen: (key: string) => void;
  toast: Toast;
  header: React.ReactNode;
}) {
  const actions = useApprovalActions(me, toast);
  const [tab, setTab] = React.useState<'pending' | 'hold' | 'completed' | 'settlement' | 'utility'>('pending');
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState('recv-desc');
  const [kinds, setKinds] = React.useState<Set<ApprovalItem['kind']>>(new Set());
  const [view, setView] = React.useState<'list' | 'cards'>('list');
  const [pop, setPop] = React.useState<'sort' | 'filter' | null>(null);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [modal, setModal] = React.useState<Modal>(null);

  const pendingCount = items.filter((i) => i.status === 'PENDING' && awaiting(i, me.name)).length;
  const holdCount = items.filter((i) => i.status === 'ON_HOLD' && awaiting(i, me.name)).length;
  const base = page === 'mine'
    ? items.filter((i) => i.raisedByName === me.name)
    : tab === 'pending' ? items.filter((i) => i.status === 'PENDING' && awaiting(i, me.name))
      : tab === 'hold' ? items.filter((i) => i.status === 'ON_HOLD' && awaiting(i, me.name))
        : tab === 'completed' ? items.filter((i) => actedBy(i, me.name)) : [];
  const needle = q.trim().toLowerCase();
  const list = base
    .filter((i) => kinds.size === 0 || kinds.has(i.kind))
    .filter((i) => !needle || `${i.reference} ${i.title} ${i.raisedByName} ${KIND_LABEL[i.kind].type}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const [k, d] = sort.split('-');
      const va = k === 'amt' ? a.amount : a.raisedAt;
      const vb = k === 'amt' ? b.amount : b.raisedAt;
      return d === 'desc' ? vb - va : va - vb;
    });
  const placeholderTab = page === 'team' && (tab === 'settlement' || tab === 'utility');
  const selectable = page === 'team' && tab === 'pending';
  const bulkable = list.filter((i) => i.kind === 'EVENT');
  const selected = list.filter((i) => sel.has(i.key));

  const toggle = (key: string) => setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const sortLabel: Record<string, string> = {
    'recv-desc': 'Received · Newest', 'recv-asc': 'Received · Oldest', 'amt-desc': 'Amount · High to low', 'amt-asc': 'Amount · Low to high',
  };

  const exportCsv = () => {
    if (list.length === 0) { toast('Nothing to export', 'info'); return; }
    downloadCsv(`approvals-${page === 'mine' ? 'mine' : tab}.csv`, [
      ['Reference', 'Type', 'Title', 'Amount', 'Currency', 'Asked By', 'Status', 'Received'],
      ...list.map((i) => [i.reference, KIND_LABEL[i.kind].type, i.title, i.amount, i.currency, i.raisedByName, i.status, fDate(i.raisedAt)]),
    ]);
    toast(`Exported ${list.length} request${list.length > 1 ? 's' : ''}`, 'export');
  };

  return (
    <>
      {header}
      {page === 'team' ? (
        <div className="tabs">
          {([['pending', `Pending (${pendingCount})`], ['hold', `Hold (${holdCount})`], ['completed', 'Completed'], ['settlement', 'Settlement Request'], ['utility', 'Utility Request']] as const).map(([k, l]) => (
            <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setSel(new Set()); }}>{l}</button>
          ))}
        </div>
      ) : <div className="tabs" />}
      <div className="toolbar">
        <div className="search"><Icon name="search" size={20} stroke={2.2} /><input aria-label="Search approvals" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button type="button" className="tool" onClick={() => setPop(pop === 'sort' ? null : 'sort')}><Icon name="sort" /> Sort</button>
        <button type="button" className="tool sep" onClick={() => setPop(pop === 'filter' ? null : 'filter')}><Icon name="filter" stroke={2} /> Filter {kinds.size > 0 && <span className="cnt">{kinds.size}</span>}</button>
        <button type="button" className="tool sep" onClick={exportCsv}><Icon name="export" /> Export</button>
        <button type="button" className="tool" onClick={() => setView(view === 'list' ? 'cards' : 'list')}><Icon name={view === 'list' ? 'list' : 'analytics'} /> {view === 'list' ? 'List View' : 'Card View'}</button>
        {pop === 'sort' && (
          <div className="pop" style={{ left: 260 }}>
            {Object.entries(sortLabel).map(([k, l]) => (
              <button type="button" key={k} className={`opt ${sort === k ? 'on' : ''}`} onClick={() => { setSort(k); setPop(null); }}>
                {sort === k ? <Icon name="check" size={14} stroke={2.4} /> : <span style={{ width: 14 }} />}{l}
              </button>
            ))}
          </div>
        )}
        {pop === 'filter' && (
          <div className="pop" style={{ left: 360 }}>
            <div className="ph">Request type</div>
            {(['EVENT', 'AWARD'] as const).map((k) => (
              <label key={k}>
                <input type="checkbox" className="chk" checked={kinds.has(k)} onChange={() => setKinds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                {k === 'EVENT' ? 'Sourcing event release' : 'Award NFA'}
              </label>
            ))}
            <div className="pf">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setKinds(new Set()); setPop(null); }}>Clear</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPop(null)}>Done</button>
            </div>
          </div>
        )}
      </div>

      {selectable && selected.length > 0 && (
        <div className="bulk">
          <b>{selected.length} selected</b>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Bulk actions apply to event releases only — awards are decided one at a time.</span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>Clear</button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setModal({ kind: 'decline', items: selected })}><Icon name="x" size={14} stroke={2.2} /> Decline</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'approve', items: selected })}><Icon name="check" size={14} stroke={2.2} /> Approve selected</button>
        </div>
      )}

      {placeholderTab ? (
        <div className="tbl-empty"><div className="big">No {tab === 'settlement' ? 'settlement' : 'utility'} requests</div>Requests of this kind assigned to you will show up here.</div>
      ) : list.length === 0 ? (
        <div className="tbl-empty">
          <div className="big">{q || kinds.size ? 'No requests match your filters' : page === 'mine' ? 'You have not raised anything for approval' : tab === 'pending' ? 'You are all caught up' : 'Nothing here yet'}</div>
          {page === 'team' && tab === 'pending' && !q && !kinds.size && 'Events submitted for approval in the corporate portal, and award NFAs, appear here when they reach your level.'}
          {(q || kinds.size > 0) && <div><button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { setQ(''); setKinds(new Set()); }}>Clear filters</button></div>}
        </div>
      ) : view === 'cards' ? (
        <div className="cards-view">{list.map((i) => <ApprovalCard key={i.key} item={i} onOpen={onOpen} />)}</div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>
                  {selectable && bulkable.length > 0 && (
                    <input
                      type="checkbox" className="chk" aria-label="Select all event releases"
                      checked={bulkable.every((i) => sel.has(i.key))}
                      onChange={(e) => setSel(e.target.checked ? new Set(bulkable.map((i) => i.key)) : new Set())}
                    />
                  )}
                </th>
                <th>Details</th><th>Amount</th><th>{page === 'team' ? 'Asked By' : 'Current Approver'}</th><th>Status</th><th>Type</th><th>{page === 'team' ? 'Received' : 'Submitted'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const who = page === 'team' ? i.raisedByName : currentHolder(i);
                const unread = i.notes.filter((n) => n.kind === 'CLARIFICATION').at(-1);
                return (
                  <tr key={i.key} onClick={() => onOpen(i.key)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {selectable && (
                        <input
                          type="checkbox" className="chk" aria-label={`Select ${i.reference}`}
                          disabled={i.kind !== 'EVENT'}
                          title={i.kind !== 'EVENT' ? 'Award NFAs are approved one at a time' : undefined}
                          checked={sel.has(i.key)} onChange={() => toggle(i.key)}
                        />
                      )}
                    </td>
                    <td>
                      <div className="det-link">{i.raisedByName} / {i.reference} / {i.title}</div>
                      <div className="det-sub">{KIND_LABEL[i.kind].approval}<br />{levelLine(i)}</div>
                    </td>
                    <td className="nowrap">{amount(i.amount, i.currency)}</td>
                    <td>{who ? <span className="asker"><Avatar name={who} />{who}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>
                      {page === 'team' && tab === 'completed' ? <MyActionChip item={i} me={me} /> : <StatusChip item={i} />}
                      {unread && unread.byName !== me.name && <div className="det-sub" style={{ marginTop: 6, color: 'var(--warn)' }}><Icon name="msg" size={12} /> New clarification</div>}
                    </td>
                    <td className="type-cell">{KIND_LABEL[i.kind].type}</td>
                    <td className="nowrap">{fDate(i.raisedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <DecisionModal
          modal={modal}
          me={me}
          actions={actions}
          onClose={() => setModal(null)}
          onDone={(message, icon) => { setModal(null); setSel(new Set()); if (message) toast(message, icon); }}
        />
      )}
    </>
  );
}

function levelLine(i: ApprovalItem): string {
  const done = i.steps.filter((s) => s.decision === 'APPROVED').length;
  return `Level ${Math.min(done + 1, i.steps.length)} of ${i.steps.length} · ${i.steps.map((s) => s.holderName).join(' → ')}`;
}

function MyActionChip({ item, me }: { item: ApprovalItem; me: Employee }) {
  const mine = actedBy(item, me.name);
  if (!mine) return <StatusChip item={item} />;
  if (mine.decision === 'DECLINED') return <span className="status s-declined">Declined</span>;
  if (item.status === 'APPROVED') return <span className="status s-approved">Approved</span>;
  return (
    <>
      <span className="status s-approved">Approved by you</span>
      {currentHolder(item) && <div className="det-sub" style={{ marginTop: 6 }}>Now with {currentHolder(item)}</div>}
    </>
  );
}

export function ApprovalCard({ item, onOpen }: { item: ApprovalItem; onOpen: (key: string) => void }) {
  return (
    <button type="button" className="pa-card" onClick={() => onOpen(item.key)}>
      <span className="m">{KIND_LABEL[item.kind].approval}</span>
      <span className="t">{item.reference}</span>
      <span className="m">{item.title}</span>
      <span className="asker" style={{ fontSize: 12 }}><Avatar name={item.raisedByName} />{item.raisedByName}</span>
      <span className="foot"><b>{amount(item.amount, item.currency)}</b><StatusChip item={item} /></span>
    </button>
  );
}

/** The request on the left, the approver's panel on the right. */
export function ApprovalDrawer({ item, me, onClose, toast }: {
  item: ApprovalItem;
  me: Employee;
  onClose: () => void;
  toast: Toast;
}) {
  const actions = useApprovalActions(me, toast);
  const [tab, setTab] = React.useState<'approval' | 'timeline' | 'clar'>('approval');
  const [modal, setModal] = React.useState<Modal>(null);
  const canAct = awaiting(item, me.name);
  const mine = actedBy(item, me.name);
  const clar = item.notes.filter((n) => n.kind === 'CLARIFICATION');
  const unread = clar.length > 0 && clar[clar.length - 1].byName !== me.name;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modal) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose, modal]);

  let foot: React.ReactNode = null;
  if (canAct) {
    foot = (
      <>
        <button type="button" className="act act-dec" onClick={() => setModal({ kind: 'decline', items: [item] })}><Icon name="x" size={18} stroke={2} /> Decline</button>
        <button type="button" className="act act-app" onClick={() => setModal({ kind: 'approve', items: [item] })}><Icon name="check" size={18} stroke={2} /> Approve</button>
        {item.status === 'ON_HOLD'
          ? <button type="button" className="act act-hold wide" onClick={() => setModal({ kind: 'unhold', items: [item] })}><Icon name="play" size={16} stroke={2} /> Release Hold</button>
          : <button type="button" className="act act-hold wide" onClick={() => setModal({ kind: 'hold', items: [item] })}>Hold Approval</button>}
      </>
    );
  } else if (mine) {
    foot = (
      <div className={`done-banner note ${mine.decision === 'DECLINED' ? 'bad' : 'ok'}`}>
        <Icon name={mine.decision === 'DECLINED' ? 'x' : 'check'} size={18} stroke={2} />
        <span>You {mine.decision === 'DECLINED' ? 'declined' : 'approved'} this on {fTime(mine.decidedAt)}{currentHolder(item) ? ` · now pending with ${currentHolder(item)}` : ''}</span>
      </div>
    );
  } else if (item.raisedByName === me.name) {
    foot = (
      <div className="done-banner note info">
        <Icon name="info" size={18} />
        <span>{item.status === 'APPROVED' ? 'Fully approved.' : item.status === 'DECLINED' ? 'Declined.' : `Waiting on ${currentHolder(item)} (${item.status === 'ON_HOLD' ? 'on hold' : `level ${item.currentLevel} of ${item.steps.length}`})`}</span>
      </div>
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={item.reference}>
        <div className="d-left">{item.kind === 'EVENT' ? <EventRequest item={item} /> : <AwardRequest item={item} />}</div>
        <div className="d-right">
          <div className="d-right-head">
            <button type="button" className="x-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={30} stroke={2.4} /></button>
            <h3>{canAct || item.raisedByName !== me.name ? 'Approver' : 'Requester'}</h3>
            <div className="sub">{me.email}</div>
            <div className="d-tabs">
              {([['approval', 'Approval'], ['timeline', 'Timeline'], ['clar', 'Clarification']] as const).map(([k, l]) => (
                <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {l}{k === 'clar' && unread && tab !== 'clar' && <span className="pip" />}
                </button>
              ))}
            </div>
          </div>
          <div className="d-body">
            {tab === 'approval' && <ApprovalPanel item={item} me={me} />}
            {tab === 'timeline' && <Timeline item={item} />}
            {tab === 'clar' && <Clarifications item={item} me={me} onSend={(t) => actions.clarify(item, t)} />}
          </div>
          {foot && <div className="d-foot">{foot}</div>}
        </div>
      </div>
      {modal && (
        <DecisionModal
          modal={modal}
          me={me}
          actions={actions}
          onClose={() => setModal(null)}
          onDone={(message, icon) => {
            const kind = modal.kind;
            setModal(null);
            if (message) toast(message, icon);
            if (kind !== 'unhold') onClose();
          }}
        />
      )}
    </>
  );
}

function Kv({ k, v, full }: { k: string; v: React.ReactNode; full?: boolean }) {
  return <div className={`kv ${full ? 'full' : ''}`}><div className="k">{k}</div><div className="v">{v}</div></div>;
}

/** The held event, as the approver needs to judge it: what, from whom, how it will be judged. */
function EventRequest({ item }: { item: ApprovalItem }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === item.eventId);
  if (!event) return <h2>{item.reference}</h2>;
  const lines = lineItemsForEvent(state, event.id);
  const bidders = biddersForEvent(state, event.id);
  const asks = stageEventsOf(state, event.id);
  const terms = termsForEvent(state, event.id);
  const assignments = (asks[0]?.configSnapshotAtPublish?.evaluationStages as StageAssignment[] | undefined) ?? [];
  const total = lines.reduce((a, l) => a + (l.baselinePrice ?? 0) * l.quantity, 0);
  const nameOf = (id: string) => employeeById(id)?.name ?? id;
  return (
    <>
      <h2>{event.eventNumber} / {event.title}</h2>
      {item.status === 'PENDING' || item.status === 'ON_HOLD' ? (
        <div className="note info"><Icon name="info" size={18} /><span>Held as <b>Pending Approval</b>. No supplier has been invited. When the last level approves, the first ask is published and its {bidders.length} supplier{bidders.length === 1 ? '' : 's'} are invited.</span></div>
      ) : item.status === 'APPROVED' ? (
        <div className="note ok"><Icon name="check" size={18} /><span>Approved by every level and released to suppliers.</span></div>
      ) : (
        <div className="note bad"><Icon name="x" size={18} /><span>Declined — the event went back to draft and no supplier was invited.</span></div>
      )}
      <div className="d-sec">Event Details</div>
      <div className="kv-grid">
        <Kv k="Journey" v={JOURNEY_PATTERNS[event.journeyPattern]?.name ?? event.journeyPattern} />
        <Kv k="Side" v={`${event.side === 'BUY' ? 'Buy' : 'Sell'} — ${directionLabel(event.side)}`} />
        <Kv k="Category / BU" v={`${event.category} · ${event.businessUnit}`} />
        <Kv k="Cost Centre" v={event.costCentre ?? '—'} />
        <Kv k="Estimated Value" v={<b>{amount(event.estimatedValue, event.currency)}</b>} />
        <Kv k="Source" v={event.sourceReference ?? 'Raised manually'} />
        {event.description && <Kv k="Description" v={event.description} full />}
      </div>

      <hr className="hr" />
      <div className="d-sec" style={{ marginBottom: 14 }}>Line Items ({lines.length})</div>
      <table className="items">
        <thead><tr><th>Details</th><th>Quantity</th><th>Baseline</th><th>Value</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="l"><div className="nm">{l.description}</div><div className="meta">Item Code: {l.itemCode}{l.specification ? <><br />{l.specification}</> : null}<br />Delivery: {l.deliveryLocation || '—'}</div></td>
              <td>{l.quantity.toLocaleString('en-IN')} {l.uom}</td>
              <td className="r">{l.baselinePrice === null ? '—' : amount(l.baselinePrice, l.currency)}</td>
              <td className="r">{l.baselinePrice === null ? '—' : amount(l.baselinePrice * l.quantity, l.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="total"><span>Estimated Event Value <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(baseline × quantity)</span></span><span>{amount(total || event.estimatedValue, event.currency)}</span></div>

      <hr className="hr" />
      <div className="d-sec">Suppliers to be invited ({bidders.length})</div>
      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
        {bidders.length === 0 ? <span style={{ color: 'var(--muted)' }}>No supplier on the shortlist.</span>
          : bidders.map((b) => COUNTERPARTIES.find((c) => c.id === b.counterpartyId)?.name ?? b.counterpartyId).join(' · ')}
      </div>

      {asks.length > 0 && (
        <>
          <hr className="hr" />
          <div className="d-sec" style={{ marginBottom: 14 }}>Asks and evaluation</div>
          <table className="items">
            <thead><tr><th>Ask</th><th>Window</th><th>Gate</th><th>Evaluators</th></tr></thead>
            <tbody>
              {asks.map((ask) => {
                const stage = ask.currentStage;
                const a = assignments.find((x) => x.stage === stage);
                return (
                  <tr key={ask.id}>
                    <td className="l"><b>{STAGE_LABELS[stage]}</b><div className="meta">{ask.eventNumber}</div></td>
                    <td>{fDate(ask.configSnapshotAtPublish?.opensAt as number | undefined)} → {fDate(ask.closesAt)}</td>
                    <td>{!a ? '—' : a.gate === 'NONE' ? 'No gate' : a.gate === 'PASS_FAIL' ? 'Pass / fail' : `Min ${a.minScore}${a.gate === 'BOTH' ? ' + knockouts' : ''}`}</td>
                    <td className="l">
                      {!a ? '—' : (
                        <>
                          {a.technicalEvaluatorIds.length > 0 && <div>Technical: {a.technicalEvaluatorIds.map(nameOf).join(', ')}</div>}
                          {a.commercialEvaluatorIds.length > 0 && <div>Commercial: {a.commercialEvaluatorIds.map(nameOf).join(', ')}</div>}
                          {a.technicalEvaluatorIds.length + a.commercialEvaluatorIds.length === 0 && '—'}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {terms.length > 0 && (
        <>
          <hr className="hr" />
          <div className="d-sec">Terms</div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>{terms.map((t) => `${t.title} v${t.version}`).join(' · ')}</div>
        </>
      )}
    </>
  );
}

function AwardRequest({ item }: { item: ApprovalItem }) {
  const { state } = useStore();
  const nfa = state.nfas.find((n) => n.id === item.refId);
  const event = state.events.find((e) => e.id === item.eventId);
  if (!nfa || !event) return <h2>{item.reference}</h2>;
  const lines = lineItemsForEvent(state, event.id);
  return (
    <>
      <h2>{event.eventNumber} / Award — {event.title}</h2>
      {nfa.doaUpliftApplied && <div className="note"><Icon name="info" size={18} /><span>Awarding other than rank 1 — the DoA chain was uplifted a level.{nfa.overrideReason ? ` Reason: “${nfa.overrideReason}”` : ''}</span></div>}
      <div className="d-sec">Recommendation</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{nfa.recommendation || '—'}</div>
      <hr className="hr" />
      <div className="kv-grid">
        <Kv k="Award Value" v={<b>{amount(event.estimatedValue, event.currency)}</b>} />
        <Kv k="Category / BU" v={`${event.category} · ${event.businessUnit}`} />
        <Kv k="Comparison Sheet" v={`Version ${nfa.comparisonSheetVersion}`} />
        <Kv k="Raised" v={fTime(nfa.createdAt)} />
        <Kv k="Risk Statement" v={nfa.riskStatement || '—'} full />
        <Kv k="Deviations" v={nfa.deviations.length === 0 ? 'None declared' : <ul style={{ margin: 0, paddingLeft: 16 }}>{nfa.deviations.map((d) => <li key={d}>{d}</li>)}</ul>} full />
      </div>
      <hr className="hr" />
      <div className="d-sec" style={{ marginBottom: 14 }}>Line Items ({lines.length})</div>
      <table className="items">
        <thead><tr><th>Details</th><th>Quantity</th><th>Baseline</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="l"><div className="nm">{l.description}</div><div className="meta">Item Code: {l.itemCode}</div></td>
              <td>{l.quantity.toLocaleString('en-IN')} {l.uom}</td>
              <td className="r">{l.baselinePrice === null ? '—' : amount(l.baselinePrice, l.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ApprovalPanel({ item, me }: { item: ApprovalItem; me: Employee }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === item.eventId);
  const raiser = employeeByName(item.raisedByName);
  const field = (k: string, v: React.ReactNode) => <React.Fragment key={k}><div className="k">{k}</div><div className="v">{v}</div></React.Fragment>;
  return (
    <>
      <div className="rq-label">Requested By</div>
      <div className="rq-card">
        <Avatar name={item.raisedByName} large />
        <div>
          <div className="nm">{item.raisedByName}</div>
          Email : {raiser?.email ?? '—'}<br />Department: {raiser?.dept ?? 'Procurement'}<br />Office: {raiser?.office ?? '—'}
        </div>
        <div className="code">CODE: {raiser?.code ?? '—'}</div>
      </div>
      <div className="r-field" style={{ marginTop: 30 }}>
        <div className="k">{item.kind === 'EVENT' ? 'Event Number' : 'Award For'}</div>
        <div className="v">{item.reference}</div>
      </div>
      <div className="r-section">
        <div className="t">Details</div>
        <div className="s">Details of {item.kind === 'EVENT' ? 'the sourcing event' : 'the award note'}</div>
        <div className="r-list">
          {[
            field('Title', event?.title ?? item.title),
            field('Status on the corporate portal', event?.status.replace(/_/g, ' ').toLowerCase() ?? '—'),
            field('Currency', item.currency),
            field('Amount', amount(item.amount, item.currency)),
            field('Raised By', item.raisedByName),
            field('Raised On', fTime(item.raisedAt)),
          ]}
        </div>
      </div>
      <div className="r-section">
        <div className="t">Approval Flow</div>
        <div className="s">{item.steps.length} level{item.steps.length > 1 ? 's' : ''} · from the DoA matrix</div>
        <div className="chain">
          {item.steps.map((s) => {
            const cur = s.level === item.currentLevel;
            const cls = s.decision === 'APPROVED' ? 'done' : s.decision === 'DECLINED' ? 'dec' : cur ? 'cur' : '';
            return (
              <div key={s.level} className={`lv ${cls}`}>
                <span className="num">{s.decision === 'APPROVED' ? <Icon name="check" size={13} stroke={3} /> : s.level}</span>
                <span>{s.holderName}{s.holderName === me.name ? ' (you)' : ''}<small>{s.role} · SLA {s.slaHours}h</small></span>
                <span className="tag">
                  {s.decision === 'APPROVED' && <span className="status s-approved">Approved</span>}
                  {s.decision === 'DECLINED' && <span className="status s-declined">Declined</span>}
                  {s.decision === 'RETURNED' && <span className="status s-hold">Returned</span>}
                  {cur && s.decision === 'PENDING' && (item.status === 'ON_HOLD' ? <span className="status s-hold">On Hold</span> : <span className="status s-pending">Pending</span>)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface TimelineEntry { st: 'done' | 'current' | 'upcoming' | 'hold' | 'declined' | 'clar'; lbl: string; nm: string; ln: string[]; at: number; note?: string | null }

function Timeline({ item }: { item: ApprovalItem }) {
  const entries: TimelineEntry[] = [{ st: 'done', lbl: 'App Started', nm: `Submitted by ${item.raisedByName}`, ln: ['Type: start', `Sent on : ${fTime(item.raisedAt)}`], at: item.raisedAt }];
  const T = KIND_LABEL[item.kind].type.toUpperCase();
  for (const s of item.steps) {
    if (s.decision === 'PENDING' || !s.decidedAt) continue;
    entries.push({
      st: s.decision === 'DECLINED' ? 'declined' : 'done', lbl: 'Approver', nm: s.holderName,
      ln: [`Type: ${T}`, `Status: ${s.decision}`, `Actioned on : ${fTime(s.decidedAt)}`], at: s.decidedAt, note: s.comment,
    });
  }
  for (const n of item.notes) {
    entries.push({
      st: n.kind === 'HOLD' ? 'hold' : n.kind === 'CLARIFICATION' ? 'clar' : 'done',
      lbl: n.kind === 'HOLD' ? 'Put on Hold' : n.kind === 'UNHOLD' ? 'Hold Released' : 'Clarification',
      nm: n.byName, ln: [`On : ${fTime(n.at)}`], at: n.at, note: n.text,
    });
  }
  entries.sort((a, b) => a.at - b.at);
  const tail: TimelineEntry[] = [];
  if (item.currentLevel !== null) {
    const current = item.steps.find((s) => s.level === item.currentLevel)!;
    tail.push({ st: 'current', lbl: 'Approver', nm: current.holderName, ln: [`Type: ${T}`, `Status: ${item.status === 'ON_HOLD' ? 'ON HOLD' : `${current.role.toUpperCase()} PENDING`}`, `Sent on : ${fTime(entries[entries.length - 1].at)}`], at: Date.now() });
    item.steps.filter((s) => s.level > item.currentLevel!).forEach((s) => tail.push({ st: 'upcoming', lbl: 'Approver', nm: s.holderName, ln: [`Type: ${T}`, 'Status: NOT STARTED'], at: Infinity }));
  }
  const all = [...entries, ...tail];
  return (
    <>
      <div className="tl-title">TIMELINE</div>
      <div className="tl">
        {all.map((t, i) => (
          <div key={i} className={`tl-item ${t.st === 'upcoming' ? 'upcoming' : ''}`}>
            <span className={`tl-dot ${t.st}`}>
              {t.st === 'done' && <Icon name="check" size={13} stroke={3} />}
              {t.st === 'declined' && <Icon name="x" size={13} stroke={3} />}
              {t.st === 'hold' && <Icon name="pause" size={11} stroke={2.5} />}
              {t.st === 'clar' && <Icon name="msg" size={11} stroke={2.5} />}
            </span>
            <div>{t.lbl}</div>
            <div className="nm">{t.nm}</div>
            {t.st !== 'upcoming' && i > 0 && Number.isFinite(t.at) && <span className="tat">TAT: {dur(t.at - all[i - 1].at)}</span>}
            <div>{t.ln.map((l) => <div key={l}>{l}</div>)}</div>
            {t.note && <div className="cmt">“{t.note}”</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function Clarifications({ item, me, onSend }: { item: ApprovalItem; me: Employee; onSend: (text: string) => void }) {
  const [text, setText] = React.useState('');
  const thread = item.notes.filter((n) => n.kind === 'CLARIFICATION');
  const amRequester = item.raisedByName === me.name;
  const to = amRequester ? currentHolder(item) ?? 'the approver' : item.raisedByName;
  const closed = item.status === 'APPROVED' || item.status === 'DECLINED';
  return (
    <div>
      <div className="clar-list">
        {thread.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
            No clarifications yet.<br />
            {amRequester ? 'Approvers can ask you questions about this request here.' : `Ask ${to} for more information before you decide. The request stays in your queue while you wait, and the question shows on the event in the corporate portal.`}
          </div>
        ) : thread.map((c) => (
          <div key={c.id} className={`msg ${c.byName === me.name ? 'me' : ''}`}><div className="h"><b>{c.byName}</b> · {fTime(c.at)}</div>{c.text}</div>
        ))}
      </div>
      {!closed && (
        <div className="composer">
          <div className="to">To: {to} ({amRequester ? 'approver' : 'requester'})</div>
          <textarea aria-label="Clarification" value={text} onChange={(e) => setText(e.target.value)} placeholder={amRequester ? 'Reply to the approver…' : 'e.g. Please share the comparison against last year’s rate'} />
          <div className="row">
            {!amRequester && (
              <div className="chips" style={{ marginRight: 'auto' }}>
                {['Share the revised estimate', 'Why is the shortlist this narrow?', 'Confirm the budget line'].map((c) => <button type="button" key={c} onClick={() => setText(`${c}.`)}>{c}</button>)}
              </div>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => { onSend(text.trim()); setText(''); }}><Icon name="send" size={14} stroke={2} /> Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
