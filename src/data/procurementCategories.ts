/**
 * The categories this organisation buys in, and what the market asks in each.
 *
 * Two tables, and they are separate on purpose.
 *
 * `PROCUREMENT_CATEGORIES` is the **taxonomy** — the list a buyer picks from.
 * It replaced a free-text field, which is the sort of change that looks
 * cosmetic and is not: a category typed as "IT Hardware" in one template and
 * "IT hardware" in another is two categories as far as every lookup in this
 * system is concerned, and the supplier shortlist, the questionnaire and the
 * spend report all quietly disagree. A closed list makes that impossible.
 *
 * `MARKET_PRACTICE` is what the questionnaire agent knows before it has looked
 * at anything this organisation has done — the questions a competent buyer in
 * this category asks, and why. It is a curated corpus, not a model: the agent
 * in this build retrieves and ranks, it does not write prose. Where a language
 * model would sit is marked in `domain/questionnaireAgent.ts`.
 *
 * The seven category names already in the seed data are kept exactly as they
 * were. Renaming them here would silently unpick every template, shortlist and
 * event that already names one.
 */
import type { QuestionType, ScoringMethod, VendorInputPoint } from '../domain/types';

export interface ProcurementCategory {
  /** The value stored on a template, an event and a shortlist. */
  id: string;
  /** Where it sits in the spend taxonomy. */
  superCategory: string;
  /** What this category covers, shown under the name in the picker. */
  description: string;
  /** True for a service rather than a good. Changes what the agent asks. */
  isService: boolean;
}

export const PROCUREMENT_CATEGORIES: ProcurementCategory[] = [
  // --- Direct / production --------------------------------------------------
  {
    id: 'Raw Materials', superCategory: 'Direct', isService: false,
    description: 'Steel, polymers, chemicals and other inputs that go into the product.',
  },
  {
    id: 'Components', superCategory: 'Direct', isService: false,
    description: 'Bought-in parts and sub-assemblies made to a drawing or specification.',
  },
  {
    id: 'Packaging', superCategory: 'Direct', isService: false,
    description: 'Primary, secondary and transit packaging, including print and labelling.',
  },
  {
    id: 'Capital Equipment', superCategory: 'Direct', isService: false,
    description: 'Plant, machinery and tooling bought as an asset rather than consumed.',
  },

  // --- Indirect -------------------------------------------------------------
  {
    id: 'Indirect', superCategory: 'Indirect', isService: false,
    description: 'Office and administrative consumables — stationery, pantry, print.',
  },
  {
    id: 'IT', superCategory: 'Indirect', isService: false,
    description: 'End-user and data-centre hardware: laptops, displays, servers, network.',
  },
  {
    id: 'IT Software', superCategory: 'Indirect', isService: true,
    description: 'Licensed software and SaaS subscriptions, including renewals.',
  },
  {
    id: 'Telecom', superCategory: 'Indirect', isService: true,
    description: 'Connectivity, mobile fleets, and the circuits between sites.',
  },
  {
    id: 'Facilities', superCategory: 'Indirect', isService: true,
    description: 'Hard and soft services on the estate — HVAC, cleaning, grounds, security.',
  },
  {
    id: 'Utilities', superCategory: 'Indirect', isService: true,
    description: 'Power, water and gas, bought on a meter rather than a quantity.',
  },
  {
    id: 'MRO', superCategory: 'Indirect', isService: false,
    description: 'Maintenance, repair and operations spares held against breakdown.',
  },

  // --- Services -------------------------------------------------------------
  {
    id: 'Services', superCategory: 'Services', isService: true,
    description: 'General bought-in services that do not sit in a named service category.',
  },
  {
    id: 'Professional Services', superCategory: 'Services', isService: true,
    description: 'Consulting, audit, engineering and other work billed by expertise.',
  },
  {
    id: 'Marketing', superCategory: 'Services', isService: true,
    description: 'Agency, media, events and production.',
  },
  {
    id: 'HR & Staffing', superCategory: 'Services', isService: true,
    description: 'Contingent labour, recruitment and training.',
  },
  {
    id: 'Legal', superCategory: 'Services', isService: true,
    description: 'External counsel and the panel arrangements behind it.',
  },

  // --- Logistics ------------------------------------------------------------
  {
    id: 'Logistics', superCategory: 'Logistics', isService: true,
    description: 'Handling, pallets, warehousing and the return leg.',
  },
  {
    id: 'Freight', superCategory: 'Logistics', isService: true,
    description: 'Road, sea and air movement, including customs clearance.',
  },
  {
    id: 'Fleet', superCategory: 'Logistics', isService: false,
    description: 'Owned and leased vehicles, their maintenance and their fuel.',
  },
];

