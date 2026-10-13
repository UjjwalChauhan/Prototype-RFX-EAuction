/**
 * Seed data.
 *
 * Values, names and figures are lifted from the Build Pack design files so the
 * running app matches the delivered screens: RFQ-2026-0142 "Office Supplies
 * Annual Contract", the four bidders A–D, the $150,000 start price and the
 * three-lot staggered schedule.
 */
import type {
  Auction, AuctionControlEvent, AuctionLot, Bid, Clarification, ConfigSetting, CostComponent, Counterparty,
  DoARule, EventBidder, Id, LineItem, Lot, NegotiationRound, Question, Questionnaire,
  Response, Score, Side, SourcingEvent, User, VendorInputPoint,
} from '../domain/types';
import { DEFAULT_ANTI_GAMING } from '../domain/auctionEngine';
import { defaultParameters } from '../domain/auctionRules';
import type { IndexLink, ScoredAttribute } from '../domain/auctionMechanics';
import {
  JOURNEY_CUSTOM_KEY, JOURNEY_ENABLED_KEY, type CustomJourney,
} from '../domain/journeyComposer';
import {
  TEMPLATE_CUSTOM_KEY, TEMPLATE_WEIGHTING_KEY, seedQuestionnaires,
} from '../domain/questionnaireTemplates';
import {
  CATEGORY_TEMPLATES, DEFAULT_STAGE_WEIGHTING, TENANT_TEMPLATES,
} from './questionnaireTemplates';

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

/**
 * The vendor master.
 *
 * `categoriesServed` uses the same category vocabulary the requisitions do, so
 * a cross-category basket can be matched against it directly. Coverage is
 * deliberately uneven — Electrical & Instrumentation has two qualified
 * suppliers and one of them is provisional — because a shortlist screen that
 * always finds three good candidates never shows the buyer the case that
 * actually needs their attention.
 */
