import type { UserCapabilityRegistry } from "./user-capability-registry";

export type DealerZeroPreconditionStrategy =
  | "seeded"
  | "self_contained"
  | "intake_context"
  | "journey_created"
  | "sandbox_or_configured_provider";

export interface DealerZeroCapabilityPrecondition {
  capability: string;
  strategy: DealerZeroPreconditionStrategy;
  requiredFacts: readonly string[];
  setupCapabilities: readonly string[];
  /** Honest terminal behavior when a real external binding is intentionally absent. */
  unavailableOutcome?: "visible_configuration_failure";
}

interface Group {
  capabilities: readonly string[];
  strategy: DealerZeroPreconditionStrategy;
  requiredFacts: readonly string[];
  setupCapabilities?: readonly string[];
  unavailableOutcome?: "visible_configuration_failure";
}

const GROUPS: readonly Group[] = [
  {
    capabilities: ["create_lead", "size_equipment_for_household", "check_reminder_due", "generate_compliance_summary", "answer_water_question", "clarification_request", "manual_step_suggestion"],
    strategy: "self_contained",
    requiredFacts: ["validated English payload"],
  },
  {
    capabilities: ["schedule_water_test", "update_lead_status", "log_interaction", "assign_lead_to_technician", "answer_customer_question"],
    strategy: "seeded",
    requiredFacts: ["canonical customers with contacts", "leads at new/contacted/qualified stages", "technicians and schedule policy"],
  },
  {
    capabilities: ["check_stock_level", "flag_reorder_needed", "log_stock_used_on_visit"],
    strategy: "seeded",
    requiredFacts: ["inventory above and below reorder thresholds", "canonical service visits"],
  },
  {
    capabilities: ["assign_technician_to_visit", "check_technician_availability", "reschedule_visit", "log_visit_report", "flag_visit_issue", "route_suggestion"],
    strategy: "seeded",
    requiredFacts: ["open and completed service visits", "technicians", "explicit customer and company coordinates"],
  },
  {
    capabilities: ["generate_quote", "start_installation_workflow"],
    strategy: "seeded",
    requiredFacts: ["canonical customer", "price book", "accepted install quote", "available inventory"],
  },
  {
    capabilities: ["create_invoice", "record_payment", "start_invoice_to_cash_workflow"],
    strategy: "seeded",
    requiredFacts: ["canonical customer", "overdue invoice fixture"],
  },
  {
    capabilities: ["get_business_overview", "answer_business_question"],
    strategy: "seeded",
    requiredFacts: ["canonical business truth across customers, schedule, money, inventory and Work"],
  },
  {
    capabilities: ["start_water_test_workflow"],
    strategy: "seeded",
    requiredFacts: ["canonical customer with phone", "technician", "future dealer-local time"],
  },
  {
    capabilities: ["create_task", "assign_task", "update_task"],
    strategy: "seeded",
    requiredFacts: ["canonical subject", "employee/team roster", "baseline task fixture"],
  },
  {
    capabilities: ["schedule_internal_event"],
    strategy: "seeded",
    requiredFacts: ["employee/team roster", "company location", "dealer timezone"],
  },
  {
    capabilities: ["share_document"],
    strategy: "seeded",
    requiredFacts: ["shareable canonical document", "resolved recipient"],
  },
  {
    capabilities: ["handoff_work", "delegate_objective"],
    strategy: "intake_context",
    requiredFacts: ["current canonical Work created at JARVIS intake", "employee/team roster"],
    setupCapabilities: ["get_business_overview"],
  },
  {
    capabilities: ["escalate_work", "cancel_delegation"],
    strategy: "journey_created",
    requiredFacts: ["delegation created by an earlier real JARVIS command", "current canonical Work"],
    setupCapabilities: ["delegate_objective"],
  },
  {
    capabilities: ["reschedule_internal_event"],
    strategy: "journey_created",
    requiredFacts: ["internal event created by an earlier real JARVIS command"],
    setupCapabilities: ["schedule_internal_event"],
  },
  {
    capabilities: [
      "renew_maintenance_agreement", "send_proposal", "send_payment_reminder", "call_overdue_invoices",
      "summarize_ad_performance", "launch_ad_campaign", "create_review_request", "send_customer_message",
      "send_follow_up", "send_proposal_to_recent_installs", "bulk_notify_existing_customers", "search_web",
      "scan_competitors", "check_business_reviews", "request_proposal_signature", "send_message", "place_call",
      "request_acknowledgement", "notify_group", "computer_task",
    ],
    strategy: "sandbox_or_configured_provider",
    requiredFacts: ["resolved canonical target", "Dealer Zero sandbox binding or explicit provider configuration"],
    unavailableOutcome: "visible_configuration_failure",
  },
  {
    capabilities: [
      "customer_lookup", "customer_cohort", "schedule_range", "money_summary", "work_list", "inventory_status",
      "agent_activity", "business_state", "company_context", "party_lookup", "party_context", "team_roster",
      "party_availability",
    ],
    strategy: "seeded",
    requiredFacts: ["canonical Dealer Zero projections"],
  },
];

export const DEALER_ZERO_CAPABILITY_PRECONDITIONS: readonly DealerZeroCapabilityPrecondition[] = GROUPS.flatMap((group) =>
  group.capabilities.map((capability) => ({
    capability,
    strategy: group.strategy,
    requiredFacts: group.requiredFacts,
    setupCapabilities: group.setupCapabilities ?? [],
    ...(group.unavailableOutcome ? { unavailableOutcome: group.unavailableOutcome } : {}),
  })),
);

const PRECONDITION_BY_CAPABILITY = new Map(DEALER_ZERO_CAPABILITY_PRECONDITIONS.map((row) => [row.capability, row] as const));

export function dealerZeroPreconditionFor(capability: string): DealerZeroCapabilityPrecondition {
  const row = PRECONDITION_BY_CAPABILITY.get(capability);
  if (!row) throw new Error(`Dealer Zero has no capability precondition: ${capability}`);
  return row;
}

export function validateDealerZeroCapabilityPreconditions(registry: UserCapabilityRegistry): void {
  const capabilities = registry.all().map((row) => row.capability);
  const registered = DEALER_ZERO_CAPABILITY_PRECONDITIONS.map((row) => row.capability);
  if (new Set(registered).size !== registered.length) throw new Error("Dealer Zero capability preconditions contain duplicates");
  const missing = capabilities.filter((capability) => !PRECONDITION_BY_CAPABILITY.has(capability));
  const extra = registered.filter((capability) => !capabilities.includes(capability));
  if (missing.length || extra.length) throw new Error(`Dealer Zero capability precondition drift: missing=${missing.join(",")} extra=${extra.join(",")}`);
  for (const row of DEALER_ZERO_CAPABILITY_PRECONDITIONS) {
    if (row.requiredFacts.length === 0) throw new Error(`Dealer Zero capability ${row.capability} has no usable prerequisite`);
    if (row.strategy === "journey_created" && row.setupCapabilities.length === 0) throw new Error(`Dealer Zero capability ${row.capability} has no setup journey`);
    if (row.strategy === "sandbox_or_configured_provider" && row.unavailableOutcome !== "visible_configuration_failure") {
      throw new Error(`Dealer Zero external capability ${row.capability} can fail invisibly`);
    }
  }
}
