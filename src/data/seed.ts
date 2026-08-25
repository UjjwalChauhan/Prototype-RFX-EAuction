/**
 * Seed data.
 *
 * Values, names and figures are lifted from the Build Pack design files so the
 * running app matches the delivered screens: RFQ-2026-0142 "Office Supplies
 * Annual Contract", the four bidders A–D, the $150,000 start price and the
 * three-lot staggered schedule.
 */
import type {
  Auction, AuctionLot, Bid, Clarification, ConfigSetting, CostComponent, Counterparty,
  DoARule, EventBidder, LineItem, Lot, NegotiationRound, Question, Questionnaire,
  Response, Score, SourcingEvent, User,
} from '../domain/types';
import { DEFAULT_ANTI_GAMING } from '../domain/auctionEngine';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A fixed base so the seed is deterministic; the live clock moves from here. */
export const SEED_NOW = Date.now();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const USERS: User[] = [
  {
    id: 'user-ar', name: 'A. Rahman', initials: 'AR', email: 'a.rahman@example.com',
    role: 'Category Manager / Buyer',
    permissions: ['create_event', 'publish_event', 'manage_bidders', 'view_commercial', 'run_auction', 'control_auction', 'recommend_award', 'unlock_commercial'],
    scopeType: 'GLOBAL', scopeId: null,
  },
  {
    id: 'user-js', name: 'J. Silva', initials: 'JS', email: 'j.silva@example.com',
    role: 'Technical Evaluator',
    // No view_commercial: the envelope separation rule forbids holding both.
    permissions: ['score_technical'],
    scopeType: 'GLOBAL', scopeId: null,
  },
  {
    id: 'user-mp', name: 'M. Prasad', initials: 'MP', email: 'm.prasad@example.com',
    role: 'Approver (DoA holder)',
    permissions: ['approve_at_level'],
    scopeType: 'GLOBAL', scopeId: null,
  },
  {
    id: 'user-kt', name: 'K. Tan', initials: 'KT', email: 'k.tan@example.com',
    role: 'Observer / Stakeholder',
    permissions: ['view_only'],
    scopeType: 'GLOBAL', scopeId: null,
  },
];

export const CURRENT_USER = USERS[0];

// ---------------------------------------------------------------------------
// Counterparties
// ---------------------------------------------------------------------------

export const COUNTERPARTIES: Counterparty[] = [
  {
    id: 'cp-abc', name: 'ABC Supplies Co.', onboardingRating: 92, performanceRating: 88,
    categoriesServed: ['Indirect', 'Facilities'], locationsServed: ['Dubai', 'Abu Dhabi'],
    isProvisional: false, contactEmail: 'bids@abcsupplies.example',
  },
  {
    id: 'cp-global', name: 'Global Office Solutions', onboardingRating: 85, performanceRating: 74,
    categoriesServed: ['Indirect', 'IT'], locationsServed: ['Dubai'],
    isProvisional: false, contactEmail: 'tenders@globaloffice.example',
  },
  {
    id: 'cp-prime', name: 'Prime Stationery Ltd.', onboardingRating: 78, performanceRating: 81,
    categoriesServed: ['Indirect'], locationsServed: ['Sharjah', 'Dubai'],
    isProvisional: false, contactEmail: 'sales@primestationery.example',
  },
  {
    id: 'cp-metro', name: 'Metro Business Supplies', onboardingRating: 64, performanceRating: 0,
    categoriesServed: ['Indirect'], locationsServed: ['Dubai'],
    // Invited but not yet on the master: can bid, cannot be awarded.
    isProvisional: true, contactEmail: 'hello@metrosupplies.example',
  },
];

export const COUNTERPARTY_NAMES: Record<string, string> = Object.fromEntries(
  COUNTERPARTIES.map((c) => [c.id, c.name]),
);

// ---------------------------------------------------------------------------
// The primary event — RFQ-2026-0142
// ---------------------------------------------------------------------------

export const PRIMARY_EVENT_ID = 'evt-0142';

