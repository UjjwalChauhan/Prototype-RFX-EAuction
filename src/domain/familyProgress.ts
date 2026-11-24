/**
 * Where a sourcing event stands, read off what has happened to its asks.
 *
 * A sourcing event is an umbrella over its asks — an RFI, an RFP, an RFQ, an
 * auction — and each ask is where suppliers actually act. The umbrella's stage
 * was set once, at creation, to the first stage of its journey (Intake), and
 * nothing moved it: an RFI could be out, answered and under technical
 * evaluation while the event itself still read "Intake".
 *
 * Two rules, both forward-only, so nothing a buyer later sets by hand (an
 * award, an approval) is ever pulled back:
 *
 * 1. An ask that a supplier has submitted against is Open, not merely
 *    Published — responses are coming in.
 * 2. The umbrella stands at the furthest ask that has been issued to
 *    suppliers. An ask still planned (Draft) does not count; one that has gone
 *    out does, however far its evaluation has got.
 */
import { STAGE_ORDER } from './journeyPatterns';
import type { EventStatus, Response, SourcingEvent, Stage } from './types';

/** An ask in one of these has not been put in front of a supplier. */
const NOT_ISSUED: EventStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'];

export function isIssued(event: SourcingEvent): boolean {
  return !NOT_ISSUED.includes(event.status);
}

function positionIn(stages: Stage[], stage: Stage): number {
  const own = stages.indexOf(stage);
  return own >= 0 ? own : STAGE_ORDER.indexOf(stage) + stages.length;
}

/**
 * The stage an umbrella should stand at, given its asks. Null when none has
 * been issued — the event is still being prepared or approved, and keeps its
 * own stage.
 */
export function familyStage(umbrella: SourcingEvent, asks: SourcingEvent[]): Stage | null {
  const order = umbrella.stagesEnabled.length > 0 ? umbrella.stagesEnabled : STAGE_ORDER;
  const issued = asks.filter(isIssued);
  if (issued.length === 0) return null;
  return issued
    .map((ask) => ask.currentStage)
    .sort((a, b) => positionIn(order, b) - positionIn(order, a))[0];
}

/**
 * Bring every event family up to date. Returns the same array when nothing
 * moved, so callers can tell cheaply that there is nothing to re-render.
 */
export function progressFamilies(events: SourcingEvent[], responses: Response[]): SourcingEvent[] {
  const answered = new Set(responses.filter((r) => r.submittedAt !== null).map((r) => r.eventId));
  let changed = false;

  // 1 — an ask suppliers have answered is open.
  let next = events.map((event) => {
    if (event.parentEventId !== null && event.status === 'PUBLISHED' && answered.has(event.id)) {
      changed = true;
      return { ...event, status: 'OPEN' as const };
    }
    return event;
  });

  // 2 — the umbrella stands at its furthest issued ask.
  next = next.map((event) => {
    if (event.parentEventId !== null) return event;
    const asks = next.filter((e) => e.parentEventId === event.id);
    if (asks.length === 0) return event;
    const stage = familyStage(event, asks);
    if (stage === null) return event;
    const order = event.stagesEnabled.length > 0 ? event.stagesEnabled : STAGE_ORDER;
    const forward = positionIn(order, stage) > positionIn(order, event.currentStage);
    const leading = asks.find((a) => a.currentStage === stage);
    const opens = event.status === 'PUBLISHED' && leading?.status === 'OPEN';
    if (!forward && !opens) return event;
    changed = true;
    return {
      ...event,
      ...(forward ? { currentStage: stage } : {}),
      ...(opens ? { status: 'OPEN' as const } : {}),
    };
  });

  return changed ? next : events;
}