export const CATEGORY_IDS = PROCUREMENT_CATEGORIES.map((category) => category.id);

/** The taxonomy grouped for a picker, super-categories in declaration order. */
export function categoriesBySuper(): { superCategory: string; items: ProcurementCategory[] }[] {
  const groups: { superCategory: string; items: ProcurementCategory[] }[] = [];
  for (const category of PROCUREMENT_CATEGORIES) {
    const group = groups.find((each) => each.superCategory === category.superCategory);
    if (group) group.items.push(category);
    else groups.push({ superCategory: category.superCategory, items: [category] });
  }
  return groups;
}

export const categoryById = (id: string): ProcurementCategory | undefined =>
  PROCUREMENT_CATEGORIES.find((category) => category.id === id);

// ---------------------------------------------------------------------------
// What the market asks
// ---------------------------------------------------------------------------

/**
 * One question the agent knows about, before it looks at anything local.
 *
 * `why` is not decoration. A suggestion a buyer cannot interrogate is one they
 * either accept blindly or reject blindly, and both are worse than no
 * suggestion — so every entry carries the reason a competent buyer asks it.
 */
export interface PracticeQuestion {
  code: string;
  title: string;
  helpText: string;
  type: QuestionType;
  section: string;
  /** The points in a journey where asking this makes sense. */
  appliesTo: VendorInputPoint[];
  envelope: 'TECHNICAL' | 'COMMERCIAL' | 'GENERAL';
  scoringMethod: ScoringMethod;
  /** Relative, as everywhere else. The buyer re-weights against the budget. */
  weight: number;
  isKnockout: boolean;
  allowAttachment: boolean;
  rubric: string | null;
  why: string;
  /**
   * The buyer concerns this question serves. The interview asks which of these
   * matter, and the ranking follows the answer.
   */
  serves: string[];
}

const practice = (
  partial: Partial<PracticeQuestion> & Pick<PracticeQuestion, 'code' | 'title' | 'why' | 'section'>,
): PracticeQuestion => ({
  helpText: '',
  type: 'short_text',
  // Most of these are worth asking wherever a supplier is still being
  // assessed. Defaulting to RFI and RFP only quietly emptied the agent's
  // suggestions on an RFQ, which is the stage buyers raise most.
  appliesTo: ['RFI', 'RFP', 'RFQ'],
  envelope: 'TECHNICAL',
  scoringMethod: 'MANUAL',
  weight: 10,
  isKnockout: false,
  allowAttachment: false,
  rubric: null,
  serves: [],
  ...partial,
});

/**
 * Questions worth asking whatever is being bought.
 *
 * Kept apart from the category sets so a new category inherits them rather than
 * starting from nothing — and so the agent can say honestly which of its
 * suggestions are category knowledge and which are simply good practice.
 */
