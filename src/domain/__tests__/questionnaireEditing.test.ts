/**
 * Rearranging a questionnaire after it has arrived.
 *
 * An uploaded sheet is a starting point, so everything in it has to be
 * movable and removable. The invariant under all three operations is that
 * `sequence` is rewritten from the resulting order rather than patched: the
 * builder, the preview and the supplier's form all read the order from it,
 * and a sequence that disagrees with the array is an order that differs
 * between screens.
 */
import { describe, expect, it } from 'vitest';
import {
  draftFromTemplate,
  emptyTemplate, errorsByQuestion, moveQuestion, moveSection, pointsAsking, questionsInSection,
  removeQuestion, removeSection, sectionBudgets, setAskedAtPoints, templateFromDraft,
  validateTemplate, weightAfterRemoving, type DraftQuestionnaire,
} from '../questionnaireTemplates';
import type { QuestionnaireTemplate, TemplateQuestion } from '../types';

function question(id: string, sectionId: string, sequence: number): TemplateQuestion {
  return {
    id, templateId: 'qt-1', sectionId, sequence, code: id.toUpperCase(), type: 'short_text',
    title: `Question ${id}`, helpText: '', isRequired: true, envelope: 'TECHNICAL',
    weight: 10, scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR', config: {},
  };
}

/** Two sections of two, so every move has a neighbour and an edge. */
function template(): QuestionnaireTemplate {
  return {
    ...emptyTemplate({
      id: 'qt-1', scopeType: 'TENANT', scopeId: 'tenant-1', userId: 'u-1', now: 1,
    }),
    name: 'Imported questionnaire',
    sections: [
      { id: 's1', name: 'Capability', sequence: 1, weight: 60, askedPer: 'VENDOR' },
      { id: 's2', name: 'Delivery', sequence: 2, weight: 40, askedPer: 'VENDOR' },
    ],
    questions: [
      question('a', 's1', 1), question('b', 's1', 2),
      question('c', 's2', 3), question('d', 's2', 4),
    ],
  };
}

const order = (t: QuestionnaireTemplate) => t.sections.flatMap(
  (s) => questionsInSection(t, s.id).map((q) => q.id),
);
const sequences = (t: QuestionnaireTemplate) => t.questions.map((q) => q.sequence);

