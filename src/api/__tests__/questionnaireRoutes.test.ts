/**
 * The questionnaire API: writing a template, and attaching one to an ask.
 *
 * What these are really checking is that the API is the *same* product as the
 * screens, not a second one wearing the same data. A template written here is
 * refused by the library's own validation, is filed in the category it names,
 * is offered to the wizard in the same order, and cannot be deleted once an
 * event has been built from it. An API that let any of those through would make
 * the rule in the UI decorative.
 */
import { describe, expect, it } from 'vitest';
import { createApi } from '../server';
import type { ApiRequest, ApiResponse } from '../router';
import type { Questionnaire, QuestionnaireTemplate } from '../../domain/types';

type Row = QuestionnaireTemplate & { usedBy: number; canDelete: boolean };

function api() {
  const { handle } = createApi();
  return {
    call: (request: ApiRequest): ApiResponse => handle(request),
    get: (path: string, query?: Record<string, string>) => handle({ method: 'GET', path, query }),
    post: (path: string, body?: unknown) => handle({ method: 'POST', path, body }),
    del: (path: string) => handle({ method: 'DELETE', path }),
  };
}

/** A template body that passes validation, so a test can vary one thing. */
const coldChain = (over: Record<string, unknown> = {}) => ({
  name: 'Cold chain assurance — RFQ',
  appliesTo: ['RFQ'],
  categories: ['Logistics'],
  questions: [
    { type: 'number', title: 'Temperature logging interval, in minutes', weight: 15 },
    { type: 'long_text', title: 'Describe your excursion escalation process', weight: 20 },
  ],
  ...over,
});

describe('the library is readable', () => {
  it('lists the templates the studio holds', () => {
    const response = api().get('/api/questionnaire-templates');
    const { templates } = response.body as { templates: Row[] };
    expect(response.status).toBe(200);
    expect(templates.length).toBeGreaterThan(0);
  });

  it('narrows to the templates applied at a point', () => {
    const { templates } = api().get(
      '/api/questionnaire-templates', { point: 'RFI' },
    ).body as { templates: Row[] };
    expect(templates.every((t) => t.appliesTo.includes('RFI'))).toBe(true);
  });

  it("puts a category's own template ahead of the generic one, as the wizard does", () => {
    const { templates } = api().get(
      '/api/questionnaire-templates', { point: 'RFQ', category: 'Logistics' },
    ).body as { templates: Row[] };
    expect(templates[0].categories).toContain('Logistics');
  });

  it('says of each template whether it can still be deleted', () => {
    const { templates } = api().get('/api/questionnaire-templates').body as { templates: Row[] };
    const used = templates.find((t) => t.usedBy > 0);
    expect(used?.canDelete).toBe(false);
    expect(templates.some((t) => t.usedBy === 0 && t.canDelete)).toBe(true);
  });

  it('answers 404 for a template that is not there', () => {
    expect(api().get('/api/questionnaire-templates/qt-999').status).toBe(404);
  });
});

