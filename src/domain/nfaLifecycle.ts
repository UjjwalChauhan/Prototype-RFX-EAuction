/**
 * Pack 28 — the NFA after the first run.
 *
 * Packs 22 and 23 assume a clean note: draft, submit, approve, execute. Real
 * awards get returned, corrected, re-submitted, occasionally rejected, and are
 * routinely followed by someone saying "we also need this item". This module is
 * the rules layer under all of that.
 *
 * Four ideas carry the whole file:
 *
 * 1. **A revision is a snapshot, not a pointer.** Every submitted revision
 *    freezes its document *and* the DoA chain that was in force at that moment.
 *    Changing the matrix next quarter must not alter how a decision taken today
 *    renders — so a decided revision reads its own copy, never the live matrix.
 *
 * 2. **Materiality decides the chain.** `classifyChange` is the single place
 *    that says whether an edit is material. A material change restarts the
 *    chain and invalidates approvals already given; a non-material one resumes
 *    where the note was returned from. Everything the amendment banner says is
 *    derived from that one function, so the banner and the reducer can never
 *    disagree.
 *
 * 3. **Superseded approvals are struck, never deleted.** An approver who
 *    approved v1 and is asked again on v2 must be able to see their own earlier
 *    decision and what changed since.
 *
 * 4. **No screen may create an award line with no bid behind it.** That is why
 *    `scopeChangeRouting` exists: the answer to "can I add this item?" is never
 *    a disabled control, it is an explanation plus the legitimate destinations.
 *
 * Open decisions from PRD §B14.8 are modelled as `OpenDecisionSettings` rather
 * than picked silently. Each option renders; the client settles the register by
 * pointing at a screen.
 */
import type {
  ApprovalStep, ChangeClass, EventStatus, Id, Nfa, NfaAllocationLine,
  NfaChainSnapshot, NfaDocument, NfaErratum, NfaRevision, NfaRevisionOutcome,
  NfaStatus, RateContract, ServerMillis,
} from './types';
import type { SimulationResult } from './doa';

// ---------------------------------------------------------------------------
// The open-decision register — §B14.8
// ---------------------------------------------------------------------------

export type OD01 = 'PCT_5' | 'PCT_10' | 'ABSOLUTE';
export type OD02 = 'RESUME' | 'RESTART';
export type OD03 = 'BLOCKED_AFTER_FIRST_APPROVAL' | 'PERMITTED_WITH_REASON';
export type OD04 = 'TERMINAL' | 'RETURN_TO_AWARD';
export type OD05 = 'LOG_ONLY' | 'SINGLE_LEVEL' | 'FULL_CHAIN';
export type OD06 = 'MANUAL' | 'GUIDED' | 'AUTOMATIC';
export type OD07 = 'ERRATA_ONLY' | 'ALWAYS_NEW_REVISION' | 'MATERIALITY_DECIDES';
export type OD08 = 'BUYER' | 'BUYER_AND_APPROVER' | 'ADMIN_ONLY';
export type OD09 = 'AUTO_RESOLICIT' | 'NOTIFY_ONLY';

export interface OpenDecisionSettings {
  /** OD-01 — what value movement counts as material. */
  od01ValueDelta: OD01;
  /** OD-02 — where a non-material re-submission re-enters the chain. */
  od02NonMaterialReentry: OD02;
  /** OD-03 — recall once a level has approved. */
  od03RecallAfterApproval: OD03;
  /** OD-04 — what a rejection leaves behind. */
  od04Rejection: OD04;
  /** OD-05 — re-approval for an in-tolerance award-quantity change. */
  od05ToleranceApproval: OD05;
  /** OD-06 — how hard the blocked-action panel steers. */
  od06Routing: OD06;
  /** OD-07 — correcting an approved, not-yet-executed award. */
  od07PostApproval: OD07;
  /** OD-08 — who may author an errata note. */
  od08ErrataAuthor: OD08;
  /** OD-09 — what happens to an approver whose approval was superseded. */
  od09SupersededApprover: OD09;
}

export const DEFAULT_OPEN_DECISIONS: OpenDecisionSettings = {
  od01ValueDelta: 'PCT_5',
  od02NonMaterialReentry: 'RESUME',
  od03RecallAfterApproval: 'BLOCKED_AFTER_FIRST_APPROVAL',
  od04Rejection: 'TERMINAL',
  od05ToleranceApproval: 'LOG_ONLY',
  od06Routing: 'GUIDED',
  od07PostApproval: 'MATERIALITY_DECIDES',
  od08ErrataAuthor: 'BUYER',
  od09SupersededApprover: 'AUTO_RESOLICIT',
};

export interface OpenDecisionOption<T extends string = string> {
  value: T;
  label: string;
  /** What the screen looks like under this option — the annotated sheet's text. */
  screenEffect: string;
}

export interface OpenDecisionEntry {
  id: string;
  question: string;
  /** True when choosing differently changes a rendered screen in this pack. */
  changesTheScreen: boolean;
  deliverable: string;
  options: OpenDecisionOption[];
  settingKey: keyof OpenDecisionSettings;
}

