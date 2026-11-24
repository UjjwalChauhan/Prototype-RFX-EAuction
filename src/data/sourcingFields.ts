/**
 * The organisation fields a sourcing event is raised under.
 *
 * The legal entity decides the currency the event is priced in, the cost
 * centre decides the business unit the DoA chain resolves against, and the
 * budget line is what the award is later committed against. They live here
 * rather than in the wizard so the same lists can be read anywhere an event's
 * header is shown.
 */
import type { PurchaseRequest } from '../domain/types';

export interface LegalEntity {
  id: string;
  name: string;
  currency: string;
}

export const ENTITIES: LegalEntity[] = [
  { id: 'ZPOS', name: 'Zaggle Prepaid Ocean Services', currency: 'INR' },
  { id: 'ZFZE', name: 'Zaggle Payments FZE (Dubai)', currency: 'AED' },
  { id: 'ZINC', name: 'Zaggle Inc. (United States)', currency: 'USD' },
  { id: 'ZLTD', name: 'Zaggle Europe Ltd (United Kingdom)', currency: 'GBP' },
];

export const DEFAULT_ENTITY = ENTITIES[0];

export const entityById = (id: string): LegalEntity | undefined =>
  ENTITIES.find((entity) => entity.id === id);

export interface CostCentre {
  code: string;
  businessUnit: string;
}

/** Cost centres no requisition has used yet, so every unit has at least one. */
const STANDING_COST_CENTRES: CostCentre[] = [
  { code: 'CC-1104', businessUnit: 'Corporate Services' },
  { code: 'CC-5100', businessUnit: 'Technology' },
  { code: 'CC-6200', businessUnit: 'Marketing' },
  { code: 'CC-8300', businessUnit: 'Fleet' },
];

/**
 * Every cost centre a buyer can raise against: the standing list, plus every
 * one a requisition in flight already carries, sorted by code.
 */
export function costCentresOf(requests: Pick<PurchaseRequest, 'costCentre' | 'businessUnit'>[]): CostCentre[] {
  const byCode = new Map<string, CostCentre>();
  for (const centre of STANDING_COST_CENTRES) byCode.set(centre.code, centre);
  for (const request of requests) {
    if (request.costCentre && !byCode.has(request.costCentre)) {
      byCode.set(request.costCentre, { code: request.costCentre, businessUnit: request.businessUnit });
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export const BUDGET_LINES: string[] = [
  'OPEX · Office consumables',
  'OPEX · Facilities & maintenance',
  'OPEX · IT services',
  'OPEX · Marketing services',
  'OPEX · Fleet operations',
  'CAPEX · IT hardware',
  'CAPEX · Plant & machinery',
  'CAPEX · Construction',
];