export const COUNTERPARTIES: Counterparty[] = [
  {
    id: 'cp-abc', name: 'ABC Supplies Co.', onboardingRating: 92, performanceRating: 88,
    categoriesServed: ['Office & Administrative', 'Facilities & MRO'],
    locationsServed: ['Dubai', 'Abu Dhabi'],
    isProvisional: false, contactEmail: 'bids@abcsupplies.example',
  },
  {
    id: 'cp-global', name: 'Global Office Solutions', onboardingRating: 85, performanceRating: 74,
    categoriesServed: ['Office & Administrative', 'IT Hardware'], locationsServed: ['Dubai'],
    isProvisional: false, contactEmail: 'tenders@globaloffice.example',
  },
  {
    id: 'cp-prime', name: 'Prime Stationery Ltd.', onboardingRating: 78, performanceRating: 81,
    categoriesServed: ['Office & Administrative'], locationsServed: ['Sharjah', 'Dubai'],
    isProvisional: false, contactEmail: 'sales@primestationery.example',
  },
  {
    id: 'cp-metro', name: 'Metro Business Supplies', onboardingRating: 64, performanceRating: 0,
    categoriesServed: ['Office & Administrative'], locationsServed: ['Dubai'],
    // Invited but not yet on the master: can bid, cannot be awarded.
    isProvisional: true, contactEmail: 'hello@metrosupplies.example',
  },
  {
    id: 'cp-nova', name: 'Nova Technologies FZE', onboardingRating: 94, performanceRating: 91,
    categoriesServed: ['IT Hardware'], locationsServed: ['Dubai', 'Bengaluru'],
    isProvisional: false, contactEmail: 'bids@novatech.example',
  },
  {
    id: 'cp-orion', name: 'Orion Systems Integrators', onboardingRating: 88, performanceRating: 76,
    categoriesServed: ['IT Hardware', 'Electrical & Instrumentation'],
    locationsServed: ['Chennai', 'Hyderabad'],
    isProvisional: false, contactEmail: 'tenders@orionsys.example',
  },
  {
    id: 'cp-summit', name: 'Summit Industrial Supply', onboardingRating: 90, performanceRating: 84,
    categoriesServed: ['Facilities & MRO', 'Electrical & Instrumentation'],
    locationsServed: ['Pune', 'Ahmedabad'],
    isProvisional: false, contactEmail: 'sales@summitindustrial.example',
  },
  {
    id: 'cp-keystone', name: 'Keystone Maintenance Co.', onboardingRating: 71, performanceRating: 63,
    categoriesServed: ['Facilities & MRO'], locationsServed: ['Kolkata', 'Bengaluru'],
    isProvisional: false, contactEmail: 'bids@keystonemro.example',
  },
  {
    id: 'cp-transline', name: 'Transline Fleet Services', onboardingRating: 83, performanceRating: 79,
    categoriesServed: ['Fleet & Logistics'], locationsServed: ['Mumbai', 'Pune'],
    isProvisional: false, contactEmail: 'tenders@transline.example',
  },
  {
    id: 'cp-cargo', name: 'CargoBridge Logistics', onboardingRating: 76, performanceRating: 68,
    categoriesServed: ['Fleet & Logistics'], locationsServed: ['Chennai', 'Kolkata'],
    isProvisional: false, contactEmail: 'bids@cargobridge.example',
  },
  {
    id: 'cp-voltek', name: 'Voltek Instrumentation', onboardingRating: 69, performanceRating: 0,
    categoriesServed: ['Electrical & Instrumentation'], locationsServed: ['Hyderabad'],
    isProvisional: true, contactEmail: 'hello@voltek.example',
  },
  {
    id: 'cp-meridian', name: 'Meridian Advisory Partners', onboardingRating: 96, performanceRating: 89,
    categoriesServed: ['Professional & Consultancy'], locationsServed: ['Mumbai', 'Dubai'],
    isProvisional: false, contactEmail: 'proposals@meridianadvisory.example',
  },
  {
    id: 'cp-anchor', name: 'Anchor Consulting Group', onboardingRating: 87, performanceRating: 72,
    categoriesServed: ['Professional & Consultancy'], locationsServed: ['Bengaluru'],
    isProvisional: false, contactEmail: 'bids@anchorconsulting.example',
  },
  {
    id: 'cp-brightpath', name: 'Brightpath Talent Services', onboardingRating: 74, performanceRating: 66,
    categoriesServed: ['Professional & Consultancy', 'Office & Administrative'],
    locationsServed: ['Gurugram'],
    isProvisional: false, contactEmail: 'tenders@brightpath.example',
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
    currency: 'INR', estimatedValue: 150_000, ownerId: 'user-ar',
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
    currency: 'INR', estimatedValue: 150_000, ownerId: 'user-ar',
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
    currency: 'INR', estimatedValue: 480_000, ownerId: 'user-js',
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
    currency: 'INR', estimatedValue: 1_200_000, ownerId: 'user-mp',
    status: 'OPEN', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFI', 'RFP', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'RFI', envelopeMode: 'TWO_ENVELOPE',
    // The ladder runs on to RFP, RFQ and an auction, but only the RFI has been
    // issued. A point is listed here once the buyer has actually asked at it.
    vendorInputPoints: ['RFI'],
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
    currency: 'INR', estimatedValue: 95_000, ownerId: 'user-kt',
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
    currency: 'INR', estimatedValue: 34_200, ownerId: 'user-ar',
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
    currency: 'INR', estimatedValue: 260_000, ownerId: 'user-mp',
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
    currency: 'INR', estimatedValue: 28_000, ownerId: 'user-js',
    status: 'DRAFT', createdFrom: 'MANUAL', sourceReference: null,
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'INTAKE', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ', 'AUCTION'],
    publishedAt: null, closesAt: null, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-auc-tl', tenantId: 'tenant-udaan', eventNumber: 'AUC-2026-071',
    title: 'Corrugated Packaging — Traffic Light',
    description: 'Open bidding against the buyer’s target. Bidders see a colour, never a competitor.',
    side: 'BUY', templateId: 'tpl-direct', journeyPattern: 'JP-01',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'INR', estimatedValue: 620_000, ownerId: 'user-ar',
    status: 'AUCTION_LIVE', createdFrom: 'PR', sourceReference: 'PR-2024-0141',
    stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'SINGLE',
    vendorInputPoints: ['AUCTION'],
    publishedAt: SEED_NOW - 2 * DAY, closesAt: SEED_NOW + 42 * MINUTE, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-auc-idx', tenantId: 'tenant-udaan', eventNumber: 'AUC-2026-072',
    title: 'Aluminium Extrusion — Index Linked',
    description: 'Bidders quote a premium to the LME cash settlement rather than an absolute price.',
    side: 'BUY', templateId: 'tpl-direct', journeyPattern: 'JP-01',
    businessUnit: 'Manufacturing', category: 'Raw Materials', project: null, costCentre: 'CC-7100',
    currency: 'INR', estimatedValue: 1_850_000, ownerId: 'user-js',
    status: 'AUCTION_LIVE', createdFrom: 'PR', sourceReference: 'PR-2024-0142',
    stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'SINGLE',
    vendorInputPoints: ['AUCTION'],
    publishedAt: SEED_NOW - 1 * DAY, closesAt: SEED_NOW + 55 * MINUTE, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-auc-eng', tenantId: 'tenant-udaan', eventNumber: 'AUC-2026-073',
    title: 'Janitorial Consumables — English Auction',
    description: 'Scheduled to open shortly. The practice run is open so bidders can try the controls.',
    side: 'BUY', templateId: 'tpl-direct', journeyPattern: 'JP-01',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'INR', estimatedValue: 340_000, ownerId: 'user-ar',
    status: 'AUCTION_SCHEDULED', createdFrom: 'PR', sourceReference: 'PR-2024-0143',
    stagesEnabled: ['INTAKE', 'AUCTION', 'AWARD', 'APPROVAL'],
    currentStage: 'AUCTION', envelopeMode: 'SINGLE',
    vendorInputPoints: ['AUCTION'],
    publishedAt: SEED_NOW - 6 * HOUR, closesAt: SEED_NOW + 3 * HOUR, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfq-061', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2026-061',
    title: 'Warehouse Consumables Framework',
    description: 'Prices against a fixed specification for packaging and handling consumables.',
    // Simple RFQ: its stages are exactly this pattern's, so the board does not
    // promise a negotiation and an auction the event will never reach.
    side: 'BUY', templateId: 'tpl-simple-rfq', journeyPattern: 'JP-02',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'INR', estimatedValue: 96_000, ownerId: 'user-ar',
    status: 'OPEN', createdFrom: 'PR', sourceReference: 'PR-2024-0138',
    stagesEnabled: ['INTAKE', 'RFQ', 'EVALUATION', 'AWARD', 'APPROVAL'],
    currentStage: 'RFQ', envelopeMode: 'SINGLE',
    vendorInputPoints: ['RFQ'],
    publishedAt: SEED_NOW - 3 * DAY, closesAt: SEED_NOW + 4 * DAY, awardedAt: null,
    parentEventId: null, version: 1, configSnapshotAtPublish: null,
  },
  {
    id: 'evt-rfq-044', tenantId: 'tenant-udaan', eventNumber: 'RFQ-2024-044',
    title: 'Catering Supplies',
    description: 'Awarded; supplier onboarding in progress.',
    side: 'BUY', templateId: 'tpl-simple-rfq', journeyPattern: 'JP-02',
    businessUnit: 'Corporate Services', category: 'Indirect', project: null, costCentre: 'CC-4400',
    currency: 'INR', estimatedValue: 18_900, ownerId: 'user-ar',
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
    baselinePrice: 8.67, baselineSource: 'LPP', currency: 'INR',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-01',
  },
  {
    id: 'li-2', lotId: 'lot-1', lineNumber: 2, itemCode: 'PPR-A3-80',
    description: 'A3 copier paper, 80gsm, ream of 500',
    specification: 'ISO brightness 96+, FSC certified', quantity: 1_400, uom: 'ream',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 17.20, baselineSource: 'LPP', currency: 'INR',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-02',
  },
  {
    id: 'li-3', lotId: 'lot-2', lineNumber: 3, itemCode: 'PEN-BLU-BX',
    description: 'Ballpoint pen, blue, box of 50',
    specification: '0.7mm, retractable', quantity: 900, uom: 'box',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 18.50, baselineSource: 'PR', currency: 'INR',
    isOptional: false, allowAlternate: true, sourcePrLineId: 'pr-0125-03',
  },
  {
    id: 'li-4', lotId: 'lot-2', lineNumber: 4, itemCode: 'MKR-ASST',
    description: 'Whiteboard marker, assorted, box of 12',
    specification: 'Chisel tip, low odour', quantity: 620, uom: 'box',
    deliveryLocation: 'Abu Dhabi DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 9.10, baselineSource: 'PR', currency: 'INR',
    isOptional: false, allowAlternate: true, sourcePrLineId: 'pr-0125-04',
  },
  {
    id: 'li-5', lotId: 'lot-3', lineNumber: 5, itemCode: 'FLD-LEV-A4',
    description: 'Lever arch file, A4, 75mm',
    specification: 'Board with PP laminate', quantity: 2_400, uom: 'each',
    deliveryLocation: 'Dubai DC', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 3.90, baselineSource: 'SHOULD_COST', currency: 'INR',
    isOptional: false, allowAlternate: false, sourcePrLineId: 'pr-0125-05',
  },
  {
    id: 'li-6', lotId: 'lot-3', lineNumber: 6, itemCode: 'BOX-ARC',
    description: 'Archive box with lid',
    specification: 'Double-wall corrugated', quantity: 1_100, uom: 'each',
    deliveryLocation: 'Sharjah Store', deliveryDate: null, incoterm: 'DDP', taxClass: 'STANDARD',
    baselinePrice: 4.30, baselineSource: 'SHOULD_COST', currency: 'INR',
    isOptional: true, allowAlternate: false, sourcePrLineId: 'pr-0125-06',
  },
];

// ---------------------------------------------------------------------------
// The other events' baskets
// ---------------------------------------------------------------------------

/**
 * Every other seeded event carries lots and lines of its own.
 *
 * The primary event above is described line by line because the Build Pack
 * screens quote it. The rest are described by a small spec and expanded, which
 * keeps eight baskets readable — the point of them is that no event in the
 * list opens onto an empty Items & Lots, not that each is a catalogue.
 */
interface BasketLine {
  itemCode: string;
  description: string;
  specification: string;
  quantity: number;
  uom: string;
  baselinePrice: number | null;
  baselineSource: LineItem['baselineSource'];
}

interface Basket {
  eventId: string;
  location: string;
  currency: string;
  lots: {
    name: string;
    description: string;
    awardMode: Lot['awardMode'];
    status: Lot['status'];
    lines: BasketLine[];
    /**
     * The buyer's internal target. Seeded only where a mechanism needs one —
     * a traffic light with no target has no colours to show, because the
     * colour *is* the distance from it.
     */
    targetPrice?: number;
    ceilingPrice?: number;
  }[];
}

