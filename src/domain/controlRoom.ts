/**
 * The Control Room: what an administrator can configure, and where it lives.
 *
 * Two tables, both read by the screens rather than hard-coded into them.
 *
 * `CONTROL_ROOM` is the rail — the configuration areas of the platform. Several
 * of them belong to modules this prototype does not implement (expense, travel,
 * utility billing); they are listed because an administrator's mental map of
 * the product should not change depending on which build they are looking at,
 * and because a rail that silently omits them reads as "this product has no
 * expense configuration" rather than "this build does not include it". Each one
 * says plainly which it is.
 *
 * `PLUGIN_CATALOGUE` is the Procure-to-Pay page: PR, RFQ, **RFX**, PO, GRN and
 * Contract, each a grid of plugin cards. A card is one of two things and never
 * both — a *switch*, which is a single boolean setting resolved through the
 * ordinary scope chain, or a *module*, which opens something with more than one
 * decision in it. That distinction is the reason the grid can be generated from
 * a table at all: a card that was sometimes a switch and sometimes a panel would
 * have to be written by hand every time.
 *
 * The RFX tab is the one this prototype actually enforces. Every switch on it
 * names a setting the sourcing code reads, and every module opens a panel that
 * already exists. The other tabs carry the plugins of the wider P2P suite: they
 * resolve and persist here like any other setting, but the behaviour they
 * govern lives in modules outside this build, and each says so rather than
 * implying an effect it cannot have.
 */

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/**
 * The icon a rail entry draws.
 *
 * Named here as a plain union rather than imported from the icon set, because
 * this module is domain code and the icon set is React. The admin shell checks
 * these against the icons it has; a name it does not know would be a compile
 * error there rather than a blank square at runtime.
 */
export type ControlRoomIcon =
  | 'wallet' | 'truck' | 'doc' | 'gauge' | 'chart' | 'box' | 'lock' | 'layers'
  | 'checkSq' | 'person' | 'org' | 'sparkle' | 'scan' | 'gear';

export interface ControlRoomEntry {
  id: string;
  label: string;
  icon: ControlRoomIcon;
  /**
   * What this area configures. Shown on the page itself, so an area with
   * nothing wired still tells an administrator what would be here.
   */
  blurb: string;
  /**
   * Whether this build implements it. False is not a defect — it is a module
   * of the suite that this prototype does not contain, and saying so is more
   * use than an empty page.
   */
  built: boolean;
}

export const CONTROL_ROOM: ControlRoomEntry[] = [
  {
    id: 'expense', label: 'Expense Configuration', icon: 'wallet', built: false,
    blurb: 'Claim categories, limits, receipt rules and the policies that gate reimbursement.',
  },
  {
    id: 'travel', label: 'Travel Configuration', icon: 'truck', built: false,
    blurb: 'Fare classes, booking windows, approval thresholds and preferred vendors.',
  },
  {
    id: 'invoices', label: 'Invoices Configuration', icon: 'doc', built: false,
    blurb: 'Matching tolerance, TDS treatment, payment terms and the exception queue.',
  },
  {
    id: 'utility', label: 'Utility Configuration', icon: 'gauge', built: false,
    blurb: 'Meter-based billing, consumption rules and the schedule invoices are raised on.',
  },
  {
    id: 'budget', label: 'Budget Configuration', icon: 'chart', built: false,
    blurb: 'Budget hierarchy, commitment accounting and what happens when a line is breached.',
  },
  {
    id: 'p2p', label: 'Procure to Pay Configuration', icon: 'box', built: true,
    blurb: 'Every plugin across the procurement chain — PR, RFQ, RFX, PO, GRN and contract.',
  },
  {
    id: 'notification', label: 'Notification Module', icon: 'lock', built: false,
    blurb: 'Which events notify whom, on which channel, and who may unsubscribe.',
  },
  {
    id: 'super-category', label: 'Super Category', icon: 'layers', built: false,
    blurb: 'The spend taxonomy above category: how categories roll up for reporting and policy.',
  },
  {
    id: 'policies', label: 'Policies Configuration', icon: 'checkSq', built: true,
    blurb: 'Delegation of authority, the approval matrix, and the simulator that proves it.',
  },
  {
    id: 'form-builder', label: 'Form Builder', icon: 'doc', built: true,
    blurb: 'The questionnaire template library and what each asking is worth.',
  },
  {
    id: 'access', label: 'Access Configuration', icon: 'person', built: true,
    blurb: 'Agent mandates and autonomy — what may act without a human, and within what limits.',
  },
  {
    id: 'other-workflow', label: 'Other Workflow', icon: 'org', built: false,
    blurb: 'Workflows outside the procurement chain: onboarding, asset transfer, exit.',
  },
  {
    id: 'module', label: 'Module Configuration', icon: 'layers', built: true,
    blurb: 'Which journeys this tenant runs, and the stages each one puts in front of a supplier.',
  },
  {
    id: 'studio', label: 'Dice Studio', icon: 'sparkle', built: false,
    blurb: 'Low-code screens and scripted automations built on top of the platform objects.',
  },
  {
    id: 'customization', label: 'Customization', icon: 'scan', built: false,
    blurb: 'Tenant branding, document templates and the labels used across the product.',
  },
  {
    id: 'global', label: 'Global Configuration', icon: 'gear', built: true,
    blurb: 'Tenant-wide defaults every event starts from: side, currency and document handling.',
  },
];