describe('moving a section', () => {
  it('swaps it with the one above', () => {
    const moved = moveSection(template(), 's2', -1);
    expect(moved.sections.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('takes its questions with it, renumbered straight through the form', () => {
    const moved = moveSection(template(), 's2', -1);
    expect(order(moved)).toEqual(['c', 'd', 'a', 'b']);
    expect(sequences(moved)).toEqual([1, 2, 3, 4]);
  });

  it('renumbers the sections from one, so no two share a position', () => {
    expect(moveSection(template(), 's1', 1).sections.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it('does nothing at the top and nothing at the bottom', () => {
    expect(moveSection(template(), 's1', -1)).toEqual(template());
    expect(moveSection(template(), 's2', 1)).toEqual(template());
  });

  it('does nothing for a section that is not there', () => {
    expect(moveSection(template(), 'nope', 1)).toEqual(template());
  });
});

describe('moving a question', () => {
  it('swaps it with its neighbour inside its own section', () => {
    expect(order(moveQuestion(template(), 'b', -1))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('will not push it out of its section at the section boundary', () => {
    // 'b' is last in Capability. Down would mean "into Delivery", which is a
    // change of section, not a change of order — the Section field does that.
    expect(moveQuestion(template(), 'b', 1)).toEqual(template());
    expect(moveQuestion(template(), 'c', -1)).toEqual(template());
  });

  it('leaves the numbering running straight through the whole form', () => {
    expect(sequences(moveQuestion(template(), 'd', -1))).toEqual([1, 2, 3, 4]);
    expect(order(moveQuestion(template(), 'd', -1))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('does nothing for a question that is not there', () => {
    expect(moveQuestion(template(), 'nope', 1)).toEqual(template());
  });
});

describe('removing a section', () => {
  it('takes the questions inside it, rather than orphaning them', () => {
    const left = removeSection(template(), 's1');
    expect(left.sections.map((s) => s.id)).toEqual(['s2']);
    expect(left.questions.map((q) => q.id)).toEqual(['c', 'd']);
    expect(sequences(left)).toEqual([1, 2]);
  });

  it('leaves no question pointing at a section that has gone', () => {
    const left = removeSection(template(), 's1');
    expect(validateTemplate(left).errors.map((e) => e.code)).not.toContain('ORPHANED_QUESTION');
  });

  it('gives the weight back rather than redistributing it, so the shortfall is visible', () => {
    const left = removeSection(template(), 's1');
    expect(left.sections[0].weight).toBe(40);
    expect(validateTemplate(left).errors.map((e) => e.code)).toContain('SECTION_WEIGHTS_NOT_100');
  });

  it('does nothing for a section that is not there', () => {
    expect(removeSection(template(), 'nope')).toEqual(template());
  });
});

describe('a question in no section', () => {
  it('survives a reorder instead of being dropped', () => {
    const loose = { ...template() };
    loose.questions = [...loose.questions, { ...question('e', 's1', 5), sectionId: null }];
    const moved = moveSection(loose, 's2', -1);
    expect(moved.questions.map((q) => q.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Last, because it belongs to no section and so sits after all of them.
    expect(moved.questions[moved.questions.length - 1].id).toBe('e');
  });
});

describe('removing a question hands its share back', () => {
  /** Capability 60 fully allocated across three, Delivery 40 across one. */
  function weighted(): QuestionnaireTemplate {
    const t = template();
    return {
      ...t,
      sections: [
        { id: 's1', name: 'Capability', sequence: 1, weight: 60, askedPer: 'VENDOR' },
        { id: 's2', name: 'Delivery', sequence: 2, weight: 40, askedPer: 'VENDOR' },
      ],
      questions: [
        { ...question('a', 's1', 1), weight: 30 },
        { ...question('b', 's1', 2), weight: 20 },
        { ...question('c', 's1', 3), weight: 10 },
        { ...question('d', 's2', 4), weight: 40 },
      ],
    };
  }

  it('lowers the section by exactly what the question carried', () => {
    const left = removeQuestion(weighted(), 'b');
    expect(left.sections.find((s) => s.id === 's1')?.weight).toBe(40);
  });

  it('leaves the section fully allocated rather than over-declared', () => {
    const left = removeQuestion(weighted(), 'b');
    const budget = sectionBudgets(left).find((b) => b.section.id === 's1');
    expect([budget?.declared, budget?.allocated, budget?.remaining]).toEqual([40, 40, 0]);
    expect(validateTemplate(left).warnings.map((w) => w.code))
      .not.toContain('SECTION_UNDER_BUDGET');
  });

  it('leaves every other section alone, so the shortfall is visible and not moved', () => {
    const left = removeQuestion(weighted(), 'b');
    expect(left.sections.find((s) => s.id === 's2')?.weight).toBe(40);
    expect(validateTemplate(left).errors.map((e) => e.code))
      .toContain('SECTION_WEIGHTS_NOT_100');
  });

  it('does not touch the weights of the questions that remain', () => {
    expect(removeQuestion(weighted(), 'b').questions.map((q) => [q.id, q.weight]))
      .toEqual([['a', 30], ['c', 10], ['d', 40]]);
  });

  it('takes nothing off the section for an unscored question', () => {
    const t = weighted();
    t.questions = t.questions.map((q) =>
      (q.id === 'c' ? { ...q, weight: 0, scoringMethod: 'NONE' as const, maxScore: 0 } : q));
    // The section only ever declared 60 against the 50 that score, so removing
    // something that scored nothing must not move the declaration.
    expect(removeQuestion(t, 'c').sections.find((s) => s.id === 's1')?.weight).toBe(60);
  });

  it('never drives a section below zero', () => {
    const t = weighted();
    t.sections = t.sections.map((s) => (s.id === 's1' ? { ...s, weight: 10 } : s));
    expect(removeQuestion(t, 'a').sections.find((s) => s.id === 's1')?.weight).toBe(0);
  });

  it('renumbers what is left', () => {
    expect(removeQuestion(weighted(), 'a').questions.map((q) => q.sequence)).toEqual([1, 2, 3]);
  });

  it('does nothing for a question that is not there', () => {
    expect(removeQuestion(weighted(), 'nope')).toEqual(weighted());
  });

  it('says in advance what the section will become', () => {
    expect(weightAfterRemoving(weighted(), 'b')).toMatchObject({ from: 60, to: 40 });
    // Nothing to predict when the question carries nothing.
    expect(weightAfterRemoving(template(), 'a')).toMatchObject({ from: 60, to: 50 });
  });
});

describe('finding the question behind an error', () => {
  it('indexes only the errors that name one', () => {
    const faults = errorsByQuestion([
      { code: 'NAME_REQUIRED', message: 'no name' },
      { code: 'NO_OPTIONS', message: 'no choices', questionId: 'a' },
      { code: 'LINE_KNOCKOUT', message: 'cannot fire', questionId: 'a' },
    ]);
    expect([...faults.keys()]).toEqual(['a']);
    expect(faults.get('a')).toHaveLength(2);
  });

  it('points at the question a real template is failing on', () => {
    const broken = template();
    broken.questions = broken.questions.map((q) =>
      (q.id === 'b' ? { ...q, type: 'single_choice' as const, config: { options: [] } } : q));
    const faults = errorsByQuestion(validateTemplate(broken).errors);
    expect([...faults.keys()]).toEqual(['b']);
  });
});

/**
 * Asking the same thing at more than one point.
 *
 * The model has no "stages" field on a question: each point carries its own
 * questionnaire, and a question asked twice is two rows sharing one code. That
 * is what makes an answer given at RFI carry into RFP instead of being asked
 * again — so "where is this asked?" has to be answered across the event's
 * questionnaires, and changing it has to keep the codes lined up.
 */
describe('asking a question at more than one point', () => {
  const question = (over: Partial<TemplateQuestion> & { id: string }): TemplateQuestion => ({
    templateId: 't', sectionId: 'rfi-s1', sequence: 1, code: 'CO.YEARS', type: 'number',
    title: 'Years trading', helpText: '', isRequired: true, envelope: 'TECHNICAL',
    weight: 20, scoringMethod: 'MANUAL', maxScore: 10, rubric: null, isKnockout: false,
    allowAttachment: false, askedPer: 'VENDOR', config: {}, ...over,
  });

  const pack = (): DraftQuestionnaire[] => [
    {
      point: 'RFI', category: null, templateId: 't', templateName: 'RFI', scoreScale: 100,
      sections: [{ id: 'rfi-s1', name: 'Company', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
      questions: [question({ id: 'rfi-q1' })],
    },
    {
      point: 'RFP', category: null, templateId: 't2', templateName: 'RFP', scoreScale: 100,
      sections: [{ id: 'rfp-s1', name: 'Method', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
      questions: [question({ id: 'rfp-q1', code: 'MTH.PLAN', sectionId: 'rfp-s1', title: 'Plan' })],
    },
  ];

  const source = () => pack()[0].questions[0];

  it('reports the points a code is actually asked at, in journey order', () => {
    expect(pointsAsking(pack(), 'CO.YEARS', null)).toEqual(['RFI']);
    expect(pointsAsking(pack(), 'nothing', null)).toEqual([]);
  });

  it('copies the question to another point under the same code', () => {
    const next = setAskedAtPoints(pack(), source(), null, ['RFI', 'RFP']);
    expect(pointsAsking(next, 'CO.YEARS', null)).toEqual(['RFI', 'RFP']);
    // A fresh id, because the two are separate rows on separate forms.
    const copy = next[1].questions.find((q) => q.code === 'CO.YEARS');
    expect(copy?.id).not.toBe('rfi-q1');
  });

  it('starts the copy unweighted — a fifth of an RFP is not a fifth of an RFQ', () => {
    const next = setAskedAtPoints(pack(), source(), null, ['RFI', 'RFP']);
    const copy = next[1].questions.find((q) => q.code === 'CO.YEARS');
    expect([copy?.weight, copy?.scoringMethod, copy?.maxScore]).toEqual([0, 'NONE', 0]);
    // And the original is untouched.
    expect(next[0].questions[0].weight).toBe(20);
  });

  it('lands it in a section of the same name, adding one when there is none', () => {
    const next = setAskedAtPoints(pack(), source(), null, ['RFI', 'RFP']);
    const added = next[1].sections.find((s) => s.name === 'Company');
    expect(added).toBeDefined();
    expect(added?.weight).toBe(0);
    expect(next[1].questions.find((q) => q.code === 'CO.YEARS')?.sectionId).toBe(added?.id);
  });

  it('reuses a section of the same name rather than adding a second', () => {
    const withSame = pack();
    withSame[1].sections = [
      { id: 'rfp-s1', name: 'Company', sequence: 1, weight: 100, askedPer: 'VENDOR' },
    ];
    const next = setAskedAtPoints(withSame, source(), null, ['RFI', 'RFP']);
    expect(next[1].sections).toHaveLength(1);
    expect(next[1].questions.find((q) => q.code === 'CO.YEARS')?.sectionId).toBe('rfp-s1');
  });

  it('stops asking it where it is unticked', () => {
    const both = setAskedAtPoints(pack(), source(), null, ['RFI', 'RFP']);
    const back = setAskedAtPoints(both, source(), null, ['RFI']);
    expect(pointsAsking(back, 'CO.YEARS', null)).toEqual(['RFI']);
    expect(back[1].questions.map((q) => q.code)).toEqual(['MTH.PLAN']);
  });

  it('refuses to leave it asked nowhere — that is a deletion, and deleting says so', () => {
    const next = setAskedAtPoints(pack(), source(), null, []);
    expect(pointsAsking(next, 'CO.YEARS', null)).toEqual(['RFI']);
  });

  it('leaves another category’s questionnaires alone', () => {
    const mixed: DraftQuestionnaire[] = [
      ...pack(),
      {
        point: 'RFP', category: 'IT Software', templateId: 't3', templateName: 'SW',
        scoreScale: 100, sections: [], questions: [],
      },
    ];
    const next = setAskedAtPoints(mixed, source(), null, ['RFI', 'RFP']);
    expect(next[2].questions).toEqual([]);
  });

  it('does nothing when the point is already asking it', () => {
    expect(setAskedAtPoints(pack(), source(), null, ['RFI'])).toEqual(pack());
  });
});

/**
 * The two ways between an event's questionnaire and a library template.
 *
 * They are not inverses and must not pretend to be. Coming in, a template
 * overwrites what the event asks and the event stops claiming library
 * provenance. Going out, the library gets its own copy under its own ids, so
 * neither document can reach the other afterwards.
 */
describe('folding a template into the event questionnaire', () => {
  const draft = (): DraftQuestionnaire => ({
    point: 'RFI', category: 'IT Software', templateId: 'qt-9', templateName: 'From the library',
    scoreScale: 100,
    sections: [{ id: 'd-s1', name: 'Old', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
    // An id the incoming template does not carry, so the import genuinely
    // removes it rather than happening to keep it under the same name.
    questions: [question('z', 'd-s1', 1)],
    audience: { z: { vendorIds: ['v1'], lineIds: null } },
  });

  const incoming = () => ({
    ...template(),
    name: 'Uploaded from a sheet',
    scoreScale: 10,
  });

  it('takes the incoming sections, questions and scale', () => {
    const next = draftFromTemplate(draft(), incoming());
    expect(next.questions.map((q) => q.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.sections.map((sec) => sec.name)).toEqual(['Capability', 'Delivery']);
    expect(next.scoreScale).toBe(10);
  });

  it('keeps the point and the category, which the upload knows nothing about', () => {
    const next = draftFromTemplate(draft(), incoming());
    expect(next.point).toBe('RFI');
    expect(next.category).toBe('IT Software');
  });

  it('stops claiming the library template it no longer holds', () => {
    expect(draftFromTemplate(draft(), incoming()).templateId).toBeNull();
    expect(draftFromTemplate(draft(), incoming()).templateName).toBe('Uploaded from a sheet');
  });

  it('keeps a narrowing whose question survived, and drops one whose did not', () => {
    const withZ = draftFromTemplate(draft(), {
      ...incoming(), questions: [...incoming().questions, question('z', 's1', 5)],
    });
    expect(withZ.audience?.z.vendorIds).toEqual(['v1']);
    expect(draftFromTemplate(draft(), incoming()).audience).toBeUndefined();
  });

  it('keeps the existing name when the upload brought none', () => {
    const next = draftFromTemplate(draft(), { ...incoming(), name: '   ' });
    expect(next.templateName).toBe('From the library');
  });
});

describe('lifting the event questionnaire into the library', () => {
  const draft = (): DraftQuestionnaire => ({
    point: 'RFP', category: 'IT Software', templateId: null, templateName: 'Worked out on RFP-21',
    scoreScale: 100,
    sections: [{ id: 'd-s1', name: 'Credentials', sequence: 1, weight: 100, askedPer: 'VENDOR' }],
    questions: [question('z', 'd-s1', 1)],
  });

  const saved = (over: Partial<Parameters<typeof templateFromDraft>[1]> = {}) =>
    templateFromDraft(draft(), {
      id: 'qt-new', name: '  IT software — RFP  ', appliesTo: ['RFP'],
      scopeType: 'CATEGORY', scopeId: 'IT Software', userId: 'u-1', now: 7, ...over,
    });

  it('names and codes the template, trimming what the buyer typed', () => {
    expect(saved().name).toBe('IT software — RFP');
    expect(saved().code).not.toBe('');
  });

  it('rewrites every id under the new template, so the two copies are separate', () => {
    const template = saved();
    expect(template.sections[0].id).toBe('qt-new-d-s1');
    expect(template.questions[0].id).toBe('qt-new-z');
    expect(template.questions[0].templateId).toBe('qt-new');
    expect(template.questions[0].sectionId).toBe('qt-new-d-s1');
  });

  it('serves the category the questionnaire was written against', () => {
    expect(saved().categories).toEqual(['IT Software']);
  });

  it('serves every category when the event never split by one', () => {
    const anywhere = templateFromDraft({ ...draft(), category: null }, {
      id: 'qt-new', name: 'General', appliesTo: ['RFP'], scopeType: 'TENANT',
      scopeId: 'tenant-1', userId: 'u-1', now: 7,
    });
    expect(anywhere.categories).toEqual([]);
  });

  it('falls back to the point it was written at when no point was ticked', () => {
    expect(saved({ appliesTo: [] }).appliesTo).toEqual(['RFP']);
  });

  it('starts at version 1 when it is new', () => {
    expect(saved().version).toBe(1);
    expect(saved().createdAt).toBe(7);
  });

  it('bumps the version and keeps the code and author when it replaces one', () => {
    const previous = {
      ...template(), id: 'qt-old', code: 'QT-ITSW', version: 3,
      createdBy: 'someone-else', createdAt: 1, status: 'PUBLISHED' as const,
    };
    const next = saved({ id: 'qt-old', previous });
    expect(next.version).toBe(4);
    expect(next.code).toBe('QT-ITSW');
    expect(next.createdBy).toBe('someone-else');
    expect(next.createdAt).toBe(1);
    expect(next.status).toBe('PUBLISHED');
  });
});
