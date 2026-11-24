/**
 * Who a question is put to.
 *
 * The invariant under all of this is the difference between a rule and a
 * list. "Everyone" has to survive a supplier being invited next week; a list
 * of three ids has to stay three ids and not quietly become everyone when one
 * of them leaves. Most of these tests are about that one distinction, because
 * it is the one that is invisible on screen and expensive to get wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  EVERYONE, answerLoad, asksLine, asksVendor, audienceIssues, audienceOf, audienceSummary,
  commonAudience, isNarrowed, narrowedQuestions, pruneAudience, resolveAudience,
  setAudienceOnAll, setQuestionAudience, type AudienceHolder, type AudienceRoster,
} from '../questionAudience';
import type { QuestionScope, TemplateQuestion } from '../types';

function question(id: string, over: Partial<TemplateQuestion> = {}): TemplateQuestion {
  return {
    id, templateId: 'qt-1', sectionId: 's1', sequence: 1, code: id.toUpperCase(),
    type: 'short_text', title: `Question ${id}`, helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10, rubric: null,
    isKnockout: false, allowAttachment: false, askedPer: 'VENDOR', config: {}, ...over,
  };
}

const roster: AudienceRoster = {
  vendorIds: ['v1', 'v2', 'v3', 'v4'],
  lineIds: ['l1', 'l2', 'l3'],
};

function holder(over: Partial<AudienceHolder> = {}): AudienceHolder {
  return { questions: [question('a'), question('b')], ...over };
}

/** Every question is asked at supplier grain unless a test says otherwise. */
const vendorGrain = (): QuestionScope => 'VENDOR';
const lineGrain = (): QuestionScope => 'LINE';

describe('the default', () => {
  it('asks everyone, and is stored as nothing at all', () => {
    const form = holder();
    expect(form.audience).toBeUndefined();
    expect(audienceOf(form, 'a')).toEqual(EVERYONE);
  });

  it('includes a supplier nobody has heard of, because it is a rule', () => {
    expect(asksVendor(EVERYONE, 'v-invited-tomorrow')).toBe(true);
    expect(asksLine(EVERYONE, 'l-added-tomorrow')).toBe(true);
  });

  it('reads as nothing in a table, so the narrowed rows are the visible ones', () => {
    expect(audienceSummary(EVERYONE, roster, 'VENDOR')).toBeNull();
    expect(audienceSummary(EVERYONE, roster, 'LINE')).toBeNull();
  });

  it('counts a line narrowing as nothing at supplier grain', () => {
    const audience = { vendorIds: null, lineIds: ['l1'] };
    expect(isNarrowed(audience, 'VENDOR')).toBe(false);
    expect(isNarrowed(audience, 'LINE')).toBe(true);
    expect(audienceSummary(audience, roster, 'VENDOR')).toBeNull();
  });
});

describe('resolving a narrowing against the roster', () => {
  it('expands everyone to the whole roster', () => {
    expect(resolveAudience(EVERYONE, roster)).toEqual({
      vendorIds: ['v1', 'v2', 'v3', 'v4'], lineIds: ['l1', 'l2', 'l3'],
    });
  });

  it('keeps roster order, not the order the ids were picked in', () => {
    const reach = resolveAudience({ vendorIds: ['v3', 'v1'], lineIds: null }, roster);
    expect(reach.vendorIds).toEqual(['v1', 'v3']);
  });

  it('drops an id the event no longer holds rather than counting it', () => {
    const reach = resolveAudience({ vendorIds: ['v1', 'v-gone'], lineIds: null }, roster);
    expect(reach.vendorIds).toEqual(['v1']);
  });
});

describe('the summary a table cell shows', () => {
  it('counts suppliers against the roster', () => {
    expect(audienceSummary({ vendorIds: ['v1', 'v2'], lineIds: null }, roster, 'VENDOR'))
      .toBe('2/4 suppliers');
  });

  it('says both when both are narrowed at line grain', () => {
    expect(audienceSummary({ vendorIds: ['v1'], lineIds: ['l1', 'l2'] }, roster, 'LINE'))
      .toBe('1/4 suppliers · 2/3 lines');
  });

  it('says so plainly when the narrowing reaches nobody', () => {
    expect(audienceSummary({ vendorIds: [], lineIds: null }, roster, 'VENDOR'))
      .toBe('No supplier');
    expect(audienceSummary({ vendorIds: null, lineIds: [] }, roster, 'LINE'))
      .toBe('No line');
  });
});

