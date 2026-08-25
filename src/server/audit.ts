/**
 * The audit ledger. Append-only; entries are never updated or removed.
 *
 * Every state change records actor, timestamp, before/after and reason. Every
 * live-auction controller action is written *before* it takes effect.
 */
import type { AuditEntry, Id } from '../domain/types';
import { serverNow } from './clock';

const entries: AuditEntry[] = [];
let counter = 0;

export interface AuditInput {
  eventId: Id | null;
  objectType: string;
  objectId: Id;
  action: string;
  actorId: Id;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export function record(input: AuditInput): AuditEntry {
  counter += 1;
  const entry: AuditEntry = {
    id: `audit-${counter}`,
    eventId: input.eventId,
    objectType: input.objectType,
    objectId: input.objectId,
    action: input.action,
    actorId: input.actorId,
    at: serverNow(),
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
  };
  entries.push(entry);
  return entry;
}

/** A read-only view. Callers cannot mutate the ledger through this. */
export function auditTrail(eventId?: Id): readonly AuditEntry[] {
  const all = eventId ? entries.filter((e) => e.eventId === eventId) : entries;
  return [...all].sort((a, b) => b.at - a.at);
}

export function seedAudit(seeded: AuditEntry[]): void {
  entries.push(...seeded);
  counter = Math.max(counter, seeded.length);
}