/** All nine, in register order. The annotated sheet renders straight off this. */
export const OPEN_DECISIONS: OpenDecisionEntry[] = [
  {
    id: 'OD-01',
    question: 'What movement in total value is material?',
    changesTheScreen: true,
    deliverable: 'D2 diff · D3 amendment banner',
    settingKey: 'od01ValueDelta',
    options: [
      { value: 'PCT_5', label: '5% of the approved value', screenEffect: 'A 4% price correction diffs as non-material; the banner keeps the chain resuming at the returning level.' },
      { value: 'PCT_10', label: '10% of the approved value', screenEffect: 'The same 4% correction is still non-material, and so is a 9% one — the banner flips later and fewer chains restart.' },
      { value: 'ABSOLUTE', label: 'Any change of the total at all', screenEffect: 'Every value movement renders in the material column and restarts the chain. The non-material banner is effectively unreachable for priced edits.' },
    ],
  },
  {
    id: 'OD-02',
    question: 'Where does a non-material re-submission re-enter the chain?',
    changesTheScreen: true,
    deliverable: 'D3 amendment banner · D4 chain history',
    settingKey: 'od02NonMaterialReentry',
    options: [
      { value: 'RESUME', label: 'Resume at the returning level', screenEffect: 'Banner reads "the chain will resume at level 2". Levels 1 is carried forward and shown ticked, not struck.' },
      { value: 'RESTART', label: 'Restart at level 1 regardless', screenEffect: 'Banner reads "restart from level 1" even for a typo. Every earlier approval renders struck, which is the visible cost of this option.' },
    ],
  },
  {
    id: 'OD-03',
    question: 'May a buyer recall a note once a level has approved?',
    changesTheScreen: true,
    deliverable: 'D5 recall',
    settingKey: 'od03RecallAfterApproval',
    options: [
      { value: 'BLOCKED_AFTER_FIRST_APPROVAL', label: 'No — blocked once any level approves', screenEffect: 'The Recall control stays present but disabled, and states which approval closed the door. It is never hidden.' },
      { value: 'PERMITTED_WITH_REASON', label: 'Yes — with a mandatory reason', screenEffect: 'Recall stays enabled; the modal names every approval being discarded, by holder and level, before the buyer can confirm.' },
    ],
  },
  {
    id: 'OD-04',
    question: 'What does a rejection leave behind?',
    changesTheScreen: true,
    deliverable: 'D6 rejection aftermath',
    settingKey: 'od04Rejection',
    options: [
      { value: 'TERMINAL', label: 'Terminal — the event is cancelled', screenEffect: 'The rejected revision freezes, the event moves to Cancelled, and the screen says a re-award needs a new event. No successor control is offered.' },
      { value: 'RETURN_TO_AWARD', label: 'Return to award — a successor note may be raised', screenEffect: 'The event returns to Award Recommended and a "Raise successor NFA" action appears, carrying the rejection reason into the new note and to the new chain.' },
    ],
  },
  {
    id: 'OD-05',
    question: 'Does an in-tolerance award-quantity change need re-approval?',
    changesTheScreen: true,
    deliverable: 'D8 quantity adjustment',
    settingKey: 'od05ToleranceApproval',
    options: [
      { value: 'LOG_ONLY', label: 'Logged, no re-approval', screenEffect: 'The adjustment panel confirms in place and writes an audit line. The note is not re-opened.' },
      { value: 'SINGLE_LEVEL', label: 'One level of approval', screenEffect: 'The panel shows a single-step chain — level 1 only — and the note re-enters approval at that one step.' },
      { value: 'FULL_CHAIN', label: 'The full chain, every time', screenEffect: 'The panel shows the whole resolved chain and warns that every approval already given is superseded.' },
    ],
  },
  {
    id: 'OD-06',
    question: 'How hard should the blocked-action panel steer?',
    changesTheScreen: true,
    deliverable: 'D7 scope-change routing',
    settingKey: 'od06Routing',
    options: [
      { value: 'MANUAL', label: 'Manual — list the destinations, choose nothing', screenEffect: 'All eligible destinations render flat, in order, with no recommendation and no pre-selection.' },
      { value: 'GUIDED', label: 'Guided — recommend one, allow any', screenEffect: 'One destination carries a "Recommended" chip and its reason; the others stay fully selectable.' },
      { value: 'AUTOMATIC', label: 'Automatic — pre-select and pre-fill', screenEffect: 'The recommended destination is pre-selected and its form pre-filled; the buyer confirms or switches. Nothing is committed without the confirm.' },
    ],
  },
  {
    id: 'OD-07',
    question: 'How is an approved, not-yet-executed award corrected?',
    changesTheScreen: true,
    deliverable: 'D9 post-approval correction',
    settingKey: 'od07PostApproval',
    options: [
      { value: 'ERRATA_ONLY', label: 'Errata note, no re-approval', screenEffect: 'Every correction is authored as an errata note. Material edits are simply not offered here — they route to a new event.' },
      { value: 'ALWAYS_NEW_REVISION', label: 'A new revision, every time', screenEffect: 'Even a mistyped cost centre raises revision n+1 and re-enters approval with the amendment banner.' },
      { value: 'MATERIALITY_DECIDES', label: 'Materiality decides', screenEffect: 'Non-material corrections take an errata note; anything the material list catches is refused with the reason and offered as a new revision.' },
    ],
  },
  {
    id: 'OD-08',
    question: 'Who may author an errata note?',
    changesTheScreen: false,
    deliverable: 'D9 — permission surface only',
    settingKey: 'od08ErrataAuthor',
    options: [
      { value: 'BUYER', label: 'The buyer who raised the note', screenEffect: 'The errata control is enabled for the note owner only; others see it disabled with the holder named.' },
      { value: 'BUYER_AND_APPROVER', label: 'The buyer or any approver on the chain', screenEffect: 'Same control, wider audience. The author is stamped on the errata line either way.' },
      { value: 'ADMIN_ONLY', label: 'A platform administrator only', screenEffect: 'The buyer sees the control disabled and a "request a correction" hand-off instead.' },
    ],
  },
  {
    id: 'OD-09',
    question: 'What happens to an approver whose approval was superseded?',
    changesTheScreen: false,
    deliverable: 'D4 chain history — copy only',
    settingKey: 'od09SupersededApprover',
    options: [
      { value: 'AUTO_RESOLICIT', label: 'Re-solicited automatically', screenEffect: 'The struck decision carries "re-solicited on revision n"; the step reappears as pending in the new revision.' },
      { value: 'NOTIFY_ONLY', label: 'Notified, re-solicited only if the chain reaches them', screenEffect: 'The struck decision carries "notified — awaiting the chain"; nothing is asked of them until the chain arrives.' },
    ],
  },
];

export function valueDeltaThresholdPct(od01: OD01): number {
  switch (od01) {
    case 'PCT_5': return 5;
    case 'PCT_10': return 10;
    case 'ABSOLUTE': return 0;
  }
}

// ---------------------------------------------------------------------------
// Materiality — §B14.5
// ---------------------------------------------------------------------------

/** One field-level difference between two revisions of the note. */
export interface FieldChange {
  /** The NFA section this field lives in, so a diff can group by section. */
  section: number;
  sectionTitle: string;
  field: string;
  label: string;
  from: string;
  to: string;
  material: boolean;
  /** Why it is or is not material — quoted straight into the diff. */
  rule: string;
}

export interface ChangeAssessment {
  changeClass: ChangeClass;
  changes: FieldChange[];
  materialChanges: FieldChange[];
  nonMaterialChanges: FieldChange[];
  /** One line, for the revision list. */
  summary: string;
}

/** The twelve sections, so the diff and the drawer name them identically. */
export const NFA_SECTIONS: { n: number; title: string }[] = [
  { n: 1, title: 'Header' },
  { n: 2, title: 'Requirement summary' },
  { n: 3, title: 'Process summary' },
  { n: 4, title: 'Competition summary' },
  { n: 5, title: 'Evaluation summary' },
  { n: 6, title: 'Negotiation summary' },
  { n: 7, title: 'Auction summary' },
  { n: 8, title: 'Recommendation' },
  { n: 9, title: 'Savings statement' },
  { n: 10, title: 'Deviations and exceptions' },
  { n: 11, title: 'Risk statement' },
  { n: 12, title: 'Approval chain' },
];

function sectionTitle(n: number): string {
  return NFA_SECTIONS.find((s) => s.n === n)?.title ?? 'Section';
}

function allocationKey(line: NfaAllocationLine): string {
  return `${line.lotId}::${line.bidderId}`;
}

function describeAllocation(line: NfaAllocationLine): string {
  return `${line.bidderName} — ${line.sharePct}% of ${line.lotName}, ${line.quantity.toLocaleString()} @ ${Math.round(line.value).toLocaleString()}`;
}

/**
 * The single definition of materiality in the product. §B14.5: the awardee set,
 * any allocation quantity or percentage, total value beyond the configured
 * delta, any added or removed award line, a new rank override or deviation, the
 * attached comparison-sheet version, or the resolved chain itself.
 */