describe('how many answers it comes back as', () => {
  it('is one per supplier asked, at supplier grain', () => {
    expect(answerLoad(EVERYONE, roster, 'VENDOR')).toEqual({ vendors: 4, lines: 0, answers: 4 });
  });

  it('multiplies out at line grain, which is the number worth seeing', () => {
    expect(answerLoad(EVERYONE, roster, 'LINE')).toEqual({ vendors: 4, lines: 3, answers: 12 });
  });

  it('falls with the narrowing', () => {
    const audience = { vendorIds: ['v1', 'v2'], lineIds: ['l3'] };
    expect(answerLoad(audience, roster, 'LINE')).toEqual({ vendors: 2, lines: 1, answers: 2 });
  });

  it('is zero when nobody is asked', () => {
    expect(answerLoad({ vendorIds: [], lineIds: null }, roster, 'VENDOR').answers).toBe(0);
  });
});

describe('storing a narrowing', () => {
  it('records the ids against the question and leaves the rest alone', () => {
    const next = setQuestionAudience(
      holder(), 'a', { vendorIds: ['v1', 'v2'], lineIds: null }, roster,
    );
    expect(next.audience).toEqual({ a: { vendorIds: ['v1', 'v2'], lineIds: null } });
    expect(audienceOf(next, 'b')).toEqual(EVERYONE);
  });

  it('keeps the ids in roster order however they were ticked', () => {
    const next = setQuestionAudience(
      holder(), 'a', { vendorIds: ['v4', 'v1'], lineIds: null }, roster,
    );
    expect(next.audience?.a.vendorIds).toEqual(['v1', 'v4']);
  });

  it('turns a selection covering everyone back into the rule, not a full list', () => {
    const next = setQuestionAudience(
      holder(), 'a', { vendorIds: ['v1', 'v2', 'v3', 'v4'], lineIds: null }, roster,
    );
    expect(next.audience).toBeUndefined();
    expect(audienceOf(next, 'a')).toEqual(EVERYONE);
  });

  it('keeps a narrowing that reaches nobody, so the buyer has to fix it', () => {
    const next = setQuestionAudience(holder(), 'a', { vendorIds: [], lineIds: null }, roster);
    expect(next.audience?.a.vendorIds).toEqual([]);
  });

  it('drops the whole map when the last narrowing is undone', () => {
    const narrow = setQuestionAudience(
      holder(), 'a', { vendorIds: ['v1'], lineIds: null }, roster,
    );
    const widened = setQuestionAudience(narrow, 'a', EVERYONE, roster);
    expect(widened.audience).toBeUndefined();
  });

  it('returns the same object when nothing changed', () => {
    const form = holder();
    expect(setQuestionAudience(form, 'a', EVERYONE, roster)).toBe(form);
    const narrow = setQuestionAudience(form, 'a', { vendorIds: ['v1'], lineIds: null }, roster);
    expect(setQuestionAudience(narrow, 'a', { vendorIds: ['v1'], lineIds: null }, roster))
      .toBe(narrow);
  });
});

describe('tagging several questions at once', () => {
  it('applies the same narrowing to all of them', () => {
    const next = setAudienceOnAll(holder(), ['a', 'b'], { vendorIds: ['v2'] }, roster);
    expect(next.audience?.a.vendorIds).toEqual(['v2']);
    expect(next.audience?.b.vendorIds).toEqual(['v2']);
  });

  it('changes only the grain it was given, leaving the other as it was', () => {
    const narrow = setAudienceOnAll(holder(), ['a'], { lineIds: ['l1'] }, roster);
    const next = setAudienceOnAll(narrow, ['a'], { vendorIds: ['v1'] }, roster);
    expect(next.audience?.a).toEqual({ vendorIds: ['v1'], lineIds: ['l1'] });
  });

  it('puts them all back to everyone in one pass', () => {
    const narrow = setAudienceOnAll(holder(), ['a', 'b'], { vendorIds: ['v1'] }, roster);
    const widened = setAudienceOnAll(
      narrow, ['a', 'b'], { vendorIds: null, lineIds: null }, roster,
    );
    expect(widened.audience).toBeUndefined();
  });

  it('reports what they share, so a bulk picker opens on the truth', () => {
    const same = setAudienceOnAll(holder(), ['a', 'b'], { vendorIds: ['v1'] }, roster);
    expect(commonAudience(same, ['a', 'b'])?.vendorIds).toEqual(['v1']);
  });

  it('reports nothing shared when they disagree, rather than one of the two', () => {
    const mixed = setAudienceOnAll(
      setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1'] }, roster),
      ['b'], { vendorIds: ['v2'] }, roster,
    );
    expect(commonAudience(mixed, ['a', 'b'])).toBeNull();
  });

  it('treats two questions nobody narrowed as agreeing on everyone', () => {
    expect(commonAudience(holder(), ['a', 'b'])).toEqual(EVERYONE);
  });
});

