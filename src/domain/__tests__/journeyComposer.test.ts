/**
 * Journey composition: the derivation rules, the validation gates, and the
 * scope semantics a composed journey inherits.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_STAGES, COMPOSABLE_STAGES, MANDATORY_STAGES, MOVABLE_STAGES, STAGE_ACTIVITIES,
  STAGE_COMPONENTS, activitiesFromStages, availableVendorPoints, deriveWizardSteps,
  equivalentStages, estimateDuration, invitesVendors, isJourneyEnabled, moveStage, nextJourneyId,
  normaliseStages, orderStages, toggleEnabled, validateJourney,
} from '../journeyComposer';
import { ALL_PATTERNS, JOURNEY_PATTERNS, STAGE_ORDER, workspaceTabs } from '../journeyPatterns';
import { resolve, resolveAccumulated } from '../config';
import type { ConfigSetting, JourneyPatternId, Stage } from '../types';

describe('stage components', () => {
  it('offers every canonical stage either as a component or as an activity', () => {
    const covered = [
      ...STAGE_COMPONENTS.map((c) => c.stage),
      ...ACTIVITY_STAGES,
    ];
    expect([...covered].sort()).toEqual([...STAGE_ORDER].sort());
  });

  it('does not offer the three activities as stages to sequence', () => {
    for (const stage of ACTIVITY_STAGES) {
      expect(COMPOSABLE_STAGES, stage).not.toContain(stage);
    }
    expect(STAGE_ACTIVITIES.map((a) => a.key).sort()).toEqual([...ACTIVITY_STAGES].sort());
  });

  it('hosts each activity where the work it describes actually happens', () => {
    const hosts = (key: string) => STAGE_ACTIVITIES.find((a) => a.key === key)!.hosts;
    // Scoring applies to responses, which only a solicitation produces.
    expect(hosts('EVALUATION')).toEqual(['RFI', 'RFP', 'RFQ']);
    // A counter-offer needs a submitted price to counter.
    expect(hosts('NEGOTIATION')).toEqual(['RFQ', 'AUCTION']);
    // A buyer clarifies whenever asked, so it belongs to no single stage.
    expect(hosts('CLARIFICATION')).toEqual([]);
  });

  it('pins only the two anchors, and leaves the rest movable', () => {
    expect(MOVABLE_STAGES).toEqual(['RFI', 'RFP', 'RFQ', 'AUCTION']);
    expect(COMPOSABLE_STAGES[0]).toBe('INTAKE');
    expect(COMPOSABLE_STAGES.slice(-2)).toEqual(['AWARD', 'APPROVAL']);
  });

  it('marks intake and award mandatory, and every master pattern honours that', () => {
    expect(MANDATORY_STAGES).toEqual(['INTAKE', 'AWARD']);
    for (const pattern of ALL_PATTERNS) {
      for (const stage of MANDATORY_STAGES) {
        expect(pattern.stages).toContain(stage);
      }
    }
  });

  it('keeps the order the buyer arranged rather than sorting it back', () => {
    // This is the whole point of the change: an auction before the RFQ is a
    // real process, and used to be silently re-sorted into canonical order.
    const asArranged: Stage[] = ['INTAKE', 'AUCTION', 'RFQ', 'AWARD'];
    expect(orderStages(asArranged)).toEqual(['INTAKE', 'AUCTION', 'RFQ', 'AWARD']);
  });

  it('pins intake first and the award decision last, wherever they were put', () => {
    expect(orderStages(['AWARD', 'APPROVAL', 'RFQ', 'INTAKE']))
      .toEqual(['INTAKE', 'RFQ', 'AWARD', 'APPROVAL']);
    // Approval follows the award: approving a decision not yet made is not a
    // thing, however it was dragged.
    expect(orderStages(['INTAKE', 'APPROVAL', 'AWARD'])).toEqual(['INTAKE', 'AWARD', 'APPROVAL']);
  });

  it('drops duplicates rather than rendering a stage twice', () => {
    expect(orderStages(['INTAKE', 'INTAKE', 'AWARD'])).toEqual(['INTAKE', 'AWARD']);
  });

  it('drops the activity stages from a sequence — they are not positions', () => {
    expect(orderStages(['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AWARD']))
      .toEqual(['INTAKE', 'RFQ', 'AWARD']);
  });

  it('still sorts canonically where canonical order is what is wanted', () => {
    expect(normaliseStages(['AWARD', 'AUCTION', 'INTAKE', 'RFQ']))
      .toEqual(['INTAKE', 'RFQ', 'AUCTION', 'AWARD']);
  });
});

describe('re-sequencing', () => {
  const FULL: Stage[] = ['INTAKE', 'RFI', 'RFP', 'RFQ', 'AUCTION', 'AWARD', 'APPROVAL'];

  it('moves a stage to the index it was dropped on', () => {
    expect(moveStage(FULL, 4, 1)).toEqual(['INTAKE', 'AUCTION', 'RFI', 'RFP', 'RFQ', 'AWARD', 'APPROVAL']);
  });

  it('moves a stage later as well as earlier', () => {
    expect(moveStage(FULL, 1, 4)).toEqual(['INTAKE', 'RFP', 'RFQ', 'AUCTION', 'RFI', 'AWARD', 'APPROVAL']);
  });

  it('corrects a drop that would unseat an anchor rather than refusing it', () => {
    // Dropping the award into the middle re-asserts the anchor instead of
    // leaving the buyer with a journey that awards before it asks.
    expect(moveStage(FULL, 5, 1)).toEqual(FULL);
    expect(moveStage(FULL, 0, 3)).toEqual(FULL);
  });

  it('is a no-op on an index that does not exist', () => {
    expect(moveStage(FULL, 2, 2)).toEqual(FULL);
    expect(moveStage(FULL, -1, 2)).toEqual(FULL);
    expect(moveStage(FULL, 2, 99)).toEqual(FULL);
  });
});

describe('reading a legacy stage set as activities', () => {
  it('reads an evaluation stage as scoring the solicitations that ran', () => {
    const activities = activitiesFromStages(['INTAKE', 'RFI', 'RFP', 'EVALUATION', 'AWARD']);
    expect(activities.evaluateAt).toEqual(['RFI', 'RFP']);
  });

  it('lands a legacy negotiation on the price event it ran against', () => {
    expect(activitiesFromStages(['INTAKE', 'RFQ', 'NEGOTIATION', 'AUCTION', 'AWARD']).negotiateAt)
      .toEqual(['RFQ']);
    expect(activitiesFromStages(['INTAKE', 'AUCTION', 'NEGOTIATION', 'AWARD']).negotiateAt)
      .toEqual(['AUCTION']);
  });

  it('reads a clarification stage as a window open across the journey', () => {
    expect(activitiesFromStages(['INTAKE', 'RFP', 'CLARIFICATION', 'AWARD']).clarifications).toBe(true);
    expect(activitiesFromStages(['INTAKE', 'RFP', 'AWARD']).clarifications).toBe(false);
  });

  it('folds activities back into the stage set the engine still speaks', () => {
    expect(equivalentStages(['INTAKE', 'RFQ', 'AWARD'], { evaluateAt: ['RFQ'] }))
      .toEqual(['INTAKE', 'RFQ', 'EVALUATION', 'AWARD']);
  });

  it('round-trips every master pattern through the activity model', () => {
    for (const pattern of ALL_PATTERNS) {
      const stages = orderStages(pattern.stages);
      expect(equivalentStages(stages, activitiesFromStages(pattern.stages)), pattern.id)
        .toEqual(pattern.stages);
    }
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
    expect(steps).toEqual(['Basics', 'Items & Vendors', 'Review']);
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

  it('carries the vendor roster on the items step rather than a step of its own', () => {
    // The basket and the people asked to price it are one decision, so there
    // is no separate bidders step to add or leave out. Whether the roster is
    // shown on that step is the composer's other answer, `invitesVendors`.
    expect(deriveWizardSteps(['INTAKE', 'AUCTION', 'AWARD'])).not.toContain('Bidders');
    expect(invitesVendors(['INTAKE', 'AWARD', 'APPROVAL'])).toBe(false);
    expect(invitesVendors(['INTAKE', 'AUCTION', 'AWARD'])).toBe(true);
    expect(invitesVendors(['INTAKE', 'RFQ', 'AWARD'])).toBe(true);
  });

  it('reshapes from three steps to eight as stages are added', () => {
    expect(deriveWizardSteps(['INTAKE', 'AWARD'], [])).toHaveLength(3);
    expect(deriveWizardSteps(
      ['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    )).toHaveLength(8);
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

  it('refuses scoring at a stage the journey does not run', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'AWARD'], evaluateAt: ['RFQ'], vendorInputPoints: [] }, [],
    );
    expect(result.errors.map((e) => e.code)).toContain('ACTIVITY_HOST_MISSING');
  });

  it('refuses negotiation at a stage the journey does not run', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'AWARD'], negotiateAt: ['AUCTION'], vendorInputPoints: [] }, [],
    );
    expect(result.errors.map((e) => e.code)).toContain('ACTIVITY_HOST_MISSING');
  });

  it('refuses a negotiation hosted by a stage with no submitted price', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'RFI', 'AWARD'], negotiateAt: ['RFI'], vendorInputPoints: ['RFI'] }, [],
    );
    expect(result.errors.map((e) => e.code)).toContain('ACTIVITY_HOST_INVALID');
  });

  it('warns when responses arrive and nothing scores them', () => {
    const result = validateJourney(
      { ...base, stages: ['INTAKE', 'RFQ', 'AWARD'], evaluateAt: [], vendorInputPoints: ['RFQ'] }, [],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NOTHING_SCORED');
  });

  it('warns when the auction is sequenced before the field is qualified', () => {
    const result = validateJourney(
      {
        ...base, name: 'Floor-first auction',
        stages: ['INTAKE', 'AUCTION', 'RFQ', 'AWARD'],
        evaluateAt: ['RFQ'], vendorInputPoints: ['AUCTION', 'RFQ'],
      },
      [],
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('AUCTION_BEFORE_SOLICITATION');
  });

  it('does not warn about order when the auction follows the solicitation', () => {
    const result = validateJourney(
      {
        ...base, name: 'Quote then auction',
        stages: ['INTAKE', 'RFQ', 'AUCTION', 'AWARD'],
        evaluateAt: ['RFQ'], vendorInputPoints: ['RFQ', 'AUCTION'],
      },
      [],
    );
    expect(result.warnings.map((w) => w.code)).not.toContain('AUCTION_BEFORE_SOLICITATION');
  });

  it('keeps negotiation available as a supplier touchpoint when it is an activity', () => {
    const result = validateJourney(
      {
        ...base, name: 'Negotiated quote', stages: ['INTAKE', 'RFQ', 'AWARD'],
        evaluateAt: ['RFQ'], negotiateAt: ['RFQ'], vendorInputPoints: ['RFQ', 'NEGOTIATION'],
      },
      [],
    );
    expect(result.errors).toHaveLength(0);
    expect(availableVendorPoints(['INTAKE', 'RFQ', 'AWARD'], { negotiateAt: ['RFQ'] }))
      .toContain('NEGOTIATION');
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