// ---------------------------------------------------------------------------
// Procure to Pay
// ---------------------------------------------------------------------------

export const P2P_TABS = ['Configuration', 'PR', 'RFQ', 'RFX', 'PO', 'GRN', 'Contract'] as const;

export type P2pTab = typeof P2P_TABS[number];

/**
 * One plugin card.
 *
 * `kind` is load-bearing. A switch is a boolean and nothing else, so the grid
 * can render it and write it without knowing what it means. A module has more
 * than one decision behind it and opens a panel, which is exactly what the
 * reference product does with PR Type and Conditional PO — a toggle would have
 * to stand for a set of choices it cannot express.
 */
export interface Plugin {
  id: string;
  title: string;
  description: string;
  kind: 'SWITCH' | 'MODULE';
  /** SWITCH only: the configuration key it resolves and writes. */
  key?: string;
  /** MODULE only: what opening it shows. Resolved by the page. */
  module?: string;
  /**
   * What actually changes when this is on, in this build.
   *
   * Shown behind the info icon. Null where the plugin belongs to a module this
   * prototype does not implement — the card then says so instead of describing
   * an effect that will not happen, because a switch that claims to do
   * something and does nothing is worse than one that admits it.
   */
  effect: string | null;
}

const RFX_PLUGINS: Plugin[] = [
  // --- Switches the sourcing code reads -------------------------------------
  {
    id: 'rfx-corrigendum', kind: 'SWITCH', key: 'event.corrigendum_reopens_deadline',
    title: 'Corrigendum Reopens Deadline',
    description: 'Enable so a corrigendum issued after an ask has gone out moves its closing date.',
    effect: 'Read by the extend dialog and the timeline rules. With it off, a changed requirement leaves suppliers whatever time was already left.',
  },
  {
    id: 'rfx-gate-docs', kind: 'SWITCH', key: 'event.gate_documents_on_acceptance',
    title: 'Gate Documents On Acceptance',
    description: 'Enable to withhold the tender documents until the invitation and NDA are accepted.',
    effect: 'Controls what the vendor portal serves before acceptance. The documents are withheld from the payload, not hidden on the page.',
  },
  {
    id: 'rfx-blind-technical', kind: 'SWITCH', key: 'evaluation.blind_technical',
    title: 'Blind Technical Evaluation',
    description: 'Enable to mask supplier identity from technical evaluators until the score is committed.',
    effect: 'The comparison sheet substitutes the masked label for the supplier name until the technical envelope is closed.',
  },
  {
    id: 'rfx-disclose-formula', kind: 'SWITCH', key: 'evaluation.disclose_formula',
    title: 'Disclose Scoring Formula',
    description: 'Enable to publish the award scoring model to suppliers along with the ask.',
    effect: 'Adds the weighting and price method to what the portal shows. Suppliers price differently when they can see how price is scored.',
  },
  {
    id: 'rfx-disclose-target', kind: 'SWITCH', key: 'auction.disclose_target',
    title: 'Disclose Target Price',
    description: "Enable to show the buyer's internal target to bidders during an auction.",
    effect: 'Off by default, and deliberately: a disclosed target stops being a target and becomes the price everybody bids.',
  },
  {
    id: 'rfx-rehearsal', kind: 'SWITCH', key: 'auction.require_dry_run_first_event',
    title: 'Require Rehearsal Before First Auction',
    description: 'Enable to require a practice run before a buyer runs their first live auction.',
    effect: 'The cockpit asks for a rehearsal to have been opened before it will start the auction, so a supplier learns the format on a bid that does not count.',
  },
  {
    id: 'rfx-reveal-asker', kind: 'SWITCH', key: 'clarification.reveal_asker',
    title: 'Reveal Clarification Asker',
    description: 'Enable to name the supplier who asked when a clarification answer is published to all.',
    effect: 'Off by default. A named question tells competitors what one supplier does not understand, which is itself commercial information.',
  },
  {
    id: 'rfx-provisional-award', kind: 'SWITCH', key: 'counterparty.provisional_award_allowed',
    title: 'Allow Provisional Counterparty Award',
    description: 'Enable to let a provisionally onboarded supplier be awarded, not merely bid.',
    effect: 'Checked at award. A provisional supplier can always be invited; this decides whether the award can land on one.',
  },
  {
    id: 'rfx-disclose-ai', kind: 'SWITCH', key: 'agents.disclose_ai_scoring_to_suppliers',
    title: 'Disclose AI Scoring To Suppliers',
    description: 'Enable to tell suppliers when their response has been scored with agent assistance.',
    effect: 'Read by the portal and by the regret letter. On by default — a supplier is entitled to know what scored them.',
  },

  // --- Modules: more than one decision behind them ---------------------------
  {
    id: 'rfx-journeys', kind: 'MODULE', module: 'patterns',
    title: 'Journey Patterns',
    description: 'Configure which journeys this tenant runs and the asks each one issues.',
    effect: 'The journey decides which stages exist, which of them put a questionnaire in front of a supplier, and the order they run in.',
  },
  {
    id: 'rfx-questionnaires', kind: 'MODULE', module: 'questionnaire',
    title: 'Questionnaire Library',
    description: 'Question sets per category, and what each asking is worth across the journey.',
    effect: 'A template is written for a category and copied onto the event. An event spanning several categories carries one questionnaire per category.',
  },
  {
    id: 'rfx-evaluation', kind: 'MODULE', module: 'evaluation',
    title: 'Evaluation Model',
    description: 'Envelope mode, the technical gate, consensus and when commercials unlock.',
    effect: 'Envelope mode is a permissions boundary, not a layout preference: under two-envelope a technical evaluator cannot reach a commercial answer by any route.',
  },
  {
    id: 'rfx-auction-rules', kind: 'MODULE', module: 'auction',
    title: 'Auction Rules',
    description: 'Feedback policy, decrement limits, tie handling and the anti-gaming guards.',
    effect: 'These are the rules a bid is accepted or refused against, and the ones the cockpit shows bidders while the auction runs.',
  },
  {
    id: 'rfx-negotiation', kind: 'MODULE', module: 'negotiation',
    title: 'Negotiation Rounds',
    description: 'How many rounds of counter-offer a negotiation may run before it must close.',
    effect: 'Enforced when a round is opened, so a negotiation cannot quietly run until the supplier gives in.',
  },
  {
    id: 'rfx-award', kind: 'MODULE', module: 'award',
    title: 'Award & Regret',
    description: 'What an override costs in approvals, what a regretted bidder is told, and PO handoff.',
    effect: 'Awarding other than rank one adds approval levels automatically, so the override is visible rather than argued.',
  },
  {
    id: 'rfx-approval', kind: 'MODULE', module: 'approval',
    title: 'Approval SLA',
    description: 'How long an approver has before the request escalates.',
    effect: 'Drives the ageing on the approval queue and the escalation the NFA chain applies.',
  },
  {
    id: 'rfx-comparison', kind: 'MODULE', module: 'compare',
    title: 'Comparison Basis',
    description: 'Whether bids are compared on quoted price or on landed cost.',
    effect: 'Landed cost adds freight, duty and the other cost components before ranking, so the cheapest quote and the cheapest bid need not be the same supplier.',
  },
];