export const EVENTS: SourcingEvent[] = [
  {
    id: PRIMARY_EVENT_ID, tenantId: 'tenant-udaan', eventNumber: 'RFQ-2026-0142',
    title: 'Office Supplies Annual Contract',
    description: 'Annual framework for paper, writing instruments and filing across three lots.',
    side: 'BUY', templateId: 'tpl-full-ladder', journeyPattern: 'JP-05',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'USD', estimatedValue: 150_000, ownerId: 'user-ar',
    status: 'AUCTION_LIVE', createdFrom: 'PR', sourceReference: 'PR-2024-0125',
    stagesEnabled: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'TWO_ENVELOPE',
    vendorInputPoints: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
    publishedAt: SEED_NOW - 12 * DAY, closesAt: SEED_NOW + 2 * DAY, awardedAt: null,
    parentEventId: null, version: 3, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-auc-002', tenantId: 'tenant-udaan', eventNumber: 'AUC-2024-002',
    title: 'Office Supplies Q1 Auction',
    description: 'Direct auction from a consolidated requisition.',
    side: 'BUY', templateId: 'tpl-direct', journeyPattern: 'JP-01',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'USD', estimatedValue: 150_000, ownerId: 'user-ar',
    status: 'AUCTION_LIVE', createdFrom: 'PR', sourceReference: 'PR-2024-0131',
    stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'SINGLE',
    vendorInputPoints: ['INTAKE', 'AUCTION'],
    publishedAt: SEED_NOW - 1 * DAY, closesAt: SEED_NOW + 38 * MINUTE, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfp-018', tenantId: 'tenant-udaan', eventNumber: 'RFP-2024-018',
    title: 'IT Hardware Refresh',
    description: 'Two-envelope tender for a 400-seat hardware refresh.',
    side: 'BUY', templateId: 'tpl-two-env', journeyPattern: 'JP-06',
    businessUnit: 'Technology', category: 'IT', project: 'PRJ-Refresh-26', costCentre: 'CC-2200',
    currency: 'USD', estimatedValue: 480_000, ownerId: 'user-js',
    status: 'OPEN', createdFrom: 'INTAKE', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFP', 'EVALUATION', 'AWARD', 'APPROVAL'],
    currentStage: 'RFP', envelopeMode: 'TWO_ENVELOPE',
    vendorInputPoints: ['RFP'],
    publishedAt: SEED_NOW - 5 * DAY, closesAt: SEED_NOW + 18 * HOUR, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfi-005', tenantId: 'tenant-udaan', eventNumber: 'RFI-2024-005',
    title: 'Facilities Management Sounding',
    description: 'Market sounding ahead of a full tender.',
    side: 'BUY', templateId: 'tpl-full-ladder', journeyPattern: 'JP-05',
    businessUnit: 'Corporate Services', category: 'Facilities', project: null, costCentre: 'CC-4100',
    currency: 'USD', estimatedValue: 1_200_000, ownerId: 'user-mp',
    status: 'PUBLISHED', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'RFI', envelopeMode: 'TWO_ENVELOPE',
    vendorInputPoints: ['RFI', 'RFP', 'RFQ', 'AUCTION'],
    publishedAt: SEED_NOW - 2 * DAY, closesAt: SEED_NOW + 6 * DAY, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-sell-003', tenantId: 'tenant-udaan', eventNumber: 'SELL-2024-003',
    title: 'Surplus Fleet Disposal',
    // Sell-side: every comparator inverts. Highest bid wins.
    description: 'Forward auction for 14 surplus light vehicles.',
    side: 'SELL', templateId: 'tpl-disposal', journeyPattern: 'JP-12',
    businessUnit: 'Fleet', category: 'Fleet', project: null, costCentre: 'CC-7700',
    currency: 'USD', estimatedValue: 95_000, ownerId: 'user-kt',
    status: 'AUCTION_SCHEDULED', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'SINGLE',
    vendorInputPoints: ['AUCTION'],
    publishedAt: SEED_NOW - 1 * DAY, closesAt: SEED_NOW + 1 * DAY + 2 * HOUR, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfq-041', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2024-041',
    title: 'Janitorial Supplies',
    description: 'Simple RFQ, five bidders, awaiting award approval.',
    side: 'BUY', templateId: 'tpl-simple-rfq', journeyPattern: 'JP-02',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'USD', estimatedValue: 34_200, ownerId: 'user-ar',
    status: 'PENDING_AWARD_APPROVAL', createdFrom: 'PR', sourceReference: 'PR-2024-0098',
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
    currentStage: 'APPROVAL', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ'],
    publishedAt: SEED_NOW - 14 * DAY, closesAt: SEED_NOW - 4 * DAY, awardedAt: null,
    parentEventId: null, version: 2, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfp-012', tenantId: 'tenant-udaan', eventNumber: 'RFP-2024-012',
    title: 'Marketing Agency Retainer',
    description: 'Full ladder, currently in negotiation round 2.',
    side: 'BUY', templateId: 'tpl-full-ladder', journeyPattern: 'JP-04',
    businessUnit: 'Marketing', category: 'Services', project: null, costCentre: 'CC-3300',
    currency: 'USD', estimatedValue: 260_000, ownerId: 'user-mp',
    status: 'IN_NEGOTIATION', createdFrom: 'INTAKE', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'NEGOTIATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'NEGOTIATION', envelopeMode: 'TWO_ENVELOPE',
    vendorInputPoints: ['RFQ', 'NEGOTIATION', 'AUCTION'],
    publishedAt: SEED_NOW - 21 * DAY, closesAt: SEED_NOW + 3 * DAY, awardedAt: null,
    parentEventId: null, version: 4, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfq-039', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2024-039',
    title: 'Printer Toner Framework',
    description: 'Draft — not yet published.',
    side: 'BUY', templateId: 'tpl-rfq-auction', journeyPattern: 'JP-03',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'USD', estimatedValue: 28_000, ownerId: 'user-js',
    status: 'DRAFT', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'INTAKE', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ', 'AUCTION'],
    publishedAt: null, closesAt: null, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfq-044', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2024-044',
    title: 'Catering Supplies',
    description: 'Awarded; supplier onboarding in progress.',
    side: 'BUY', templateId: 'tpl-simple-rfq', journeyPattern: 'JP-02',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'USD', estimatedValue: 18_900, ownerId: 'user-ar',
    status: 'AWARDED', createdFrom: 'PR', sourceReference: 'PR-2024-0077',
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
    currentStage: 'AWARD', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ'],
    publishedAt: SEED_NOW - 30 * DAY, closesAt: SEED_NOW - 20 * DAY, awardedAt: SEED_NOW - 2 * DAY,
    parentEventId: null, version: 2, configSnapshotAtPublish: null,
  },
];

