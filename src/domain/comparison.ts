/**
 * The comparison sheet — technical and commercial, side by side.
 *
 * Two sheets, because they are read at different moments by different people
 * and one of them is sealed while the other is being scored. What they share is
 * a shape: **suppliers are columns, what was asked of them is rows.** That is
 * how a buyer reads a bid table, and it is the shape the client's own sheets
 * come in.
 *
 * - **Technical** — every question in the technical envelope, from every ask in
 *   the family. A ladder asks capability at RFI and re-confirms it at RFP, so
 *   the sheet is grouped by the ask that asked it and a supplier's answers are
 *   read down one column across all of them.
 * - **Commercial** — the quotation. Per line: price, quantity, tax and total
 *   per supplier, the L1 supplier and the quantity that would go to them; then
 *   other charges, base amount and tax amount per supplier, and a rank.
 *
 * Three rules this module will not bend:
 *
 * 1. **Nothing hard-codes "lowest wins".** Every rank routes through
 *    `comparator`, so a SELL event inverts by construction.
 * 2. **A blank is not a zero.** A supplier who did not quote a line has no
 *    price, is not ranked on it, and does not become the cheapest by silence.
 * 3. **Derived numbers are derived once.** Line totals, base and tax amounts
 *    are computed here and nowhere else, so a sheet and a header cannot
 *    disagree about the same money.
 */
import { bestFirst, isBetter } from './comparator';
import { consensus, effectiveScores } from './evaluation';
import { optionsOf } from './questionTypes';
import type {
  Answer, ConsensusMode, CostComponent, EventBidder, Id, LineItem, Lot, Question, Questionnaire,
  Response, Score, Side, SourcingEvent, Stage,
} from './types';

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/**
 * Rate per tax class, as a percentage of the line's base amount.
 *
 * A stand-in for the tax master: in production the class resolves to a rate by
 * jurisdiction and date, and a quotation carries the rate that applied when it
 * was submitted. It lives here rather than in a component so that every total
 * on every screen is taxed identically.
 */
export const TAX_RATE_BY_CLASS: Record<string, number> = {
  STANDARD: 12,
  SERVICES: 5,
  REDUCED: 5,
  ZERO: 0,
  EXEMPT: 0,
};