export const UNIVERSAL_PRACTICE: PracticeQuestion[] = [
  practice({
    code: 'GEN.INSURANCE', title: 'Public liability insurance', section: 'Company & compliance',
    type: 'certificate', helpText: 'Attach the current schedule.', weight: 10,
    isKnockout: true, allowAttachment: true,
    rubric: 'At or above the stated minimum = 10 · Below = 0',
    why: 'Cover below the contract minimum transfers the risk back to the buyer, and it is cheaper to find out now than at claim.',
    serves: ['RISK', 'COMPLIANCE'],
  }),
  practice({
    code: 'GEN.ISO9001', title: 'ISO 9001 certification', section: 'Company & compliance',
    type: 'certificate', helpText: 'Attach a current certificate.', weight: 10,
    allowAttachment: true, rubric: 'Valid = 10 · Expired = 4 · Absent = 0',
    why: 'The cheapest proxy for whether a supplier has a quality system at all, and the one most buyers already hold evidence of.',
    serves: ['QUALITY', 'COMPLIANCE'],
  }),
  practice({
    code: 'GEN.REFERENCES', title: 'Three contactable references', section: 'Capability',
    type: 'reference_submission', helpText: 'Comparable scope and scale, within the last three years.',
    weight: 10, allowAttachment: true, rubric: 'Three comparable = 10 · Two = 6 · Fewer = 2',
    why: 'Past performance at comparable scale is the strongest single predictor of delivery, and the easiest claim to verify.',
    serves: ['CAPABILITY', 'RISK'],
  }),
  practice({
    code: 'GEN.SUBCONTRACT', title: 'What will be subcontracted, and to whom', section: 'Capability',
    type: 'long_text', helpText: 'Name each subcontractor and the share of scope they hold.',
    weight: 10,
    why: 'Undeclared subcontracting is how a shortlisted supplier becomes a broker, and it is the usual root of a performance dispute.',
    serves: ['RISK', 'CAPABILITY'],
  }),
  practice({
    code: 'GEN.SCOPE12', title: 'Do you report Scope 1 and 2 emissions?', section: 'Sustainability',
    type: 'yes_no', scoringMethod: 'RULE', weight: 5, rubric: 'Yes = 10 · No = 0',
    why: 'The reporting boundary most organisations are already accountable for, and the one a supplier can answer without a consultant.',
    serves: ['SUSTAINABILITY'],
  }),
  practice({
    code: 'GEN.CONTINUITY', title: 'Business continuity plan', section: 'Capability',
    type: 'file_upload', helpText: 'Current, tested plan covering this scope.',
    weight: 10, allowAttachment: true,
    rubric: 'Tested within 12 months = 10 · Exists, untested = 5 · Absent = 0',
    why: 'A plan that has never been exercised is a document, not a capability — asking when it was last tested separates the two.',
    serves: ['RISK'],
  }),
  practice({
    code: 'GEN.PAYTERMS', title: 'Payment terms offered', section: 'Commercial terms',
    type: 'currency_payment_terms', appliesTo: ['RFP', 'RFQ'], envelope: 'COMMERCIAL',
    scoringMethod: 'RULE', weight: 10,
    rubric: 'Longer credit scores higher; advance payment scores nothing.',
    why: 'Terms are worth real money against the quoted price, and a supplier who will not move on price will often move on terms.',
    serves: ['COST'],
  }),
];

