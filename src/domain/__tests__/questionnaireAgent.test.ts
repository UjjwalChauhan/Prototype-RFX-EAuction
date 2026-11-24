/**
 * AG-03, the questionnaire agent.
 *
 * Its mandate is draft-only and it cannot publish a questionnaire, so the
 * first thing these pin is that the module has no way to put a question into a
 * template except through a decision the buyer made. The rest is about whether
 * the suggestions are worth reading: that they change with the brief, that
 * they prefer this organisation's own wording over the corpus, that they cite
 * what they reused, and that the retrieval joins on the right records.
 *
 * That last one earned its tests the hard way. Two defects showed up only by
 * running the agent rather than reasoning about it — the corpus was scoped to
 * RFI and RFP so an RFQ got almost nothing, and the "nobody answered this"
 * signal was reading responses from events in other categories, where of
 * course nobody had answered because nobody was asked.
 */
import { describe, expect, it } from 'vitest';
import {
  QUESTIONNAIRE_AGENT, answerProbe, applyAccepted, canDraft, codesIn, describeSources,
  emptyBrief, libraryHits, nextProbe, proposeQuestions, rankProposals, workspaceSignals,
  type AgentProposal, type Decision,
} from '../questionnaireAgent';
import { AGENT_CATALOGUE } from '../agents';
import {
  CATEGORY_IDS, MARKET_PRACTICE, PROCUREMENT_CATEGORIES, UNIVERSAL_PRACTICE, categoriesBySuper,
  practiceFor,
} from '../../data/procurementCategories';
import {
  CATEGORY_TEMPLATES, LOGISTICS_TEMPLATES, TENANT_TEMPLATES,
} from '../../data/questionnaireTemplates';
import * as seed from '../../data/seed';
import type { QuestionnaireTemplate, VendorInputPoint } from '../types';

const LIBRARY = [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES, ...LOGISTICS_TEMPLATES];

/** A brief, as the interview would leave it. */
function briefed(categories: string[], point: VendorInputPoint, concerns: string[], spend?: string) {
  let brief = emptyBrief(categories, point);
  brief = answerProbe(brief, 'concerns', concerns);
  if (spend !== undefined) brief = answerProbe(brief, 'spend', [spend]);
  return brief;
}

const draft = (categories: string[], point: VendorInputPoint, concerns: string[], spend?: string) =>
  proposeQuestions({
    brief: briefed(categories, point, concerns, spend),
    library: LIBRARY,
    signals: workspaceSignals({
      categories,
      events: seed.EVENTS,
      questionnaires: seed.REQUEST_QUESTIONNAIRES(),
      responses: seed.RESPONSES,
      scores: seed.SCORES,
    }),
  });

// ---------------------------------------------------------------------------

