/**
 * Which ask of a sourcing event a tab is showing.
 *
 * A sourcing event runs as a chain of asks — RFI, then RFP, then RFQ, then the
 * auction — each with its own questionnaire, invitations and responses. The
 * umbrella event's tabs used to merge all of them, so an event sitting at RFP
 * still opened on the RFI's questions and answers. The tabs now show one ask at
 * a time, starting at the stage the event has reached, and the buyer can step
 * back to an earlier one to see what qualified a supplier.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { stageEventsOf, type AppState } from '../store/store';
import { SOLICITATION_STAGES } from '../domain/stageEvents';
import type { SourcingEvent } from '../domain/types';

const chosen = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export interface StageScope {
  /** The asks of this event, in the order the journey runs them. Empty for an ask or a plain event. */
  stages: SourcingEvent[];
  /** The ask being shown. */
  active: SourcingEvent | null;
  choose: (eventId: string) => void;
}

export function useStageScope(state: AppState, eventId: string): StageScope {
  const version = React.useSyncExternalStore(subscribe, () => chosen.get(eventId) ?? '');
  const parent = state.events.find((e) => e.id === eventId);
  const stages = stageEventsOf(state, eventId)
    .slice()
    .sort((a, b) => SOLICITATION_STAGES.indexOf(a.stagesEnabled[0] as never) - SOLICITATION_STAGES.indexOf(b.stagesEnabled[0] as never));
  const active = stages.find((s) => s.id === version)
    ?? stages.find((s) => s.stagesEnabled[0] === parent?.currentStage)
    ?? stages[0] ?? null;
  return {
    stages, active,
    choose: (id) => { chosen.set(eventId, id); listeners.forEach((l) => l()); },
  };
}

const STATE_TEXT: Partial<Record<string, string>> = {
  DRAFT: 'not issued', PUBLISHED: 'issued', OPEN: 'open',
};

/** The strip that says which ask the tab below belongs to. */
export function StageSwitch({ scope, currentStage }: { scope: StageScope; currentStage: string }) {
  if (scope.stages.length < 2 || !scope.active) return null;
  return (
    <div
      role="tablist" aria-label="Stage"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        border: `1px solid ${color.border}`, borderRadius: radius.card, background: '#fff', padding: '8px 12px',
      }}
    >
      <span style={{ fontSize: 12, color: color.textSecondary, marginRight: 4 }}>Showing</span>
      {scope.stages.map((s) => {
        const stage = s.stagesEnabled[0];
        const on = s.id === scope.active!.id;
        const note = stage === currentStage ? 'current' : (STATE_TEXT[s.status] ?? 'upcoming');
        return (
          <button
            key={s.id} type="button" role="tab" aria-selected={on}
            onClick={() => scope.choose(s.id)}
            style={{
              border: `1px solid ${on ? color.brandPrimary : color.border}`, borderRadius: radius.pill,
              background: on ? color.brandPrimarySoft : '#fff', color: on ? color.brandPrimary : color.textPrimary,
              padding: '4px 12px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
            }}
          >
            {stage} <span style={{ fontWeight: 400, opacity: 0.8 }}>· {note}</span>
          </button>
        );
      })}
      <span style={{ fontSize: 12, color: color.textSecondary }}>
        {scope.active.eventNumber}
      </span>
    </div>
  );
}
