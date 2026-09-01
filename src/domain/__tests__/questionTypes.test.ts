/**
 * Answer formats: what a question type needs before it can be asked, what
 * survives a type change, and the two defects that only exist once a question
 * has choices — a rule with nothing to compute, and a knockout that cannot fire.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_PRESETS, QUESTION_TYPES_BY_GROUP, QUESTION_TYPE_SPEC, appendOption, bestOptionScore,
  carryConfig, defaultConfigFor, formatSummary, isChoiceType, keysFor, optionsFromPreset,
  presetById, presetsFor, validateQuestionConfig,
} from '../questionTypes';
import { validateTemplate } from '../questionnaireTemplates';
import { CATEGORY_TEMPLATES, TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type { QuestionOption, QuestionType, QuestionnaireTemplate, TemplateQuestion } from '../types';

const ALL = [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES];

function question(over: Partial<TemplateQuestion> = {}): TemplateQuestion {
  const type = over.type ?? 'short_text';
  return {
    id: 'q1', templateId: 't1', sectionId: 's1', sequence: 1, code: 'A.ONE',
    type, title: 'A question', helpText: '', isRequired: true,
    envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL', maxScore: 10,
    rubric: null, isKnockout: false, allowAttachment: false,
    ...over,
    config: over.config ?? defaultConfigFor(type, 'q1'),
  };
}

function option(over: Partial<QuestionOption> = {}): QuestionOption {
  return { id: 'o1', label: 'A choice', score: null, isDisqualifying: false, requiresDetail: false, ...over };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

// ---------------------------------------------------------------------------

describe('the type catalogue', () => {
  it('says what every type asks the supplier for', () => {
    for (const [type, spec] of Object.entries(QUESTION_TYPE_SPEC)) {
      expect(spec.label, type).not.toBe('');
      expect(spec.asks, type).not.toBe('');
    }
  });

  it('offers only types that ask the supplier something', () => {
    const offered = QUESTION_TYPES_BY_GROUP.flatMap((group) => group.types);
    // Section breaks and page breaks are layout, not questions — they are in
    // the model because a rendered form needs them, not in the builder's list.
    expect(offered).not.toContain('section');
    expect(offered).not.toContain('page_break');
    expect(offered).toContain('multiple_choice');
  });

  it('knows which types are answered from a list', () => {
    expect(isChoiceType('multiple_choice')).toBe(true);
    expect(isChoiceType('single_choice')).toBe(true);
    expect(isChoiceType('yes_no')).toBe(true);
    expect(isChoiceType('long_text')).toBe(false);
    expect(isChoiceType('price_schedule')).toBe(false);
  });

  it('gives every choice type the options facet, or it could not be answered', () => {
    const types = Object.keys(QUESTION_TYPE_SPEC) as QuestionType[];
    for (const type of types.filter(isChoiceType)) {
      expect(QUESTION_TYPE_SPEC[type].facets, type).toContain('options');
    }
  });
});

describe('defaults', () => {
  it('gives yes/no its two answers already scored', () => {
    const config = defaultConfigFor('yes_no', 'q1');
    expect(config.options?.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(config.options?.map((o) => o.score)).toEqual([10, 0]);
  });

  it('leaves an open choice list empty rather than inventing two placeholders', () => {
    // "Option 1 / Option 2" looks finished and ships. An empty list reads as
    // unfinished, and the validator says so.
    expect(defaultConfigFor('multiple_choice', 'q1').options).toEqual([]);
  });

  it('fixes a unit wherever a number would otherwise be ambiguous', () => {
    expect(defaultConfigFor('lead_time', 'q1').unit).toBe('days');
    expect(defaultConfigFor('capacity_declaration', 'q1').unit).toBe('units / month');
  });

  it('gives a grid type columns to start from', () => {
    expect(defaultConfigFor('quantity_break', 'q1').columns).toEqual(['From qty', 'To qty', 'Unit price']);
  });
});

describe('changing a question type', () => {
  it('keeps the choices when single choice becomes multiple choice', () => {
    const options = [option({ id: 'o1', label: 'North' }), option({ id: 'o2', label: 'South' })];
    const next = carryConfig('single_choice', 'multiple_choice', { options }, 'q1');
    expect(next.options).toEqual(options);
  });

  it('drops what the new type cannot read', () => {
    const next = carryConfig('multiple_choice', 'number', { options: [option()] }, 'q1');
    expect(next.options).toBeUndefined();
    expect(next.unit).toBe('');
  });

  it('leaves no formula behind on a question that is no longer calculated', () => {
    const next = carryConfig('calculated_field', 'short_text', { formula: '{A} * 2' }, 'q1');
    expect(next.formula).toBeUndefined();
    expect(keysFor('short_text')).toEqual(['maxLength']);
  });

  it('keeps the columns when one grid type becomes another', () => {
    const next = carryConfig('table', 'rate_table', { columns: ['Site', 'Rate'] }, 'q1');
    expect(next.columns).toEqual(['Site', 'Rate']);
  });
});

describe('suggested option sets', () => {
  it('only suggests sets for types that take options', () => {
    for (const preset of OPTION_PRESETS) {
      for (const type of preset.types) {
        expect(QUESTION_TYPE_SPEC[type].facets, `${preset.id} → ${type}`).toContain('options');
      }
    }
  });

  it('never suggests a set that would fail validation', () => {
    for (const preset of OPTION_PRESETS) {
      expect(preset.options.length, preset.id).toBeGreaterThan(1);
      const labels = preset.options.map((o) => o.label.toLowerCase());
      expect(new Set(labels).size, preset.id).toBe(labels.length);
    }
  });

  it('marks the answer that should knock a supplier out', () => {
    const compliance = presetById('compliance');
    expect(compliance.options.find((o) => o.label === 'Not comply')?.isDisqualifying).toBe(true);
  });

  it('leaves a fact about the supplier unscored', () => {
    // Legal form is not a merit. Scoring it would rank a private limited
    // company above a partnership for being one.
    expect(presetById('org-type').options.every((o) => o.score === undefined)).toBe(true);
  });

  it('offers the organisation and certification sets on the types that ask them', () => {
    expect(presetsFor('single_choice').map((p) => p.id)).toContain('org-type');
    expect(presetsFor('multiple_choice').map((p) => p.id)).toContain('certifications');
    expect(presetsFor('long_text')).toHaveLength(0);
  });

  it('gives every generated choice its own id', () => {
    const options = optionsFromPreset(presetById('incoterms'), 'q7');
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    expect(bestOptionScore(options)).toBe(10);
  });
});

describe('a choice question that cannot be answered', () => {
  it('rejects a list with fewer than two choices', () => {
    const result = validateQuestionConfig(question({ type: 'single_choice', config: { options: [] } }));
    expect(codes(result.errors)).toContain('NO_OPTIONS');
  });

  it('rejects a choice with no wording', () => {
    const config = { options: [option({ id: 'o1', label: 'Yes' }), option({ id: 'o2', label: '  ' })] };
    expect(codes(validateQuestionConfig(question({ type: 'single_choice', config })).errors))
      .toContain('BLANK_OPTION');
  });

  it('rejects the same choice listed twice', () => {
    const config = { options: [option({ id: 'o1', label: 'Net 30' }), option({ id: 'o2', label: 'net 30' })] };
    expect(codes(validateQuestionConfig(question({ type: 'single_choice', config })).errors))
      .toContain('DUPLICATE_OPTION');
  });

  it('accepts a list that is complete', () => {
    const config = { options: optionsFromPreset(presetById('incoterms'), 'q1') };
    const result = validateQuestionConfig(
      question({ type: 'single_choice', config, scoringMethod: 'RULE' }),
    );
    expect(result.errors).toHaveLength(0);
  });
});

describe('scoring a choice question', () => {
  it('rejects a rule with nothing to compute', () => {
    const config = { options: [option({ id: 'o1', label: 'Yes' }), option({ id: 'o2', label: 'No' })] };
    const result = validateQuestionConfig(
      question({ type: 'single_choice', config, scoringMethod: 'RULE' }),
    );
    expect(codes(result.errors)).toContain('RULE_WITHOUT_SCORES');
  });

  it('warns when the scores on the choices are never read', () => {
    const config = { options: optionsFromPreset(presetById('yes-no'), 'q1') };
    const result = validateQuestionConfig(
      question({ type: 'yes_no', config, scoringMethod: 'MANUAL' }),
    );
    expect(codes(result.warnings)).toContain('OPTION_SCORES_IGNORED');
  });
});

describe('a knockout that cannot fire', () => {
  it('rejects a knockout where no answer fails', () => {
    // The worst kind of defect: it reads as protection and provides none.
    const config = { options: optionsFromPreset(presetById('yes-no'), 'q1') };
    const result = validateQuestionConfig(
      question({ type: 'single_choice', config, scoringMethod: 'RULE', isKnockout: true }),
    );
    expect(codes(result.errors)).toContain('KNOCKOUT_WITHOUT_TRIGGER');
  });

  it('accepts a knockout with a failing answer', () => {
    const config = { options: optionsFromPreset(presetById('compliance'), 'q1') };
    const result = validateQuestionConfig(
      question({ type: 'single_choice', config, scoringMethod: 'RULE', isKnockout: true }),
    );
    expect(codes(result.errors)).toHaveLength(0);
  });
});

describe('bounds', () => {
  it('rejects a selection range no supplier can satisfy', () => {
    const config = {
      options: [option({ id: 'o1', label: 'A' }), option({ id: 'o2', label: 'B' })],
      minSelections: 4, maxSelections: null,
    };
    expect(codes(validateQuestionConfig(question({ type: 'multiple_choice', config })).errors))
      .toContain('SELECTION_RANGE');
  });

  it('rejects a minimum above a maximum', () => {
    const config = { min: 90, max: 30, unit: 'days' };
    expect(codes(validateQuestionConfig(question({ type: 'number', config })).errors))
      .toContain('NUMERIC_RANGE');
  });

  it('warns about a figure with no unit', () => {
    const config = { min: 0, max: 100, unit: '' };
    expect(codes(validateQuestionConfig(question({ type: 'number', config })).warnings))
      .toContain('NO_UNIT');
  });

  it('rejects a date window that closes before it opens', () => {
    const config = { earliest: '2026-06-01', latest: '2026-01-01' };
    expect(codes(validateQuestionConfig(question({ type: 'date', config })).errors))
      .toContain('DATE_WINDOW');
  });
});

describe('grids', () => {
  it('rejects a table with no columns', () => {
    expect(codes(validateQuestionConfig(question({ type: 'table', config: { columns: [] } })).errors))
      .toContain('GRID_EMPTY');
  });

  it('rejects a matrix with no rows to rate', () => {
    const config = { rows: [], options: optionsFromPreset(presetById('rating-5'), 'q1') };
    expect(codes(validateQuestionConfig(question({ type: 'matrix_rating', config })).errors))
      .toContain('GRID_EMPTY');
  });

  it('does not ask a price schedule for its rows', () => {
    // They are the event's line items. Typing them again is how they drift.
    const result = validateQuestionConfig(
      question({ type: 'price_schedule', config: { columns: ['Unit price'], rows: [] } }),
    );
    expect(codes(result.errors)).toHaveLength(0);
  });
});

describe('types that carry text', () => {
  it('rejects a calculated field with no formula', () => {
    expect(codes(validateQuestionConfig(question({ type: 'calculated_field', config: { formula: '' } })).errors))
      .toContain('FORMULA_REQUIRED');
  });

  it('rejects a compliance statement that never states the clause', () => {
    const config = { body: '', options: optionsFromPreset(presetById('compliance'), 'q1') };
    expect(codes(validateQuestionConfig(question({ type: 'compliance_statement', config })).errors))
      .toContain('CLAUSE_REQUIRED');
  });
});

describe('the collapsed summary', () => {
  it('says how many choices there are without opening the question', () => {
    const config = {
      options: optionsFromPreset(presetById('regions'), 'q1'),
      minSelections: 1, maxSelections: null,
    };
    expect(formatSummary(question({ type: 'multiple_choice', config })))
      .toBe('6 choices · at least 1');
  });

  it('flags a choice question that has none', () => {
    expect(formatSummary(question({ type: 'single_choice', config: { options: [] } })))
      .toBe('no choices defined');
  });

  it('shows the bounds and the unit for a number', () => {
    expect(formatSummary(question({ type: 'number', config: { min: 0, max: 200, unit: 'years' } })))
      .toBe('0–200 years');
  });
});

describe('adding a choice', () => {
  it('never reuses an id', () => {
    const q = question({
      type: 'single_choice',
      config: { options: [option({ id: 'q1-opt-1' }), option({ id: 'q1-opt-2' })] },
    });
    const next = appendOption(q);
    expect(new Set(next.map((o) => o.id)).size).toBe(next.length);
  });
});

describe('templates carry the format through', () => {
  it('reports a config defect against the question it belongs to', () => {
    const template: QuestionnaireTemplate = {
      id: 't1', code: 'QT-RFI-X', name: 'A template', description: '',
      appliesTo: ['RFI'], categories: [],
      sections: [{ id: 's1', name: 'General', sequence: 1 }],
      questions: [question({ type: 'single_choice', config: { options: [] } })],
      status: 'DRAFT', version: 1, scopeType: 'TENANT', scopeId: 'tenant-udaan',
      createdBy: 'u1', createdAt: 0,
    };
    const result = validateTemplate(template);
    const issue = result.errors.find((e) => e.code === 'NO_OPTIONS');
    expect(issue?.questionId).toBe('q1');
  });

  it('gives every seeded choice question a real list to pick from', () => {
    for (const template of ALL) {
      for (const q of template.questions.filter((candidate) => isChoiceType(candidate.type))) {
        expect((q.config.options ?? []).length, `${template.code} / ${q.code}`).toBeGreaterThan(1);
      }
    }
  });

  it('keeps the deliberately broken draft broken in exactly the intended ways', () => {
    const broken = ALL.find((t) => t.code === 'QT-RFI-COMBINED');
    expect(broken).toBeDefined();
    expect(new Set(codes(validateTemplate(broken as QuestionnaireTemplate).errors))).toEqual(
      new Set(['PRICE_CARRIES_WEIGHT', 'WEIGHT_WITHOUT_SCORING', 'COMMERCIAL_AT_RFI']),
    );
  });
});
