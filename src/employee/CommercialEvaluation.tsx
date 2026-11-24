/**
 * The commercial evaluation workspace — Pack 14, on the Employee Portal beside
 * the technical one.
 *
 * Left, the bidders with their quoted and evaluated totals. Right, one bidder
 * at a time under four tabs: the price schedule as re-computed, the buyer's
 * adjustments with the full calculation trail, the non-price commercial
 * questions, and the flags. A bar along the bottom keeps the running totals and
 * the rank in view whatever tab is open, because the point of every change is
 * what it did to the ranking.
 *
 * Everything shown is computed by `domain/commercialEvaluation`; this file
 * draws it and turns clicks into store actions. The supplier is never shown any
 * of it — the only thing that reaches them is a plain-language question, if the
 * evaluator asks one.
 */
import React from 'react';
import { useStore } from '../store/store';
import { useCommercialModel, type CommercialModel } from '../store/commercialModel';
import {
  BASIS_LABEL, BASIS_NOTE, BASIS_NAME, KIND_LABEL, TREATMENT_LABEL, TREATMENT_NOTE,
  completionChecklist, countedTwice, kindOf, originOf, rankMovement,
  resultRecord, scopeLabel, treatmentOf,
  type BidEvaluation, type CommercialAuditEntry, type CommercialFlag, type ComparisonBasis,
  type FlagAction, type TrailEntry,
} from '../domain/commercialEvaluation';
import {
  repliesTo, requestState, type BuyerRequest, type RequestKind,
} from '../domain/buyerRequests';
import { agentProposal, answerText, latestScore, ruleProposal, type EvaluationTask } from '../domain/employeePortal';
import { employeeById, type Employee } from '../data/employees';
import type { CostComponent, CostComponentKind, Id, Question, Score } from '../domain/types';
import { EpModal, Icon, amount, downloadCsv, fDate, fTime, type Toast } from './employeeUi';

const nameOf = (id: string) => employeeById(id)?.name ?? id.replace(/^consensus:/, '');
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

type Tab = 'schedule' | 'adjustments' | 'scoring' | 'flags';

interface Ctx {
  model: CommercialModel;
  me: Employee;
  toast: Toast;
  bid: BidEvaluation;
  bidderName: string;
  currency: string;
  fmt: (n: number) => string;
  signed: (n: number) => string;
  /** May this person change anything right now? */
  canAct: boolean;
  readOnlyReason: string | null;
  agentsOff: boolean;
  basis: ComparisonBasis;
  setBasis: (next: ComparisonBasis) => void;
  moved: Record<Id, number>;
  /** Write audit rows and move the bidder into review on the first change. */
  record: (entries: Omit<CommercialAuditEntry, 'id' | 'eventId' | 'at' | 'actor'>[]) => CommercialAuditEntry[];
  touch: (bidderId: Id) => void;
  goto: (tab: Tab) => void;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="note bad" style={{ marginTop: 18 }}>
        <Icon name="warn" size={18} />
        <span>
          <b>The commercial evaluation could not be read.</b> Nothing has been changed.
          {' '}<button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
          <span style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{this.state.error.message}</span>
        </span>
      </div>
    );
  }
}

export function CommercialEvaluation(props: { task: EvaluationTask; me: Employee; toast: Toast }) {
  return <Boundary><Workspace {...props} /></Boundary>;
}