// ---------------------------------------------------------------------------
// Lots and line items — three lots, staggered
// ---------------------------------------------------------------------------

export const LOTS: Lot[] = [
  {
    id: 'lot-1', eventId: PRIMARY_EVENT_ID, lotNumber: 1, name: 'Lot 1 · Paper',
    description: 'A4 and A3 copier paper, annual volume.', sequence: 1,
    biddingOpenAt: SEED_NOW - 15 * MINUTE, biddingCloseAt: SEED_NOW + 12 * MINUTE + 30_000,
    awardMode: 'SINGLE', minSuppliers: 1, maxSuppliers: 2,
    // Internal-only. Reserve constrains the award; target drives feedback.
    reservePrice: 148_000, targetPrice: 138_000,
    ceilingPrice: 160_000, floorPrice: 100_000,
    status: 'LOT_OPEN',
  },
  {
    id: 'lot-2', eventId: PRIMARY_EVENT_ID, lotNumber: 2, name: 'Lot 2 · Writing',
    description: 'Pens, pencils, markers and refills.', sequence: 2,
    biddingOpenAt: SEED_NOW + 5 * MINUTE, biddingCloseAt: SEED_NOW + 25 * MINUTE,
    awardMode: 'SINGLE', minSuppliers: 1, maxSuppliers: 1,
    reservePrice: 24_500, targetPrice: 21_000,
    ceilingPrice: 26_000, floorPrice: 15_000,
    status: 'LOT_PENDING',
  },
  {
    id: 'lot-3', eventId: PRIMARY_EVENT_ID, lotNumber: 3, name: 'Lot 3 · Filing',
    description: 'Folders, binders, archive boxes.', sequence: 3,
    biddingOpenAt: SEED_NOW + 5 * MINUTE, biddingCloseAt: SEED_NOW + 36 * MINUTE,
    awardMode: 'SPLIT', minSuppliers: 2, maxSuppliers: 2,
    reservePrice: 15_500, targetPrice: 13_500,
    ceilingPrice: 17_000, floorPrice: 9_000,
    status: 'LOT_PENDING',
  },
];

export const LINE_ITEMS: LineItem[] = [
  {
    id: 'li-1', lotId: 'lot-1', lineNumber: 1, itemCode: 'PPR-A4-80',
    description: 'A4 copier paper, 80gsm, ream of 500',
    specification: 'ISO brightness 96+, FSC certified', quantity: 12_000, uom: 'ream',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 8.67, baselineSource: 'LPP', currency: 'USD',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-01',
  },
  {
    id: 'li-2', lotId: 'lot-1', lineNumber: 2, itemCode: 'PPR-A3-80',
    description: 'A3 copier paper, 80gsm, ream of 500',
    specification: 'ISO brightness 96+, FSC certified', quantity: 1_400, uom: 'ream',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 17.20, baselineSource: 'LPP', currency: 'USD',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-02',
  },
  {
    id: 'li-3', lotId: 'lot-2', lineNumber: 3, itemCode: 'PEN-BLU-BX',
    description: 'Ballpoint pen, blue, box of 50',
    specification: '0.7mm, retractable', quantity: 900, uom: 'box',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 18.50, baselineSource: 'PR', currency: 'USD',
    isOptional: false, allowAlternate: true, sourcePrLineId: 'pr-0125-03',
  },
  {
    id: 'li-4', lotId: 'lot-2', lineNumber: 4, itemCode: 'MKR-ASST',
    description: 'Whiteboard marker, assorted, box of 12',
    specification: 'Chisel tip, low odour', quantity: 620, uom: 'box',
    deliveryLocation: 'Abu Dhabi DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 9.10, baselineSource: 'PR', currency: 'USD',
    isOptional: false, allowAlternate: true, sourcePrLineId: 'pr-0125-04',
  },
  {
    id: 'li-5', lotId: 'lot-3', lineNumber: 5, itemCode: 'FLD-LEV-A4',
    description: 'Lever arch file, A4, 75mm',
    specification: 'Board with PP laminate', quantity: 2_400, uom: 'each',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 3.90, baselineSource: 'SHOULD_COST', currency: 'USD',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-05',
  },
  {
    id: 'li-6', lotId: 'lot-3', lineNumber: 6, itemCode: 'BOX-ARC',
    description: 'Archive box with lid',
    specification: 'Double-wall corrugated', quantity: 1_100, uom: 'each',
    deliveryLocation: 'Sharjah Store', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 4.30, baselineSource: 'SHOULD_COST', currency: 'USD',
    isOptional: true, allowAlternate: false, sourcePrLineId: 'pr-0125-06',
  },
];