describe('writing a template', () => {
  it('creates one and gives it back', () => {
    const response = api().post('/api/questionnaire-templates', coldChain());
    expect(response.status).toBe(201);
    const { template } = response.body as { template: QuestionnaireTemplate };
    expect(template.name).toBe('Cold chain assurance — RFQ');
    expect(template.questions).toHaveLength(2);
  });

  it('files it in the category it names, not at tenant scope', () => {
    const { template } = api().post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    expect(template.scopeType).toBe('CATEGORY');
    expect(template.scopeId).toBe('Logistics');
  });

  it('leaves a template that names no category at tenant scope', () => {
    const { template } = api().post(
      '/api/questionnaire-templates', coldChain({ categories: [] }),
    ).body as { template: QuestionnaireTemplate };
    expect(template.scopeType).toBe('TENANT');
  });

  it('fills in the editor’s own defaults rather than half a question', () => {
    const { template } = api().post(
      '/api/questionnaire-templates',
      coldChain({ questions: [{ type: 'short_text', title: 'Who is the account manager?' }] }),
    ).body as { template: QuestionnaireTemplate };
    const [question] = template.questions;
    expect(question.envelope).toBe('TECHNICAL');
    expect(question.scoringMethod).toBe('MANUAL');
    expect(question.weight).toBe(10);
    expect(question.config).toBeDefined();
  });

  it('strips weight off a priced question rather than authoring a double count', () => {
    const { template } = api().post(
      '/api/questionnaire-templates',
      coldChain({ questions: [{ type: 'price_schedule', title: 'Prices', envelope: 'COMMERCIAL' }] }),
    ).body as { template: QuestionnaireTemplate };
    expect(template.questions[0].weight).toBe(0);
  });

  it('is refused when the library’s own rules refuse it', () => {
    const response = api().post('/api/questionnaire-templates', coldChain({
      questions: [{ type: 'price_schedule', title: 'Prices', weight: 20, envelope: 'COMMERCIAL' }],
    }));
    expect(response.status).toBe(400);
    const { details } = response.body as { details: { code: string }[] };
    expect(details.map((d) => d.code)).toContain('PRICE_CARRIES_WEIGHT');
  });

  it('refuses a commercial question in a template applied at RFI', () => {
    const response = api().post('/api/questionnaire-templates', coldChain({
      appliesTo: ['RFI'],
      questions: [{ type: 'short_text', title: 'Payment terms', envelope: 'COMMERCIAL' }],
    }));
    const { details } = response.body as { details: { code: string }[] };
    expect(details.map((d) => d.code)).toContain('COMMERCIAL_AT_RFI');
  });

  it('refuses a template with no name', () => {
    expect(api().post('/api/questionnaire-templates', coldChain({ name: '' })).status).toBe(400);
  });

  it('refuses a template applied nowhere, which would never be asked', () => {
    const response = api().post('/api/questionnaire-templates', coldChain({ appliesTo: [] }));
    const { details } = response.body as { details: { code: string }[] };
    expect(details.map((d) => d.code)).toContain('NO_APPLIES_TO');
  });

  it('refuses a second template with a name already taken at that scope', () => {
    const client = api();
    client.post('/api/questionnaire-templates', coldChain());
    const again = client.post('/api/questionnaire-templates', coldChain());
    expect(again.status).toBe(400);
    const { details } = again.body as { details: { code: string }[] };
    expect(details.map((d) => d.code)).toContain('NAME_TAKEN');
  });

  it('refuses a body that is not an object', () => {
    expect(api().post('/api/questionnaire-templates', 'a template').status).toBe(400);
  });

  it('is listed afterwards, and reachable by id', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    expect(client.get(`/api/questionnaire-templates/${template.id}`).status).toBe(200);
    const { templates } = client.get(
      '/api/questionnaire-templates', { point: 'RFQ', category: 'Logistics' },
    ).body as { templates: Row[] };
    expect(templates.map((t) => t.id)).toContain(template.id);
  });
});

describe('deleting a template', () => {
  it('removes one nothing has been built from', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    expect(client.del(`/api/questionnaire-templates/${template.id}`).status).toBe(200);
    expect(client.get(`/api/questionnaire-templates/${template.id}`).status).toBe(404);
  });

  it('refuses one an event has been built from, and says which', () => {
    const response = api().del('/api/questionnaire-templates/qt-006');
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toContain('RFQ-2026-061');
  });

  it('refuses it the moment an event is built from it', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    client.post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Logistics', templateId: template.id,
    });
    expect(client.del(`/api/questionnaire-templates/${template.id}`).status).toBe(409);
  });

  it('answers 404 rather than 409 for a template that never existed', () => {
    expect(api().del('/api/questionnaire-templates/qt-999').status).toBe(404);
  });
});

describe('what an ask asks', () => {
  it('returns one questionnaire per category in the basket', () => {
    const response = api().get('/api/events/evt-rfq-061/questionnaires');
    const body = response.body as { categories: string[]; questionnaires: Questionnaire[] };
    expect(body.categories).toEqual(['Indirect', 'Logistics']);
    expect(body.questionnaires.map((q) => q.category)).toEqual(['Indirect', 'Logistics']);
  });

  it('returns one for an ask whose basket spans a single category', () => {
    const { questionnaires } = api().get(
      '/api/events/evt-rfi-005/questionnaires',
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires).toHaveLength(1);
  });

  it('narrows to one category when asked for one', () => {
    const { questionnaires } = api().get(
      '/api/events/evt-rfq-061/questionnaires', { category: 'Logistics' },
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires).toHaveLength(1);
    expect(questionnaires[0].category).toBe('Logistics');
  });

  it('gives a supplier only the categories they were shortlisted for', () => {
    const { questionnaires } = api().get(
      '/api/events/evt-rfq-061/questionnaires', { counterpartyId: 'cp-prime' },
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires.map((q) => q.category)).toEqual(['Indirect']);
  });

  it('gives a supplier shortlisted for both categories both questionnaires', () => {
    const { questionnaires } = api().get(
      '/api/events/evt-rfq-061/questionnaires', { counterpartyId: 'cp-abc' },
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires).toHaveLength(2);
  });

  it('refuses to answer for a supplier who is not on the ask at all', () => {
    const response = api().get(
      '/api/events/evt-rfq-061/questionnaires', { counterpartyId: 'cp-nova' },
    );
    expect(response.status).toBe(404);
  });

  it('answers 404 for an event that is not there', () => {
    expect(api().get('/api/events/evt-nope/questionnaires').status).toBe(404);
  });
});

