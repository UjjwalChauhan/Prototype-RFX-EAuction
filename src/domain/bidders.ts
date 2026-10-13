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
