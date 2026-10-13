/**
 * Event workspace — Timeline.
 *
 * The schedule as it now stands, the rules it is governed by, and the only
 * supported way to move a date.
 *
 * Extending is not an edit box. A deadline is what suppliers organise their
 * week around, so moving one asks for a reason from a fixed list, a narrative
 * that goes to them verbatim, who is being told and how, a second approver when
 * it is a long one — and it is refused outright when the rules the event was
 * published under say it cannot happen. Everything granted is kept against the
 * ask, because "why did this close three days late" is asked months later by
 * someone who was not in the room.
 */
import React from 'react';
import { color, radius } from '../../design-system/tokens';
import {
  Button, Chip, Field, Select, Textarea, Toggle,
} from '../../design-system/components/primitives';
import { Card, Empty, Table, type Column } from '../../design-system/components/layout';
import { Modal, ValidationBanner } from '../../design-system/components/domain';
import { scheduleOf, timelineRulesOf, useStore, type ScheduledAsk } from '../../store/store';
import {
  EXTENSION_REASON_LABEL, HOUR_MS, NOTIFY_AUDIENCE_LABEL, NOTIFY_CHANNEL_LABEL,
  TIMELINE_STATUS_LABEL, applyExtension, describeRules, extensionAllowance, extensionIssues,
  rescheduleAfterExtension, timelineStatus,
  type EventExtension, type ExtensionReason, type ExtensionRequest, type NotifyAudience,
  type NotifyChannel, type TimelineRules,
} from '../../domain/eventTimeline';
import { STAGE_LABELS } from '../../domain/journeyPatterns';
import { serverNow } from '../../server/clock';
import { USERS } from '../../data/seed';

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
};

const when = (at: number) => new Date(at).toLocaleString([], DATE_TIME);