export function classifyChange(
  base: NfaDocument,
  next: NfaDocument,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): ChangeAssessment {
  const changes: FieldChange[] = [];

  // -- The awardee set ------------------------------------------------------
  const baseAwardees = [...new Set(base.allocations.map((a) => a.bidderName))].sort();
  const nextAwardees = [...new Set(next.allocations.map((a) => a.bidderName))].sort();
  if (baseAwardees.join(', ') !== nextAwardees.join(', ')) {
    changes.push({
      section: 1, sectionTitle: sectionTitle(1),
      field: 'awardees', label: 'Awardee set',
      from: baseAwardees.join(', ') || '—', to: nextAwardees.join(', ') || '—',
      material: true, rule: 'The awardee set is material without qualification.',
    });
  }

  // -- Added, removed and altered award lines -------------------------------
  const baseByKey = new Map(base.allocations.map((a) => [allocationKey(a), a]));
  const nextByKey = new Map(next.allocations.map((a) => [allocationKey(a), a]));

  for (const [key, line] of nextByKey) {
    const before = baseByKey.get(key);
    if (!before) {
      changes.push({
        section: 1, sectionTitle: sectionTitle(1),
        field: `allocation:${key}`, label: `Award line added — ${line.lotName}`,
        from: '—', to: describeAllocation(line),
        material: true, rule: 'An added award line is material. It must trace to a bid.',
      });
      continue;
    }
    if (before.sharePct !== line.sharePct || before.quantity !== line.quantity) {
      changes.push({
        section: 1, sectionTitle: sectionTitle(1),
        field: `allocation:${key}`, label: `Allocation — ${line.bidderName}, ${line.lotName}`,
        from: describeAllocation(before), to: describeAllocation(line),
        material: true, rule: 'Any allocation quantity or percentage is material.',
      });
    }
  }
  for (const [key, line] of baseByKey) {
    if (!nextByKey.has(key)) {
      changes.push({
        section: 1, sectionTitle: sectionTitle(1),
        field: `allocation:${key}`, label: `Award line removed — ${line.lotName}`,
        from: describeAllocation(line), to: '—',
        material: true, rule: 'A removed award line is material.',
      });
    }
  }

  // -- Total value, against the configured delta ----------------------------
  if (base.totalValue !== next.totalValue) {
    const thresholdPct = valueDeltaThresholdPct(settings.od01ValueDelta);
    const movementPct = base.totalValue === 0
      ? 100
      : Math.abs((next.totalValue - base.totalValue) / base.totalValue) * 100;
    const material = thresholdPct === 0 ? true : movementPct > thresholdPct;
    changes.push({
      section: 9, sectionTitle: sectionTitle(9),
      field: 'totalValue', label: 'Total award value',
      from: Math.round(base.totalValue).toLocaleString(),
      to: Math.round(next.totalValue).toLocaleString(),
      material,
      rule: thresholdPct === 0
        ? 'OD-01 set to absolute: any movement of the total is material.'
        : `Movement of ${movementPct.toFixed(1)}% against a configured delta of ${thresholdPct}% (OD-01).`,
    });
  }

  // -- Rank override and deviations -----------------------------------------
  if (base.rankOverride !== next.rankOverride) {
    changes.push({
      section: 10, sectionTitle: sectionTitle(10),
      field: 'rankOverride', label: 'Rank override',
      from: base.rankOverride ? 'yes' : 'no', to: next.rankOverride ? 'yes' : 'no',
      material: true, rule: 'A new rank override is material and applies a DoA uplift.',
    });
  }
  const addedDeviations = next.deviations.filter((d) => !base.deviations.includes(d));
  const removedDeviations = base.deviations.filter((d) => !next.deviations.includes(d));
  for (const d of addedDeviations) {
    changes.push({
      section: 10, sectionTitle: sectionTitle(10),
      field: `deviation:${d}`, label: 'Deviation added',
      from: '—', to: d, material: true, rule: 'A new deviation is material.',
    });
  }
  for (const d of removedDeviations) {
    changes.push({
      section: 10, sectionTitle: sectionTitle(10),
      field: `deviation:${d}`, label: 'Deviation removed',
      from: d, to: '—', material: true, rule: 'Removing a recorded deviation is material.',
    });
  }

  // -- The attached comparison sheet ----------------------------------------
  if (base.comparisonSheetVersion !== next.comparisonSheetVersion) {
    changes.push({
      section: 5, sectionTitle: sectionTitle(5),
      field: 'comparisonSheetVersion', label: 'Attached comparison sheet',
      from: `v${base.comparisonSheetVersion}`, to: `v${next.comparisonSheetVersion}`,
      material: true, rule: 'The attached comparison-sheet version is material — it is the evidence.',
    });
  }

  // -- The resolved chain itself --------------------------------------------
  if (base.chainSignature !== next.chainSignature) {
    changes.push({
      section: 12, sectionTitle: sectionTitle(12),
      field: 'chainSignature', label: 'Resolved approval chain',
      from: base.chainSignature, to: next.chainSignature,
      material: true, rule: 'A change to the resolved chain is material by definition.',
    });
  }

  // -- Narrative and administrative -----------------------------------------
  const narrative: { field: keyof NfaDocument; label: string; section: number; rule: string }[] = [
    { field: 'recommendation', label: 'Recommendation (section 8)', section: 8, rule: 'Narrative. Re-wording the recommendation does not move the decision.' },
    { field: 'riskStatement', label: 'Risk statement', section: 11, rule: 'Narrative.' },
    { field: 'processSummary', label: 'Process summary', section: 3, rule: 'Narrative.' },
    { field: 'competitionSummary', label: 'Competition summary', section: 4, rule: 'Narrative.' },
    { field: 'overrideReason', label: 'Override justification', section: 10, rule: 'Narrative — the override itself is the material fact, not its wording.' },
    { field: 'costCentre', label: 'Cost centre', section: 1, rule: 'Administrative. Correctable by errata under OD-07.' },
    { field: 'requiredByDate', label: 'Required-by date', section: 2, rule: 'Administrative. Correctable by errata under OD-07.' },
    { field: 'paymentTerms', label: 'Payment terms', section: 2, rule: 'Administrative on this list; a client that scores payment terms should move this to the material list.' },
  ];
  for (const item of narrative) {
    const from = (base[item.field] ?? '—') as string;
    const to = (next[item.field] ?? '—') as string;
    if (from !== to) {
      changes.push({
        section: item.section, sectionTitle: sectionTitle(item.section),
        field: item.field as string, label: item.label,
        from: from || '—', to: to || '—',
        material: false, rule: item.rule,
      });
    }
  }

  const materialChanges = changes.filter((c) => c.material);
  const nonMaterialChanges = changes.filter((c) => !c.material);
  const changeClass: ChangeClass =
    changes.length === 0 ? 'NONE' : materialChanges.length > 0 ? 'MATERIAL' : 'NON_MATERIAL';

  return {
    changeClass,
    changes,
    materialChanges,
    nonMaterialChanges,
    summary: summarise(changeClass, materialChanges, nonMaterialChanges),
  };
}

function summarise(
  changeClass: ChangeClass, material: FieldChange[], nonMaterial: FieldChange[],
): string {
  if (changeClass === 'NONE') return 'No change against the previous revision.';
  if (changeClass === 'MATERIAL') {
    const first = material[0].label.toLowerCase();
    return material.length === 1
      ? `Material — ${first} changed.`
      : `Material — ${first} and ${material.length - 1} other change(s).`;
  }
  const first = nonMaterial[0].label.toLowerCase();
  return nonMaterial.length === 1
    ? `Non-material — ${first} re-worded.`
    : `Non-material — ${first} and ${nonMaterial.length - 1} other edit(s).`;
}

