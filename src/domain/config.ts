/**
 * Configuration scope resolution.
 *
 *   TENANT -> BUSINESS UNIT / CATEGORY -> EVENT TEMPLATE -> EVENT INSTANCE
 *
 * Resolution rule: the narrowest scope that defines a value wins — unless a
 * broader scope locked it, in which case the locked value wins regardless.
 *
 * Every configuration screen must show, per setting: the effective value, the
 * scope it resolved from, whether it is locked, and the inheritance chain.
 * `resolve` returns all four so a screen cannot show the value alone.
 */
import type { ConfigScopeType, ConfigSetting, Id, ResolvedConfig } from './types';

/** Narrowest last. */
export const SCOPE_ORDER: ConfigScopeType[] = ['TENANT', 'CATEGORY', 'TEMPLATE', 'EVENT'];

export const SCOPE_LABELS: Record<ConfigScopeType, string> = {
  TENANT: 'Tenant',
  CATEGORY: 'Business unit / category',
  TEMPLATE: 'Event template',
  EVENT: 'Event instance',
};

export interface ScopeLineage {
  tenantId: Id;
  categoryId: Id | null;
  templateId: Id | null;
  eventId: Id | null;
}

function scopeIdFor(scope: ConfigScopeType, lineage: ScopeLineage): Id | null {
  switch (scope) {
    case 'TENANT': return lineage.tenantId;
    case 'CATEGORY': return lineage.categoryId;
    case 'TEMPLATE': return lineage.templateId;
    case 'EVENT': return lineage.eventId;
  }
}

export function resolve<T>(
  key: string,
  settings: ConfigSetting[],
  lineage: ScopeLineage,
  fallback: T,
): ResolvedConfig<T> {
  const chain: ResolvedConfig<T>['chain'] = [];
  let effective: T = fallback;
  let resolvedFrom: ConfigScopeType = 'TENANT';
  let lockedBy: ConfigScopeType | null = null;

  for (const scope of SCOPE_ORDER) {
    const scopeId = scopeIdFor(scope, lineage);
    // A null id means this scope does not apply to the lineage being resolved.
    // Resolving *at* tenant scope must not pick up a category's override, or
    // the studio would report a value the tenant does not actually have.
    if (scopeId === null) {
      chain.push({ scopeType: scope, value: undefined, isLocked: false });
      continue;
    }
    const setting = settings.find(
      (s) => s.key === key && s.scopeType === scope && s.scopeId === scopeId,
    );
    chain.push({
      scopeType: scope,
      value: setting ? (setting.value as T) : undefined,
      isLocked: setting?.isLocked ?? false,
    });
    if (!setting) continue;

    // A lock at a broader scope wins over everything narrower.
    if (lockedBy !== null) continue;

    effective = setting.value as T;
    resolvedFrom = scope;
    if (setting.isLocked) lockedBy = scope;
  }

  return {
    key,
    value: effective,
    resolvedFrom,
    isLocked: lockedBy !== null,
    lockedBy,
    chain,
  };
}

/**
 * Some configuration is a *collection*, not a scalar: a custom journey authored
 * at tenant scope should still be available to a category, not be replaced by
 * whatever the category happens to define. Those accumulate down the chain
 * instead of overriding, and each item keeps the scope that authored it so the
 * studio can say where it came from and who may edit it.
 */
export interface AccumulatedConfig<T> {
  key: string;
  items: T[];
  byScope: { scopeType: ConfigScopeType; items: T[]; isLocked: boolean }[];
}

export function resolveAccumulated<T>(
  key: string,
  settings: ConfigSetting[],
  lineage: ScopeLineage,
): AccumulatedConfig<T> {
  const byScope: AccumulatedConfig<T>['byScope'] = [];
  const items: T[] = [];

  for (const scope of SCOPE_ORDER) {
    const scopeId = scopeIdFor(scope, lineage);
    const setting = scopeId === null
      ? undefined
      : settings.find((s) => s.key === key && s.scopeType === scope && s.scopeId === scopeId);
    const scopeItems = Array.isArray(setting?.value) ? (setting.value as T[]) : [];
    byScope.push({ scopeType: scope, items: scopeItems, isLocked: setting?.isLocked ?? false });
    items.push(...scopeItems);
  }

  return { key, items, byScope };
}

/** The fourteen configuration domains, for the studio's left rail. */
export const CONFIG_DOMAINS = [
  { key: 'module', label: 'Module enablement' },
  { key: 'patterns', label: 'Journey patterns' },
  { key: 'event', label: 'Event defaults' },
  { key: 'questionnaire', label: 'Questionnaire' },
  { key: 'evaluation', label: 'Evaluation' },
  { key: 'auction', label: 'Auction' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'award', label: 'Award' },
  { key: 'approval', label: 'Approval / DoA' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'agents', label: 'Agents' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'portal', label: 'Vendor portal' },
  { key: 'audit', label: 'Audit & retention' },
] as const;

/**
 * The currency this tenant buys in.
 *
 * One constant rather than a literal at every call site, because a default
 * spread across a dozen files is a default that only ever half changes — the
 * board reads in one currency and the line items in another, and nobody
 * notices until an approver adds up two numbers that were never comparable.
 */
export const BASE_CURRENCY = 'INR';

/** Tenant-level defaults, used as the fallback layer for resolution. */
export const TENANT_DEFAULTS: Record<string, unknown> = {
  'event.side': 'BUY',
  'event.currency': BASE_CURRENCY,
  'event.corrigendum_reopens_deadline': true,
  'event.gate_documents_on_acceptance': true,
  'evaluation.envelope_mode': 'TWO_ENVELOPE',
  'evaluation.commercial_unlock': 'MANUAL',
  'evaluation.blind_technical': true,
  'evaluation.technical_gate': 'MIN_SCORE',
  'evaluation.min_technical_score': 60,
  'evaluation.consensus_mode': 'AVERAGE',
  'evaluation.divergence_threshold': 20,
  'evaluation.disclose_formula': true,
  'auction.feedback_policy': 'BEST_PRICE',
  'auction.disclose_target': false,
  'auction.traffic_amber_band_pct': 5,
  'auction.min_decrement': 1,
  'auction.min_decrement_type': 'PCT',
  'auction.max_decrement_pct': 25,
  'auction.front_buffer_pct': 0,
  'auction.tie_bid_policy': 'FIRST_IN_WINS',
  'auction.min_bidders_to_start': 3,
  'auction.below_min_policy': 'WARN_AND_JUSTIFY',
  'auction.sniping_threshold_sec': 10,
  'auction.identical_bid_window_sec': 5,
  'auction.require_dry_run_first_event': true,
  'negotiation.max_rounds': 3,
  'award.override_doa_uplift': 1,
  'award.regret_disclosure': 'RANK_ONLY',
  'award.po_handoff': 'INTERNAL',
  'approval.sla_hours': 24,
  'clarification.reveal_asker': false,
  'counterparty.provisional_award_allowed': false,
  'compare.basis': 'LANDED',
  'agents.disclose_ai_scoring_to_suppliers': true,
};