/**
 * The plugins of the wider P2P suite.
 *
 * Transcribed from the product they belong to. They resolve and persist through
 * the same scope chain as everything else, so an administrator can set them
 * here; what they govern is in modules this prototype does not contain, which
 * is what `effect: null` says on the card.
 */
const PR_PLUGINS: Plugin[] = [
  {
    id: 'pr-type', kind: 'MODULE', module: 'unavailable', title: 'PR Type',
    description: 'Enable to configure predefined PR types for selection during PR creation.',
    effect: null,
  },
  {
    id: 'pr-restrict-past-price', kind: 'SWITCH', key: 'p2p.pr.restrict_past_purchase_price',
    title: 'Restrict Past Purchase Price',
    description: 'Enable to prevent PR raisers from viewing or using past purchase prices when creating a new Purchase Request.',
    effect: null,
  },
  {
    id: 'pr-restricted-change', kind: 'SWITCH', key: 'p2p.pr.restricted_change',
    title: 'Restricted PR Change',
    description: 'Enable to enforce an approval workflow for any modifications made to an existing PR.',
    effect: null,
  },
  {
    id: 'pr-bom', kind: 'SWITCH', key: 'p2p.pr.enable_bom',
    title: 'Enable BOM',
    description: 'Enable this to allow BOM selection while creating a PR.',
    effect: null,
  },
  {
    id: 'pr-reopen-on-rfq-cancel', kind: 'SWITCH', key: 'p2p.pr.reopen_on_rfq_cancel',
    title: 'PR Re-open On RFQ Cancel',
    description: 'Enable to reopen a PR when the associated RFQ is cancelled.',
    effect: null,
  },
  {
    id: 'pr-edit-bom-qty', kind: 'SWITCH', key: 'p2p.pr.allow_edit_bom_quantity',
    title: 'Allow User To Edit BOM Quantity',
    description: 'Enable to allow users to modify the quantity of items in the BOM during the procurement process.',
    effect: null,
  },
  {
    id: 'pr-product-view-bom', kind: 'SWITCH', key: 'p2p.pr.product_view_with_bom',
    title: 'Product View With BOM',
    description: 'Enable this to display products along with their BOM.',
    effect: null,
  },
  {
    id: 'pr-copy-form-to-rfq', kind: 'SWITCH', key: 'p2p.pr.copy_form_to_rfq',
    title: 'Copy PR Form To RFQ',
    description: 'Enable this to carry forward the PR form fields into the RFQ creation process.',
    effect: null,
  },
  {
    id: 'pr-admin-approval', kind: 'SWITCH', key: 'p2p.pr.admin_approval_flow',
    title: 'PR Admin Approval Flow',
    description: 'Enable this plugin if you want to allow a finance admin to approve PRs.',
    effect: null,
  },
  {
    id: 'pr-type-creation-flow', kind: 'SWITCH', key: 'p2p.pr.type_creation_flow',
    title: 'PR Type Creation Flow',
    description: 'Enable this plugin if you want to use PR types for PR creation.',
    effect: null,
  },
  {
    id: 'pr-budget-soft-stop', kind: 'SWITCH', key: 'p2p.pr.budget_soft_stop',
    title: 'Budget PR Soft Stop',
    description: 'Enable this plugin if you want to soft stop a PR when the PR amount exceeds the budget limit.',
    effect: null,
  },
  {
    id: 'pr-workflow-refresh', kind: 'SWITCH', key: 'p2p.pr.workflow_refresh_on_edit',
    title: 'Workflow Refresh On PR Edit',
    description: 'Enable this plugin if you want to refresh the workflow when a PR is edited.',
    effect: null,
  },
];

