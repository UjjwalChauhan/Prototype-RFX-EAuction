/**
 * Questionnaires over the API — the library, and what an event asks from it.
 *
 * Two collections, and the relationship between them is the whole design.
 *
 * `/api/questionnaire-templates` is the **library**: reusable question sets,
 * authored once and reused. A template is written for a category, because that
 * is the level at which the questions are actually the same — what separates a
 * good pallet supplier from a bad one is not what separates a good laptop
 * supplier from a bad one, and an organisation that writes one questionnaire
 * for both ends up asking neither market anything useful.
 *
 * `/api/events/:id/questionnaires` is what one ask **asks**. Creating one from
 * a template copies the questions onto the event and records which template
 * they came from. The copy is deliberate and is the oldest rule in this part of
 * the system: an event must be able to edit what it asks without rewriting a
 * shared asset for everybody, and a questionnaire that is still a live
 * reference would let a template edit change a question a supplier has already
 * answered.
 *
 * Because an event's basket can span several categories, one ask can carry
 * several questionnaires — one per category, each from that category's library.
 * That is why `category` is part of the key here rather than a label on it.
 */
import {
  deletionBlock, instantiateTemplate, templateUses, templatesFor, validateTemplate,
} from '../domain/questionnaireTemplates';
import { defaultConfigFor } from '../domain/questionTypes';
import { questionnaireIdFor } from '../domain/stageEvents';
import type { Repository } from './repository';
import type { ApiRequest, ApiResponse, RouteDoc } from './router';
import type {
  Id, Question, QuestionType, Questionnaire, QuestionnaireTemplate, ServerMillis, Stage,
  TemplateQuestion, TemplateSection, VendorInputPoint,
} from '../domain/types';

export const QUESTIONNAIRE_ROUTES: RouteDoc[] = [
  {
    method: 'GET', path: '/api/questionnaire-templates',
    summary: 'The template library. Filter with ?point= &category= &status=.',
  },
  {
    method: 'POST', path: '/api/questionnaire-templates',
    summary: 'Write a template. Defaults to category scope when categories are named.',
  },
  {
    method: 'GET', path: '/api/questionnaire-templates/:id',
    summary: 'One template, with the events built from it.',
  },
  {
    method: 'DELETE', path: '/api/questionnaire-templates/:id',
    summary: 'Remove a template. Refused once an event has been built from it.',
  },
  {
    method: 'GET', path: '/api/events/:id/questionnaires',
    summary: 'What this ask asks — one per category. Narrow with ?category= &counterpartyId=.',
  },
  {
    method: 'POST', path: '/api/events/:id/questionnaires',
    summary: 'Attach a questionnaire to an ask, from a template or from questions given inline.',
  },
];

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
const badRequest = (message: string, details: unknown[] = []): ApiResponse =>
  ({ status: 400, body: { error: message, details } });
const notFound = (message: string): ApiResponse => ({ status: 404, body: { error: message } });
const conflict = (message: string): ApiResponse => ({ status: 409, body: { error: message } });

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

// ---------------------------------------------------------------------------
// Building a template from a request body
// ---------------------------------------------------------------------------

/**
 * The next free template id.
 *
 * Numbered rather than random because a template id is quoted in conversation
 * — "use qt-012" — and a caller who creates two in a row should be able to tell
 * which is which.
 */
function nextTemplateId(existing: QuestionnaireTemplate[]): Id {
  const used = existing
    .map((t) => Number(t.id.replace('qt-', '')))
    .filter((n) => Number.isFinite(n));
  return `qt-${String((used.length === 0 ? 0 : Math.max(...used)) + 1).padStart(3, '0')}`;
}

/** A code derived from the name, so a caller need not invent one. */
function codeFrom(name: string, appliesTo: VendorInputPoint[]): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `QT-${appliesTo[0] ?? 'RFI'}-${slug.slice(0, 18) || 'UNTITLED'}`;
}

/**
 * One question as the API accepts it: a type and a title, and defaults for the
 * rest.
 *
 * The defaults are the editor's own — technical envelope, manually scored,
 * weight 10 — so a template written over the API behaves like one written in
 * the studio. A caller who wants something else says so; a caller who does not
 * gets something askable rather than something half-formed.
 */