const BASKETS: Basket[] = [
  {
    eventId: 'evt-auc-002', location: 'Jebel Ali Yard', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Structural steel', description: 'Beams and plate, annual call-off.',
        awardMode: 'SINGLE', status: 'LOT_OPEN',
        lines: [
          { itemCode: 'STL-IB-200', description: 'I-beam, 200mm, S275JR', specification: 'EN 10025-2, mill certificate', quantity: 480, uom: 'tonne', baselinePrice: 690, baselineSource: 'INDEX' },
          { itemCode: 'STL-PLT-10', description: 'Steel plate, 10mm, hot rolled', specification: 'S355JR, 2000 x 6000', quantity: 220, uom: 'tonne', baselinePrice: 745, baselineSource: 'INDEX' },
        ],
      },
      {
        name: 'Lot 2 · Fasteners', description: 'Structural bolts and anchors.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'FST-HSB-M20', description: 'High-strength bolt, M20 x 80', specification: 'Grade 8.8, hot dip galvanised', quantity: 34_000, uom: 'each', baselinePrice: 1.85, baselineSource: 'LPP' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfp-018', location: 'Dubai HQ', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Endpoints', description: '400-seat laptop and dock refresh.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'LAP-14-I7', description: 'Laptop, 14in, i7 / 32GB / 1TB', specification: '3-year onsite warranty, TPM 2.0', quantity: 400, uom: 'each', baselinePrice: 1_180, baselineSource: 'LPP' },
          { itemCode: 'DCK-USB4', description: 'Docking station, USB4, dual 4K', specification: '100W power delivery', quantity: 400, uom: 'each', baselinePrice: 165, baselineSource: 'LPP' },
        ],
      },
      {
        name: 'Lot 2 · Displays', description: 'Desk monitors and mounts.',
        awardMode: 'SPLIT', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'MON-27-QHD', description: 'Monitor, 27in QHD, USB-C', specification: 'Height adjustable, VESA 100', quantity: 620, uom: 'each', baselinePrice: 240, baselineSource: 'SHOULD_COST' },
          { itemCode: 'ARM-DUAL', description: 'Dual monitor arm, desk clamp', specification: 'Up to 9kg per arm', quantity: 210, uom: 'each', baselinePrice: 78, baselineSource: 'SHOULD_COST' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfi-005', location: 'Dubai HQ', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Hard services', description: 'HVAC, electrical and plumbing maintenance.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'FM-HVAC-PPM', description: 'HVAC planned maintenance, per site visit', specification: 'Quarterly PPM across 6 towers, chiller and AHU', quantity: 96, uom: 'visit', baselinePrice: 2_400, baselineSource: 'PO' },
          { itemCode: 'FM-ELEC-PPM', description: 'Electrical PPM and thermography', specification: 'Annual LV panel survey, 6 sites', quantity: 24, uom: 'visit', baselinePrice: 1_850, baselineSource: 'PO' },
        ],
      },
      {
        name: 'Lot 2 · Soft services', description: 'Cleaning, waste and pest control.',
        awardMode: 'SPLIT', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'FM-CLN-FTE', description: 'Cleaning operative, day shift', specification: 'Fully loaded rate, 6 days per week', quantity: 42, uom: 'FTE-year', baselinePrice: 11_400, baselineSource: 'BUDGET' },
          { itemCode: 'FM-WST-COL', description: 'General waste collection', specification: '1100L bin, three lifts per week', quantity: 1_560, uom: 'lift', baselinePrice: 42, baselineSource: 'BUDGET' },
        ],
      },
      {
        name: 'Lot 3 · Helpdesk & CAFM', description: 'Single point of contact and the system behind it.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'FM-HD-SEAT', description: 'Helpdesk seat, 24/7 coverage', specification: 'CAFM licensed, SLA reporting monthly', quantity: 5, uom: 'seat-year', baselinePrice: 38_000, baselineSource: 'BUDGET' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-sell-003', location: 'Al Quoz Depot', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Light vehicles', description: '14 surplus vehicles, sold as seen.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'VEH-PU-4X2', description: 'Pickup, 4x2, 2019, 180k km', specification: 'Sold as seen, no warranty, RTA passed', quantity: 9, uom: 'each', baselinePrice: 5_400, baselineSource: 'INDEX' },
          { itemCode: 'VEH-VAN-PNL', description: 'Panel van, 2018, 210k km', specification: 'Sold as seen, no warranty', quantity: 5, uom: 'each', baselinePrice: 4_100, baselineSource: 'INDEX' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfq-041', location: 'Dubai DC', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Janitorial consumables', description: 'Annual volume across six sites.',
        awardMode: 'SINGLE', status: 'LOT_CLOSED',
        lines: [
          { itemCode: 'JAN-HTW-2P', description: 'Hand towel, 2-ply, interfold', specification: 'Carton of 3,200 sheets', quantity: 1_900, uom: 'carton', baselinePrice: 9.40, baselineSource: 'PR' },
          { itemCode: 'JAN-BIN-240', description: 'Bin liner, 240L, heavy duty', specification: 'Roll of 50, 70 micron', quantity: 2_600, uom: 'roll', baselinePrice: 5.10, baselineSource: 'PR' },
          { itemCode: 'JAN-DSF-5L', description: 'Surface disinfectant, 5L', specification: 'Dilutable, food-safe area approved', quantity: 780, uom: 'each', baselinePrice: 12.75, baselineSource: 'LPP' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfp-012', location: 'Dubai HQ', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Retainer', description: 'Core agency team, monthly retainer.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'MKT-RET-CORE', description: 'Core team retainer, per month', specification: 'Account director, strategist, 2 creatives', quantity: 12, uom: 'month', baselinePrice: 16_500, baselineSource: 'PO' },
        ],
      },
      {
        name: 'Lot 2 · Project rates', description: 'Rate card drawn down against briefs.',
        awardMode: 'SPLIT', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'MKT-RT-CRTV', description: 'Creative day rate', specification: 'Senior, blended across disciplines', quantity: 180, uom: 'day', baselinePrice: 950, baselineSource: 'BUDGET' },
          { itemCode: 'MKT-RT-PROD', description: 'Production day rate', specification: 'Film and photography, crew excluded', quantity: 90, uom: 'day', baselinePrice: 1_240, baselineSource: 'BUDGET' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfq-039', location: 'Dubai DC', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Toner', description: 'Framework call-off, indicative annual volume.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        lines: [
          { itemCode: 'TNR-MONO-HY', description: 'Toner cartridge, mono, high yield', specification: 'OEM or approved equivalent, 25k pages', quantity: 640, uom: 'each', baselinePrice: 62, baselineSource: 'LPP' },
          { itemCode: 'TNR-CLR-SET', description: 'Toner set, colour, CMY', specification: 'OEM or approved equivalent, 12k pages', quantity: 180, uom: 'set', baselinePrice: 214, baselineSource: 'LPP' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-auc-tl', location: 'Dubai DC', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 \u00b7 Corrugated cases', description: 'Annual call-off, three case sizes.',
        awardMode: 'SINGLE', status: 'LOT_OPEN',
        // The target is what the colours are measured against, and the
        // ceiling is what a bid is refused above.
        targetPrice: 5_60_000, ceilingPrice: 6_60_000,
        lines: [
          { itemCode: 'COR-RSC-A', description: 'RSC case, 400 x 300 x 300', specification: 'BS 1133, 32 ECT, 2-colour print', quantity: 42_000, uom: 'each', baselinePrice: 9.4, baselineSource: 'LPP' },
          { itemCode: 'COR-RSC-B', description: 'RSC case, 600 x 400 x 400', specification: 'BS 1133, 44 ECT, 2-colour print', quantity: 18_000, uom: 'each', baselinePrice: 13.2, baselineSource: 'LPP' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-auc-idx', location: 'Pune Works', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 \u00b7 Extruded profile', description: 'Quoted as a premium to the index.',
        awardMode: 'SINGLE', status: 'LOT_OPEN',
        lines: [
          { itemCode: 'ALU-EXT-60', description: 'Aluminium extrusion, 6063-T6', specification: 'Mill finish, per drawing set EX-4400', quantity: 640, uom: 'tonne', baselinePrice: 2_890, baselineSource: 'INDEX' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-auc-eng', location: 'Dubai HQ', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 \u00b7 Janitorial consumables', description: 'Cleaning chemicals and paper goods.',
        awardMode: 'SINGLE', status: 'LOT_PENDING',
        ceilingPrice: 5_60_000,
        lines: [
          { itemCode: 'JAN-CHM-SET', description: 'Cleaning chemical, concentrate, 5L', specification: 'EN 1276 compliant, dilution 1:100', quantity: 2_400, uom: 'each', baselinePrice: 96, baselineSource: 'LPP' },
          { itemCode: 'JAN-PPR-RL', description: 'Hand towel roll, 2-ply', specification: '150m, FSC certified', quantity: 7_200, uom: 'roll', baselinePrice: 42, baselineSource: 'LPP' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfq-061', location: 'Dubai DC', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 \u00b7 Packaging', description: 'Cartons, tape and stretch wrap.',
        awardMode: 'SINGLE', status: 'LOT_OPEN',
        lines: [
          { itemCode: 'PKG-CTN-DW', description: 'Carton, double wall, 600 x 400 x 400', specification: 'BS 1133, 32 ECT', quantity: 18_000, uom: 'each', baselinePrice: 54, baselineSource: 'LPP' },
          { itemCode: 'PKG-WRAP-23', description: 'Stretch wrap, 500mm x 23 micron', specification: 'Machine grade, 1500m roll', quantity: 2_400, uom: 'roll', baselinePrice: 186, baselineSource: 'LPP' },
        ],
      },
      {
        name: 'Lot 2 \u00b7 Handling', description: 'Pallets and strapping.',
        awardMode: 'SPLIT', status: 'LOT_OPEN',
        lines: [
          { itemCode: 'HND-PLT-EUR', description: 'Pallet, Euro, heat treated', specification: 'ISPM 15 stamped, 4-way entry', quantity: 3_200, uom: 'each', baselinePrice: 412, baselineSource: 'PO' },
        ],
      },
    ],
  },
  {
    eventId: 'evt-rfq-044', location: 'Dubai HQ', currency: 'INR',
    lots: [
      {
        name: 'Lot 1 · Pantry supplies', description: 'Awarded; call-off against the rate contract.',
        awardMode: 'SINGLE', status: 'LOT_CLOSED',
        lines: [
          { itemCode: 'CAT-COF-1KG', description: 'Coffee beans, 1kg', specification: 'Arabica blend, roasted within 30 days', quantity: 1_450, uom: 'kg', baselinePrice: 11.20, baselineSource: 'GRN' },
          { itemCode: 'CAT-WTR-19L', description: 'Drinking water, 19L bottle', specification: 'Exchange bottles, delivered', quantity: 3_800, uom: 'bottle', baselinePrice: 3.05, baselineSource: 'GRN' },
        ],
      },
    ],
  },
];

const basketEvent = (id: string) => EVENTS.find((e) => e.id === id);

/** Lots of every seeded event other than the primary one. */
export const OTHER_EVENT_LOTS: Lot[] = BASKETS.flatMap((basket) =>
  basket.lots.map((lot, i) => ({
    id: `${basket.eventId}-lot-${i + 1}`,
    eventId: basket.eventId,
    lotNumber: i + 1,
    name: lot.name,
    description: lot.description,
    sequence: i + 1,
    // A lot opens with its event and closes with it unless the event itself
    // has no dates yet, which is what a draft looks like.
    biddingOpenAt: basketEvent(basket.eventId)?.publishedAt ?? null,
    biddingCloseAt: basketEvent(basket.eventId)?.closesAt ?? null,
    awardMode: lot.awardMode,
    minSuppliers: lot.awardMode === 'SPLIT' ? 2 : 1,
    maxSuppliers: lot.awardMode === 'SPLIT' ? 2 : 1,
    // Internal-only figures are seeded only where a mechanism reads them; a
    // target with no stated basis is exactly what the Items & Lots tab flags.
    reservePrice: null,
    targetPrice: lot.targetPrice ?? null,
    ceilingPrice: lot.ceilingPrice ?? null,
    floorPrice: null,
    status: lot.status,
  })),
);

/** Line items of every seeded event other than the primary one. */
export const OTHER_EVENT_LINE_ITEMS: LineItem[] = BASKETS.flatMap((basket) => {
  let lineNumber = 0;
  return basket.lots.flatMap((lot, lotIndex) =>
    lot.lines.map((line) => {
      lineNumber += 1;
      return {
        id: `${basket.eventId}-li-${lineNumber}`,
        lotId: `${basket.eventId}-lot-${lotIndex + 1}`,
        lineNumber,
        itemCode: line.itemCode,
        description: line.description,
        specification: line.specification,
        quantity: line.quantity,
        uom: line.uom,
        deliveryLocation: basket.location,
        deliveryDate: null,
        incoterm: null,
        taxClass: 'STANDARD',
        baselinePrice: line.baselinePrice,
        baselineSource: line.baselineSource,
        currency: basket.currency,
        isOptional: false,
        allowAlternate: false,
        sourcePrLineId: null,
      };
    }),
  );
});

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

/**
 * The shortlists behind the three written asks.
 *
 * Without these the RFI, RFP and RFQ sections listed events nobody had been
 * invited to: the buyer could see the ask, no supplier could, and no response
 * could ever come back. An ask reaches a supplier only through an invitation,
 * so a seeded ask with an empty roster is a seeded ask that does not work.
 */
const invite = (
  eventId: Id, counterpartyId: Id, i: number, days: number,
  extra: Partial<EventBidder> = {},
): EventBidder => ({
  id: `eb-${eventId.replace(/^evt-/, '')}-${counterpartyId.replace(/^cp-/, '')}`,
  eventId,
  counterpartyId,
  isProvisional: false,
  invitedAt: SEED_NOW - days * DAY,
  invitationStatus: 'ACCEPTED',
  declineReason: null,
  ndaAcceptedAt: SEED_NOW - days * DAY + 2 * HOUR,
  participationStatus: 'NOT_STARTED',
  qualificationStatus: 'QUALIFIED',
  awardStatus: 'NONE',
  qualificationSnapshot: COUNTERPARTIES.find((c) => c.id === counterpartyId)?.onboardingRating ?? 0,
  performanceRatingSnapshot:
    COUNTERPARTIES.find((c) => c.id === counterpartyId)?.performanceRating ?? 0,
  bidOnBehalfAllowed: false,
  maskedLabel: `Bidder ${String.fromCharCode(65 + i)}`,
  disqualified: false,
  disqualificationReason: null,
  ...extra,
});

export const REQUEST_BIDDERS: EventBidder[] = [
  // Facilities sounding — the three companies that serve Facilities & MRO.
  invite('evt-rfi-005', 'cp-abc', 0, 2),
  invite('evt-rfi-005', 'cp-summit', 1, 2),
  invite('evt-rfi-005', 'cp-keystone', 2, 2, { participationStatus: 'IN_PROGRESS' }),

  // Hardware refresh — the IT Hardware shortlist.
  invite('evt-rfp-018', 'cp-nova', 0, 5),
  invite('evt-rfp-018', 'cp-orion', 1, 5),
  invite('evt-rfp-018', 'cp-global', 2, 5),

  // Warehouse consumables — office and administrative suppliers.
  invite('evt-rfq-061', 'cp-abc', 0, 3),
  invite('evt-rfq-061', 'cp-prime', 1, 3),
  invite('evt-rfq-061', 'cp-brightpath', 2, 3),
];

/**
 * The questions each written ask actually puts to a supplier.
 *
 * Built from the same template library the Create Event wizard draws on, and
 * by the same call, so a seeded ask is shaped like one a buyer would produce
 * rather than being a second hand-written set that can drift from it.
 *
 * Nothing seeded these before, so `state.questionnaires` started empty: a
 * supplier who opened an ask was shown a form with no questions in it and
 * could "submit" nothing at all.
 */
const REQUEST_ASKS: { eventId: Id; point: VendorInputPoint; category: string }[] = [
  { eventId: 'evt-rfi-005', point: 'RFI', category: 'Facilities' },
  { eventId: 'evt-rfp-018', point: 'RFP', category: 'IT' },
  { eventId: 'evt-rfq-061', point: 'RFQ', category: 'Indirect' },
];

export function REQUEST_QUESTIONNAIRES(): Questionnaire[] {
  const library = [...TENANT_TEMPLATES, ...CATEGORY_TEMPLATES];
  return REQUEST_ASKS.map(({ eventId, point, category }) => {
    const [draft] = seedQuestionnaires({
      existing: [], points: [point], library, category, idSeed: eventId,
    });
    const questionnaireId = `${eventId}-qn-${point.toLowerCase()}`;
    return {
      id: questionnaireId,
      eventId,
      stage: point,
      name: draft.templateName,
      questions: draft.questions.map((question, i): Question => {
        // A template question carries the template it came from; an event
        // question carries the questionnaire. Everything else is the same.
        const { templateId: _templateId, ...rest } = question;
        return { ...rest, id: `${questionnaireId}-q${i + 1}`, questionnaireId };
      }),
    };
  });
}

/** The signed-in supplier in the vendor portal. */
export const PORTAL_BIDDER_ID = 'eb-abc';
/** The supplier company the portal opens as, unless one is chosen. */
export const PORTAL_COUNTERPARTY_ID = 'cp-abc';

// ---------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------

export const AUCTION: Auction = {
  id: 'auc-0142', auctionNumber: 'EA-2026-0001', eventId: PRIMARY_EVENT_ID, side: 'BUY',
  mechanism: 'ENGLISH', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
  feedbackPolicy: 'RANK_GAP', identityPolicy: 'MASKED',
  lotStrategy: 'STAGGERED', biddingLevel: 'LOT', closePolicy: 'SOFT_EXTENSION',
  transformation: 'SUPPLIER_SPECIFIC', proxyBidding: true,
  status: 'LIVE',
  startsAt: SEED_NOW - 15 * MINUTE, endsAt: SEED_NOW + 12 * MINUTE + 30_000,
  extensionsUsed: 0,
  discloseTarget: false, trafficAmberBandPct: 5,
  antiGaming: { ...DEFAULT_ANTI_GAMING },
  parameters: defaultParameters('ENGLISH'),
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
    lineItemId: null, bidderId, bidValue, transformedValue, currency: 'INR',
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
    currency: 'INR', leadTimeDays: [4, 9, 6, 14][i], notes: null,
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

/**
 * Custom journeys, seeded across two scopes so accumulation is visible: the
 * tenant's own composed journey stays available inside Indirect rather than
 * being replaced by the one the category composed for itself.
 */
const TENANT_JOURNEY: CustomJourney = {
  id: 'CJ-01',
  name: 'Sealed RFP with negotiation',
  description:
    'High-value services where price stays sealed until the technical panel has scored, and the shortlist is then negotiated rather than auctioned.',
  side: 'BUY',
  stages: ['INTAKE', 'RFP', 'CLARIFICATION', 'EVALUATION', 'NEGOTIATION', 'AWARD', 'APPROVAL'],
  vendorInputPoints: ['RFP', 'NEGOTIATION'],
  basedOn: 'JP-06',
  scopeType: 'TENANT',
  scopeId: 'tenant-udaan',
  createdBy: 'user-ar',
  createdAt: SEED_NOW - 60 * DAY,
};

const CATEGORY_JOURNEY: CustomJourney = {
  id: 'CJ-02',
  name: 'Indirect quick quote',
  description:
    'Three quotes and an award for low-value indirect spend. No approval stage — the DoA floor already covers this band.',
  side: 'BUY',
  stages: ['INTAKE', 'RFQ', 'AWARD'],
  vendorInputPoints: ['RFQ'],
  basedOn: 'JP-11',
  scopeType: 'CATEGORY',
  scopeId: 'Indirect',
  createdBy: 'user-ar',
  createdAt: SEED_NOW - 20 * DAY,
};

CONFIG_SETTINGS.push(
  {
    key: JOURNEY_CUSTOM_KEY, scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: [TENANT_JOURNEY], isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 60 * DAY,
  },
  {
    key: JOURNEY_CUSTOM_KEY, scopeType: 'CATEGORY', scopeId: 'Indirect',
    value: [CATEGORY_JOURNEY], isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 20 * DAY,
  },
  {
    // Indirect is a buy-side category: the two sell-side patterns are not
    // offered, and neither is the rate-contract call-off it does not hold.
    key: JOURNEY_ENABLED_KEY, scopeType: 'CATEGORY', scopeId: 'Indirect',
    value: [
      'JP-01', 'JP-02', 'JP-03', 'JP-04', 'JP-05', 'JP-06', 'JP-07',
      'JP-09', 'JP-10', 'JP-11', 'CJ-01', 'CJ-02',
    ],
    isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 20 * DAY,
  },
);

/**
 * Questionnaire templates are scoped like custom journeys: they accumulate down
 * the chain, so the tenant library stays available inside a category that adds
 * its own. The stage weighting resolves narrowest-wins like an ordinary
 * setting, and Indirect overrides it to lean harder on qualification.
 */
CONFIG_SETTINGS.push(
  {
    key: TEMPLATE_CUSTOM_KEY, scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: TENANT_TEMPLATES, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 180 * DAY,
  },
  {
    key: TEMPLATE_CUSTOM_KEY, scopeType: 'CATEGORY', scopeId: 'Indirect',
    value: CATEGORY_TEMPLATES, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 40 * DAY,
  },
  {
    key: TEMPLATE_WEIGHTING_KEY, scopeType: 'TENANT', scopeId: 'tenant-udaan',
    value: DEFAULT_STAGE_WEIGHTING, isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 180 * DAY,
  },
  {
    key: TEMPLATE_WEIGHTING_KEY, scopeType: 'CATEGORY', scopeId: 'Indirect',
    value: [
      { point: 'INTAKE', weight: 0 },
      { point: 'RFI', weight: 35 },
      { point: 'RFP', weight: 45 },
      { point: 'RFQ', weight: 20 },
      { point: 'NEGOTIATION', weight: 0 },
      { point: 'AUCTION', weight: 0 },
    ],
    isLocked: false, setBy: 'user-ar', setAt: SEED_NOW - 40 * DAY,
  },
);

export const SCOPE_LINEAGE = {
  tenantId: 'tenant-udaan',
  categoryId: 'Indirect',
  templateId: 'tpl-full-ladder',
  eventId: PRIMARY_EVENT_ID,
};

// ---------------------------------------------------------------------------
// The auction book
// ---------------------------------------------------------------------------

/**
 * Five auctions, five mechanisms, all running at once.
 *
 * One seeded auction was enough while the cockpit only ever rendered English.
 * It is not enough now: a Japanese round, a Dutch clock and a sealed envelope
 * are different screens with different controller actions, and a demonstration
 * that cannot show them side by side cannot show that the mechanism is
 * configuration rather than a separate build.
 *
 * Each carries the state its mechanism is actually in — a Japanese auction
 * three rounds deep with two suppliers already out, a Dutch clock mid-tick, a
 * sealed bid with submissions in and nothing revealed.
 */
export interface SeededAuction {
  auction: Auction;
  lots: AuctionLot[];
  bids: Bid[];
  bidders: EventBidder[];
  /**
   * What the controller has already done.
   *
   * Not decoration. In the mechanisms the controller drives, the live state is
   * derived from this log — a Japanese auction three rounds deep is three
   * ROUND_ADVANCED events, and seeding the acceptances without them would
   * describe an auction still in its first round with bids from its third.
   */
  controlEvents?: AuctionControlEvent[];
}

const controlEvent = (
  auctionId: string, kind: AuctionControlEvent['kind'], at: number, reason: string, i: number,
): AuctionControlEvent => ({
  id: `${auctionId}-ctrl-${i}`, auctionId, kind, actorId: 'user-mp', reason, at, detail: null,
});

const auctionBidder = (
  eventId: string, counterpartyId: string, i: number,
  over: Partial<EventBidder> = {},
): EventBidder => {
  const counterparty = COUNTERPARTIES.find((c) => c.id === counterpartyId);
  return {
    id: `${eventId}-eb-${counterpartyId}`,
    eventId,
    counterpartyId,
    isProvisional: false,
    invitedAt: SEED_NOW - 6 * DAY,
    invitationStatus: 'ACCEPTED',
    declineReason: null,
    ndaAcceptedAt: SEED_NOW - 5 * DAY,
    participationStatus: 'JOINED',
    qualificationStatus: 'QUALIFIED',
    awardStatus: 'NONE',
    qualificationSnapshot: counterparty?.onboardingRating ?? 0,
    performanceRatingSnapshot: counterparty?.performanceRating ?? 0,
    bidOnBehalfAllowed: false,
    maskedLabel: `Bidder ${String.fromCharCode(65 + i)}`,
    disqualified: false,
    disqualificationReason: null,
    ...over,
  };
};

const auctionBid = (
  auctionId: string, auctionLotId: string, bidderId: string,
  bidValue: number, transformedValue: number, at: number, sequence: number,
): Bid => ({
  id: `${auctionId}-bid-${sequence}`,
  auctionId, auctionLotId, lineItemId: null, bidderId,
  bidValue, transformedValue, currency: BASE_EVENT_CURRENCY,
  rankAtSubmission: 1, submittedAt: at, source: 'PORTAL',
  submittedByUserId: `portal-${bidderId}`, onBehalfReason: null,
  clientTimestamp: at + 900, ipHash: `ip-${bidderId}`,
  isValid: true, rejectionReason: null, sequenceNumber: sequence,
});

const BASE_EVENT_CURRENCY = 'INR';

/** A shell auction; each seeded one overrides what its mechanism needs. */
const baseAuction = (
  id: string, auctionNumber: string, eventId: string, side: Side,
): Auction => ({
  id, auctionNumber, eventId, side,
  mechanism: 'ENGLISH', clockOwner: 'BIDDER', rounds: 'CONTINUOUS',
  feedbackPolicy: 'RANK_ONLY', identityPolicy: 'MASKED',
  lotStrategy: 'INDEPENDENT', biddingLevel: 'LOT', closePolicy: 'SOFT_EXTENSION',
  transformation: 'NONE', proxyBidding: false,
  status: 'SCHEDULED',
  startsAt: null, endsAt: null, extensionsUsed: 0,
  discloseTarget: false, trafficAmberBandPct: 5,
  antiGaming: { ...DEFAULT_ANTI_GAMING },
  parameters: defaultParameters('ENGLISH'),
  startingPriceSource: 'Budget',
  targetPriceDerivation: null,
});

/**
 * AUC-2024-002 — structural steel, Japanese, live and three rounds in.
 *
 * Blind by necessity: a Japanese auction has no ranking to report, only who is
 * still in, and telling a bidder that would tell them how much pressure is left.
 */
function japaneseAuction(): SeededAuction {
  const eventId = 'evt-auc-002';
  const auctionId = 'auc-steel';
  const auctionNumber = 'EA-2026-0002';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-summit', 'cp-voltek', 'cp-keystone', 'cp-nova', 'cp-orion'];
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'JAPANESE', clockOwner: 'SYSTEM', rounds: 'DISCRETE',
      parameters: defaultParameters('JAPANESE'),
      feedbackPolicy: 'BLIND', closePolicy: 'LAST_STANDING',
      status: 'LIVE',
      startsAt: SEED_NOW - 22 * MINUTE,
      endsAt: SEED_NOW + 18 * MINUTE,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 2.5 },
      startingPriceSource: 'Should-cost model, Q3 steel index',
      targetPriceDerivation: 'Should-cost + 4%',
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id,
      status: i === 0 ? ('LOT_OPEN' as const) : ('LOT_PENDING' as const),
      startingPrice: [4_80_000, 2_60_000][i] ?? 1_00_000,
      opensAt: SEED_NOW - 22 * MINUTE,
      closesAt: SEED_NOW + 18 * MINUTE,
    })),
    // In a Japanese auction a "bid" is a round accepted at the clock price.
    // Three rounds have run; Keystone and Orion did not confirm round 3.
    bids: [
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-summit`, 4_80_000, 4_80_000, SEED_NOW - 20 * MINUTE, 1),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-voltek`, 4_80_000, 4_80_000, SEED_NOW - 20 * MINUTE, 2),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-keystone`, 4_80_000, 4_80_000, SEED_NOW - 20 * MINUTE, 3),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-nova`, 4_80_000, 4_80_000, SEED_NOW - 20 * MINUTE, 4),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-orion`, 4_80_000, 4_80_000, SEED_NOW - 20 * MINUTE, 5),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-summit`, 4_68_000, 4_68_000, SEED_NOW - 14 * MINUTE, 6),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-voltek`, 4_68_000, 4_68_000, SEED_NOW - 14 * MINUTE, 7),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-nova`, 4_68_000, 4_68_000, SEED_NOW - 14 * MINUTE, 8),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-summit`, 4_56_300, 4_56_300, SEED_NOW - 6 * MINUTE, 9),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-voltek`, 4_56_300, 4_56_300, SEED_NOW - 6 * MINUTE, 10),
    ],
    bidders: shortlist.map((cp, i) =>
      auctionBidder(eventId, cp, i, {
        participationStatus:
          cp === 'cp-keystone' || cp === 'cp-orion' ? 'DROPPED_OUT' : 'BIDDING',
      })),
    // Two rounds have been advanced, which is what puts the clock at the third
    // price and Keystone and Orion off it.
    controlEvents: [
      controlEvent(auctionId, 'ROUND_ADVANCED', SEED_NOW - 7 * MINUTE, 'Round three.', 2),
      controlEvent(auctionId, 'ROUND_ADVANCED', SEED_NOW - 15 * MINUTE, 'Round two.', 1),
    ],
  };
}

