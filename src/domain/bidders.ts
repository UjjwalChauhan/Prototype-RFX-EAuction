/**
 * Who gets invited to bid, and for which part of the demand.
 *
 * A single-category event has one shortlist and the question barely arises. A
 * consolidated event spanning several categories does not: the supplier who
 * prices laptops is not the supplier who prices hydraulic pumps, and inviting
 * one flat list to the whole event either asks suppliers to price things they
 * do not sell or leaves a category with nobody credible in it.
 *
 * So the shortlist is built **per category**. The system proposes from the
 * vendor master — suppliers whose `categoriesServed` covers the category — and
 * the buyer adds anyone else they want, including suppliers who do not serve it
 * on paper. The proposal is a starting point, never a restriction: a buyer who
 * knows the market has reasons the master does not hold.
 *
 * The rule worth enforcing is coverage, not identity. Three bidders is where
 * competitive tension starts; below that a category is a negotiation wearing an
 * RFx costume, and the buyer should be told which category is thin rather than
 * reassured by a healthy total across the event.
 */
import type { Counterparty, Id } from './types';

/** Below this, a category has no real competition. */
export const MIN_BIDDERS_PER_CATEGORY = 3;

/**
 * Whether a supplier serves a category.
 *
 * The super category counts as a match because the vendor master is maintained
 * at a coarser grain than requisitions are raised at — a supplier listed
 * against 'Indirect' genuinely serves 'Facilities & MRO', and refusing that
 * match would propose nobody for most categories.
 */
export function servesCategory(
  counterparty: Counterparty, category: string, superCategory?: string | null,
): boolean {
  return counterparty.categoriesServed.some(
    (served) => served === category || (!!superCategory && served === superCategory),
  );
}

/**
 * Rank suppliers for a category.
 *
 * Onboarding and performance are deliberately separate ratings on the master,
 * so ranking uses both rather than inventing a blend: a supplier with real
 * delivery history outranks one without, and among those a stronger compliance
 * standing wins. Provisional suppliers rank last because they can bid but
 * cannot be awarded — proposing one above a supplier who can take the contract
 * would be proposing a dead end.
 */
export function rankForCategory(counterparties: Counterparty[]): Counterparty[] {
  return [...counterparties].sort((a, b) => {
    if (a.isProvisional !== b.isProvisional) return a.isProvisional ? 1 : -1;
    const history = (b.performanceRating > 0 ? 1 : 0) - (a.performanceRating > 0 ? 1 : 0);
    if (history !== 0) return history;
    if (b.performanceRating !== a.performanceRating) return b.performanceRating - a.performanceRating;
    if (b.onboardingRating !== a.onboardingRating) return b.onboardingRating - a.onboardingRating;
    return a.name.localeCompare(b.name);
  });
}

export interface BidderSuggestion {
  /** Suppliers the master says serve this category, best first. */
  suggested: Counterparty[];
  /** Everyone else, available for the buyer to add anyway. */
  others: Counterparty[];
}

export function suggestBidders(
  counterparties: Counterparty[], category: string, superCategory?: string | null,
): BidderSuggestion {
  const suggested: Counterparty[] = [];
  const others: Counterparty[] = [];
  for (const counterparty of counterparties) {
    (servesCategory(counterparty, category, superCategory) ? suggested : others)
      .push(counterparty);
  }
  return { suggested: rankForCategory(suggested), others: rankForCategory(others) };
}

/**
 * The opening shortlist for a category: the strongest suppliers that serve it,
 * capped so the buyer starts from a real shortlist rather than the whole
 * master. Provisional suppliers are never auto-selected — inviting a supplier
 * who cannot be awarded is a decision, not a default.
 */
export function defaultShortlist(
  counterparties: Counterparty[],
  category: string,
  superCategory?: string | null,
  size = MIN_BIDDERS_PER_CATEGORY,
): Id[] {
  return suggestBidders(counterparties, category, superCategory)
    .suggested.filter((c) => !c.isProvisional)
    .slice(0, size)
    .map((c) => c.id);
}

export interface CoverageIssue {
  category: string;
  tone: 'success' | 'warning' | 'error';
  message: string;
  blocking?: boolean;
}

/**
 * Whether each category has enough bidders to be competitive.
 *
 * Reported per category rather than per event, because a total that looks
 * healthy can hide a category with one supplier in it — which is the failure
 * this whole screen exists to prevent.
 */
export function validateCoverage(
  groups: { category: string; bidderIds: Id[] }[],
  counterparties: Counterparty[],
): CoverageIssue[] {
  const byId = new Map(counterparties.map((c) => [c.id, c]));
  return groups.map(({ category, bidderIds }) => {
    if (bidderIds.length === 0) {
      return {
        category,
        tone: 'error' as const,
        blocking: true,
        message: `No bidders invited for ${category} — those lines would go out with nobody to price them.`,
      };
    }
    const awardable = bidderIds.filter((id) => byId.get(id)?.isProvisional === false);
    if (awardable.length === 0) {
      return {
        category,
        tone: 'error' as const,
        blocking: true,
        message: `Every ${category} bidder is provisional. They can bid, but none can be awarded until onboarding completes.`,
      };
    }
    if (bidderIds.length < MIN_BIDDERS_PER_CATEGORY) {
      return {
        category,
        tone: 'warning' as const,
        message: `Only ${bidderIds.length} bidder${bidderIds.length === 1 ? '' : 's'} for ${category} — fewer than ${MIN_BIDDERS_PER_CATEGORY} yields no real competition on those lines.`,
      };
    }
    return {
      category,
      tone: 'success' as const,
      message: `${category} — ${bidderIds.length} bidders invited${awardable.length < bidderIds.length ? `, ${bidderIds.length - awardable.length} provisional` : ''}`,
    };
  });
}