function buildQuestion(
  raw: Record<string, unknown>, templateId: Id, sequence: number, sections: TemplateSection[],
): TemplateQuestion {
  const id = `${templateId}-q${sequence}`;
  const type = asString(raw.type, 'short_text') as QuestionType;
  const sectionRef = raw.sectionId ?? raw.section;
  const section = typeof sectionRef === 'string'
    ? sections.find((s) => s.id === sectionRef || s.name === sectionRef) ?? sections[0]
    : sections[0];

  const priced = type === 'price_schedule' || type === 'rate_table' || type === 'quantity_break';
  const weight = typeof raw.weight === 'number' ? raw.weight : priced ? 0 : 10;
  const scoringMethod = (raw.scoringMethod as TemplateQuestion['scoringMethod'])
    ?? (priced ? 'NONE' : 'MANUAL');

  return {
    id,
    templateId,
    sectionId: section?.id ?? null,
    sequence,
    code: asString(raw.code) || `Q.${sequence}`,
    type,
    title: asString(raw.title, 'Untitled question'),
    helpText: asString(raw.helpText),
    isRequired: raw.isRequired !== false,
    envelope: (raw.envelope as TemplateQuestion['envelope']) ?? 'TECHNICAL',
    weight,
    scoringMethod,
    maxScore: typeof raw.maxScore === 'number' ? raw.maxScore : scoringMethod === 'NONE' ? 0 : 10,
    rubric: typeof raw.rubric === 'string' ? raw.rubric : null,
    isKnockout: raw.isKnockout === true,
    allowAttachment: raw.allowAttachment === true,
    config: (raw.config as TemplateQuestion['config']) ?? defaultConfigFor(type, id),
  };
}

export interface TemplateDraft {
  template: QuestionnaireTemplate;
}

