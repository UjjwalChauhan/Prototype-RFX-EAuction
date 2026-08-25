/**
 * State machines. Only the words in these maps are valid statuses anywhere in
 * the UI — no screen invents a status.
 */
import type {
  AuctionStatus, EnvelopeStatus, EventStatus, InvitationStatus,
  ParticipationStatus, Stage,
} from './types';

export interface StatusPresentation {
  label: string;
  /** Colour is never the only carrier of meaning; the icon travels with it. */
  icon: string;
  fg: string;
  bg: string;
}

export const EVENT_STATUS_PRESENTATION: Record<EventStatus, StatusPresentation> = {
  DRAFT: { label: 'Draft', icon: '○', fg: '#374151', bg: '#F1F2F4' },
  PENDING_APPROVAL: { label: 'Pending Approval', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  APPROVED: { label: 'Approved', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  PUBLISHED: { label: 'Published', icon: '●', fg: '#0369A1', bg: '#E0F2FE' },
  OPEN: { label: 'Open', icon: '●', fg: '#0369A1', bg: '#E0F2FE' },
  RESPONSES_CLOSED: { label: 'Responses Closed', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  UNDER_EVALUATION: { label: 'Under Evaluation', icon: '◆', fg: '#6D28D9', bg: '#F3E8FF' },
  IN_NEGOTIATION: { label: 'In Negotiation', icon: '◇', fg: '#6D28D9', bg: '#F3E8FF' },
  AUCTION_SCHEDULED: { label: 'Auction Scheduled', icon: '◷', fg: '#0369A1', bg: '#E0F2FE' },
  AUCTION_LIVE: { label: 'Auction Live', icon: '●', fg: '#B91C1C', bg: '#FEE2E2' },
  AUCTION_CLOSED: { label: 'Auction Closed', icon: '◼', fg: '#374151', bg: '#F1F2F4' },
  AWARD_RECOMMENDED: { label: 'Award Recommended', icon: '◆', fg: '#6D28D9', bg: '#F3E8FF' },
  PENDING_AWARD_APPROVAL: { label: 'Pending Award Approval', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  AWARD_PENDING_ONBOARDING: { label: 'Award Pending Onboarding', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  AWARDED: { label: 'Awarded', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  CLOSED: { label: 'Closed', icon: '✓', fg: '#374151', bg: '#F1F2F4' },
  CANCELLED: { label: 'Cancelled', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
  ON_HOLD: { label: 'On Hold', icon: '‖', fg: '#B45309', bg: '#FEF3C7' },
};

export const AUCTION_STATUS_PRESENTATION: Record<AuctionStatus, StatusPresentation> = {
  DRAFT: { label: 'Draft', icon: '○', fg: '#374151', bg: '#F1F2F4' },
  CONFIGURED: { label: 'Configured', icon: '◑', fg: '#374151', bg: '#F1F2F4' },
  VALIDATED: { label: 'Validated', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  SCHEDULED: { label: 'Scheduled', icon: '◷', fg: '#0369A1', bg: '#E0F2FE' },
  LOBBY_OPEN: { label: 'Lobby Open', icon: '◈', fg: '#0369A1', bg: '#E0F2FE' },
  LIVE: { label: 'Live', icon: '●', fg: '#B91C1C', bg: '#FEE2E2' },
  PAUSED: { label: 'Paused', icon: '‖', fg: '#B45309', bg: '#FEF3C7' },
  EXTENDED: { label: 'Extended', icon: '⟳', fg: '#B91C1C', bg: '#FEE2E2' },
  CLOSED: { label: 'Closed', icon: '◼', fg: '#374151', bg: '#F1F2F4' },
  RESULTS_PUBLISHED: { label: 'Results Published', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  CANCELLED: { label: 'Cancelled', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
  ABORTED: { label: 'Aborted', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
};

export const INVITATION_STATUS_PRESENTATION: Record<InvitationStatus, StatusPresentation> = {
  SENT: { label: 'Invited', icon: '✉', fg: '#374151', bg: '#F1F2F4' },
  VIEWED: { label: 'Viewed', icon: '◔', fg: '#0369A1', bg: '#E0F2FE' },
  ACCEPTED: { label: 'Accepted', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  DECLINED: { label: 'Declined', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
  EXPIRED: { label: 'Expired', icon: '◷', fg: '#B45309', bg: '#FEF3C7' },
  REVOKED: { label: 'Revoked', icon: '⊘', fg: '#B91C1C', bg: '#FEE2E2' },
};

export const PARTICIPATION_STATUS_PRESENTATION: Record<ParticipationStatus, StatusPresentation> = {
  NOT_STARTED: { label: 'Not started', icon: '○', fg: '#9CA3AF', bg: '#F1F2F4' },
  IN_PROGRESS: { label: 'In progress', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  SUBMITTED: { label: 'Submitted', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  WITHDRAWN: { label: 'Withdrawn', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
  REGISTERED: { label: 'Registered', icon: '◔', fg: '#374151', bg: '#F1F2F4' },
  JOINED: { label: 'Joined', icon: '◈', fg: '#0369A1', bg: '#E0F2FE' },
  BIDDING: { label: 'Bidding', icon: '●', fg: '#15803D', bg: '#DCFCE7' },
  IDLE: { label: 'Idle', icon: '◷', fg: '#B45309', bg: '#FEF3C7' },
  DROPPED_OUT: { label: 'Dropped out', icon: '↓', fg: '#B91C1C', bg: '#FEE2E2' },
  ELIMINATED: { label: 'Eliminated', icon: '✕', fg: '#B91C1C', bg: '#FEE2E2' },
};

export const ENVELOPE_STATUS_PRESENTATION: Record<EnvelopeStatus, StatusPresentation> = {
  NOT_STARTED: { label: 'Not started', icon: '○', fg: '#9CA3AF', bg: '#F1F2F4' },
  DRAFT: { label: 'Draft', icon: '◐', fg: '#B45309', bg: '#FEF3C7' },
  SUBMITTED: { label: 'Submitted', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
  SEALED: { label: 'Sealed', icon: '🔒', fg: '#374151', bg: '#F1F2F4' },
  UNLOCKED: { label: 'Unlocked', icon: '🔓', fg: '#0369A1', bg: '#E0F2FE' },
  UNDER_EVALUATION: { label: 'Under evaluation', icon: '◆', fg: '#6D28D9', bg: '#F3E8FF' },
  EVALUATED: { label: 'Evaluated', icon: '✓', fg: '#15803D', bg: '#DCFCE7' },
};

/** Legal transitions. CANCELLED and ON_HOLD are reachable from most states. */
const EVENT_TRANSITIONS: Partial<Record<EventStatus, EventStatus[]>> = {
  DRAFT: ['PENDING_APPROVAL', 'PUBLISHED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['OPEN', 'CANCELLED'],
  OPEN: ['RESPONSES_CLOSED', 'CANCELLED'],
  RESPONSES_CLOSED: ['UNDER_EVALUATION', 'CANCELLED'],
  UNDER_EVALUATION: ['IN_NEGOTIATION', 'AUCTION_SCHEDULED', 'AWARD_RECOMMENDED', 'CANCELLED'],
  IN_NEGOTIATION: ['AUCTION_SCHEDULED', 'AWARD_RECOMMENDED', 'IN_NEGOTIATION', 'CANCELLED'],
  AUCTION_SCHEDULED: ['AUCTION_LIVE', 'CANCELLED'],
  AUCTION_LIVE: ['AUCTION_CLOSED', 'CANCELLED'],
  AUCTION_CLOSED: ['AWARD_RECOMMENDED', 'IN_NEGOTIATION', 'CANCELLED'],
  AWARD_RECOMMENDED: ['PENDING_AWARD_APPROVAL', 'UNDER_EVALUATION', 'CANCELLED'],
  PENDING_AWARD_APPROVAL: ['AWARDED', 'AWARD_PENDING_ONBOARDING', 'AWARD_RECOMMENDED', 'CANCELLED'],
  AWARD_PENDING_ONBOARDING: ['AWARDED', 'CANCELLED'],
  AWARDED: ['CLOSED'],
  ON_HOLD: [],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  if (to === 'ON_HOLD') return from !== 'CLOSED' && from !== 'CANCELLED';
  if (from === 'ON_HOLD') return true; // ON_HOLD is reversible.
  return (EVENT_TRANSITIONS[from] ?? []).includes(to);
}

export function nextEventStatuses(from: EventStatus): EventStatus[] {
  const next = [...(EVENT_TRANSITIONS[from] ?? [])];
  if (from !== 'CLOSED' && from !== 'CANCELLED' && from !== 'ON_HOLD') next.push('ON_HOLD');
  return next;
}

/** Statuses whose transition requires a mandatory reason. */
export const REASON_REQUIRED: EventStatus[] = ['CANCELLED'];

export function stageForStatus(status: EventStatus): Stage {
  switch (status) {
    case 'DRAFT':
    case 'PENDING_APPROVAL':
    case 'APPROVED':
      return 'INTAKE';
    case 'PUBLISHED':
    case 'OPEN':
    case 'RESPONSES_CLOSED':
      return 'RFQ';
    case 'UNDER_EVALUATION':
      return 'EVALUATION';
    case 'IN_NEGOTIATION':
      return 'NEGOTIATION';
    case 'AUCTION_SCHEDULED':
    case 'AUCTION_LIVE':
    case 'AUCTION_CLOSED':
      return 'AUCTION';
    case 'PENDING_AWARD_APPROVAL':
    case 'AWARD_PENDING_ONBOARDING':
      return 'APPROVAL';
    default:
      return 'AWARD';
  }
}