const RFQ_PLUGINS: Plugin[] = [
  {
    id: 'rfq-reopen', kind: 'SWITCH', key: 'p2p.rfq.reopen',
    title: 'RFQ Re-Open',
    description: 'Enable to allow reopening of an RFQ if it is declined during the PO stage.',
    effect: null,
  },
  {
    id: 'rfq-vendor-preselect', kind: 'SWITCH', key: 'p2p.rfq.vendor_preselect',
    title: 'RFQ Vendor Preselect',
    description: 'Enable this if you want to preselect the vendor at RFQ.',
    effect: null,
  },
  {
    id: 'rfq-copy-file-to-po', kind: 'SWITCH', key: 'p2p.rfq.copy_file_to_po',
    title: 'Copy RFQ File To PO',
    description: 'Enable to carry the RFQ attachments forward onto the purchase order.',
    effect: null,
  },
  {
    id: 'rfq-restrict-po-qty', kind: 'SWITCH', key: 'p2p.rfq.restrict_po_quantity',
    title: 'Restrict RFQ PO Quantity',
    description: 'Enable this plugin if you want to restrict the RFQ PO quantity.',
    effect: null,
  },
  {
    id: 'rfq-basic-product-restriction', kind: 'SWITCH', key: 'p2p.rfq.basic_product_restriction',
    title: 'Basic Product Restriction In RFQ',
    description: 'Enable this plugin to allow RFQ negotiation even if the product is not fully added.',
    effect: null,
  },
  {
    id: 'rfq-amount-violation', kind: 'SWITCH', key: 'p2p.rfq.amount_violation',
    title: 'Amount Violation At RFQ',
    description: 'Enable to trigger validation when the quoted amount in an RFQ exceeds defined limits.',
    effect: null,
  },
  {
    id: 'rfq-direct-without-quotation', kind: 'SWITCH', key: 'p2p.rfq.direct_without_quotation',
    title: 'Direct RFQ Without Quotation',
    description: 'Enable this to allow RFQs to be raised without attaching a quotation.',
    effect: null,
  },
  {
    id: 'rfq-copy-form-to-po', kind: 'SWITCH', key: 'p2p.rfq.copy_form_to_po',
    title: 'Copy RFQ Form To PO',
    description: 'Enable this plugin if you want to copy RFQ form data to PO creation directly.',
    effect: null,
  },
  {
    id: 'rfq-complete-without-all-quotes', kind: 'SWITCH', key: 'p2p.rfq.complete_without_all_quotes',
    title: 'Allow RFQ Completion Without All Item Quotes',
    description: 'Enable this plugin to allow an RFQ to be completed even if quotes for all items are not submitted.',
    effect: null,
  },
  {
    id: 'rfq-manual-send-to-approval', kind: 'SWITCH', key: 'p2p.rfq.manual_send_to_approval',
    title: 'Manual RFQ Send To Approval',
    description: 'Enable this plugin to manually trigger the RFQ approval process.',
    effect: null,
  },
  {
    id: 'rfq-update-negotiation-stage', kind: 'SWITCH', key: 'p2p.rfq.update_negotiation_stage',
    title: 'Update Negotiation Stage',
    description: 'Enable to allow editing or updating details during the negotiation stage.',
    effect: null,
  },
  {
    id: 'rfq-qty-level-preselect', kind: 'SWITCH', key: 'p2p.rfq.qty_level_vendor_preselection',
    title: 'RFQ Qty Level Vendor Pre-Selection',
    description: 'Enable to require vendor selection for each product at the quantity level during the RFQ stage.',
    effect: null,
  },
];