/**
 * SELL-2024-003 — surplus plant, Dutch, sell-side, clock running.
 *
 * Sell-side inverts it: the clock falls from an ambitious opening until a buyer
 * takes it. Every direction word on both applications reads from `side`, and
 * this is the seeded event that proves it.
 */
function dutchAuction(): SeededAuction {
  const eventId = 'evt-sell-003';
  const auctionId = 'auc-surplus';
  const auctionNumber = 'EA-2026-0003';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-cargo', 'cp-transline', 'cp-summit'];
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'SELL'),
      mechanism: 'DUTCH', clockOwner: 'SYSTEM',
      parameters: defaultParameters('DUTCH'),
      feedbackPolicy: 'BLIND', closePolicy: 'FIRST_ACCEPT',
      status: 'LIVE',
      startsAt: SEED_NOW - 3 * MINUTE,
      endsAt: SEED_NOW + 9 * MINUTE,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 1.5 },
      startingPriceSource: 'Reserve set by asset register',
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: i === 0 ? ('LOT_OPEN' as const) : ('LOT_PENDING' as const),
      startingPrice: [1_80_000, 95_000][i] ?? 60_000,
      opensAt: SEED_NOW - 3 * MINUTE,
      closesAt: SEED_NOW + 9 * MINUTE,
    })),
    // Nobody has accepted. In this format that is the whole state.
    bids: [],
    bidders: shortlist.map((cp, i) => auctionBidder(eventId, cp, i, { participationStatus: 'JOINED' })),
  };
}

