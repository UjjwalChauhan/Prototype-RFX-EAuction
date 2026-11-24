/**
 * The buying organisation's own people, as the Employee Portal knows them.
 *
 * One directory for both jobs an employee does on a sourcing event: approving
 * it (matched to a DoA level by the holder's name, which is how approval
 * chains record their holders) and evaluating it (matched by id, which is how
 * the Create Event wizard records its evaluators).
 */
import { PRIMARY_EVENT_ID, SEED_NOW } from './seed';

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
  office: string;
  code: string;
}

export const EMPLOYEES: Employee[] = [
  { id: 'user-ar', name: 'A. Rahman', email: 'a.rahman@example.com', role: 'Category Manager', dept: 'Procurement', office: 'Mumbai HO', code: '0012' },
  { id: 'user-mp', name: 'M. Prasad', email: 'm.prasad@example.com', role: 'Head of Procurement', dept: 'Procurement', office: 'Mumbai HO', code: '0004' },
  { id: 'ev-si', name: 'S. Iyer', email: 's.iyer@example.com', role: 'Finance Director', dept: 'Finance', office: 'Mumbai HO', code: '0022' },
  { id: 'ev-rk', name: 'R. Khoury', email: 'r.khoury@example.com', role: 'CFO', dept: 'Finance', office: 'Mumbai HO', code: '0001' },
  { id: 'user-js', name: 'J. Silva', email: 'j.silva@example.com', role: 'Technical Evaluator', dept: 'Operations', office: 'Pune Plant', code: '0045' },
  { id: 'ev-pn', name: 'P. Nair', email: 'p.nair@example.com', role: 'Facilities Manager', dept: 'Administration', office: 'Bengaluru', code: '0031' },
  { id: 'ev-rm', name: 'R. Mehta', email: 'r.mehta@example.com', role: 'Finance Controller', dept: 'Corporate Services', office: 'Mumbai HO', code: '0058' },
];

export function employeeById(id: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.id === id);
}

export function employeeByName(name: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.name === name);
}

/**
 * Who evaluates the seeded Office Supplies event.
 *
 * It was seeded before evaluators were named in the wizard, so its snapshot
 * carries no assignment; this is the one it would have been published with.
 * Events created in the wizard carry their own and never read this.
 */
export const SEEDED_EVALUATION: Record<string, {
  stage: string; gate: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH'; minScore: number; rubricId: string;
  technicalEvaluatorIds: string[]; commercialEvaluatorIds: string[];
}[]> = {
  [PRIMARY_EVENT_ID]: [{
    stage: 'AUCTION', gate: 'MIN_SCORE', minScore: 60, rubricId: 'BANDS_4',
    technicalEvaluatorIds: ['user-js', 'ev-pn'], commercialEvaluatorIds: ['ev-rm'],
  }],
};

/**
 * J. Silva broke the seeded event's technical seal before scoring it — the
 * seeded scores date from three days ago, so the opening is recorded just
 * before them.
 */
export const SEEDED_ENVELOPE_OPENINGS = [
  { eventId: PRIMARY_EVENT_ID, envelope: 'TECHNICAL' as const, openedBy: 'user-js', openedAt: SEED_NOW - 3 * 24 * 3600 * 1000 - 3600 * 1000 },
];