const PO_PLUGINS: Plugin[] = [
  {
    id: 'po-type', kind: 'MODULE', module: 'unavailable', title: 'PO Type',
    description: 'Enable to configure predefined PO types for selection during PO creation.',
    effect: null,
  },
  {
    id: 'po-invoice-qty-restriction', kind: 'SWITCH', key: 'p2p.po.invoice_qty_restriction',
    title: 'Invoice PO Qty Restriction',
    description: 'Enable this plugin if you want to restrict invoice quantity to no more than the PO quantity.',
    effect: null,
  },
  {
    id: 'po-grn-tagging', kind: 'SWITCH', key: 'p2p.po.grn_tagging',
    title: 'PO GRN Tagging',
    description: 'Enable this plugin to allow PO GRN tagging.',
    effect: null,
  },
  {
    id: 'po-inventory-tracking', kind: 'SWITCH', key: 'p2p.po.inventory_tracking',
    title: 'Inventory Tracking Across Platform',
    description: 'Enable to track inventory across multiple modules within the platform.',
    effect: null,
  },
  {
    id: 'po-direct-tagging', kind: 'SWITCH', key: 'p2p.po.direct_tagging',
    title: 'Direct Tagging',
    description: 'Enable this plugin if you want to enable direct owner tagging.',
    effect: null,
  },
  {
    id: 'po-conditional', kind: 'MODULE', module: 'unavailable', title: 'Conditional PO',
    description: 'Enable this plugin if you want to enable conditional POs.',
    effect: null,
  },
  {
    id: 'po-custom-number', kind: 'SWITCH', key: 'p2p.po.custom_number',
    title: 'Custom PO Number',
    description: 'Enable this plugin if you want to enable custom PO numbering.',
    effect: null,
  },
  {
    id: 'po-renewal-tracking', kind: 'SWITCH', key: 'p2p.po.renewal_tracking',
    title: 'Renewal Tracking',
    description: 'Enable this if you want to enable renewal tracking.',
    effect: null,
  },
  {
    id: 'po-auto-billing-address', kind: 'SWITCH', key: 'p2p.po.auto_billing_address',
    title: 'Enable Auto Billing Address',
    description: 'Enable this if you want to enable the automatic billing address.',
    effect: null,
  },
  {
    id: 'po-refresh-on-approve', kind: 'SWITCH', key: 'p2p.po.refresh_on_approve',
    title: 'Refresh PO On Approve',
    description: 'Enable to automatically update the PO PDF with the latest details at every stage of approval.',
    effect: null,
  },
  {
    id: 'po-direct', kind: 'SWITCH', key: 'p2p.po.direct_po',
    title: 'Direct PO',
    description: 'Enable this plugin if you want to allow a PO to be created without an RFQ.',
    effect: null,
  },
];

