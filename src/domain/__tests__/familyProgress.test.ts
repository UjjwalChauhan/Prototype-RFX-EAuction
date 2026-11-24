/**
 * A sourcing event stands where its asks are: Intake while nothing has gone
 * out, RFI once the RFI is issued, and so on — and an ask a supplier has
 * answered is Open.
 */
import { describe, expect, it } from 'vitest';
import { progressFamilies } from '../familyProgress';
import type { Response, SourcingEvent } from '../types';

function ev(over: Partial<SourcingEvent>): SourcingEvent {
  return {
    id: 'src', tenantId: 't', eventNumber: 'SRC-2026-0003', title: 'Facilities & MRO', description: '',
    side: 'BUY', templateId: null, journeyPattern: 'JP-05', businessUnit: 'CS', category: 'Facilities',
    project: null, costCentre: null, currency: 'INR', estimatedValue: 1, ownerId: 'user-ar',
    status: 'PUBLISHED', createdFrom: 'PR', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'INTAKE', envelopeMode: 'TWO_ENVELOPE', vendorInputPoints: [],
    publishedAt: 1, closesAt: null, awardedAt: null, parentEventId: null, version: 1, configSnapshotAtPublish: null,
    ...over,
  };
}
const ask = (stage: 'RFI' | 'RFP' | 'RFQ', status: SourcingEvent['status']) =>
  ev({ id: `src-${stage.toLowerCase()}`, parentEventId: 'src', currentStage: stage, stagesEnabled: [stage], status });
const response = (eventId: string): Response => ({
  id: 'r1', eventId, bidderId: 'b1', version: 1, submittedAt: 5, answers: [], priceLines: [],
});

describe('family progress', () => {
  it('moves the sourcing event from Intake to the RFI once the RFI is out', () => {
    const out = progressFamilies([ev({}), ask('RFI', 'PUBLISHED'), ask('RFP', 'DRAFT'), ask('RFQ', 'DRAFT')], []);
    expect(out[0].currentStage).toBe('RFI');
  });

  it('opens the RFI, and the event, when a supplier submits', () => {
    const out = progressFamilies([ev({}), ask('RFI', 'PUBLISHED'), ask('RFP', 'DRAFT')], [response('src-rfi')]);
    expect(out[1].status).toBe('OPEN');
    expect(out[0]).toMatchObject({ currentStage: 'RFI', status: 'OPEN' });
  });

  it('follows the furthest issued ask, and never goes back', () => {
    expect(progressFamilies([ev({}), ask('RFI', 'UNDER_EVALUATION'), ask('RFP', 'PUBLISHED')], [])[0].currentStage).toBe('RFP');
    expect(progressFamilies([ev({ currentStage: 'AWARD' }), ask('RFI', 'PUBLISHED')], [])[0].currentStage).toBe('AWARD');
  });

  it('leaves an event held for approval at Intake, and returns the same array when nothing moves', () => {
    const events = [ev({ status: 'PENDING_APPROVAL' }), ask('RFI', 'DRAFT')];
    expect(progressFamilies(events, [])).toBe(events);
  });
});
