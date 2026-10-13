/**
 * Journey composition: the derivation rules, the validation gates, and the
 * scope semantics a composed journey inherits.
 */
import { describe, expect, it } from 'vitest';
import {
  MANDATORY_STAGES, STAGE_COMPONENTS, availableVendorPoints, deriveWizardSteps,
  estimateDuration, isJourneyEnabled, nextJourneyId, normaliseStages, toggleEnabled,
  validateJourney,
} from '../journeyComposer';
import { ALL_PATTERNS, JOURNEY_PATTERNS, STAGE_ORDER, workspaceTabs } from '../journeyPatterns';
import { resolve, resolveAccumulated } from '../config';
import type { ConfigSetting, JourneyPatternId, Stage } from '../types';

describe('stage components', () => {
  it('offers exactly the canonical stages, in canonical order', () => {
    expect(STAGE_COMPONENTS.map((c) => c.stage)).toEqual(STAGE_ORDER);
  });

  it('marks intake and award mandatory, and every master pattern honours that', () => {
    expect(MANDATORY_STAGES).toEqual(['INTAKE', 'AWARD']);
    for (const pattern of ALL_PATTERNS) {
      for (const stage of MANDATORY_STAGES) {
        expect(pattern.stages).toContain(stage);
      }
    }
  });

  it('normalises an out-of-order selection back into the canonical order', () => {
    const scrambled: Stage[] = ['AWARD', 'AUCTION', 'INTAKE', 'RFQ'];
    expect(normaliseStages(scrambled)).toEqual(['INTAKE', 'RFQ', 'AUCTION', 'AWARD']);
  });

  it('drops duplicates rather than rendering a stage twice', () => {
    expect(normaliseStages(['INTAKE', 'INTAKE', 'AWARD'])).toEqual(['INTAKE', 'AWARD']);
  });

  it('offers only vendor-facing stages as supplier touchpoints', () => {
    const points = availableVendorPoints(['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD']);
    expect(points).toEqual(['INTAKE', 'RFQ', 'AUCTION']);
  });
});