// ---------------------------------------------------------------------------
// Bidders — invitation and participation on separate axes
// ---------------------------------------------------------------------------

export const EVENT_BIDDERS: EventBidder[] = [
  {
    id: 'eb-abc', eventId: PRIMARY_EVENT_ID, counterpartyId: 'cp-abc', isProvisional: false,
    invitedAt: SEED_NOW - 12 * DAY, invitationStatus: 'ACCEPTED', declineReason: null,
    ndaAcceptedAt: SEED_NOW - 11 * DAY,
    participationStatus: 'BIDDING', qualificationStatus: 'QUALIFIED', awardStatus: 'NONE',
    qualificationSnapshot: 92, performanceRatingSnapshot: 88,
    bidOnBehalfAllowed: true, maskedLabel: 'Bidder A',
    disqualified: false, disqualificationReason: null,
  },
  {
    id: 'eb-global', eventId: PRIMARY_EVENT_ID, counterpartyId: 'cp-global', isProvisional: false,
    invitedAt: SEED_NOW - 12 * DAY, invitationStatus: 'ACCEPTED', declineReason: null,
    ndaAcceptedAt: SEED_NOW - 10 * DAY,
    participationStatus: 'IDLE', qualificationStatus: 'QUALIFIED', awardStatus: 'NONE',
    qualificationSnapshot: 85, performanceRatingSnapshot: 74,
    bidOnBehalfAllowed: false, maskedLabel: 'Bidder B',
    disqualified: false, disqualificationReason: null,
  },
  {
    id: 'eb-prime', eventId: PRIMARY_EVENT_ID, counterpartyId: 'cp-prime', isProvisional: false,
    invitedAt: SEED_NOW - 12 * DAY, invitationStatus: 'ACCEPTED', declineReason: null,
    ndaAcceptedAt: SEED_NOW - 11 * DAY,
    participationStatus: 'BIDDING', qualificationStatus: 'QUALIFIED', awardStatus: 'NONE',
    qualificationSnapshot: 78, performanceRatingSnapshot: 81,
    bidOnBehalfAllowed: false, maskedLabel: 'Bidder C',
    disqualified: false, disqualificationReason: null,
  },
  {
    id: 'eb-metro', eventId: PRIMARY_EVENT_ID, counterpartyId: 'cp-metro', isProvisional: true,
    invitedAt: SEED_NOW - 9 * DAY, invitationStatus: 'ACCEPTED', declineReason: null,
    ndaAcceptedAt: SEED_NOW - 8 * DAY,
    // Accepted the invitation but has not joined the live room. Two axes.
    participationStatus: 'REGISTERED', qualificationStatus: 'QUALIFIED', awardStatus: 'NONE',
    qualificationSnapshot: 64, performanceRatingSnapshot: 0,
    bidOnBehalfAllowed: false, maskedLabel: 'Bidder D',
    disqualified: false, disqualificationReason: null,
  },
];

/** The signed-in supplier in the vendor portal. */
export const PORTAL_BIDDER_ID = 'eb-abc';

// ---------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------

