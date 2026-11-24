/**
 * Envelope mode, decided per stage.
 *
 * An RFI, an RFP and an RFQ each ask for different things, so each gets its own
 * answer to "what is sealed, and who sees price when":
 *
 *   NONE         Nothing sealed. Buyer sees responses as they arrive. Only fit
 *                for non-binding asks (RFI, expressions of interest).
 *   SINGLE       Whole bid sealed as one packet, opened together after close.
 *                Fit when technical is pass / fail and price decides (RFQ).
 *   TWO_ENVELOPE Technical and commercial sealed separately; price opens only
 *                for bidders who passed technical. Fit for weighted scoring (RFP).
 */
import type { EnvelopeMode } from './types';

export type EnvelopeStage = 'RFI' | 'RFP' | 'RFQ';
export const ENVELOPE_STAGES: EnvelopeStage[] = ['RFI', 'RFP', 'RFQ'];

export const ENVELOPE_OPTIONS: { value: EnvelopeMode; label: string }[] = [
  { value: 'NONE', label: 'No envelope' },
  { value: 'SINGLE', label: 'Single envelope' },
  { value: 'TWO_ENVELOPE', label: 'Two envelope' },
];

export const DEFAULT_ENVELOPE: Record<EnvelopeStage, EnvelopeMode> = {
  RFI: 'NONE', RFP: 'TWO_ENVELOPE', RFQ: 'SINGLE',
};

export const ENVELOPE_SHORT: Record<EnvelopeMode, string> = {
  NONE: 'No envelope',
  SINGLE: 'Single envelope',
  TWO_ENVELOPE: 'Two envelope',
};

/** What each mode means for the buyer, in the words the stage will run under. */
export const ENVELOPE_EXPLAINER: Record<EnvelopeMode, string> = {
  NONE: 'Nothing is sealed. You see each response as it arrives, even before the deadline, and anyone with event access can see any price. Only suitable where nothing binding is asked.',
  SINGLE: 'The whole bid is sealed as one packet and opened together after bids close. Every evaluator sees price alongside the technical answers, so use it when technical is pass / fail and price decides.',
  TWO_ENVELOPE: 'Technical and commercial are sealed separately. Technical is scored first; price opens only for bidders who passed, after the technical report is approved. Technical evaluators never see price.',
};

/** A caution when the mode does not suit what the stage is doing. */
export function envelopeWarning(
  stage: EnvelopeStage, mode: EnvelopeMode, opts: { weightedTechnical: boolean; asksPrice: boolean },
): string | null {
  if (mode === 'NONE' && stage !== 'RFI') {
    return `${stage} responses are binding, so an open bid invites price leakage and bid shopping before the deadline. Choose single or two envelope.`;
  }
  if (mode === 'NONE' && opts.asksPrice) {
    return 'This RFI asks for price. Without an envelope every price is visible on arrival — treat it as indicative only.';
  }
  if (mode === 'SINGLE' && opts.weightedTechnical) {
    return 'Single envelope lets price bias a weighted technical score ("they are cheapest, so their method must be fine"). Use two envelope for weighted quality-plus-cost scoring.';
  }
  return null;
}

export function envelopeFor(
  byStage: Partial<Record<string, EnvelopeMode>> | undefined, stage: string,
): EnvelopeMode {
  const set = byStage?.[stage];
  if (set) return set;
  return DEFAULT_ENVELOPE[stage as EnvelopeStage] ?? 'SINGLE';
}

/**
 * The event-level summary kept for everything that reads one mode: the most
 * protective mode any of the journey's stages runs under.
 */
export function eventEnvelope(
  byStage: Partial<Record<string, EnvelopeMode>> | undefined, stages: string[],
): EnvelopeMode {
  const modes = stages.filter((s) => ENVELOPE_STAGES.includes(s as EnvelopeStage)).map((s) => envelopeFor(byStage, s));
  if (modes.includes('TWO_ENVELOPE')) return 'TWO_ENVELOPE';
  if (modes.includes('SINGLE')) return 'SINGLE';
  return modes.length > 0 ? 'NONE' : 'SINGLE';
}
