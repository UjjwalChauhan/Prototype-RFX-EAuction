/**
 * The buyer's view of the commercial evaluation.
 *
 * The evaluators do the work on the Employee Portal; the people who owe the
 * decision — the category manager, an approver reading the award note — need
 * to see what that work produced without being able to change it, and to
 * follow any number back to the components that made it. So this is the
 * evaluation read-only: the ranking with every calculation trail one click
 * away, the flags and what was done about each, the questions put to
 * suppliers, and the change log with actor, before, after and reason.
 *
 * It refuses by route, not by hiding: before the envelope is unlocked it says
 * why and who unlocks it; for a user who only scores technical it says no.
 */
import React from 'react';
import { color, money, radius, savingsColor, signedMoney } from '../../design-system/tokens';
import { Button, Chip } from '../../design-system/components/primitives';
import { Card, Empty, KpiRow } from '../../design-system/components/layout';
import { ValidationBanner } from '../../design-system/components/domain';
import { useStore } from '../../store/store';
import { taskFor, useCommercialModel, type CommercialModel } from '../../store/commercialModel';
import {
  BASIS_LABEL, flagStatus, type BidEvaluation, type CommercialFlag, type FlagDecision,
} from '../../domain/commercialEvaluation';
import { repliesTo, requestState } from '../../domain/buyerRequests';
import {
  assignmentOf, technicalSources, unlockPreconditions, type StageAssignment,
} from '../../domain/employeePortal';
import { employeeById } from '../../data/employees';
import { SEEDED_EVALUATION } from '../../data/employees';
import type { SourcingEvent } from '../../domain/types';

const who = (id: string) => employeeById(id)?.name ?? id;
const when = (at: number) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Entry point: finds the ask's assignment, then hands over to the part that needs the model. */
export function CommercialReview({ eventId, onGoTechnical }: { eventId: string; onGoTechnical: () => void }) {
  const { state } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const found = assignmentOf(event, SEEDED_EVALUATION as Record<string, StageAssignment[]>);
  if (!found) {
    return (
      <Card padded={false}>
        <Empty
          icon="▤" title="No evaluation was set up for this event"
          hint="Commercial evaluation reads the evaluators and rules the Create Event wizard froze onto the ask at publish. This event has none."
        />
      </Card>
    );
  }
  return <Review event={event} found={found} onGoTechnical={onGoTechnical} />;
}

