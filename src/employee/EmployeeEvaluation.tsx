/**
 * Evaluation on the Employee Portal — Pack 13's technical workspace and the
 * commercial workspace behind it, for the evaluators the Create Event wizard
 * named.
 *
 * The technical workspace is built from `technicalProjection`: the response
 * with every price line and commercial answer already removed. Nothing here
 * hides a price; there is no price in what this screen is given. The
 * commercial workspace stays sealed until the technical evaluation that gates
 * it has been submitted and published, and opening it is recorded for good.
 */
import React from 'react';
import { lineItemsForEvent, useStore } from '../store/store';
import { COUNTERPARTIES, PRIMARY_EVENT_ID, QUESTIONNAIRE } from '../data/seed';
import { SEEDED_EVALUATION, employeeById } from '../data/employees';
import { RUBRIC_SCALES } from '../data/evaluators';
import { STAGE_LABELS } from '../domain/journeyPatterns';
import {
  AUTO_CONFIDENCE, MODERATOR_PREFIX, agentProposal, answerText, commercialQuestions, divergences,
  latestScore, maskedLabel, redact, revealingTokens, ruleProposal, technicalOutcome,
  technicalProjection, technicalQuestions, technicalSources, unlockPreconditions, weightedScore,
  bidderCommercialEnvelope, bidderOpening, bidderTechnicalEnvelope,
  type BidderEnvelope, type BidderEnvelopeStage, type EvaluationTask, type StageAssignment,
} from '../domain/employeePortal';
import type { Employee } from '../data/employees';
import type { Answer, EventBidder, Question, Response, Score } from '../domain/types';
import { EpModal, Icon, downloadCsv, fDate, fTime, type Toast } from './employeeUi';
import { CommercialEvaluation } from './CommercialEvaluation';

const SEEDED = SEEDED_EVALUATION as Record<string, StageAssignment[]>;

function questionsOf(questionnaires: { eventId: string; questions: Question[] }[], eventId: string): Question[] {
  const own = questionnaires.filter((q) => q.eventId === eventId).flatMap((q) => q.questions);
  if (own.length > 0) return own;
  return eventId === PRIMARY_EVENT_ID ? QUESTIONNAIRE.questions : [];
}

/** The latest submitted response per bidder on one ask. */
function submittedResponses(responses: Response[], eventId: string): Response[] {
  const latest = new Map<string, Response>();
  for (const r of responses) {
    if (r.eventId !== eventId || !r.submittedAt) continue;
    const held = latest.get(r.bidderId);
    if (!held || r.version > held.version) latest.set(r.bidderId, r);
  }
  return [...latest.values()];
}

function counterpartyName(bidder: EventBidder | undefined): string {
  return COUNTERPARTIES.find((c) => c.id === bidder?.counterpartyId)?.name ?? bidder?.counterpartyId ?? 'Unknown supplier';
}

function nameOf(id: string): string {
  return employeeById(id)?.name ?? id;
}

function useEvaluation(task: EvaluationTask) {
  const { state } = useStore();
  const questions = questionsOf(state.questionnaires, task.event.id);
  const responses = submittedResponses(state.responses, task.event.id);
  const bidders = state.bidders.filter((b) => b.eventId === task.event.id);
  const responded = bidders.filter((b) => responses.some((r) => r.bidderId === b.id));
  const label = (b: EventBidder) => (task.rules.blindTechnical
    ? b.maskedLabel ?? maskedLabel(bidders.indexOf(b))
    : counterpartyName(b));
  const supplierNames = bidders.map(counterpartyName);
  return { state, questions, responses, bidders, responded, label, supplierNames };
}

