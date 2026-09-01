/**
 * Questionnaire templates: the weighting maths, the three rules that keep a
 * score honest, and the multi-stage behaviour the studio is built around.
 */
import { describe, expect, it } from 'vitest';
import {
  PRICED_QUESTION_TYPES, VENDOR_INPUT_POINTS, emptyTemplate, inheritedCodes,
  newQuestion, nextTemplateId, normalise, questionsInSection, scoredQuestions,
  suggestCode, templateWeight, templatesFor, validateTemplate, validateWeighting,
  weightingForJourney,
} from '../questionnaireTemplates';
import {
  CATEGORY_TEMPLATES, DEFAULT_STAGE_WEIGHTING, TENANT_TEMPLATES,
} from '../../data/questionnaireTemplates';
import { defaultConfigFor } from '../questionTypes';
import { JOURNEY_PATTERNS } from '../journeyPatterns';
import type {
  QuestionnaireTemplate, StageWeight, TemplateQuestion, VendorInputPoint,
} from '../types';

const ALL = [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES];

function question(over: Partial<TemplateQuestion> = {}): TemplateQuestion {
  return {
    id: 'q1', templateId: 't1', sectionId: 's1', sequence: 1, code: 'A.ONE',
    type: 'short_text', title: 'A question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false, ...over,
    config: over.config ?? defaultConfigFor(over.type ?? 'short_text', over.id ?? 'q1'),
  };
}

function template(over: Partial<QuestionnaireTemplate> = {}): QuestionnaireTemplate {
  return {
    id: 't1', code: 'QT-RFI-X', name: 'A template', description: '',
    appliesTo: ['RFI'], categories: [],
    sections: [{ id: 's1', name: 'General', sequence: 1 }],
    questions: [question()],
    status: 'PUBLISHED', version: 1, scopeType: 'TENANT', scopeId: 'tenant-udaan',
    createdBy: 'u1', createdAt: 0, ...over,
  };
}

// ---------------------------------------------------------------------------

describe('weight normalisation', () => {
  it('turns relative weights into shares so nobody has to make them sum to 100', () => {
    const result = normalise([{ weight: 10 }, { weight: 15 }, { weight: 25 }]);
    expect(result.map((r) => Math.round(r.effectivePct))).toEqual([20, 30, 50]);
  });

  it('reports zero shares rather than dividing by zero', () => {
    const result = normalise([{ weight: 0 }, { weight: 0 }]);
    expect(result.map((r) => r.effectivePct)).toEqual([0, 0]);
  });

  it('ignores a negative weight rather than letting it cancel another', () => {
    const result = normalise([{ weight: 10 }, { weight: -50 }]);
    expect(result[0].effectivePct).toBe(100);
  });

  it('counts only the questions that actually reach a score', () => {
    const t = template({
      questions: [
        question({ id: 'a', weight: 10 }),
        question({ id: 'b', weight: 20, scoringMethod: 'NONE' }),
        question({ id: 'c', weight: 30, type: 'price_schedule' }),
      ],
    });
    expect(scoredQuestions(t).map((q) => q.id)).toEqual(['a']);
    expect(templateWeight(t)).toBe(10);
  });

  it('groups questions by section in sequence order', () => {
    const t = template({
      questions: [
        question({ id: 'b', sequence: 2 }),
        question({ id: 'a', sequence: 1 }),
        question({ id: 'c', sequence: 3, sectionId: 's2' }),
      ],
    });
    expect(questionsInSection(t, 's1').map((q) => q.id)).toEqual(['a', 'b']);
    expect(questionsInSection(t, 's2').map((q) => q.id)).toEqual(['c']);
  });
});

// ---------------------------------------------------------------------------

describe('rule 1 — price never carries a question weight', () => {
  it.each(PRICED_QUESTION_TYPES)('rejects a weighted %s', (type) => {
    const result = validateTemplate(template({
      appliesTo: ['RFQ'],
      questions: [question({ type, weight: 30, envelope: 'COMMERCIAL' })],
    }));
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.code === 'PRICE_CARRIES_WEIGHT');
    expect(issue?.message).toContain('counts price twice');
  });

  it('accepts a price schedule carrying no weight', () => {
    const result = validateTemplate(template({
      appliesTo: ['RFQ'],
      questions: [
        question({ type: 'price_schedule', weight: 0, scoringMethod: 'NONE', envelope: 'COMMERCIAL' }),
        question({ id: 'q2', code: 'B.TWO', weight: 10 }),
      ],
    }));
    expect(result.errors.map((e) => e.code)).not.toContain('PRICE_CARRIES_WEIGHT');
  });

  it('does not call an unweighted price schedule dead weight either', () => {
    const result = validateTemplate(template({
      appliesTo: ['RFQ'],
      questions: [question({ type: 'price_schedule', weight: 0, scoringMethod: 'NONE' })],
    }));
    expect(result.errors.map((e) => e.code)).not.toContain('WEIGHT_WITHOUT_SCORING');
  });
});