/**
 * RFQ-2024-039 — sealed bid, scheduled, submissions arriving.
 *
 * Two of four have submitted. The count is visible to the controller because a
 * count is not a disclosure; the values are not visible to anybody, including
 * the controller, until the envelopes are opened.
 */
function sealedAuction(): SeededAuction {
  const eventId = 'evt-rfq-039';
  const auctionId = 'auc-sealed';
  const auctionNumber = 'EA-2026-0004';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-nova', 'cp-orion', 'cp-meridian', 'cp-anchor'];
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'SEALED_BID', rounds: 'SINGLE',
      parameters: defaultParameters('SEALED_BID'),
      feedbackPolicy: 'BLIND', closePolicy: 'REVEAL_AT_TIME',
      status: 'LIVE',
      startsAt: SEED_NOW - 2 * DAY,
      endsAt: SEED_NOW + 26 * HOUR,
      startingPriceSource: 'Last purchase price',
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: 'LOT_OPEN' as const,
      startingPrice: [2_80_000][i] ?? 1_40_000,
      opensAt: SEED_NOW - 2 * DAY,
      closesAt: SEED_NOW + 26 * HOUR,
    })),
    bids: [
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-nova`, 2_62_000, 2_62_000, SEED_NOW - 20 * HOUR, 1),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-meridian`, 2_71_500, 2_71_500, SEED_NOW - 9 * HOUR, 2),
    ],
    bidders: shortlist.map((cp, i) =>
      auctionBidder(eventId, cp, i, {
        participationStatus:
          cp === 'cp-nova' || cp === 'cp-meridian' ? 'BIDDING' : 'REGISTERED',
      })),
  };
}

