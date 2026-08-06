export type ActionProfile =
  | "READ_ONLY"
  | "INTERNAL_DRAFT"
  | "INTERNAL_WRITE"
  | "OPERATIONAL_CHANGE"
  | "FINANCIAL_WRITE"
  | "EXTERNAL_SIDE_EFFECT"
  | "EXTERNAL_SPEND"
  | "BATCH_EXTERNAL"
  | "DURABLE_WORKFLOW"
  | "META_NO_SIDE_EFFECT";

export type ApprovalFloor = "NONE" | "POLICY" | "REQUIRED" | "TYPED_REQUIRED";

export interface ActionHardeningSpecRow {
  plugin: string;
  actionType: string;
  profile: ActionProfile;
  approvalFloor: ApprovalFloor;
  capabilityFamily: string;
  external: boolean;
  receipt: true;
}

/** The binding table in plan §3.3. This is intentionally not inferred from code. */
const FIXED_ROWS: ReadonlyArray<readonly [string, string, ActionProfile, ApprovalFloor, string, boolean]> = [
  ["accounting", "create_invoice", "OPERATIONAL_CHANGE", "REQUIRED", "accounting", true],
  ["accounting", "send_payment_reminder", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "communications/accounting", true],
  ["accounting", "record_payment", "FINANCIAL_WRITE", "TYPED_REQUIRED", "accounting/payments", true],
  ["accounting", "call_overdue_invoices", "BATCH_EXTERNAL", "TYPED_REQUIRED", "voice/communications", true],
  ["bulk-notify", "bulk_notify_existing_customers", "BATCH_EXTERNAL", "TYPED_REQUIRED", "communications", true],
  ["clarification", "clarification_request", "META_NO_SIDE_EFFECT", "NONE", "none", false],
  ["compliance-documentation", "generate_compliance_summary", "INTERNAL_DRAFT", "POLICY", "documents", false],
  ["crm", "create_lead", "INTERNAL_WRITE", "POLICY", "crm", false],
  ["crm", "update_lead_status", "INTERNAL_WRITE", "POLICY", "crm", false],
  ["crm", "log_interaction", "INTERNAL_WRITE", "NONE", "crm", false],
  ["crm", "assign_lead_to_technician", "OPERATIONAL_CHANGE", "REQUIRED", "crm/scheduling", false],
  ["customer-comm", "answer_customer_question", "READ_ONLY", "NONE", "llm/evidence", false],
  ["customer-comm", "send_customer_message", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "communications", true],
  ["customer-comm", "send_follow_up", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "communications", true],
  ["inventory", "check_stock_level", "READ_ONLY", "NONE", "inventory", false],
  ["inventory", "flag_reorder_needed", "INTERNAL_WRITE", "POLICY", "inventory", false],
  ["inventory", "log_stock_used_on_visit", "OPERATIONAL_CHANGE", "POLICY", "inventory", false],
  ["invoice-to-cash", "start_invoice_to_cash_workflow", "DURABLE_WORKFLOW", "TYPED_REQUIRED", "accounting/communications", true],
  ["lead-to-water-test", "start_water_test_workflow", "DURABLE_WORKFLOW", "REQUIRED", "crm/scheduling/communications", true],
  ["maintenance-agreement", "renew_maintenance_agreement", "DURABLE_WORKFLOW", "REQUIRED", "documents/esign/communications", true],
  ["manual-step", "manual_step_suggestion", "META_NO_SIDE_EFFECT", "NONE", "none", false],
  ["marketing", "summarize_ad_performance", "READ_ONLY", "NONE", "marketing", false],
  ["marketing", "launch_ad_campaign", "EXTERNAL_SPEND", "TYPED_REQUIRED", "marketing", true],
  ["marketing", "create_review_request", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "communications", true],
  ["ops-overview", "get_business_overview", "READ_ONLY", "NONE", "read-models", false],
  ["ops-overview", "answer_business_question", "READ_ONLY", "NONE", "read-models/llm", false],
  ["proposal-batch", "send_proposal_to_recent_installs", "BATCH_EXTERNAL", "TYPED_REQUIRED", "documents/communications", true],
  ["proposal-signature", "request_proposal_signature", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "esign/communications", true],
  ["proposal-to-installation", "start_installation_workflow", "DURABLE_WORKFLOW", "REQUIRED", "scheduling/documents/communications", true],
  ["quotation", "generate_quote", "INTERNAL_DRAFT", "POLICY", "documents/price-book", false],
  ["quotation", "size_equipment_for_household", "READ_ONLY", "NONE", "water-domain/price-book", false],
  ["quotation", "send_proposal", "EXTERNAL_SIDE_EFFECT", "REQUIRED", "documents/communications", true],
  ["route-optimization", "route_suggestion", "READ_ONLY", "NONE", "routing", false],
  ["scheduling", "assign_technician_to_visit", "OPERATIONAL_CHANGE", "REQUIRED", "scheduling", false],
  ["scheduling", "check_technician_availability", "READ_ONLY", "NONE", "scheduling", false],
  ["scheduling", "reschedule_visit", "OPERATIONAL_CHANGE", "REQUIRED", "scheduling/communications", true],
  ["service-reminders", "check_reminder_due", "READ_ONLY", "NONE", "scheduling", false],
  ["technician-reports", "log_visit_report", "INTERNAL_WRITE", "POLICY", "crm/documents", false],
  ["technician-reports", "flag_visit_issue", "INTERNAL_WRITE", "POLICY", "crm/operations", false],
  ["water-domain-knowledge", "answer_water_question", "READ_ONLY", "NONE", "llm/evidence", false],
  ["water-test", "schedule_water_test", "OPERATIONAL_CHANGE", "REQUIRED", "scheduling/communications", true],
  ["web-research", "search_web", "READ_ONLY", "NONE", "exa/firecrawl/evidence", false],
  ["web-research", "scan_competitors", "READ_ONLY", "NONE", "exa/firecrawl/evidence", false],
  ["web-research", "check_business_reviews", "READ_ONLY", "NONE", "exa/firecrawl/evidence", false],
];

export const ACTION_HARDENING_SPEC: readonly ActionHardeningSpecRow[] = FIXED_ROWS.map(([plugin, actionType, profile, approvalFloor, capabilityFamily, external]) => ({
  plugin,
  actionType,
  profile: profile as ActionProfile,
  approvalFloor: approvalFloor as ApprovalFloor,
  capabilityFamily,
  external,
  receipt: true as const,
}));

export const ACTION_HARDENING_SPEC_BY_ACTION = new Map(ACTION_HARDENING_SPEC.map((row) => [row.actionType, row]));

if (ACTION_HARDENING_SPEC.length !== 44 || new Set(ACTION_HARDENING_SPEC.map((row) => row.actionType)).size !== 44) {
  throw new Error("The release action hardening spec must contain exactly 44 unique action types.");
}