function Workspace({ task, me, toast }: { task: EvaluationTask; me: Employee; toast: Toast }) {
  const { state, dispatch } = useStore();
  const [basis, setBasisState] = React.useState<ComparisonBasis>('LANDED');
  const model = useCommercialModel(task, basis);
  const { result } = model;
  const eventId = task.event.id;
  const currency = task.event.currency;
  const fmt = (n: number) => amount(n, currency);
  const signed = (n: number) => `${n < 0 ? '−' : '+'} ${amount(Math.abs(n), currency)}`;

  const [bidderId, setBidderId] = React.useState(model.bidders[0]?.bidder.id ?? '');
  const [tab, setTab] = React.useState<Tab>('schedule');
  const [modal, setModal] = React.useState<'complete' | 'declare' | null>(null);
  const [moved, setMoved] = React.useState<Record<Id, number>>({});

  // Big events take a moment to lay out; say so rather than freeze.
  const heavy = model.lines.length * model.bidders.length > 1_200;
  const [ready, setReady] = React.useState(!heavy);
  React.useEffect(() => {
    if (ready) return undefined;
    const t = window.setTimeout(() => setReady(true), 60);
    return () => window.clearTimeout(t);
  }, [ready]);

  // Ranks that moved because of the last change, shown for a few seconds.
  const ranksKey = result.bids.map((b) => `${b.bidderId}:${b.rank}`).join();
  const previous = React.useRef<Record<Id, number | null> | null>(null);
  React.useEffect(() => {
    const now = Object.fromEntries(result.bids.map((b) => [b.bidderId, b.rank]));
    if (previous.current) {
      const delta = rankMovement(previous.current, result);
      if (Object.keys(delta).length > 0) {
        setMoved(delta);
        const t = window.setTimeout(() => setMoved({}), 9_000);
        previous.current = now;
        return () => window.clearTimeout(t);
      }
    }
    previous.current = now;
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranksKey]);

  const verdict = model.access(me.id, { observer: state.observerMode });
  const declared = state.commercialDeclarations.some((d) => d.eventId === eventId && d.evaluatorId === me.id);
  const readOnly = !verdict.ok || verdict.readOnly;
  const canAct = !readOnly && declared;
  const agentsOff = state.agentKillSwitch.engaged;

  const bid = result.bids.find((b) => b.bidderId === bidderId) ?? result.bids[0];

  const record: Ctx['record'] = (entries) => {
    const full = entries.map((e) => ({ ...e, id: uid('ca'), eventId, at: Date.now(), actor: me.id }));
    return full;
  };
  const touch = (id: Id) => {
    if (state.commercialReviews.some((r) => r.eventId === eventId && r.bidderId === id)) return;
    dispatch({
      type: 'SET_COMMERCIAL_REVIEW',
      review: { eventId, bidderId: id, status: 'IN_REVIEW', by: me.id, at: Date.now() },
      audit: [],
    });
  };
  const setBasis = (next: ComparisonBasis) => {
    if (next === basis) return;
    dispatch({
      type: 'COMMERCIAL_AUDIT',
      entries: record([{
        bidderId: null, action: 'BASIS', subject: 'Comparison basis',
        before: BASIS_LABEL[basis], after: BASIS_LABEL[next], reason: 'Evaluator changed the comparison basis',
      }]),
    });
    setBasisState(next);
  };

  if (model.bidders.length === 0 || !bid) {
    return (
      <div className="placeholder">
        <div className="big">No price to evaluate</div>
        {model.withheld.length > 0
          ? `${model.withheld.length} price${model.withheld.length === 1 ? ' stays' : 's stay'} sealed because the supplier did not clear the technical gate.`
          : 'No supplier has submitted a price on this ask.'}
      </div>
    );
  }

  if (!verdict.ok) {
    return (
      <div className="section-card lock">
        <h3><Icon name="lock" size={16} /> You cannot open the commercial workspace</h3>
        <div className="sub">{verdict.reason}</div>
      </div>
    );
  }

  const reviews = state.commercialReviews.filter((r) => r.eventId === eventId);
  const decisions = state.commercialFlagDecisions.filter((d) => d.eventId === eventId);
  const requests = state.buyerRequests.filter((r) => r.eventId === eventId);
  const checklist = completionChecklist({
    result, flags: model.flags, decisions, reviews, declared,
    openRequests: requests.filter((r) => r.status === 'OPEN').length,
    coverageGaps: model.coverage, bidderIds: model.bidders.map((b) => b.bidder.id), names: model.name,
  });
  const blocked = checklist.find((c) => !c.met && c.blocking);
  const myReview = reviews.find((r) => r.bidderId === bid.bidderId);
  const bidFlags = model.flags.filter((f) => f.bidderId === bid.bidderId || f.bidderId === null);
  const openFlags = bidFlags.filter((f) => f.severity !== 'INFO' && !decisions.some((d) => d.key === f.key));

  const ctx: Ctx = {
    model, me, toast, bid, bidderName: model.name(bid.bidderId), currency, fmt, signed, canAct,
    readOnlyReason: verdict.ok ? verdict.reason ?? null : null, agentsOff, basis, setBasis, moved,
    record, touch, goto: setTab,
  };

  const exportCsv = () => {
    downloadCsv(`commercial-evaluation-${task.event.eventNumber}.csv`, [
      ['Bidder', 'Basis', 'Quoted total', 'Evaluated total', 'Rank', 'Price component', 'Commercial score', 'Knockouts', 'Calculation trail'],
      ...result.bids.map((b) => [
        model.name(b.bidderId), BASIS_LABEL[b.basis], Math.round(b.quotedTotal * 100) / 100,
        Math.round(b.transformed * 100) / 100, b.rank ?? 'not ranked', b.priceComponent ?? '',
        b.commercialScore.score ?? '', b.knockouts.map((k) => k.text).join(' | '),
        b.trail.map((t) => `${t.label} ${Math.round(t.amount * 100) / 100}`).join(' ; '),
      ]),
    ]);
    toast('Exported the commercial evaluation', 'export');
  };

  const complete = () => {
    const at = Date.now();
    dispatch({
      type: 'COMPLETE_COMMERCIAL_EVALUATION',
      result: resultRecord({
        eventId, by: me.id, at, rules: model.rules, hash: model.hash, result, flags: model.flags, decisions,
      }),
      audit: record([{
        bidderId: null, action: 'COMPLETE', subject: 'Commercial evaluation',
        before: 'In progress', after: 'Complete', reason: `Ranked ${result.ranked.length} of ${model.bidders.length} on the ${BASIS_LABEL[basis].toLowerCase()} basis`,
      }]),
    });
    for (const id of task.assignment.commercialEvaluatorIds) {
      dispatch({ type: 'SUBMIT_EVALUATION', submission: { eventId, evaluatorId: id, envelope: 'COMMERCIAL', submittedAt: at } });
    }
    setModal(null);
    toast('Commercial evaluation complete — the comparison sheet is ready', 'check');
  };

  const setReviewed = (status: 'REVIEWED' | 'IN_REVIEW') => {
    dispatch({
      type: 'SET_COMMERCIAL_REVIEW',
      review: { eventId, bidderId: bid.bidderId, status, by: me.id, at: Date.now() },
      audit: record([{
        bidderId: bid.bidderId, action: 'REVIEW', subject: `Review · ${ctx.bidderName}`,
        before: myReview?.status === 'REVIEWED' ? 'Reviewed' : myReview ? 'In review' : 'Not reviewed',
        after: status === 'REVIEWED' ? 'Reviewed' : 'In review',
        reason: status === 'REVIEWED' ? `${openFlags.length} open flag${openFlags.length === 1 ? '' : 's'} at the time` : 'Reopened by the evaluator',
      }]),
    });
    toast(status === 'REVIEWED' ? `${ctx.bidderName} marked as reviewed` : `${ctx.bidderName} reopened`, 'check');
  };

  return (
    <div className="cw-wrap">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
        <span className="tag p" title={BASIS_NOTE[basis]}><Icon name="scale" size={12} />Comparing on the {BASIS_LABEL[basis].toLowerCase()} basis</span>
        <span className="tag" title="Declared with the event and frozen at publish. A change means cancel and relaunch, or a numbered addendum.">
          <Icon name="lock" size={12} />Model locked · #{model.hash}
        </span>
        <span className="tag">
          {model.rules.method === 'QCBS'
            ? `QCBS · technical ${model.rules.technicalWeight}% : price ${100 - model.rules.technicalWeight}%`
            : `L1 · lowest evaluated cost`}
        </span>
        <span className="tag">Cost of capital {model.rules.costOfCapital}% · standard terms {model.rules.standardPaymentDays} days</span>
        <span className="tag">{task.event.side === 'BUY' ? 'Lowest wins' : 'Highest wins'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}><Icon name="export" size={14} /> Export</button>
          <button
            type="button" className="btn btn-primary btn-sm"
            disabled={model.completed || readOnly}
            title={blocked ? `Blocked: ${blocked.label}` : undefined}
            onClick={() => setModal('complete')}
          >
            {model.completed ? 'Commercial evaluation complete' : 'Complete commercial evaluation'}
          </button>
        </span>
      </div>

      {ctx.readOnlyReason && (
        <div className="note info" style={{ marginTop: 14, marginBottom: 0 }}>
          <Icon name="lock" size={18} /><span>{ctx.readOnlyReason}</span>
        </div>
      )}
      {!readOnly && !declared && (
        <div className="note" style={{ marginTop: 14, marginBottom: 0 }}>
          <Icon name="flag" size={18} />
          <span>
            Before you evaluate, declare any conflict of interest with a supplier on this event. It is recorded once.
            {' '}<button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => setModal('declare')}>Sign declaration</button>
          </span>
        </div>
      )}
      {Object.keys(moved).length > 0 && (
        <div className="note ok" style={{ marginTop: 14, marginBottom: 0 }} role="status">
          <Icon name="swap" size={18} />
          <span>
            <b>Ranks moved.</b>{' '}
            {Object.entries(moved).map(([id, d]) => (
              <span key={id} style={{ marginRight: 10 }}>
                {model.name(id)} <span className={`cw-moved ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}</span>
              </span>
            ))}
          </span>
        </div>
      )}

      {!ready ? (
        <div className="cw-card" aria-busy="true" aria-label="Loading prices">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cw-skel" style={{ width: `${95 - i * 9}%` }} />)}
          <div className="sub">Laying out {model.lines.length.toLocaleString('en-IN')} lines across {model.bidders.length} bidders…</div>
        </div>
      ) : (
        <div className="cw">
          <aside className="pane cw-side">
            <div className="pane-h">Bidders · {reviews.filter((r) => r.status === 'REVIEWED').length} of {model.bidders.length} reviewed</div>
            {model.bidders.map(({ bidder, name }) => {
              const b = result.bids.find((x) => x.bidderId === bidder.id)!;
              const review = reviews.find((r) => r.bidderId === bidder.id);
              const flagCount = model.flags.filter((f) => f.bidderId === bidder.id && f.severity !== 'INFO'
                && !decisions.some((d) => d.key === f.key)).length;
              const delta = moved[bidder.id];
              return (
                <button
                  type="button" key={bidder.id}
                  className={`cw-bid ${bidder.id === bid.bidderId ? 'on' : ''} ${b.rank === null ? 'out' : ''}`}
                  onClick={() => setBidderId(bidder.id)}
                  aria-current={bidder.id === bid.bidderId}
                >
                  <div className="cw-name">
                    <span>{name}</span>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      {delta !== undefined && <span className={`cw-moved ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>}
                      <span className={`cw-rank ${b.rank === 1 ? 'one' : b.rank === null ? 'none' : ''}`} title={b.rank === null ? 'Not ranked' : `Rank ${b.rank}`}>
                        {b.rank === null ? '—' : `#${b.rank}`}
                      </span>
                    </span>
                  </div>
                  <div className="cw-kv"><span>Quoted</span><b>{fmt(b.quotedTotal)}</b></div>
                  <div className="cw-kv"><span>Evaluated</span><b>{fmt(b.transformed)}</b></div>
                  <div className="cw-chips">
                    {b.schedule.complete
                      ? <span className="tag g">✓ Complete</span>
                      : <span className="tag w" title="A partial bid is not comparable on total">⚠ {b.schedule.requiredPriced} of {b.schedule.requiredCount} lines</span>}
                    {!b.responsive && <span className="tag r" title={b.knockouts.map((k) => k.text).join('\n')}>✕ Fails a knockout</span>}
                    {flagCount > 0 && <span className="tag w">⚑ {flagCount}</span>}
                    <span className={`tag ${review?.status === 'REVIEWED' ? 'g' : review ? 'p' : ''}`}>
                      {review?.status === 'REVIEWED' ? '✓ Reviewed' : review ? 'In review' : 'Not reviewed'}
                    </span>
                  </div>
                </button>
              );
            })}
            {model.withheld.map(({ bidder, name, reason }) => (
              <div key={bidder.id} className="cw-bid out" style={{ cursor: 'default' }}>
                <div className="cw-name"><span style={{ textDecoration: 'line-through' }}>{name}</span><Icon name="lock" size={13} /></div>
                <div className="cw-kv"><span>Price stays sealed — {reason}</span></div>
              </div>
            ))}
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="box-h">Before you can complete</div>
              {checklist.map((item) => (
                <div key={item.id} className="cw-check" style={{ padding: '3px 0', fontSize: 12 }}>
                  <span className={`ic ${item.met ? 'ok' : item.blocking ? 'no' : 'warn'}`}>{item.met ? '✓' : item.blocking ? '✕' : '!'}</span>
                  <span>{item.label}{!item.met && item.detail && <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>{item.detail}</span>}</span>
                </div>
              ))}
            </div>
          </aside>

          <div style={{ minWidth: 0 }}>
            {!bid.responsive && (
              <div className="note bad" style={{ marginBottom: 12 }}>
                <Icon name="warn" size={18} />
                <span>
                  <b>{ctx.bidderName} is not ranked.</b>{' '}
                  {bid.knockouts.map((k) => k.text).join(' · ')}.{' '}
                  A commercial knockout keeps a bid out of the ranking until it is settled — the bid is not rejected.
                </span>
              </div>
            )}
            <div className="cw-tabs" role="tablist">
              {([
                ['schedule', 'Price schedule', 0],
                ['adjustments', 'Adjustments', bid.proposals.length],
                ['scoring', 'Commercial scoring', 0],
                ['flags', 'Flags', openFlags.length],
              ] as [Tab, string, number][]).map(([key, label, count]) => (
                <button
                  type="button" role="tab" key={key} aria-selected={tab === key} className={tab === key ? 'on' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {count > 0 && <span className={`n ${key === 'flags' && openFlags.some((f) => f.severity === 'BLOCKING') ? 'red' : ''}`}>{count}</span>}
                </button>
              ))}
            </div>
            {tab === 'schedule' && <ScheduleTab ctx={ctx} />}
            {tab === 'adjustments' && <AdjustmentsTab ctx={ctx} />}
            {tab === 'scoring' && <ScoringTab ctx={ctx} />}
            {tab === 'flags' && <FlagsTab ctx={ctx} flags={bidFlags} />}
          </div>
        </div>
      )}

      {/* The persistent bar: what the bidder in front of you currently stands at. */}
      <div className="cw-bar" role="region" aria-label="Running comparison totals">
        <div className="cell"><span className="l">Quoted total</span><span className="v">{fmt(bid.quotedTotal)}</span></div>
        <div className="cell">
          <span className="l">Evaluated · {BASIS_LABEL[basis]}</span>
          <span className="v p">{fmt(bid.transformed)}</span>
        </div>
        <div className="cell">
          <span className="l">Difference</span>
          <span className="v" style={{ color: bid.transformed - bid.quotedTotal < 0 ? 'var(--success)' : undefined }}>{signed(bid.transformed - bid.quotedTotal)}</span>
        </div>
        <div className="cell">
          <span className="l">Rank</span>
          <span className="v">
            {bid.rank === null ? 'Not ranked' : `#${bid.rank} of ${result.ranked.length}`}
            {moved[bid.bidderId] !== undefined && (
              <span className={`cw-moved ${moved[bid.bidderId] > 0 ? 'up' : 'down'}`} style={{ marginLeft: 8 }}>
                {moved[bid.bidderId] > 0 ? '▲' : '▼'} {Math.abs(moved[bid.bidderId])}
              </span>
            )}
          </span>
        </div>
        {bid.combined !== null && (
          <div className="cell"><span className="l">Combined score</span><span className="v">{bid.combined.toFixed(1)}</span></div>
        )}
        <div className="grow" />
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {result.ranked.slice(0, 4).map((b) => `#${b.rank} ${model.name(b.bidderId).split(' ')[0]}`).join('  ·  ')}
        </span>
        {myReview?.status === 'REVIEWED' ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!canAct} onClick={() => setReviewed('IN_REVIEW')}>Reopen review</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={!canAct} onClick={() => setReviewed('REVIEWED')}
            title={!canAct ? 'Sign the declaration first' : undefined}>
            Mark bidder as reviewed
          </button>
        )}
      </div>

      {modal === 'declare' && (
        <EpModal
          title="Conflict-of-interest declaration"
          lead="Before you evaluate prices on this event."
          confirm="I declare no conflict"
          onClose={() => setModal(null)}
          onConfirm={() => {
            dispatch({
              type: 'DECLARE_NO_CONFLICT',
              declaration: { eventId, evaluatorId: me.id, at: Date.now() },
              audit: record([{
                bidderId: null, action: 'DECLARE', subject: 'Conflict-of-interest declaration',
                before: null, after: 'No conflict declared', reason: `Signed by ${me.name}`,
              }]),
            });
            setModal(null);
            toast('Declaration recorded', 'check');
          }}
        >
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            I have no financial, family or business relationship with any supplier that has bid on this event, and I
            have not been approached about it. If that changes I will say so and step aside. This declaration is
            recorded with my name and the time.
          </div>
        </EpModal>
      )}

      {modal === 'complete' && (
        <EpModal
          wide
          title="Complete the commercial evaluation?"
          lead={`This freezes the evaluated totals and unlocks the comparison sheet. It cannot be undone.`}
          confirm="Complete evaluation"
          confirmDisabled={Boolean(blocked)}
          onClose={() => setModal(null)}
          onConfirm={complete}
        >
          {checklist.map((item) => (
            <div key={item.id} className="cw-check">
              <span className={`ic ${item.met ? 'ok' : item.blocking ? 'no' : 'warn'}`}>{item.met ? '✓' : item.blocking ? '✕' : '!'}</span>
              <span>
                {item.label}
                {!item.met && !item.blocking && <span style={{ color: 'var(--warn)' }}> — a warning, not a blocker</span>}
                {item.detail && !item.met && <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{item.detail}</span>}
              </span>
            </div>
          ))}
          <table className="cw-table" style={{ marginTop: 14 }}>
            <thead><tr><th>Rank</th><th>Bidder</th><th className="r">Quoted</th><th className="r">Evaluated</th></tr></thead>
            <tbody>
              {result.ranked.map((b) => (
                <tr key={b.bidderId}><td>#{b.rank}</td><td>{model.name(b.bidderId)}</td><td className="r">{fmt(b.quotedTotal)}</td><td className="r"><b>{fmt(b.transformed)}</b></td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            Model #{model.hash} · {BASIS_LABEL[basis]} basis · {model.rules.method === 'QCBS' ? 'QCBS' : 'L1'}.
            Not ranked: {result.bids.filter((b) => b.rank === null).map((b) => model.name(b.bidderId)).join(', ') || 'none'}.
          </div>
        </EpModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price schedule
// ---------------------------------------------------------------------------

function ScheduleTab({ ctx }: { ctx: Ctx }) {
  const { bid, fmt, currency, model, basis } = ctx;
  const s = bid.schedule;
  const [all, setAll] = React.useState(false);
  const shown = all ? s.lines : s.lines.slice(0, 100);
  const foreign = s.lines.find((l) => l.fx !== null)?.fx ?? null;
  const unitFactors = s.lines.filter((l) => l.priced && l.quoted && l.quoted.uomFactor !== 1);
  const SRC: Record<string, string> = { ON_BEHALF: 'on behalf', EXTRACTED: 'from document' };

  return (
    <>
      <div className="cw-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h4>Comparison basis</h4>
            <div className="sub" style={{ marginBottom: 0 }}>{BASIS_NOTE[basis]}</div>
          </div>
          <div className="cw-seg" role="group" aria-label="Comparison basis">
            {(['GROSS', 'NET', 'LANDED'] as ComparisonBasis[]).map((b) => (
              <button type="button" key={b} className={b === basis ? 'on' : ''} aria-pressed={b === basis} onClick={() => ctx.setBasis(b)}
                disabled={!ctx.canAct}>
                {BASIS_LABEL[b].toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="cw-norm">
          <div>
            <b>Currency</b>
            {foreign ? (
              <>Quoted in <strong>{s.currencies.find((c) => c !== currency)}</strong>. Converted at <strong>{foreign.rate} {currency}</strong> per {foreign.currency}
                {' '}— {foreign.source}, frozen {fDate(foreign.frozenAt)}. Every line shows the figure as typed and as converted.</>
            ) : s.fxMissing ? (
              <span className="bad" style={{ color: 'var(--danger)' }}>Quoted in a currency with no frozen rate. The bid cannot be compared until one is set.</span>
            ) : `Quoted in ${currency} — nothing is converted.`}
          </div>
          <div>
            <b>Unit of measure</b>
            {unitFactors.length === 0
              ? 'Every line is priced in the unit asked for.'
              : unitFactors.map((l) => `${l.itemCode}: ${l.quoted!.uom}, factor ${l.quoted!.uomFactor} → per ${l.uom}`).join(' · ')}
          </div>
          <div>
            <b>Tax treatment</b>
            {bid.terms.taxProfile === 'COMPOSITION'
              ? 'Composition dealer: no GST is charged, the price is read as all-in, and nothing in it can be claimed back.'
              : <>GST charged {fmt(s.tax)}. <strong>Recoverable {fmt(s.creditableTax)}</strong> is {basis === 'LANDED' ? 'left out' : 'not part of this basis'};
                {' '}<strong>non-recoverable {fmt(s.nonCreditableTax)}</strong> is {basis === 'LANDED' ? 'counted as cost' : 'not counted on this basis'}.</>}
          </div>
          <div>
            <b>Offer terms</b>
            Valid {bid.terms.validityDays ?? '—'} days · payment {bid.terms.paymentDays ?? '—'} days · {bid.terms.delivery === 'EX_WORKS' ? 'ex-works' : 'delivered'}
            {bid.terms.escalationPct > 0 ? ` · escalation ${bid.terms.escalationPct}%` : ''}
          </div>
        </div>
      </div>

      <div className="cw-card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h4>Price schedule — {ctx.bidderName}</h4>
          <div className="sub">
            The unit price governs. Where a supplier’s own extended value disagrees, it is shown and the unit price is used.
          </div>
        </div>
        <div className="cw-scroll">
          <table className="cw-table">
            <thead>
              <tr>
                <th>№</th><th className="cw-sticky" style={{ minWidth: 200 }}>Item</th><th className="r">Qty</th><th>UoM</th>
                <th className="r">Unit price</th><th className="r">Discount</th><th className="r">Freight</th><th className="r">Tax</th>
                <th className="r">Extended</th><th className="r">Lead time</th><th className="r">MOQ</th><th className="r">Valid</th>
                <th>Alternate offer</th><th style={{ minWidth: 180 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <React.Fragment key={l.lineItemId}>
                  {!l.priced ? (
                    <tr className="miss">
                      <td>{l.lineNumber}</td>
                      <td className="cw-sticky" style={{ background: 'var(--warn-bg)' }}>{l.description}<span className="sub">{l.itemCode}</span></td>
                      <td className="r">{l.qty.toLocaleString('en-IN')}</td><td>{l.uom}</td>
                      <td colSpan={10}>
                        <span className="tag w">Not offered</span>{' '}
                        {l.optional ? 'Optional line — left out of the total.' : 'Left out of the total, and the bid cannot be ranked on it.'}
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>{l.lineNumber}</td>
                      <td className="cw-sticky">{l.description}<span className="sub">{l.itemCode}</span></td>
                      <td className="r">{l.qty.toLocaleString('en-IN')}</td><td>{l.uom}</td>
                      <td className="r">
                        {l.quoted && l.quoted.currency !== currency
                          ? <>{l.quoted.currency} {l.quoted.unitPrice.toFixed(4)}<span className="sub">= {fmt(l.unitPrice)} @ {l.fx?.rate}</span></>
                          : fmt(l.unitPrice)}
                        {l.quoted && l.quoted.uomFactor !== 1 && <span className="sub">per {l.quoted.uom} ÷ {l.quoted.uomFactor}</span>}
                      </td>
                      <td className="r">{l.discountPct > 0 ? <>{l.discountPct}%<span className="sub">−{fmt(l.discount)}</span></> : '—'}</td>
                      <td className="r">{l.freight > 0 ? fmt(l.freight) : '—'}</td>
                      <td className="r">{l.tax > 0 ? <>{fmt(l.tax)}<span className="sub">{l.taxRate}%{l.nonCreditableTax > 0 ? ' · not reclaimable' : ''}</span></> : '—'}</td>
                      <td className="r">
                        {fmt(l.net)}
                        {l.arithmeticGap !== 0 && (
                          <span className="sub bad" title="The supplier’s own extended value disagrees with unit price × quantity">
                            supplier wrote {fmt(l.suppliedExtended ?? 0)}
                          </span>
                        )}
                      </td>
                      <td className="r">{l.leadTimeDays !== null ? `${l.leadTimeDays} d` : '—'}</td>
                      <td className="r">{l.moq ?? '—'}</td>
                      <td className="r">{l.validityDays !== null ? `${l.validityDays} d` : '—'}</td>
                      <td>{l.alternate ? <span className="tag">has alternate</span> : '—'}</td>
                      <td>
                        {l.source !== 'PORTAL' && (
                          <span className="tag p" title="Carried from the responses review">{SRC[l.source]}</span>
                        )}{' '}
                        {l.notes ?? ''}
                      </td>
                    </tr>
                  )}
                  {l.alternate && (
                    <tr className="alt">
                      <td />
                      <td className="cw-sticky" style={{ background: '#FAFAFD' }}>↳ Alternate offer</td>
                      <td colSpan={3}>{l.alternate.note}</td>
                      <td className="r">{fmt(l.alternate.unitPrice)}</td>
                      <td colSpan={9}>Shown beneath the compliant offer. Not ranked, not in the total.</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="tot"><td colSpan={8}>Quoted subtotal (net of discount)</td><td className="r">{fmt(s.net)}</td><td colSpan={5} /></tr>
              {s.freight > 0 && <tr className="tot"><td colSpan={8}>Freight charged by the supplier</td><td className="r">{fmt(s.freight)}</td><td colSpan={5} /></tr>}
              <tr className="tot"><td colSpan={8}>Tax</td><td className="r">{fmt(s.tax)}</td><td colSpan={5} /></tr>
              <tr className="tot"><td colSpan={8}>Quoted total</td><td className="r">{fmt(s.quotedTotal)}</td><td colSpan={5} /></tr>
              <tr className="tot"><td colSpan={8}>On the {BASIS_LABEL[basis].toLowerCase()} basis, before adjustments</td><td className="r">{fmt(bid.basisValue)}</td><td colSpan={5} /></tr>
            </tfoot>
          </table>
        </div>
        {s.lines.length > 100 && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
              {all ? 'Show the first 100 lines' : `Show all ${s.lines.length.toLocaleString('en-IN')} lines`}
            </button>
          </div>
        )}
      </div>
      {model.lines.length === 0 && <div className="placeholder">This event has no line items.</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Adjustments — the transformation panel
// ---------------------------------------------------------------------------

const ORIGIN_LABEL = { MANUAL: 'manual', MASTER: 'master data', AGENT: 'agent-proposed', RULE: 'rule' } as const;

function Trail({ ctx, entries }: { ctx: Ctx; entries: TrailEntry[] }) {
  const [open, setOpen] = React.useState(true);
  const moving = entries.filter((e) => e.kind === 'ADJUSTMENT' || e.kind === 'RULE' || e.kind === 'BASIS');
  const quoted = entries[0];
  const result = entries[entries.length - 1];
  const row = (e: TrailEntry) => (
    <div key={e.id} className={`tr ${e.kind === 'RESULT' ? 'res' : e.kind === 'QUOTED' ? 'head' : e.amount < 0 ? 'neg' : 'pos'}`}>
      <span>{e.label}</span>
      <span className="d">{e.detail}</span>
      <span className="o">{e.origin ? <span className="tag">{ORIGIN_LABEL[e.origin]}</span> : null}</span>
      <span className="a">{e.kind === 'QUOTED' || e.kind === 'RESULT' ? ctx.fmt(e.amount) : ctx.signed(e.amount)}</span>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {moving.length} step{moving.length === 1 ? '' : 's'} moved this number from the quote to the evaluated total
        </span>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Collapse trail' : 'Expand trail'}
        </button>
      </div>
      <div className="cw-trail" role="table" aria-label="Calculation trail">
        {open ? entries.map(row) : (
          <>
            {row(quoted)}
            <div className="tr fold"><span>{moving.length} steps</span><span className="d">{moving.map((m) => m.label.replace(/^[+−] /, '')).join(' · ')}</span><span /><span className="a">{ctx.signed(result.amount - quoted.amount)}</span></div>
            {row(result)}
          </>
        )}
      </div>
    </div>
  );
}

function valueText(component: CostComponent, raw: number, fmt: (n: number) => string) {
  return component.basis === 'PERCENTAGE' ? `${raw}%` : fmt(raw);
}

function AdjustmentsTab({ ctx }: { ctx: Ctx }) {
  const { state, dispatch } = useStore();
  const { model, bid, fmt } = ctx;
  const bidderId = bid.bidderId;
  const [form, setForm] = React.useState<{ mode: 'add' | 'edit' | 'override' | 'apply' | 'remove'; component?: CostComponent } | null>(null);
  const [showLog, setShowLog] = React.useState(false);

  const mine = model.components.filter((c) => c.valueByBidder[bidderId] !== undefined && kindOf(c) !== 'PAYMENT_TERMS');
  const superseded = model.components.filter((c) => c.valueByBidder[bidderId] !== undefined && kindOf(c) === 'PAYMENT_TERMS');
  const notSet = model.components.filter((c) => c.valueByBidder[bidderId] === undefined && kindOf(c) !== 'PAYMENT_TERMS');
  const pay = bid.trail.find((t) => t.id === 'payment-terms');
  const log = state.commercialAudit.filter((e) => e.eventId === model.task.event.id && (e.bidderId === bidderId || e.bidderId === null)).slice().reverse();
  const hiddenProposals = ctx.agentsOff ? mine.filter((c) => originOf(c, bidderId) === 'AGENT').length : 0;
  const lotNames = Object.fromEntries(state.lots.map((l) => [l.id, l.name]));

  const accept = (component: CostComponent) => {
    const next: CostComponent = { ...component, valueOrigin: { ...(component.valueOrigin ?? {}), [bidderId]: 'MASTER' } };
    const raw = component.valueByBidder[bidderId];
    dispatch({
      type: 'UPSERT_COST_COMPONENT', component: next,
      audit: ctx.record([{
        bidderId, action: 'ACCEPT', subject: `${component.name} · ${ctx.bidderName}`,
        before: `proposed ${valueText(component, raw, fmt)}`, after: `accepted ${valueText(component, raw, fmt)}`,
        reason: `Accepted the proposal derived from ${component.source}`,
      }]),
    });
    ctx.touch(bidderId);
    ctx.toast(`${component.name} accepted for ${ctx.bidderName}`, 'check');
  };

  const row = (component: CostComponent) => {
    const origin = originOf(component, bidderId);
    const raw = component.valueByBidder[bidderId];
    const proposal = origin === 'AGENT';
    if (proposal && ctx.agentsOff) return null;
    const amountNow = proposal
      ? bid.proposals.find((p) => p.componentId === component.id)?.amount ?? 0
      : bid.trail.find((t) => t.componentId === component.id)?.amount ?? 0;
    return (
      <div key={component.id} className={`cw-row ${proposal ? 'prop' : ''}`}>
        <div>
          <b>{component.name}</b>
          <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            <span className="tag">{KIND_LABEL[kindOf(component)]}</span>
            {proposal && <span className="tag p"><Icon name="sparkle" size={11} /> proposal — not applied</span>}
          </div>
          {proposal && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Derived from: {component.source}</div>}
          {component.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{component.note}</div>}
        </div>
        <span>{BASIS_NAME[component.basis]}</span>
        <span title={scopeLabel(component, lotNames)}>{scopeLabel(component, lotNames)}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{valueText(component, raw, fmt)}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: proposal ? 'var(--muted)' : undefined }}>
          {proposal ? `would be ${ctx.signed(amountNow)}` : ctx.signed(amountNow)}
        </span>
        <span><span className={`tag ${proposal ? 'p' : origin === 'MASTER' ? 'g' : ''}`}>{ORIGIN_LABEL[origin]}</span></span>
        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {proposal ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={!ctx.canAct} onClick={() => accept(component)}>Accept</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setForm({ mode: 'override', component })}>Override</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setForm({ mode: 'edit', component })}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setForm({ mode: 'remove', component })} aria-label={`Remove ${component.name}`}>Remove</button>
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      {model.coverage.length > 0 && (
        <div className="note" style={{ marginTop: 14, marginBottom: 0 }} role="alert">
          <Icon name="warn" size={18} />
          <span>
            <b>Applied unevenly.</b> A component set for some bidders and not others ranks them on different bases — the commonest source of an unfair comparison.
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {model.coverage.map((g) => (
                <li key={g.componentId}>
                  <b>{g.component}</b> is applied to {g.appliedTo.map(model.name).join(', ')} but not {g.missing.map(model.name).join(', ')}.
                </li>
              ))}
            </ul>
          </span>
        </div>
      )}

      <div className="cw-card">
        <h4>Calculation trail — {ctx.bidderName}</h4>
        <div className="sub">
          Every component that moved this bidder’s number, so a buyer can see it and an approver can audit it later.
          The supplier never sees any of it.
        </div>
        <Trail ctx={ctx} entries={bid.trail} />
      </div>

      <div className="cw-card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h4>Components applied to {ctx.bidderName}</h4>
            <div className="sub" style={{ marginBottom: 0 }}>A component can be set for this bidder alone, or applied to everyone in one step.</div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ctx.canAct} onClick={() => setForm({ mode: 'add' })}>
            <Icon name="plus" size={14} /> Add component
          </button>
        </div>
        <div className="cw-row head"><span>Component</span><span>Basis</span><span>Scope</span><span>Value</span><span>Adjustment</span><span>Source</span><span /></div>
        {pay && (
          <div className="cw-row">
            <div>
              <b>Payment-term financing impact</b>
              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}><span className="tag">{KIND_LABEL.PAYMENT_TERMS}</span><span className="tag"><Icon name="lock" size={11} /> computed</span></div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                From the days offered ({bid.terms.paymentDays}) against the declared standard ({model.rules.standardPaymentDays}) at {model.rules.costOfCapital}% a year. Declared with the event, so it is not edited here.
              </div>
            </div>
            <span>rule</span><span>Whole bid</span><span>{bid.terms.paymentDays} d</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{ctx.signed(pay.amount)}</span>
            <span><span className="tag">rule</span></span><span />
          </div>
        )}
        {mine.map(row)}
        {superseded.map((c) => (
          <div key={c.id} className="cw-row dim">
            <div><b>{c.name}</b><div style={{ fontSize: 11, marginTop: 3 }}>Replaced by the computed payment-term impact above, so it is not counted twice.</div></div>
            <span>—</span><span>—</span><span>—</span><span>—</span><span><span className="tag">superseded</span></span><span />
          </div>
        ))}
        {mine.length === 0 && !pay && (
          <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No components for {ctx.bidderName}. The evaluated total is the quote on the {BASIS_LABEL[ctx.basis].toLowerCase()} basis.
          </div>
        )}
        {hiddenProposals > 0 && (
          <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
            Agent assistance is off, so {hiddenProposals} proposal{hiddenProposals === 1 ? ' is' : 's are'} not offered. Enter values by hand with “Add component”.
          </div>
        )}
        {notSet.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
            <div className="box-h">Applied to other bidders, not to {ctx.bidderName}</div>
            {notSet.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{c.name}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setForm({ mode: 'apply', component: c })}>Apply</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!ctx.agentsOff && model.components.some((c) => originOf(c, bidderId) === 'AGENT') && (
        <div className="agent" style={{ marginTop: 14 }}>
          <b><Icon name="sparkle" size={13} /> Commercial normalisation agent · Suggest</b>
          <div style={{ marginTop: 4 }}>
            Proposals come from master data — standard freight lanes, duty by origin, the tenant’s cost of capital.
            Each is accepted or overridden on its own; none is applied wholesale. The agent can adjust the buyer-side
            figure only and cannot touch a supplier’s quoted number.
          </div>
        </div>
      )}
      {ctx.agentsOff && (
        <div className="note" style={{ marginTop: 14, marginBottom: 0 }}>
          <Icon name="info" size={18} /><span>Agent assistance is off for this tenant. This screen works the same without it — every value is entered and confirmed by a person.</span>
        </div>
      )}

      <div className="cw-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h4>Change log</h4><div className="sub" style={{ marginBottom: 0 }}>{log.length} entr{log.length === 1 ? 'y' : 'ies'} · actor, before, after and reason</div></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'}</button>
        </div>
        {showLog && (
          <div className="cw-log" style={{ marginTop: 10 }}>
            {log.length === 0 && <div style={{ padding: 10, color: 'var(--muted)' }}>Nothing has been changed yet.</div>}
            {log.map((e) => (
              <div key={e.id} className="e">
                <span className="m">{fTime(e.at)}</span>
                <span><b>{nameOf(e.actor)}</b><br /><span className="tag">{e.action.toLowerCase()}</span></span>
                <span>
                  {e.subject}{e.before !== null || e.after !== null ? <>: <span className="m">{e.before ?? '—'}</span> → <b>{e.after ?? '—'}</b></> : null}
                  <span className="m" style={{ display: 'block' }}>Reason: {e.reason}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && <ComponentModal ctx={ctx} form={form} onClose={() => setForm(null)} />}
    </>
  );
}

function ComponentModal({ ctx, form, onClose }: {
  ctx: Ctx;
  form: { mode: 'add' | 'edit' | 'override' | 'apply' | 'remove'; component?: CostComponent };
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const { model, bid, fmt } = ctx;
  const bidderId = bid.bidderId;
  const existing = form.component;
  const lots = state.lots.filter((l) => model.lines.some((x) => x.lotId === l.id));
  const [kind, setKind] = React.useState<CostComponentKind>(existing ? kindOf(existing) : 'FREIGHT');
  const [name, setName] = React.useState(existing?.name ?? KIND_LABEL.FREIGHT);
  const [basis, setBasis] = React.useState<CostComponent['basis']>(existing?.basis ?? 'LUMP_SUM');
  const [scopeType, setScopeType] = React.useState<'BID' | 'LOT' | 'LINES'>(existing?.scope?.type ?? 'BID');
  const [scopeIds, setScopeIds] = React.useState<string[]>(existing?.scope?.ids ?? []);
  const [value, setValue] = React.useState(existing?.valueByBidder[bidderId] !== undefined ? String(existing.valueByBidder[bidderId]) : '');
  const [applyAll, setApplyAll] = React.useState(false);
  const [removeAll, setRemoveAll] = React.useState(false);
  const [note, setNote] = React.useState(existing?.note ?? '');
  const [reason, setReason] = React.useState('');
  const everyone = model.bidders.map((b) => b.bidder.id);
  const lotNames = Object.fromEntries(state.lots.map((l) => [l.id, l.name]));
  const num = Number(value);
  const valid = form.mode === 'remove'
    ? reason.trim().length >= 3
    : value.trim() !== '' && Number.isFinite(num) && reason.trim().length >= 3 && name.trim().length > 0
      && (scopeType === 'BID' || scopeIds.length > 0);

  const titles = {
    add: 'Add a cost component', edit: `Edit ${existing?.name}`, override: `Override the proposed ${existing?.name}`,
    apply: `Apply ${existing?.name} to ${ctx.bidderName}`, remove: `Remove ${existing?.name}`,
  };
  const describe = (c: CostComponent | undefined, b: Id) => (c && c.valueByBidder[b] !== undefined
    ? `${valueText(c, c.valueByBidder[b], fmt)} · ${BASIS_NAME[c.basis]} · ${scopeLabel(c, lotNames)}` : null);

  const confirm = () => {
    if (form.mode === 'remove' && existing) {
      const targets = removeAll ? Object.keys(existing.valueByBidder) : [bidderId];
      const remaining = { ...existing.valueByBidder };
      const origin = { ...(existing.valueOrigin ?? {}) };
      for (const t of targets) { delete remaining[t]; delete origin[t]; }
      const audit = ctx.record(targets.map((t) => ({
        bidderId: t, action: 'REMOVE' as const, subject: `${existing.name} · ${model.name(t)}`,
        before: describe(existing, t), after: null, reason: reason.trim(),
      })));
      dispatch(Object.keys(remaining).length === 0
        ? { type: 'REMOVE_COST_COMPONENT', componentId: existing.id, audit }
        : { type: 'UPSERT_COST_COMPONENT', component: { ...existing, valueByBidder: remaining, valueOrigin: origin }, audit });
      ctx.touch(bidderId);
      ctx.toast(`${existing.name} removed`, 'check');
      onClose();
      return;
    }
    const targets = applyAll ? everyone : [bidderId];
    const base: CostComponent = existing
      ? { ...existing }
      : {
        id: uid('cc'), eventId: model.task.event.id, name: name.trim(), basis, valueByBidder: {},
        source: 'Entered by the commercial evaluator', agentProposed: false,
      };
    const next: CostComponent = {
      ...base, name: name.trim(), basis, kind, note: note.trim() || undefined,
      scope: scopeType === 'BID' ? undefined : { type: scopeType, ids: scopeIds },
      valueByBidder: { ...base.valueByBidder }, valueOrigin: { ...(base.valueOrigin ?? {}) },
    };
    const entries = targets.map((t) => {
      const before = describe(existing, t);
      next.valueByBidder[t] = num;
      next.valueOrigin![t] = 'MANUAL';
      return {
        bidderId: t,
        action: (form.mode === 'override' ? 'OVERRIDE' : before === null ? 'ADD' : 'CHANGE') as CommercialAuditEntry['action'],
        subject: `${next.name} · ${model.name(t)}`,
        before: form.mode === 'override' && existing ? `proposed ${valueText(existing, existing.valueByBidder[t], fmt)}` : before,
        after: describe(next, t), reason: reason.trim(),
      };
    });
    dispatch({ type: 'UPSERT_COST_COMPONENT', component: next, audit: ctx.record(entries) });
    ctx.touch(bidderId);
    ctx.toast(applyAll ? `${next.name} applied to all ${everyone.length} bidders` : `${next.name} saved for ${ctx.bidderName}`, 'check');
    onClose();
  };

  return (
    <EpModal
      wide title={titles[form.mode]}
      lead={form.mode === 'remove' ? undefined : `Changes the evaluated total and may move ranks. Logged with your name, the before and after, and your reason.`}
      confirm={form.mode === 'remove' ? 'Remove' : 'Save'} confirmTone={form.mode === 'remove' ? 'danger' : 'primary'}
      confirmDisabled={!valid} onClose={onClose} onConfirm={confirm}
    >
      {form.mode === 'remove' ? (
        <>
          <div className="field">
            <label>Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this component no longer applies" />
          </div>
          {existing && Object.keys(existing.valueByBidder).length > 1 && (
            <label style={{ display: 'flex', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={removeAll} onChange={(e) => setRemoveAll(e.target.checked)} /> Remove it from every bidder, not just {ctx.bidderName}
            </label>
          )}
        </>
      ) : (
        <>
          {form.mode === 'add' && (
            <div className="field">
              <label>Type</label>
              <select value={kind} onChange={(e) => { const k = e.target.value as CostComponentKind; setKind(k); setName(KIND_LABEL[k]); }}>
                {(Object.keys(KIND_LABEL) as CostComponentKind[]).filter((k) => k !== 'PAYMENT_TERMS').map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Payment-term financing is not listed: it is computed from the days offered.</span>
            </div>
          )}
          {(form.mode === 'add' || form.mode === 'edit') && (
            <div className="field"><label>Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <label>Basis</label>
              <select value={basis} onChange={(e) => setBasis(e.target.value as CostComponent['basis'])} disabled={form.mode === 'override'}>
                <option value="PER_UNIT">Per unit</option><option value="PER_LINE">Per line</option>
                <option value="PERCENTAGE">Percentage</option><option value="LUMP_SUM">Lump sum</option>
              </select>
            </div>
            <div className="field">
              <label>Value for {ctx.bidderName} {basis === 'PERCENTAGE' ? '(%)' : `(${ctx.currency})`}</label>
              <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>A negative value is a credit.</span>
            </div>
          </div>
          <div className="field">
            <label>Applies to</label>
            <select value={scopeType} onChange={(e) => { setScopeType(e.target.value as 'BID' | 'LOT' | 'LINES'); setScopeIds([]); }}>
              <option value="BID">The whole bid</option><option value="LOT">A lot</option><option value="LINES">Named lines</option>
            </select>
            {scopeType === 'LOT' && (
              <div className="cw-pickline">{lots.map((l) => (
                <label key={l.id}><input type="checkbox" checked={scopeIds.includes(l.id)} onChange={() => setScopeIds(scopeIds.includes(l.id) ? scopeIds.filter((x) => x !== l.id) : [...scopeIds, l.id])} />{l.name}</label>
              ))}</div>
            )}
            {scopeType === 'LINES' && (
              <div className="cw-pickline">{model.lines.slice(0, 200).map((l) => (
                <label key={l.id}><input type="checkbox" checked={scopeIds.includes(l.id)} onChange={() => setScopeIds(scopeIds.includes(l.id) ? scopeIds.filter((x) => x !== l.id) : [...scopeIds, l.id])} />{l.itemCode} — {l.description}</label>
              ))}</div>
            )}
          </div>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            Apply this value to all {everyone.length} bidders at once
          </label>
          <div className="field"><label>Note</label><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — what this covers" /></div>
          <div className="field">
            <label>Reason for the change</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required — it is shown to an approver" aria-label="Reason for the change" />
          </div>
        </>
      )}
    </EpModal>
  );
}

// ---------------------------------------------------------------------------
// Commercial scoring — non-price questions only
// ---------------------------------------------------------------------------

function ScoringTab({ ctx }: { ctx: Ctx }) {
  const { state } = useStore();
  const { model, bid } = ctx;
  const response = model.responses.find((r) => r.bidderId === bid.bidderId);
  const cs = bid.commercialScore;
  const scored = model.commercial.filter((q) => treatmentOf(q) !== 'PRICE');

  return (
    <>
      <div className="cw-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Commercial terms score</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--primary)' }}>
              {cs.score === null ? '—' : cs.score.toFixed(1)}<span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> / 100</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, flex: 1, minWidth: 240 }}>
            {cs.scored} of {cs.total} scored question{cs.total === 1 ? '' : 's'}. <b>Price is not part of this score</b> — it becomes a score once,
            in the award formula, so it cannot be counted twice. Evaluated cost: {ctx.fmt(bid.transformed)}.
          </div>
        </div>
      </div>
      {scored.length === 0 && <div className="placeholder">This event asked no commercial questions beyond the price schedule.</div>}
      {model.commercial.filter((q) => treatmentOf(q) === 'PRICE').map((q) => (
        <div key={q.id} className="cw-card">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="tag">{q.code}</span><span className="tag">{TREATMENT_LABEL.PRICE}</span></div>
          <h4 style={{ marginTop: 6 }}>{q.title}</h4>
          <div className="sub" style={{ marginBottom: 0 }}>{TREATMENT_NOTE.PRICE}</div>
        </div>
      ))}
      {scored.map((q) => (
        <CommercialQuestion
          key={`${bid.bidderId}-${q.id}`} ctx={ctx} q={q}
          answers={(response?.answers ?? []).filter((a) => a.questionId === q.id)}
          mine={latestScore(state.scores, bid.bidderId, q.id, ctx.me.id)}
        />
      ))}
    </>
  );
}

function CommercialQuestion({ ctx, q, answers, mine }: {
  ctx: Ctx; q: Question; answers: { value: unknown; attachmentName: string | null }[]; mine: Score | undefined;
}) {
  const { dispatch } = useStore();
  const treatment = treatmentOf(q);
  const answer = answers[0] as Parameters<typeof answerText>[0];
  const rule = q.scoringMethod === 'RULE' ? ruleProposal(q, answer) : null;
  const proposal = q.scoringMethod === 'AI_ASSISTED' || q.scoringMethod === 'AI_AUTO' ? agentProposal(q, answer) : null;
  const max = Math.max(q.maxScore, 1);
  const [value, setValue] = React.useState<number | null>(mine?.value ?? null);
  const [comment, setComment] = React.useState(mine?.comment ?? '');
  const [reason, setReason] = React.useState('');
  const [manual, setManual] = React.useState(false);
  const changing = mine !== undefined && value !== null && value !== mine.value;
  const pay = ctx.bid.trail.find((t) => t.id === 'payment-terms');

  const save = (v: number, method: Score['method'], extra: Partial<Score> = {}) => {
    if (mine && v !== mine.value && !reason.trim() && !extra.overrideReason) {
      ctx.toast('Give a reason for changing a score', 'info');
      return;
    }
    const overrideReason = mine && v !== mine.value ? (extra.overrideReason ?? reason.trim()) : null;
    dispatch({
      type: 'ADD_SCORE',
      score: {
        id: uid('sc'), eventId: ctx.model.task.event.id, bidderId: ctx.bid.bidderId, questionId: q.id,
        evaluatorId: ctx.me.id, value: v, comment: comment.trim(), method,
        agentConfidence: null, citedEvidence: null,
        overridesScoreId: mine && v !== mine.value ? mine.id : null, overrideReason,
        createdAt: Date.now(), ...extra,
      },
    });
    dispatch({
      type: 'COMMERCIAL_AUDIT',
      entries: ctx.record([{
        bidderId: ctx.bid.bidderId, action: 'SCORE', subject: `${q.code} · ${ctx.bidderName}`,
        before: mine ? String(mine.value) : null, after: String(v),
        reason: overrideReason ?? comment.trim() ?? `Scored by ${method.toLowerCase().replace('_', ' ')}`,
      }]),
    });
    ctx.touch(ctx.bid.bidderId);
    setValue(v); setReason(''); setManual(false);
  };

  const buttons = (selected: number | null, onPick: (v: number) => void) => (
    max <= 10 ? (
      <div className="scorebar" role="radiogroup" aria-label={`Score for ${q.title}`}>
        {Array.from({ length: max + 1 }, (_, v) => (
          <button type="button" key={v} role="radio" aria-checked={selected === v} className={selected === v ? 'on' : ''} disabled={!ctx.canAct} onClick={() => onPick(v)}>{v}</button>
        ))}
      </div>
    ) : (
      <input type="number" className="inline-input" style={{ width: 110 }} min={0} max={max} disabled={!ctx.canAct}
        value={selected ?? ''} onChange={(e) => onPick(Math.max(0, Math.min(max, Number(e.target.value))))} aria-label={`Score for ${q.title}`} />
    )
  );

  return (
    <div className="qcard" id={`cq-${q.id}`} style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="tag">{q.code}</span>
        <span className={`tag ${treatment === 'KO' ? 'r' : treatment === 'SCORED' ? 'p' : ''}`}>{TREATMENT_LABEL[treatment]}</span>
        {treatment === 'SCORED' && <span className="tag">Weight {q.weight}</span>}
        {treatment === 'SCORED' && (
          <span className="tag">{q.scoringMethod === 'AI_ASSISTED' ? 'AI-assisted' : q.scoringMethod === 'AI_AUTO' ? 'AI-auto' : q.scoringMethod === 'RULE' ? 'Rule' : 'Manual'}</span>
        )}
        {mine && treatment !== 'MONETISED' && <span className="tag g">✓ Scored {mine.value}</span>}
      </div>
      <h4>{q.title}</h4>
      {q.helpText && <div className="help">{q.helpText}</div>}

      <div className="qgrid">
        <div className="rubric">
          <div className="box-h">Rubric</div>
          {q.rubric ?? (treatment === 'KO' ? 'Pass when the answer meets the requirement. Anything else fails.' : TREATMENT_NOTE[treatment])}
        </div>
        <div className="answer">
          <div className="box-h">{ctx.bidderName}’s answer</div>
          {answers.length === 0
            ? <span style={{ color: 'var(--muted)' }}>No answer given.</span>
            : answers.map((a, i) => <div key={i}>{answerText(a as Parameters<typeof answerText>[0]) || '—'}{a.attachmentName && <div style={{ fontSize: 12, marginTop: 4 }}><Icon name="external" size={12} /> {a.attachmentName}</div>}</div>)}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {treatment === 'MONETISED' && (
          <div className="agent" style={{ borderColor: 'var(--border)', background: 'var(--row-alt)' }}>
            <b>Converted to money, not scored.</b>{' '}
            {pay ? <>Moves the evaluated total by <b>{ctx.signed(pay.amount)}</b> ({pay.detail}).</> : 'This answer matches the declared standard, so it moves nothing.'}
            {countedTwice(q) && (
              <div style={{ marginTop: 6, color: 'var(--warn)' }}>
                ⚠ This question also carries a weight of {q.weight}. It is ignored here so it is not counted twice — the buyer should remove one.
              </div>
            )}
          </div>
        )}
        {treatment === 'PRICE' && null}
        {(treatment === 'INFO' || treatment === 'PREFERENCE') && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{TREATMENT_NOTE[treatment]}</div>}
        {treatment === 'LOADING' && (
          <div style={{ fontSize: 12.5 }}>
            {TREATMENT_NOTE.LOADING}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ctx.goto('adjustments')}>Go to Adjustments</button>
          </div>
        )}
        {treatment === 'KO' && (
          <>
            <div className="box-h">Pass or fail</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className={`btn btn-sm ${mine && mine.value > 0 ? 'btn-primary' : 'btn-ghost'}`} disabled={!ctx.canAct || (mine?.value === 0 && !reason.trim())} onClick={() => save(max, 'MANUAL', mine?.value === 0 ? { overrideReason: reason.trim() } : {})}>Pass</button>
              <button type="button" className={`btn btn-sm ${mine?.value === 0 ? 'btn-danger' : 'btn-ghost'}`} disabled={!ctx.canAct || mine?.value === 0} onClick={() => save(0, 'MANUAL', { comment: comment.trim() || `Failed knockout ${q.code}` })}>Fail</button>
              {mine?.value === 0 && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{ctx.bidderName} is not ranked on this. To reverse it, give a reason and choose Pass.</span>}
            </div>
            {mine?.value === 0 && ctx.canAct && (
              <input className="inline-input" style={{ marginTop: 8 }} placeholder="Reason for reversing the knockout (logged)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for reversal" />
            )}
          </>
        )}
        {treatment === 'SCORED' && (
          <>
            <div className="box-h">Your score</div>
            {q.scoringMethod === 'RULE' && rule && !manual ? (
              <div className="agent">
                <b>Rule fired:</b> {rule.rule} → <b>{rule.value}</b> of {max}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!ctx.canAct || mine?.value === rule.value} onClick={() => save(rule.value, 'RULE')}>{mine?.value === rule.value ? 'Accepted' : 'Accept'}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setManual(true)}>Override</button>
                </div>
              </div>
            ) : proposal && !manual && !mine ? (
              <div className="agent">
                <b><Icon name="sparkle" size={13} /> Agent proposes {proposal.value} of {max}</b> · confidence {Math.round(proposal.confidence * 100)}%
                <div style={{ marginTop: 4 }}>Evidence: {proposal.evidence}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!ctx.canAct || ctx.agentsOff} onClick={() => save(proposal.value, 'AI_ASSISTED', { agentConfidence: proposal.confidence, citedEvidence: proposal.evidence })}>Accept</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => { setManual(true); setValue(proposal.value); }}>Adjust</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => { setManual(true); setValue(null); }}>Reject</button>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>Nothing is written until you act.</div>
              </div>
            ) : buttons(value, setValue)}
            {(manual || q.scoringMethod === 'MANUAL' || mine !== undefined || (!rule && !proposal)) && ctx.canAct && (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {manual && buttons(value, setValue)}
                <textarea className="inline-input" rows={2} placeholder="Comment — why this score" value={comment} onChange={(e) => setComment(e.target.value)} aria-label={`Comment on ${q.title}`} />
                {changing && <input className="inline-input" placeholder={`Reason for changing ${mine!.value} → ${value} (logged)`} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for change" />}
                <div><button type="button" className="btn btn-primary btn-sm" disabled={value === null || (mine?.value === value && mine?.comment === comment.trim())} onClick={() => value !== null && save(value, manual ? 'MANUAL' : (mine?.method ?? 'MANUAL'))}>Save score</button></div>
              </div>
            )}
            {mine && (mine.overrideReason || mine.comment) && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>“{mine.overrideReason ?? mine.comment}”{mine.overridesScoreId ? ' — overrides an earlier score, which is retained' : ''}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<FlagAction, string> = {
  CLARIFY: 'Raise a clarification', BASIS: 'Adjust the comparison basis', REVIEW: 'Mark for review', RECORD: 'Record the correction',
};

function FlagsTab({ ctx, flags }: { ctx: Ctx; flags: CommercialFlag[] }) {
  const { state, dispatch } = useStore();
  const { model, bid } = ctx;
  const eventId = model.task.event.id;
  const decisions = state.commercialFlagDecisions.filter((d) => d.eventId === eventId);
  const [ask, setAsk] = React.useState<{ flag: CommercialFlag | null } | null>(null);
  const [review, setReview] = React.useState<CommercialFlag | null>(null);
  const requests = state.buyerRequests.filter((r) => r.eventId === eventId && r.bidderId === bid.bidderId);

  const decide = (flag: CommercialFlag, action: FlagAction, note: string) => {
    dispatch({
      type: 'DECIDE_COMMERCIAL_FLAG',
      decision: { eventId, key: flag.key, action, by: ctx.me.id, at: Date.now(), note },
      audit: ctx.record([{
        bidderId: flag.bidderId, action: action === 'RECORD' ? 'ARITHMETIC' : 'FLAG', subject: flag.title,
        before: 'Open', after: ACTION_LABEL[action], reason: note || ACTION_LABEL[action],
      }]),
    });
    if (flag.bidderId) ctx.touch(flag.bidderId);
  };

  const act = (flag: CommercialFlag, action: FlagAction) => {
    if (action === 'CLARIFY') return setAsk({ flag });
    if (action === 'REVIEW') return setReview(flag);
    if (action === 'RECORD') {
      decide(flag, 'RECORD', 'The unit price governs; the supplier’s extended value is recorded as a correction');
      return ctx.toast('Correction recorded', 'check');
    }
    // Adjust the basis: an ex-works bid needs landed cost and its freight; otherwise land on the landed basis.
    if (flag.code === 'EX_WORKS') {
      ctx.setBasis('LANDED');
      ctx.goto('adjustments');
      ctx.toast('Landed basis on — add the inbound freight under Adjustments', 'info');
    } else {
      ctx.setBasis('LANDED');
      ctx.toast('Comparing on the landed basis', 'check');
    }
    decide(flag, 'BASIS', 'Comparison basis adjusted');
    return undefined;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', flex: 1 }}>
          {flags.filter((f) => f.severity !== 'INFO').length} flag{flags.filter((f) => f.severity !== 'INFO').length === 1 ? '' : 's'} to deal with for {ctx.bidderName}. A blocking flag has to be dealt with before the evaluation can be completed.
        </span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => setAsk({ flag: null })}>
          <Icon name="send" size={13} /> Ask {ctx.bidderName} a question
        </button>
      </div>

      {flags.length === 0 && <div className="placeholder" style={{ marginTop: 14 }}><div className="big">Nothing flagged</div>No outliers, arithmetic problems, missing lines or integrity signals on this bid.</div>}

      {flags.map((flag) => {
        const done = decisions.find((d) => d.key === flag.key);
        return (
          <div key={flag.key} className={`cw-flag ${flag.severity} ${done ? 'done' : ''}`}>
            <div className="t">
              <span aria-hidden="true">{flag.severity === 'BLOCKING' ? '✕' : flag.severity === 'WARNING' ? '▲' : 'ⓘ'}</span>
              {flag.title}
              <span className={`tag ${flag.severity === 'BLOCKING' ? 'r' : flag.severity === 'WARNING' ? 'w' : ''}`}>
                {flag.severity === 'BLOCKING' ? 'blocking' : flag.severity === 'WARNING' ? 'warning' : 'for information'}
              </span>
              {flag.code === 'IDENTICAL_PRICING' && <span className="tag r"><Icon name="flag" size={11} /> integrity signal</span>}
              {flag.bidderId === null && <span className="tag">whole event</span>}
            </div>
            <div className="x">{flag.detail}</div>
            {done ? (
              <div className="x" style={{ color: 'var(--success)' }}>
                ✓ {ACTION_LABEL[done.action]} by {nameOf(done.by)}, {fTime(done.at)}{done.note ? ` — ${done.note}` : ''}
              </div>
            ) : (
              <div className="acts">
                {flag.actions.map((action) => (
                  <button key={action} type="button" className={`btn btn-sm ${action === flag.actions[0] ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={!ctx.canAct || (action === 'CLARIFY' && !flag.suggestedRequest && !flag.askable)} onClick={() => act(flag, action)}>
                    {ACTION_LABEL[action]}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="cw-card">
        <h4>Questions to {ctx.bidderName}</h4>
        <div className="sub">What you asked the supplier, in the plain words they were sent, and what they said back.</div>
        {requests.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>You have not asked this supplier anything.</div>}
        {requests.map((r) => <RequestRow key={r.id} ctx={ctx} request={r} />)}
      </div>

      {ask && <AskModal ctx={ctx} flag={ask.flag} onClose={() => setAsk(null)} onSent={(flag) => { if (flag) decide(flag, 'CLARIFY', 'Clarification sent to the supplier'); }} />}
      {review && <ReviewModal flag={review} onClose={() => setReview(null)} onConfirm={(note) => { decide(review, 'REVIEW', note); setReview(null); ctx.toast('Marked for review', 'flag'); }} />}
    </>
  );
}

function ReviewModal({ flag, onClose, onConfirm }: { flag: CommercialFlag; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = React.useState('');
  return (
    <EpModal title="Mark for review" lead={flag.title} confirm="Mark for review" confirmDisabled={note.trim().length < 3} onClose={onClose} onConfirm={() => onConfirm(note.trim())}>
      <div className="field">
        <label>What you decided, and why</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Required — an approver reads this" />
      </div>
      {flag.severity === 'BLOCKING' && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          This does not clear the problem: a bid that fails a knockout stays out of the ranking. It records that you saw it and decided how to proceed.
        </div>
      )}
    </EpModal>
  );
}

function AskModal({ ctx, flag, onClose, onSent }: {
  ctx: Ctx; flag: CommercialFlag | null; onClose: () => void; onSent: (flag: CommercialFlag | null) => void;
}) {
  const { dispatch } = useStore();
  const suggested = flag?.suggestedRequest;
  const [subject, setSubject] = React.useState(suggested?.subject ?? '');
  const [message, setMessage] = React.useState(suggested?.message ?? '');
  const [days, setDays] = React.useState(3);
  const kind: RequestKind = suggested?.kind ?? 'GENERAL';
  const send = () => {
    const at = Date.now();
    const request: BuyerRequest = {
      id: uid('br'), eventId: ctx.model.task.event.id, bidderId: ctx.bid.bidderId, kind,
      subject: subject.trim(), message: message.trim(), askValidityDays: suggested?.askValidityDays ?? null,
      raisedAt: at, dueAt: at + days * 86_400_000, flagKey: flag?.key ?? null, status: 'OPEN', closedAt: null, accepted: false,
    };
    dispatch({
      type: 'RAISE_BUYER_REQUEST', request,
      audit: ctx.record([{
        bidderId: ctx.bid.bidderId, action: 'REQUEST', subject: `Question to ${ctx.bidderName}`,
        before: null, after: subject.trim(), reason: flag ? flag.title : 'Raised by the evaluator',
      }]),
    });
    ctx.touch(ctx.bid.bidderId);
    onSent(flag);
    ctx.toast(`Sent to ${ctx.bidderName}`, 'send');
    onClose();
  };
  return (
    <EpModal
      wide title={`Ask ${ctx.bidderName}`}
      lead="This reaches the supplier’s portal under “From the buyer”. Write it as you would to the supplier — it should not mention how their price is evaluated."
      confirm="Send to supplier" confirmDisabled={subject.trim().length < 3 || message.trim().length < 10} onClose={onClose} onConfirm={send}
    >
      <div className="field"><label>Subject</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></div>
      <div className="field"><label>Message</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message" /></div>
      <div className="field">
        <label>Reply needed within</label>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option><option value={3}>3 days</option><option value={5}>5 days</option><option value={7}>7 days</option>
        </select>
      </div>
      {suggested?.askValidityDays && <div style={{ fontSize: 12, color: 'var(--muted)' }}>The supplier will be asked to extend their offer to {suggested.askValidityDays} days, with a field to do it.</div>}
    </EpModal>
  );
}

function RequestRow({ ctx, request }: { ctx: Ctx; request: BuyerRequest }) {
  const { state, dispatch } = useStore();
  const replies = repliesTo(request.id, state.buyerReplies);
  const status = requestState(request, state.buyerReplies);
  const last = replies[replies.length - 1];
  const close = (accepted: boolean) => {
    dispatch({
      type: 'CLOSE_BUYER_REQUEST', requestId: request.id, accepted, at: Date.now(),
      audit: ctx.record([{
        bidderId: request.bidderId, action: 'REQUEST', subject: `Question to ${ctx.bidderName}: ${request.subject}`,
        before: status === 'REPLIED' ? 'Replied' : 'Waiting', after: accepted ? 'Reply accepted, closed' : 'Closed without accepting',
        reason: accepted && last?.revisedValidityDays ? `Offer now valid ${last.revisedValidityDays} days` : 'Closed by the evaluator',
      }]),
    });
    ctx.toast(accepted ? 'Reply accepted' : 'Closed', 'check');
  };
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0', fontSize: 12.5 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{request.subject}</b>
        <span className={`tag ${status === 'CLOSED' ? 'g' : status === 'REPLIED' ? 'p' : 'w'}`}>
          {status === 'CLOSED' ? (request.accepted ? 'Accepted' : 'Closed') : status === 'REPLIED' ? 'Replied' : 'Waiting for supplier'}
        </span>
        <span style={{ color: 'var(--muted)' }}>sent {fTime(request.raisedAt)}{status === 'WAITING_FOR_SUPPLIER' ? ` · due ${fDate(request.dueAt)}` : ''}</span>
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 4 }}>{request.message}</div>
      {last && (
        <div style={{ marginTop: 8, background: 'var(--row-alt)', borderRadius: 6, padding: '8px 10px' }}>
          <b>Their reply</b> · {fTime(last.repliedAt)}
          <div>{last.text}</div>
          {last.revisedValidityDays && <div>Offer now valid for <b>{last.revisedValidityDays} days</b>.</div>}
          {last.attachmentName && <div><Icon name="external" size={12} /> {last.attachmentName}</div>}
        </div>
      )}
      {request.status === 'OPEN' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {status === 'REPLIED' && <button type="button" className="btn btn-primary btn-sm" disabled={!ctx.canAct} onClick={() => close(true)}>Accept reply and close</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ctx.canAct} onClick={() => close(false)}>
            {status === 'REPLIED' ? 'Close without accepting' : 'Withdraw question'}
          </button>
        </div>
      )}
    </div>
  );
}