/**
 * RFP-2024-012 — multi-attribute, live.
 *
 * Price is one input of four. The composite is what ranks, which is why the
 * feedback policy is rank-based: a bare "best price" would tell a bidder they
 * are losing on a number that is not the one deciding the outcome.
 */
function multiAttributeAuction(): SeededAuction {
  const eventId = 'evt-rfp-012';
  const auctionId = 'auc-multi';
  const auctionNumber = 'EA-2026-0005';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-meridian', 'cp-anchor', 'cp-brightpath'];
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'MULTI_ATTRIBUTE',
      parameters: defaultParameters('MULTI_ATTRIBUTE'),
      feedbackPolicy: 'RANK_GAP', closePolicy: 'SOFT_EXTENSION',
      status: 'LIVE',
      startsAt: SEED_NOW - 8 * MINUTE,
      endsAt: SEED_NOW + 34 * MINUTE,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 1 },
      startingPriceSource: 'Budget envelope',
      targetPriceDerivation: 'Benchmark − 6%',
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: i === 0 ? ('LOT_OPEN' as const) : ('LOT_PENDING' as const),
      startingPrice: [3_40_000][i] ?? 1_20_000,
      opensAt: SEED_NOW - 8 * MINUTE,
      closesAt: SEED_NOW + 34 * MINUTE,
    })),
    bids: [
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-meridian`, 3_18_000, 3_18_000, SEED_NOW - 6 * MINUTE, 1),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-anchor`, 3_24_500, 3_24_500, SEED_NOW - 5 * MINUTE, 2),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-brightpath`, 3_09_000, 3_09_000, SEED_NOW - 2 * MINUTE, 3),
    ],
    bidders: shortlist.map((cp, i) => auctionBidder(eventId, cp, i, { participationStatus: 'BIDDING' })),
  };
}

/**
 * The scored attributes a multi-attribute auction ranks on.
 *
 * Published to bidders before the event — undisclosed weights invite disputes,
 * so they are part of the seeded configuration rather than a buyer secret.
 */
export const MULTI_ATTRIBUTE_SCHEME: ScoredAttribute[] = [
  { key: 'price', label: 'Price', unit: '₹', weight: 55, betterIs: 'LOWER', best: 2_80_000, worst: 3_60_000 },
  { key: 'leadTime', label: 'Lead time', unit: 'days', weight: 20, betterIs: 'LOWER', best: 7, worst: 30 },
  { key: 'warranty', label: 'Warranty', unit: 'months', weight: 15, betterIs: 'HIGHER', best: 36, worst: 12 },
  { key: 'paymentDays', label: 'Payment terms', unit: 'days credit', weight: 10, betterIs: 'HIGHER', best: 90, worst: 30 },
];

/** The index an index-linked auction quotes against. */
export const SEED_INDEX: IndexLink = {
  name: 'MCX Aluminium, spot',
  source: 'Multi Commodity Exchange of India',
  value: 2_41_500,
  asOf: SEED_NOW - 18 * HOUR,
  offsetType: 'PCT',
};

/** Every auction in the tenant, keyed by the event it belongs to. */
/**
 * Traffic light — the whole format is its feedback.
 *
 * Bidders are told a colour against the buyer's target and nothing else: no
 * rank, no leading price, no field count. The colours only mean anything
 * because the lot carries a target, which is why this basket seeds one.
 */
function trafficLightAuction(): SeededAuction {
  const eventId = 'evt-auc-tl';
  const auctionId = 'auc-traffic';
  const auctionNumber = 'EA-2026-0006';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-abc', 'cp-prime', 'cp-global', 'cp-metro'];
  const start = SEED_NOW - 22 * MINUTE;
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'TRAFFIC_LIGHT',
      parameters: defaultParameters('TRAFFIC_LIGHT'),
      // The mechanism *is* the policy. Anything else contradicts it, and the
      // profile's `incompatibleFeedback` refuses to let it be set.
      feedbackPolicy: 'TRAFFIC_LIGHT', identityPolicy: 'MASKED',
      closePolicy: 'SOFT_EXTENSION',
      status: 'LIVE',
      startsAt: start,
      endsAt: SEED_NOW + 42 * MINUTE,
      trafficAmberBandPct: 6,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 0.5 },
      startingPriceSource: 'Last purchase price + volume uplift',
      targetPriceDerivation: 'Should-cost model, Q3 board rate',
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: 'LOT_OPEN' as const,
      startingPrice: 6_32_000,
      opensAt: start,
      closesAt: SEED_NOW + 42 * MINUTE,
    })),
    // A spread that lands one bidder in each band, so the format shows what
    // it does: red well away, amber close, green at or past the target.
    bids: [
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-abc`, 6_18_000, 6_18_000, start + 3 * MINUTE, 1),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-prime`, 6_04_000, 6_04_000, start + 6 * MINUTE, 2),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-global`, 5_88_000, 5_88_000, start + 9 * MINUTE, 3),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-abc`, 5_79_000, 5_79_000, start + 13 * MINUTE, 4),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-metro`, 5_66_000, 5_66_000, start + 16 * MINUTE, 5),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-prime`, 5_58_000, 5_58_000, start + 19 * MINUTE, 6),
    ],
    bidders: shortlist.map((cp, i) => auctionBidder(eventId, cp, i, { participationStatus: 'BIDDING' })),
    controlEvents: [controlEvent(auctionId, 'OPENED', start, 'Auction opened by the controller.', 1)],
  };
}

/**
 * Index-linked — the bid is a premium, not a price.
 *
 * Bidders quote an offset to a published index, so the comparison is of
 * premiums and the settlement price moves with the market after award. The
 * figures below are the premium per tonne.
 */
function indexAuction(): SeededAuction {
  const eventId = 'evt-auc-idx';
  const auctionId = 'auc-index';
  const auctionNumber = 'EA-2026-0007';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-voltek', 'cp-orion', 'cp-nova'];
  const start = SEED_NOW - 30 * MINUTE;
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'INDEX_LINKED',
      parameters: defaultParameters('INDEX_LINKED'),
      feedbackPolicy: 'RANK_GAP', closePolicy: 'SOFT_EXTENSION',
      status: 'LIVE',
      startsAt: start,
      endsAt: SEED_NOW + 55 * MINUTE,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'ABSOLUTE', minDecrement: 500 },
      startingPriceSource: 'LME cash settlement + conversion premium',
      targetPriceDerivation: null,
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: 'LOT_OPEN' as const,
      startingPrice: 18_50_000,
      opensAt: start,
      closesAt: SEED_NOW + 55 * MINUTE,
    })),
    bids: [
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-voltek`, 18_20_000, 18_20_000, start + 4 * MINUTE, 1),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-orion`, 18_02_000, 18_02_000, start + 8 * MINUTE, 2),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-nova`, 17_84_000, 17_84_000, start + 14 * MINUTE, 3),
      auctionBid(auctionId, `${auctionId}-al-1`, `${eventId}-eb-cp-voltek`, 17_66_000, 17_66_000, start + 21 * MINUTE, 4),
    ],
    bidders: shortlist.map((cp, i) => auctionBidder(eventId, cp, i, { participationStatus: 'BIDDING' })),
    controlEvents: [controlEvent(auctionId, 'OPENED', start, 'Auction opened by the controller.', 1)],
  };
}