const GRN_PLUGINS: Plugin[] = [
  {
    id: 'grn-enable', kind: 'SWITCH', key: 'p2p.grn.enable',
    title: 'GRN Enable',
    description: 'Enable to allow users to create GRNs directly from the dashboard.',
    effect: null,
  },
  {
    id: 'grn-automate-owner', kind: 'SWITCH', key: 'p2p.grn.automate_owner',
    title: 'Automate GRN Owner',
    description: 'Enable this plugin if you want to automate the GRN owner.',
    effect: null,
  },
  {
    id: 'grn-direct-po', kind: 'SWITCH', key: 'p2p.grn.direct_po',
    title: 'Direct PO GRN',
    description: 'Enable to allow creation of GRNs directly against POs.',
    effect: null,
  },
  {
    id: 'grn-block-creation', kind: 'SWITCH', key: 'p2p.grn.block_creation',
    title: 'Block GRN Creation',
    description: 'Enable to block the creation of GRNs across the entire platform.',
    effect: null,
  },
  {
    id: 'grn-excess-qty', kind: 'SWITCH', key: 'p2p.grn.excess_qty_not_allowed',
    title: 'Excess Qty GRN Not Allowed',
    description: 'Enable to prevent creation of GRNs with quantities exceeding the corresponding PO quantities.',
    effect: null,
  },
  {
    id: 'grn-invoice-due-date', kind: 'SWITCH', key: 'p2p.grn.invoice_due_date_on_grn_date',
    title: 'Invoice Due Date On GRN Date',
    description: 'Enable this plugin if you want to calculate the invoice due date on the basis of the GRN date.',
    effect: null,
  },
  {
    id: 'grn-one-asn-one-invoice', kind: 'SWITCH', key: 'p2p.grn.one_asn_one_invoice_one_grn',
    title: 'One ASN One Invoice One GRN',
    description: 'Enable to enforce a strict one-to-one mapping between the ASN, invoice and GRN.',
    effect: null,
  },
  {
    id: 'grn-conditional', kind: 'SWITCH', key: 'p2p.grn.conditional',
    title: 'Conditional GRN Enabled',
    description: 'Enable to allow conditional GRNs based on organization-defined conditions.',
    effect: null,
  },
  {
    id: 'grn-batch-wise', kind: 'SWITCH', key: 'p2p.grn.batch_wise_at_lineitem',
    title: 'Batch Wise GRN At Line Item Level',
    description: 'Enable this plugin to allow batch wise GRN creation at the individual line item level.',
    effect: null,
  },
  {
    id: 'grn-restrict-credit-note', kind: 'SWITCH', key: 'p2p.grn.restrict_credit_note_before_sync',
    title: 'Restrict Credit Note Before GRN Sync',
    description: 'Enable this plugin to restrict a credit note before GRN sync.',
    effect: null,
  },
];