export function taxRateFor(taxClass: string | null | undefined): number {
  if (taxClass === null || taxClass === undefined) return 0;
  return TAX_RATE_BY_CLASS[taxClass] ?? 0;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface VendorColumn {
  bidderId: Id;
  counterpartyId: Id;
  /** The name shown in the header — masked when the policy says so. */
  name: string;
  /** Always the real name, for a tooltip the buyer is allowed to see. */
  legalName: string;
  masked: boolean;
  submittedAt: number | null;
  disqualified: boolean;
  disqualificationReason: string | null;
}

export interface ColumnInput {
  bidders: EventBidder[];
  responses: Response[];
  /** Counterparty id → legal name. */
  names: Record<Id, string>;
  /** Blind technical and masked-identity auctions read the label instead. */
  masked?: boolean;
}

/**
 * The supplier columns, in a stable order.
 *
 * Sorted by the masked label rather than by name, so masking cannot be undone
 * by noticing that the columns are alphabetical.
 */
export function vendorColumns({
  bidders, responses, names, masked = false,
}: ColumnInput): VendorColumn[] {
  return bidders
    .map((bidder) => {
      const submission = latestSubmission(responses, bidder.id);
      const legalName = names[bidder.counterpartyId] ?? bidder.counterpartyId;
      return {
        bidderId: bidder.id,
        counterpartyId: bidder.counterpartyId,
        name: masked ? bidder.maskedLabel || 'Bidder' : legalName,
        legalName,
        masked,
        submittedAt: submission?.submittedAt ?? null,
        disqualified: bidder.disqualified,
        disqualificationReason: bidder.disqualificationReason,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The submission a comparison reads — the latest version, never a draft. */
export function latestSubmission(responses: Response[], bidderId: Id): Response | null {
  return responses
    .filter((r) => r.bidderId === bidderId && r.submittedAt !== null)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One supplier's answer to one question, as the sheet shows it. */
export interface AnswerCell {
  bidderId: Id;
  /** Rendered value. Empty string means the question was not answered. */
  display: string;
  raw: Answer['value'];
  attachmentName: string | null;
  /** Consensus score, when the question is scored and has been scored. */
  score: number | null;
  maxScore: number;
  /** A knockout question scored zero. The bidder is out, citing this row. */
  knockedOut: boolean;
  answered: boolean;
}

export interface QuestionRow {
  question: Question;
  /** The ask that asked it — a ladder asks some things more than once. */
  eventId: Id;
  stage: Stage;
  cells: AnswerCell[];
  /** Set when the question is scored: the best score on the row. */
  bestScore: number | null;
}

/**
 * A question's answer in the words the supplier gave it.
 *
 * A choice is stored as the option's id, so it is resolved back to the label
 * the supplier actually saw — a sheet showing `opt-3` is a sheet nobody reads.
 */
export function formatAnswer(question: Question, value: Answer['value']): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const options = optionsOf({ type: question.type, config: question.config ?? {} });
  if (Array.isArray(value)) {
    return value
      .map((id) => options.find((option) => option.id === id)?.label ?? String(id))
      .join(', ');
  }
  if (typeof value === 'number') {
    const unit = question.type === 'lead_time' ? ' days' : '';
    return `${value.toLocaleString()}${unit}`;
  }
  return options.find((option) => option.id === value)?.label ?? value;
}

/** Where two evaluators are far enough apart that moderation is called for. */
const DIVERGENCE_THRESHOLD_PCT = 20;

function answerCells(
  question: Question, vendors: VendorColumn[], responses: Response[], scores: Score[],
  mode: ConsensusMode,
): AnswerCell[] {
  const live = effectiveScores(scores);
  return vendors.map((vendor) => {
    const submission = latestSubmission(responses, vendor.bidderId);
    const answer = submission?.answers.find((a) => a.questionId === question.id);
    const scored = question.scoringMethod === 'NONE'
      ? null
      : consensus(
        live.filter((s) => s.bidderId === vendor.bidderId && s.questionId === question.id),
        question.maxScore, mode, DIVERGENCE_THRESHOLD_PCT,
      ).value;
    const answered = answer !== undefined
      && answer.value !== null
      && !(typeof answer.value === 'string' && answer.value.trim() === '');

    return {
      bidderId: vendor.bidderId,
      display: answer ? formatAnswer(question, answer.value) : '',
      raw: answer?.value ?? null,
      attachmentName: answer?.attachmentName ?? null,
      score: scored,
      maxScore: question.maxScore,
      // A knockout scored zero is the one case where a single row decides the
      // outcome, so it is carried on the cell rather than left to be inferred.
      knockedOut: question.isKnockout && scored !== null && scored <= 0,
      answered,
    };
  });
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

export interface TechnicalSection {
  /** The ask these questions were put in. */
  eventId: Id;
  eventNumber: string;
  stage: Stage;
  name: string;
  rows: QuestionRow[];
}

/**
 * A gate verdict is three-valued, not two.
 *
 * Mid-evaluation, most of the weight is unscored, so a score computed against
 * the achievable total is *low by construction*. Reporting that as "does not
 * qualify" would have every supplier failing on the day the sheet is opened,
 * which is worse than useless — it is wrong in the direction that gets a
 * qualified supplier excluded. A knockout is the exception: a zero there
 * decides immediately, however much else remains unscored.
 */
export type GateVerdict = 'QUALIFIES' | 'DOES_NOT_QUALIFY' | 'PENDING';

export interface TechnicalTotal {
  bidderId: Id;
  name: string;
  /** Weighted percentage of the achievable total. */
  score: number;
  answered: number;
  asked: number;
  /** Weighted questions with a score for this supplier, and how many carry weight. */
  scored: number;
  scoredOf: number;
  /** Rank on score, best first. Null when nothing has been scored. */
  rank: number | null;
  knockedOutOn: string[];
  verdict: GateVerdict;
  /** Kept for callers that only care whether the supplier is out. */
  passesGate: boolean;
}

export interface TechnicalComparison {
  vendors: VendorColumn[];
  sections: TechnicalSection[];
  totals: TechnicalTotal[];
  /** How many technical questions the family asks in total. */
  asked: number;
  /** How many of those carry a weight, and are therefore scored. */
  scored: number;
}

export interface TechnicalInput {
  /** The family: the sourcing event and every ask under it. */
  events: SourcingEvent[];
  questionnaires: Questionnaire[];
  responses: Response[];
  bidders: EventBidder[];
  scores: Score[];
  names: Record<Id, string>;
  masked?: boolean;
  consensusMode?: ConsensusMode;
  gate?: 'NONE' | 'MIN_SCORE' | 'PASS_FAIL' | 'BOTH';
  minScore?: number;
}

/**
 * The technical sheet.
 *
 * Grouped by the ask rather than flattened, because "when did they tell us
 * this" matters: a capability claimed at RFI and revised at RFP is two answers
 * and the sheet must not silently show one.
 */
export function technicalComparison({
  events, questionnaires, responses, bidders, scores, names, masked = false,
  consensusMode = 'AVERAGE', gate = 'NONE', minScore = 0,
}: TechnicalInput): TechnicalComparison {
  const vendors = vendorColumns({ bidders, responses, names, masked });
  const eventById = new Map(events.map((e) => [e.id, e]));

  const sections: TechnicalSection[] = questionnaires
    .filter((questionnaire) => eventById.has(questionnaire.eventId))
    .map((questionnaire) => {
      const event = eventById.get(questionnaire.eventId)!;
      const rows = questionnaire.questions
        .filter((question) => question.envelope === 'TECHNICAL')
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((question): QuestionRow => {
          const cells = answerCells(question, vendors, responses, scores, consensusMode);
          const scored = cells.map((c) => c.score).filter((s): s is number => s !== null);
          return {
            question,
            eventId: questionnaire.eventId,
            stage: questionnaire.stage,
            cells,
            bestScore: scored.length === 0 ? null : Math.max(...scored),
          };
        });
      return {
        eventId: questionnaire.eventId,
        eventNumber: event.eventNumber,
        stage: questionnaire.stage,
        name: questionnaire.name,
        rows,
      };
    })
    .filter((section) => section.rows.length > 0)
    .sort((a, b) => STAGE_SEQUENCE.indexOf(a.stage) - STAGE_SEQUENCE.indexOf(b.stage));

  const rows = sections.flatMap((section) => section.rows);
  const weighted = rows.filter(
    (row) => row.question.scoringMethod !== 'NONE' && row.question.weight > 0,
  );

  const totals: TechnicalTotal[] = vendors.map((vendor) => {
    let weightSum = 0;
    let weightedScore = 0;
    let answered = 0;
    let scored = 0;
    const knockedOutOn: string[] = [];

    for (const row of rows) {
      const cell = row.cells.find((c) => c.bidderId === vendor.bidderId)!;
      if (cell.answered) answered += 1;
      if (cell.knockedOut) knockedOutOn.push(row.question.title);
    }
    for (const row of weighted) {
      const cell = row.cells.find((c) => c.bidderId === vendor.bidderId)!;
      weightSum += row.question.weight;
      if (cell.score === null || row.question.maxScore <= 0) continue;
      scored += 1;
      weightedScore += (cell.score / row.question.maxScore) * 100 * row.question.weight;
    }

    const score = weightSum > 0 ? weightedScore / weightSum : 0;
    const complete = scored === weighted.length;

    let verdict: GateVerdict;
    if (gate === 'NONE') verdict = 'QUALIFIES';
    else if (knockedOutOn.length > 0) verdict = 'DOES_NOT_QUALIFY';
    else if (gate === 'PASS_FAIL') verdict = complete ? 'QUALIFIES' : 'PENDING';
    else if (!complete) verdict = 'PENDING';
    else verdict = score >= minScore ? 'QUALIFIES' : 'DOES_NOT_QUALIFY';

    return {
      bidderId: vendor.bidderId,
      name: vendor.name,
      score,
      answered,
      asked: rows.length,
      scored,
      scoredOf: weighted.length,
      rank: null,
      knockedOutOn,
      verdict,
      passesGate: verdict !== 'DOES_NOT_QUALIFY',
    };
  });

  // Technical score is always "higher is better", whichever side the event is.
  rank(totals.filter((t) => t.score > 0), (t) => t.score, 'SELL');

  return {
    vendors,
    sections,
    totals,
    asked: rows.length,
    scored: weighted.length,
  };
}

const STAGE_SEQUENCE: Stage[] = [
  'INTAKE', 'RFI', 'RFP', 'RFQ', 'CLARIFICATION', 'EVALUATION', 'NEGOTIATION', 'AUCTION',
  'AWARD', 'APPROVAL',
];

// ---------------------------------------------------------------------------
// Commercial
// ---------------------------------------------------------------------------

export interface LineCell {
  bidderId: Id;
  /** Null when this supplier did not quote the line. A blank is not a zero. */
  unitPrice: number | null;
  quantity: number;
  taxRate: number;
  /** Quantity × unit price, before tax. */
  base: number | null;
  tax: number | null;
  total: number | null;
  rank: number | null;
  /** The best total on this line. Ties are all marked. */
  isL1: boolean;
  leadTimeDays: number | null;
}

export interface LineComparison {
  lineItem: LineItem;
  lotId: Id;
  lotName: string;
  cells: LineCell[];
  /** The supplier this line would go to, and on what. */
  l1: { bidderId: Id; name: string; total: number; quantity: number } | null;
  /** Set when two suppliers tie on the best total — a tie is not a winner. */
  tied: boolean;
}

export interface VendorTotals {
  bidderId: Id;
  name: string;
  linesQuoted: number;
  /** Sum of the quoted lines, before tax and before other charges. */
  base: number;
  tax: number;
  otherCharges: number;
  total: number;
  rank: number | null;
  /** False when the supplier left lines unpriced — totals are not comparable. */
  complete: boolean;
}

export interface CommercialComparison {
  vendors: VendorColumn[];
  lines: LineComparison[];
  totals: VendorTotals[];
  /** Commercial-envelope questions — payment terms, returns policy and such. */
  questionRows: QuestionRow[];
  otherChargeNames: string[];
  currency: string;
  side: Side;
  l1: VendorTotals | null;
  /** Lines nobody quoted. Named, because they are a hole in the comparison. */
  unquotedLines: LineItem[];
}

export interface CommercialInput {
  event: SourcingEvent;
  lots: Lot[];
  lineItems: LineItem[];
  questionnaires: Questionnaire[];
  responses: Response[];
  bidders: EventBidder[];
  scores: Score[];
  names: Record<Id, string>;
  masked?: boolean;
  /** Freight, duty and the rest — per supplier, as the transformation holds them. */
  costComponents?: CostComponent[];
  consensusMode?: ConsensusMode;
}

/**
 * The commercial sheet.
 *
 * Per line, per supplier: price, quantity, tax and total, with the L1 supplier
 * and the quantity that would go to them. Then, per supplier: other charges,
 * base amount, tax amount and the rank that follows from them.
 */
export function commercialComparison({
  event, lots, lineItems, questionnaires, responses, bidders, scores, names,
  masked = false, costComponents = [], consensusMode = 'AVERAGE',
}: CommercialInput): CommercialComparison {
  const vendors = vendorColumns({ bidders, responses, names, masked });
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const submissionByBidder = new Map(
    vendors.map((v) => [v.bidderId, latestSubmission(responses, v.bidderId)]),
  );

  const lines: LineComparison[] = lineItems.map((lineItem) => {
    const taxRate = taxRateFor(lineItem.taxClass);
    const cells: LineCell[] = vendors.map((vendor) => {
      const quote = submissionByBidder.get(vendor.bidderId)
        ?.priceLines.find((line) => line.lineItemId === lineItem.id);
      const unitPrice = quote?.unitPrice ?? null;
      if (unitPrice === null) {
        return {
          bidderId: vendor.bidderId, unitPrice: null, quantity: lineItem.quantity,
          taxRate, base: null, tax: null, total: null, rank: null, isL1: false,
          leadTimeDays: quote?.leadTimeDays ?? null,
        };
      }
      const base = unitPrice * lineItem.quantity;
      const tax = round(base * (taxRate / 100));
      return {
        bidderId: vendor.bidderId,
        unitPrice,
        quantity: lineItem.quantity,
        taxRate,
        base: round(base),
        tax,
        total: round(base + tax),
        rank: null,
        isL1: false,
        leadTimeDays: quote?.leadTimeDays ?? null,
      };
    });

    const quoted = cells.filter((cell) => cell.total !== null);
    rank(quoted, (cell) => cell.total!, event.side);
    for (const cell of quoted) cell.isL1 = cell.rank === 1;

    const winners = quoted.filter((cell) => cell.isL1);
    const winner = winners[0] ?? null;
    return {
      lineItem,
      lotId: lineItem.lotId,
      lotName: lotById.get(lineItem.lotId)?.name ?? '',
      cells,
      l1: winner === null ? null : {
        bidderId: winner.bidderId,
        name: vendors.find((v) => v.bidderId === winner.bidderId)!.name,
        total: winner.total!,
        quantity: lineItem.quantity,
      },
      tied: winners.length > 1,
    };
  });

  const totals: VendorTotals[] = vendors.map((vendor) => {
    const cells = lines
      .map((line) => line.cells.find((cell) => cell.bidderId === vendor.bidderId)!)
      .filter((cell) => cell.total !== null);
    const base = round(cells.reduce((sum, cell) => sum + cell.base!, 0));
    const tax = round(cells.reduce((sum, cell) => sum + cell.tax!, 0));
    const otherCharges = round(chargesFor(costComponents, vendor.bidderId, {
      base,
      units: cells.reduce((sum, cell) => sum + cell.quantity, 0),
      lines: cells.length,
    }));
    return {
      bidderId: vendor.bidderId,
      name: vendor.name,
      linesQuoted: cells.length,
      base,
      tax,
      otherCharges,
      total: round(base + tax + otherCharges),
      rank: null,
      complete: cells.length === lines.length && lines.length > 0,
    };
  });

  // Only a supplier who priced every line is ranked on the total. A partial
  // quotation compared against a full one is the classic false L1.
  const comparable = totals.filter((t) => t.complete);
  rank(comparable, (t) => t.total, event.side);
  const l1 = comparable.find((t) => t.rank === 1) ?? null;

  const commercialQuestions = questionnaires
    .flatMap((questionnaire) => questionnaire.questions
      .filter((question) => question.envelope === 'COMMERCIAL')
      .map((question) => ({ question, questionnaire })))
    .filter(({ question }) => question.type !== 'price_schedule')
    .sort((a, b) => a.question.sequence - b.question.sequence);

  const questionRows: QuestionRow[] = commercialQuestions.map(({ question, questionnaire }) => {
    const cells = answerCells(question, vendors, responses, scores, consensusMode);
    const scored = cells.map((c) => c.score).filter((s): s is number => s !== null);
    return {
      question,
      eventId: questionnaire.eventId,
      stage: questionnaire.stage,
      cells,
      bestScore: scored.length === 0 ? null : Math.max(...scored),
    };
  });

  return {
    vendors,
    lines,
    totals,
    questionRows,
    otherChargeNames: costComponents.map((component) => component.name),
    currency: event.currency,
    side: event.side,
    l1,
    unquotedLines: lines
      .filter((line) => line.cells.every((cell) => cell.total === null))
      .map((line) => line.lineItem),
  };
}

/**
 * Freight, duty and the rest, resolved for one supplier.
 *
 * The four bases are resolved exactly as `transformation.ts` resolves them for
 * the auction — a charge that means one thing in the cockpit and another on the
 * comparison sheet would put two different landed values in front of the same
 * approver.
 */
function chargesFor(
  components: CostComponent[], bidderId: Id,
  quoted: { base: number; units: number; lines: number },
): number {
  return components.reduce((sum, component) => {
    const value = component.valueByBidder[bidderId] ?? 0;
    switch (component.basis) {
      case 'PER_UNIT': return sum + value * quoted.units;
      case 'PER_LINE': return sum + value * quoted.lines;
      case 'PERCENTAGE': return sum + (quoted.base * value) / 100;
      case 'LUMP_SUM': return sum + value;
      default: return sum;
    }
  }, 0);
}

/**
 * Rank in place, best first, ties sharing a rank.
 *
 * Standard competition ranking — two suppliers tied at the top are both L1 and
 * the next is third — because a tie is a real outcome that the tie-break policy
 * resolves, not something to be broken silently by array order.
 */
function rank<T extends { rank: number | null }>(
  rows: T[], value: (row: T) => number, side: Side,
): void {
  const sorted = [...rows].sort((a, b) => bestFirst(side)(value(a), value(b)));
  let assigned = 0;
  let previous: number | null = null;
  let previousRank = 0;
  for (const row of sorted) {
    assigned += 1;
    const current = value(row);
    if (previous !== null && !isBetter(previous, current, side) && !isBetter(current, previous, side)) {
      row.rank = previousRank;
    } else {
      row.rank = assigned;
      previousRank = assigned;
    }
    previous = current;
  }
}

/** Money, to the cent. Kept in one place so two sheets cannot round apart. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * The sheet as a file.
 *
 * Same shape as the grid on screen, because the CSV is what gets mailed to an
 * approver who will not log in — a different layout in the file than on the
 * screen is two versions of the truth. The label column has an empty header,
 * which is what the client's own comparison exports look like.
 */
function toCsv(rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

export const GATE_VERDICT_LABEL: Record<GateVerdict, string> = {
  QUALIFIES: 'Qualifies',
  DOES_NOT_QUALIFY: 'Does not qualify',
  PENDING: 'Scoring incomplete',
};

export function technicalCsv(comparison: TechnicalComparison): string {
  const { vendors, sections, totals } = comparison;
  const rows: (string | number | null)[][] = [
    ['', ...vendors.map((v) => v.name), 'BEST SCORE'],
  ];

  for (const section of sections) {
    rows.push([`${section.eventNumber} · ${section.stage} · ${section.name}`, ...vendors.map(() => ''), '']);
    for (const row of section.rows) {
      rows.push([
        row.question.title,
        ...vendors.map((vendor) => {
          const cell = row.cells.find((c) => c.bidderId === vendor.bidderId)!;
          if (!cell.answered) return '';
          return cell.score === null ? cell.display : `${cell.display} (${cell.score}/${cell.maxScore})`;
        }),
        row.bestScore === null ? '' : row.bestScore,
      ]);
    }
  }

  const total = (bidderId: Id) => totals.find((t) => t.bidderId === bidderId)!;
  rows.push(['Technical score', ...vendors.map((v) => `${total(v.bidderId).score.toFixed(1)}%`), '']);
  rows.push(['Questions answered', ...vendors.map((v) => `${total(v.bidderId).answered} of ${total(v.bidderId).asked}`), '']);
  rows.push(['Technical rank', ...vendors.map((v) => (total(v.bidderId).rank === null ? '' : `Rank ${total(v.bidderId).rank}`)), '']);
  rows.push(['Questions scored', ...vendors.map((v) => `${total(v.bidderId).scored} of ${total(v.bidderId).scoredOf}`), '']);
  rows.push([
    'Technical gate',
    ...vendors.map((v) => GATE_VERDICT_LABEL[total(v.bidderId).verdict]),
    '',
  ]);

  return toCsv(rows);
}

export function commercialCsv(comparison: CommercialComparison): string {
  const { vendors, lines, totals } = comparison;
  const rows: (string | number | null)[][] = [
    ['', ...vendors.map((v) => v.name), 'L1 VENDOR', 'L1 QUANTITY'],
  ];

  for (const line of lines) {
    const cellOf = (bidderId: Id) => line.cells.find((c) => c.bidderId === bidderId)!;
    rows.push([
      `${line.lineItem.description} (${line.lineItem.uom} units required)`,
      ...vendors.map((v) => (cellOf(v.bidderId).rank === null ? '' : `Rank ${cellOf(v.bidderId).rank}`)),
      line.l1?.name ?? '',
      line.l1?.quantity ?? '',
    ]);
    rows.push(['Price', ...vendors.map((v) => cellOf(v.bidderId).unitPrice), '', '']);
    rows.push(['Qtty', ...vendors.map((v) => (cellOf(v.bidderId).unitPrice === null ? '' : cellOf(v.bidderId).quantity)), '', '']);
    rows.push(['Tax', ...vendors.map((v) => cellOf(v.bidderId).tax), '', '']);
    rows.push(['Total', ...vendors.map((v) => cellOf(v.bidderId).total), '', '']);
  }

  const total = (bidderId: Id) => totals.find((t) => t.bidderId === bidderId)!;
  rows.push(['Other Charges', ...vendors.map((v) => (total(v.bidderId).otherCharges === 0 ? '' : total(v.bidderId).otherCharges)), '', '']);
  rows.push(['Base Amount', ...vendors.map((v) => total(v.bidderId).base), '', '']);
  rows.push(['Tax Amount', ...vendors.map((v) => total(v.bidderId).tax), '', '']);
  rows.push([
    'Total landed value',
    ...vendors.map((v) => total(v.bidderId).total),
    comparison.l1?.name ?? '',
    comparison.l1?.total ?? '',
  ]);
  rows.push([
    'Commercial rank',
    ...vendors.map((v) => {
      const row = total(v.bidderId);
      if (!row.complete) return 'Partial quotation';
      return row.rank === null ? '' : `Rank ${row.rank}`;
    }),
    '', '',
  ]);

  return toCsv(rows);
}