describe('attaching a questionnaire to an ask', () => {
  it('copies a template onto the event and records where it came from', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    const response = client.post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Logistics', templateId: template.id,
    });
    const { questionnaire } = response.body as { questionnaire: Questionnaire };
    expect(questionnaire.sourceTemplateId).toBe(template.id);
    expect(questionnaire.category).toBe('Logistics');
    expect(questionnaire.questions).toHaveLength(2);
  });

  it('re-keys the questions under the event, never under the template', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    const { questionnaire } = client.post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Logistics', templateId: template.id,
    }).body as { questionnaire: Questionnaire };
    for (const question of questionnaire.questions) {
      expect(question.questionnaireId).toBe(questionnaire.id);
      expect(question.id.startsWith(questionnaire.id)).toBe(true);
    }
  });

  it('replaces the questionnaire already at that point and category', () => {
    const client = api();
    const { template } = client.post(
      '/api/questionnaire-templates', coldChain(),
    ).body as { template: QuestionnaireTemplate };
    const response = client.post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Logistics', templateId: template.id,
    });
    expect(response.status).toBe(200);
    const { questionnaires } = client.get(
      '/api/events/evt-rfq-061/questionnaires',
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires).toHaveLength(2);
    expect(questionnaires.find((q) => q.category === 'Logistics')?.sourceTemplateId)
      .toBe(template.id);
  });

  it('accepts questions given inline, with no template at all', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ',
      category: 'Indirect',
      name: 'Straight to the point',
      questions: [{ type: 'short_text', title: 'Who signs the contract?' }],
    });
    const { questionnaire } = response.body as { questionnaire: Questionnaire };
    expect(questionnaire.sourceTemplateId).toBeNull();
    expect(questionnaire.questions).toHaveLength(1);
  });

  it('refuses a questionnaire with neither a template nor questions', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', { point: 'RFQ' });
    expect(response.status).toBe(400);
  });

  it('refuses a category the basket does not buy in, and says what it does', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Aviation', templateId: 'qt-003',
    });
    expect(response.status).toBe(400);
    const { details } = response.body as { details: { message: string }[] };
    expect(details[0].message).toContain('Indirect');
  });

  it('refuses a point the ask never reaches', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFI', templateId: 'qt-001',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a template that is not applied at the point asked for', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Indirect', templateId: 'qt-001',
    });
    expect(response.status).toBe(400);
  });

  it('answers 404 for a template that is not in the library', () => {
    const response = api().post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', templateId: 'qt-999',
    });
    expect(response.status).toBe(404);
  });

  it('is reflected in the supplier’s own view straight away', () => {
    const client = api();
    client.post('/api/events/evt-rfq-061/questionnaires', {
      point: 'RFQ', category: 'Logistics',
      questions: [{ type: 'yes_no', title: 'Do you collect returned pallets?' }],
    });
    const { questionnaires } = client.get(
      '/api/events/evt-rfq-061/questionnaires', { counterpartyId: 'cp-brightpath' },
    ).body as { questionnaires: Questionnaire[] };
    expect(questionnaires).toHaveLength(1);
    expect(questionnaires[0].questions[0].title).toBe('Do you collect returned pallets?');
  });
});

describe('the routes are advertised', () => {
  it('lists the questionnaire routes alongside the rest', () => {
    const { routes } = api().get('/api').body as { routes: { path: string }[] };
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/api/questionnaire-templates');
    expect(paths).toContain('/api/events/:id/questionnaires');
  });

  it('counts the library in the health check', () => {
    const { counts } = api().get('/api/health').body as { counts: Record<string, number> };
    expect(counts.questionnaireTemplates).toBeGreaterThan(0);
  });
});