const CONTRACT_PLUGINS: Plugin[] = [
  {
    id: 'contract-tds-lineitem', kind: 'SWITCH', key: 'p2p.contract.tds_at_lineitem',
    title: 'TDS At Line Item In Contract',
    description: 'Enable to apply TDS at the line item level within a contract.',
    effect: null,
  },
  {
    id: 'contract-manual-escalation', kind: 'SWITCH', key: 'p2p.contract.manual_escalation',
    title: 'Manual Contract Escalation',
    description: 'Enable this to manually escalate a contract when required.',
    effect: null,
  },
  {
    id: 'contract-admin-cancel', kind: 'SWITCH', key: 'p2p.contract.admin_canceling',
    title: 'Enable Admin Contract Canceling',
    description: 'Enable to allow admin users to cancel contracts.',
    effect: null,
  },
  {
    id: 'contract-multiple-deposit', kind: 'SWITCH', key: 'p2p.contract.multiple_deposit_type',
    title: 'Multiple Deposit Type Per Contract Item',
    description: 'Enable this plugin to allow adding multiple deposit types for each contract line item.',
    effect: null,
  },
  {
    id: 'contract-block-po-lineitem', kind: 'SWITCH', key: 'p2p.contract.block_po_lineitem_invoice',
    title: 'Block Contract PO Line Item For Invoice Submission',
    description: 'Enable to restrict invoice submission for contract PO line items.',
    effect: null,
  },
  {
    id: 'contract-obligations-on-invoice', kind: 'SWITCH', key: 'p2p.contract.obligations_on_invoice',
    title: 'Contract Obligations On Invoice',
    description: 'Enable to apply contract obligations on an invoice.',
    effect: null,
  },
  {
    id: 'contract-invoice-queue', kind: 'SWITCH', key: 'p2p.contract.invoice_queue_automation',
    title: 'Contract Invoice Queue Automation',
    description: 'Generate rental and utility contract invoices from a scheduled queue.',
    effect: null,
  },
];

