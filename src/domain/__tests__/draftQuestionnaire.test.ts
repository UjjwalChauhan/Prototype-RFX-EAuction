/**
 * Shaping a questionnaire inside the Create Event wizard.
 *
 * The behaviour that matters here is that editing an event's questionnaire
 * never reaches back into the shared library, and that the states the library's
 * own rules would reject are unreachable from the editor rather than merely
 * reported after the fact.
 */
import { describe, expect, it } from 'vitest';
import {
  PRICED_QUESTION_TYPES, addDraftQuestion, blankQuestionnaire, draftAsTemplate,
  addDraftSection, instantiateTemplate, isScored, moveDraftQuestion,
  removeDraftQuestion, removeDraftSection, renameDraftSection, setDraftScored,
  seedQuestionnaires, setDraftType, templateWeight, templatesFor, validateTemplate,
} from '../questionnaireTemplates';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type { QuestionnaireTemplate } from '../types';

const RFI = TENANT_TEMPLATES.find((t) => t.appliesTo.includes('RFI') && t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

describe('instantiateTemplate', () => {
  it('copies every question the template defines', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    expect(draft.questions).toHaveLength(RFI.questions.length);
    expect(draft.sections).toHaveLength(RFI.sections.length);
    expect(draft.templateName).toBe(RFI.name);
  });

  it('re-keys ids under the event but keeps codes stable', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    for (const question of draft.questions) {
      expect(question.id.startsWith('evt-1')).toBe(true);
    }
    // Codes are the join key for answer inheritance across stages — re-keying
    // them would break the RFI answer being carried into RFP.
    expect(draft.questions.map((q) => q.code).sort())
      .toEqual(RFI.questions.map((q) => q.code).sort());
  });

  it('keeps questions attached to their section after re-keying', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const sectionIds = new Set(draft.sections.map((s) => s.id));
    for (const question of draft.questions) {
      if (question.sectionId !== null) expect(sectionIds.has(question.sectionId)).toBe(true);
    }
    // Which is exactly what the library's orphan rule checks for.
    const issues = validateTemplate(draftAsTemplate(draft));
    expect(issues.errors.map((e) => e.code)).not.toContain('ORPHANED_QUESTION');
  });

  it('does not mutate the library template it was built from', () => {
    const before = JSON.stringify(RFI);
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const edited = setDraftScored(
      removeDraftQuestion(draft, draft.questions[0].id), draft.questions[1].id, false,
    );
    expect(edited.questions.length).toBe(RFI.questions.length - 1);
    expect(JSON.stringify(RFI)).toBe(before);
  });
});

describe('editing questions', () => {
  it('adds a question into the section it was asked for', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const section = draft.sections[1].id;
    const next = addDraftQuestion(draft, section);
    expect(next.questions).toHaveLength(draft.questions.length + 1);
    expect(next.questions[next.questions.length - 1].sectionId).toBe(section);
  });

  it('gives an added question a unique id even after deletes', () => {
    let draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    draft = removeDraftQuestion(draft, draft.questions[0].id);
    draft = addDraftQuestion(draft, null);
    draft = addDraftQuestion(draft, null);
    const ids = draft.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('closes the sequence gap a delete leaves behind', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const next = removeDraftQuestion(draft, draft.questions[2].id);
    expect(next.questions.map((q) => q.sequence)).toEqual(
      next.questions.map((_, i) => i + 1),
    );
  });

  it('reorders without losing or duplicating a question', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const moved = moveDraftQuestion(draft, draft.questions[3].id, -1);
    expect(moved.questions).toHaveLength(draft.questions.length);
    expect(new Set(moved.questions.map((q) => q.code)).size).toBe(draft.questions.length);
    expect(moved.questions.map((q) => q.sequence)).toEqual(
      moved.questions.map((_, i) => i + 1),
    );
  });

  it('refuses to move past either end', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const first = draft.questions[0].id;
    const last = draft.questions[draft.questions.length - 1].id;
    expect(moveDraftQuestion(draft, first, -1)).toBe(draft);
    expect(moveDraftQuestion(draft, last, 1)).toBe(draft);
  });
});

describe('weight is optional, and never dead', () => {
  it('un-scoring a question clears its weight rather than leaving it inert', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const target = draft.questions.find((q) => isScored(q))!;
    const next = setDraftScored(draft, target.id, false);
    const after = next.questions.find((q) => q.id === target.id)!;
    expect(after.weight).toBe(0);
    expect(after.scoringMethod).toBe('NONE');
    expect(isScored(after)).toBe(false);
    // WEIGHT_WITHOUT_SCORING is the error this exists to make unreachable.
    const issues = validateTemplate(draftAsTemplate(next));
    expect(issues.errors.map((e) => e.code)).not.toContain('WEIGHT_WITHOUT_SCORING');
  });

  it('re-scoring restores a usable weight', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const target = draft.questions.find((q) => isScored(q))!;
    const off = setDraftScored(draft, target.id, false);
    const on = setDraftScored(off, target.id, true);
    const after = on.questions.find((q) => q.id === target.id)!;
    expect(after.weight).toBeGreaterThan(0);
    expect(after.scoringMethod).not.toBe('NONE');
  });

  it('an unweighted questionnaire is valid — a pure RFI may only gather', () => {
    let draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    for (const question of draft.questions) {
      draft = setDraftScored(draft, question.id, false);
    }
    expect(templateWeight(draftAsTemplate(draft))).toBe(0);
    const issues = validateTemplate(draftAsTemplate(draft));
    expect(issues.valid).toBe(true);
    expect(issues.warnings.map((w) => w.code)).toContain('GATHERS_ONLY');
  });

  it('will not let price carry weight', () => {
    const draft = addDraftQuestion(blankQuestionnaire('RFQ', 'evt-1'), null);
    const id = draft.questions[0].id;
    const priced = setDraftType(draft, id, PRICED_QUESTION_TYPES[0]);
    expect(priced.questions[0].weight).toBe(0);

    // And it stays at zero when the buyer tries to score it anyway.
    const forced = setDraftScored(priced, id, true);
    expect(forced.questions[0].weight).toBe(0);
    const issues = validateTemplate(draftAsTemplate(forced));
    expect(issues.errors.map((e) => e.code)).not.toContain('PRICE_CARRIES_WEIGHT');
  });
});