describe('derived wizard steps', () => {
  /** The two the master trims by hand, for speed rather than for structure. */
  const HAND_TRIMMED: JourneyPatternId[] = ['JP-10', 'JP-11'];

  it('reproduces every master pattern that is not hand-trimmed', () => {
    for (const pattern of ALL_PATTERNS) {
      if (HAND_TRIMMED.includes(pattern.id)) continue;
      expect(deriveWizardSteps(pattern.stages, pattern.vendorInputPoints), pattern.id)
        .toEqual(pattern.wizardSteps);
    }
  });

  it('derives more steps than the hand-trimmed patterns keep, never fewer', () => {
    for (const id of HAND_TRIMMED) {
      const pattern = JOURNEY_PATTERNS[id];
      const derived = deriveWizardSteps(pattern.stages, pattern.vendorInputPoints);
      expect(derived.length).toBeGreaterThan(pattern.wizardSteps.length);
      for (const step of pattern.wizardSteps) expect(derived).toContain(step);
    }
  });

  it('always opens on basics and items and ends on review', () => {
    const steps = deriveWizardSteps(['INTAKE', 'AWARD'], []);
    expect(steps).toEqual(['Basics', 'Items & Lots', 'Review']);
  });

  it('adds a terms step wherever the journey asks the supplier for something', () => {
    // Publishing is blocked when an ask goes out with no terms attached, so a
    // journey with an ask and no step to attach them at cannot be published.
    expect(deriveWizardSteps(['INTAKE', 'AWARD'], ['INTAKE'])).toContain('Terms');
    expect(deriveWizardSteps(['INTAKE', 'AUCTION', 'AWARD'], ['AUCTION'])).toContain('Terms');
    expect(deriveWizardSteps(['INTAKE', 'AWARD'], [])).not.toContain('Terms');
  });

  it('keeps the evaluation step narrower than the terms step', () => {
    // A weighted model is worth a step only where a proposal is scored or
    // negotiated; terms are needed wherever anything is asked at all.
    const steps = deriveWizardSteps(['INTAKE', 'AUCTION', 'AWARD'], ['AUCTION']);
    expect(steps).toContain('Terms');
    expect(steps).not.toContain('Evaluation');
  });

  it('adds a bidders step only where the journey is competitive', () => {
    expect(deriveWizardSteps(['INTAKE', 'AWARD', 'APPROVAL'])).not.toContain('Bidders');
    expect(deriveWizardSteps(['INTAKE', 'AUCTION', 'AWARD'])).toContain('Bidders');
  });

  it('reshapes from three steps to nine as stages are added', () => {
    expect(deriveWizardSteps(['INTAKE', 'AWARD'], [])).toHaveLength(3);
    expect(deriveWizardSteps(
      ['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    )).toHaveLength(9);
  });
});

describe('derived workspace tabs', () => {
  it('drives the same tab derivation the event workspace already uses', () => {
    const stages: Stage[] = ['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'];
    const tabs = workspaceTabs(normaliseStages(stages));
    expect(tabs).toContain('Evaluation');
    expect(tabs).toContain('Auction');
    expect(tabs).not.toContain('Negotiation');
  });
});

describe('duration estimate', () => {
  it('reports a no-competition journey in hours', () => {
    expect(estimateDuration(['INTAKE', 'AWARD'])).toBe('1 day');
  });

  it('grows with the stage set', () => {
    const short = estimateDuration(['INTAKE', 'RFQ', 'AWARD']);
    const long = estimateDuration(['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL']);
    expect(short).toBe('4 days');
    expect(long).toBe('5 weeks');
  });
});

describe('validateJourney', () => {
  const base = {
    name: 'Bespoke tender', description: '', side: 'BUY' as const,
    stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'] as Stage[],
    vendorInputPoints: ['RFQ' as const],
  };

  it('accepts a well-formed journey', () => {
    const result = validateJourney(base, []);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires a name', () => {
    const result = validateJourney({ ...base, name: '   ' }, []);
    expect(result.errors.map((e) => e.code)).toContain('NAME_REQUIRED');
  });

  it('rejects a name already in use at the scope, case-insensitively', () => {
    const result = validateJourney(base, ['bespoke TENDER']);
    expect(result.errors.map((e) => e.code)).toContain('NAME_TAKEN');
  });

  it('refuses to drop intake or award', () => {
    const result = validateJourney({ ...base, stages: ['RFQ', 'EVALUATION'] }, []);
    expect(result.errors.filter((e) => e.code === 'MISSING_MANDATORY')).toHaveLength(2);
  });

  it('refuses evaluation with nothing to evaluate', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'EVALUATION', 'AWARD'], vendorInputPoints: [] }, [],
    );
    expect(result.errors.map((e) => e.code)).toContain('REQUIRES_ONE_OF');
  });

  it('refuses negotiation with no responses to negotiate against', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'NEGOTIATION', 'AWARD'], vendorInputPoints: ['NEGOTIATION'] }, [],
    );
    expect(result.errors.map((e) => e.code)).toContain('REQUIRES_ONE_OF');
  });

  it('refuses a touchpoint whose stage is not in the journey', () => {
    const result = validateJourney({ ...base, vendorInputPoints: ['AUCTION'] }, []);
    expect(result.errors.map((e) => e.code)).toContain('VENDOR_POINT_ORPHANED');
  });

  it('warns rather than blocks when there is no approval stage', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'RFQ', 'AWARD'] }, [],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NO_APPROVAL');
  });

  it('warns when an auction runs without a solicitation to qualify the field', () => {
    const result = validateJourney(
      { ...base, name: 'Fast auction', stages: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'], vendorInputPoints: ['AUCTION'] },
      [],
    );
    expect(result.warnings.map((w) => w.code)).toContain('AUCTION_WITHOUT_SOLICITATION');
  });

  it('points at the master pattern when the stage set already exists', () => {
    const result = validateJourney(
      {
        ...base, name: 'My simple RFQ',
        stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
      },
      [],
    );
    const duplicate = result.warnings.find((w) => w.code === 'DUPLICATES_MASTER');
    expect(duplicate?.message).toContain('JP-02');
  });

  it('does not call a sell-side journey a duplicate of a buy-side master', () => {
    const result = validateJourney(
      {
        ...base, name: 'Disposal ladder', side: 'SELL',
        stages: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
      },
      [],
    );
    expect(result.warnings.map((w) => w.code)).not.toContain('DUPLICATES_MASTER');
  });
});

