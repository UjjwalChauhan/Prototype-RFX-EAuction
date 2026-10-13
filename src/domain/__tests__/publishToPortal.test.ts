/**
 * Publishing on the buyer's side, and the supplier seeing it.
 *
 * This is the seam the whole two-application design rests on, so it is tested
 * as one chain rather than as two halves that each pass alone.
 */
import { describe, expect, it } from 'vitest';
import { JOURNEY_PATTERNS } from '../journeyPatterns';
import { defaultShortlist } from '../bidders';
import { defaultCounterparty, vendorSections } from '../vendorPortal';
import { COUNTERPARTIES } from '../../data/seed';
import type { EventBidder, JourneyPatternId, SourcingEvent } from '../types';

const NOW = Date.now();

/** Exactly what the Create Event wizard builds at publish. */
function publish(patternId: JourneyPatternId, category: string, closesInHours = 72) {
  const pattern = JOURNEY_PATTERNS[patternId];
  const eventId = 'evt-test';
  const event: SourcingEvent = {
    id: eventId, tenantId: 'tenant-udaan', eventNumber: 'RFQ-2026-0001',
    title: 'A published event', description: '', side: 'BUY', templateId: null,
    journeyPattern: patternId, businessUnit: 'BU', category, project: null,
    costCentre: null, currency: 'USD', estimatedValue: 1000, ownerId: 'u',
    status: 'PUBLISHED', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: pattern.stages, currentStage: pattern.stages[0],
    envelopeMode: 'SINGLE', vendorInputPoints: pattern.vendorInputPoints,
    publishedAt: NOW, closesAt: NOW + closesInHours * 3_600_000, awardedAt: null,
    parentEventId: null, version: 1,
    configSnapshotAtPublish: { feedbackPolicy: 'NONE', mechanism: 'ENGLISH', envelopeMode: 'SINGLE', minDecrement: 1 },
  };
  const shortlist = defaultShortlist(COUNTERPARTIES, category, null);
  const bidders: EventBidder[] = shortlist.map((counterpartyId, i) => ({
    id: `${eventId}-eb-${counterpartyId}`, eventId, counterpartyId,
    isProvisional: false, invitedAt: NOW, invitationStatus: 'SENT', declineReason: null,
    ndaAcceptedAt: null, participationStatus: 'NOT_STARTED', qualificationStatus: 'PENDING',
    awardStatus: 'NONE', qualificationSnapshot: 90, performanceRatingSnapshot: 80,
    bidOnBehalfAllowed: false, maskedLabel: `Bidder ${String.fromCharCode(65 + i)}`,
    disqualified: false, disqualificationReason: null,
  }));
  return { event, bidders, shortlist };
}

describe('a published event reaches the suppliers invited to it', () => {
  it('shortlists somebody for every category a buyer can pick', () => {
    for (const category of [
      'IT Hardware', 'Office & Administrative', 'Facilities & MRO',
      'Fleet & Logistics', 'Electrical & Instrumentation', 'Professional & Consultancy',
    ]) {
      expect(defaultShortlist(COUNTERPARTIES, category, null).length).toBeGreaterThan(0);
    }
  });

  it('appears for an invited supplier, under the point the journey asks at', () => {
    const { event, bidders, shortlist } = publish('JP-02', 'IT Hardware');
    const sections = vendorSections({
      events: [event], bidders, responses: [], counterpartyId: shortlist[0], now: NOW,
    });
    const withItems = sections.filter((s) => s.active.length > 0);
    expect(withItems).toHaveLength(1);
    expect(withItems[0].point).toBe('RFQ');
  });

  it('appears for every pattern a buyer can choose', () => {
    for (const id of Object.keys(JOURNEY_PATTERNS) as JourneyPatternId[]) {
      const pattern = JOURNEY_PATTERNS[id];
      if (pattern.vendorInputPoints.length === 0) continue;
      const { event, bidders, shortlist } = publish(id, 'IT Hardware');
      const sections = vendorSections({
        events: [event], bidders, responses: [], counterpartyId: shortlist[0], now: NOW,
      });
      const total = sections.reduce((n, s) => n + s.active.length, 0);
      expect(total, `pattern ${id} reached nobody`).toBeGreaterThan(0);
    }
  });

  it('does NOT appear for a supplier who was not shortlisted', () => {
    const { event, bidders, shortlist } = publish('JP-02', 'IT Hardware');
    const outsider = COUNTERPARTIES.find((c) => !shortlist.includes(c.id))!;
    const sections = vendorSections({
      events: [event], bidders, responses: [], counterpartyId: outsider.id, now: NOW,
    });
    expect(sections.reduce((n, s) => n + s.active.length, 0)).toBe(0);
  });

  it('opens the portal as a supplier who was actually invited', () => {
    // The regression this guards: an IT Hardware shortlist does not include
    // the portal's preferred default, so a fixed identity showed an empty list
    // and the event looked as though it had never been published.
    const { event, bidders, shortlist } = publish('JP-02', 'IT Hardware');
    expect(shortlist).not.toContain('cp-abc');

    const opensAs = defaultCounterparty({
      events: [event], bidders, responses: [], counterparties: COUNTERPARTIES,
      preferred: 'cp-abc', now: NOW,
    });
    expect(shortlist).toContain(opensAs);

    const sections = vendorSections({
      events: [event], bidders, responses: [], counterpartyId: opensAs, now: NOW,
    });
    expect(sections.reduce((n, s) => n + s.active.length, 0)).toBeGreaterThan(0);
  });

  it('keeps the preferred company when it has work of its own', () => {
    const { event, bidders } = publish('JP-02', 'Office & Administrative');
    expect(defaultCounterparty({
      events: [event], bidders, responses: [], counterparties: COUNTERPARTIES,
      preferred: 'cp-abc', now: NOW,
    })).toBe('cp-abc');
  });

  it('falls back to the preferred company when nothing is published at all', () => {
    expect(defaultCounterparty({
      events: [], bidders: [], responses: [], counterparties: COUNTERPARTIES,
      preferred: 'cp-abc', now: NOW,
    })).toBe('cp-abc');
  });
});