/** Category knowledge, on top of the universal set. */
export const MARKET_PRACTICE: Record<string, PracticeQuestion[]> = {
  IT: [
    practice({
      code: 'IT.SECURITY', title: 'ISO 27001 or SOC 2 Type II', section: 'Security',
      type: 'certificate', allowAttachment: true, weight: 20, isKnockout: true,
      rubric: 'Current certificate covering this scope = 10 · Expired or out of scope = 0',
      why: 'Hardware arrives with firmware and a supply chain behind it; an uncertified supplier is an uncontrolled route into the estate.',
      serves: ['RISK', 'COMPLIANCE'],
    }),
    practice({
      code: 'IT.IMAGING', title: 'Imaging, asset tagging and enrolment', section: 'Service',
      type: 'long_text', weight: 15,
      helpText: 'How devices arrive configured, tagged and enrolled in our MDM.',
      why: 'The cost of a laptop is not the laptop. A supplier who ships unimaged devices moves days of work onto the buyer per hundred seats.',
      serves: ['COST', 'CAPABILITY'],
    }),
    practice({
      code: 'IT.WARRANTY', title: 'Warranty and onsite response time', section: 'Service',
      type: 'single_choice', scoringMethod: 'RULE', weight: 15,
      rubric: 'Next business day onsite = 10 · 2–3 days = 6 · Return to base = 2',
      why: 'Response time is what a user experiences when a device fails, and it varies far more between suppliers than unit price does.',
      serves: ['QUALITY', 'CAPABILITY'],
    }),
    practice({
      code: 'IT.EOL', title: 'End-of-life take-back and data destruction',
      section: 'Sustainability', type: 'yes_no', scoringMethod: 'RULE', weight: 10,
      rubric: 'Certified erasure and WEEE take-back = 10 · Take-back only = 5 · Neither = 0',
      why: 'Disposal is a data-protection event before it is an environmental one, and a certificate of erasure is the only defensible evidence.',
      serves: ['SUSTAINABILITY', 'RISK'],
    }),
    practice({
      code: 'IT.ROADMAP', title: 'Product roadmap and lifecycle commitment',
      section: 'Capability', type: 'long_text', weight: 10,
      why: 'A model withdrawn mid-rollout splits the estate into two builds, which costs more than the discount that won the deal.',
      serves: ['CAPABILITY'],
    }),
  ],

  'IT Software': [
    practice({
      code: 'SW.DATARES', title: 'Data residency and sub-processors', section: 'Security',
      type: 'long_text', weight: 20, isKnockout: true, allowAttachment: true,
      rubric: 'In-region with a published sub-processor list = 10 · Out of region = 0',
      why: 'Residency is usually a regulatory obligation rather than a preference, and sub-processors are where it is quietly broken.',
      serves: ['COMPLIANCE', 'RISK'],
    }),
    practice({
      code: 'SW.EXIT', title: 'Exit and data export', section: 'Commercial terms',
      type: 'long_text', envelope: 'COMMERCIAL', weight: 15,
      helpText: 'Format, cost and notice period for a full export of our data.',
      why: 'The cost of leaving is part of the price of joining, and it is never in the quoted figure.',
      serves: ['COST', 'RISK'],
    }),
    practice({
      code: 'SW.UPLIFT', title: 'Renewal uplift cap', section: 'Commercial terms',
      type: 'number', envelope: 'COMMERCIAL', scoringMethod: 'RULE', weight: 15,
      rubric: 'Capped at CPI or below = 10 · Capped above CPI = 6 · Uncapped = 0',
      why: 'An uncapped renewal is where a competitive first-year price is recovered, and it is far cheaper to cap now than to renegotiate later.',
      serves: ['COST'],
    }),
    practice({
      code: 'SW.UPTIME', title: 'Contracted uptime and service credits',
      section: 'Service', type: 'number', scoringMethod: 'RULE', weight: 10,
      rubric: '99.9% with meaningful credits = 10 · 99.5% = 6 · No SLA = 0',
      why: 'An availability figure with no credit behind it is a marketing number.',
      serves: ['QUALITY'],
    }),
  ],

  Facilities: [
    practice({
      code: 'FM.SAFETY', title: 'Accident frequency rate, last three years',
      section: 'Health & safety', type: 'number', scoringMethod: 'RULE', weight: 20,
      isKnockout: true, rubric: 'Below sector median = 10 · At median = 6 · Above = 0',
      why: 'Site services put the supplier’s people on the buyer’s premises, which makes their safety record the buyer’s exposure.',
      serves: ['RISK', 'COMPLIANCE'],
    }),
    practice({
      code: 'FM.SLA', title: 'Response and rectification times by priority',
      section: 'Service', type: 'long_text', weight: 15,
      why: 'Facilities contracts are judged on how fast something gets fixed, not on the monthly fee.',
      serves: ['QUALITY'],
    }),
    practice({
      code: 'FM.TUPE', title: 'TUPE position on the incumbent workforce',
      section: 'Company & compliance', type: 'long_text', weight: 10,
      why: 'Transfer liability lands on the buyer when it is not established before award, and it is the commonest cause of a facilities retender failing.',
      serves: ['RISK', 'COMPLIANCE'],
    }),
    practice({
      code: 'FM.VETTING', title: 'Staff vetting standard', section: 'Health & safety',
      type: 'single_choice', scoringMethod: 'RULE', weight: 10,
      rubric: 'Enhanced checks on all site staff = 10 · Basic = 5 · None = 0',
      why: 'Unescorted access to the estate is the access control that matters most and is audited least.',
      serves: ['RISK', 'COMPLIANCE'],
    }),
  ],

  Logistics: [
    practice({
      code: 'LOG.ISPM15', title: 'Are all timber pallets ISPM 15 heat treated and stamped?',
      section: 'Handling assurance', type: 'yes_no', scoringMethod: 'NONE', weight: 0,
      isKnockout: true, allowAttachment: true,
      why: 'Untreated timber cannot cross a border. This disqualifies rather than scores, because there is no partial credit for a load that is turned back.',
      serves: ['COMPLIANCE', 'RISK'],
    }),
    practice({
      code: 'LOG.POOL', title: 'Pallet supply model', section: 'Handling assurance',
      type: 'single_choice', weight: 20,
      rubric: 'Exchange pool with collection = 10 · Exchange without collection = 6 · Outright sale = 3',
      why: 'An exchange pool and an outright sale are not comparable on unit price, so the model has to be asked before the prices mean anything.',
      serves: ['COST', 'SUSTAINABILITY'],
    }),
    practice({
      code: 'LOG.RETURN', title: 'Collection lead time for returned units, in days',
      section: 'Handling assurance', type: 'number', scoringMethod: 'RULE', weight: 15,
      rubric: '≤2 = 10 · 3–5 = 7 · 6–10 = 4 · >10 = 1',
      why: 'The return leg is where a cheap outbound rate is lost, and it is the figure suppliers quote least willingly.',
      serves: ['COST', 'CAPABILITY'],
    }),
    practice({
      code: 'LOG.OTIF', title: 'On-time in-full performance, last twelve months',
      section: 'Service', type: 'number', scoringMethod: 'RULE', weight: 15,
      rubric: '≥98% = 10 · 95–97% = 7 · <95% = 2',
      why: 'OTIF is the one logistics metric every supplier already measures, so asking for it costs them nothing and is easy to verify.',
      serves: ['QUALITY', 'CAPABILITY'],
    }),
  ],

  Freight: [
    practice({
      code: 'FRT.AEO', title: 'AEO or equivalent customs accreditation',
      section: 'Company & compliance', type: 'certificate', allowAttachment: true,
      weight: 20, isKnockout: true, rubric: 'Current accreditation = 10 · None = 0',
      why: 'Accreditation is what keeps consignments out of the inspection queue, and the delay it avoids costs more than the rate difference.',
      serves: ['COMPLIANCE', 'RISK'],
    }),
    practice({
      code: 'FRT.SURCHARGE', title: 'Surcharge mechanism and indexation',
      section: 'Commercial terms', type: 'long_text', envelope: 'COMMERCIAL', weight: 15,
      why: 'A headline rate with an unbounded fuel surcharge is not a rate. The mechanism is the price.',
      serves: ['COST'],
    }),
    practice({
      code: 'FRT.TRACK', title: 'Track and trace, and the data you expose',
      section: 'Service', type: 'long_text', weight: 10,
      why: 'Visibility is what turns a late shipment into a managed exception instead of a surprise.',
      serves: ['CAPABILITY', 'QUALITY'],
    }),
  ],

  'Raw Materials': [
    practice({
      code: 'RM.MILLCERT', title: 'Mill certificates and batch traceability',
      section: 'Quality', type: 'certificate', allowAttachment: true, weight: 20,
      isKnockout: true, rubric: 'Full traceability to heat number = 10 · Partial = 4 · None = 0',
      why: 'Without traceability a defect cannot be contained to a batch, so a single failure becomes a recall of everything.',
      serves: ['QUALITY', 'RISK'],
    }),
    practice({
      code: 'RM.CAPACITY', title: 'Allocated monthly capacity for this contract',
      section: 'Capability', type: 'capacity_declaration', weight: 15,
      why: 'Stated capacity and allocated capacity are different numbers, and only the second one is available to the buyer.',
      serves: ['CAPABILITY', 'RISK'],
    }),
    practice({
      code: 'RM.INDEX', title: 'Index linkage and the published series used',
      section: 'Commercial terms', type: 'long_text', envelope: 'COMMERCIAL', weight: 15,
      why: 'Commodity prices move; the question is which published series governs, not whether the price will change.',
      serves: ['COST'],
    }),
    practice({
      code: 'RM.CONFLICT', title: 'Conflict minerals and origin declaration',
      section: 'Company & compliance', type: 'file_upload', allowAttachment: true, weight: 10,
      why: 'Origin is a reporting obligation downstream, and it cannot be reconstructed after the material is consumed.',
      serves: ['COMPLIANCE', 'SUSTAINABILITY'],
    }),
  ],

  'Professional Services': [
    practice({
      code: 'PS.TEAM', title: 'Named team, with CVs and committed availability',
      section: 'Capability', type: 'file_upload', allowAttachment: true, weight: 20,
      why: 'Consulting is bought on people. A proposal that names partners and delivers juniors is the oldest failure in the category.',
      serves: ['CAPABILITY', 'QUALITY'],
    }),
    practice({
      code: 'PS.KEYPERSON', title: 'Key person continuity commitment',
      section: 'Capability', type: 'long_text', weight: 15,
      why: 'Naming the team is only worth something if replacing them needs the buyer’s agreement.',
      serves: ['RISK', 'QUALITY'],
    }),
    practice({
      code: 'PS.RATECARD', title: 'Rate card by grade, with blended rate',
      section: 'Commercial terms', type: 'rate_table', envelope: 'COMMERCIAL',
      scoringMethod: 'NONE', weight: 0,
      why: 'A day rate is meaningless without the grade mix behind it, and the blended rate is what the invoice will actually average.',
      serves: ['COST'],
    }),
    practice({
      code: 'PS.CONFLICT', title: 'Conflicts of interest in this market',
      section: 'Company & compliance', type: 'long_text', weight: 10, isKnockout: true,
      why: 'An adviser working for a competitor on the same question is a problem that has to surface before appointment, not during.',
      serves: ['RISK', 'COMPLIANCE'],
    }),
  ],

  Indirect: [
    practice({
      code: 'IND.CATALOGUE', title: 'Catalogue, punch-out and order channel',
      section: 'Service', type: 'long_text', weight: 15,
      why: 'Indirect spend is lost to transaction cost, not unit price. The ordering channel is where that cost lives.',
      serves: ['COST', 'CAPABILITY'],
    }),
    practice({
      code: 'IND.FILLRATE', title: 'First-time fill rate on the core list',
      section: 'Service', type: 'number', scoringMethod: 'RULE', weight: 15,
      rubric: '≥98% = 10 · 95–97% = 6 · <95% = 2',
      why: 'A substitution is a hidden price increase and an unplanned trip to a local supplier.',
      serves: ['QUALITY', 'COST'],
    }),
    practice({
      code: 'IND.CONSOLIDATE', title: 'Delivery consolidation and frequency',
      section: 'Sustainability', type: 'long_text', weight: 10,
      why: 'Daily single-box deliveries to forty sites is the commonest avoidable emission in this category.',
      serves: ['SUSTAINABILITY', 'COST'],
    }),
  ],

  Fleet: [
    practice({
      code: 'FLT.WLTP', title: 'WLTP emissions and electrification roadmap',
      section: 'Sustainability', type: 'long_text', weight: 15,
      why: 'Fleet is usually the largest Scope 1 line an organisation controls directly, so the roadmap is the decarbonisation plan.',
      serves: ['SUSTAINABILITY'],
    }),
    practice({
      code: 'FLT.SMR', title: 'Service, maintenance and repair network coverage',
      section: 'Service', type: 'long_text', weight: 15,
      why: 'A vehicle off the road costs more per day than the lease, and coverage is what determines how many days that is.',
      serves: ['CAPABILITY', 'COST'],
    }),
    practice({
      code: 'FLT.RESIDUAL', title: 'Residual value assumptions and end-of-lease charges',
      section: 'Commercial terms', type: 'long_text', envelope: 'COMMERCIAL', weight: 15,
      why: 'The monthly figure is set by an assumption about resale, and the damage schedule is where it is recovered.',
      serves: ['COST'],
    }),
  ],
};