/**
 * The shortlist, read back out of the per-line invitations.
 *
 * Invitations are recorded line by line, because that is the grain the buyer
 * actually works at — one vendor prices the laptops and the monitors but not
 * the network switch. Everything downstream still wants the shortlist per
 * category, so it is derived here rather than kept as a second, drifting copy.
 */
export function biddersByCategory(
  lines: { id: Id; category: string }[],
  invitedByLine: Record<string, Id[]>,
): Record<string, Id[]> {
  const byCategory: Record<string, Id[]> = {};
  for (const line of lines) {
    const list = byCategory[line.category] ?? (byCategory[line.category] = []);
    for (const id of invitedByLine[line.id] ?? []) {
      if (!list.includes(id)) list.push(id);
    }
  }
  return byCategory;
}

export interface LineCoverage {
  id: Id;
  itemCode: string;
  description: string;
  invitedIds: Id[];
}

/** Lists up to three codes, then says how many more there are. */
function listCodes(codes: string[]): string {
  if (codes.length <= 3) {
    return codes.length < 2 ? codes.join('') : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
  }
  return `${codes.slice(0, 3).join(', ')} and ${codes.length - 3} more`;
}

/**
 * Whether every line has somebody to price it.
 *
 * Coverage per category is not enough once vendors are invited line by line:
 * a category can hold four vendors and still contain one line nobody was
 * ticked against, which is the line that goes out and comes back empty. So the
 * check runs at the grain the invitation was made at.
 */
export function validateLineCoverage(
  lines: LineCoverage[],
  counterparties: Counterparty[],
): CoverageIssue[] {
  const byId = new Map(counterparties.map((c) => [c.id, c]));
  const issues: CoverageIssue[] = [];

  const bare = lines.filter((l) => l.invitedIds.length === 0);
  if (bare.length > 0) {
    const one = bare.length === 1;
    issues.push({
      category: '',
      tone: 'error',
      blocking: true,
      message: one
        ? `${bare[0].itemCode} ${bare[0].description} has no vendor invited — it would go out with nobody to price it.`
        : `${listCodes(bare.map((l) => l.itemCode))} have no vendor invited — they would go out with nobody to price them.`,
    });
  }

  const single = lines.filter((l) => l.invitedIds.length === 1);
  if (single.length > 0) {
    issues.push({
      category: '',
      tone: 'warning',
      message: `${listCodes(single.map((l) => l.itemCode))} ${single.length === 1 ? 'has' : 'have'} a single bidder each — one vendor per line, no competition on price.`,
    });
  }

  // A line everybody on it is provisional on is a line that can be bid and
  // cannot be awarded. It is not the same failure as an empty line, so it is
  // reported separately rather than folded into the count above.
  const unawardable = lines.filter(
    (l) => l.invitedIds.length > 0
      && l.invitedIds.every((id) => byId.get(id)?.isProvisional !== false),
  );
  if (unawardable.length > 0) {
    issues.push({
      category: '',
      tone: 'error',
      blocking: true,
      message: `Every vendor on ${listCodes(unawardable.map((l) => l.itemCode))} is provisional — those lines can be bid, but none of the bids could be awarded.`,
    });
  }

  return issues;
}

/**
 * The event's vendor roster, in one line for the readiness rail — and a
 * separate warning for anyone sitting on the event without a line to price,
 * since they would be published as an invitation to nothing.
 */
export function validateRoster(
  vendorIds: Id[],
  invitedIds: Id[],
  counterparties: Counterparty[],
): CoverageIssue[] {
  const byId = new Map(counterparties.map((c) => [c.id, c]));
  if (vendorIds.length === 0) {
    return [{
      category: '',
      tone: 'error',
      blocking: true,
      message: 'No vendors on the event — add the suppliers who should price these lines.',
    }];
  }
  const provisional = vendorIds.filter((id) => byId.get(id)?.isProvisional === true);
  const issues: CoverageIssue[] = [{
    category: '',
    tone: 'success',
    message: `${vendorIds.length} vendor${vendorIds.length === 1 ? '' : 's'} on the event · ${vendorIds.length - provisional.length} onboarded${provisional.length > 0 ? `, ${provisional.length} provisional` : ''}`,
  }];
  for (const id of provisional) {
    issues.push({
      category: '',
      tone: 'warning',
      message: `${byId.get(id)?.name ?? id} is provisional — they can be invited now, but a bid from them cannot be awarded until onboarding completes.`,
    });
  }
  const idle = vendorIds.filter((id) => !invitedIds.includes(id));
  if (idle.length > 0) {
    issues.push({
      category: '',
      tone: 'warning',
      message: `${idle.map((id) => byId.get(id)?.name ?? id).join(', ')} ${idle.length === 1 ? 'is' : 'are'} on the event but invited to no line, and would be published as an invitation to nothing.`,
    });
  }
  return issues;
}
