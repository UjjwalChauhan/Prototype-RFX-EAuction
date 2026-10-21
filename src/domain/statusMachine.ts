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
  DRAFT: { label: 'Draft', icon: '○', fg: '#33333B', bg: '#F1F1F4' },
  PENDING_APPROVAL: { label: 'Pending Approval', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  APPROVED: { label: 'Approved', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  PUBLISHED: { label: 'Published', icon: '●', fg: '#1D4FD8', bg: '#EAF1FE' },
  OPEN: { label: 'Open', icon: '●', fg: '#1D4FD8', bg: '#EAF1FE' },
  RESPONSES_CLOSED: { label: 'Responses Closed', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  UNDER_EVALUATION: { label: 'Under Evaluation', icon: '◆', fg: '#60468A', bg: '#EFEAF7' },
  IN_NEGOTIATION: { label: 'In Negotiation', icon: '◇', fg: '#60468A', bg: '#EFEAF7' },
  AUCTION_SCHEDULED: { label: 'Auction Scheduled', icon: '◷', fg: '#1D4FD8', bg: '#EAF1FE' },
  AUCTION_LIVE: { label: 'Auction Live', icon: '●', fg: '#C13238', bg: '#FDECEC' },
  AUCTION_CLOSED: { label: 'Auction Closed', icon: '◼', fg: '#33333B', bg: '#F1F1F4' },
  AWARD_RECOMMENDED: { label: 'Award Recommended', icon: '◆', fg: '#60468A', bg: '#EFEAF7' },
  PENDING_AWARD_APPROVAL: { label: 'Pending Award Approval', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  AWARD_PENDING_ONBOARDING: { label: 'Award Pending Onboarding', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  AWARDED: { label: 'Awarded', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  CLOSED: { label: 'Closed', icon: '✓', fg: '#33333B', bg: '#F1F1F4' },
  CANCELLED: { label: 'Cancelled', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
  ON_HOLD: { label: 'On Hold', icon: '‖', fg: '#8A6100', bg: '#FFF6E0' },
};

export const AUCTION_STATUS_PRESENTATION: Record<AuctionStatus, StatusPresentation> = {
  DRAFT: { label: 'Draft', icon: '○', fg: '#33333B', bg: '#F1F1F4' },
  CONFIGURED: { label: 'Configured', icon: '◑', fg: '#33333B', bg: '#F1F1F4' },
  VALIDATED: { label: 'Validated', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  SCHEDULED: { label: 'Scheduled', icon: '◷', fg: '#1D4FD8', bg: '#EAF1FE' },
  LOBBY_OPEN: { label: 'Lobby Open', icon: '◈', fg: '#1D4FD8', bg: '#EAF1FE' },
  LIVE: { label: 'Live', icon: '●', fg: '#C13238', bg: '#FDECEC' },
  PAUSED: { label: 'Paused', icon: '‖', fg: '#8A6100', bg: '#FFF6E0' },
  EXTENDED: { label: 'Extended', icon: '⟳', fg: '#C13238', bg: '#FDECEC' },
  CLOSED: { label: 'Closed', icon: '◼', fg: '#33333B', bg: '#F1F1F4' },
  RESULTS_PUBLISHED: { label: 'Results Published', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  CANCELLED: { label: 'Cancelled', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
  ABORTED: { label: 'Aborted', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
};

export const INVITATION_STATUS_PRESENTATION: Record<InvitationStatus, StatusPresentation> = {
  SENT: { label: 'Invited', icon: '✉', fg: '#33333B', bg: '#F1F1F4' },
  VIEWED: { label: 'Viewed', icon: '◔', fg: '#1D4FD8', bg: '#EAF1FE' },
  ACCEPTED: { label: 'Accepted', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  DECLINED: { label: 'Declined', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
  EXPIRED: { label: 'Expired', icon: '◷', fg: '#8A6100', bg: '#FFF6E0' },
  REVOKED: { label: 'Revoked', icon: '⊘', fg: '#C13238', bg: '#FDECEC' },
};

export const PARTICIPATION_STATUS_PRESENTATION: Record<ParticipationStatus, StatusPresentation> = {
  NOT_STARTED: { label: 'Not started', icon: '○', fg: '#9A9AA6', bg: '#F1F1F4' },
  IN_PROGRESS: { label: 'In progress', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  SUBMITTED: { label: 'Submitted', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  WITHDRAWN: { label: 'Withdrawn', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
  REGISTERED: { label: 'Registered', icon: '◔', fg: '#33333B', bg: '#F1F1F4' },
  JOINED: { label: 'Joined', icon: '◈', fg: '#1D4FD8', bg: '#EAF1FE' },
  BIDDING: { label: 'Bidding', icon: '●', fg: '#227A4A', bg: '#E6F6EE' },
  IDLE: { label: 'Idle', icon: '◷', fg: '#8A6100', bg: '#FFF6E0' },
  DROPPED_OUT: { label: 'Dropped out', icon: '↓', fg: '#C13238', bg: '#FDECEC' },
  ELIMINATED: { label: 'Eliminated', icon: '✕', fg: '#C13238', bg: '#FDECEC' },
};

export const ENVELOPE_STATUS_PRESENTATION: Record<EnvelopeStatus, StatusPresentation> = {
  NOT_STARTED: { label: 'Not started', icon: '○', fg: '#9A9AA6', bg: '#F1F1F4' },
  DRAFT: { label: 'Draft', icon: '◐', fg: '#8A6100', bg: '#FFF6E0' },
  SUBMITTED: { label: 'Submitted', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
  SEALED: { label: 'Sealed', icon: '🔒', fg: '#33333B', bg: '#F1F1F4' },
  UNLOCKED: { label: 'Unlocked', icon: '🔓', fg: '#1D4FD8', bg: '#EAF1FE' },
  UNDER_EVALUATION: { label: 'Under evaluation', icon: '◆', fg: '#60468A', bg: '#EFEAF7' },
  EVALUATED: { label: 'Evaluated', icon: '✓', fg: '#227A4A', bg: '#E6F6EE' },
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