export const AUCTION: Auction = {
  id: 'auc-0142', eventId: PRIMARY_EVENT_ID, side: 'BUY',
  mechanism: 'ENGLISH', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
  feedbackPolicy: 'RANK_GAP', identityPolicy: 'MASKED',
  lotStrategy: 'STAGGERED', biddingLevel: 'LOT', closePolicy: 'SOFT_EXTENSION',
  transformation: 'SUPPLIER_SPECIFIC', proxyBidding: true,
  status: 'LIVE',
  startsAt: SEED_NOW - 15 * MINUTE, endsAt: SEED_NOW + 12 * MINUTE + 30_000,
  extensionsUsed: 0,
  discloseTarget: false, trafficAmberBandPct: 5,
  antiGaming: { ...DEFAULT_ANTI_GAMING },
  startingPriceSource: 'Indicative PR quote (PR-2024-0125)',
  targetPriceDerivation: 'Last purchase price − 8%',
};

export const AUCTION_LOTS: AuctionLot[] = [
  {
    id: 'al-1', auctionId: 'auc-0142', lotId: 'lot-1', status: 'LOT_OPEN',
    startingPrice: 150_000,
    opensAt: SEED_NOW - 15 * MINUTE, closesAt: SEED_NOW + 12 * MINUTE + 30_000,
  },
  {
    id: 'al-2', auctionId: 'auc-0142', lotId: 'lot-2', status: 'LOT_PENDING',
    startingPrice: 24_000,
    opensAt: SEED_NOW + 5 * MINUTE, closesAt: SEED_NOW + 25 * MINUTE,
  },
  {
    id: 'al-3', auctionId: 'auc-0142', lotId: 'lot-3', status: 'LOT_PENDING',
    startingPrice: 15_000,
    opensAt: SEED_NOW + 5 * MINUTE, closesAt: SEED_NOW + 36 * MINUTE,
  },
];

/**
 * Bidder-specific cost components. Note that ABC's landed cost is worse than
 * its headline bid while Global's is better — which is exactly why ranking must
 * read the transformed value.
 */
export const COST_COMPONENTS: CostComponent[] = [
  {
    id: 'cc-freight', eventId: PRIMARY_EVENT_ID, name: 'Inbound freight', basis: 'LUMP_SUM',
    valueByBidder: { 'eb-abc': 4_200, 'eb-global': 1_100, 'eb-prime': 6_900, 'eb-metro': 3_400 },
    source: 'Standard freight lane rates, origin-based', agentProposed: true,
  },
  {
    id: 'cc-duty', eventId: PRIMARY_EVENT_ID, name: 'Import duty', basis: 'PERCENTAGE',
    valueByBidder: { 'eb-abc': 1.5, 'eb-global': 0, 'eb-prime': 2.8, 'eb-metro': 1.5 },
    source: 'Duty rate by country of origin', agentProposed: true,
  },
  {
    id: 'cc-payterms', eventId: PRIMARY_EVENT_ID, name: 'Payment-term NPV', basis: 'PERCENTAGE',
    valueByBidder: { 'eb-abc': 0.4, 'eb-global': -2.1, 'eb-prime': 0.9, 'eb-metro': 0.6 },
    source: 'Tenant cost of capital at 7.5%', agentProposed: true,
  },
  {
    id: 'cc-switch', eventId: PRIMARY_EVENT_ID, name: 'Switching cost', basis: 'LUMP_SUM',
    valueByBidder: { 'eb-abc': 0, 'eb-global': 2_800, 'eb-prime': 2_800, 'eb-metro': 3_900 },
    source: 'Catalogue integration and onboarding effort', agentProposed: false,
  },
];

/**
 * Seeded ledger for Lot 1. Ranks are as recorded at submission; the engine
 * recomputes the live standing from these rows.
 */
export const SEED_BIDS: Bid[] = [
  mkBid('eb-prime', 146_000, 151_000, 1, SEED_NOW - 7 * MINUTE, 1),
  mkBid('eb-global', 145_000, 148_900, 2, SEED_NOW - 5 * MINUTE, 2),
  mkBid('eb-abc', 142_000, 149_850, 2, SEED_NOW - 3 * MINUTE, 3),
  mkBid('eb-prime', 141_500, 147_200, 1, SEED_NOW - 75_000, 4),
  mkBid('eb-abc', 141_000, 148_350, 2, SEED_NOW - 28_000, 5),
];

function mkBid(
  bidderId: string, bidValue: number, transformedValue: number,
  rank: number, at: number, sequence: number,
): Bid {
  return {
    id: `bid-seed-${sequence}`, auctionId: 'auc-0142', auctionLotId: 'al-1',
    lineItemId: null, bidderId, bidValue, transformedValue, currency: 'USD',
    rankAtSubmission: rank, submittedAt: at, source: 'PORTAL',
    submittedByUserId: `portal-${bidderId}`, onBehalfReason: null,
    // Deliberately skewed from submittedAt: client time is diagnostics only.
    clientTimestamp: at + 1_400,
    ipHash: `ip-${bidderId}`, isValid: true, rejectionReason: null,
    sequenceNumber: sequence,
  };
}