/** The concerns the interview asks about, and how the agent labels them. */
export const BUYER_CONCERNS: { id: string; label: string; blurb: string }[] = [
  { id: 'COST', label: 'Cost and commercial terms', blurb: 'Total cost, not just unit price.' },
  { id: 'QUALITY', label: 'Quality and service levels', blurb: 'What the buyer experiences day to day.' },
  { id: 'CAPABILITY', label: 'Capability and capacity', blurb: 'Whether they can actually deliver this.' },
  { id: 'RISK', label: 'Risk and continuity', blurb: 'What happens when something goes wrong.' },
  { id: 'COMPLIANCE', label: 'Compliance and certification', blurb: 'Obligations that are not negotiable.' },
  { id: 'SUSTAINABILITY', label: 'Sustainability', blurb: 'Emissions, circularity and reporting.' },
];

/** Everything the agent knows about a category, universal questions included. */
export function practiceFor(categories: string[]): PracticeQuestion[] {
  const seen = new Set<string>();
  const found: PracticeQuestion[] = [];
  for (const category of categories) {
    for (const question of MARKET_PRACTICE[category] ?? []) {
      if (seen.has(question.code)) continue;
      seen.add(question.code);
      found.push(question);
    }
  }
  for (const question of UNIVERSAL_PRACTICE) {
    if (seen.has(question.code)) continue;
    seen.add(question.code);
    found.push(question);
  }
  return found;
}