export function TimelineTab({ eventId }: { eventId: string }) {
  const { state, dispatch } = useStore();
  const event = state.events.find((e) => e.id === eventId)!;
  const rootId = event.parentEventId ?? eventId;
  const rules = timelineRulesOf(state, rootId);
  const schedule = scheduleOf(state, rootId);
  const now = serverNow();

  const [extending, setExtending] = React.useState<string | null>(null);
  const open = schedule.find((ask) => ask.event.id === extending) ?? null;

  if (schedule.length === 0) {
    return (
      <Card padded={false}>
        <Empty
          icon="◷"
          title="This event has no dated asks"
          hint="A schedule appears once the event creates an RFI, RFP, RFQ or auction. A journey that solicits nobody has no response deadline to keep."
        />
      </Card>
    );
  }

  const history = schedule.flatMap((ask) => ask.extensions);

  return (
    <div className="rfx-stack" style={{ gap: 14 }}>
      <Card
        title="Rules in force"
        hint="Set on the Timeline step and frozen onto this event at publish. An extension is judged against these, not against today's tenant default."
      >
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>{describeRules(rules)}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Chip tone="neutral">Timezone {rules.timezone}</Chip>
          <Chip tone="neutral">
            Told on {rules.notifyChannels.map((c) => NOTIFY_CHANNEL_LABEL[c]).join(' · ') || 'nothing'}
          </Chip>
          <Chip tone="neutral">{NOTIFY_AUDIENCE_LABEL[rules.notifyAudience]}</Chip>
          {rules.approvalRequiredBeyondHours > 0 && (
            <Chip tone="info">Second approver past {rules.approvalRequiredBeyondHours}h</Chip>
          )}
          {rules.autoExtendAuction && (
            <Chip tone="purple" title="A bid in the closing moments extends the auction for everyone">
              Soft close {rules.autoExtendMinutes}m × {rules.maxAutoExtensions}
            </Chip>
          )}
        </div>
      </Card>

      <Card
        padded={false}
        title="Schedule"
        hint="One row per ask, in the order the journey issues them. Only the close date is stored; an opening follows the ask before it."
      >
        <ScheduleGrid
          schedule={schedule}
          rules={rules}
          now={now}
          currentEventId={eventId}
          onExtend={setExtending}
        />
      </Card>

      <Card
        padded={false}
        title={`Extensions${history.length > 0 ? ` (${history.length})` : ''}`}
        hint="Append-only. Every deadline that moved, with who asked, who approved and what suppliers were told."
      >
        <ExtensionHistory extensions={history} />
      </Card>

      {open && (
        <ExtendDialog
          ask={open}
          rules={rules}
          schedule={schedule}
          now={now}
          onClose={() => setExtending(null)}
          onExtend={(extension, closes) => {
            dispatch({ type: 'EXTEND_EVENT', extension, closes });
            setExtending(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

function ScheduleGrid({
  schedule, rules, now, currentEventId, onExtend,
}: {
  schedule: ScheduledAsk[];
  rules: TimelineRules;
  now: number;
  currentEventId: string;
  onExtend: (eventId: string) => void;
}) {
  const columns: Column<ScheduledAsk>[] = [
    {
      key: 'ask', header: 'Ask', width: '190px',
      render: (ask) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {STAGE_LABELS[ask.stage]}
            {ask.event.id === currentEventId && (
              <Chip tone="brand" title="The ask you are looking at">this one</Chip>
            )}
          </div>
          <div style={{ fontSize: 11, color: color.textSecondary, marginTop: 2 }}>
            {ask.event.eventNumber}
          </div>
        </div>
      ),
    },
    {
      key: 'status', header: 'Standing', width: '130px',
      render: (ask) => {
        // A planned ask has not been issued, so it is not open or closed — it is
        // scheduled, and saying "closed" about it would be a lie.
        if (ask.event.status === 'DRAFT') return <Chip tone="neutral">planned</Chip>;
        const status = timelineStatus(ask.window, now);
        return (
          <Chip tone={status === 'CLOSED' ? 'neutral' : status === 'CLOSING_SOON' ? 'gold' : 'brand'}>
            {TIMELINE_STATUS_LABEL[status]}
          </Chip>
        );
      },
    },
    { key: 'opens', header: 'Opens', render: (ask) => when(ask.window.opensAt) },
    {
      key: 'closes', header: 'Closes',
      render: (ask) => (
        <span>
          {when(ask.window.closesAt)}
          {ask.extensions.length > 0 && (
            <div style={{ fontSize: 10.5, color: color.textSecondary }}>
              was {when(ask.extensions[0].previousCloseAt)}
            </div>
          )}
        </span>
      ),
    },
    {
      key: 'duration', header: 'Open for', numeric: true,
      render: (ask) => `${ask.window.durationHours}h`,
    },
    {
      key: 'clarifications', header: 'Clarifications close',
      render: (ask) => (ask.stage === 'AUCTION'
        ? <span style={{ color: color.textMuted }}>—</span>
        : (
          <span style={{ color: now >= ask.window.clarificationsCloseAt ? color.textMuted : color.textPrimary }}>
            {when(ask.window.clarificationsCloseAt)}
          </span>
        )),
    },
    {
      key: 'extensions', header: 'Extensions', width: '120px',
      render: (ask) => {
        const allowance = extensionAllowance({
          history: ask.extensions, rules, now, window: ask.window, nextOpensAt: null,
          issued: ask.event.status !== 'DRAFT',
        });
        return (
          <span title={allowance.blockedReason ?? undefined}>
            {allowance.used} of {rules.maxExtensions}
            {allowance.hoursUsed > 0 && (
              <div style={{ fontSize: 10.5, color: color.textSecondary }}>
                +{allowance.hoursUsed}h so far
              </div>
            )}
          </span>
        );
      },
    },
    {
      key: 'action', header: '', width: '110px',
      render: (ask) => {
        const allowance = extensionAllowance({
          history: ask.extensions, rules, now, window: ask.window,
          nextOpensAt: nextOpeningOf(schedule, ask),
          issued: ask.event.status !== 'DRAFT',
        });
        const planned = ask.event.status === 'DRAFT';
        const blocked = planned || allowance.blockedReason !== null;
        return (
          <Button
            size="small"
            variant="secondary"
            disabled={blocked}
            title={
              planned
                ? 'This ask has not been issued. Change its dates rather than extending it — nobody has been told the old one.'
                : allowance.blockedReason ?? undefined
            }
            onClick={() => onExtend(ask.event.id)}
          >
            Extend
          </Button>
        );
      },
    },
  ];

  return <Table columns={columns} rows={schedule} rowKey={(ask) => ask.event.id} />;
}

/** The opening of the ask that follows this one, when there is one. */
function nextOpeningOf(schedule: ScheduledAsk[], ask: ScheduledAsk): number | null {
  const index = schedule.findIndex((entry) => entry.event.id === ask.event.id);
  return index === -1 || index === schedule.length - 1 ? null : schedule[index + 1].window.opensAt;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function ExtensionHistory({ extensions }: { extensions: EventExtension[] }) {
  const rows = [...extensions].sort((a, b) => b.createdAt - a.createdAt);
  const nameOf = (id: string) => USERS.find((u) => u.id === id)?.name ?? id;

  const columns: Column<EventExtension>[] = [
    {
      key: 'stage', header: 'Ask', width: '120px',
      render: (extension) => (
        <div>
          <div style={{ fontWeight: 600 }}>{STAGE_LABELS[extension.stage]}</div>
          <div style={{ fontSize: 10.5, color: color.textSecondary }}>
            #{extension.sequence}
            {extension.isReopen && ' · reopened'}
          </div>
        </div>
      ),
    },
    {
      key: 'moved', header: 'Moved', width: '210px',
      render: (extension) => (
        <span style={{ fontSize: 12 }}>
          {when(extension.previousCloseAt)} → <strong>{when(extension.newCloseAt)}</strong>
          <div style={{ fontSize: 10.5, color: color.textSecondary }}>+{extension.addedHours}h</div>
        </span>
      ),
    },
    {
      key: 'reason', header: 'Reason',
      render: (extension) => (
        <div>
          <Chip tone="info">{EXTENSION_REASON_LABEL[extension.reason]}</Chip>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>{extension.narrative}</div>
          {extension.corrigendumReference && (
            <div style={{ fontSize: 10.5, color: color.textSecondary, marginTop: 2 }}>
              Corrigendum {extension.corrigendumReference}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'told', header: 'Suppliers told', width: '150px',
      render: (extension) => (
        <span style={{ fontSize: 11.5 }}>
          {extension.notifyChannels.map((c) => NOTIFY_CHANNEL_LABEL[c]).join(' · ')}
          <div style={{ color: color.textSecondary }}>
            {NOTIFY_AUDIENCE_LABEL[extension.notifyAudience]}
          </div>
        </span>
      ),
    },
    {
      key: 'who', header: 'Authorised by', width: '170px',
      render: (extension) => (
        <span style={{ fontSize: 11.5 }}>
          {nameOf(extension.requestedBy)}
          <div style={{ color: color.textSecondary }}>
            {extension.approvedBy === null
              ? 'no second approver required'
              : `approved by ${nameOf(extension.approvedBy)}`}
          </div>
          <div style={{ color: color.textSecondary }}>{when(extension.createdAt)}</div>
        </span>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(extension) => extension.id}
      empty={
        <Empty
          icon="◷"
          title="No deadline has been moved on this event"
          hint="Extensions are recorded here as they are granted, with the reason suppliers were given."
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Extending
// ---------------------------------------------------------------------------

function ExtendDialog({
  ask, rules, schedule, now, onClose, onExtend,
}: {
  ask: ScheduledAsk;
  rules: TimelineRules;
  schedule: ScheduledAsk[];
  now: number;
  onClose: () => void;
  onExtend: (extension: EventExtension, closes: { eventId: string; closesAt: number }[]) => void;
}) {
  const { state } = useStore();
  const allowance = extensionAllowance({
    history: ask.extensions, rules, now, window: ask.window,
    nextOpensAt: nextOpeningOf(schedule, ask),
    issued: ask.event.status !== 'DRAFT',
  });

  const [addHours, setAddHours] = React.useState(
    Math.min(24, rules.maxExtensionHoursEach, allowance.hoursRemaining || 24),
  );
  const [reason, setReason] = React.useState<ExtensionReason>('CLARIFICATION_PENDING');
  const [narrative, setNarrative] = React.useState('');
  const [corrigendum, setCorrigendum] = React.useState('');
  const [channels, setChannels] = React.useState<NotifyChannel[]>(rules.notifyChannels);
  const [audience, setAudience] = React.useState<NotifyAudience>(rules.notifyAudience);
  const [reopenClarifications, setReopenClarifications] = React.useState(true);
  const [approver, setApprover] = React.useState<string>('');

  const base = Math.max(ask.window.closesAt, now);
  const newCloseAt = base + addHours * HOUR_MS;

  const request: ExtensionRequest = {
    eventId: ask.event.id,
    stage: ask.stage,
    currentCloseAt: ask.window.closesAt,
    newCloseAt,
    reason,
    narrative,
    notifyChannels: channels,
    notifyAudience: audience,
    corrigendumReference: corrigendum.trim() === '' ? null : corrigendum,
    reopenClarifications,
    requestedBy: state.currentUser.id,
    approvedBy: approver === '' ? null : approver,
  };

  const context = {
    history: ask.extensions,
    rules,
    now,
    window: ask.window,
    nextOpensAt: nextOpeningOf(schedule, ask),
    issued: ask.event.status !== 'DRAFT',
  };

  const issues = extensionIssues(request, context);
  const blocking = issues.filter((issue) => issue.blocking);
  const errorFor = (field: string) =>
    blocking.find((issue) => issue.field === field)?.message;

  // What this does to the asks behind it, shown before the button rather than
  // discovered after: under SHIFT they all move, under ABSORB none do.
  const after = rescheduleAfterExtension(
    schedule.map((entry) => entry.window), ask.stage, newCloseAt, rules,
  );
  const moved = schedule
    .map((entry, i) => ({ entry, next: after[i] }))
    .filter(({ entry, next }) => next.closesAt !== entry.window.closesAt);

  const needsApproval = addHours > rules.approvalRequiredBeyondHours;

  const submit = () => {
    const result = applyExtension(request, context, schedule.map((entry) => entry.window));
    onExtend(
      result.extension,
      schedule.map((entry, i) => ({
        eventId: entry.event.id,
        closesAt: result.schedule[i].closesAt,
      })).filter((close, i) => close.closesAt !== schedule[i].window.closesAt),
    );
  };

  return (
    <Modal
      open
      width={640}
      title={`Extend ${STAGE_LABELS[ask.stage]} — ${ask.event.eventNumber}`}
      onClose={onClose}
      onConfirm={submit}
      confirmLabel={needsApproval ? 'Extend with approval' : 'Extend and notify'}
      confirmDisabled={blocking.length > 0}
    >
      <div className="rfx-stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 12.5, color: color.textSecondary }}>
          Closes <strong style={{ color: color.textPrimary }}>{when(ask.window.closesAt)}</strong>.
          {' '}
          {allowance.remaining} of {rules.maxExtensions} extensions left,
          {' '}{allowance.hoursRemaining}h of the total budget.
          {ask.window.closesAt <= now && ' This ask has already closed — extending it reopens it.'}
        </div>

        <Field
          label="Add"
          hint={`At most ${rules.maxExtensionHoursEach}h in one extension on this event.`}
          error={errorFor('newCloseAt')}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[12, 24, 48, 72].filter((hours) => hours <= rules.maxExtensionHoursEach).map((hours) => (
              <button
                key={hours}
                type="button"
                onClick={() => setAddHours(hours)}
                style={{
                  border: `1px solid ${addHours === hours ? color.brandPrimary : color.border}`,
                  background: addHours === hours ? '#F5F8FF' : '#fff',
                  color: addHours === hours ? color.brandPrimary : color.textSecondary,
                  borderRadius: radius.control, padding: '6px 12px', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: addHours === hours ? 600 : 400,
                }}
              >
                +{hours}h
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={addHours}
              onChange={(e) => setAddHours(Number(e.target.value) || 0)}
              style={{
                width: 90, border: `1px solid ${color.border}`, borderRadius: radius.control,
                padding: '6px 10px', fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>
        </Field>

        <div
          style={{
            background: color.surface, border: `1px solid ${color.border}`,
            borderRadius: radius.control, padding: '10px 12px', fontSize: 12.5,
          }}
        >
          New deadline <strong>{when(newCloseAt)}</strong>
          <div style={{ color: color.textSecondary, marginTop: 4 }}>
            {moved.length <= 1
              ? rules.cascade === 'ABSORB'
                ? 'Nothing behind it moves — this event absorbs extensions and keeps its end date.'
                : 'No later ask to move.'
              : `${moved.length - 1} later ${moved.length - 1 === 1 ? 'ask moves' : 'asks move'} by the same ${addHours}h: ${moved.slice(1).map(({ entry, next }) => `${STAGE_LABELS[entry.stage]} now closes ${when(next.closesAt)}`).join(', ')}.`}
          </div>
        </div>

        <Field label="Reason" hint="Reported on quarterly — a narrative alone cannot be counted.">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ExtensionReason)}>
            {(Object.keys(EXTENSION_REASON_LABEL) as ExtensionReason[]).map((key) => (
              <option key={key} value={key}>{EXTENSION_REASON_LABEL[key]}</option>
            ))}
          </Select>
        </Field>

        {reason === 'CORRIGENDUM_ISSUED' && (
          <Field label="Corrigendum reference" error={errorFor('corrigendumReference')}>
            <input
              value={corrigendum}
              onChange={(e) => setCorrigendum(e.target.value)}
              placeholder="COR-2026-004"
              style={{
                width: '100%', border: `1px solid ${color.border}`, borderRadius: radius.control,
                padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </Field>
        )}

        <Field
          label="What suppliers are told"
          hint={`Sent verbatim. At least ${rules.minReasonLength} characters — ${narrative.trim().length} so far.`}
          error={errorFor('narrative')}
        >
          <Textarea
            rows={3}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="Two clarifications on the specification are still unanswered, so the deadline moves to give everyone the same time to price the answer."
          />
        </Field>

        <Field label="Tell them on" error={errorFor('notifyChannels')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['EMAIL', 'IN_APP', 'SMS'] as NotifyChannel[]).map((channel) => {
              const on = channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setChannels(
                    on ? channels.filter((c) => c !== channel) : [...channels, channel],
                  )}
                  style={{
                    border: `1px solid ${on ? color.brandPrimary : color.border}`,
                    background: on ? '#F5F8FF' : '#fff',
                    color: on ? color.brandPrimary : color.textSecondary,
                    borderRadius: radius.control, padding: '6px 12px', cursor: 'pointer',
                    fontSize: 12.5, fontWeight: on ? 600 : 400,
                  }}
                >
                  {NOTIFY_CHANNEL_LABEL[channel]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Who is told">
          <Select value={audience} onChange={(e) => setAudience(e.target.value as NotifyAudience)}>
            {(Object.keys(NOTIFY_AUDIENCE_LABEL) as NotifyAudience[]).map((key) => (
              <option key={key} value={key}>{NOTIFY_AUDIENCE_LABEL[key]}</option>
            ))}
          </Select>
        </Field>

        {ask.stage !== 'AUCTION' && (
          <Toggle
            checked={reopenClarifications}
            onChange={setReopenClarifications}
            label={`Reopen clarifications until ${rules.clarificationCutoffHours}h before the new deadline`}
          />
        )}

        {needsApproval && (
          <Field
            label="Second approver"
            hint={`Required past ${rules.approvalRequiredBeyondHours}h. Cannot be you.`}
            error={errorFor('approvedBy')}
          >
            <Select value={approver} onChange={(e) => setApprover(e.target.value)}>
              <option value="">Select an approver…</option>
              {USERS.filter((user) => user.id !== state.currentUser.id).map((user) => (
                <option key={user.id} value={user.id}>{user.name} — {user.role}</option>
              ))}
            </Select>
          </Field>
        )}

        {blocking.length > 0 && (
          <ValidationBanner tone="error" title="This extension cannot be granted yet">
            <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
              {blocking.map((issue) => <li key={issue.field + issue.message}>{issue.message}</li>)}
            </ul>
          </ValidationBanner>
        )}

        <div style={{ fontSize: 11.5, color: color.textSecondary }}>
          Granting this records the old and the new date, the reason, the narrative, the channels
          and both names against {ask.event.eventNumber}. It cannot be edited afterwards — a further
          change is another extension.
        </div>
      </div>
    </Modal>
  );
}
