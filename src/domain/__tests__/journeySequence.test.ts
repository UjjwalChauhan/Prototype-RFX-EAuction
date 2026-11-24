/**
 * The rail follows the journey, not a canonical order.
 *
 * Journeys are composed in the buyer's own sequence now, so the claim the
 * composer makes — drag the auction before the RFQ and that is what runs —
 * has to hold where it is rendered. It used to be false: the rail walked
 * STAGE_ORDER unconditionally and silently sorted the configuration back.
 */
import { describe, expect, it } from 'vitest';
import { ALL_PATTERNS, buildStageRail, railSequence, workspaceTabs } from '../journeyPatterns';
import type { Stage } from '../types';

describe('railSequence', () => {
  it('walks the journey in the order it was composed', () => {
    const composed: Stage[] = ['INTAKE', 'AUCTION', 'RFQ', 'AWARD'];
    expect(railSequence(composed)).toEqual(composed);
  });

  it('leaves every master pattern exactly as it ships', () => {
    for (const pattern of ALL_PATTERNS) {
      expect(railSequence(pattern.stages), pattern.id).toEqual(pattern.stages);
    }
  });

  it('slots a skipped stage in at the position it would have held', () => {
    const sequence = railSequence(
      ['INTAKE', 'RFQ', 'AWARD'], { RFI: 'No qualification needed — incumbent field.' },
    );
    expect(sequence).toEqual(['INTAKE', 'RFI', 'RFQ', 'AWARD']);
  });

  it('keeps the current stage in view even when the journey does not list it', () => {
    expect(railSequence(['INTAKE', 'AWARD'], {}, 'RFQ')).toEqual(['INTAKE', 'RFQ', 'AWARD']);
  });
});

describe('buildStageRail', () => {
  const COMPOSED: Stage[] = ['INTAKE', 'AUCTION', 'RFQ', 'AWARD'];

  it('renders a re-sequenced journey in its own order', () => {
    const rail = buildStageRail(COMPOSED, 'RFQ');
    expect(rail.map((r) => r.stage)).toEqual(COMPOSED);
  });

  it('judges done and pending against the journey order, not the canonical one', () => {
    // Canonically RFQ precedes AUCTION. This journey runs the auction first,
    // so at RFQ the auction is done — the opposite of what STAGE_ORDER says.
    const rail = buildStageRail(COMPOSED, 'RFQ');
    const state = (stage: Stage) => rail.find((r) => r.stage === stage)?.state;
    expect(state('AUCTION')).toBe('DONE');
    expect(state('RFQ')).toBe('CURRENT');
    expect(state('AWARD')).toBe('PENDING');
  });

  it('still marks a conditional stage that has not been reached', () => {
    const rail = buildStageRail(COMPOSED, 'AUCTION', ['RFQ']);
    expect(rail.find((r) => r.stage === 'RFQ')?.state).toBe('CONDITIONAL');
  });

  it('shows a skipped stage with its reason rather than hiding it', () => {
    const rail = buildStageRail(
      ['INTAKE', 'RFQ', 'AWARD'], 'RFQ', [], { RFI: 'Incumbent field already qualified.' },
    );
    const rfi = rail.find((r) => r.stage === 'RFI');
    expect(rfi?.state).toBe('SKIPPED');
    expect(rfi?.note).toBe('Incumbent field already qualified.');
  });
});

describe('workspace tabs follow the activities, not just the stages', () => {
  const COMPOSED: Stage[] = ['INTAKE', 'RFQ', 'AWARD'];

  it('gives a scored solicitation its evaluation tab without an evaluation stage', () => {
    expect(workspaceTabs(COMPOSED)).not.toContain('Evaluation');
    expect(workspaceTabs(COMPOSED, { evaluation: true })).toContain('Evaluation');
  });

  it('gives a negotiated RFQ its negotiation tab without a negotiation stage', () => {
    expect(workspaceTabs(COMPOSED, { negotiation: true })).toContain('Negotiation');
  });

  it('keeps the clarifications tab wherever suppliers are asked anything', () => {
    // The window is open across the journey, so the tab is not conditional
    // on a stage that no longer exists.
    expect(workspaceTabs(COMPOSED)).toContain('Clarifications');
  });
});