/**
 * The Configuration tab: the settings that are not per-document-type.
 *
 * It holds the two that genuinely govern the whole chain in this build — the
 * side a tenant buys on and the currency it buys in — because they belong to no
 * one document type and have to live somewhere.
 */
const CONFIGURATION_PLUGINS: Plugin[] = [
  {
    id: 'cfg-side', kind: 'MODULE', module: 'global',
    title: 'Tenant Defaults',
    description: 'The side this tenant trades on and the currency every event is raised in.',
    effect: 'Every event starts from these. Currency in particular is one constant rather than a literal per screen, so a board and its line items cannot read in different money.',
  },
  {
    id: 'cfg-modules', kind: 'MODULE', module: 'module',
    title: 'Module Enablement',
    description: 'Which journeys this tenant may run, and therefore which asks it can raise.',
    effect: 'A journey that is off cannot be selected in the wizard, so the stages behind it are never created.',
  },
];

export const PLUGIN_CATALOGUE: Record<P2pTab, Plugin[]> = {
  Configuration: CONFIGURATION_PLUGINS,
  PR: PR_PLUGINS,
  RFQ: RFQ_PLUGINS,
  RFX: RFX_PLUGINS,
  PO: PO_PLUGINS,
  GRN: GRN_PLUGINS,
  Contract: CONTRACT_PLUGINS,
};

/**
 * The suite plugins that ship switched on. Everything else ships off.
 *
 * Only the exceptions are listed, but the defaults table below is built from
 * the catalogue rather than from this list, so a plugin cannot be added to a
 * tab and quietly end up with no declared default — a missing default is one
 * that gets invented at the call site, and then the card and the resolver
 * disagree about what "off" means.
 */
const P2P_PLUGINS_ON: string[] = [
  'p2p.pr.enable_bom',
  'p2p.pr.reopen_on_rfq_cancel',
  'p2p.pr.copy_form_to_rfq',
  'p2p.rfq.reopen',
  'p2p.rfq.copy_file_to_po',
  'p2p.rfq.basic_product_restriction',
  'p2p.po.inventory_tracking',
  'p2p.po.direct_tagging',
  'p2p.po.auto_billing_address',
  'p2p.po.refresh_on_approve',
  'p2p.grn.enable',
  'p2p.grn.automate_owner',
  'p2p.grn.direct_po',
  'p2p.grn.one_asn_one_invoice_one_grn',
];

/**
 * Default state of every suite plugin, keyed by its setting.
 *
 * Merged into the tenant defaults, so these resolve through the same chain as
 * the sourcing settings do. The sourcing settings keep their own defaults
 * beside the behaviour they govern and are not rebuilt here.
 */
export const P2P_PLUGIN_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  (['PR', 'RFQ', 'PO', 'GRN', 'Contract'] as P2pTab[])
    .flatMap((tab) => PLUGIN_CATALOGUE[tab])
    .filter((plugin) => plugin.kind === 'SWITCH' && plugin.key !== undefined)
    .map((plugin) => [plugin.key as string, P2P_PLUGINS_ON.includes(plugin.key as string)]),
);

/** Plugins on a tab, narrowed by a search box. Matches title and description. */
export function pluginsFor(tab: P2pTab, query = ''): Plugin[] {
  const needle = query.trim().toLowerCase();
  const all = PLUGIN_CATALOGUE[tab] ?? [];
  if (needle === '') return all;
  return all.filter(
    (plugin) =>
      plugin.title.toLowerCase().includes(needle) ||
      plugin.description.toLowerCase().includes(needle),
  );
}

/**
 * How many plugins on a tab this build actually enforces.
 *
 * Shown as the tab's badge. A tab reading 0 is not broken — it is the suite's
 * configuration surface, kept so the product's shape is the same here as it is
 * everywhere else.
 */
export function wiredCount(tab: P2pTab): number {
  return (PLUGIN_CATALOGUE[tab] ?? []).filter((plugin) => plugin.effect !== null).length;
}