// ---------------------------------------------------------------------------
// Questionnaire
// ---------------------------------------------------------------------------

const QUESTIONS: Question[] = [
  {
    id: 'q-1', questionnaireId: 'qn-1', sectionId: 'sec-company', sequence: 1, code: 'CO.YEARS',
    type: 'number', title: 'Years trading in this category', helpText: 'Whole years.',
    isRequired: true, envelope: 'TECHNICAL', weight: 10, scoringMethod: 'RULE',
    maxScore: 10, rubric: '0–2 yrs = 2 · 3–5 yrs = 6 · 6+ yrs = 10',
    isKnockout: false, allowAttachment: false,
  },
  {
    id: 'q-2', questionnaireId: 'qn-1', sectionId: 'sec-company', sequence: 2, code: 'CO.ISO9001',
    type: 'certificate', title: 'ISO 9001 certification',
    helpText: 'Attach a current certificate. Mandatory.',
    isRequired: true, envelope: 'TECHNICAL', weight: 15, scoringMethod: 'MANUAL',
    maxScore: 10, rubric: 'Valid = 10 · Expired = 4 · Absent = 0',
    isKnockout: true, allowAttachment: true,
  },
  {
    id: 'q-3', questionnaireId: 'qn-1', sectionId: 'sec-capability', sequence: 3, code: 'CAP.LEADTIME',
    type: 'lead_time', title: 'Standard lead time from order to delivery',
    helpText: 'In calendar days, to the Dubai DC.',
    isRequired: true, envelope: 'TECHNICAL', weight: 20, scoringMethod: 'RULE',
    maxScore: 10, rubric: '≤5 days = 10 · 6–10 = 7 · 11–20 = 4 · >20 = 1',
    isKnockout: false, allowAttachment: false,
  },
  {
    id: 'q-4', questionnaireId: 'qn-1', sectionId: 'sec-capability', sequence: 4, code: 'CAP.CAPACITY',
    type: 'capacity_declaration', title: 'Monthly capacity for A4 paper',
    helpText: 'Reams per month you can reliably supply.',
    isRequired: true, envelope: 'TECHNICAL', weight: 15, scoringMethod: 'AI_ASSISTED',
    maxScore: 10, rubric: 'Assessed against our 1,000 reams/month requirement.',
    isKnockout: false, allowAttachment: true,
  },
  {
    id: 'q-5', questionnaireId: 'qn-1', sectionId: 'sec-sustain', sequence: 5, code: 'SUS.FSC',
    type: 'yes_no', title: 'Is all paper FSC or PEFC certified?',
    helpText: '', isRequired: true, envelope: 'TECHNICAL', weight: 10, scoringMethod: 'MANUAL',
    maxScore: 10, rubric: 'Yes = 10 · Partial = 5 · No = 0',
    isKnockout: false, allowAttachment: true,
  },
  {
    id: 'q-6', questionnaireId: 'qn-1', sectionId: 'sec-commercial', sequence: 6, code: 'COM.PRICES',
    // Binds to the event's line items and renders as a price grid.
    type: 'price_schedule', title: 'Price schedule',
    helpText: 'Unit prices for every line. Extended values are calculated.',
    isRequired: true, envelope: 'COMMERCIAL', weight: 0, scoringMethod: 'NONE',
    maxScore: 0, rubric: null, isKnockout: false, allowAttachment: false,
  },
  {
    id: 'q-7', questionnaireId: 'qn-1', sectionId: 'sec-commercial', sequence: 7, code: 'COM.PAYTERMS',
    type: 'currency_payment_terms', title: 'Payment terms offered',
    helpText: 'Days from invoice.',
    // A commercial question that is scored but carries no price — it feeds
    // commercial_terms_score, keeping price in exactly one component.
    isRequired: true, envelope: 'COMMERCIAL', weight: 10, scoringMethod: 'RULE',
    maxScore: 10, rubric: '≥60 days = 10 · 30–59 = 6 · <30 = 3',
    isKnockout: false, allowAttachment: false,
  },
  {
    id: 'q-8', questionnaireId: 'qn-1', sectionId: 'sec-commercial', sequence: 8, code: 'COM.WARRANTY',
    type: 'short_text', title: 'Returns and defect policy',
    helpText: '', isRequired: false, envelope: 'COMMERCIAL', weight: 5, scoringMethod: 'MANUAL',
    maxScore: 10, rubric: 'Assessed on clarity and coverage.',
    isKnockout: false, allowAttachment: false,
  },
];

export const QUESTIONNAIRE: Questionnaire = {
  id: 'qn-1', eventId: PRIMARY_EVENT_ID, stage: 'RFP',
  name: 'Office supplies — technical and commercial',
  questions: QUESTIONS,
};