describe('listing what has been narrowed', () => {
  it('leaves out the questions asked of everyone', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1'] }, roster);
    const listed = narrowedQuestions(form, roster, vendorGrain);
    expect(listed.map((n) => n.question.id)).toEqual(['a']);
    expect(listed[0].summary).toBe('1/4 suppliers');
  });
});

describe('what is wrong with a narrowing', () => {
  it('calls a question asked of nobody an error', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: [] }, roster);
    const issues = audienceIssues(form, roster, vendorGrain);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ questionId: 'a', tone: 'error' });
    expect(issues[0].message).toContain('no supplier');
  });

  it('calls a line question asked about no line an error', () => {
    const form = setAudienceOnAll(holder(), ['a'], { lineIds: [] }, roster);
    const issues = audienceIssues(form, roster, lineGrain);
    expect(issues[0].message).toContain('no line');
  });

  it('warns that a scored question not asked of everyone is not like for like', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1', 'v2'] }, roster);
    const issues = audienceIssues(form, roster, vendorGrain);
    expect(issues[0]).toMatchObject({ questionId: 'a', tone: 'warning' });
    expect(issues[0].message).toContain('2 of the 4 suppliers are not asked it');
  });

  it('says nothing about an unweighted question, which costs nobody anything', () => {
    const form = setAudienceOnAll(
      { questions: [question('a', { weight: 0, scoringMethod: 'NONE' })] },
      ['a'], { vendorIds: ['v1'] }, roster,
    );
    expect(audienceIssues(form, roster, vendorGrain)).toEqual([]);
  });

  it('says nothing at all about a question asked of everyone', () => {
    expect(audienceIssues(holder(), roster, vendorGrain)).toEqual([]);
  });
});

describe('pruning what the event no longer holds', () => {
  it('drops a supplier who has left the shortlist', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1', 'v2'] }, roster);
    const pruned = pruneAudience(form, { vendorIds: ['v1', 'v3', 'v4'], lineIds: roster.lineIds });
    expect(pruned.audience?.a.vendorIds).toEqual(['v1']);
  });

  it('leaves a narrowing that lost everyone as "nobody", never as "everyone"', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v2'] }, roster);
    const pruned = pruneAudience(form, { vendorIds: ['v1'], lineIds: roster.lineIds });
    expect(pruned.audience?.a.vendorIds).toEqual([]);
    expect(audienceSummary(audienceOf(pruned, 'a'), { vendorIds: ['v1'], lineIds: [] }, 'VENDOR'))
      .toBe('No supplier');
  });

  it('forgets a question that has been deleted', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1'] }, roster);
    const pruned = pruneAudience({ ...form, questions: [question('b')] }, roster);
    expect(pruned.audience).toBeUndefined();
  });

  it('returns the same object when there is nothing to clear', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1'] }, roster);
    expect(pruneAudience(form, roster)).toBe(form);
    const untouched = holder();
    expect(pruneAudience(untouched, roster)).toBe(untouched);
  });

  it('is idempotent, so a screen that prunes on every render settles', () => {
    const form = setAudienceOnAll(holder(), ['a'], { vendorIds: ['v1', 'v-gone'] }, roster);
    const once = pruneAudience(form, roster);
    expect(pruneAudience(once, roster)).toBe(once);
  });
});