// ---------------------------------------------------------------------------
// The chain consequence — Deliverable 3
// ---------------------------------------------------------------------------

export interface ChainConsequence {
  changeClass: ChangeClass;
  restart: boolean;
  /** The level the chain will run from when the note is re-submitted. */
  resumeAtLevel: number;
  /** Approvals that re-submitting would invalidate — named, before submitting. */
  supersededApprovals: { level: number; role: string; holderName: string }[];
  /** The banner sentence. This is the most important string in the pack. */
  sentence: string;
  tone: 'info' | 'warning' | 'error';
}

/**
 * What re-submitting will do to the chain, computed from the change class and
 * the steps as they stand. The buyer sees this *before* submitting — never
 * discovers it afterwards.
 */
export function chainConsequence(
  assessment: ChangeAssessment,
  steps: ApprovalStep[],
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): ChainConsequence {
  const approved = steps.filter((s) => s.decision === 'APPROVED' && !s.superseded);
  const returnedAt = steps.find((s) => s.decision === 'RETURNED');
  // Where a resumed chain picks up: the level that returned it, or the first
  // step nobody has decided yet.
  const firstUndecided = steps.find((s) => s.decision === 'PENDING');
  const resumeLevel = returnedAt?.level ?? firstUndecided?.level ?? steps[steps.length - 1]?.level ?? 1;

  if (assessment.changeClass === 'NONE') {
    return {
      changeClass: 'NONE',
      restart: false,
      resumeAtLevel: resumeLevel,
      supersededApprovals: [],
      sentence: `No change yet — re-submitting returns the note to level ${resumeLevel} exactly as it was.`,
      tone: 'info',
    };
  }

  if (assessment.changeClass === 'NON_MATERIAL' && settings.od02NonMaterialReentry === 'RESUME') {
    return {
      changeClass: 'NON_MATERIAL',
      restart: false,
      resumeAtLevel: resumeLevel,
      supersededApprovals: [],
      sentence: `Non-material so far — the chain will resume at level ${resumeLevel}.`
        + (approved.length > 0
          ? ` The ${approved.length} approval(s) already given are carried forward.`
          : ''),
      tone: 'info',
    };
  }

  const superseded = approved.map((s) => ({ level: s.level, role: s.role, holderName: s.holderName }));
  const restartLevel = steps[0]?.level ?? 1;

  if (assessment.changeClass === 'NON_MATERIAL') {
    // OD-02 set to RESTART: even a typo costs the chain.
    return {
      changeClass: 'NON_MATERIAL',
      restart: true,
      resumeAtLevel: restartLevel,
      supersededApprovals: superseded,
      sentence: superseded.length === 0
        ? `Non-material, but this tenant restarts every re-submission — the chain will run again from level ${restartLevel}.`
        : `Non-material, but this tenant restarts every re-submission. Re-submitting will restart the chain from level ${restartLevel} and re-solicit ${countWord(superseded.length)} approval(s) already given.`,
      tone: 'warning',
    };
  }

  const driver = assessment.materialChanges[0];
  return {
    changeClass: 'MATERIAL',
    restart: true,
    resumeAtLevel: restartLevel,
    supersededApprovals: superseded,
    sentence: superseded.length === 0
      ? `You have changed ${driver.label.toLowerCase()}. This is material — re-submitting will restart the chain from level ${restartLevel}.`
      : `You have changed ${driver.label.toLowerCase()}. Re-submitting will restart the chain from level ${restartLevel} and re-solicit ${countWord(superseded.length)} approval${superseded.length === 1 ? '' : 's'} already given (${superseded.map((s) => s.holderName).join(', ')}).`,
    tone: 'warning',
  };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function countWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

// ---------------------------------------------------------------------------
// Revisions — snapshot, submit, decide
// ---------------------------------------------------------------------------

/**
 * Freeze the resolved chain. The snapshot is what a decided revision renders
 * from forever after, so a DoA edit next quarter cannot rewrite history.
 */
export function snapshotChain(
  doa: SimulationResult,
  at: ServerMillis,
): NfaChainSnapshot {
  return {
    ruleId: doa.matchedRule?.id ?? null,
    ruleName: doa.matchedRule?.name ?? 'No matching rule',
    chainMode: doa.matchedRule?.chainMode ?? 'SEQUENTIAL',
    capturedAt: at,
    totalSlaHours: doa.totalSlaHours,
    upliftApplied: doa.upliftApplied,
    levels: doa.chain.map((l) => ({ ...l })),
  };
}

export function chainSignature(levels: NfaChainSnapshot['levels']): string {
  return levels.map((l) => `L${l.level} ${l.role} (${l.holderName})`).join(' → ') || 'none';
}

/**
 * Has the DoA matrix moved since this revision was decided? The answer never
 * changes what the revision shows — it only explains why the snapshot and the
 * live matrix differ.
 */
export interface ChainDrift {
  drifted: boolean;
  snapshotSignature: string;
  liveSignature: string;
  note: string;
}

export function chainDrift(snapshot: NfaChainSnapshot, live: SimulationResult): ChainDrift {
  const snapshotSignature = chainSignature(snapshot.levels);
  const liveSignature = chainSignature(live.chain.map((l) => ({ ...l })));
  const drifted = snapshotSignature !== liveSignature;
  return {
    drifted,
    snapshotSignature,
    liveSignature,
    note: drifted
      ? 'The DoA matrix has been edited since this revision was decided. The revision still renders the chain that was in force at the time — that is the point of the snapshot.'
      : 'The DoA matrix has not moved since this revision was decided.',
  };
}

export function buildSteps(
  nfaId: Id,
  revisionNumber: number,
  levels: NfaChainSnapshot['levels'],
): ApprovalStep[] {
  return levels.map((level, i) => ({
    id: `${nfaId}-r${revisionNumber}-step-${i + 1}`,
    nfaId,
    level: level.level,
    holderId: `user-${level.holderName.replace(/\s+/g, '-').toLowerCase()}`,
    holderName: level.holderName,
    role: level.role,
    slaHours: level.slaHours,
    decision: 'PENDING' as const,
    comment: null,
    decidedAt: null,
    revisionNumber,
    kind: level.role.includes('uplift') ? ('UPLIFT' as const) : ('NORMAL' as const),
    superseded: false,
    supersededReason: null,
    carriedForward: false,
  }));
}

export function currentRevision(nfa: Nfa): NfaRevision | undefined {
  return nfa.revisions[nfa.revisions.length - 1];
}

export function revisionLabel(nfa: Nfa): string {
  const total = nfa.revisions.length;
  const current = currentRevision(nfa)?.number ?? total;
  return `Revision ${current} of ${total}`;
}

export const REVISION_OUTCOME_PRESENTATION: Record<NfaRevisionOutcome, { label: string; icon: string; fg: string; bg: string }> = {
  IN_FLIGHT: { label: 'In flight', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  APPROVED: { label: 'Approved', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  RETURNED: { label: 'Returned', icon: '↩', fg: '#B45309', bg: '#FEF3C7' },
  REJECTED: { label: 'Rejected', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
  RECALLED: { label: 'Recalled', icon: '⊘', fg: '#374151', bg: '#F1F2F4' },
  SUPERSEDED: { label: 'Superseded', icon: '⤷', fg: '#6B7280', bg: '#F1F2F4' },
};

export const NFA_STATUS_PRESENTATION: Record<NfaStatus, { label: string; icon: string; fg: string; bg: string }> = {
  IN_APPROVAL: { label: 'In approval', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  RETURNED: { label: 'Returned to buyer', icon: '↩', fg: '#B45309', bg: '#FEF3C7' },
  RECALLED: { label: 'Recalled', icon: '⊘', fg: '#374151', bg: '#F1F2F4' },
  APPROVED: { label: 'Approved', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  REJECTED: { label: 'Rejected', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
};

export interface SubmitRevisionInput {
  nfa: Nfa;
  document: NfaDocument;
  chain: NfaChainSnapshot;
  actorId: Id;
  actorName: string;
  at: ServerMillis;
  settings?: OpenDecisionSettings;
}

/**
 * Submit the working draft as the next revision. The consequence computed here
 * is the same one the amendment banner showed, because both call
 * `chainConsequence` — there is no second opinion.
 */
export function submitRevision(input: SubmitRevisionInput): { nfa: Nfa; consequence: ChainConsequence } {
  const settings = input.settings ?? DEFAULT_OPEN_DECISIONS;
  const previous = currentRevision(input.nfa);
  const assessment = previous
    ? classifyChange(previous.document, input.document, settings)
    : { changeClass: 'NONE' as ChangeClass, changes: [], materialChanges: [], nonMaterialChanges: [], summary: 'First submission.' };
  const consequence = previous
    ? chainConsequence(assessment, previous.steps, settings)
    : {
        changeClass: 'NONE' as ChangeClass, restart: true, resumeAtLevel: input.chain.levels[0]?.level ?? 1,
        supersededApprovals: [], sentence: 'First submission — the chain runs from level 1.', tone: 'info' as const,
      };

  const number = (previous?.number ?? 0) + 1;
  const steps = buildSteps(input.nfa.id, number, input.chain.levels);

  // A resumed chain carries earlier approvals forward; a restarted one strikes
  // them. Either way they stay visible in the history.
  if (previous && !consequence.restart) {
    for (const step of steps) {
      const earlier = previous.steps.find(
        (s) => s.level === step.level && s.decision === 'APPROVED' && !s.superseded,
      );
      if (earlier && step.level < consequence.resumeAtLevel) {
        step.decision = 'APPROVED';
        step.comment = earlier.comment;
        step.decidedAt = earlier.decidedAt;
        step.holderName = earlier.holderName;
        step.carriedForward = true;
      }
    }
  }

  const closedPrevious: NfaRevision[] = input.nfa.revisions.map((rev) =>
    rev.number === previous?.number
      ? {
          ...rev,
          outcome: rev.outcome === 'IN_FLIGHT' ? ('SUPERSEDED' as NfaRevisionOutcome) : rev.outcome,
          closedAt: rev.closedAt ?? input.at,
          steps: rev.steps.map((s) =>
            consequence.restart && s.decision === 'APPROVED'
              ? {
                  ...s,
                  superseded: true,
                  supersededReason: `Invalidated by revision ${number} — ${assessment.summary.toLowerCase()}`,
                }
              : s,
          ),
        }
      : rev,
  );

  const revision: NfaRevision = {
    id: `${input.nfa.id}-rev-${number}`,
    nfaId: input.nfa.id,
    number,
    document: input.document,
    chainSnapshot: input.chain,
    steps,
    outcome: 'IN_FLIGHT',
    outcomeDetail: null,
    changeClass: assessment.changeClass,
    changeSummary: previous ? assessment.summary : 'First submission of the note.',
    submittedBy: input.actorId,
    submittedByName: input.actorName,
    submittedAt: input.at,
    closedAt: null,
    supersededApprovals: consequence.restart ? consequence.supersededApprovals : [],
    errata: [],
  };

  return {
    nfa: {
      ...input.nfa,
      status: 'IN_APPROVAL',
      steps,
      recommendation: input.document.recommendation,
      riskStatement: input.document.riskStatement,
      deviations: input.document.deviations,
      comparisonSheetVersion: input.document.comparisonSheetVersion,
      overrideReason: input.document.overrideReason,
      draft: input.document,
      revisions: [...closedPrevious, revision],
    },
    consequence,
  };
}

export interface DecisionInput {
  nfa: Nfa;
  level: number;
  decision: 'APPROVED' | 'RETURNED' | 'REJECTED' | 'DELEGATED';
  comment: string;
  actorName: string;
  /** Required on DELEGATED. */
  delegateToName?: string;
  at: ServerMillis;
}

/**
 * Record one approver decision against the live revision. Delegation replaces
 * the holder and leaves the step pending — a delegation is not a decision.
 */
export function applyDecision(input: DecisionInput): Nfa {
  const live = currentRevision(input.nfa);
  if (!live) return input.nfa;

  const steps = live.steps.map((step) => {
    if (step.level !== input.level) return step;
    if (input.decision === 'DELEGATED') {
      return {
        ...step,
        kind: 'DELEGATED' as const,
        delegatedToId: `user-${(input.delegateToName ?? '').replace(/\s+/g, '-').toLowerCase()}`,
        delegatedToName: input.delegateToName ?? null,
        holderName: input.delegateToName ?? step.holderName,
        comment: input.comment || step.comment,
        // Still pending: the delegate has to decide.
        decision: 'PENDING' as const,
      };
    }
    return {
      ...step,
      decision: input.decision,
      comment: input.comment || null,
      decidedAt: input.at,
      holderName: step.holderName,
    };
  });

  const allApproved = steps.every((s) => s.decision === 'APPROVED');
  const outcome: NfaRevisionOutcome =
    input.decision === 'REJECTED' ? 'REJECTED'
    : input.decision === 'RETURNED' ? 'RETURNED'
    : allApproved ? 'APPROVED'
    : 'IN_FLIGHT';

  const status: NfaStatus =
    input.decision === 'REJECTED' ? 'REJECTED'
    : input.decision === 'RETURNED' ? 'RETURNED'
    : allApproved ? 'APPROVED'
    : 'IN_APPROVAL';

  const outcomeDetail =
    input.decision === 'REJECTED' ? `Rejected by level ${input.level} — ${input.actorName}`
    : input.decision === 'RETURNED' ? `Returned by level ${input.level} — ${input.actorName}`
    : allApproved ? 'Approved by every level'
    : null;

  return {
    ...input.nfa,
    status,
    steps,
    rejectionReason: input.decision === 'REJECTED' ? input.comment : input.nfa.rejectionReason,
    revisions: input.nfa.revisions.map((rev) =>
      rev.number === live.number
        ? {
            ...rev,
            steps,
            outcome,
            outcomeDetail,
            closedAt: outcome === 'IN_FLIGHT' ? null : input.at,
          }
        : rev,
    ),
  };
}

/**
 * A breached SLA pushes a step up a level. The escalation is not a decision —
 * the step stays pending under a new holder, and the original holder stays
 * visible in the history.
 */
export function escalateStep(nfa: Nfa, level: number, toName: string): Nfa {
  const live = currentRevision(nfa);
  if (!live) return nfa;
  const steps = live.steps.map((s) =>
    s.level === level
      ? {
          ...s,
          kind: 'ESCALATED' as const,
          escalatedFromName: s.escalatedFromName ?? s.holderName,
          holderName: toName,
          decision: 'PENDING' as const,
          decidedAt: null,
        }
      : s,
  );
  return {
    ...nfa,
    steps,
    revisions: nfa.revisions.map((r) => (r.number === live.number ? { ...r, steps } : r)),
  };
}

// ---------------------------------------------------------------------------
// Chain history across revisions — Deliverable 4
// ---------------------------------------------------------------------------

export interface ChainHistoryEntry {
  revisionNumber: number;
  level: number;
  role: string;
  holderName: string;
  decision: ApprovalStep['decision'];
  comment: string | null;
  at: ServerMillis | null;
  superseded: boolean;
  supersededReason: string | null;
  carriedForward: boolean;
  kind: NonNullable<ApprovalStep['kind']>;
  delegatedToName: string | null;
  escalatedFromName: string | null;
  /** The revision's own outcome, so the history reads as a story. */
  revisionOutcome: NfaRevisionOutcome;
}

/**
 * Every level, decision, comment, delegation and escalation, in order, across
 * all revisions. Superseded approvals are returned, marked — never dropped.
 */
export function buildChainHistory(nfa: Nfa): ChainHistoryEntry[] {
  const entries: ChainHistoryEntry[] = [];
  for (const revision of nfa.revisions) {
    for (const step of revision.steps) {
      entries.push({
        revisionNumber: revision.number,
        level: step.level,
        role: step.role,
        holderName: step.holderName,
        decision: step.decision,
        comment: step.comment,
        at: step.decidedAt,
        superseded: step.superseded === true,
        supersededReason: step.supersededReason ?? null,
        carriedForward: step.carriedForward === true,
        kind: step.kind ?? 'NORMAL',
        delegatedToName: step.delegatedToName ?? null,
        escalatedFromName: step.escalatedFromName ?? null,
        revisionOutcome: revision.outcome,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Recall — Deliverable 5, OD-03
// ---------------------------------------------------------------------------

export interface RecallAvailability {
  available: boolean;
  requiresReason: boolean;
  /** The approvals a recall would discard, named before the buyer confirms. */
  invalidates: { level: number; role: string; holderName: string }[];
  /** The approver holding the pending step, who gets the notification. */
  pendingHolder: { level: number; holderName: string } | null;
  /** Shown on the disabled control. A disabled control with no reason is a defect. */
  explanation: string;
}

export function recallAvailability(
  nfa: Nfa,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): RecallAvailability {
  const live = currentRevision(nfa);
  const steps = live?.steps ?? [];
  const approved = steps.filter((s) => s.decision === 'APPROVED' && !s.superseded);
  const pending = steps.find((s) => s.decision === 'PENDING');
  const pendingHolder = pending ? { level: pending.level, holderName: pending.holderName } : null;
  const invalidates = approved.map((s) => ({ level: s.level, role: s.role, holderName: s.holderName }));

  if (nfa.status === 'APPROVED' || nfa.status === 'REJECTED') {
    return {
      available: false, requiresReason: true, invalidates, pendingHolder,
      explanation: nfa.status === 'APPROVED'
        ? 'The chain has closed. An approved note is corrected by errata or by a new revision, not by recall.'
        : 'The note was rejected. A rejected note is frozen and cannot be recalled.',
    };
  }

  if (approved.length === 0) {
    return {
      available: true, requiresReason: true, invalidates: [], pendingHolder,
      explanation: pendingHolder
        ? `No level has decided yet. Recalling withdraws the note from ${pendingHolder.holderName} at level ${pendingHolder.level} and notifies them.`
        : 'No level has decided yet. Recalling withdraws the note.',
    };
  }

  if (settings.od03RecallAfterApproval === 'BLOCKED_AFTER_FIRST_APPROVAL') {
    const first = approved[0];
    return {
      available: false, requiresReason: true, invalidates, pendingHolder,
      explanation: `Recall closed when ${first.holderName} approved at level ${first.level}. `
        + 'This tenant does not allow an approval already given to be discarded by a recall — return the note through the chain, or let it complete and correct it afterwards.',
    };
  }

  return {
    available: true, requiresReason: true, invalidates, pendingHolder,
    explanation: `Recall is permitted with a mandatory reason. It will discard ${countWord(invalidates.length)} approval(s) already given: `
      + invalidates.map((a) => `${a.holderName} (level ${a.level})`).join(', ') + '.',
  };
}

export function applyRecall(nfa: Nfa, reason: string, at: ServerMillis): Nfa {
  const live = currentRevision(nfa);
  if (!live) return nfa;
  const steps = live.steps.map((s) =>
    s.decision === 'APPROVED'
      ? { ...s, superseded: true, supersededReason: `Discarded by recall — ${reason}` }
      : s,
  );
  return {
    ...nfa,
    status: 'RECALLED',
    recallReason: reason,
    steps,
    revisions: nfa.revisions.map((r) =>
      r.number === live.number
        ? {
            ...r, steps, outcome: 'RECALLED' as const, closedAt: at,
            outcomeDetail: `Recalled by the buyer — ${reason}`,
          }
        : r,
    ),
  };
}

// ---------------------------------------------------------------------------
// Rejection and its aftermath — Deliverable 6, OD-04
// ---------------------------------------------------------------------------

export interface RejectionAftermath {
  /** What the buyer is told, in the buyer-facing state Pack 23 never showed. */
  headline: string;
  consequence: string;
  /** The event status a rejection drives to. */
  eventStatus: EventStatus;
  successorAllowed: boolean;
  invariants: string[];
}

export function rejectionAftermath(
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): RejectionAftermath {
  const invariants = [
    'The rejection reason is mandatory and is recorded against the rejecting level.',
    'The rejected revision is frozen and retained in full — it is never deleted or edited.',
    'The buyer is notified, and the rejection is visible on the note and in the audit pack.',
  ];
  if (settings.od04Rejection === 'TERMINAL') {
    return {
      headline: 'Rejected — terminal. This event is closed to award.',
      consequence:
        'The note is frozen, the event moves to Cancelled, and no further award can be made against it. '
        + 'A re-award requires a new sourcing event, which carries this event as its parent.',
      eventStatus: 'CANCELLED',
      successorAllowed: false,
      invariants,
    };
  }
  return {
    headline: 'Rejected — the award returns to the buyer.',
    consequence:
      'The event returns to Award Recommended. A successor note may be raised, linked to the rejected one, '
      + 'with the rejection reason carried into its context and visible to the new chain.',
    eventStatus: 'AWARD_RECOMMENDED',
    successorAllowed: true,
    invariants,
  };
}

/** Raise the successor note OD-04b permits, linked both ways. */
export function raiseSuccessor(
  rejected: Nfa,
  id: Id,
  at: ServerMillis,
): { predecessor: Nfa; successor: Nfa } {
  const base = currentRevision(rejected);
  const successor: Nfa = {
    ...rejected,
    id,
    status: 'RETURNED',
    steps: [],
    revisions: [],
    draft: base ? { ...base.document } : rejected.draft,
    createdAt: at,
    rejectionReason: null,
    recallReason: null,
    supersededByNfaId: null,
    predecessorNfaId: rejected.id,
  };
  return {
    predecessor: { ...rejected, supersededByNfaId: id },
    successor,
  };
}

// ---------------------------------------------------------------------------
// Post-NFA scope change — Deliverable 7, §B14.7 and OD-06
// ---------------------------------------------------------------------------

export type ScopeChangeKind = 'ADD_LINE' | 'MATERIAL_EDIT' | 'QUANTITY_CHANGE';

export interface ScopeChangeContext {
  kind: ScopeChangeKind;
  eventStatus: EventStatus;
  /** Where the buyer hit the wall — the panel names its own entry point. */
  origin: 'ITEMS_AND_LOTS' | 'AWARD_SCENARIOS' | 'NFA';
  itemDescription: string;
  itemCategory: string;
  itemValue: number;
  currency: string;
  contract: RateContract | null;
}

export type ScopeDestinationId = 'NEW_EVENT' | 'CALL_OFF' | 'CORRIGENDUM';

export interface ScopeDestination {
  id: ScopeDestinationId;
  title: string;
  /** One line. What choosing this costs and what it produces. */
  consequence: string;
  recommended: boolean;
  recommendedBecause: string | null;
  detail: string | null;
  headroom: { ceiling: number; committed: number; remaining: number } | null;
}

export interface ScopeChangeRouting {
  /** Why the line cannot simply join this award. Never a bare disabled control. */
  blockedReason: string;
  blockedDetail: string;
  destinations: ScopeDestination[];
  /** OD-06: what the panel does with the recommendation. */
  mode: OD06;
  /** Pre-selected only under AUTOMATIC; the buyer still confirms. */
  preselected: ScopeDestinationId | null;
}

/** Statuses at or beyond which a line can no longer simply join the award. */
export const POST_AWARD_STATUSES: EventStatus[] = [
  'AWARD_RECOMMENDED', 'PENDING_AWARD_APPROVAL', 'AWARD_PENDING_ONBOARDING',
  'AWARDED', 'CLOSED',
];

export function isPostAward(status: EventStatus): boolean {
  return POST_AWARD_STATUSES.includes(status);
}

export function scopeChangeRouting(
  ctx: ScopeChangeContext,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): ScopeChangeRouting {
  const responsesStillOpen = !isPostAward(ctx.eventStatus)
    && ctx.eventStatus !== 'RESPONSES_CLOSED'
    && ctx.eventStatus !== 'UNDER_EVALUATION';

  const blockedReason =
    ctx.kind === 'ADD_LINE'
      ? 'This line cannot join this award.'
      : ctx.kind === 'QUANTITY_CHANGE'
        ? 'This quantity change is outside the award tolerance.'
        : 'This edit changes what was awarded.';

  const blockedDetail =
    ctx.kind === 'ADD_LINE'
      ? `An award line must trace to a bid, and "${ctx.itemDescription}" was never quoted in this event. `
        + 'Adding it here would create an award line with nothing behind it, which no screen in this product offers.'
      : ctx.kind === 'QUANTITY_CHANGE'
        ? `The awarded quantity for "${ctx.itemDescription}" can move within the configured tolerance and no further. `
          + 'Beyond it, the price the supplier bid no longer stands against the quantity being ordered.'
        : `Changing "${ctx.itemDescription}" after the award recommendation alters what the bidders competed for, `
          + 'so it cannot be edited in place on this event.';

  const contract = ctx.contract;
  const covers = contract !== null
    && contract.categoryScope.includes(ctx.itemCategory)
    && contract.expiresAt > Date.now();
  const remaining = contract ? contract.ceilingValue - contract.committedValue : 0;
  const absorbs = covers && remaining >= ctx.itemValue;

  const destinations: ScopeDestination[] = [];

  destinations.push({
    id: 'NEW_EVENT',
    title: 'Create a new sourcing event',
    consequence: 'Runs a fresh competition for this line; it is linked to this event as its parent and the bidder list is pre-filled from this event\'s shortlist.',
    recommended: false,
    recommendedBecause: null,
    detail: `Pre-filled with "${ctx.itemDescription}", linked by parent_event_id, shortlist carried over. Pack 04's wizard opens with all three already set.`,
    headroom: null,
  });

  if (contract && covers) {
    destinations.push({
      id: 'CALL_OFF',
      title: `Call off against ${contract.contractNumber}`,
      consequence: absorbs
        ? `Orders against the rate contract this award created — no new competition, and the ceiling absorbs it.`
        : 'Would breach the contract ceiling, so this is not a legitimate destination for this line.',
      recommended: false,
      recommendedBecause: null,
      detail: absorbs
        ? `${contract.supplierName} · category scope covers ${ctx.itemCategory} · expires ${new Date(contract.expiresAt).toLocaleDateString()}.`
        : `The remaining headroom is short by ${Math.round(ctx.itemValue - remaining).toLocaleString()} ${contract.currency}. Offered as a new sourcing event instead.`,
      headroom: { ceiling: contract.ceilingValue, committed: contract.committedValue, remaining },
    });
  }

  if (responsesStillOpen) {
    destinations.push({
      id: 'CORRIGENDUM',
      title: 'Amend before responses close',
      consequence: 'Issues a corrigendum on the live event, re-notifies every invited bidder and extends the deadline. This is Pack 05\'s flow, not this panel\'s.',
      recommended: false,
      recommendedBecause: null,
      detail: 'Available only while the event is still taking responses.',
      headroom: null,
    });
  }

  // The recommendation, when the tenant wants one.
  const recommendedId: ScopeDestinationId | null =
    responsesStillOpen ? 'CORRIGENDUM'
    : absorbs ? 'CALL_OFF'
    : 'NEW_EVENT';

  const because =
    recommendedId === 'CORRIGENDUM' ? 'The event has not closed responses, so the cheapest legitimate route is still open.'
    : recommendedId === 'CALL_OFF' ? `The award established a rate contract whose scope covers ${ctx.itemCategory} and whose remaining ceiling absorbs this line.`
    : 'No contract covers this line and the event has closed, so a fresh competition is the only route that produces a bid to trace to.';

  const withRecommendation = destinations.map((d) =>
    settings.od06Routing !== 'MANUAL' && d.id === recommendedId
      ? { ...d, recommended: true, recommendedBecause: because }
      : d,
  );

  return {
    blockedReason,
    blockedDetail,
    destinations: withRecommendation,
    mode: settings.od06Routing,
    preselected: settings.od06Routing === 'AUTOMATIC' ? recommendedId : null,
  };
}

// ---------------------------------------------------------------------------
// Award-quantity adjustment within tolerance — Deliverable 8, OD-05
// ---------------------------------------------------------------------------

export interface QuantityAdjustmentInput {
  awardedQuantity: number;
  proposedQuantity: number;
  /** From configuration. The bound the input is checked against. */
  tolerancePct: number;
  /** The line's total quantity on the event. */
  lineTotalQuantity: number;
  /** The source PR quantity, when `Restrict RFQ PO Quantity` is on. */
  prQuantity: number | null;
  restrictToPrQuantity: boolean;
  unitPrice: number;
}

export interface QuantityAdjustmentResult {
  deltaAbsolute: number;
  deltaPct: number;
  bound: { lower: number; upper: number };
  withinTolerance: boolean;
  valueDelta: number;
  /** Reconciliation failures against the line total and the source PR. */
  breaches: string[];
  blocked: boolean;
  approvalPath: 'LOGGED_NO_APPROVAL' | 'SINGLE_LEVEL' | 'FULL_CHAIN' | 'BLOCKED_ROUTED';
  sentence: string;
}

export function assessQuantityAdjustment(
  input: QuantityAdjustmentInput,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): QuantityAdjustmentResult {
  const deltaAbsolute = input.proposedQuantity - input.awardedQuantity;
  const deltaPct = input.awardedQuantity === 0
    ? (deltaAbsolute === 0 ? 0 : 100)
    : (deltaAbsolute / input.awardedQuantity) * 100;
  const factor = input.tolerancePct / 100;
  // Rounded before flooring and ceiling: 12,000 × 1.1 is 13,200.000000000002 in
  // binary floating point, and a bound of 13,201 is a bound nobody configured.
  const bound = {
    lower: Math.floor(Number((input.awardedQuantity * (1 - factor)).toFixed(6))),
    upper: Math.ceil(Number((input.awardedQuantity * (1 + factor)).toFixed(6))),
  };
  const withinTolerance = Math.abs(deltaPct) <= input.tolerancePct + 1e-9;

  const breaches: string[] = [];
  if (input.proposedQuantity < 0) {
    breaches.push('A negative award quantity is not a quantity.');
  }
  if (input.proposedQuantity > input.lineTotalQuantity) {
    breaches.push(
      `Proposed ${input.proposedQuantity.toLocaleString()} exceeds the line's total quantity of ${input.lineTotalQuantity.toLocaleString()}. `
      + 'An award cannot allocate more than the event asked for.',
    );
  }
  if (input.restrictToPrQuantity && input.prQuantity !== null && input.proposedQuantity > input.prQuantity) {
    breaches.push(
      `Restrict RFQ PO Quantity is on: proposed ${input.proposedQuantity.toLocaleString()} exceeds the source requisition quantity of ${input.prQuantity.toLocaleString()}.`,
    );
  }

  const blocked = !withinTolerance || breaches.length > 0;
  const approvalPath: QuantityAdjustmentResult['approvalPath'] =
    blocked ? 'BLOCKED_ROUTED'
    : settings.od05ToleranceApproval === 'LOG_ONLY' ? 'LOGGED_NO_APPROVAL'
    : settings.od05ToleranceApproval === 'SINGLE_LEVEL' ? 'SINGLE_LEVEL'
    : 'FULL_CHAIN';

  const sentence =
    breaches.length > 0
      ? breaches[0]
      : !withinTolerance
        ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% is outside the configured tolerance of ±${input.tolerancePct}%. `
          + 'This is a scope change, not an adjustment — it routes to the scope-change panel.'
        : approvalPath === 'LOGGED_NO_APPROVAL'
          ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% is within ±${input.tolerancePct}%. The change is logged against the award; no re-approval is required.`
          : approvalPath === 'SINGLE_LEVEL'
            ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% is within ±${input.tolerancePct}%, and this tenant takes one level of approval for any awarded-quantity change.`
            : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% is within ±${input.tolerancePct}%, but this tenant re-enters the full chain for any awarded-quantity change. Approvals already given are superseded.`;

  return {
    deltaAbsolute,
    deltaPct,
    bound,
    withinTolerance,
    valueDelta: deltaAbsolute * input.unitPrice,
    breaches,
    blocked,
    approvalPath,
    sentence,
  };
}

// ---------------------------------------------------------------------------
// Correction after final approval — Deliverable 9, OD-07
// ---------------------------------------------------------------------------

export interface ErrataEligibility {
  allowed: boolean;
  requiresNewRevision: boolean;
  /** Named so a refusal explains itself rather than disabling a control. */
  blockingChanges: FieldChange[];
  explanation: string;
}

export function errataEligibility(
  assessment: ChangeAssessment,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): ErrataEligibility {
  if (assessment.changeClass === 'NONE') {
    return {
      allowed: false, requiresNewRevision: false, blockingChanges: [],
      explanation: 'Nothing has changed. An errata note records a correction, so there is nothing to record.',
    };
  }

  switch (settings.od07PostApproval) {
    case 'ALWAYS_NEW_REVISION':
      return {
        allowed: false, requiresNewRevision: true, blockingChanges: assessment.changes,
        explanation: 'This tenant raises a new revision for every post-approval correction, material or not. '
          + 'The amendment banner will name the chain consequence before you submit.',
      };
    case 'ERRATA_ONLY':
      return assessment.changeClass === 'MATERIAL'
        ? {
            allowed: false, requiresNewRevision: false, blockingChanges: assessment.materialChanges,
            explanation: 'This tenant corrects an approved note by errata only, and errata cannot carry a material change. '
              + 'A material change after approval needs a new event, not a new note.',
          }
        : {
            allowed: true, requiresNewRevision: false, blockingChanges: [],
            explanation: 'Authored as an errata note against the approved revision: reasoned, visible in the revision history and in the audit pack, and no re-approval.',
          };
    case 'MATERIALITY_DECIDES':
    default:
      return assessment.changeClass === 'MATERIAL'
        ? {
            allowed: false, requiresNewRevision: true, blockingChanges: assessment.materialChanges,
            explanation: `An errata note cannot carry this change: ${assessment.materialChanges.map((c) => c.label.toLowerCase()).join(', ')} `
              + 'is on the material list, so the note must re-enter approval as a new revision.',
          }
        : {
            allowed: true, requiresNewRevision: false, blockingChanges: [],
            explanation: 'Non-material. Authored as an errata note against the approved revision: reasoned, visible in the revision history and in the audit pack, and no re-approval.',
          };
  }
}

export function addErratum(nfa: Nfa, erratum: NfaErratum): Nfa {
  return {
    ...nfa,
    revisions: nfa.revisions.map((r) =>
      r.number === erratum.revisionNumber ? { ...r, errata: [...r.errata, erratum] } : r,
    ),
  };
}

// ---------------------------------------------------------------------------
// The diff — Deliverable 2
// ---------------------------------------------------------------------------

export interface DiffSection {
  section: number;
  sectionTitle: string;
  changes: FieldChange[];
}

export interface RevisionDiff {
  from: number;
  to: number;
  /** Sections in NFA order, only those that changed. */
  sections: DiffSection[];
  assessment: ChangeAssessment;
  /** True when the two revisions being compared are not adjacent. */
  spansRevisions: number[];
}

export function diffRevisions(
  revisions: NfaRevision[],
  fromNumber: number,
  toNumber: number,
  settings: OpenDecisionSettings = DEFAULT_OPEN_DECISIONS,
): RevisionDiff | null {
  const from = revisions.find((r) => r.number === fromNumber);
  const to = revisions.find((r) => r.number === toNumber);
  if (!from || !to) return null;

  const assessment = classifyChange(from.document, to.document, settings);
  const bySection = new Map<number, FieldChange[]>();
  for (const change of assessment.changes) {
    const list = bySection.get(change.section) ?? [];
    list.push(change);
    bySection.set(change.section, list);
  }
  const sections: DiffSection[] = NFA_SECTIONS
    .filter((s) => bySection.has(s.n))
    .map((s) => ({ section: s.n, sectionTitle: s.title, changes: bySection.get(s.n)! }));

  const span = revisions
    .filter((r) => r.number >= Math.min(fromNumber, toNumber) && r.number <= Math.max(fromNumber, toNumber))
    .map((r) => r.number);

  return { from: fromNumber, to: toNumber, sections, assessment, spansRevisions: span };
}