/**
 * An English auction that has not started, with the practice run open.
 *
 * Seeded in this state deliberately: every other seeded auction is already
 * running, so there was nowhere in the prototype to see a rehearsal at all.
 * This is the one a supplier walks into to learn the controls before the
 * clock matters.
 */
function scheduledEnglishAuction(): SeededAuction {
  const eventId = 'evt-auc-eng';
  const auctionId = 'auc-english-2';
  const auctionNumber = 'EA-2026-0008';
  const lots = OTHER_EVENT_LOTS.filter((l) => l.eventId === eventId);
  const shortlist = ['cp-abc', 'cp-prime', 'cp-brightpath'];
  const opensAt = SEED_NOW + 45 * MINUTE;
  return {
    auction: {
      ...baseAuction(auctionId, auctionNumber, eventId, 'BUY'),
      mechanism: 'ENGLISH',
      parameters: defaultParameters('ENGLISH'),
      feedbackPolicy: 'RANK_GAP', closePolicy: 'SOFT_EXTENSION',
      status: 'SCHEDULED',
      startsAt: opensAt,
      endsAt: opensAt + 45 * MINUTE,
      antiGaming: { ...DEFAULT_ANTI_GAMING, minDecrementType: 'PCT', minDecrement: 1 },
      startingPriceSource: 'Last purchase price',
      targetPriceDerivation: null,
    },
    lots: lots.map((lot, i) => ({
      id: `${auctionId}-al-${i + 1}`,
      auctionId, lotId: lot.id, status: 'LOT_PENDING' as const,
      startingPrice: 5_33_000,
      opensAt,
      closesAt: opensAt + 45 * MINUTE,
    })),
    bids: [],
    bidders: shortlist.map((cp, i) => auctionBidder(eventId, cp, i, { participationStatus: 'REGISTERED' })),
    controlEvents: [
      controlEvent(
        auctionId, 'REHEARSAL_OPENED', SEED_NOW - 40 * MINUTE,
        'Practice run opened so bidders can learn the format before the clock starts.', 1,
      ),
    ],
  };
}

