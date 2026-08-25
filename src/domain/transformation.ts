/**
 * Bid transformation — buyer-defined, bidder-specific cost adjustments that
 * produce a comparable landed value.
 *
 * Three rules the rest of the system depends on:
 *   1. The bidder never sees the adjustment.
 *   2. Ranking reads transformedValue, never bidValue.
 *   3. The calculation is fully traceable — every component that moved a
 *      bidder's number is recoverable.
 */
import type {
  CostComponent, Id, TransformationMode, TransformationTrace, Side,
} from './types';
import { improvement } from './comparator';

export interface TransformInput {
  bidderId: Id;
  bidValue: number;
  quantity: number;
  lineCount: number;
}

export interface TransformResult {
  bidValue: number;
  transformedValue: number;
  totalAdjustment: number;
  trace: TransformationTrace[];
}

function componentDelta(
  component: CostComponent,
  input: TransformInput,
): { delta: number; raw: number } {
  const raw = component.valueByBidder[input.bidderId] ?? 0;
  switch (component.basis) {
    case 'PER_UNIT':
      return { delta: raw * input.quantity, raw };
    case 'PER_LINE':
      return { delta: raw * input.lineCount, raw };
    case 'PERCENTAGE':
      return { delta: (input.bidValue * raw) / 100, raw };
    case 'LUMP_SUM':
      return { delta: raw, raw };
  }
}

export function transformBid(
  input: TransformInput,
  components: CostComponent[],
  mode: TransformationMode,
): TransformResult {
  if (mode === 'NONE') {
    return {
      bidValue: input.bidValue,
      transformedValue: input.bidValue,
      totalAdjustment: 0,
      trace: [],
    };
  }

  const trace: TransformationTrace[] = [];
  let total = 0;
  for (const component of components) {
    const { delta, raw } = componentDelta(component, input);
    if (delta === 0 && raw === 0) continue;
    total += delta;
    trace.push({
      componentName: component.name,
      basis: component.basis,
      input: raw,
      delta,
      source: component.source,
    });
  }

  return {
    bidValue: input.bidValue,
    transformedValue: input.bidValue + total,
    totalAdjustment: total,
    trace,
  };
}

/**
 * Transform a buyer-side target *back* into a specific bidder's own terms.
 *
 * This is why different bidders correctly see different "bid to beat" numbers
 * on the same auction: each sees the raw bid that would produce the required
 * transformed value once their own adjustments are applied.
 */
export function untransform(
  targetTransformedValue: number,
  input: TransformInput,
  components: CostComponent[],
  mode: TransformationMode,
): number {
  if (mode === 'NONE') return targetTransformedValue;

  // Percentage components scale with the bid, so solve rather than subtract:
  //   target = bid * (1 + pctSum/100) + fixedSum
  let pctSum = 0;
  let fixedSum = 0;
  for (const component of components) {
    const raw = component.valueByBidder[input.bidderId] ?? 0;
    if (component.basis === 'PERCENTAGE') pctSum += raw;
    else fixedSum += componentDelta(component, { ...input, bidValue: 0 }).delta;
  }
  const scale = 1 + pctSum / 100;
  if (scale === 0) return targetTransformedValue - fixedSum;
  return (targetTransformedValue - fixedSum) / scale;
}

/**
 * The bid each bidder must place to take the lead, expressed in their own
 * terms. `requiredImprovement` is what the bidder sees as their decrement.
 */
export function bidToBeat(
  leadingTransformedValue: number,
  input: TransformInput,
  components: CostComponent[],
  mode: TransformationMode,
  side: Side,
): { rawBidToBeat: number; requiredImprovement: number } {
  const rawBidToBeat = untransform(leadingTransformedValue, input, components, mode);
  return {
    rawBidToBeat,
    requiredImprovement: improvement(input.bidValue, rawBidToBeat, side),
  };
}

/** How many bidders have a value for every component — the coverage check. */
export function transformationCoverage(
  components: CostComponent[],
  bidderIds: Id[],
): { covered: number; total: number; missing: { component: string; bidderIds: Id[] }[] } {
  const missing: { component: string; bidderIds: Id[] }[] = [];
  for (const component of components) {
    const gaps = bidderIds.filter((id) => component.valueByBidder[id] === undefined);
    if (gaps.length > 0) missing.push({ component: component.name, bidderIds: gaps });
  }
  const fullyCovered = bidderIds.filter((id) =>
    components.every((c) => c.valueByBidder[id] !== undefined),
  );
  return { covered: fullyCovered.length, total: bidderIds.length, missing };
}
