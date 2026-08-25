/**
 * Envelope separation, enforced at the data layer.
 *
 * A sealed commercial envelope is *genuinely absent content*, not blurred or
 * greyed text. There is no privileged read path: no caller, including a
 * platform administrator, can obtain sealed content through this module before
 * the unlock event. Every accessor in the app goes through here.
 */
import type {
  Envelope, EnvelopeMode, Id, Permission, PriceLine, Question, Response, ServerMillis,
} from '../domain/types';
import { record } from './audit';
import { serverNow } from './clock';

export class SealedEnvelopeError extends Error {
  constructor(bidderId: Id) {
    super(
      `The commercial envelope for bidder ${bidderId} is sealed. ` +
      'No read path exists before the unlock event.',
    );
    this.name = 'SealedEnvelopeError';
  }
}

export interface ViewerContext {
  userId: Id;
  permissions: Permission[];
  envelopeMode: EnvelopeMode;
  blindTechnical: boolean;
}

/**
 * The technical projection of a response. Under two-envelope mode this never
 * contains a commercial answer or a price line, by construction — there is no
 * flag that adds them back.
 */
export interface TechnicalProjection {
  bidderId: Id;
  /** "Bidder A" under blind technical; the real name otherwise. */
  displayLabel: string;
  answers: { questionId: Id; value: unknown; attachmentName: string | null }[];
  /** Filenames that leak the bidder's identity under blind technical. */
  attachmentIdentityWarnings: string[];
}

export function projectTechnical(
  response: Response,
  questions: Question[],
  bidderName: string,
  maskedLabel: string,
  viewer: ViewerContext,
): TechnicalProjection {
  const technicalIds = new Set(
    questions.filter((q) => q.envelope === 'TECHNICAL' || q.envelope === 'GENERAL').map((q) => q.id),
  );

  const answers = response.answers
    .filter((a) => technicalIds.has(a.questionId))
    .map((a) => ({ questionId: a.questionId, value: a.value, attachmentName: a.attachmentName }));

  // Blind mode must conceal identity across the list, the answers and
  // attachment metadata.
  const warnings: string[] = [];
  if (viewer.blindTechnical) {
    const needle = bidderName.split(/\s+/)[0].toLowerCase();
    for (const answer of answers) {
      if (answer.attachmentName && answer.attachmentName.toLowerCase().includes(needle)) {
        warnings.push(
          `Attachment "${answer.attachmentName}" contains the bidder's name and would break blind evaluation.`,
        );
      }
    }
  }

  return {
    bidderId: response.bidderId,
    displayLabel: viewer.blindTechnical ? maskedLabel : bidderName,
    answers,
    attachmentIdentityWarnings: warnings,
  };
}

export interface CommercialProjection {
  bidderId: Id;
  displayLabel: string;
  priceLines: PriceLine[];
  answers: { questionId: Id; value: unknown }[];
}

/**
 * Throws while the envelope is sealed. Callers must render the sealed state
 * rather than catching and substituting placeholder numbers.
 */
export function projectCommercial(
  response: Response,
  questions: Question[],
  envelope: Envelope,
  bidderName: string,
  viewer: ViewerContext,
): CommercialProjection {
  if (viewer.envelopeMode === 'TWO_ENVELOPE' && envelope.sealed) {
    throw new SealedEnvelopeError(response.bidderId);
  }
  if (!viewer.permissions.includes('view_commercial')) {
    throw new SealedEnvelopeError(response.bidderId);
  }

  const commercialIds = new Set(
    questions.filter((q) => q.envelope === 'COMMERCIAL').map((q) => q.id),
  );

  return {
    bidderId: response.bidderId,
    displayLabel: bidderName,
    priceLines: response.priceLines,
    answers: response.answers
      .filter((a) => commercialIds.has(a.questionId))
      .map((a) => ({ questionId: a.questionId, value: a.value })),
  };
}

export function isReadableCommercial(envelope: Envelope, viewer: ViewerContext): boolean {
  if (!viewer.permissions.includes('view_commercial')) return false;
  return !(viewer.envelopeMode === 'TWO_ENVELOPE' && envelope.sealed);
}

export type UnlockMode = 'AUTO' | 'MANUAL' | 'MANUAL_WITH_WITNESS';

export interface UnlockRequest {
  envelope: Envelope;
  mode: UnlockMode;
  actorId: Id;
  witnessIds: Id[];
  permissions: Permission[];
  eventId: Id;
}

export interface UnlockResult {
  envelope: Envelope;
  unlockedAt: ServerMillis;
}

/** Irreversible, and logged with actor, timestamp and witness list. */
export function unlockCommercial(request: UnlockRequest): UnlockResult {
  if (!request.permissions.includes('unlock_commercial')) {
    throw new Error('Unlocking the commercial envelope requires the unlock_commercial permission.');
  }
  if (request.mode === 'MANUAL_WITH_WITNESS' && request.witnessIds.length < 1) {
    throw new Error('Witnessed unlock requires a second authorised user to confirm.');
  }

  const at = serverNow();
  const before = { sealed: request.envelope.sealed, status: request.envelope.status };
  const unlocked: Envelope = {
    ...request.envelope,
    sealed: false,
    status: 'UNLOCKED',
    unlockedAt: at,
    unlockedBy: request.actorId,
    witnesses: request.witnessIds,
  };

  record({
    eventId: request.eventId,
    objectType: 'Envelope',
    objectId: request.envelope.id,
    action: 'COMMERCIAL_UNLOCK',
    actorId: request.actorId,
    before,
    after: { sealed: false, status: 'UNLOCKED', witnesses: request.witnessIds },
    reason: `Unlock mode ${request.mode}. Irreversible.`,
  });

  return { envelope: unlocked, unlockedAt: at };
}