export const QUESTION_SECTIONS = [
  { id: 'sec-company', name: 'Company & compliance' },
  { id: 'sec-capability', name: 'Capability' },
  { id: 'sec-sustain', name: 'Sustainability' },
  { id: 'sec-commercial', name: 'Commercial' },
];

// ---------------------------------------------------------------------------
// Responses and scores
// ---------------------------------------------------------------------------

export const RESPONSES: Response[] = EVENT_BIDDERS.map((bidder, i) => ({
  id: `resp-${bidder.id}`, eventId: PRIMARY_EVENT_ID, bidderId: bidder.id, version: 1,
  submittedAt: bidder.participationStatus === 'REGISTERED' && i === 3
    ? SEED_NOW - 4 * DAY
    : SEED_NOW - 5 * DAY,
  answers: [
    { questionId: 'q-1', value: [12, 8, 5, 3][i], attachmentName: null },
    {
      questionId: 'q-2', value: 'Valid to 2027-03',
      // Metro's filename leaks its identity — blind technical flags it.
      attachmentName: i === 3 ? 'Metro-Business-ISO9001.pdf' : `iso9001-cert-${i + 1}.pdf`,
    },
    { questionId: 'q-3', value: [4, 9, 6, 14][i], attachmentName: null },
    { questionId: 'q-4', value: [1800, 1200, 1050, 700][i], attachmentName: `capacity-${i + 1}.xlsx` },
    { questionId: 'q-5', value: [true, true, false, true][i], attachmentName: null },
    { questionId: 'q-7', value: [60, 45, 30, 30][i], attachmentName: null },
    {
      questionId: 'q-8',
      value: ['30-day returns, full credit', '14-day returns', '30-day returns, restocking fee', '7-day returns'][i],
      attachmentName: null,
    },
  ],
  priceLines: LINE_ITEMS.map((line) => ({
    lineItemId: line.id,
    unitPrice: Number(((line.baselinePrice ?? 10) * [0.94, 0.99, 0.91, 0.90][i]).toFixed(2)),
    currency: 'USD', leadTimeDays: [4, 9, 6, 14][i], notes: null,
  })),
}));

export const SCORES: Score[] = [
  mkScore('s-1', 'eb-abc', 'q-2', 'user-js', 10, 'Certificate current and in scope.', 'MANUAL'),
  mkScore('s-2', 'eb-abc', 'q-5', 'user-js', 10, 'FSC across the full range.', 'MANUAL'),
  mkScore('s-3', 'eb-global', 'q-2', 'user-js', 10, 'Valid.', 'MANUAL'),
  mkScore('s-4', 'eb-global', 'q-5', 'user-js', 10, 'Confirmed FSC.', 'MANUAL'),
  mkScore('s-5', 'eb-prime', 'q-2', 'user-js', 4, 'Certificate expired last quarter.', 'MANUAL'),
  mkScore('s-6', 'eb-prime', 'q-5', 'user-js', 0, 'Only partial FSC coverage declared.', 'MANUAL'),
  mkScore('s-7', 'eb-metro', 'q-2', 'user-js', 10, 'Valid.', 'MANUAL'),
  mkScore('s-8', 'eb-metro', 'q-5', 'user-js', 10, 'Confirmed.', 'MANUAL'),
];

function mkScore(
  id: string, bidderId: string, questionId: string, evaluatorId: string,
  value: number, comment: string, method: Score['method'],
): Score {
  return {
    id, eventId: PRIMARY_EVENT_ID, bidderId, questionId, evaluatorId,
    value, comment, method, agentConfidence: null, citedEvidence: null,
    overridesScoreId: null, overrideReason: null, createdAt: SEED_NOW - 3 * DAY,
  };
}

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export const CLARIFICATIONS: Clarification[] = [
  {
    id: 'clar-1', eventId: PRIMARY_EVENT_ID, askedByBidderId: 'eb-global',
    subject: 'A3 paper volume',
    question: 'Is the 1,400 ream A3 volume firm, or an estimate that may vary?',
    askedAt: SEED_NOW - 9 * DAY,
    answer: 'The A3 volume is an estimate based on last year\'s consumption, with a ±15% tolerance. Pricing should assume the stated volume.',
    answeredAt: SEED_NOW - 8 * DAY, answeredBy: 'user-ar',
    // Substantive: broadcast to every bidder. Not configurable.
    visibility: 'BROADCAST', agentDrafted: true, revealAsker: false,
  },
  {
    id: 'clar-2', eventId: PRIMARY_EVENT_ID, askedByBidderId: 'eb-prime',
    subject: 'Delivery to Sharjah',
    question: 'Is Sharjah Store delivery required for all lots or only Lot 3?',
    askedAt: SEED_NOW - 6 * DAY,
    answer: 'Sharjah Store applies to the archive box line in Lot 3 only. All other lines deliver to Dubai DC or Abu Dhabi DC as stated.',
    answeredAt: SEED_NOW - 6 * DAY + 4 * HOUR, answeredBy: 'user-ar',
    visibility: 'BROADCAST', agentDrafted: false, revealAsker: false,
  },
  {
    id: 'clar-3', eventId: PRIMARY_EVENT_ID, askedByBidderId: 'eb-metro',
    subject: 'Portal login for a second user',
    question: 'Can you add my colleague to our portal account?',
    askedAt: SEED_NOW - 2 * DAY,
    answer: null, answeredAt: null, answeredBy: null,
    // Administrative only, and labelled as such.
    visibility: 'PRIVATE_ADMINISTRATIVE', agentDrafted: false, revealAsker: false,
  },
  {
    id: 'clar-4', eventId: PRIMARY_EVENT_ID, askedByBidderId: 'eb-abc',
    subject: 'Index linkage on paper',
    question: 'Will pulp index movement be recognised during the contract year?',
    askedAt: SEED_NOW - 20 * HOUR,
    answer: null, answeredAt: null, answeredBy: null,
    visibility: 'BROADCAST', agentDrafted: true, revealAsker: false,
  },
];

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

