/**
 * The people a buyer can name to evaluate an event, and what each may do.
 *
 * Technical and commercial eligibility are separate permissions. Someone
 * holding both may be named to either role on an event, but never to both on
 * the same two-envelope event — see `domain/evaluationSetup`.
 */
export interface EvaluatorProfile {
  id: string;
  name: string;
  initials: string;
  title: string;
  canScoreTechnical: boolean;
  canOpenCommercial: boolean;
  /**
   * A standing panel member has already agreed to evaluate this category and
   * declared no conflicts. Anyone else is asked when the event is published.
   */
  standing: boolean;
  /** One line of track record, shown when suggesting them. */
  record: string;
}

export const EVALUATORS: EvaluatorProfile[] = [
  {
    id: 'user-ar', name: 'A. Rahman', initials: 'AR', title: 'Category lead, Office & Administrative',
    canScoreTechnical: true, canOpenCommercial: true, standing: true,
    record: 'Led evaluation on 11 Office & Administrative events',
  },
  {
    id: 'ev-pn', name: 'P. Nair', initials: 'PN', title: 'Facilities manager',
    canScoreTechnical: true, canOpenCommercial: false, standing: false,
    record: 'Scored the last 4 Office & Administrative events · no supplier conflicts on this shortlist',
  },
  {
    id: 'user-js', name: 'J. Silva', initials: 'JS', title: 'Technical evaluator, Operations',
    canScoreTechnical: true, canOpenCommercial: false, standing: true,
    record: 'Scored 6 events across categories this year',
  },
  {
    id: 'ev-rm', name: 'R. Mehta', initials: 'RM', title: 'Finance controller, Corporate Services',
    canScoreTechnical: false, canOpenCommercial: true, standing: false,
    record: 'Opened the commercial envelopes on 7 events this year · no supplier conflicts',
  },
  {
    id: 'ev-si', name: 'S. Iyer', initials: 'SI', title: 'Finance Director',
    canScoreTechnical: false, canOpenCommercial: true, standing: true,
    record: 'DoA level 3 · opens commercial envelopes above ₹50 lakh',
  },
];

export function evaluatorById(id: string): EvaluatorProfile | undefined {
  return EVALUATORS.find((e) => e.id === id);
}

export function evaluatorName(id: string): string {
  return evaluatorById(id)?.name ?? id;
}

/**
 * The scales evaluators score a question on. The weights turn whatever scale
 * into 0–100, so the choice changes how evaluators think, not the ranking.
 */
export interface RubricScale {
  id: string;
  /** `{category}` is replaced with the event's category. */
  name: string;
  max: number;
  bands: string[];
  note: string;
}

export const RUBRIC_SCALES: RubricScale[] = [
  {
    id: 'BANDS_4', name: '{category} — 4 bands', max: 10,
    bands: ['0 · Not addressed', '1–3 · Partial', '4–7 · Meets', '8–10 · Exceeds'],
    note: 'Evaluators score each question on this scale; the weights turn it into 0–100.',
  },
  {
    id: 'BANDS_5', name: 'Standard — 5 bands', max: 10,
    bands: ['0 · None', '1–2 · Poor', '3–5 · Fair', '6–8 · Good', '9–10 · Excellent'],
    note: 'Finer distinctions at the top — useful where most suppliers are expected to meet the spec.',
  },
  {
    id: 'NUMERIC_10', name: 'Numeric 0–10', max: 10,
    bands: ['0 – 10'],
    note: 'No named bands. Quick to score; harder to defend when evaluators disagree.',
  },
  {
    id: 'STARS_5', name: 'Stars — 1 to 5', max: 5,
    bands: ['1 ★ Poor', '2 ★', '3 ★ Meets', '4 ★', '5 ★ Exceeds'],
    note: 'Coarse by design — for screens where the judgement is quick.',
  },
];

export function rubricName(rubric: RubricScale, category: string): string {
  return rubric.name.replace('{category}', category);
}

/**
 * Past events in the category, for the assistant's reasoning about where to
 * set a gate. Technical scores are each event's bidders, out of 100.
 */
export interface GateHistory {
  reference: string;
  title: string;
  gate: number;
  scores: number[];
  evaluationDays: number;
}

export const GATE_HISTORY: GateHistory[] = [
  { reference: 'EVT-2025-0412', title: 'Stationery rate contract', gate: 70, scores: [82, 77, 71, 66, 58, 49], evaluationDays: 6 },
  { reference: 'EVT-2025-0388', title: 'Pantry supplies', gate: 65, scores: [79, 74, 68, 66, 61], evaluationDays: 8 },
  { reference: 'EVT-2025-0301', title: 'Printer consumables', gate: 75, scores: [88, 76, 72, 60], evaluationDays: 5 },
  { reference: 'EVT-2025-0257', title: 'Office furniture — Pune', gate: 70, scores: [81, 73, 70, 64, 55, 52], evaluationDays: 7 },
  { reference: 'EVT-2024-0911', title: 'Courier services', gate: 60, scores: [75, 69, 64, 62, 61, 60, 50], evaluationDays: 15 },
  { reference: 'EVT-2024-0874', title: 'Housekeeping consumables', gate: 70, scores: [84, 78, 71, 69, 57], evaluationDays: 6 },
];
