/**
 * When a library template may be deleted.
 *
 * The rule the buyer asked for is simple to state — delete a template only if
 * no RFx event has used it — and the whole difficulty is in *knowing*. A
 * questionnaire is a copy of its template, re-keyed under the event, with no
 * reference back. So the link had to be recorded at publish, and these tests
 * pin both halves: that the link survives the copy, and that the answer it
 * gives is the one the library acts on.
 */
import { describe, expect, it } from 'vitest';
import {
  deletionBlock, eventsUsing, templateUseIndex, templateUses,
} from '../questionnaireTemplates';
import {
  createSourcingEvent, type QuestionnaireInput, type SourcingEventInput,
} from '../stageEvents';
import type { Questionnaire, QuestionnaireTemplate, SourcingEvent } from '../types';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import * as seed from '../../data/seed';

const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

function event(id: string, eventNumber: string, title: string): SourcingEvent {
  return {
    id, tenantId: 'tenant-udaan', eventNumber, title, description: '', side: 'BUY',
    templateId: null, journeyPattern: 'JP-05', businessUnit: 'BU', category: 'Indirect',
    project: null, costCentre: null, currency: 'INR', estimatedValue: 0, ownerId: 'user-ar',
    status: 'OPEN', createdFrom: 'MANUAL', sourceReference: null, stagesEnabled: ['RFI'],
    currentStage: 'RFI', envelopeMode: 'SINGLE', vendorInputPoints: ['RFI'],
    publishedAt: 1, closesAt: null, awardedAt: null, parentEventId: null, version: 1,
    configSnapshotAtPublish: null,
  };
}

const CTX = { now: Date.UTC(2026, 0, 5, 9, 0, 0), idPrefix: 'evt-new', takenNumbers: [] };

/** The RFI template's questions as the wizard posts them — ids assigned on publish. */
const templateQuestions = () => RFI.questions.map(({ id: _id, ...rest }) => rest);

/** A publishable event that asks one thing, so only the asking varies per test. */
function published(questionnaire: QuestionnaireInput): SourcingEventInput {
  return {
    journeyPattern: 'JP-05',
    title: 'Qualification round',
    category: 'Indirect',
    businessUnit: 'Corporate Services',
    ownerId: 'user-ar',
    lines: [{ description: 'Service', quantity: 1, uom: 'EA', lotName: 'Lot 1' }],
    bidders: [{ counterpartyId: 'cp-abc' }],
    timeline: { closesInHours: 72 },
    questionnaires: [questionnaire],
  };
}

function questionnaire(
  id: string, eventId: string, sourceTemplateId: string | null,
): Questionnaire {
  return { id, eventId, stage: 'RFI', name: 'Qualification', questions: [], sourceTemplateId };
}

describe('finding where a template has been used', () => {
  const events = [event('evt-1', 'RFI-2026-0001', 'Facilities'), event('evt-2', 'RFI-2026-0002', 'Fleet')];

  it('finds nothing for a template no event was built from', () => {
    const uses = templateUses('qt-001', [questionnaire('q1', 'evt-1', 'qt-009')], events);
    expect(uses).toEqual([]);
  });

  it('finds the event an ask was built from', () => {
    const uses = templateUses('qt-001', [questionnaire('q1', 'evt-1', 'qt-001')], events);
    expect(uses).toHaveLength(1);
    expect(uses[0].eventNumber).toBe('RFI-2026-0001');
    expect(uses[0].title).toBe('Facilities');
    expect(uses[0].stage).toBe('RFI');
  });

  it('ignores a questionnaire that was started blank', () => {
    const uses = templateUses('qt-001', [questionnaire('q1', 'evt-1', null)], events);
    expect(uses).toEqual([]);
  });

  it('ignores a questionnaire published before the link existed', () => {
    const legacy = { ...questionnaire('q1', 'evt-1', null) };
    delete (legacy as { sourceTemplateId?: unknown }).sourceTemplateId;
    expect(templateUses('qt-001', [legacy], events)).toEqual([]);
  });

  it('still names an event it cannot find, rather than dropping the use', () => {
    const uses = templateUses('qt-001', [questionnaire('q1', 'evt-gone', 'qt-001')], events);
    expect(uses).toHaveLength(1);
    expect(uses[0].eventNumber).toBe('evt-gone');
  });

  it('counts one event once even when it asks at two points', () => {
    const uses = templateUses('qt-001', [
      questionnaire('q1', 'evt-1', 'qt-001'),
      { ...questionnaire('q2', 'evt-1', 'qt-001'), stage: 'RFP' },
    ], events);
    expect(uses).toHaveLength(2);
    expect(eventsUsing(uses)).toEqual(['RFI-2026-0001']);
  });

  it('indexes every template in the library, used or not', () => {
    const index = templateUseIndex(
      [RFI, { ...RFI, id: 'qt-unused' }],
      [questionnaire('q1', 'evt-1', RFI.id)],
      events,
    );
    expect(index.get(RFI.id)).toHaveLength(1);
    expect(index.get('qt-unused')).toEqual([]);
  });
});