describe('RFI stays pre-commercial', () => {
  it('adds new questions as technical, not commercial', () => {
    const draft = addDraftQuestion(blankQuestionnaire('RFI', 'evt-1'), null);
    expect(draft.questions[0].envelope).toBe('TECHNICAL');
    expect(validateTemplate(draftAsTemplate(draft)).errors.map((e) => e.code))
      .not.toContain('COMMERCIAL_AT_RFI');
  });

  it('reports a commercial question the buyer sets at RFI', () => {
    const draft = addDraftQuestion(blankQuestionnaire('RFI', 'evt-1'), null);
    const commercial = {
      ...draft,
      questions: draft.questions.map((q) => ({ ...q, envelope: 'COMMERCIAL' as const })),
    };
    expect(validateTemplate(draftAsTemplate(commercial)).errors.map((e) => e.code))
      .toContain('COMMERCIAL_AT_RFI');
  });

  it('does not report the same question at RFP', () => {
    const draft = addDraftQuestion(blankQuestionnaire('RFP', 'evt-1'), null);
    const commercial = {
      ...draft,
      questions: draft.questions.map((q) => ({ ...q, envelope: 'COMMERCIAL' as const })),
    };
    expect(validateTemplate(draftAsTemplate(commercial)).errors.map((e) => e.code))
      .not.toContain('COMMERCIAL_AT_RFI');
  });
});

describe('sections', () => {
  it('keeps the questions when a section is removed', () => {
    const draft = instantiateTemplate(RFI, 'RFI', 'evt-1');
    const section = draft.sections[0];
    const inSection = draft.questions.filter((q) => q.sectionId === section.id);
    expect(inSection.length).toBeGreaterThan(0);

    const next = removeDraftSection(draft, section.id);
    expect(next.questions).toHaveLength(draft.questions.length);
    for (const question of inSection) {
      expect(next.questions.find((q) => q.id === question.id)!.sectionId).toBeNull();
    }
    // Ungrouped is a valid home; orphaned — pointing at a section that is gone —
    // is not, and is what the library rule rejects.
    expect(validateTemplate(draftAsTemplate(next)).errors.map((e) => e.code))
      .not.toContain('ORPHANED_QUESTION');
  });

  it('adds and renames a section', () => {
    const draft = addDraftSection(blankQuestionnaire('RFI', 'evt-1'), 'Compliance');
    expect(draft.sections.map((s) => s.name)).toContain('Compliance');
    const renamed = renameDraftSection(draft, draft.sections[1].id, 'Credentials');
    expect(renamed.sections[1].name).toBe('Credentials');
  });
});

describe('seedQuestionnaires', () => {
  const library = TENANT_TEMPLATES;

  it('populates every point the journey asks at', () => {
    const seeded = seedQuestionnaires({
      existing: [], points: ['RFI', 'RFP'], library, category: null, idSeed: 'evt-1',
    });
    expect(seeded.map((q) => q.point)).toEqual(['RFI', 'RFP']);
    for (const questionnaire of seeded) {
      expect(questionnaire.questions.length).toBeGreaterThan(0);
    }
  });

  it('populates from the template that applies at that point', () => {
    const [rfi] = seedQuestionnaires({
      existing: [], points: ['RFI'], library, category: null, idSeed: 'evt-1',
    });
    const source = templatesFor(library, 'RFI', null)[0];
    expect(rfi.templateId).toBe(source.id);
    expect(rfi.questions).toHaveLength(source.questions.length);
  });

  it('keeps edits already made at a point that survives a pattern switch', () => {
    const first = seedQuestionnaires({
      existing: [], points: ['RFI'], library, category: null, idSeed: 'evt-1',
    });
    const edited = removeDraftQuestion(first[0], first[0].questions[0].id);
    const after = seedQuestionnaires({
      existing: [edited], points: ['RFI', 'RFQ'], library, category: null, idSeed: 'evt-1',
    });
    expect(after.find((q) => q.point === 'RFI')).toBe(edited);
    expect(after.find((q) => q.point === 'RFQ')!.questions.length).toBeGreaterThan(0);
  });

  it('falls back to blank where no template applies', () => {
    const seeded = seedQuestionnaires({
      existing: [], points: ['INTAKE'], library, category: null, idSeed: 'evt-1',
    });
    expect(seeded[0].templateId).toBeNull();
    expect(seeded[0].questions).toEqual([]);
    // Blank still has somewhere to put the first question.
    expect(seeded[0].sections.length).toBeGreaterThan(0);
  });
});