function buildTemplate(
  body: Record<string, unknown>, existing: QuestionnaireTemplate[], now: ServerMillis,
): QuestionnaireTemplate {
  const id = asString(body.id) || nextTemplateId(existing);
  const name = asString(body.name);
  const appliesTo = asStringArray(body.appliesTo) as VendorInputPoint[];
  const categories = asStringArray(body.categories);

  const sectionsIn = Array.isArray(body.sections) ? body.sections : [];
  const sections: TemplateSection[] = sectionsIn.length === 0
    ? [{ id: `${id}-sec-1`, name: 'General', sequence: 1 }]
    : sectionsIn.map((raw, i) => {
      const section = asObject(raw) ?? {};
      return {
        id: asString(section.id) || `${id}-sec-${i + 1}`,
        name: asString(section.name, `Section ${i + 1}`),
        sequence: typeof section.sequence === 'number' ? section.sequence : i + 1,
      };
    });

  const questionsIn = Array.isArray(body.questions) ? body.questions : [];
  const questions = questionsIn.map(
    (raw, i) => buildQuestion(asObject(raw) ?? {}, id, i + 1, sections),
  );

  /**
   * Scope follows the categories unless the caller overrides it.
   *
   * A template that names a category and is then filed at tenant scope would be
   * offered to every category in the organisation, which is the opposite of
   * what naming one means. So naming a category files it in that category's
   * library, and a caller who genuinely wants a tenant-wide template simply
   * names no category.
   */
  const scopeType = (body.scopeType as QuestionnaireTemplate['scopeType'])
    ?? (categories.length > 0 ? 'CATEGORY' : 'TENANT');
  const scopeId = asString(body.scopeId)
    || (scopeType === 'CATEGORY' ? categories[0] ?? '' : 'tenant-udaan');

  return {
    id,
    code: asString(body.code) || codeFrom(name, appliesTo),
    name,
    description: asString(body.description),
    appliesTo,
    categories,
    sections,
    questions,
    status: (body.status as QuestionnaireTemplate['status']) ?? 'PUBLISHED',
    version: typeof body.version === 'number' ? body.version : 1,
    scopeType,
    scopeId,
    createdBy: asString(body.createdBy, 'api'),
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Attaching a questionnaire to an event
// ---------------------------------------------------------------------------

/** The categories an ask's basket actually spans. */
function categoriesOfAsk(repository: Repository, eventId: Id): string[] {
  const event = repository.event(eventId);
  if (event === undefined) return [];
  const { lineItems } = repository.basketOf(event);
  const seen: string[] = [];
  for (const line of lineItems) {
    const category = line.category?.trim() || event.category;
    if (category && !seen.includes(category)) seen.push(category);
  }
  return seen.length === 0 ? [event.category] : seen;
}

/** A template question re-keyed as an event question. */
function asEventQuestion(
  question: TemplateQuestion, questionnaireId: Id, index: number,
): Question {
  const { templateId: _templateId, ...rest } = question;
  return { ...rest, id: `${questionnaireId}-q${index + 1}`, questionnaireId };
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/**
 * Handle a questionnaire route, or return null so the main router carries on.
 *
 * Same shape as the auction routes: one function, one repository, no state of
 * its own.
 */
export function handleQuestionnaireRoute(
  repository: Repository,
  request: ApiRequest,
  segments: string[],
  now: () => number,
): ApiResponse | null {
  const method = request.method.toUpperCase();
  const query = request.query ?? {};
  const [, collection, id, action] = segments;

  if (collection === 'questionnaire-templates') {
    if (method === 'GET' && id === undefined) return listTemplates(repository, query);
    if (method === 'POST' && id === undefined) return createTemplate(repository, request.body, now());
    if (id !== undefined && method === 'GET') return readTemplate(repository, id);
    if (id !== undefined && method === 'DELETE') return removeTemplate(repository, id);
    return null;
  }

  if (collection === 'events' && id !== undefined && action === 'questionnaires') {
    if (method === 'GET') return listQuestionnaires(repository, id, query);
    if (method === 'POST') return attachQuestionnaire(repository, id, request.body);
  }

  return null;
}

function listTemplates(
  repository: Repository, query: Record<string, string | undefined>,
): ApiResponse {
  const { point, category, status } = query;
  let templates = repository.templates();

  if (point !== undefined) {
    // The same filter the wizard uses, so a template the API says is available
    // at a point is one the wizard will actually offer there — including the
    // ordering, which puts a category's own templates ahead of the generic
    // ones it merely inherits.
    templates = templatesFor(
      templates, point.toUpperCase() as VendorInputPoint, category ?? null,
    );
  } else if (category !== undefined) {
    templates = templates.filter(
      (t) => t.categories.length === 0 || t.categories.includes(category),
    );
  }
  if (status !== undefined) {
    templates = templates.filter((t) => t.status === status.toUpperCase());
  }

  const questionnaires = repository.allQuestionnaires();
  const events = repository.allEvents();
  return ok({
    templates: templates.map((template) => {
      const uses = templateUses(template.id, questionnaires, events);
      return {
        ...template,
        // Returned beside the template because the only question a caller has
        // after listing the library is which of these they are free to change.
        usedBy: uses.length,
        canDelete: deletionBlock(uses) === null,
      };
    }),
  });
}

function createTemplate(
  repository: Repository, body: unknown, at: ServerMillis,
): ApiResponse {
  const input = asObject(body);
  if (input === null) return badRequest('A JSON object body is required.');

  const template = buildTemplate(input, repository.templates(), at);
  if (repository.template(template.id) !== undefined) {
    return conflict(`A template with id "${template.id}" already exists.`);
  }

  /**
   * Validated by the library's own rules, not a weaker copy of them.
   *
   * This is the whole reason the check lives in the domain: a template written
   * over the API that put a weight on a price, or a commercial question in an
   * RFI, would be a template the studio refuses to save and the wizard refuses
   * to publish — created through a door that did not look.
   */
  const takenNames = repository.templates()
    .filter((t) => t.scopeType === template.scopeType && t.scopeId === template.scopeId)
    .map((t) => t.name);
  const validation = validateTemplate(template, takenNames);
  if (!validation.valid) {
    return badRequest('The template could not be created.', validation.errors);
  }

  repository.saveTemplate(template);
  return created({ template, warnings: validation.warnings });
}

function readTemplate(repository: Repository, id: Id): ApiResponse {
  const template = repository.template(id);
  if (template === undefined) return notFound(`No questionnaire template with id "${id}".`);
  const uses = templateUses(id, repository.allQuestionnaires(), repository.allEvents());
  return ok({
    template,
    validation: validateTemplate(template),
    usedBy: uses,
    canDelete: deletionBlock(uses) === null,
  });
}

function removeTemplate(repository: Repository, id: Id): ApiResponse {
  const template = repository.template(id);
  if (template === undefined) return notFound(`No questionnaire template with id "${id}".`);

  // The same rule the library screen enforces. A delete that the UI refuses and
  // the API allows is not a rule, it is a suggestion.
  const uses = templateUses(id, repository.allQuestionnaires(), repository.allEvents());
  const blocked = deletionBlock(uses);
  if (blocked !== null) return conflict(blocked);

  repository.deleteTemplate(id);
  return ok({ deleted: id });
}

function listQuestionnaires(
  repository: Repository, eventId: Id, query: Record<string, string | undefined>,
): ApiResponse {
  const event = repository.event(eventId);
  if (event === undefined) return notFound(`No event with id "${eventId}".`);

  let questionnaires = repository.questionnairesOf(eventId);

  if (query.category !== undefined) {
    questionnaires = questionnaires.filter((q) => (q.category ?? null) === query.category);
  }

  /**
   * A supplier's own view of the ask.
   *
   * A questionnaire written for a category goes only to the suppliers
   * shortlisted for it. Asked for by counterparty rather than by category
   * because that is what a supplier-facing client holds, and because the
   * mapping from one to the other is the buyer's, not theirs to compute.
   */
  if (query.counterpartyId !== undefined) {
    const invited = repository.biddersOf(eventId)
      .find((bidder) => bidder.counterpartyId === query.counterpartyId);
    if (invited === undefined) {
      return notFound(`${query.counterpartyId} is not invited to ${event.eventNumber}.`);
    }
    questionnaires = questionnaires.filter((q) => {
      const category = q.category ?? null;
      if (category === null) return true;
      return invited.categories.length === 0 || invited.categories.includes(category);
    });
  }

  return ok({
    eventId,
    eventNumber: event.eventNumber,
    categories: categoriesOfAsk(repository, eventId),
    questionnaires,
  });
}

function attachQuestionnaire(
  repository: Repository, eventId: Id, body: unknown,
): ApiResponse {
  const event = repository.event(eventId);
  if (event === undefined) return notFound(`No event with id "${eventId}".`);

  const input = asObject(body);
  if (input === null) return badRequest('A JSON object body is required.');

  const point = asString(input.point, event.currentStage).toUpperCase() as VendorInputPoint;
  if (!event.vendorInputPoints.includes(point)) {
    return badRequest(
      `${event.eventNumber} does not ask the supplier anything at ${point}.`,
      [{ field: 'point', message: `It asks at ${event.vendorInputPoints.join(', ') || 'no point at all'}.` }],
    );
  }

  const category = typeof input.category === 'string' && input.category.trim() !== ''
    ? input.category.trim()
    : null;
  const spans = categoriesOfAsk(repository, eventId);
  if (category !== null && !spans.includes(category)) {
    return badRequest(
      `${event.eventNumber} has nothing in ${category}, so a questionnaire for it would never be answered.`,
      [{ field: 'category', message: `Its basket covers ${spans.join(', ')}.` }],
    );
  }

  const questionnaireId = questionnaireIdFor(eventId, point as Stage, category);

  // From a template, or from questions given inline. A template is the ordinary
  // case and the one that records where the questions came from.
  const templateId = asString(input.templateId) || null;
  let name = asString(input.name);
  let questions: Question[];

  if (templateId !== null) {
    const template = repository.template(templateId);
    if (template === undefined) return notFound(`No questionnaire template with id "${templateId}".`);
    if (!template.appliesTo.includes(point)) {
      return badRequest(
        `"${template.name}" is not applied at ${point}.`,
        [{ field: 'templateId', message: `It applies at ${template.appliesTo.join(', ')}.` }],
      );
    }
    const draft = instantiateTemplate(template, point, questionnaireId, category);
    name = name || draft.templateName;
    questions = draft.questions.map((q, i) => asEventQuestion(q, questionnaireId, i));
  } else {
    const raw = Array.isArray(input.questions) ? input.questions : [];
    if (raw.length === 0) {
      return badRequest(
        'Give either a templateId to copy from, or the questions to ask.',
        [{ field: 'questions', message: 'A questionnaire with no questions asks for nothing.' }],
      );
    }
    const sections: TemplateSection[] = [{ id: `${questionnaireId}-sec-1`, name: 'General', sequence: 1 }];
    questions = raw.map((item, i) =>
      asEventQuestion(buildQuestion(asObject(item) ?? {}, questionnaireId, i + 1, sections), questionnaireId, i));
    name = name || `${point} questionnaire`;
  }

  const questionnaire: Questionnaire = {
    id: questionnaireId,
    eventId,
    stage: point as Stage,
    category,
    name,
    sourceTemplateId: templateId,
    questions,
  };

  const replaced = repository.questionnairesOf(eventId).some((q) => q.id === questionnaireId);
  repository.saveQuestionnaire(questionnaire);
  return replaced ? ok({ questionnaire, replaced: true }) : created({ questionnaire });
}