export function AUCTIONS_BY_EVENT(): Record<string, AuctionStateShape> {
  const lotDetails = Object.fromEntries(
    [...LOTS, ...OTHER_EVENT_LOTS].map((l) => [l.id, l]),
  );

  const primary: AuctionStateShape = {
    auction: AUCTION,
    lots: AUCTION_LOTS,
    lotDetails,
    bids: SEED_BIDS,
    bidders: EVENT_BIDDERS,
    costComponents: COST_COMPONENTS,
    controlEvents: [],
    integrityFlags: [],
  };

  const book: Record<string, AuctionStateShape> = { [PRIMARY_EVENT_ID]: primary };
  const seededAuctions = [
    japaneseAuction(), dutchAuction(), sealedAuction(), multiAttributeAuction(),
    trafficLightAuction(), indexAuction(), scheduledEnglishAuction(),
  ];
  for (const seeded of seededAuctions) {
    book[seeded.auction.eventId] = {
      auction: seeded.auction,
      lots: seeded.lots,
      lotDetails,
      bids: seeded.bids,
      bidders: seeded.bidders,
      // Transformation is off on these, so there is nothing to apply.
      costComponents: [],
      controlEvents: seeded.controlEvents ?? [],
      integrityFlags: [],
    };
  }
  return book;
}

/** The shape `server/auctionService` works in, declared here to avoid a cycle. */
export interface AuctionStateShape {
  auction: Auction;
  lots: AuctionLot[];
  lotDetails: Record<string, Lot>;
  bids: Bid[];
  bidders: EventBidder[];
  costComponents: CostComponent[];
  controlEvents: AuctionControlEvent[];
  integrityFlags: never[];
}