export const NEGOTIATION_ROUNDS: NegotiationRound[] = [
  {
    id: 'nr-1', eventId: PRIMARY_EVENT_ID, roundNumber: 1, type: 'STANDARD', scope: 'TOP_N',
    negotiable: ['PRICE', 'TERMS'], deadline: SEED_NOW - 2 * DAY,
    message: 'Please review your position on Lot 1 and Lot 3 and respond with your best terms.',
    bidderIds: ['eb-abc', 'eb-prime', 'eb-global'], closed: true,
  },
];

// ---------------------------------------------------------------------------
// DoA
// ---------------------------------------------------------------------------

export const DOA_RULES: DoARule[] = [
  {
    id: 'doa-1', name: 'Indirect up to 50k', minValue: 0, maxValue: 50_000,
    category: 'Indirect', businessUnit: null, chainMode: 'SEQUENTIAL',
    levels: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
    ],
  },
  {
    id: 'doa-2', name: 'Indirect 50k–250k', minValue: 50_000, maxValue: 250_000,
    category: 'Indirect', businessUnit: null, chainMode: 'SEQUENTIAL',
    levels: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
      { level: 3, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
    ],
  },
  {
    id: 'doa-3', name: 'Any category above 250k', minValue: 250_000, maxValue: null,
    category: null, businessUnit: null, chainMode: 'SEQUENTIAL',
    levels: [
      { level: 1, role: 'Category Manager', holderName: 'A. Rahman', slaHours: 24 },
      { level: 2, role: 'Head of Procurement', holderName: 'M. Prasad', slaHours: 24 },
      { level: 3, role: 'Finance Director', holderName: 'S. Iyer', slaHours: 48 },
      { level: 4, role: 'CFO', holderName: 'R. Khoury', slaHours: 72 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Configuration — seeded across scopes so inheritance is visible
// ---------------------------------------------------------------------------

export const CONFIG_SETTINGS: ConfigSetting[] = [
  {
    key: 'evaluation.envelope_mode', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: 'TWO_ENVELOPE', isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
  {
    // Locked at tenant: no narrower scope may turn blind evaluation off.
    key: 'evaluation.blind_technical', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: true, isLocked: true, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
  {
    key: 'auction.feedback_policy', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: 'BEST_PRICE', isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
  {
    key: 'auction.feedback_policy', scopeType: 'CATEGORY', scopeId: 'Indirect',
    value: 'RANK_ONLY', isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 40 * DAY,
  },
  {
    key: 'auction.feedback_policy', scopeType: 'EVENT', scopeId: PRIMARY_EVENT_ID,
    value: 'RANK_GAP', isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 3 * DAY,
  },
  {
    key: 'auction.min_decrement', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: 1, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
  {
    key: 'auction.min_decrement', scopeType: 'TEMPLATE', scopeId: 'tpl-full-ladder',
    value: 0.5, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 30 * DAY,
  },
  {
    key: 'negotiation.max_rounds', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: 3, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
  {
    key: 'award.override_doa_uplift', scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: 1, isLocked: true, setBy: 'user-ar', setAt: SEED_NOW - 90 * DAY,
  },
];

export const SCOPE_LINEAGE = {
  tenantId: 'tenant-udaan',
  categoryId: 'Indirect',
  templateId: 'tpl-full-ladder',
  eventId: PRIMARY_EVENT_ID,
};
