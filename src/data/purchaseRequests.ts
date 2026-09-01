/**
 * Purchase request seed data.
 *
 * Requisition lines are *generated* rather than hand-written, because the point
 * of this screen is what happens at 100 lines, not at three. A hand-written
 * fixture large enough to prove the expansion works would be unreadable, and a
 * fixture small enough to read would prove nothing.
 *
 * The generator is a fixed-seed LCG, so the data is identical on every reload
 * and every machine — a requisition that changed shape between refreshes would
 * make the screen impossible to review. `Math.random` is never called.
 *
 * Sizes are deliberately spread from 1 line to 100: RQ-TGRANL-00108 carries the
 * full 100, and 00033, 00124, 00122, 00119 and 00115 sit at 20, 24, 38, 57 and
 * 76 so the expansion is exercised across the range rather than at one point.
 */
import type {
  PrLineSourcingState, PrStatus, PurchaseRequest, PurchaseRequestLine,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

function between(rand: () => number, low: number, high: number, step = 1): number {
  const span = Math.floor((high - low) / step) + 1;
  return low + (Math.floor(rand() * span) % span) * step;
}

function addDays(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Item catalogues — one per category, each with enough combinations for 100
// distinct lines in a single requisition.
// ---------------------------------------------------------------------------

interface ItemFamily {
  code: string;
  noun: string;
  variants: string[];
  uom: string;
  priceLow: number;
  priceHigh: number;
  qtyLow: number;
  qtyHigh: number;
  spec: string;
}

const CATALOGUES: Record<string, ItemFamily[]> = {
  'IT Hardware': [
    { code: 'LAP', noun: 'Laptop', variants: ['13in i5 16GB', '14in i5 16GB', '14in i7 16GB', '14in i7 32GB', '15in i7 32GB', '16in i9 32GB', '16in i9 64GB', '14in Ryzen 7 16GB', '15in Ryzen 9 32GB', '13in ARM 16GB'], uom: 'each', priceLow: 780, priceHigh: 2_400, qtyLow: 4, qtyHigh: 90, spec: '3-year onsite warranty, TPM 2.0, corporate image pre-loaded' },
    { code: 'MON', noun: 'Monitor', variants: ['22in FHD', '24in FHD', '24in QHD', '27in QHD', '27in 4K', '32in 4K', '34in ultrawide', '38in ultrawide', '27in colour-calibrated', '24in portrait-mount'], uom: 'each', priceLow: 120, priceHigh: 890, qtyLow: 6, qtyHigh: 140, spec: 'VESA 100, USB-C 65W passthrough, height adjustable' },
    { code: 'DOK', noun: 'Docking station', variants: ['USB-C 65W', 'USB-C 100W', 'Thunderbolt 4', 'Thunderbolt 4 dual-4K', 'USB-A legacy', 'USB-C travel', 'Thunderbolt 5', 'USB-C dual-DP', 'USB-C single-HDMI', 'USB-C with 2.5GbE'], uom: 'each', priceLow: 90, priceHigh: 420, qtyLow: 5, qtyHigh: 120, spec: 'Minimum 2 display outputs, wake-on-LAN, MAC address passthrough' },
    { code: 'SRV', noun: 'Rack server', variants: ['1U 32GB', '1U 64GB', '2U 64GB', '2U 128GB', '2U 256GB', '4U 256GB', '1U GPU-ready', '2U GPU 2-slot', '2U all-flash', '1U edge'], uom: 'each', priceLow: 3_200, priceHigh: 18_500, qtyLow: 1, qtyHigh: 16, spec: 'Redundant PSU, iLO/iDRAC enterprise licence, 5-year NBD' },
    { code: 'NET', noun: 'Network switch', variants: ['24-port 1G', '48-port 1G', '24-port PoE+', '48-port PoE+', '24-port 10G', '48-port 10G', '12-port 25G', '32-port 100G', '8-port industrial', '16-port fanless'], uom: 'each', priceLow: 340, priceHigh: 12_000, qtyLow: 2, qtyHigh: 40, spec: 'Layer 3 licensed, stackable, dual redundant PSU' },
    { code: 'PRN', noun: 'Multifunction printer', variants: ['A4 mono 40ppm', 'A4 colour 30ppm', 'A4 colour 45ppm', 'A3 mono 35ppm', 'A3 colour 30ppm', 'A3 colour 50ppm', 'A4 mono 55ppm', 'A4 desktop 25ppm', 'A3 production 70ppm', 'A4 secure-print 40ppm'], uom: 'each', priceLow: 380, priceHigh: 6_400, qtyLow: 1, qtyHigh: 26, spec: 'Badge release, LDAP scan-to-folder, duplex ADF' },
    { code: 'UPS', noun: 'UPS', variants: ['1kVA tower', '2kVA tower', '3kVA rack', '5kVA rack', '6kVA rack', '10kVA rack', '15kVA modular', '20kVA modular', '1.5kVA line-interactive', '3kVA online'], uom: 'each', priceLow: 210, priceHigh: 8_900, qtyLow: 1, qtyHigh: 24, spec: 'Online double conversion, SNMP card, 10-minute runtime at full load' },
    { code: 'HDS', noun: 'Headset', variants: ['USB mono', 'USB stereo', 'USB-C stereo', 'Bluetooth duo', 'Bluetooth mono', 'DECT wireless', 'ANC over-ear', 'ANC on-ear', 'Contact-centre wired', 'Conference speakerphone'], uom: 'each', priceLow: 28, priceHigh: 340, qtyLow: 20, qtyHigh: 400, spec: 'Certified for Teams, noise-cancelling boom, replaceable ear cushions' },
    { code: 'TAB', noun: 'Tablet', variants: ['8in 64GB', '10in 64GB', '10in 128GB', '11in 128GB', '11in 256GB', '12in 256GB', '12in 512GB LTE', '10in rugged', '8in rugged', '13in detachable'], uom: 'each', priceLow: 180, priceHigh: 1_450, qtyLow: 4, qtyHigh: 80, spec: 'MDM enrolment ready, tempered glass, 2-year accidental damage' },
    { code: 'CAM', noun: 'Conference camera', variants: ['1080p fixed', '1080p PTZ', '4K fixed', '4K PTZ', '4K dual-lens', '360 tabletop', 'Huddle-room bar', 'Medium-room bar', 'Large-room bar', 'Ceiling microphone array'], uom: 'each', priceLow: 120, priceHigh: 3_800, qtyLow: 2, qtyHigh: 48, spec: 'Auto-framing, USB-C and PoE, wall and ceiling mount included' },
  ],

  'Office & Administrative': [
    { code: 'PPR', noun: 'Copier paper', variants: ['A4 70gsm', 'A4 75gsm', 'A4 80gsm', 'A4 90gsm', 'A4 100gsm', 'A3 80gsm', 'A3 90gsm', 'A5 80gsm', 'Legal 80gsm', 'Letter 80gsm'], uom: 'ream', priceLow: 3.2, priceHigh: 12.4, qtyLow: 200, qtyHigh: 6_000, spec: 'FSC certified, 500 sheets, whiteness 161 CIE' },
    { code: 'MKR', noun: 'Marker', variants: ['whiteboard black', 'whiteboard assorted', 'permanent black', 'permanent assorted', 'highlighter yellow', 'highlighter assorted', 'flipchart assorted', 'fine-tip black', 'chisel-tip assorted', 'dry-wipe refillable'], uom: 'box', priceLow: 4.1, priceHigh: 22.5, qtyLow: 40, qtyHigh: 900, spec: 'Box of 10, low-odour, xylene free' },
    { code: 'FLD', noun: 'Lever arch file', variants: ['A4 50mm', 'A4 70mm', 'A4 80mm', 'A3 70mm', 'Foolscap 70mm', 'A4 board 50mm', 'A4 PP 70mm', 'A4 recycled 70mm', 'A5 40mm', 'A4 slim 40mm'], uom: 'each', priceLow: 1.8, priceHigh: 9.2, qtyLow: 100, qtyHigh: 1_600, spec: '100% recycled board, metal shoe, replaceable spine label' },
    { code: 'ENV', noun: 'Envelope', variants: ['DL white', 'DL window', 'C5 white', 'C5 window', 'C4 white', 'C4 window', 'C4 gusset', 'Board-backed A4', 'Padded size 3', 'Padded size 7'], uom: 'box', priceLow: 6.5, priceHigh: 48, qtyLow: 20, qtyHigh: 400, spec: 'Box of 500, self-seal, 90gsm' },
    { code: 'NBK', noun: 'Notebook', variants: ['A4 ruled', 'A4 squared', 'A5 ruled', 'A5 squared', 'A5 dotted', 'A6 ruled', 'A4 hardback', 'A5 hardback', 'A4 spiral', 'A5 spiral'], uom: 'each', priceLow: 1.1, priceHigh: 8.4, qtyLow: 150, qtyHigh: 2_400, spec: '80 leaf, 70gsm, recycled cover board' },
    { code: 'TNR', noun: 'Toner cartridge', variants: ['mono standard', 'mono high-yield', 'cyan standard', 'cyan high-yield', 'magenta standard', 'magenta high-yield', 'yellow standard', 'yellow high-yield', 'drum unit mono', 'drum unit colour'], uom: 'each', priceLow: 34, priceHigh: 260, qtyLow: 10, qtyHigh: 320, spec: 'OEM or approved equivalent, empties collected for recycling' },
    { code: 'CLN', noun: 'Cleaning consumable', variants: ['hand towel roll', 'centre-feed roll', 'toilet tissue 2-ply', 'liquid soap 5L', 'sanitiser gel 5L', 'surface spray 750ml', 'glass cleaner 750ml', 'floor cleaner 5L', 'bin liner 90L', 'bin liner 50L'], uom: 'case', priceLow: 8.9, priceHigh: 62, qtyLow: 30, qtyHigh: 700, spec: 'EU Ecolabel where available, unscented' },
    { code: 'PNT', noun: 'Pen', variants: ['ballpoint blue', 'ballpoint black', 'ballpoint red', 'gel blue', 'gel black', 'rollerball blue', 'rollerball black', 'fineliner assorted', 'mechanical pencil 0.5', 'mechanical pencil 0.7'], uom: 'box', priceLow: 2.4, priceHigh: 18, qtyLow: 60, qtyHigh: 1_200, spec: 'Box of 12, 1.0mm medium tip' },
    { code: 'DSK', noun: 'Desk accessory', variants: ['monitor riser', 'footrest', 'document holder', 'desk tidy', 'letter tray 3-tier', 'laptop stand', 'wrist rest', 'cable tray', 'privacy screen 24in', 'privacy screen 27in'], uom: 'each', priceLow: 6, priceHigh: 78, qtyLow: 20, qtyHigh: 500, spec: 'DSE assessment compliant, adjustable' },
    { code: 'BAT', noun: 'Battery', variants: ['AA alkaline', 'AAA alkaline', 'AA rechargeable', 'AAA rechargeable', 'C alkaline', 'D alkaline', '9V alkaline', 'CR2032', 'CR2450', 'AA lithium'], uom: 'pack', priceLow: 2.8, priceHigh: 24, qtyLow: 40, qtyHigh: 800, spec: 'Pack of 10, mercury free, 7-year shelf life' },
  ],

  'Facilities & MRO': [
    { code: 'BRG', noun: 'Bearing', variants: ['6204 2RS', '6205 2RS', '6206 2RS', '6207 2RS', '6208 2RS', '6305 2RS', '6306 2RS', '22208 spherical', '22210 spherical', 'NU309 cylindrical'], uom: 'each', priceLow: 4.2, priceHigh: 180, qtyLow: 20, qtyHigh: 600, spec: 'C3 clearance, sealed both sides, OEM or SKF/FAG equivalent' },
    { code: 'BLT', noun: 'V-belt', variants: ['A-section 1000mm', 'A-section 1250mm', 'B-section 1400mm', 'B-section 1600mm', 'B-section 1800mm', 'C-section 2000mm', 'SPZ 1180', 'SPA 1400', 'SPB 1800', 'Timing belt 8M'], uom: 'each', priceLow: 3.8, priceHigh: 96, qtyLow: 20, qtyHigh: 400, spec: 'Anti-static, oil resistant, matched set where multiple' },
    { code: 'FLT', noun: 'Filter', variants: ['air panel G4', 'air panel F7', 'air bag F9', 'HEPA H13', 'hydraulic 10 micron', 'hydraulic 25 micron', 'water 5 micron', 'water 20 micron', 'oil spin-on', 'compressed-air coalescing'], uom: 'each', priceLow: 6.5, priceHigh: 240, qtyLow: 15, qtyHigh: 500, spec: 'To OEM part number, media efficiency certified to EN779' },
    { code: 'LUB', noun: 'Lubricant', variants: ['EP2 grease 400g', 'EP2 grease 18kg', 'ISO 32 hydraulic 20L', 'ISO 46 hydraulic 20L', 'ISO 68 gear 20L', 'ISO 220 gear 20L', 'food-grade grease 400g', 'food-grade oil 20L', 'chain lube 5L', 'penetrating spray 400ml'], uom: 'each', priceLow: 4.9, priceHigh: 320, qtyLow: 10, qtyHigh: 300, spec: 'NSF H1 where food-contact, SDS supplied with delivery' },
    { code: 'FST', noun: 'Fastener', variants: ['M6 x 20 A2', 'M8 x 25 A2', 'M8 x 40 A4', 'M10 x 30 A2', 'M10 x 50 A4', 'M12 x 40 A2', 'M12 x 60 A4', 'M16 x 60 8.8', 'M20 x 80 8.8', 'M24 x 100 8.8'], uom: 'box', priceLow: 8.4, priceHigh: 145, qtyLow: 10, qtyHigh: 260, spec: 'Box of 100, DIN 933, certificate 3.1 on request' },
    { code: 'VLV', noun: 'Valve', variants: ['ball 1/2in', 'ball 3/4in', 'ball 1in', 'ball 2in', 'gate 2in', 'gate 3in', 'butterfly DN80', 'butterfly DN100', 'check DN50', 'pressure relief DN25'], uom: 'each', priceLow: 12, priceHigh: 780, qtyLow: 5, qtyHigh: 150, spec: 'PN16, stainless 316 body, PTFE seat' },
    { code: 'PPE', noun: 'PPE', variants: ['safety helmet', 'safety glasses clear', 'safety glasses tinted', 'ear defenders', 'ear plugs box', 'cut-5 gloves', 'nitrile gloves box', 'hi-vis vest', 'hi-vis jacket', 'safety boots S3'], uom: 'each', priceLow: 1.9, priceHigh: 96, qtyLow: 40, qtyHigh: 900, spec: 'CE marked, EN standard printed on item, size mix per attached schedule' },
    { code: 'PMP', noun: 'Pump', variants: ['centrifugal 2.2kW', 'centrifugal 4kW', 'centrifugal 7.5kW', 'submersible 1.5kW', 'submersible 3kW', 'diaphragm 1in', 'diaphragm 2in', 'gear 0.75kW', 'vacuum 1.1kW', 'dosing 12 l/h'], uom: 'each', priceLow: 240, priceHigh: 6_800, qtyLow: 1, qtyHigh: 24, spec: 'IE3 motor, mechanical seal, commissioning included' },
    { code: 'HSE', noun: 'Hose assembly', variants: ['1/4in 2-wire 1m', '1/4in 2-wire 2m', '3/8in 2-wire 1.5m', '3/8in 4-wire 2m', '1/2in 2-wire 2m', '1/2in 4-wire 3m', '3/4in 4-wire 3m', '1in 4-wire 4m', 'suction 2in 5m', 'delivery 3in 10m'], uom: 'each', priceLow: 14, priceHigh: 420, qtyLow: 5, qtyHigh: 180, spec: 'Crimped both ends, pressure tested, test certificate supplied' },
    { code: 'LMP', noun: 'Luminaire', variants: ['LED batten 4ft', 'LED batten 5ft', 'LED highbay 100W', 'LED highbay 150W', 'LED panel 600x600', 'LED panel 1200x300', 'LED floodlight 50W', 'LED floodlight 150W', 'emergency bulkhead', 'LED downlight 12W'], uom: 'each', priceLow: 11, priceHigh: 210, qtyLow: 20, qtyHigh: 700, spec: 'IP65 where external, 5-year warranty, 4000K unless stated' },
  ],

  'Professional & Consultancy': [
    { code: 'CON', noun: 'Consulting', variants: ['strategy partner', 'strategy principal', 'strategy manager', 'strategy consultant', 'strategy analyst', 'change lead', 'change manager', 'PMO lead', 'PMO analyst', 'benefits analyst'], uom: 'day', priceLow: 420, priceHigh: 3_400, qtyLow: 10, qtyHigh: 260, spec: 'Blended day rate, expenses capped at 8% and billed at cost' },
    { code: 'AUD', noun: 'Audit & assurance', variants: ['statutory audit', 'internal audit', 'IT general controls', 'SOX walkthrough', 'ISO 9001 surveillance', 'ISO 14001 surveillance', 'ISO 27001 stage 1', 'ISO 27001 stage 2', 'supplier audit', 'process assurance review'], uom: 'engagement', priceLow: 2_400, priceHigh: 48_000, qtyLow: 1, qtyHigh: 12, spec: 'Fixed fee, partner sign-off, report within 15 working days' },
    { code: 'LEG', noun: 'Legal', variants: ['partner', 'senior associate', 'associate', 'paralegal', 'contract review fixed', 'IP filing', 'employment advisory', 'competition advisory', 'litigation support', 'regulatory advisory'], uom: 'hour', priceLow: 95, priceHigh: 780, qtyLow: 20, qtyHigh: 500, spec: 'Hourly, capped at the agreed estimate without written approval' },
    { code: 'TRN', noun: 'Training', variants: ['leadership 2-day', 'leadership 3-day', 'safety induction', 'first aid 3-day', 'forklift certification', 'project management', 'data literacy', 'cyber awareness', 'contract management', 'negotiation skills'], uom: 'delegate', priceLow: 120, priceHigh: 2_400, qtyLow: 8, qtyHigh: 240, spec: 'Per delegate, materials and certification included, minimum 8 per cohort' },
    { code: 'ENG', noun: 'Engineering services', variants: ['civil design', 'structural design', 'MEP design', 'process design', 'CAD drafting', 'site supervision', 'commissioning support', 'FEED study', 'HAZOP facilitation', 'as-built survey'], uom: 'day', priceLow: 320, priceHigh: 1_650, qtyLow: 10, qtyHigh: 320, spec: 'Chartered engineer sign-off, PI insurance £5m minimum' },
    { code: 'MKT', noun: 'Marketing services', variants: ['brand strategy', 'creative direction', 'copywriting', 'design production', 'media planning', 'media buying', 'digital campaign', 'SEO retainer', 'content retainer', 'event management'], uom: 'month', priceLow: 1_200, priceHigh: 24_000, qtyLow: 3, qtyHigh: 24, spec: 'Monthly retainer, media spend excluded and billed at net cost' },
    { code: 'REC', noun: 'Recruitment', variants: ['permanent placement', 'executive search', 'contract placement', 'RPO monthly', 'assessment centre', 'psychometric testing', 'background screening', 'onboarding support', 'graduate campaign', 'interim placement'], uom: 'placement', priceLow: 600, priceHigh: 32_000, qtyLow: 1, qtyHigh: 40, spec: 'Fee as a percentage of first-year salary, 12-week rebate' },
    { code: 'ITS', noun: 'IT services', variants: ['solution architect', 'senior developer', 'developer', 'test lead', 'test analyst', 'data engineer', 'DevOps engineer', 'security consultant', 'business analyst', 'scrum master'], uom: 'day', priceLow: 280, priceHigh: 1_450, qtyLow: 20, qtyHigh: 400, spec: 'Time and materials against an agreed statement of work' },
    { code: 'FAC', noun: 'Facilities services', variants: ['cleaning daily', 'cleaning periodic', 'security manned', 'security mobile', 'landscaping', 'pest control', 'waste management', 'catering', 'reception', 'helpdesk'], uom: 'month', priceLow: 900, priceHigh: 46_000, qtyLow: 6, qtyHigh: 36, spec: 'Monthly, KPI regime and service credits per the attached schedule' },
    { code: 'INS', noun: 'Inspection & testing', variants: ['NDT ultrasonic', 'NDT radiographic', 'NDT magnetic particle', 'lifting equipment LOLER', 'pressure systems', 'electrical fixed wiring', 'PAT testing', 'thermographic survey', 'water hygiene', 'air quality'], uom: 'visit', priceLow: 180, priceHigh: 4_200, qtyLow: 2, qtyHigh: 60, spec: 'UKAS accredited, certificates uploaded within 5 working days' },
  ],

  'Fleet & Logistics': [
    { code: 'TYR', noun: 'Tyre', variants: ['195/65 R15', '205/55 R16', '215/60 R16', '225/45 R17', '225/65 R17', '235/55 R18', '245/45 R18', '265/70 R19.5', '295/80 R22.5', '315/80 R22.5'], uom: 'each', priceLow: 48, priceHigh: 420, qtyLow: 16, qtyHigh: 480, spec: 'Fitted and balanced, old casings collected, EU label B/B or better' },
    { code: 'FRT', noun: 'Freight lane', variants: ['domestic FTL', 'domestic LTL', 'domestic parcel', 'cross-border FTL', 'cross-border LTL', 'sea FCL 20ft', 'sea FCL 40ft', 'sea LCL', 'air general', 'air express'], uom: 'shipment', priceLow: 120, priceHigh: 6_400, qtyLow: 20, qtyHigh: 900, spec: 'Rate per shipment on the attached lane schedule, fuel surcharge indexed' },
    { code: 'FUL', noun: 'Fuel card volume', variants: ['diesel bulk', 'diesel forecourt', 'petrol forecourt', 'AdBlue bulk', 'AdBlue packed', 'LPG', 'HVO bulk', 'EV public charging', 'EV depot charging', 'marine gasoil'], uom: 'litre', priceLow: 0.9, priceHigh: 2.4, qtyLow: 5_000, qtyHigh: 400_000, spec: 'Priced as a differential to the published weekly index' },
    { code: 'VEH', noun: 'Vehicle lease', variants: ['small hatch 36m', 'small hatch 48m', 'estate 36m', 'estate 48m', 'SUV 36m', 'panel van SWB 36m', 'panel van LWB 48m', 'Luton 48m', '7.5t rigid 60m', '18t rigid 60m'], uom: 'month', priceLow: 180, priceHigh: 2_400, qtyLow: 12, qtyHigh: 200, spec: 'Contract hire, maintenance included, 20,000 km per annum' },
    { code: 'PLT', noun: 'Pallet', variants: ['euro 1200x800 new', 'euro 1200x800 used', 'standard 1200x1000 new', 'standard 1200x1000 used', 'half pallet', 'quarter pallet', 'plastic hygienic', 'plastic nestable', 'heat-treated export', 'display pallet'], uom: 'each', priceLow: 4.2, priceHigh: 46, qtyLow: 200, qtyHigh: 12_000, spec: 'ISPM-15 where export, load rating 1500kg dynamic' },
    { code: 'WHS', noun: 'Warehousing', variants: ['ambient pallet storage', 'chilled pallet storage', 'frozen pallet storage', 'bonded storage', 'pick and pack', 'cross-dock handling', 'inbound handling', 'outbound handling', 'returns processing', 'value-added labelling'], uom: 'pallet-week', priceLow: 1.8, priceHigh: 28, qtyLow: 500, qtyHigh: 40_000, spec: 'Per pallet per week, minimum 1 week charged' },
    { code: 'TEL', noun: 'Telematics', variants: ['basic tracking', 'advanced tracking', 'driver behaviour', 'camera forward', 'camera dual', 'camera 360', 'tacho download', 'temperature logging', 'fuel monitoring', 'PTO monitoring'], uom: 'unit-month', priceLow: 4.5, priceHigh: 46, qtyLow: 120, qtyHigh: 4_800, spec: 'Per vehicle per month, hardware included, 36-month term' },
    { code: 'MNT', noun: 'Vehicle maintenance', variants: ['car service minor', 'car service major', 'van service minor', 'van service major', 'HGV inspection 6-week', 'HGV service', 'MOT class 4', 'MOT class 7', 'tail-lift inspection', 'brake roller test'], uom: 'event', priceLow: 45, priceHigh: 940, qtyLow: 20, qtyHigh: 600, spec: 'Fixed price per event, courtesy vehicle where over 4 hours' },
    { code: 'CRT', noun: 'Carton', variants: ['single wall 305x229x140', 'single wall 400x300x200', 'double wall 400x300x300', 'double wall 500x400x300', 'double wall 600x400x400', 'mailer small', 'mailer medium', 'mailer large', 'archive box', 'wardrobe carton'], uom: 'each', priceLow: 0.4, priceHigh: 4.8, qtyLow: 1_000, qtyHigh: 90_000, spec: 'Recycled content minimum 70%, FEFCO 0201 unless stated' },
    { code: 'STR', noun: 'Stretch & strapping', variants: ['hand film 17mic', 'hand film 20mic', 'hand film 23mic', 'machine film 17mic', 'machine film 23mic', 'PP strapping 12mm', 'PP strapping 15mm', 'PET strapping 16mm', 'steel strapping 19mm', 'pallet net'], uom: 'roll', priceLow: 2.1, priceHigh: 38, qtyLow: 200, qtyHigh: 9_000, spec: 'Core 76mm, pre-stretch rated, per the attached usage schedule' },
  ],

  'Electrical & Instrumentation': [
    { code: 'CBL', noun: 'Cable, XLPE armoured 4-core', variants: ['1.5 sq mm', '2.5 sq mm', '4 sq mm', '6 sq mm', '10 sq mm', '16 sq mm', '25 sq mm', '35 sq mm', '50 sq mm', '70 sq mm', '95 sq mm', '120 sq mm'], uom: 'metre', priceLow: 1.9, priceHigh: 64, qtyLow: 200, qtyHigh: 12_000, spec: 'BS 5467, 600/1000V, LSZH bedding, drum returns credited' },
    { code: 'MCB', noun: 'Circuit breaker', variants: ['MCB 6A type B', 'MCB 10A type B', 'MCB 16A type C', 'MCB 20A type C', 'MCB 32A type C', 'MCB 40A type D', 'RCBO 16A 30mA', 'RCBO 32A 30mA', 'MCCB 100A', 'MCCB 250A'], uom: 'each', priceLow: 4.8, priceHigh: 420, qtyLow: 40, qtyHigh: 1_200, spec: '10kA breaking capacity, DIN rail, to the attached schedule' },
    { code: 'VSD', noun: 'Variable speed drive', variants: ['0.75kW IP20', '1.5kW IP20', '2.2kW IP20', '4kW IP20', '5.5kW IP55', '7.5kW IP55', '11kW IP55', '15kW IP55', '22kW IP55', '37kW IP55'], uom: 'each', priceLow: 180, priceHigh: 4_200, qtyLow: 2, qtyHigh: 80, spec: 'Integrated EMC filter, Modbus RTU, keypad included' },
    { code: 'MTR', noun: 'Electric motor', variants: ['0.75kW 4-pole', '1.5kW 4-pole', '2.2kW 4-pole', '4kW 4-pole', '5.5kW 4-pole', '7.5kW 4-pole', '11kW 4-pole', '15kW 4-pole', '22kW 4-pole', '30kW 4-pole'], uom: 'each', priceLow: 120, priceHigh: 3_600, qtyLow: 2, qtyHigh: 90, spec: 'IE3 efficiency, B3 foot mount, 400V 50Hz' },
    { code: 'SNS', noun: 'Sensor', variants: ['inductive M12', 'inductive M18', 'capacitive M18', 'photoelectric diffuse', 'photoelectric retro', 'ultrasonic 1m', 'pressure 0-10 bar', 'pressure 0-25 bar', 'temperature PT100', 'temperature thermocouple K'], uom: 'each', priceLow: 12, priceHigh: 320, qtyLow: 20, qtyHigh: 500, spec: 'IP67, M12 connector, 4-20mA or PNP as scheduled' },
    { code: 'PLC', noun: 'Control hardware', variants: ['PLC CPU compact', 'PLC CPU modular', 'DI module 16ch', 'DO module 16ch', 'AI module 8ch', 'AO module 4ch', 'HMI 7in', 'HMI 10in', 'HMI 15in', 'communication module'], uom: 'each', priceLow: 140, priceHigh: 3_800, qtyLow: 2, qtyHigh: 60, spec: 'Programming licence transferable, firmware at latest stable release' },
    { code: 'PNL', noun: 'Enclosure', variants: ['300x400x200 IP66', '400x600x250 IP66', '600x600x250 IP66', '800x1000x300 IP66', '1000x1200x300 IP55', '1200x1800x400 IP55', 'floor-standing 2000mm', 'wall-mount stainless', 'junction box IP68', 'console desk'], uom: 'each', priceLow: 46, priceHigh: 2_400, qtyLow: 2, qtyHigh: 70, spec: 'Powder coated RAL 7035, gland plate removable, earthing studs fitted' },
    { code: 'TRF', noun: 'Transformer', variants: ['100kVA', '160kVA', '250kVA', '400kVA', '630kVA', '1000kVA', '1250kVA', 'control 500VA', 'control 1kVA', 'isolation 5kVA'], uom: 'each', priceLow: 210, priceHigh: 42_000, qtyLow: 1, qtyHigh: 12, spec: 'Cast resin, Dyn11, temperature monitoring relay included' },
    { code: 'ERT', noun: 'Earthing & lightning', variants: ['earth rod 1.2m', 'earth rod 2.4m', 'earth tape 25x3', 'earth tape 50x6', 'bonding clamp', 'test link box', 'air terminal 1m', 'air terminal 2m', 'down conductor', 'surge protector type 2'], uom: 'each', priceLow: 6.4, priceHigh: 340, qtyLow: 20, qtyHigh: 600, spec: 'BS EN 62305 compliant, copper bonded, certificate on completion' },
    { code: 'CTR', noun: 'Cable containment', variants: ['tray 100mm', 'tray 150mm', 'tray 300mm', 'tray 450mm', 'basket 100mm', 'basket 200mm', 'basket 300mm', 'trunking 50x50', 'trunking 100x50', 'conduit 25mm'], uom: 'metre', priceLow: 3.2, priceHigh: 42, qtyLow: 100, qtyHigh: 4_000, spec: 'Hot-dip galvanised to BS EN ISO 1461, 3m lengths' },
  ],
};

const LOCATIONS = [
  'Mumbai — Head Office', 'Pune — Plant 2', 'Bengaluru — Tech Centre',
  'Chennai — DC North', 'Gurugram — Regional Office', 'Hyderabad — Lab',
  'Ahmedabad — Warehouse', 'Kolkata — Depot',
];

// ---------------------------------------------------------------------------
// Requisition specifications
// ---------------------------------------------------------------------------

interface Requester {
  id: string;
  name: string;
  code: string;
}

const REQUESTERS: Record<string, Requester> = {
  ar: { id: 'user-ar', name: 'A. Rahman', code: 'TGR-1001' },
  js: { id: 'user-js', name: 'J. Silva', code: 'TGR-1002' },
  mp: { id: 'user-mp', name: 'M. Prasad', code: 'TGR-1003' },
  kt: { id: 'user-kt', name: 'K. Tan', code: 'TGR-1004' },
  adu: { id: 'user-adu', name: 'Admin Department User', code: 'ADU-001' },
  bdu: { id: 'user-bdu', name: 'BD Department User', code: 'BDU-001' },
};

/** How a requisition's lines are spread across sourcing states, in order. */
type SourcingProfile = { state: PrLineSourcingState; share: number }[];

const ALL_UNSOURCED: SourcingProfile = [{ state: 'UNSOURCED', share: 1 }];

interface RequestSpec {
  number: string;
  title: string;
  category: string;
  superCategory: string | null;
  status: PrStatus;
  submittedOn: string;
  requester: Requester;
  businessUnit: string;
  costCentre: string;
  needBy: string;
  justification: string;
  lineCount: number;
  profile: SourcingProfile;
  eventNumber: string | null;
}

const SPECS: RequestSpec[] = [
  {
    number: 'RQ-TGRANL-00130', title: 'Q1 laptop refresh — Bengaluru',
    category: 'IT Hardware', superCategory: 'Technology', status: 'APPROVAL',
    submittedOn: '2025-12-26', requester: REQUESTERS.ar,
    businessUnit: 'Corporate Services', costCentre: 'CC-4410', needBy: '2026-03-31',
    justification: 'Devices out of warranty at end of Q1; security baseline cannot be applied to the outgoing fleet.',
    lineCount: 3, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00129', title: 'Server replacement — finance reporting',
    category: 'IT Hardware', superCategory: 'Technology', status: 'APPROVAL',
    submittedOn: '2025-11-21', requester: REQUESTERS.js,
    businessUnit: 'Finance', costCentre: 'CC-2200', needBy: '2026-01-15',
    justification: 'Single failed unit in the reporting stack, replaced like for like.',
    lineCount: 1, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00127', title: 'Administrative consumables — December',
    category: 'Office & Administrative', superCategory: 'Indirect', status: 'APPROVAL',
    submittedOn: '2025-07-01', requester: REQUESTERS.ar,
    businessUnit: 'Corporate Services', costCentre: 'CC-4410', needBy: '2026-02-28',
    justification: 'Routine replenishment against the annual consumption plan.',
    lineCount: 6, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00125', title: 'Office supplies — annual contract call-off',
    category: 'Office & Administrative', superCategory: 'Indirect', status: 'PENDING',
    submittedOn: '2025-06-11', requester: REQUESTERS.ar,
    businessUnit: 'Corporate Services', costCentre: 'CC-4410', needBy: '2026-04-30',
    justification: 'Consolidated demand feeding the annual office supplies tender.',
    lineCount: 12,
    profile: [{ state: 'IN_EVENT', share: 0.75 }, { state: 'UNSOURCED', share: 0.25 }],
    eventNumber: 'RFQ-2026-0142',
  },
  {
    number: 'RQ-TGRANL-00124', title: 'Plant 2 shutdown spares — mechanical',
    category: 'Facilities & MRO', superCategory: 'Indirect', status: 'APPROVED',
    submittedOn: '2025-05-19', requester: REQUESTERS.mp,
    businessUnit: 'Manufacturing', costCentre: 'CC-7120', needBy: '2026-06-15',
    justification: 'Planned shutdown in June; spares must be on site four weeks ahead of the outage window.',
    lineCount: 24, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00122', title: 'Fleet tyre and maintenance programme',
    category: 'Fleet & Logistics', superCategory: 'Logistics', status: 'SOURCING',
    submittedOn: '2025-04-08', requester: REQUESTERS.kt,
    businessUnit: 'Logistics', costCentre: 'CC-6300', needBy: '2026-05-31',
    justification: 'Annual fleet programme covering 180 vehicles across four depots.',
    lineCount: 38,
    profile: [{ state: 'IN_EVENT', share: 0.6 }, { state: 'UNSOURCED', share: 0.4 }],
    eventNumber: 'AUC-2024-002',
  },
  {
    number: 'RQ-TGRANL-00119', title: 'Substation upgrade — electrical bill of materials',
    category: 'Electrical & Instrumentation', superCategory: 'Capex', status: 'PARTIALLY_SOURCED',
    submittedOn: '2025-02-27', requester: REQUESTERS.mp,
    businessUnit: 'Manufacturing', costCentre: 'CC-7450', needBy: '2026-09-30',
    justification: 'Capex project E-1188. Long-lead items must be ordered before the civil works start.',
    lineCount: 57,
    profile: [
      { state: 'AWARDED', share: 0.3 }, { state: 'IN_EVENT', share: 0.35 },
      { state: 'UNSOURCED', share: 0.3 }, { state: 'CANCELLED', share: 0.05 },
    ],
    eventNumber: 'RFP-2024-018',
  },
  {
    number: 'RQ-TGRANL-00115', title: 'IT estate refresh — wave 2',
    category: 'IT Hardware', superCategory: 'Technology', status: 'SOURCING',
    submittedOn: '2024-12-03', requester: REQUESTERS.js,
    businessUnit: 'Corporate Services', costCentre: 'CC-4415', needBy: '2026-08-31',
    justification: 'Second wave of the three-year refresh, covering four sites and the DC edge.',
    lineCount: 76,
    profile: [
      { state: 'IN_EVENT', share: 0.5 }, { state: 'ON_CONTRACT', share: 0.2 },
      { state: 'UNSOURCED', share: 0.3 },
    ],
    eventNumber: 'RFQ-2024-041',
  },
  {
    number: 'RQ-TGRANL-00108', title: 'Group MRO catalogue — annual replenishment',
    category: 'Facilities & MRO', superCategory: 'Indirect', status: 'PARTIALLY_SOURCED',
    submittedOn: '2024-09-16', requester: REQUESTERS.mp,
    businessUnit: 'Manufacturing', costCentre: 'CC-7120', needBy: '2026-12-31',
    justification: 'Consolidated MRO demand across all plants, replacing 11 site-level requisitions.',
    lineCount: 100,
    profile: [
      { state: 'AWARDED', share: 0.25 }, { state: 'ON_CONTRACT', share: 0.2 },
      { state: 'IN_EVENT', share: 0.3 }, { state: 'UNSOURCED', share: 0.22 },
      { state: 'CANCELLED', share: 0.03 },
    ],
    eventNumber: 'RFQ-2024-039',
  },
  {
    number: 'RQ-TGRANL-00042', title: 'Advisory support — operating model review',
    category: 'Professional & Consultancy', superCategory: 'Services', status: 'PENDING',
    submittedOn: '2023-10-16', requester: REQUESTERS.kt,
    businessUnit: 'Corporate Services', costCentre: 'CC-4100', needBy: '2026-03-01',
    justification: 'Board-mandated review of the shared services operating model.',
    lineCount: 4, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00034', title: 'Professional services panel — call-off',
    category: 'Professional & Consultancy', superCategory: 'Services', status: 'PENDING',
    submittedOn: '2023-08-22', requester: REQUESTERS.kt,
    businessUnit: 'Corporate Services', costCentre: 'CC-4100', needBy: '2026-06-30',
    justification: 'Call-off against the professional services panel for the transformation programme.',
    lineCount: 9, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00033', title: 'Consultancy and assurance — FY26 plan',
    category: 'Professional & Consultancy', superCategory: 'Services', status: 'PENDING',
    submittedOn: '2023-08-16', requester: REQUESTERS.adu,
    businessUnit: 'Corporate Services', costCentre: 'CC-4105', needBy: '2026-07-31',
    justification: 'Twelve-month assurance plan agreed with the audit committee.',
    lineCount: 20, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00032', title: 'Legal advisory — contract review',
    category: 'Professional & Consultancy', superCategory: 'Services', status: 'PENDING',
    submittedOn: '2023-07-29', requester: REQUESTERS.bdu,
    businessUnit: 'Business Development', costCentre: 'CC-3050', needBy: '2026-02-15',
    justification: 'External counsel for the distribution agreement renewal.',
    lineCount: 2, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00027', title: 'Administrative supplies — multi-site',
    category: 'Office & Administrative', superCategory: 'Indirect', status: 'PENDING',
    submittedOn: '2023-07-21', requester: REQUESTERS.adu,
    businessUnit: 'Corporate Services', costCentre: 'CC-4410', needBy: '2026-05-15',
    justification: 'Combined stationery and cleaning demand for six offices.',
    lineCount: 31, profile: ALL_UNSOURCED, eventNumber: null,
  },
  {
    number: 'RQ-TGRANL-00021', title: 'Warehouse packaging — Q4',
    category: 'Fleet & Logistics', superCategory: 'Logistics', status: 'CLOSED',
    submittedOn: '2023-05-04', requester: REQUESTERS.kt,
    businessUnit: 'Logistics', costCentre: 'CC-6310', needBy: '2025-12-31',
    justification: 'Seasonal packaging uplift for the peak despatch period.',
    lineCount: 14,
    profile: [{ state: 'AWARDED', share: 0.8 }, { state: 'ON_CONTRACT', share: 0.2 }],
    eventNumber: 'RFQ-2024-044',
  },
  {
    number: 'RQ-TGRANL-00018', title: 'Uncontrolled spend — rejected',
    category: 'Office & Administrative', superCategory: null, status: 'REJECTED',
    submittedOn: '2023-03-12', requester: REQUESTERS.bdu,
    businessUnit: 'Business Development', costCentre: 'CC-3050', needBy: '2025-09-30',
    justification: 'Raised after the fact against an existing supplier. Returned to the requester.',
    lineCount: 5, profile: [{ state: 'CANCELLED', share: 1 }], eventNumber: null,
  },
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Expand a profile into one state per line, in line order. */
function statesFor(profile: SourcingProfile, lineCount: number): PrLineSourcingState[] {
  const states: PrLineSourcingState[] = [];
  for (const { state, share } of profile) {
    const count = Math.round(share * lineCount);
    for (let i = 0; i < count && states.length < lineCount; i += 1) states.push(state);
  }
  // Rounding can leave the tail short; the last declared state absorbs it.
  const fill = profile[profile.length - 1].state;
  while (states.length < lineCount) states.push(fill);
  return states.slice(0, lineCount);
}

/** Every family/variant pair in a catalogue, so lines never repeat an item. */
function combinations(families: ItemFamily[]): { family: ItemFamily; variant: string; index: number }[] {
  const out: { family: ItemFamily; variant: string; index: number }[] = [];
  families.forEach((family) => {
    family.variants.forEach((variant, index) => out.push({ family, variant, index }));
  });
  return out;
}

function buildRequest(spec: RequestSpec, seed: number): {
  request: PurchaseRequest;
  lines: PurchaseRequestLine[];
} {
  const rand = lcg(seed);
  const id = `pr-${spec.number.slice(-5)}`;

  const request: PurchaseRequest = {
    id,
    tenantId: 'tenant-udaan',
    requestNumber: spec.number,
    title: spec.title,
    category: spec.category,
    superCategory: spec.superCategory,
    status: spec.status,
    submittedOn: spec.submittedOn,
    submittedById: spec.requester.id,
    submittedByName: spec.requester.name,
    submittedByCode: spec.requester.code,
    businessUnit: spec.businessUnit,
    costCentre: spec.costCentre,
    currency: 'USD',
    needBy: spec.needBy,
    deliveryLocation: LOCATIONS[seed % LOCATIONS.length],
    justification: spec.justification,
  };

  const pool = combinations(CATALOGUES[spec.category]);
  if (pool.length < spec.lineCount) {
    throw new Error(
      `Catalogue "${spec.category}" offers ${pool.length} items but ${spec.number} needs ${spec.lineCount}.`,
    );
  }

  // Walk the pool with a co-prime stride so a requisition draws a spread across
  // families rather than the first N variants of the first family.
  const stride = 7;
  const offset = Math.floor(rand() * pool.length);
  const states = statesFor(spec.profile, spec.lineCount);

  const lines: PurchaseRequestLine[] = [];
  for (let i = 0; i < spec.lineCount; i += 1) {
    const { family, variant } = pool[(offset + i * stride) % pool.length];
    const state = states[i];
    const sourced = state === 'IN_EVENT' || state === 'AWARDED';

    lines.push({
      id: `${id}-l${i + 1}`,
      requestId: id,
      lineNumber: i + 1,
      itemCode: `${family.code}-${String(((offset + i * stride) % pool.length) + 1).padStart(3, '0')}`,
      description: `${family.noun}, ${variant}`,
      specification: family.spec,
      quantity: between(rand, family.qtyLow, family.qtyHigh),
      uom: family.uom,
      needBy: addDays(spec.needBy, between(rand, -21, 21, 7)),
      deliveryLocation: pick(rand, LOCATIONS),
      indicativePrice:
        Math.round((family.priceLow + rand() * (family.priceHigh - family.priceLow)) * 100) / 100,
      currency: 'USD',
      sourcingState: state,
      eventNumber: sourced ? spec.eventNumber : null,
      hasVendorQuote: rand() < 0.18,
      isCatalogItem: rand() < 0.35,
    });
  }

  return { request, lines };
}

const BUILT = SPECS.map((spec, index) => buildRequest(spec, 20_260_000 + index * 977));

export const PURCHASE_REQUESTS: PurchaseRequest[] = BUILT.map((b) => b.request);
export const PURCHASE_REQUEST_LINES: PurchaseRequestLine[] = BUILT.flatMap((b) => b.lines);