function Review({ event, found, onGoTechnical }: {
  event: SourcingEvent; found: NonNullable<ReturnType<typeof assignmentOf>>; onGoTechnical: () => void;
}) {
  const { state, dispatch } = useStore();
  const task = taskFor(event, found.assignment, found.rules);
  const model = useCommercialModel(task, 'LANDED');
  const perms = state.currentUser.permissions;
  const technicalOnly = perms.includes('score_technical') && !perms.includes('view_commercial');
  const verdict = model.access(state.currentUser.id, {
    observer: state.observerMode,
    holdsViewCommercial: perms.includes('view_commercial') && !perms.includes('score_technical'),
  });
  const sources = technicalSources(task, state.events, SEEDED_EVALUATION as Record<string, StageAssignment[]>);
  const preconditions = unlockPreconditions(sources, state.evaluationSubmissions, state.technicalResults);

  if (technicalOnly) {
    return (
      <Card padded={false}>
        <Empty
          icon="🔒" tone="permission" title="Your role cannot read commercial evaluation"
          hint="You score the technical envelope. Under two envelopes the price stays out of your reach by design — there is no route from here to it."
        />
      </Card>
    );
  }

  if (!model.unlocked) {
    return (
      <Card title="The commercial envelope is sealed" hint="There is no commercial evaluation to read until it is unlocked.">
        <ValidationBanner
          tone="info" title="Nothing to show yet"
          action={<Button size="small" variant="secondary" onClick={onGoTechnical}>Go to the technical workspace</Button>}
        >
          Prices open only after the technical result is published, and only to the commercial evaluators —
          {' '}{found.assignment.commercialEvaluatorIds.map(who).join(', ') || 'none named yet'}. They unlock it
          from the Employee Portal, and who did it and when is recorded for good.
        </ValidationBanner>
        <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
          {preconditions.map((p) => (
            <div key={p.label} style={{ fontSize: 12.5, display: 'flex', gap: 8 }}>
              <span style={{ color: p.met ? color.successText : color.dangerText, fontWeight: 700 }}>{p.met ? '✓' : '✕'}</span>
              {p.label}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <Button size="small" variant="secondary" onClick={() => dispatch({ type: 'SET_SURFACE', surface: 'EMPLOYEE' })}>
            Open the Employee Portal
          </Button>
        </div>
      </Card>
    );
  }

  if (!verdict.ok) {
    return (
      <Card padded={false}>
        <Empty icon="🔒" tone="permission" title="You cannot open the commercial evaluation" hint={verdict.reason} />
      </Card>
    );
  }

  return <Body model={model} readOnlyReason={verdict.reason ?? 'Read only — the evaluators make the changes.'} />;
}

function Body({ model, readOnlyReason }: { model: CommercialModel; readOnlyReason: string }) {
  const { state } = useStore();
  const event = model.task.event;
  const currency = event.currency;
  const { result } = model;
  const reviews = state.commercialReviews.filter((r) => r.eventId === event.id);
  const decisions = state.commercialFlagDecisions.filter((d) => d.eventId === event.id);
  const requests = state.buyerRequests.filter((r) => r.eventId === event.id);
  const record = state.commercialResults.find((r) => r.eventId === event.id);
  const audit = state.commercialAudit.filter((e) => e.eventId === event.id).slice().reverse();
  const [open, setOpen] = React.useState<string | null>(result.ranked[0]?.bidderId ?? null);
  const blocking = model.flags.filter((f) => f.severity === 'BLOCKING' && !flagStatus(f, decisions));
  const reviewed = reviews.filter((r) => r.status === 'REVIEWED').length;
  const openRequests = requests.filter((r) => r.status === 'OPEN').length;

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <ValidationBanner tone={record ? 'success' : 'info'} title={record ? 'Commercial evaluation complete' : 'Commercial evaluation in progress'}>
        {record
          ? `Completed ${when(record.completedAt)} by ${who(record.completedBy)} on the ${BASIS_LABEL[record.basis].toLowerCase()} basis. The figures below are frozen and feed the comparison sheet and the award note.`
          : 'These figures are live and will move as the evaluators work. They are final only once the evaluation is completed.'}
        {' '}{readOnlyReason}
      </ValidationBanner>

      <KpiRow
        kpis={[
          { icon: '#', value: `${result.ranked.length} of ${model.bidders.length}`, label: 'Bids ranked', iconBg: color.brandPrimarySoft, iconFg: color.brandPrimary },
          { icon: '✓', value: `${reviewed} of ${model.bidders.length}`, label: 'Reviewed', iconBg: color.successSoft, iconFg: color.successText },
          { icon: '⚑', value: String(blocking.length), label: 'Blocking flags open', iconBg: blocking.length > 0 ? color.dangerSoft : color.neutralSoft, iconFg: blocking.length > 0 ? color.dangerText : color.textSecondary },
          { icon: '✉', value: String(openRequests), label: 'Questions with suppliers', iconBg: color.warningSoft, iconFg: color.warningText },
          { icon: '#', value: `#${model.hash}`, label: 'Frozen model', iconBg: color.neutralSoft, iconFg: color.textSecondary, valueSize: 15 },
        ]}
      />

      <Card
        padded={false}
        title="Evaluated ranking"
        hint={`${model.rules.method === 'QCBS' ? `QCBS — technical ${model.rules.technicalWeight}%, price ${100 - model.rules.technicalWeight}% (ratio form: 100 × Cmin ÷ Ci)` : 'L1 — the lowest evaluated cost wins'}. Compared on the ${BASIS_LABEL[model.rules.basis].toLowerCase()} basis. Open a row to see its calculation trail.`}
      >
        <div className="rfx-scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {['', 'Bidder', 'Quoted', 'Adjustments', 'Evaluated', 'Price component', 'Commercial terms', 'Standing'].map((h, i) => (
                  <th key={h + i} style={{ textAlign: i >= 2 && i <= 6 ? 'right' : 'left', padding: '9px 11px', fontSize: 11, color: color.textSecondary, fontWeight: 600, borderBottom: `1px solid ${color.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...result.bids].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((bid) => (
                <React.Fragment key={bid.bidderId}>
                  <Row model={model} bid={bid} currency={currency} open={open === bid.bidderId}
                    onToggle={() => setOpen(open === bid.bidderId ? null : bid.bidderId)} />
                  {open === bid.bidderId && (
                    <tr>
                      <td colSpan={8} style={{ background: color.surface, padding: '10px 14px 14px' }}>
                        <TrailView bid={bid} currency={currency} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {model.withheld.length > 0 && (
        <ValidationBanner tone="info" title="Prices that were never opened">
          {model.withheld.map((w) => `${w.name} — ${w.reason}`).join(' · ')}. Their commercial envelopes stay sealed because they did not clear the technical gate.
        </ValidationBanner>
      )}

      <FlagList model={model} decisions={decisions} />

      <Card padded={false} title="Questions put to suppliers" hint="Raised by the evaluators, answered on the supplier portal.">
        {requests.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: color.textSecondary }}>No supplier has been asked anything.</div>
        ) : requests.map((r) => {
          const status = requestState(r, state.buyerReplies);
          const last = repliesTo(r.id, state.buyerReplies).pop();
          return (
            <div key={r.id} style={{ padding: '11px 16px', borderTop: `1px solid ${color.border}`, fontSize: 12.5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{model.name(r.bidderId)}</strong> — {r.subject}
                <Chip tone={status === 'CLOSED' ? 'success' : status === 'REPLIED' ? 'brand' : 'gold'}>
                  {status === 'CLOSED' ? (r.accepted ? 'reply accepted' : 'closed') : status === 'REPLIED' ? 'replied' : 'waiting for supplier'}
                </Chip>
              </div>
              {last && <div style={{ color: color.textSecondary, marginTop: 3 }}>“{last.text}”{last.revisedValidityDays ? ` — offer now valid ${last.revisedValidityDays} days` : ''}</div>}
            </div>
          );
        })}
      </Card>

      <Card padded={false} title="Change log" hint="Every change to a number, with actor, before, after and reason — for the approver who audits it later.">
        {audit.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: color.textSecondary }}>Nothing has been changed yet.</div>
        ) : (
          <div className="rfx-scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['When', 'Who', 'What', 'Before', 'After', 'Reason'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 11px', fontSize: 11, color: color.textSecondary, borderBottom: `1px solid ${color.border}` }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {audit.slice(0, 60).map((e) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${color.border}` }}>
                    <td style={{ padding: '7px 11px', whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                    <td style={{ padding: '7px 11px' }}>{who(e.actor)}</td>
                    <td style={{ padding: '7px 11px' }}><Chip>{e.action.toLowerCase()}</Chip> {e.subject}</td>
                    <td style={{ padding: '7px 11px', color: color.textSecondary }}>{e.before ?? '—'}</td>
                    <td style={{ padding: '7px 11px', fontWeight: 600 }}>{e.after ?? '—'}</td>
                    <td style={{ padding: '7px 11px', color: color.textSecondary }}>{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ model, bid, currency, open, onToggle }: {
  model: CommercialModel; bid: BidEvaluation; currency: string; open: boolean; onToggle: () => void;
}) {
  const standing = bid.rank !== null ? null
    : !bid.responsive ? 'Fails a knockout'
      : !bid.schedule.complete ? `Partial · ${bid.schedule.requiredPriced} of ${bid.schedule.requiredCount} lines`
        : 'Not rankable';
  return (
    <tr style={{ borderTop: `1px solid ${color.border}`, background: bid.rank === 1 ? '#F0FDF4' : undefined }}>
      <td style={{ padding: '9px 11px', width: 36 }}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the calculation trail for ${model.name(bid.bidderId)}`}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: color.textSecondary }}>
          {open ? '▾' : '▸'}
        </button>
      </td>
      <td style={{ padding: '9px 11px', fontWeight: bid.rank === 1 ? 700 : 500 }}>
        {model.name(bid.bidderId)}
        {bid.terms.preference && <span style={{ marginLeft: 6 }}><Chip tone="info" title="A preferred supplier within the margin of L1 may be invited to match it">{bid.terms.preference === 'MSE' ? 'MSE' : 'Make in India'}</Chip></span>}
        {bid.preferenceEligible && <div style={{ fontSize: 10.5, color: color.textSecondary }}>within the preference margin of L1</div>}
      </td>
      <td style={{ padding: '9px 11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(bid.quotedTotal, currency)}</td>
      <td style={{ padding: '9px 11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: savingsColor(-(bid.transformed - bid.quotedTotal)) }}>
        {signedMoney(bid.transformed - bid.quotedTotal, currency)}
      </td>
      <td style={{ padding: '9px 11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{money(bid.transformed, currency)}</td>
      <td style={{ padding: '9px 11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{bid.priceComponent === null ? '—' : bid.priceComponent.toFixed(1)}</td>
      <td style={{ padding: '9px 11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {bid.commercialScore.score === null ? '—' : bid.commercialScore.score.toFixed(1)}
      </td>
      <td style={{ padding: '9px 11px' }}>
        {bid.rank !== null
          ? <Chip tone={bid.rank === 1 ? 'success' : 'neutral'} icon={bid.rank === 1 ? '★' : undefined}>Rank {bid.rank}{bid.tied ? ' (tied)' : ''}</Chip>
          : <Chip tone="danger" icon="✕" title={bid.knockouts.map((k) => k.text).join('\n')}>{standing}</Chip>}
      </td>
    </tr>
  );
}

function TrailView({ bid, currency }: { bid: BidEvaluation; currency: string }) {
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#fff', overflow: 'hidden', fontSize: 12 }}>
      {bid.trail.map((e) => {
        const strong = e.kind === 'QUOTED' || e.kind === 'RESULT';
        return (
          <div
            key={e.id}
            style={{
              display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(0,1.6fr) 110px 150px', gap: 10,
              padding: '7px 12px', borderTop: e.kind === 'QUOTED' ? 'none' : `1px solid ${color.border}`,
              fontWeight: strong ? 700 : 400, background: strong ? color.surface : undefined,
            }}
          >
            <span>{e.label}</span>
            <span style={{ color: color.textSecondary, fontWeight: 400 }}>{e.detail}</span>
            <span style={{ color: color.textSecondary, fontWeight: 400 }}>{e.origin ? e.origin.toLowerCase() : ''}</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: !strong && e.amount < 0 ? color.successText : undefined }}>
              {strong ? money(e.amount, currency) : signedMoney(e.amount, currency)}
            </span>
          </div>
        );
      })}
      {bid.proposals.length > 0 && (
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${color.border}`, color: color.textSecondary }}>
          {bid.proposals.length} agent proposal{bid.proposals.length === 1 ? '' : 's'} awaiting a decision are not in this total: {bid.proposals.map((p) => p.name).join(', ')}.
        </div>
      )}
    </div>
  );
}

function FlagList({ model, decisions }: { model: CommercialModel; decisions: FlagDecision[] }) {
  const shown = model.flags.filter((f) => f.severity !== 'INFO');
  const decide = (f: CommercialFlag) => decisions.find((d) => d.key === f.key) ?? null;
  return (
    <Card padded={false} title={`Flags (${shown.length})`} hint="What the evaluators found, and what each did about it. A blocking flag has to be dealt with before the evaluation completes.">
      {shown.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12.5, color: color.textSecondary }}>Nothing is flagged.</div>
      ) : shown.map((f) => {
        const d = decide(f);
        return (
          <div key={f.key} style={{ padding: '10px 16px', borderTop: `1px solid ${color.border}`, fontSize: 12.5 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip tone={f.severity === 'BLOCKING' ? 'danger' : 'gold'} icon={f.severity === 'BLOCKING' ? '✕' : '▲'}>{f.severity === 'BLOCKING' ? 'blocking' : 'warning'}</Chip>
              <strong>{f.title}</strong>
              {f.code === 'IDENTICAL_PRICING' && <Chip tone="danger" icon="⚑">integrity signal</Chip>}
              {d ? <Chip tone="success" icon="✓">{d.action.toLowerCase()} · {who(d.by)}</Chip> : <Chip tone="neutral">open</Chip>}
            </div>
            <div style={{ color: color.textSecondary, marginTop: 3 }}>{f.detail}</div>
            {d?.note && <div style={{ marginTop: 3 }}>“{d.note}”</div>}
          </div>
        );
      })}
    </Card>
  );
}