describe('the category taxonomy', () => {
  it('keeps every category the seed data already names', () => {
    for (const existing of ['Facilities', 'Fleet', 'IT', 'Indirect', 'Logistics', 'Raw Materials', 'Services']) {
      expect(CATEGORY_IDS, existing).toContain(existing);
    }
  });

  it('covers goods and services, not only goods', () => {
    expect(PROCUREMENT_CATEGORIES.some((c) => c.isService)).toBe(true);
    expect(PROCUREMENT_CATEGORIES.some((c) => !c.isService)).toBe(true);
  });

  it('groups them for a picker without losing any', () => {
    const grouped = categoriesBySuper().flatMap((group) => group.items);
    expect(grouped).toHaveLength(PROCUREMENT_CATEGORIES.length);
  });

  it('keeps every id unique and every category described', () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
    for (const category of PROCUREMENT_CATEGORIES) {
      expect(category.description.length, category.id).toBeGreaterThan(20);
    }
  });

  it('gives every category the agent knows about a reason for each question', () => {
    for (const [category, questions] of Object.entries(MARKET_PRACTICE)) {
      expect(CATEGORY_IDS, category).toContain(category);
      for (const question of questions) {
        expect(question.why.length, `${category} ${question.code}`).toBeGreaterThan(30);
      }
    }
    for (const question of UNIVERSAL_PRACTICE) {
      expect(question.why.length, question.code).toBeGreaterThan(30);
    }
  });

  it('adds the universal set to whatever the category knows', () => {
    const known = practiceFor(['Logistics']).map((q) => q.code);
    expect(known).toContain('LOG.ISPM15');
    expect(known).toContain('GEN.INSURANCE');
  });

  it('never repeats a code when two categories are asked for at once', () => {
    const codes = practiceFor(['IT', 'Logistics']).map((q) => q.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('the interview', () => {
  it('asks what the buyer is trying to find out first', () => {
    expect(nextProbe(emptyBrief(['IT'], 'RFP'), [])?.id).toBe('concerns');
  });

  it('explains why it is asking, rather than just asking', () => {
    const probe = nextProbe(emptyBrief(['IT'], 'RFP'), []);
    expect(probe?.because.length).toBeGreaterThan(40);
  });

  it('will not let the buyer skip the one question it cannot draft without', () => {
    expect(nextProbe(emptyBrief(['IT'], 'RFP'), [])?.optional).toBe(false);
  });

  it('moves on once a probe is answered', () => {
    const brief = briefed(['IT'], 'RFP', ['COST']);
    expect(nextProbe(brief, ['concerns'])?.id).toBe('spend');
  });

  it('runs out of probes, rather than asking forever', () => {
    const brief = briefed(['IT'], 'RFP', ['COST']);
    expect(nextProbe(brief, ['concerns', 'spend', 'incumbent', 'notes'])).toBeNull();
  });

  it('lets every probe after the first be skipped', () => {
    const brief = briefed(['IT'], 'RFP', ['COST']);
    for (const answered of [['concerns'], ['concerns', 'spend'], ['concerns', 'spend', 'incumbent']]) {
      expect(nextProbe(brief, answered)?.optional).toBe(true);
    }
  });

  it('records each answer on the brief', () => {
    let brief = emptyBrief(['IT'], 'RFP');
    brief = answerProbe(brief, 'concerns', ['COST', 'RISK']);
    brief = answerProbe(brief, 'spend', ['HIGH']);
    brief = answerProbe(brief, 'incumbent', ['YES']);
    brief = answerProbe(brief, 'notes', ['Must integrate with our MDM.']);
    expect(brief.concerns).toEqual(['COST', 'RISK']);
    expect(brief.spend).toBe('HIGH');
    expect(brief.incumbent).toBe(true);
    expect(brief.notes).toEqual(['Must integrate with our MDM.']);
  });

  it('drops an empty note rather than recording a blank', () => {
    expect(answerProbe(emptyBrief(['IT'], 'RFP'), 'notes', ['  ']).notes).toEqual([]);
  });

  it('cannot draft without a category or without a concern', () => {
    expect(canDraft(emptyBrief([], 'RFP'))).toBe(false);
    expect(canDraft(emptyBrief(['IT'], 'RFP'))).toBe(false);
    expect(canDraft(briefed(['IT'], 'RFP', ['COST']))).toBe(true);
  });
});

describe('retrieval over this organisation’s own templates', () => {
  it('finds the questions already asked in the category', () => {
    const codes = libraryHits(LIBRARY, ['Logistics'], 'RFQ').map((hit) => hit.code);
    expect(codes).toContain('LOG.ISPM15');
  });

  it('cites the template each one came from', () => {
    const hit = libraryHits(LIBRARY, ['Logistics'], 'RFQ').find((h) => h.code === 'LOG.ISPM15');
    expect(hit?.usedBy).toContain('QT-RFQ-HANDLING');
  });

  it('ranks a code used by several templates above one used by one', () => {
    const hits = libraryHits(LIBRARY, ['Indirect'], 'RFQ');
    expect(hits[0].usedBy.length).toBeGreaterThanOrEqual(hits[hits.length - 1].usedBy.length);
  });

  it('ignores a template that does not apply at this point', () => {
    const codes = libraryHits(LIBRARY, ['Logistics'], 'RFI').map((hit) => hit.code);
    expect(codes).not.toContain('LOG.ISPM15');
  });

  it('ignores a retired template, which is no longer house practice', () => {
    const retired = LIBRARY.map(
      (t) => (t.code === 'QT-RFQ-HANDLING' ? { ...t, status: 'RETIRED' as const } : t),
    );
    const codes = libraryHits(retired, ['Logistics'], 'RFQ').map((hit) => hit.code);
    expect(codes).not.toContain('LOG.ISPM15');
  });

  it('does not offer another category’s template', () => {
    const codes = libraryHits(LIBRARY, ['Indirect'], 'RFQ').map((hit) => hit.code);
    expect(codes).not.toContain('LOG.POOL');
  });
});

describe('what the workspace can see', () => {
  const signals = (categories: string[]) => workspaceSignals({
    categories,
    events: seed.EVENTS,
    questionnaires: seed.REQUEST_QUESTIONNAIRES(),
    responses: seed.RESPONSES,
    scores: seed.SCORES,
  });

  it('finds a category that exists only on the basket, not on the event header', () => {
    // The consolidated RFQ is headed Indirect and buys pallets in Logistics.
    expect(seed.EVENTS.some((e) => e.category === 'Logistics')).toBe(false);
    expect(signals(['Logistics']).some((s) => s.id === 'history')).toBe(true);
  });

  it('judges a question only against the suppliers who were actually asked it', () => {
    // Reading every response in the workspace made every logistics question
    // look unanswered, because stationery bidders were never asked them.
    const unanswered = signals(['Logistics']).filter((s) => s.id.startsWith('unanswered-'));
    expect(unanswered).toEqual([]);
  });

  it('says nothing at all about a category with no history', () => {
    expect(signals(['Capital Equipment'])).toEqual([]);
  });

  it('states what it observed, not just that it observed something', () => {
    for (const signal of signals(['Logistics'])) {
      expect(signal.observation.length, signal.id).toBeGreaterThan(30);
    }
  });
});

describe('the questions it proposes', () => {
  it('proposes nothing until it knows what the buyer wants', () => {
    expect(proposeQuestions({
      brief: emptyBrief(['IT'], 'RFP'), library: LIBRARY, signals: [],
    })).toEqual([]);
  });

  it('changes with the concerns the buyer named', () => {
    const risk = draft(['IT'], 'RFP', ['RISK', 'COMPLIANCE']).map((p) => p.code);
    const cost = draft(['IT'], 'RFP', ['COST']).map((p) => p.code);
    expect(risk).toContain('IT.SECURITY');
    expect(cost).not.toContain('IT.SECURITY');
    expect(cost).toContain('GEN.PAYTERMS');
  });

  it('changes with the category', () => {
    const it = draft(['IT'], 'RFP', ['RISK']).map((p) => p.code);
    const fm = draft(['Facilities'], 'RFP', ['RISK']).map((p) => p.code);
    expect(it).toContain('IT.SECURITY');
    expect(fm).toContain('FM.SAFETY');
    expect(fm).not.toContain('IT.SECURITY');
  });

  it('asks for less when the spend does not justify more', () => {
    const big = draft(['IT'], 'RFP', ['RISK'], 'HIGH').map((p) => p.code);
    const small = draft(['IT'], 'RFP', ['RISK'], 'LOW').map((p) => p.code);
    expect(big).toContain('GEN.CONTINUITY');
    expect(small).not.toContain('GEN.CONTINUITY');
  });

  it('has something to say at RFQ, not only at RFI and RFP', () => {
    // The corpus was scoped to RFI and RFP, which emptied the stage buyers
    // raise most often.
    expect(draft(['Logistics'], 'RFQ', ['COST', 'COMPLIANCE']).length).toBeGreaterThan(3);
  });

  it('prefers this organisation’s own wording where it has some', () => {
    const reused = draft(['Logistics'], 'RFQ', ['COST', 'COMPLIANCE'])
      .find((p) => p.code === 'LOG.POOL');
    expect(reused?.source).toBe('LIBRARY');
    expect(reused?.citation).toContain('QT-RFQ-HANDLING');
  });

  it('says where every suggestion came from, with no exceptions', () => {
    for (const proposal of draft(['IT', 'Logistics'], 'RFQ', ['COST', 'SUSTAINABILITY'])) {
      expect(['MARKET_PRACTICE', 'LIBRARY', 'WORKSPACE']).toContain(proposal.source);
      expect(proposal.rationale.length, proposal.code).toBeGreaterThan(30);
    }
  });

  it('never proposes a question the template already asks', () => {
    const first = draft(['IT'], 'RFP', ['RISK']);
    const again = proposeQuestions({
      brief: briefed(['IT'], 'RFP', ['RISK']),
      library: LIBRARY,
      signals: [],
      existingCodes: first.map((p) => p.code),
    });
    expect(again).toEqual([]);
  });

  it('never proposes the same code twice', () => {
    const codes = draft(['IT', 'Logistics', 'Facilities'], 'RFP', ['RISK', 'COST']).map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('puts the knockouts first, because those are the ones to argue about', () => {
    const proposals = draft(['Facilities'], 'RFI', ['QUALITY', 'RISK']);
    const lastKnockout = proposals.map((p) => p.isKnockout).lastIndexOf(true);
    const firstPlain = proposals.map((p) => p.isKnockout).indexOf(false);
    expect(lastKnockout).toBeLessThan(firstPlain);
  });

  it('spreads its confidence rather than calling everything certain', () => {
    const scores = draft(['Facilities'], 'RFI', ['QUALITY', 'RISK']).map((p) => p.confidence);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(0.1);
    for (const score of scores) expect(score).toBeLessThanOrEqual(0.95);
  });

  it('warns when it proposes a knockout the buyer never asked for', () => {
    // Traceability is a quality question that happens to disqualify, so it is
    // reached by a brief that never mentioned compliance or risk.
    const proposals = draft(['Raw Materials'], 'RFP', ['QUALITY']);
    const knockout = proposals.find((p) => p.isKnockout);
    expect(knockout, 'no knockout was proposed at all').toBeDefined();
    expect(knockout?.rationale).toContain('consider whether this should disqualify');
  });

  it('does not add that warning when the buyer did raise risk', () => {
    const proposals = draft(['Raw Materials'], 'RFP', ['QUALITY', 'RISK']);
    const knockout = proposals.find((p) => p.isKnockout);
    expect(knockout?.rationale).not.toContain('consider whether this should disqualify');
  });

  it('summarises honestly where a draft came from', () => {
    const proposals = draft(['Logistics'], 'RFQ', ['COST', 'COMPLIANCE']);
    expect(describeSources(proposals)).toContain('reused from your own templates');
    expect(describeSources([])).toContain('Nothing to suggest');
  });

  it('is a pure function of the brief — the same brief drafts the same set', () => {
    const a = draft(['IT'], 'RFP', ['RISK']).map((p) => p.code);
    const b = draft(['IT'], 'RFP', ['RISK']).map((p) => p.code);
    expect(a).toEqual(b);
  });

  it('ranks without mutating what it was given', () => {
    const proposals = draft(['IT'], 'RFP', ['RISK']);
    const before = proposals.map((p) => p.code);
    rankProposals(proposals, briefed(['IT'], 'RFP', ['RISK']));
    expect(proposals.map((p) => p.code)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Accepting — the line AG-03 may not cross on its own
// ---------------------------------------------------------------------------

describe('the buyer decides, one question at a time', () => {
  const base = TENANT_TEMPLATES[0];
  const blank: QuestionnaireTemplate = { ...base, questions: [], sections: [base.sections[0]] };
  const proposals = draft(['Facilities'], 'RFI', ['QUALITY', 'RISK']);
  const all = (decision: Decision) =>
    Object.fromEntries(proposals.map((p) => [p.id, decision])) as Record<string, Decision>;

  it('adds nothing when nothing has been accepted', () => {
    expect(applyAccepted({ template: blank, proposals, decisions: all('PENDING') }))
      .toBe(blank);
    expect(applyAccepted({ template: blank, proposals, decisions: all('REJECTED') }))
      .toBe(blank);
  });

  it('adds exactly what was accepted, and nothing else', () => {
    const decisions = { ...all('REJECTED'), [proposals[0].id]: 'ACCEPTED' as Decision };
    const next = applyAccepted({ template: blank, proposals, decisions });
    expect(next.questions).toHaveLength(1);
    expect(next.questions[0].code).toBe(proposals[0].code);
  });

  it('leaves an undecided proposal out — silence is not consent', () => {
    const decisions = { ...all('PENDING'), [proposals[1].id]: 'ACCEPTED' as Decision };
    const next = applyAccepted({ template: blank, proposals, decisions });
    expect(next.questions.map((q) => q.code)).toEqual([proposals[1].code]);
  });

  it('creates the sections it files questions under', () => {
    const next = applyAccepted({ template: blank, proposals, decisions: all('ACCEPTED') });
    for (const question of next.questions) {
      expect(next.sections.some((s) => s.id === question.sectionId)).toBe(true);
    }
  });

  it('gives a section it created no weight, rather than guessing one', () => {
    const next = applyAccepted({ template: blank, proposals, decisions: all('ACCEPTED') });
    for (const section of next.sections) {
      if (base.sections.some((s) => s.id === section.id)) continue;
      expect(section.weight, section.name).toBe(0);
    }
  });

  it('reuses a section that already exists rather than making a second one', () => {
    const withSection: QuestionnaireTemplate = {
      ...blank,
      sections: [{ id: 'existing', name: 'Health & safety', sequence: 1, weight: 30, askedPer: 'VENDOR' }],
    };
    const safety = proposals.filter((p) => p.section === 'Health & safety');
    expect(safety.length).toBeGreaterThan(0);
    const next = applyAccepted({
      template: withSection,
      proposals: safety,
      decisions: Object.fromEntries(safety.map((p) => [p.id, 'ACCEPTED' as Decision])),
    });
    expect(next.sections).toHaveLength(1);
    expect(next.questions.every((q) => q.sectionId === 'existing')).toBe(true);
  });

  it('never collides with a question already in the template', () => {
    const next = applyAccepted({ template: blank, proposals, decisions: all('ACCEPTED') });
    const ids = next.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codesIn(next.questions)).size).toBe(next.questions.length);
  });

  it('continues the sequence rather than restarting it', () => {
    const next = applyAccepted({ template: base, proposals, decisions: all('ACCEPTED') });
    const sequences = next.questions.map((q) => q.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});

describe('the agent stays inside its mandate', () => {
  it('is the catalogue’s questionnaire builder, not a new agent', () => {
    expect(AGENT_CATALOGUE[QUESTIONNAIRE_AGENT].name).toBe('Questionnaire Builder');
  });

  it('may draft and no more', () => {
    expect(AGENT_CATALOGUE[QUESTIONNAIRE_AGENT].maxAutonomy).toBe('DRAFT');
  });

  it('is forbidden from publishing a questionnaire', () => {
    expect(AGENT_CATALOGUE[QUESTIONNAIRE_AGENT].cannot).toContain('Publish a questionnaire');
  });

  it('offers no way to apply a proposal except through a decision', () => {
    // `applyAccepted` takes decisions, not proposals, so there is no call
    // shape that puts an un-decided suggestion into a template.
    const proposals: AgentProposal[] = draft(['IT'], 'RFP', ['RISK']);
    const untouched = applyAccepted({
      template: TENANT_TEMPLATES[0], proposals, decisions: {},
    });
    expect(untouched).toBe(TENANT_TEMPLATES[0]);
  });
});