export function taskStatus(task: EvaluationTask, me: Employee, state: ReturnType<typeof useStore>['state']): { label: string; cls: string } {
  const submitted = state.evaluationSubmissions.some((s) => s.eventId === task.event.id && s.evaluatorId === me.id && s.envelope === task.role);
  if (task.role === 'COMMERCIAL') {
    const unlock = state.commercialUnlocks.find((u) => u.eventId === task.event.id);
    if (submitted) return { label: 'Evaluated', cls: 's-approved' };
    if (unlock?.unlockedAt) {
      const total = submittedResponses(state.responses, task.event.id).length;
      const reviewed = state.commercialReviews.filter((r) => r.eventId === task.event.id && r.status === 'REVIEWED').length;
      return reviewed > 0 ? { label: `${reviewed} of ${total} reviewed`, cls: 's-pending' } : { label: 'Unlocked', cls: 's-info' };
    }
    if (unlock) return { label: 'Awaiting witness', cls: 's-pending' };
    return { label: 'Sealed', cls: 's-hold' };
  }
  if (submitted) {
    const published = state.technicalResults.some((r) => r.eventId === task.event.id);
    if (canPublishTechnical(task, me) && !published) {
      return { label: task.assignment.technicalEvaluatorIds.length > 1 ? 'Moderate & publish' : 'Publish result', cls: 's-pending' };
    }
    return { label: published ? 'Result published' : 'Submitted', cls: 's-approved' };
  }
  const answered = submittedResponses(state.responses, task.event.id);
  if (answered.length === 0) return { label: 'Awaiting responses', cls: 's-hold' };
  const sealed = answered.filter((r) => !bidderOpening(state.envelopeOpenings, state.scores, task.event.id, r.bidderId, task.assignment.technicalEvaluatorIds)).length;
  if (sealed > 0) return { label: `${sealed} envelope${sealed === 1 ? '' : 's'} sealed`, cls: 's-info' };
  const mine = state.scores.some((s) => s.eventId === task.event.id && s.evaluatorId === me.id);
  return mine ? { label: 'In progress', cls: 's-pending' } : { label: 'Ready to score', cls: 's-info' };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Whether this person has nothing left to do on a task. Submitting ends an
 * evaluator's part — except the lead's, who still moderates and publishes the
 * technical result.
 */
/**
 * Who may publish an ask's technical result: an evaluator on its technical
 * panel. Where the panel moderates, the agreed scores are the lead's to set, so
 * publishing stays with the lead; otherwise whoever scored the envelope can.
 */
export function canPublishTechnical(task: EvaluationTask, me: Employee): boolean {
  const panel = task.assignment.technicalEvaluatorIds;
  if (task.role !== 'TECHNICAL' || !panel.includes(me.id)) return false;
  const moderated = task.rules.consensusMode === 'MODERATED' && panel.length > 1;
  return !moderated || panel[0] === me.id;
}

export function isTaskDone(task: EvaluationTask, me: Employee, state: ReturnType<typeof useStore>['state']): boolean {
  const submitted = state.evaluationSubmissions.some((s) => s.eventId === task.event.id && s.evaluatorId === me.id && s.envelope === task.role);
  if (!submitted) return false;
  if (task.role === 'COMMERCIAL' || !canPublishTechnical(task, me)) return true;
  return state.technicalResults.some((r) => r.eventId === task.event.id);
}

/** Only asks that at least one bidder has answered: an envelope is a sealed submission, so before one arrives there is nothing to evaluate. */
export function readyTasks(tasks: EvaluationTask[], state: ReturnType<typeof useStore>['state']): EvaluationTask[] {
  return tasks.filter((t) => submittedResponses(state.responses, t.event.id).length > 0);
}

/** Every responding bidder's two envelopes on one ask, as this viewer sees them. */
export function useBidderEnvelopes(task: EvaluationTask, viewerId: string) {
  const { state } = useStore();
  const { questions, responses, bidders, responded } = useEvaluation(task);
  const sources = technicalSources(task, state.events, SEEDED);
  const preconditions = unlockPreconditions(sources, state.evaluationSubmissions, state.technicalResults);
  const ownResult = state.technicalResults.find((r) => r.eventId === task.event.id);
  const gatingResult = ownResult ?? state.technicalResults.find((r) => sources.some((src) => src.event.id === r.eventId));
  const unlock = state.commercialUnlocks.find((u) => u.eventId === task.event.id);
  const commercialDone = task.assignment.commercialEvaluatorIds.length > 0 && task.assignment.commercialEvaluatorIds.every((id) =>
    state.evaluationSubmissions.some((x) => x.eventId === task.event.id && x.evaluatorId === id && x.envelope === 'COMMERCIAL'));
  return responded.map((bidder) => ({
    bidder,
    index: bidders.indexOf(bidder),
    submittedAt: responses.find((r) => r.bidderId === bidder.id)?.submittedAt ?? null,
    technical: bidderTechnicalEnvelope({
      eventId: task.event.id, bidder, panel: task.assignment.technicalEvaluatorIds, assignment: task.assignment, questions,
      openings: state.envelopeOpenings, scores: state.scores, result: ownResult, viewerId, nameOf,
    }),
    commercial: bidderCommercialEnvelope({
      bidder, panel: task.assignment.commercialEvaluatorIds, preconditions, unlock,
      result: gatingResult, submitted: commercialDone, nameOf,
      review: state.commercialReviews.find((r) => r.eventId === task.event.id && r.bidderId === bidder.id)?.status,
    }),
  }));
}

export function EvaluationsPage({ tasks, me, onOpen, header }: {
  tasks: EvaluationTask[];
  me: Employee;
  onOpen: (task: EvaluationTask, bidderId?: string) => void;
  header: React.ReactNode;
}) {
  const { state } = useStore();
  const [tab, setTab] = React.useState<'open' | 'done'>('open');
  const ready = readyTasks(tasks, state);
  const waiting = [...new Map(tasks.filter((t) => !ready.includes(t)).map((t) => [t.event.id, t])).values()];
  // One packet per ask, holding every responding bidder's envelopes.
  const packets = [...new Map(ready.map((t) => [t.event.id, ready.filter((x) => x.event.id === t.event.id)])).values()];
  const done = (group: EvaluationTask[]) => group.every((t) => isTaskDone(t, me, state));
  const list = packets.filter((g) => (tab === 'done') === done(g));
  return (
    <>
      {header}
      <div className="tabs">
        <button type="button" className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>To evaluate ({packets.filter((g) => !done(g)).length})</button>
        <button type="button" className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Completed</button>
      </div>
      {list.length === 0 ? (
        <div className="tbl-empty">
          <div className="big">{tab === 'open' ? 'Nothing to evaluate' : 'Nothing submitted yet'}</div>
          {tab === 'open' && 'A bidder’s technical and commercial envelopes appear here the moment they submit a response to an ask you evaluate.'}
        </div>
      ) : list.map((group) => <EnvelopePacket key={group[0].event.id} group={group} me={me} onOpen={onOpen} />)}
      {tab === 'open' && waiting.length > 0 && (
        <div className="waiting-asks">
          <Icon name="clock" size={16} />
          <div>
            <b>Waiting for the first response</b> — no envelopes yet on {waiting.length === 1 ? 'this ask' : `these ${waiting.length} asks`}:
            <ul>
              {waiting.map((t) => (
                <li key={t.event.id}>
                  {t.event.eventNumber} · {t.event.title} · {state.bidders.filter((b) => b.eventId === t.event.id).length} invited · closes {fDate(t.event.closesAt)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function EnvelopePacket({ group, me, onOpen }: {
  group: EvaluationTask[];
  me: Employee;
  onOpen: (task: EvaluationTask, bidderId?: string) => void;
}) {
  const { state, dispatch } = useStore();
  const first = group[0];
  const { event, assignment, rules } = first;
  const rows = useBidderEnvelopes(first, me.id);
  const technicalTask = group.find((t) => t.role === 'TECHNICAL');
  const commercialTask = group.find((t) => t.role === 'COMMERCIAL');
  const [confirm, setConfirm] = React.useState<string[] | null>(null);
  const invited = state.bidders.filter((b) => b.eventId === event.id).length;
  const gate = assignment.gate === 'NONE' ? 'no gate' : assignment.gate === 'PASS_FAIL' ? 'pass / fail gate' : `minimum ${assignment.minScore} to qualify`;
  const sealedIds = rows.filter((r) => r.technical.stage === 'SEALED').map((r) => r.bidder.id);
  const name = (b: EventBidder, index: number) => (rules.blindTechnical && technicalTask
    ? b.maskedLabel ?? maskedLabel(index)
    : counterpartyName(b));

  const openTechnical = (ids: string[]) => {
    const at = Date.now();
    for (const bidderId of ids) {
      dispatch({ type: 'OPEN_ENVELOPE', opening: { eventId: event.id, envelope: 'TECHNICAL', openedBy: me.id, openedAt: at, bidderId } });
    }
    setConfirm(null);
    if (technicalTask) onOpen(technicalTask, ids[0]);
  };

  const technicalAction = (row: typeof rows[number]) => {
    if (!technicalTask || row.technical.stage === 'NONE') return null;
    if (row.technical.stage === 'SEALED') return { label: 'Open envelope', primary: true, run: () => setConfirm([row.bidder.id]) };
    const label = row.technical.stage === 'OPEN' ? 'Score' : 'Review';
    return { label, primary: row.technical.stage === 'OPEN', run: () => onOpen(technicalTask, row.bidder.id) };
  };
  const commercialAction = (row: typeof rows[number]) => {
    if (!commercialTask) return null;
    const stage = row.commercial.stage;
    if (stage === 'NONE' || stage === 'WITHHELD') return null;
    const label = stage === 'LOCKED' ? 'Conditions' : stage === 'SEALED' ? 'Unlock' : stage === 'WITNESS' ? 'Review unlock' : 'View price';
    return { label, primary: stage === 'SEALED' || stage === 'OPEN', run: () => onOpen(commercialTask) };
  };

  return (
    <div className="packet">
      <div className="packet-h">
        <div className="grow">
          <div className="det-link">{event.eventNumber} / {event.title}</div>
          <div className="det-sub">
            {STAGE_LABELS[event.currentStage]} · {event.category} · {gate} · {rules.envelopeMode === 'TWO_ENVELOPE' ? 'two envelopes per bidder' : rules.envelopeMode === 'NONE' ? 'no envelope, responses open' : 'single envelope, opened in two parts'}
            {' '}· {rows.length} of {invited} responded · closes {fDate(event.closesAt)}
          </div>
        </div>
        {technicalTask && sealedIds.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(sealedIds)}>
            <Icon name="unlock" size={14} /> Open all sealed ({sealedIds.length})
          </button>
        )}
        <span className="tag"><Icon name="lock" size={12} />Sealed at submission</span>
      </div>

      <div className="benv-head">
        <span>Bidder</span><span>Technical envelope</span><span>Commercial envelope</span>
      </div>
      {rows.map((row) => (
        <div className="benv-row" key={row.bidder.id}>
          <div className="benv-who">
            <b>{name(row.bidder, row.index)}</b>
            <span className="det-sub">Submitted {fTime(row.submittedAt)}</span>
          </div>
          <MiniEnvelope env={row.technical} action={technicalAction(row)} mine={Boolean(technicalTask)} />
          <MiniEnvelope env={row.commercial} action={commercialAction(row)} mine={Boolean(commercialTask)} />
        </div>
      ))}

      {confirm && (
        <EpModal
          title={confirm.length === 1 ? 'Open this technical envelope?' : `Open ${confirm.length} technical envelopes?`}
          confirm={confirm.length === 1 ? 'Open envelope' : 'Open envelopes'}
          onClose={() => setConfirm(null)}
          onConfirm={() => openTechnical(confirm)}
          lead={`${confirm.map((id) => { const r = rows.find((x) => x.bidder.id === id)!; return name(r.bidder, r.index); }).join(', ')} ${confirm.length === 1 ? 'becomes' : 'become'} readable to the technical panel (${assignment.technicalEvaluatorIds.map(nameOf).join(', ')}). Each opening is recorded with your name and the time, and cannot be undone.`}
        >
          <div className="note info"><Icon name="lock" size={18} /><span>Only the technical envelope opens. Each bidder’s price and commercial answers stay in their commercial envelope, sealed until the technical result is published.</span></div>
        </EpModal>
      )}
    </div>
  );
}

const STAGE_TONE: Record<BidderEnvelopeStage, string> = {
  SEALED: 's-info', OPEN: 's-pending', SCORED: 's-approved', QUALIFIED: 's-approved', DISQUALIFIED: 's-declined',
  LOCKED: 's-hold', WITNESS: 's-pending', WITHHELD: 's-hold', EVALUATED: 's-approved', NONE: 's-hold',
};

function MiniEnvelope({ env, action, mine }: {
  env: BidderEnvelope;
  action: { label: string; primary: boolean; run: () => void } | null;
  mine: boolean;
}) {
  const technical = env.envelope === 'TECHNICAL';
  const open = env.opening !== null;
  return (
    <div className={`mini-env ${technical ? 'tech' : 'comm'} ${open ? 'opened' : 'sealed'} ${env.stage === 'NONE' ? 'none' : ''}`}>
      <span className="mseal" aria-hidden="true"><Icon name={open ? 'unlock' : 'lock'} size={14} stroke={2} /></span>
      <div className="mbody">
        <div className="mtop">
          <span className={`status ${STAGE_TONE[env.stage]}`}>{env.label}</span>
        </div>
        <div className="det-sub">{env.detail}</div>
      </div>
      {typeof env.score === 'number' && (
        <div className={`mscore ${env.stage === 'QUALIFIED' ? 'pass' : 'below'}`} title="Agreed technical score, weighted by the questionnaire">
          <b>{env.score.toFixed(1)}</b><span>/ 100</span>
          <em>Technical score</em>
        </div>
      )}
      {action
        ? <button type="button" className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}`} onClick={action.run}>{action.label}</button>
        : env.stage !== 'NONE' && env.stage !== 'WITHHELD' && !mine && <span className="det-sub nowrap">Not your envelope</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technical workspace
// ---------------------------------------------------------------------------

function newScore(task: EvaluationTask, bidderId: string, q: Question, evaluatorId: string, fields: Partial<Score>): Score {
  return {
    id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    eventId: task.event.id, bidderId, questionId: q.id, evaluatorId,
    value: 0, comment: '', method: q.scoringMethod === 'NONE' ? 'MANUAL' : q.scoringMethod,
    agentConfidence: null, citedEvidence: null, overridesScoreId: null, overrideReason: null,
    createdAt: Date.now(),
    ...fields,
  };
}

export function TechnicalWorkspace({ task, me, onBack, toast, initialBidderId }: {
  task: EvaluationTask;
  me: Employee;
  onBack: () => void;
  toast: Toast;
  /** The bidder whose envelope the evaluator came in through. */
  initialBidderId?: string;
}) {
  const { dispatch } = useStore();
  const { state, questions, responses, bidders, responded, label, supplierNames } = useEvaluation(task);
  const tq = technicalQuestions(questions);
  const panel = task.assignment.technicalEvaluatorIds;
  const lead = panel[0];
  const submittedBy = (id: string) => state.evaluationSubmissions.some((s) => s.eventId === task.event.id && s.evaluatorId === id && s.envelope === 'TECHNICAL');
  const locked = submittedBy(me.id);
  const allSubmitted = panel.every(submittedBy);
  const result = state.technicalResults.find((r) => r.eventId === task.event.id);
  const moderated = task.rules.consensusMode === 'MODERATED' && panel.length > 1;
  const canPublish = canPublishTechnical(task, me);
  const [view, setView] = React.useState<'score' | 'moderate'>('score');
  const [bidderId, setBidderId] = React.useState(initialBidderId ?? responded[0]?.id ?? '');
  const [modal, setModal] = React.useState<'submit' | 'publish' | null>(null);
  const rubric = RUBRIC_SCALES.find((r) => r.id === task.assignment.rubricId) ?? RUBRIC_SCALES[0];
  const mine = (bid: string, q: Question) => latestScore(state.scores, bid, q.id, me.id);
  // Each bidder's technical envelope is opened on its own; a sealed one is
  // listed, but its answers are not shown or scored until someone opens it.
  const openingOf = (bid: string) => bidderOpening(state.envelopeOpenings, state.scores, task.event.id, bid, panel);
  const openBidder = (bid: string) => {
    dispatch({ type: 'OPEN_ENVELOPE', opening: { eventId: task.event.id, envelope: 'TECHNICAL', openedBy: me.id, openedAt: Date.now(), bidderId: bid } });
    toast('Technical envelope opened · recorded', 'unlock');
  };

  // AI-auto: the agent writes the score itself where it is confident. Below
  // its threshold it writes nothing and the question comes to the evaluator.
  // It runs once per bidder, as each envelope is opened.
  const wrote = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (locked) return;
    const rows: Score[] = [];
    for (const r of responses) {
      if (wrote.current.has(r.bidderId) || !openingOf(r.bidderId)) continue;
      wrote.current.add(r.bidderId);
      const view = technicalProjection(r, questions);
      for (const q of tq.filter((x) => x.scoringMethod === 'AI_AUTO')) {
        if (latestScore(state.scores, r.bidderId, q.id, me.id)) continue;
        const proposal = agentProposal(q, view.answers.find((a) => a.questionId === q.id));
        if (proposal.confidence < AUTO_CONFIDENCE) continue;
        rows.push(newScore(task, r.bidderId, q, me.id, {
          value: proposal.value, method: 'AI_AUTO', agentConfidence: proposal.confidence,
          citedEvidence: proposal.evidence, comment: 'Written by the scoring agent',
        }));
      }
    }
    if (rows.length > 0) dispatch({ type: 'ADD_SCORES', scores: rows });
  });

  const progress = (bid: string, evaluatorId: string) =>
    tq.length === 0 ? 0 : tq.filter((q) => latestScore(state.scores, bid, q.id, evaluatorId)).length / tq.length;
  // Position of the first knockout this evaluator has failed; nothing after it is scored.
  const failedAt = (bid: string) => tq.findIndex((q) => q.isKnockout && mine(bid, q)?.value === 0);
  const knockedOut = (bid: string) => tq.some((q) => q.isKnockout && mine(bid, q)?.value === 0);
  // A bidder who fails a knockout is out; nothing more needs scoring for them.
  const totalToScore = responded.reduce((a, b) => a + (knockedOut(b.id) ? failedAt(b.id) + 1 : tq.length), 0);
  const scoredByMe = responded.reduce((a, b) => a + tq.slice(0, knockedOut(b.id) ? failedAt(b.id) + 1 : tq.length).filter((q) => mine(b.id, q)).length, 0);

  const current = responded.find((b) => b.id === bidderId) ?? responded[0];
  const response = responses.find((r) => r.bidderId === current?.id);
  const projection = response ? technicalProjection(response, questions) : null;
  const running = current ? weightedScore(tq, (q) => mine(current.id, q)?.value ?? null) : 0;

  const exportScores = () => {
    downloadCsv(`technical-scores-${task.event.eventNumber}.csv`, [
      ['Event', 'Bidder', 'Question', 'Score', 'Out of', 'Method', 'Comment'],
      ...responded.flatMap((b) => tq.map((q) => {
        const s = mine(b.id, q);
        return [task.event.eventNumber, label(b), `${q.code} ${q.title}`, s?.value ?? '', q.maxScore, s?.method ?? '', s?.comment ?? ''];
      })),
    ]);
    toast('Exported your scores — technical envelope only, no price', 'export');
  };

  const outcomes = responded.map((b) => ({ bidder: b, ...technicalOutcome(b.id, questions, state.scores, panel, task.assignment) }));

  const currentOpening = current ? openingOf(current.id) : null;
  const sealedCount = responded.filter((b) => !openingOf(b.id)).length;

  return (
    <>
      <div className="ws-head">
        <div className="grow">
          <button type="button" className="ghost-sm" onClick={onBack} style={{ marginBottom: 10 }}>← Evaluations</button>
          <div className="top" style={{ minHeight: 0 }}>
            <h1 style={{ fontSize: 24 }}>{task.event.title}</h1>
          </div>
          <div className="det-sub">{task.event.eventNumber} · {STAGE_LABELS[task.event.currentStage]} · technical workspace · closes {fDate(task.event.closesAt)}</div>
          <div className="ws-chips">
            <span className="tag p"><Icon name="unlock" size={12} />Technical envelopes · {responded.length - sealedCount} of {responded.length} open</span>
            <span className={`tag ${task.rules.blindTechnical ? 'g' : 'w'}`}><Icon name="eye" size={12} />Blind evaluation {task.rules.blindTechnical ? 'on' : 'off'}</span>
            <span className="tag">Gate: {task.assignment.gate === 'NONE' ? 'none' : task.assignment.gate === 'PASS_FAIL' ? 'pass / fail' : `minimum ${task.assignment.minScore} of 100`}{task.assignment.gate === 'BOTH' ? ' + knockouts' : ''}</span>
            <span className="tag">{moderated ? `Moderated · divergence over ${task.rules.divergenceThreshold}%` : 'Scores averaged'}</span>
            <span className="tag">Panel: {panel.map((id) => `${nameOf(id)}${submittedBy(id) ? ' ✓' : ''}`).join(', ')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {moderated && me.id === lead && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView(view === 'score' ? 'moderate' : 'score')}>
              {view === 'score' ? 'Moderation view' : 'Back to my scoring'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportScores} disabled={responded.length === 0}><Icon name="export" size={14} /> Export my scores</button>
          {!locked ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={responded.length === 0} onClick={() => setModal('submit')}>Submit my scores</button>
          ) : canPublish && allSubmitted && !result ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal('publish')}>Publish technical result</button>
          ) : null}
        </div>
      </div>

      {locked && (
        <div className="note ok" style={{ marginTop: 14 }}>
          <Icon name="lock" size={18} />
          <span>
            Your scores are submitted and locked.{' '}
            {allSubmitted
              ? result ? `The technical result was published ${fTime(result.publishedAt)} — ${result.qualified.length} qualified against ${result.minScore}. The buyer can now see it on the Comparison tab.` : canPublish ? 'Everyone has submitted — publish the technical result so the buyer sees it on the Comparison tab and the commercial envelope can be unlocked.' : `Everyone has submitted; ${nameOf(lead)} publishes the technical result.`
              : `Waiting for ${panel.filter((id) => !submittedBy(id)).map(nameOf).join(', ')}.`}
          </span>
        </div>
      )}

      {responded.length === 0 ? (
        <div className="placeholder">
          <div className="big">No responses to score yet</div>
          {bidders.length} supplier{bidders.length === 1 ? ' is' : 's are'} invited to this {STAGE_LABELS[task.event.currentStage]}. Responses submitted on the vendor portal appear here; the ask closes {fTime(task.event.closesAt)}.
        </div>
      ) : view === 'moderate' ? (
        <Moderation task={task} questions={questions} bidders={responded} label={label} allSubmitted={allSubmitted} me={me} toast={toast} />
      ) : (
        <div className="ws">
          <div className="pane sticky">
            <div className="pane-h">Bidders · {scoredByMe} of {totalToScore} scored</div>
            {responded.map((b) => {
              const own = progress(b.id, me.id);
              const overall = panel.reduce((a, id) => a + progress(b.id, id), 0) / panel.length;
              const dq = knockedOut(b.id);
              const shut = !openingOf(b.id);
              return (
                <button type="button" key={b.id} className={`bidder ${b.id === current?.id ? 'on' : ''} ${dq ? 'dq' : ''}`} onClick={() => setBidderId(b.id)}>
                  <span className="bn">{shut && <Icon name="lock" size={12} />} {label(b)}</span>
                  {shut && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Envelope sealed</div>}
                  {dq && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Technically disqualified</div>}
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>You: {Math.round(own * tq.length)} of {tq.length}</div>
                  <div className="bar g"><span style={{ width: `${own * 100}%` }} /></div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Panel: {Math.round(overall * 100)}%</div>
                  <div className="bar"><span style={{ width: `${overall * 100}%` }} /></div>
                </button>
              );
            })}
          </div>

          <div>
            <div className="note info" style={{ marginBottom: 14 }}>
              <Icon name="info" size={18} />
              <span>
                You see {current ? label(current) : 'the bidder'}’s technical answers only. Price schedules and commercial answers
                {commercialQuestions(questions).length > 0 ? ` (${commercialQuestions(questions).length} questions)` : ''} are not sent to this view. Other evaluators’ scores stay hidden until everyone has submitted.
              </span>
            </div>
            {current && !currentOpening && (
              <div className="envelope tech sealed" style={{ maxWidth: 560 }}>
                <div className="flap" aria-hidden="true"><span className="seal"><Icon name="lock" size={16} stroke={2} /></span></div>
                <div className="env-body">
                  <div className="env-kind"><Icon name="scale" size={14} />{label(current)} · technical envelope</div>
                  <div className="det-sub">
                    Sealed since it was submitted. {tq.length} technical questions inside. Opening it shows these answers to
                    the panel ({panel.map(nameOf).join(', ')}) and is recorded with your name and the time. The price stays in
                    the commercial envelope.
                  </div>
                  <div className="env-foot">
                    <span className="det-sub">{sealedCount} of {responded.length} envelopes still sealed</span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={() => openBidder(current.id)}>
                      <Icon name="unlock" size={14} /> Open envelope
                    </button>
                  </div>
                </div>
              </div>
            )}
            {current && currentOpening && knockedOut(current.id) && (
              <div className="note bad" style={{ marginBottom: 14 }}>
                <Icon name="flag" size={18} />
                <span>
                  <b>{label(current)} is technically disqualified</b> — {tq.filter((q) => q.isKnockout && mine(current.id, q)?.value === 0).map((q) => q.title).join(', ')} failed.
                  The questions after it are closed and cannot be scored, and the supplier will not move to the next stages.
                  To bring them back, reverse the failed knockout with a reason.
                </span>
              </div>
            )}
            {current && currentOpening && projection && tq.slice(0, failedAt(current.id) < 0 ? tq.length : failedAt(current.id) + 1).map((q) => (
              <QuestionCard
                key={`${current.id}-${q.id}`}
                task={task}
                q={q}
                bidder={current}
                bidderLabel={label(current)}
                answers={projection.answers.filter((a) => a.questionId === q.id)}
                lines={lineItemsForEvent(state, task.event.id)}
                supplierNames={supplierNames}
                mine={mine(current.id, q)}
                locked={locked}
                rubric={rubric}
                me={me}
                toast={toast}
              />
            ))}
          </div>

          <div className="pane sticky">
            <div className="pane-h">Criteria · {current ? label(current) : ''}</div>
            {tq.map((q) => {
              const s = current ? mine(current.id, q) : undefined;
              const weighted = tq.filter((x) => x.weight > 0 && !x.isKnockout);
              const totalW = weighted.reduce((a, x) => a + x.weight, 0);
              return (
                <button
                  type="button" key={q.id} className="crit"
                  onClick={() => document.getElementById(`q-${q.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
                >
                  <span style={{ minWidth: 0 }}>{s ? <span className="d">✓ </span> : null}{q.title}</span>
                  <span className="w">{q.isKnockout ? 'KO' : totalW > 0 && q.weight > 0 ? `${Math.round((q.weight / totalW) * 100)}%` : '—'}{s ? ` · ${s.value}` : ''}</span>
                </button>
              );
            })}
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Your running score</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--primary)' }}>{running.toFixed(1)}<span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> / 100</span></div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>Weighted by the questionnaire. The agreed score is {moderated ? 'set by moderation where you differ' : 'the panel average'}.</div>
            </div>
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="box-h">Rubric · {rubric.name.replace('{category}', task.event.category)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{rubric.bands.map((b) => <span key={b} className="tag">{b}</span>)}</div>
            </div>
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
              <div className="agent">
                <b><Icon name="sparkle" size={13} /> Scoring agent · Suggest</b>
                <div style={{ marginTop: 4 }}>
                  {tq.some((q) => q.scoringMethod === 'AI_ASSISTED' || q.scoringMethod === 'AI_AUTO')
                    ? 'I propose scores on the AI-assisted questions with the passage I relied on. Nothing is written until you accept, adjust or reject.'
                    : 'No question on this ask is set for AI scoring.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal === 'submit' && (
        <EpModal
          title="Submit my scores"
          lead={`${scoredByMe} of ${totalToScore} scores entered across ${responded.length} bidder${responded.length === 1 ? '' : 's'}.`}
          confirm="Submit and lock"
          confirmDisabled={scoredByMe < totalToScore}
          onClose={() => setModal(null)}
          onConfirm={() => {
            dispatch({ type: 'SUBMIT_EVALUATION', submission: { eventId: task.event.id, evaluatorId: me.id, envelope: 'TECHNICAL', submittedAt: Date.now() } });
            setModal(null);
            toast('Scores submitted and locked', 'lock');
          }}
        >
          {scoredByMe < totalToScore ? (
            <div className="note bad" style={{ marginBottom: 0 }}><Icon name="warn" size={18} /><span>{totalToScore - scoredByMe} score{totalToScore - scoredByMe === 1 ? ' is' : 's are'} still missing. Every question needs a score for every bidder, unless a bidder has failed a knockout.</span></div>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              After submitting you cannot change any score, comment or knockout decision on this ask. {moderated ? `Where your scores differ from the panel's by more than ${task.rules.divergenceThreshold}%, ${nameOf(lead)} sets the agreed score.` : 'The panel average becomes the score.'}
            </div>
          )}
        </EpModal>
      )}

      {modal === 'publish' && (
        <PublishResult task={task} outcomes={outcomes.map((o) => ({ ...o, name: counterpartyName(o.bidder), masked: label(o.bidder) }))} onClose={() => setModal(null)} me={me} toast={toast} />
      )}
    </>
  );
}

function QuestionCard({ task, q, bidder, bidderLabel, answers, lines, supplierNames, mine, locked, rubric, me, toast }: {
  task: EvaluationTask;
  q: Question;
  bidder: EventBidder;
  bidderLabel: string;
  answers: Answer[];
  lines: { id: string; description: string }[];
  supplierNames: string[];
  mine: Score | undefined;
  locked: boolean;
  rubric: typeof RUBRIC_SCALES[number];
  me: Employee;
  toast: Toast;
}) {
  const { dispatch } = useStore();
  const [value, setValue] = React.useState<number | null>(mine?.value ?? null);
  const [comment, setComment] = React.useState(mine?.comment ?? '');
  const [reason, setReason] = React.useState('');
  const [manual, setManual] = React.useState(false);
  const [showRedacted, setShowRedacted] = React.useState(true);
  const [highlight, setHighlight] = React.useState(false);
  const [confirmFail, setConfirmFail] = React.useState(false);
  const answer = answers.find((a) => !a.lineItemId) ?? answers[0];
  const rule = q.scoringMethod === 'RULE' ? ruleProposal(q, answer) : null;
  const proposal = q.scoringMethod === 'AI_ASSISTED' || q.scoringMethod === 'AI_AUTO' ? agentProposal(q, answer) : null;
  const degraded = q.scoringMethod === 'AI_AUTO' && proposal !== null && proposal.confidence < AUTO_CONFIDENCE;
  const changing = mine !== undefined && value !== null && value !== mine.value;
  const attachmentsLeak = answers.map((a) => a.attachmentName).filter((n): n is string => Boolean(n))
    .filter((n) => task.rules.blindTechnical && revealingTokens(n, supplierNames).length > 0);
  const selfIdentifies = task.rules.blindTechnical && answers.some((a) => revealingTokens(answerText(a), supplierNames).length > 0);
  const max = Math.max(q.maxScore, 1);

  const save = (v: number, method: Score['method'], extra: Partial<Score> = {}) => {
    if (mine && v !== mine.value && !reason.trim() && !extra.overrideReason) {
      toast('Give a reason for changing a score', 'info');
      return;
    }
    dispatch({
      type: 'ADD_SCORE',
      score: newScore(task, bidder.id, q, me.id, {
        value: v, method, comment: comment.trim(),
        overridesScoreId: mine && v !== mine.value ? mine.id : null,
        overrideReason: mine && v !== mine.value ? (extra.overrideReason ?? reason.trim()) : null,
        ...extra,
      }),
    });
    setValue(v);
    setReason('');
    setManual(false);
  };

  const jump = () => {
    setHighlight(true);
    document.getElementById(`ans-${q.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlight(false), 1600);
  };

  const shownText = (a: Answer) => {
    const text = answerText(a);
    return task.rules.blindTechnical ? redact(text, supplierNames) : text;
  };

  const scoreButtons = (onPick: (v: number) => void, selected: number | null) => (
    max <= 10 ? (
      <div className="scorebar" role="radiogroup" aria-label={`Score for ${q.title}`}>
        {Array.from({ length: max + 1 }, (_, v) => (
          <button type="button" key={v} role="radio" aria-checked={selected === v} className={selected === v ? 'on' : ''} disabled={locked} onClick={() => onPick(v)}>{v}</button>
        ))}
      </div>
    ) : (
      <input type="number" className="inline-input" style={{ width: 110 }} min={0} max={max} disabled={locked} value={selected ?? ''} onChange={(e) => onPick(Math.max(0, Math.min(max, Number(e.target.value))))} aria-label={`Score for ${q.title}`} />
    )
  );

  return (
    <div className={`qcard ${highlight ? 'flash' : ''}`} id={`q-${q.id}`}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="tag">{q.code}</span>
        <span className="tag">{q.askedPer === 'LINE' ? 'Per line' : 'Supplier'}</span>
        {q.isKnockout ? <span className="tag r">Knockout</span> : <span className="tag p">Weight {q.weight}</span>}
        <span className="tag">{q.scoringMethod === 'AI_ASSISTED' ? 'AI-assisted' : q.scoringMethod === 'AI_AUTO' ? 'AI-auto' : q.scoringMethod === 'RULE' ? 'Rule' : 'Manual'}</span>
        {mine && <span className="tag g">✓ Scored {mine.value}{mine.method === 'AI_AUTO' ? ' · by agent' : ''}</span>}
      </div>
      <h4>{q.title}</h4>
      {q.helpText && <div className="help">{q.helpText}</div>}

      <div className="qgrid">
        <div className="rubric">
          <div className="box-h">Rubric</div>
          {q.isKnockout
            ? <>Pass when the answer meets the requirement{q.rubric ? ` — ${q.rubric}` : ''}. Anything else fails.</>
            : (
              <>
                {q.rubric && <div style={{ marginBottom: 6 }}>{q.rubric}</div>}
                <ul style={{ margin: 0, paddingLeft: 16 }}>{rubric.bands.map((b) => <li key={b}>{b}</li>)}</ul>
                {max !== rubric.max && <div style={{ color: 'var(--muted)', marginTop: 4 }}>Scored out of {max} on this question.</div>}
              </>
            )}
        </div>
        <div className={`answer ${highlight ? 'hl' : ''}`} id={`ans-${q.id}`}>
          <div className="box-h">{bidderLabel}’s answer</div>
          {answers.length === 0 ? <span style={{ color: 'var(--muted)' }}>No answer given.</span> : answers.map((a, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              {a.lineItemId && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{lines.find((l) => l.id === a.lineItemId)?.description ?? 'Line'}</div>}
              {shownText(a) || <span style={{ color: 'var(--muted)' }}>—</span>}
              {a.attachmentName && (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  <Icon name="external" size={13} />{' '}
                  {attachmentsLeak.includes(a.attachmentName) && showRedacted ? redact(a.attachmentName, supplierNames) : a.attachmentName}
                </div>
              )}
            </div>
          ))}
          {attachmentsLeak.length > 0 && (
            <div className="note" style={{ margin: '8px 0 0', fontSize: 12 }}>
              <Icon name="warn" size={16} />
              <span>
                The file name looks like it names the bidder. It is shown redacted.{' '}
                <button type="button" className="cite" onClick={() => setShowRedacted(!showRedacted)}>{showRedacted ? 'I need the original name' : 'Redact it again'}</button>
              </span>
            </div>
          )}
          {selfIdentifies && (
            <div className="note" style={{ margin: '8px 0 0', fontSize: 12 }}><Icon name="flag" size={16} /><span>This answer appears to name the bidder. The name is masked here and the answer is flagged for the buyer.</span></div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="box-h">Your score</div>
        {q.isKnockout ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className={`btn btn-sm ${mine && mine.value > 0 ? 'btn-primary' : 'btn-ghost'}`} disabled={locked} onClick={() => save(max, 'MANUAL', mine?.value === 0 ? { overrideReason: reason.trim() || undefined } : {})}>Pass</button>
            <button type="button" className={`btn btn-sm ${mine?.value === 0 ? 'btn-danger' : 'btn-ghost'}`} disabled={locked || mine?.value === 0} onClick={() => setConfirmFail(true)}>Fail</button>
            {mine?.value === 0 && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{bidderLabel} is <b>Technically disqualified</b> on this question. To reverse it, give a reason below and choose Pass.</span>}
          </div>
        ) : q.scoringMethod === 'RULE' && rule && !manual ? (
          <div className="agent">
            <b>Rule fired:</b> {rule.rule} → <b>{rule.value}</b> of {max}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={locked || mine?.value === rule.value} onClick={() => save(rule.value, 'RULE')}>{mine?.value === rule.value ? 'Accepted' : 'Accept'}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setManual(true)}>Override</button>
            </div>
          </div>
        ) : (q.scoringMethod === 'AI_ASSISTED' || degraded) && proposal && !manual && !mine ? (
          <div className={`agent ${degraded ? 'low' : ''}`}>
            {degraded && <div style={{ fontWeight: 600, color: 'var(--warn)', marginBottom: 4 }}>⚠ Below the agent’s confidence threshold — your decision is needed.</div>}
            <b><Icon name="sparkle" size={13} /> Agent proposes {proposal.value} of {max}</b> · confidence {Math.round(proposal.confidence * 100)}%
            <div style={{ marginTop: 4 }}>Evidence: <button type="button" className="cite" onClick={jump}>{proposal.evidence}</button></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={() => save(proposal.value, q.scoringMethod === 'AI_AUTO' ? 'AI_AUTO' : 'AI_ASSISTED', { agentConfidence: proposal.confidence, citedEvidence: proposal.evidence })}>Accept</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => { setManual(true); setValue(proposal.value); }}>Adjust</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => { setManual(true); setValue(null); }}>Reject</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>Nothing is written until you act.</div>
          </div>
        ) : (
          <>
            {mine?.method === 'AI_AUTO' && !manual && (
              <div className="agent" style={{ marginBottom: 8 }}>
                <b><Icon name="sparkle" size={13} /> Written by the agent</b> · confidence {Math.round((mine.agentConfidence ?? 0) * 100)}% · evidence <button type="button" className="cite" onClick={jump}>{mine.citedEvidence}</button>. Pick a different score to override it.
              </div>
            )}
            {scoreButtons((v) => setValue(v), value)}
          </>
        )}

        {!q.isKnockout && (manual || (q.scoringMethod !== 'RULE' && (q.scoringMethod === 'MANUAL' || q.scoringMethod === 'NONE' || mine !== undefined)) || (q.scoringMethod === 'RULE' && !rule)) && !locked && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <textarea className="inline-input" rows={2} placeholder="Comment — why this score" value={comment} onChange={(e) => setComment(e.target.value)} aria-label={`Comment on ${q.title}`} />
            {changing && (
              <input className="inline-input" placeholder={`Reason for changing ${mine!.value} → ${value} (logged)`} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for change" />
            )}
            <div>
              <button type="button" className="btn btn-primary btn-sm" disabled={value === null || (mine?.value === value && mine?.comment === comment.trim())} onClick={() => value !== null && save(value, manual ? 'MANUAL' : (mine?.method ?? 'MANUAL'))}>Save score</button>
            </div>
          </div>
        )}
        {q.isKnockout && !locked && mine?.value === 0 && (
          <input className="inline-input" style={{ marginTop: 8 }} placeholder="Reason for reversing the disqualification (logged)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for reversal" />
        )}
        {locked && mine?.comment && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>“{mine.comment}”</div>}
      </div>

      {confirmFail && (
        <EpModal
          title="Mark as technically disqualified?"
          lead={<>{bidderLabel} fails <b>{q.code} — {q.title}</b>. They stay in the list, struck, with this question cited, and can be reinstated later with a reason.</>}
          confirm="Confirm disqualification"
          confirmTone="danger"
          onClose={() => setConfirmFail(false)}
          onConfirm={() => { save(0, 'MANUAL', { comment: comment.trim() || `Failed knockout ${q.code}`, overrideReason: mine ? 'Changed to fail' : undefined }); setConfirmFail(false); }}
        />
      )}
    </div>
  );
}

/** Every evaluator's score side by side, divergent questions first. Only after everyone has submitted. */
function Moderation({ task, questions, bidders, label, allSubmitted, me, toast }: {
  task: EvaluationTask;
  questions: Question[];
  bidders: EventBidder[];
  label: (b: EventBidder) => string;
  allSubmitted: boolean;
  me: Employee;
  toast: Toast;
}) {
  const { state, dispatch } = useStore();
  const panel = task.assignment.technicalEvaluatorIds;
  const [agreed, setAgreed] = React.useState<Record<string, { value: string; note: string }>>({});
  if (!allSubmitted) {
    return (
      <div className="placeholder">
        <div className="big">Moderation opens when everyone has submitted</div>
        Evaluators score independently and cannot see each other’s scores until then. Still scoring: {panel.filter((id) => !state.evaluationSubmissions.some((s) => s.eventId === task.event.id && s.evaluatorId === id && s.envelope === 'TECHNICAL')).map(nameOf).join(', ')}.
      </div>
    );
  }
  const rows = divergences(questions, bidders.map((b) => b.id), state.scores, panel, task.rules.divergenceThreshold);
  const divergent = rows.filter((r) => r.divergent);
  const qOf = (id: string) => questions.find((q) => q.id === id)!;
  const moderatedValue = (bidderId: string, questionId: string) => state.scores
    .filter((s) => s.bidderId === bidderId && s.questionId === questionId && s.evaluatorId.startsWith(MODERATOR_PREFIX))
    .sort((a, b) => a.createdAt - b.createdAt).pop();
  return (
    <div className="section-card">
      <h3>Moderation</h3>
      <div className="sub">
        {divergent.length} of {rows.length} scores differ by more than {task.rules.divergenceThreshold}% of the scale — those come first.
        Set the agreed score with a note; where you set nothing, the panel average stands.
      </div>
      <div className="table-wrap" style={{ marginTop: 0 }}>
        <table className="items">
          <thead>
            <tr><th>Question</th><th>Bidder</th>{panel.map((id) => <th key={id}>{nameOf(id)}</th>)}<th>Spread</th><th>Agreed score</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const q = qOf(r.questionId);
              const key = `${r.bidderId}:${r.questionId}`;
              const set = moderatedValue(r.bidderId, r.questionId);
              const draft = agreed[key] ?? { value: '', note: '' };
              return (
                <tr key={key} style={{ background: r.divergent ? '#FFF8EE' : undefined }}>
                  <td className="l"><b>{q.code}</b><div className="meta">{q.title}</div></td>
                  <td>{label(bidders.find((b) => b.id === r.bidderId)!)}</td>
                  {r.values.map((v) => <td key={v.evaluatorId}>{v.value ?? '—'}</td>)}
                  <td>{r.divergent ? <span className="tag w">⚑ {r.spread}%</span> : `${r.spread}%`}</td>
                  <td className="l" style={{ minWidth: 220 }}>
                    {set ? (
                      <><span className="tag g">✓ {set.value}</span><div className="meta" style={{ marginTop: 4 }}>“{set.comment}”</div></>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <input className="inline-input" type="number" min={0} max={q.maxScore} placeholder={`0–${q.maxScore}`} value={draft.value} onChange={(e) => setAgreed({ ...agreed, [key]: { ...draft, value: e.target.value } })} aria-label="Agreed score" />
                        <input className="inline-input" placeholder="Moderation note" value={draft.note} onChange={(e) => setAgreed({ ...agreed, [key]: { ...draft, note: e.target.value } })} aria-label="Moderation note" />
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={draft.value === '' || !draft.note.trim()}
                          onClick={() => {
                            dispatch({ type: 'ADD_SCORE', score: newScore(task, r.bidderId, q, `${MODERATOR_PREFIX}${me.id}`, { value: Math.max(0, Math.min(q.maxScore, Number(draft.value))), comment: draft.note.trim() }) });
                            toast(`Agreed score set on ${q.code}`, 'check');
                          }}
                        >
                          Set agreed score
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublishResult({ task, outcomes, onClose, me, toast }: {
  task: EvaluationTask;
  outcomes: (ReturnType<typeof technicalOutcome> & { bidder: EventBidder; name: string; masked: string })[];
  onClose: () => void;
  me: Employee;
  toast: Toast;
}) {
  const { dispatch } = useStore();
  const [notify, setNotify] = React.useState<'ON_PUBLISH' | 'AT_AWARD'>('AT_AWARD');
  const qualified = outcomes.filter((o) => o.qualified);
  return (
    <EpModal
      wide
      title="Publish the technical result"
      lead={<>Against {task.assignment.gate === 'NONE' ? 'no gate' : task.assignment.gate === 'PASS_FAIL' ? 'the knockouts' : `a minimum of ${task.assignment.minScore} of 100`}{task.assignment.gate === 'BOTH' ? ' and the knockouts' : ''}: {qualified.length} of {outcomes.length} qualify. Publishing applies the gate and lets the commercial envelope be unlocked. It cannot be undone.</>}
      confirm="Apply the gate and publish"
      onClose={onClose}
      onConfirm={() => {
        dispatch({
          type: 'PUBLISH_TECHNICAL_RESULT',
          result: {
            eventId: task.event.id, publishedBy: me.id, publishedAt: Date.now(), minScore: task.assignment.minScore,
            qualified: qualified.map((o) => o.bidder.counterpartyId),
            disqualified: outcomes.filter((o) => !o.qualified).map((o) => ({
              counterpartyId: o.bidder.counterpartyId,
              reason: o.knockoutFailed.length > 0 ? `Failed knockout ${o.knockoutFailed.map((q) => q.code).join(', ')}` : `Scored ${o.score} — below ${task.assignment.minScore}`,
            })),
            notify,
          },
        });
        onClose();
        toast(`Technical result published · ${qualified.length} qualified`, 'check');
      }}
    >
      <table className="items">
        <thead><tr><th>Bidder</th><th>Supplier</th><th>Agreed score</th><th>Result</th></tr></thead>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.bidder.id} className={o.qualified ? '' : 'struck'}>
              <td>{o.masked}</td>
              <td className="l">{o.name}</td>
              <td className="r">{o.score.toFixed(1)}</td>
              <td>{o.qualified ? <span className="status s-approved">Qualified</span> : <span className="status s-declined">{o.knockoutFailed.length > 0 ? `Knockout ${o.knockoutFailed[0].code}` : 'Below gate'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="field" style={{ marginTop: 16 }}>
        <label>Tell suppliers who did not qualify</label>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <label style={{ fontWeight: 400 }}><input type="radio" name="notify" checked={notify === 'ON_PUBLISH'} onChange={() => setNotify('ON_PUBLISH')} /> Now</label>
          <label style={{ fontWeight: 400 }}><input type="radio" name="notify" checked={notify === 'AT_AWARD'} onChange={() => setNotify('AT_AWARD')} /> At award</label>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Names are revealed here, at publication, so the gate can be applied to the right supplier. Scoring itself stayed blind.</div>
    </EpModal>
  );
}

// ---------------------------------------------------------------------------
// Commercial workspace
// ---------------------------------------------------------------------------

const UNLOCKERS = ['user-ar'];

export function CommercialWorkspace({ task, me, onBack, toast }: {
  task: EvaluationTask;
  me: Employee;
  onBack: () => void;
  toast: Toast;
}) {
  const { state, dispatch } = useStore();
  const sources = technicalSources(task, state.events, SEEDED);
  const pre = unlockPreconditions(sources, state.evaluationSubmissions, state.technicalResults);
  const ready = pre.every((p) => p.met);
  const unlock = state.commercialUnlocks.find((u) => u.eventId === task.event.id);
  const unlocked = Boolean(unlock?.unlockedAt);
  const panel = task.assignment.commercialEvaluatorIds;
  const witnesses = [...new Set([...panel, ...UNLOCKERS])];
  const [confirm, setConfirm] = React.useState(false);
  const blocker = pre.find((p) => !p.met)?.label;

  const doUnlock = () => {
    const at = Date.now();
    if (task.rules.unlockWitness) {
      dispatch({ type: 'SET_COMMERCIAL_UNLOCK', unlock: { eventId: task.event.id, requestedBy: me.id, requestedAt: at, witnessedBy: null, unlockedAt: null } });
      toast('Unlock requested · a second authorised user must confirm', 'lock');
    } else {
      dispatch({ type: 'SET_COMMERCIAL_UNLOCK', unlock: { eventId: task.event.id, requestedBy: me.id, requestedAt: at, witnessedBy: null, unlockedAt: at } });
      toast('Commercial envelope unlocked', 'unlock');
    }
    setConfirm(false);
  };

  return (
    <>
      <div className="ws-head">
        <div className="grow">
          <button type="button" className="ghost-sm" onClick={onBack} style={{ marginBottom: 10 }}>← Evaluations</button>
          <div className="top" style={{ minHeight: 0 }}><h1 style={{ fontSize: 24 }}>{task.event.title}</h1></div>
          <div className="det-sub">{task.event.eventNumber} · {STAGE_LABELS[task.event.currentStage]} · commercial workspace</div>
          <div className="ws-chips">
            <span className={`tag ${unlocked ? 'g' : 'w'}`}><Icon name={unlocked ? 'unlock' : 'lock'} size={12} />Commercial envelope {unlocked ? 'unlocked' : unlock ? 'awaiting witness' : 'sealed'}</span>
            <span className="tag">{task.rules.envelopeMode === 'TWO_ENVELOPE' ? 'Two envelope' : task.rules.envelopeMode === 'NONE' ? 'No envelope' : 'Single envelope'}</span>
            <span className="tag">Combined score: technical {task.rules.technicalWeight}% · commercial {100 - task.rules.technicalWeight}%</span>
          </div>
        </div>
      </div>

      {!unlocked ? (
        <div className="section-card lock">
          <div>
            <h3><Icon name="lock" size={16} /> The commercial envelope is sealed</h3>
            <div className="sub">
              Unlocking opens every qualified supplier’s price schedule to {witnesses.filter((id) => panel.includes(id)).map(nameOf).join(', ') || 'the commercial evaluators'}.
              It is irreversible and recorded permanently. Technical evaluators never gain access.
              {task.rules.unlockWitness ? ' This event requires a witness: two authorised users must confirm.' : ''}
            </div>
          </div>
          <div>
            <div className="box-h">Before it can be unlocked</div>
            {pre.map((p) => (
              <div key={p.label} className="check-row">
                <span className={`ic ${p.met ? 'ok' : 'no'}`}>{p.met ? '✓' : '✕'}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </div>
          {unlock && !unlock.unlockedAt ? (
            <div className="note" style={{ marginBottom: 0 }}>
              <Icon name="clock" size={18} />
              <span>
                {nameOf(unlock.requestedBy)} asked to unlock at {fTime(unlock.requestedAt)}. A second authorised user must confirm.
                {unlock.requestedBy !== me.id && witnesses.includes(me.id) && (
                  <> <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => {
                    dispatch({ type: 'SET_COMMERCIAL_UNLOCK', unlock: { ...unlock, witnessedBy: me.id, unlockedAt: Date.now() } });
                    toast('Witnessed · commercial envelope unlocked', 'unlock');
                  }}
                  >Confirm as witness</button></>
                )}
                {unlock.requestedBy === me.id && ` Waiting for ${witnesses.filter((id) => id !== me.id).map(nameOf).join(' or ')}.`}
              </span>
            </div>
          ) : (
            <div>
              <button
                type="button" className="btn btn-primary"
                disabled={!ready}
                title={ready ? undefined : `Blocked: ${blocker}`}
                onClick={() => setConfirm(true)}
              >
                <Icon name="unlock" size={16} /> Unlock commercial envelope
              </button>
              {!ready && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Blocked: {blocker}</div>}
            </div>
          )}
        </div>
      ) : (
        <CommercialEvaluation task={task} me={me} toast={toast} />
      )}

      {unlocked && unlock && (
        <div className="note info" style={{ marginTop: 16 }}>
          <Icon name="lock" size={18} />
          <span>Unlocked by {nameOf(unlock.requestedBy)} at {fTime(unlock.unlockedAt)}{unlock.witnessedBy ? `, witnessed by ${nameOf(unlock.witnessedBy)}` : ''}. This record is permanent.</span>
        </div>
      )}

      {confirm && (
        <EpModal
          title="Unlock the commercial envelope?"
          lead="Every qualified supplier’s price schedule opens to the commercial evaluators. This cannot be undone, and who did it — and when — is recorded on the event."
          confirm={task.rules.unlockWitness ? 'Request unlock' : 'Unlock'}
          onClose={() => setConfirm(false)}
          onConfirm={doUnlock}
        />
      )}
    </>
  );
}
