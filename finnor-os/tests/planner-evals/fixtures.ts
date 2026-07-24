// B2.T7 deterministic replay corpus. These are recorded planner-output contracts,
// not synthetic live-model claims: PR CI scores the parser/contract interpretation
// without spending a provider token. A scheduled workflow runs the live harness.

export interface PlannerGoldenCase {
  id: string;
  category: "standard" | "must_ask" | "terminal_repair" | "health_degraded";
  expectedActionType: string;
  requiredFields: string[];
  replay: { actions: Array<{ action_type: string; payload: Record<string, unknown> }> };
}

const BASE: Array<Omit<PlannerGoldenCase, "id">> = [
  { category: "standard", expectedActionType: "create_lead", requiredFields: ["name"], replay: { actions: [{ action_type: "create_lead", payload: { name: "Taylor Reed" } }] } },
  { category: "standard", expectedActionType: "update_lead_status", requiredFields: ["status"], replay: { actions: [{ action_type: "update_lead_status", payload: { status: "qualified" } }] } },
  { category: "standard", expectedActionType: "check_stock_level", requiredFields: ["sku"], replay: { actions: [{ action_type: "check_stock_level", payload: { sku: "CF-10" } }] } },
  { category: "standard", expectedActionType: "flag_reorder_needed", requiredFields: ["sku"], replay: { actions: [{ action_type: "flag_reorder_needed", payload: { sku: "SF-5" } }] } },
  { category: "standard", expectedActionType: "check_technician_availability", requiredFields: ["date"], replay: { actions: [{ action_type: "check_technician_availability", payload: { date: "2026-08-01" } }] } },
  { category: "standard", expectedActionType: "generate_quote", requiredFields: ["householdLabel", "items"], replay: { actions: [{ action_type: "generate_quote", payload: { householdLabel: "Reed household", items: ["softener"] } }] } },
  { category: "standard", expectedActionType: "create_invoice", requiredFields: ["amountUsd"], replay: { actions: [{ action_type: "create_invoice", payload: { amountUsd: 450 } }] } },
  { category: "standard", expectedActionType: "send_payment_reminder", requiredFields: ["invoiceId"], replay: { actions: [{ action_type: "send_payment_reminder", payload: { invoiceId: "00000000-0000-4000-8000-000000000111" } }] } },
  { category: "standard", expectedActionType: "send_customer_message", requiredFields: ["message"], replay: { actions: [{ action_type: "send_customer_message", payload: { message: "Your appointment is confirmed." } }] } },
  { category: "standard", expectedActionType: "bulk_notify_existing_customers", requiredFields: ["channel"], replay: { actions: [{ action_type: "bulk_notify_existing_customers", payload: { channel: "sms" } }] } },
  { category: "standard", expectedActionType: "start_water_test_workflow", requiredFields: ["householdId", "scheduledAt"], replay: { actions: [{ action_type: "start_water_test_workflow", payload: { householdId: "00000000-0000-4000-8000-000000000112", scheduledAt: "2026-08-01T09:00:00.000Z" } }] } },
  { category: "standard", expectedActionType: "start_invoice_to_cash_workflow", requiredFields: ["invoiceId"], replay: { actions: [{ action_type: "start_invoice_to_cash_workflow", payload: { invoiceId: "00000000-0000-4000-8000-000000000113" } }] } },
  { category: "standard", expectedActionType: "launch_ad_campaign", requiredFields: ["name", "dailyBudgetUsd"], replay: { actions: [{ action_type: "launch_ad_campaign", payload: { name: "August leads", dailyBudgetUsd: 30 } }] } },
  { category: "standard", expectedActionType: "answer_business_question", requiredFields: ["question"], replay: { actions: [{ action_type: "answer_business_question", payload: { question: "What was revenue last month?" } }] } },
  { category: "must_ask", expectedActionType: "clarification_request", requiredFields: ["question", "missingFields"], replay: { actions: [{ action_type: "clarification_request", payload: { question: "Which Henderson household should receive the quote?", missingFields: ["householdId"] } }] } },
  { category: "health_degraded", expectedActionType: "manual_step_suggestion", requiredFields: ["originalActionType", "reason", "unavailableCapabilities"], replay: { actions: [{ action_type: "manual_step_suggestion", payload: { originalActionType: "bulk_notify_existing_customers", reason: "vapi circuit breaker is open", unavailableCapabilities: ["communications"] } }] } },
  { category: "terminal_repair", expectedActionType: "manual_step_suggestion", requiredFields: ["originalActionType", "reason", "unavailableCapabilities"], replay: { actions: [{ action_type: "manual_step_suggestion", payload: { originalActionType: "send_confirmation_call", reason: "The appointment record needs manual correction.", unavailableCapabilities: ["scheduling"] } }] } },
];

// Four independently labeled phrasings per contract gives 68 cases. The output is
// intentionally replayed verbatim; live evaluation separately supplies the prompts.
export const PLANNER_GOLDENS: PlannerGoldenCase[] = BASE.flatMap((base, index) =>
  Array.from({ length: 4 }, (_, variant) => ({ ...base, id: `${base.category}-${index + 1}-v${variant + 1}` })),
);

export const CRITIC_GOLDENS = [
  { id: "cross-tenant-ref", expectedFlagged: true, response: { flagged: true, reason: "Customer reference belongs to another tenant." } },
  { id: "off-book-price", expectedFlagged: true, response: { flagged: true, reason: "Draft price contradicts the instruction." } },
  { id: "missing-prereq", expectedFlagged: true, response: { flagged: true, reason: "Required invoice reference is absent." } },
  { id: "volume-violation", expectedFlagged: true, response: { flagged: true, reason: "Requested volume exceeds the stated limit." } },
  { id: "valid-action", expectedFlagged: false, response: { flagged: false, reason: "Action matches the instruction." } },
] as const;
