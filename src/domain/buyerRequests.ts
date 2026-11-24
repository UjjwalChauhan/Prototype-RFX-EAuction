/**
 * What an evaluator asks a supplier, and what the supplier is told.
 *
 * A commercial evaluator who finds a missing price, a wrong total or an offer
 * that expires too soon cannot fix it — only the supplier can. So the question
 * leaves the buyer's side, reaches the supplier's portal, and the answer comes
 * back for the evaluator to accept or not. Nothing about that exchange reveals
 * how the supplier's number is being read: the supplier is asked a plain
 * question and told when the price check is done. They are never told a rank,
 * an adjustment, or that their price was converted or compared to anyone's.
 *
 * Two kinds of row, one owner each, which is how they cross the sync seam
 * without a conflict story: the buyer owns requests, the supplier owns replies.
 */
import type { Id } from './types';

export type RequestKind =
  | 'ARITHMETIC' | 'VALIDITY' | 'PRICE_JUSTIFICATION' | 'MISSING_PRICE' | 'DEVIATION' | 'GENERAL';

export interface BuyerRequest {
  id: Id;
  eventId: Id;
  bidderId: Id;
  kind: RequestKind;
  subject: string;
  /** Written for the supplier: plain language, no stage or scoring vocabulary. */
  message: string;
  /** For a validity request: how many days the buyer needs the offer to stay open. */
  askValidityDays: number | null;
  raisedAt: number;
  dueAt: number;
  /** The flag it came from, so closing the request can settle the flag. Never sent on the wire as meaning. */
  flagKey: string | null;
  status: 'OPEN' | 'CLOSED';
  closedAt: number | null;
  /** Whether the evaluator accepted the supplier's answer when closing. */
  accepted: boolean;
}

export interface BuyerReply {
  id: Id;
  requestId: Id;
  eventId: Id;
  bidderId: Id;
  text: string;
  revisedValidityDays: number | null;
  attachmentName: string | null;
  repliedAt: number;
}

/** What a supplier is told about their own price check — one row per bidder. */
export interface ReviewSignal {
  id: Id;
  eventId: Id;
  bidderId: Id;
  stage: 'RECEIVED' | 'UNDER_REVIEW' | 'COMPLETE';
}

export type RequestState = 'WAITING_FOR_SUPPLIER' | 'REPLIED' | 'CLOSED';

export function repliesTo(requestId: Id, replies: BuyerReply[]): BuyerReply[] {
  return replies.filter((r) => r.requestId === requestId).sort((a, b) => a.repliedAt - b.repliedAt);
}

export function requestState(request: BuyerRequest, replies: BuyerReply[]): RequestState {
  if (request.status === 'CLOSED') return 'CLOSED';
  return repliesTo(request.id, replies).length > 0 ? 'REPLIED' : 'WAITING_FOR_SUPPLIER';
}

/** Requests still needing something from either side. */
export function openRequests(requests: BuyerRequest[], eventId: Id): BuyerRequest[] {
  return requests.filter((r) => r.eventId === eventId && r.status === 'OPEN');
}

/**
 * The validity a supplier has committed to, where the evaluator accepted an
 * answer that extended it. Never applied on the supplier's say-so alone: it
 * counts only once a person on the buyer's side has accepted the reply.
 */
export function acceptedValidity(
  eventId: Id, requests: BuyerRequest[], replies: BuyerReply[],
): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const request of requests) {
    if (request.eventId !== eventId || request.status !== 'CLOSED' || !request.accepted) continue;
    const latest = repliesTo(request.id, replies).pop();
    if (latest?.revisedValidityDays) {
      out[request.bidderId] = Math.max(out[request.bidderId] ?? 0, latest.revisedValidityDays);
    }
  }
  return out;
}

/** The three things a supplier is told about their price, in their words. */
export const SIGNAL_TEXT: Record<ReviewSignal['stage'], { label: string; note: string }> = {
  RECEIVED: {
    label: 'Prices received',
    note: 'We have your prices. They are opened once the first review is finished.',
  },
  UNDER_REVIEW: {
    label: 'Checking your prices',
    note: 'We are checking your prices. If we need anything from you, it will appear under “From the buyer”.',
  },
  COMPLETE: {
    label: 'Price check finished',
    note: 'We have finished checking the prices. You will hear about the outcome with the award decision.',
  },
};

/** How long a supplier has to answer, in a sentence they can act on. */
export function dueText(dueAt: number, now: number): string {
  const hours = Math.round((dueAt - now) / 3_600_000);
  if (hours <= 0) return 'The buyer is waiting for this now';
  if (hours < 24) return `Please reply within ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Please reply within ${days} day${days === 1 ? '' : 's'}`;
}