describe('rule 2 — RFI is pre-commercial', () => {
  it('rejects a commercial question in a template applied at RFI', () => {
    const result = validateTemplate(template({
      appliesTo: ['RFI'],
      questions: [question({ envelope: 'COMMERCIAL' })],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('COMMERCIAL_AT_RFI');
  });

  it('allows the same question once the template is applied at RFP instead', () => {
    const result = validateTemplate(template({
      appliesTo: ['RFP'],
      questions: [question({ envelope: 'COMMERCIAL' })],
    }));
    expect(result.errors.map((e) => e.code)).not.toContain('COMMERCIAL_AT_RFI');
  });
});

describe('rule 3 — weight without scoring is dead weight', () => {
  it('rejects a weighted question that is never scored', () => {
    const result = validateTemplate(template({
      questions: [question({ weight: 15, scoringMethod: 'NONE' })],
    }));
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.code === 'WEIGHT_WITHOUT_SCORING');
    expect(issue?.questionId).toBe('q1');
  });

  it('warns the other way round — scored but unweighted', () => {
    const result = validateTemplate(template({
      questions: [question({ weight: 0, scoringMethod: 'MANUAL' })],
    }));
    expect(result.warnings.map((w) => w.code)).toContain('SCORED_WITHOUT_WEIGHT');
  });
});

describe('other template validation', () => {
  it('requires a name and rejects one already taken, case-insensitively', () => {
    expect(validateTemplate(template({ name: '  ' })).errors.map((e) => e.code))
      .toContain('NAME_REQUIRED');
    expect(validateTemplate(template({ name: 'Dup' }), ['dup']).errors.map((e) => e.code))
      .toContain('NAME_TAKEN');
  });

  it('requires at least one point in the journey to apply at', () => {
    const result = validateTemplate(template({ appliesTo: [] }));
    expect(result.errors.map((e) => e.code)).toContain('NO_APPLIES_TO');
  });

  it('rejects an empty template', () => {
    const result = validateTemplate(template({ questions: [] }));
    expect(result.errors.map((e) => e.code)).toContain('NO_QUESTIONS');
  });

  it('rejects duplicate codes, because codes are the inheritance join key', () => {
    const result = validateTemplate(template({
      questions: [question({ id: 'a', code: 'SAME' }), question({ id: 'b', code: 'SAME' })],
    }));
    const issue = result.errors.find((e) => e.code === 'DUPLICATE_CODE');
    expect(issue?.message).toContain('across stages');
  });

  it('warns about a knockout the supplier is allowed to skip', () => {
    const result = validateTemplate(template({
      questions: [question({ isKnockout: true, isRequired: false })],
    }));
    expect(result.warnings.map((w) => w.code)).toContain('OPTIONAL_KNOCKOUT');
  });

  it('warns when a template gathers information but scores nothing', () => {
    const result = validateTemplate(template({
      questions: [question({ weight: 0, scoringMethod: 'NONE' })],
    }));
    expect(result.warnings.map((w) => w.code)).toContain('GATHERS_ONLY');
  });

  it('rejects a question pointing at a section that does not exist', () => {
    const result = validateTemplate(template({
      questions: [question({ sectionId: 'ghost' })],
    }));
    expect(result.errors.map((e) => e.code)).toContain('ORPHANED_QUESTION');
  });
});

// ---------------------------------------------------------------------------

describe('applying templates across the journey', () => {
  it('offers a template only at the points it declares', () => {
    const t = template({ appliesTo: ['RFI', 'RFP'] });
    expect(templatesFor([t], 'RFI')).toHaveLength(1);
    expect(templatesFor([t], 'AUCTION')).toHaveLength(0);
  });

  it('never offers a retired template', () => {
    const t = template({ status: 'RETIRED' });
    expect(templatesFor([t], 'RFI')).toHaveLength(0);
  });

  it('respects a category binding, and treats an empty binding as any', () => {
    const bound = template({ id: 'a', categories: ['Indirect'] });
    const open = template({ id: 'b', categories: [] });
    expect(templatesFor([bound, open], 'RFI', 'Indirect').map((t) => t.id)).toEqual(['a', 'b']);
    expect(templatesFor([bound, open], 'RFI', 'IT Hardware').map((t) => t.id)).toEqual(['b']);
  });

  it('finds codes asked at more than one point, so answers can be inherited', () => {
    const rfi = template({ id: 'a', appliesTo: ['RFI'], questions: [question({ code: 'CO.ISO' })] });
    const rfp = template({
      id: 'b', appliesTo: ['RFP'],
      questions: [question({ id: 'q2', code: 'CO.ISO' }), question({ id: 'q3', code: 'ONLY.RFP' })],
    });
    const shared = inheritedCodes([rfi, rfp]);
    expect(shared.map((c) => c.code)).toEqual(['CO.ISO']);
    expect(shared[0].points).toEqual(['RFI', 'RFP']);
    expect(shared[0].reAsked).toBe(true);
  });

  it('does not report a code asked twice at the same single point', () => {
    const only = template({ appliesTo: ['RFI'], questions: [question({ code: 'X' })] });
    expect(inheritedCodes([only])).toHaveLength(0);
  });
});

describe('stage weighting', () => {
  const weights: StageWeight[] = [
    { point: 'RFI', weight: 20 }, { point: 'RFP', weight: 60 }, { point: 'RFQ', weight: 20 },
  ];

  it('applies only to the points the journey actually runs, renormalised', () => {
    // JP-06 Two-Envelope Tender runs RFP only.
    const inForce = weightingForJourney(weights, JOURNEY_PATTERNS['JP-06'].vendorInputPoints);
    expect(inForce).toHaveLength(1);
    expect(inForce[0].item.point).toBe('RFP');
    expect(inForce[0].effectivePct).toBe(100);
  });

  it('renormalises across the full ladder when every point runs', () => {
    const inForce = weightingForJourney(weights, JOURNEY_PATTERNS['JP-05'].vendorInputPoints);
    const byPoint = Object.fromEntries(
      inForce.map((w) => [w.item.point, Math.round(w.effectivePct)]),
    );
    expect(byPoint).toEqual({ RFI: 20, RFP: 60, RFQ: 20, AUCTION: 0 });
  });

  it('defaults an unmentioned point to zero rather than dropping it', () => {
    const inForce = weightingForJourney([], ['RFI', 'RFP']);
    expect(inForce.map((w) => w.item.weight)).toEqual([0, 0]);
  });

  it('blocks a point that carries weight but has no template to earn it', () => {
    const result = validateWeighting(
      [{ point: 'RFI', weight: 50 }],
      [template({ appliesTo: ['RFP'] })],
      ['RFI', 'RFP'],
    );
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.code === 'WEIGHTED_POINT_UNSERVED');
    expect(issue?.message).toContain('can never be earned');
  });

  it('warns the other way — a served point carrying no weight', () => {
    const result = validateWeighting(
      [{ point: 'RFI', weight: 0 }, { point: 'RFP', weight: 100 }],
      [template({ id: 'a', appliesTo: ['RFI'] }), template({ id: 'b', appliesTo: ['RFP'] })],
      ['RFI', 'RFP'],
    );
    expect(result.warnings.map((w) => w.code)).toContain('UNWEIGHTED_POINT_SERVED');
  });

  it('blocks an all-zero weighting', () => {
    const result = validateWeighting(
      [{ point: 'RFI', weight: 0 }], [template()], ['RFI'],
    );
    expect(result.errors.map((e) => e.code)).toContain('ALL_ZERO');
  });

  it('notes a total that is not 100 without treating it as an error', () => {
    const result = validateWeighting(
      [{ point: 'RFI', weight: 30 }], [template()], ['RFI'],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NOT_HUNDRED');
  });

  it('says there is nothing to weight on a journey with no supplier input', () => {
    // JP-08 Rate Contract Call-off asks the supplier for nothing.
    const result = validateWeighting(
      [], [], JOURNEY_PATTERNS['JP-08'].vendorInputPoints,
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NO_INPUT_POINTS');
  });
});

// ---------------------------------------------------------------------------

describe('construction helpers', () => {
  it('numbers new templates without reusing an id', () => {
    expect(nextTemplateId([])).toBe('qt-001');
    expect(nextTemplateId(TENANT_TEMPLATES)).toBe('qt-006');
  });

  it('derives a code from the name and the first point it applies at', () => {
    expect(suggestCode('Supplier qualification', ['RFI'])).toBe('QT-RFI-SUPPLIER');
    // Both words fit inside the 18-character budget, so both survive.
    expect(suggestCode('Technical proposal', ['RFP'])).toBe('QT-RFP-TECHNICAL-PROPOSAL');
    expect(suggestCode('', ['RFP'])).toBe('QT-RFP-UNTITLED');
  });

  it('falls back to a hard cut when the first word alone is too long', () => {
    expect(suggestCode('Supercalifragilisticexpialidocious', ['RFI']))
      .toBe('QT-RFI-SUPERCALIFRAGILIST');
  });

  it('starts a new template as an invalid draft, so it cannot be published empty', () => {
    const t = emptyTemplate({
      id: 'qt-009', scopeType: 'TENANT', scopeId: 'tenant-udaan', userId: 'u1', now: 0,
    });
    expect(t.status).toBe('DRAFT');
    expect(validateTemplate(t).valid).toBe(false);
  });

  it('gives a new question a section and a sequence that follow the template', () => {
    const t = template({ questions: [question(), question({ id: 'q2', code: 'B' })] });
    const next = newQuestion(t, 's1');
    expect(next.sequence).toBe(3);
    expect(next.sectionId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------

describe('the seeded library', () => {
  it('covers every vendor input point the module defines', () => {
    expect(VENDOR_INPUT_POINTS).toEqual(['INTAKE', 'RFI', 'RFP', 'RFQ', 'NEGOTIATION', 'AUCTION']);
  });

  it('has a valid template for RFI, RFP, RFQ and negotiation', () => {
    for (const point of ['RFI', 'RFP', 'RFQ', 'NEGOTIATION'] as VendorInputPoint[]) {
      const usable = templatesFor(ALL, point).filter((t) => validateTemplate(t).valid);
      expect(usable.length, point).toBeGreaterThan(0);
    }
  });

  it('keeps every published template valid', () => {
    for (const t of ALL.filter((t) => t.status === 'PUBLISHED')) {
      const result = validateTemplate(t);
      expect(result.errors, `${t.code}: ${result.errors.map((e) => e.message).join(' ')}`)
        .toHaveLength(0);
    }
  });

  it('leaves exactly one draft invalid on purpose, so validation has real work', () => {
    const broken = ALL.find((t) => t.code === 'QT-RFI-COMBINED')!;
    const result = validateTemplate(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code).sort()).toEqual([
      'COMMERCIAL_AT_RFI', 'PRICE_CARRIES_WEIGHT', 'WEIGHT_WITHOUT_SCORING',
    ]);
  });

  it('spans seven codes across more than one point', () => {
    const shared = inheritedCodes(ALL.filter((t) => t.status === 'PUBLISHED'));
    expect(shared.map((c) => c.code)).toEqual([
      'CAP.CAPACITY', 'CO.ISO9001', 'CO.YEARS',
      // QT-003 applies at both RFQ and AUCTION, so its codes span two points
      // from one template rather than from two askings.
      'COM.INCOTERM', 'COM.PAYTERMS', 'COM.PRICES', 'COM.VALIDITY',
    ]);
  });

  it('marks only the codes two different templates ask as genuinely re-asked', () => {
    const shared = inheritedCodes(ALL.filter((t) => t.status === 'PUBLISHED'));
    const reAsked = shared.filter((c) => c.reAsked).map((c) => c.code);
    expect(reAsked).toEqual(['CAP.CAPACITY', 'CO.ISO9001', 'CO.YEARS', 'COM.PAYTERMS']);
  });

  it('does not call a single template reused at two points a second asking', () => {
    const shared = inheritedCodes(ALL.filter((t) => t.status === 'PUBLISHED'));
    const incoterm = shared.find((c) => c.code === 'COM.INCOTERM')!;
    expect(incoterm.points).toEqual(['RFQ', 'AUCTION']);
    expect(incoterm.templateIds).toEqual(['qt-003']);
    expect(incoterm.reAsked).toBe(false);
  });

  it('never weights a price schedule anywhere in the published library', () => {
    for (const t of ALL.filter((t) => t.status === 'PUBLISHED')) {
      for (const q of t.questions) {
        if (PRICED_QUESTION_TYPES.includes(q.type)) expect(q.weight, `${t.code}/${q.code}`).toBe(0);
      }
    }
  });

  it('ships a default weighting that sums to 100', () => {
    expect(DEFAULT_STAGE_WEIGHTING.reduce((sum, w) => sum + w.weight, 0)).toBe(100);
  });

  it('validates the default weighting against the full ladder', () => {
    const result = validateWeighting(
      DEFAULT_STAGE_WEIGHTING, ALL, JOURNEY_PATTERNS['JP-05'].vendorInputPoints,
    );
    expect(result.valid).toBe(true);
  });
});
