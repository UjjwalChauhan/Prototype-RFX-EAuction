/**
 * Roles, permissions and the hard separation rules.
 *
 * Permissions are scoped: a user holds a role globally, within a business
 * unit, within a category, or on a specific event.
 */
import type { EnvelopeMode, Id, Permission, User } from './types';

export const ADMIN_PERSONAS = [
  'Platform Administrator',
  'Category Manager / Buyer',
  'Sourcing Analyst',
  'Technical Evaluator',
  'Commercial Evaluator',
  'Auction Controller',
  'Approver (DoA holder)',
  'Observer / Stakeholder',
] as const;

export const PORTAL_PERSONAS = [
  'Supplier Bid Owner',
  'Supplier Technical Responder',
  'Supplier Auction Bidder',
  'Supplier Administrator',
  'Customer Bidder (sell-side)',
] as const;

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'Platform Administrator': ['configure_tenant', 'create_event', 'publish_event', 'manage_bidders'],
  'Category Manager / Buyer': ['create_event', 'publish_event', 'manage_bidders', 'view_commercial', 'run_auction', 'recommend_award'],
  'Sourcing Analyst': ['create_event', 'manage_bidders', 'view_commercial'],
  'Technical Evaluator': ['score_technical'],
  'Commercial Evaluator': ['view_commercial', 'unlock_commercial'],
  'Auction Controller': ['run_auction', 'control_auction'],
  'Approver (DoA holder)': ['approve_at_level'],
  'Observer / Stakeholder': ['view_only'],
};

export function hasPermission(user: User, permission: Permission, eventId?: Id): boolean {
  if (!user.permissions.includes(permission)) return false;
  if (user.scopeType === 'GLOBAL') return true;
  if (user.scopeType === 'EVENT') return user.scopeId === eventId;
  return true;
}

export interface SeparationBreach {
  rule: string;
  message: string;
}

/**
 * The three hard separation rules. Not configurable.
 *   1. score_technical and view_commercial cannot co-exist under TWO_ENVELOPE.
 *   2. recommend_award and the final approve_at_level cannot be one user.
 *   3. bid_on_behalf always writes a visible audit marker.
 */
export function checkSeparation(
  permissions: Permission[],
  envelopeMode: EnvelopeMode,
): SeparationBreach[] {
  const breaches: SeparationBreach[] = [];
  if (
    envelopeMode === 'TWO_ENVELOPE' &&
    permissions.includes('score_technical') &&
    permissions.includes('view_commercial')
  ) {
    breaches.push({
      rule: 'envelope_separation',
      message: 'A user who scores the technical envelope cannot hold view_commercial on the same event while two-envelope mode is on.',
    });
  }
  if (permissions.includes('recommend_award') && permissions.includes('approve_at_level')) {
    breaches.push({
      rule: 'award_separation',
      message: 'recommend_award and the final approve_at_level cannot be held by the same user on the same event.',
    });
  }
  return breaches;
}

/** bid_on_behalf always writes a marker visible to the supplier and to audit. */
export const BID_ON_BEHALF_MARKER = 'Placed by the buying organisation on your behalf';
