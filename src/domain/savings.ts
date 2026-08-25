/**
 * Savings engine.
 *
 * Negotiated savings are known at award. Realised savings are only known
 * post-GRN and are shown as pending. Conflating them is the classic
 * procurement reporting error, so they are separate fields here.
 *
 * Negative savings are returned as negative numbers and never suppressed.
 */
import type { BaselineSource, SavingsLine } from './types';

export const BASELINE_LABELS: Record<BaselineSource, string> = {
  PR: 'PR rate',
  LPP: 'Last purchase price',
  PO: 'PO rate',
  GRN: 'GRN rate',
  BUDGET: 'Budget',
  SHOULD_COST: 'Should-cost model',
  INDEX: 'Index',
};

export interface SavingsTotals {
  awardedValue: number;
  baselineValue: number;
  negotiatedSavings: number;
  negotiatedSavingsPct: number;
  realisedSavings: number | null;
  /** True while any line has no post-GRN figure. */
  realisedPending: boolean;
  negativeLines: SavingsLine[];
}

export function computeSavingsLine(
  line: Omit<SavingsLine, 'negotiatedSavings' | 'realisedSavings'>,
  realisedUnitPrice: number | null = null,
): SavingsLine {
  const baseline = line.baselineUnitPrice;
  const negotiated = baseline === null
    ? 0
    : (baseline - line.awardedUnitPrice) * line.quantity;
  const realised = realisedUnitPrice === null || baseline === null
    ? null
    : (baseline - realisedUnitPrice) * line.quantity;
  return { ...line, negotiatedSavings: negotiated, realisedSavings: realised };
}

export function totalSavings(lines: SavingsLine[]): SavingsTotals {
  const awardedValue = lines.reduce((a, l) => a + l.awardedUnitPrice * l.quantity, 0);
  const baselineValue = lines.reduce(
    (a, l) => a + (l.baselineUnitPrice ?? l.awardedUnitPrice) * l.quantity, 0,
  );
  const negotiated = lines.reduce((a, l) => a + l.negotiatedSavings, 0);
  const realisedKnown = lines.filter((l) => l.realisedSavings !== null);

  return {
    awardedValue,
    baselineValue,
    negotiatedSavings: negotiated,
    negotiatedSavingsPct: baselineValue === 0 ? 0 : (negotiated / baselineValue) * 100,
    realisedSavings: realisedKnown.length === lines.length && lines.length > 0
      ? realisedKnown.reduce((a, l) => a + (l.realisedSavings ?? 0), 0)
      : null,
    realisedPending: realisedKnown.length < lines.length,
    negativeLines: lines.filter((l) => l.negotiatedSavings < 0),
  };
}

/** AG-13 flags baseline anomalies. It cannot change a baseline. */
export interface BaselineAnomaly {
  lineItemId: string;
  detail: string;
  severity: 'INFO' | 'WARN';
}

export function detectBaselineAnomalies(
  lines: SavingsLine[],
  marketMedianByLine: Record<string, number>,
  toleranceMultiple = 1.5,
): BaselineAnomaly[] {
  const out: BaselineAnomaly[] = [];
  for (const line of lines) {
    if (line.baselineUnitPrice === null) {
      out.push({
        lineItemId: line.lineItemId,
        detail: `${line.description} has no baseline. A saving cannot be claimed against nothing.`,
        severity: 'WARN',
      });
      continue;
    }
    const median = marketMedianByLine[line.lineItemId];
    if (median === undefined || median === 0) continue;
    const ratio = line.baselineUnitPrice / median;
    if (ratio > toleranceMultiple) {
      out.push({
        lineItemId: line.lineItemId,
        detail:
          `Baseline for ${line.description} is ${((ratio - 1) * 100).toFixed(0)}% above market median — ` +
          'the saving may be overstated.',
        severity: 'WARN',
      });
    }
  }
  return out;
}