describe('whether the template may be deleted', () => {
  const events = [event('evt-1', 'RFI-2026-0001', 'Facilities'), event('evt-2', 'RFI-2026-0002', 'Fleet')];

  it('allows deletion when nothing has been asked from it', () => {
    expect(deletionBlock([])).toBeNull();
  });

  it('blocks deletion once one event has used it', () => {
    const block = deletionBlock(templateUses('qt-001', [questionnaire('q1', 'evt-1', 'qt-001')], events));
    expect(block).not.toBeNull();
    expect(block).toContain('RFI-2026-0001');
  });

  it('names the events rather than only counting them', () => {
    const block = deletionBlock(templateUses('qt-001', [
      questionnaire('q1', 'evt-1', 'qt-001'),
      questionnaire('q2', 'evt-2', 'qt-001'),
    ], events)) as string;
    expect(block).toContain('RFI-2026-0001');
    expect(block).toContain('RFI-2026-0002');
  });

  it('points at retirement, which is what stopping use actually means', () => {
    const block = deletionBlock(templateUses('qt-001', [questionnaire('q1', 'evt-1', 'qt-001')], events)) as string;
    expect(block).toContain('Retire');
  });

  it('summarises rather than listing every event once there are many', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      eventId: `evt-${i}`, eventNumber: `RFI-2026-000${i}`, title: 'x', stage: 'RFI' as const,
    }));
    const block = deletionBlock(many) as string;
    expect(block).toContain('6 events');
    expect(block).toContain('and 3 more');
  });
});

describe('the link survives the copy onto the event', () => {
  it('records the template a published ask was built from', () => {
    const family = createSourcingEvent(published({
      point: 'RFI', name: RFI.name, sourceTemplateId: RFI.id, questions: templateQuestions(),
    }), CTX);

    const asked = family.questionnaires.find((q) => q.stage === 'RFI');
    expect(asked?.sourceTemplateId).toBe(RFI.id);
  });

  it('records null for an ask that was not started from a template', () => {
    const family = createSourcingEvent(
      published({ point: 'RFI', questions: templateQuestions() }), CTX,
    );

    expect(family.questionnaires.find((q) => q.stage === 'RFI')?.sourceTemplateId).toBeNull();
  });

  it('the seeded asks carry the template they were seeded from', () => {
    const seeded = seed.REQUEST_QUESTIONNAIRES();
    expect(seeded.length).toBeGreaterThan(0);
    for (const questionnaire of seeded) {
      expect(questionnaire.sourceTemplateId).not.toBeNull();
    }
  });

  it('so the seeded RFI template cannot be deleted, and an unused one can', () => {
    const seeded = seed.REQUEST_QUESTIONNAIRES();
    const events = seed.EVENTS;
    expect(deletionBlock(templateUses(RFI.id, seeded, events))).not.toBeNull();
    expect(deletionBlock(templateUses('qt-005', seeded, events))).toBeNull();
  });
});