describe('enablement', () => {
  const all = ['JP-01', 'JP-02', 'JP-03'];

  it('treats an absent list as everything enabled', () => {
    expect(isJourneyEnabled(undefined, 'JP-02')).toBe(true);
  });

  it('writes the explicit list on the first exclusion', () => {
    expect(toggleEnabled(undefined, all, 'JP-02')).toEqual(['JP-01', 'JP-03']);
  });

  it('restores in canonical order rather than append order', () => {
    expect(toggleEnabled(['JP-03'], all, 'JP-01')).toEqual(['JP-01', 'JP-03']);
  });

  it('numbers custom journeys without reusing a deleted id', () => {
    expect(nextJourneyId([])).toBe('CJ-01');
    expect(nextJourneyId([{ id: 'CJ-07' } as never])).toBe('CJ-08');
  });
});

// ---------------------------------------------------------------------------
// Scope semantics the composer relies on
// ---------------------------------------------------------------------------

describe('config resolution at a broader scope', () => {
  const setting = (over: Partial<ConfigSetting>): ConfigSetting => ({
    key: 'auction.feedback_policy', scopeType: 'TENANT', scopeId: 't1',
    value: 'BEST_PRICE', isLocked: false, setBy: 'u1', setAt: 0, ...over,
  });

  const settings = [
    setting({ scopeType: 'TENANT', scopeId: 't1', value: 'BEST_PRICE' }),
    setting({ scopeType: 'CATEGORY', scopeId: 'Indirect', value: 'RANK_ONLY' }),
    setting({ scopeType: 'EVENT', scopeId: 'evt1', value: 'RANK_GAP' }),
  ];

  it('does not let a narrower scope leak in when it does not apply', () => {
    // Viewing at tenant scope: category, template and event are out of lineage.
    const atTenant = resolve(
      'auction.feedback_policy', settings,
      { tenantId: 't1', categoryId: null, templateId: null, eventId: null }, 'BLIND',
    );
    expect(atTenant.value).toBe('BEST_PRICE');
    expect(atTenant.resolvedFrom).toBe('TENANT');
  });

  it('still shows all four scopes in the chain, the inapplicable ones unset', () => {
    const atTenant = resolve(
      'auction.feedback_policy', settings,
      { tenantId: 't1', categoryId: null, templateId: null, eventId: null }, 'BLIND',
    );
    expect(atTenant.chain).toHaveLength(4);
    expect(atTenant.chain.find((l) => l.scopeType === 'EVENT')?.value).toBeUndefined();
  });

  it('picks the category value up again once the category is in lineage', () => {
    const atCategory = resolve(
      'auction.feedback_policy', settings,
      { tenantId: 't1', categoryId: 'Indirect', templateId: null, eventId: null }, 'BLIND',
    );
    expect(atCategory.value).toBe('RANK_ONLY');
    expect(atCategory.resolvedFrom).toBe('CATEGORY');
  });
});

describe('resolveAccumulated', () => {
  const lineage = { tenantId: 't1', categoryId: 'Indirect', templateId: 'tpl1', eventId: 'evt1' };

  const settings: ConfigSetting[] = [
    {
      key: 'patterns.custom', scopeType: 'TENANT', scopeId: 't1',
      value: [{ id: 'CJ-01' }], isLocked: false, setBy: 'u1', setAt: 0,
    },
    {
      key: 'patterns.custom', scopeType: 'CATEGORY', scopeId: 'Indirect',
      value: [{ id: 'CJ-02' }], isLocked: false, setBy: 'u1', setAt: 0,
    },
  ];

  it('accumulates down the chain rather than overriding', () => {
    const result = resolveAccumulated<{ id: string }>('patterns.custom', settings, lineage);
    expect(result.items.map((i) => i.id)).toEqual(['CJ-01', 'CJ-02']);
  });

  it('hides items authored at a scope narrower than the one being viewed', () => {
    const atTenant = resolveAccumulated<{ id: string }>('patterns.custom', settings, {
      tenantId: 't1', categoryId: null, templateId: null, eventId: null,
    });
    expect(atTenant.items.map((i) => i.id)).toEqual(['CJ-01']);
  });

  it('keeps the authoring scope alongside each group', () => {
    const result = resolveAccumulated<{ id: string }>('patterns.custom', settings, lineage);
    const category = result.byScope.find((s) => s.scopeType === 'CATEGORY');
    expect(category?.items.map((i) => i.id)).toEqual(['CJ-02']);
  });

  it('returns an empty collection rather than throwing on a scalar value', () => {
    const result = resolveAccumulated('patterns.custom', [
      { key: 'patterns.custom', scopeType: 'TENANT', scopeId: 't1', value: 'nonsense', isLocked: false, setBy: 'u1', setAt: 0 },
    ], lineage);
    expect(result.items).toEqual([]);
  });
});
