import type { CanonicalOperationalQueryIntent } from "@finnor/shared-types";
import { dealerZeroPreconditionFor } from "./dealer-zero-preconditions";
import type { UserCapability, UserCapabilityRegistry } from "./user-capability-registry";

export const HUMAN_OPERABILITY_MATRIX_VERSION = 1 as const;

export type HumanOperabilityCategory =
  | "capability_registry"
  | "canonical_query"
  | "objective_pattern"
  | "ambiguity_reference_date"
  | "operating_surface"
  | "failure_recovery"
  | "held_out_founder";

export interface HumanCapabilityCoverageRow {
  id: string;
  category: "capability_registry";
  capability: string;
  capabilityKind: UserCapability["kind"];
  instruction: string;
  expectedRoutes: UserCapability["reachableRoutes"];
  sourceOwner: string;
  precondition: ReturnType<typeof dealerZeroPreconditionFor>;
}

export interface HumanOperabilityScenario {
  id: string;
  category: Exclude<HumanOperabilityCategory, "capability_registry">;
  instruction: string;
  entrypoint: "rail" | "palette" | "surface";
  expectedModels: Array<"QUERY" | "ATOMIC_ACTION" | "OBJECTIVE" | "CONVERSATION" | "CLARIFY">;
  expectedCapability?: string;
  heldOut?: true;
  linkedGoldenJourneyId?: string;
  surfaceJourney?: "thread_customer_money_work_schedule_thread";
}

export interface HumanOperabilityMatrix {
  version: typeof HUMAN_OPERABILITY_MATRIX_VERSION;
  generatedFrom: {
    userCapabilityRegistry: true;
    canonicalQueryCount: 13;
    objectivePatterns: true;
    ambiguityReferenceDateCases: true;
    operatingSurfaceJourneys: true;
    failureRecoveryCases: true;
  };
  capabilityCoverage: HumanCapabilityCoverageRow[];
  executableScenarios: HumanOperabilityScenario[];
}

const QUERY_UTTERANCES: Record<CanonicalOperationalQueryIntent, string> = {
  customer_lookup: "Find the customer record for John Thompson.",
  customer_cohort: "Show every customer inactive for more than 90 days.",
  schedule_range: "Show the service schedule next Friday.",
  money_summary: "How much cash have we collected?",
  work_list: "What work is open right now?",
  inventory_status: "Which inventory items are low?",
  agent_activity: "Show agent activity for today.",
  business_state: "What is the current business state?",
  company_context: "Show the complete customer history for John Thompson.",
  party_lookup: "Who is my manager?",
  party_context: "Show me the full context for our membrane supplier.",
  team_roster: "Who is on the Field Service team?",
  party_availability: "When is our dispatcher available next Friday?",
};

/** Founder-language reachability corpus. Values describe a useful business
 * outcome; capability identifiers stay out of the English itself. Exact record
 * identities are resolved against Dealer Zero or the selected JARVIS context. */
const ACTION_UTTERANCES: Record<string, string> = {
  schedule_water_test: "Schedule a water test for John Thompson at 8289 Gessner Road next Friday and use his recorded phone number.",
  renew_maintenance_agreement: "Renew John Thompson's maintenance agreement and send the confirmation to his recorded phone.",
  create_lead: "Create a new lead for Certification Prospect at +17135558888 with certification.prospect@example.invalid.",
  update_lead_status: "Move John Thompson's lead to qualified.",
  log_interaction: "Log that John Thompson called about a whole-house carbon filter.",
  assign_lead_to_technician: "Assign John Thompson's lead to the next available technician.",
  check_stock_level: "Check stock for the carbon block filter cartridge.",
  flag_reorder_needed: "Flag the sediment pre-filter cartridge as needing reorder review.",
  log_stock_used_on_visit: "Record that one sediment pre-filter cartridge was used on the selected service visit.",
  assign_technician_to_visit: "Assign the selected open service visit to the available field technician.",
  check_technician_availability: "Check which technician is available next Friday for John Thompson's address.",
  reschedule_visit: "Move the selected service visit to next Friday at 10 AM.",
  generate_quote: "Create a quote for John Thompson for one whole-house carbon filtration system at $649.",
  size_equipment_for_household: "Size a softener for a four-person home with 18 grains-per-gallon hardness.",
  send_proposal: "Send the Dealer Zero whole-house filtration proposal to its recorded customer contact.",
  create_invoice: "Create a $249 invoice for John Thompson due in 30 days.",
  send_payment_reminder: "Send a payment reminder for the overdue annual-service invoice.",
  record_payment: "Record a $249 card payment against the overdue annual-service invoice.",
  call_overdue_invoices: "Call the consented customers with overdue invoices and record each outcome.",
  summarize_ad_performance: "Summarize advertising performance for the last 30 days.",
  launch_ad_campaign: "Launch a certification campaign named Summer Water Check with a $25 daily budget.",
  create_review_request: "Ask John Thompson for a review using his consented contact channel.",
  answer_customer_question: "Answer John Thompson's question about when his next filter service is due.",
  send_customer_message: "Send John Thompson this message: Your service report is ready.",
  send_follow_up: "Send the due follow-up to John Thompson using his recorded consented channel.",
  answer_water_question: "Explain what 18 grains per gallon means for a four-person household.",
  send_proposal_to_recent_installs: "Send the maintenance proposal to eligible customers installed in the last 90 days.",
  bulk_notify_existing_customers: "Notify the selected customer cohort about the Saturday service window, excluding anyone I removed.",
  log_visit_report: "Log this report on the selected visit: system tested normally and no leak was observed.",
  flag_visit_issue: "Flag the selected visit because the inlet valve is leaking.",
  check_reminder_due: "Check whether a reverse-osmosis system last serviced on 2025-01-15 is due for maintenance.",
  generate_compliance_summary: "Generate a compliance summary for water with 18 gpg hardness and 0.8 ppm iron.",
  search_web: "Research the current Texas drinking-water guidance and cite the sources.",
  scan_competitors: "Scan water-treatment competitors serving Houston and summarize their public offers.",
  check_business_reviews: "Check the latest public reviews for Finnor Water Company.",
  get_business_overview: "Give me the current operating overview for the company.",
  answer_business_question: "Tell me whether overdue invoices or open service work need attention first, using current company data.",
  start_water_test_workflow: "Start the water-test workflow for John Thompson next Friday and use his recorded phone.",
  request_proposal_signature: "Request John Thompson's signature on the Dealer Zero whole-house filtration proposal using his recorded email.",
  start_installation_workflow: "Start installation from the accepted whole-house quote for John Thompson with one FILT-WH-CARB and a $100 deposit.",
  start_invoice_to_cash_workflow: "Start collection workflow for the overdue annual-service invoice.",
  clarification_request: "Ask me which Alex I mean before you send any message.",
  manual_step_suggestion: "Give me a safe manual step because the requested provider is unavailable; do not claim it ran.",
  route_suggestion: "Suggest the most efficient route for the selected technician next Friday.",
  send_message: "Send certification@example.invalid this exact message: Human operability certification.",
  place_call: "Call John Thompson to confirm the next service window and record the outcome.",
  request_acknowledgement: "Ask Jordan Lee to acknowledge the dispatch handoff by tomorrow at noon.",
  notify_group: "Notify the Field Service team that tomorrow's first dispatch starts at 8 AM.",
  create_task: "Create a task for Jordan Lee titled Confirm next service date, due tomorrow at 4 PM.",
  assign_task: "Assign the Dealer Zero confirm-next-service task to Jordan Lee.",
  update_task: "Move the Dealer Zero confirm-next-service task due date to next Friday at 4 PM.",
  handoff_work: "Hand this Work to Jordan Lee and preserve its current evidence.",
  delegate_objective: "Delegate this Work to the Field Service team to verify tomorrow's dispatch readiness.",
  escalate_work: "Escalate the current delegation to Avery Finn because its acknowledgement is overdue.",
  cancel_delegation: "Cancel the current delegation because the customer rescheduled.",
  schedule_internal_event: "Schedule a dispatch review with Jordan Lee tomorrow from 9 AM to 9:30 AM at Houston Headquarters.",
  reschedule_internal_event: "Move the dispatch review to next Friday from 10 AM to 10:30 AM because of the route change.",
  share_document: "Share the Dealer Zero service report with Jordan Lee.",
  computer_task: "In the configured accounting app, prepare a read-only verification of the selected invoice and stop before any write.",
};

const HELD_OUT_FOUNDER_SCENARIOS: HumanOperabilityScenario[] = [
  { id: "heldout-customer-account", category: "held_out_founder", instruction: "Pull up John Thompson’s customer account. {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "customer_lookup", heldOut: true },
  { id: "heldout-inactive-clients", category: "held_out_founder", instruction: "Which clients have been quiet for at least 120 days? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "customer_cohort", heldOut: true },
  { id: "heldout-calendar", category: "held_out_founder", instruction: "What appointments are on the calendar next Friday? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "schedule_range", heldOut: true },
  { id: "heldout-revenue", category: "held_out_founder", instruction: "How much revenue landed this month? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "money_summary", heldOut: true },
  { id: "heldout-approval-work", category: "held_out_founder", instruction: "Show anything waiting for approval. {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "work_list", heldOut: true },
  { id: "heldout-reorder-point", category: "held_out_founder", instruction: "Which cartridges are below the reorder point? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "inventory_status", heldOut: true },
  { id: "heldout-agent-work", category: "held_out_founder", instruction: "What have the AI agents done today? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "agent_activity", heldOut: true },
  { id: "heldout-operating-snapshot", category: "held_out_founder", instruction: "Give me an operating snapshot. {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "business_state", heldOut: true },
  { id: "heldout-company-context", category: "held_out_founder", instruction: "What do we know about John Thompson across the company? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "company_context", heldOut: true },
  { id: "heldout-team-language", category: "held_out_founder", instruction: "Who works in Field Service? {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "team_roster", heldOut: true },
];

const LINKED_SCENARIOS: HumanOperabilityScenario[] = [
  { id: "objective-lookup-then-act", category: "objective_pattern", instruction: "Look up the customer, verify the contact, then send the status note. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "lookup-email-objective" },
  { id: "objective-approval-continuation", category: "objective_pattern", instruction: "Prepare, approve, execute, and verify one customer message. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "approval-continuation" },
  { id: "objective-external-wait", category: "objective_pattern", instruction: "Wait for an external event before continuing. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "external-wait" },
  { id: "recovery-blocked", category: "failure_recovery", instruction: "Expose unavailable integration state without claiming success. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "provider-unavailable" },
  { id: "recovery-worker-restart", category: "failure_recovery", instruction: "Keep Work durable through a worker restart. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "worker-restart-objective" },
  { id: "recovery-realtime-fallback", category: "failure_recovery", instruction: "Reconcile Work through bounded polling when realtime fails. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "realtime-polling-fallback" },
  { id: "recovery-failed-action", category: "failure_recovery", instruction: "Recover a failed provider action from canonical evidence. {nonce}", entrypoint: "rail", expectedModels: ["OBJECTIVE"], linkedGoldenJourneyId: "failed-action-recovery" },
  { id: "ambiguity-customer", category: "ambiguity_reference_date", instruction: "Find Alex and ask which record I mean before doing anything. {nonce}", entrypoint: "rail", expectedModels: ["CLARIFY"], linkedGoldenJourneyId: "ambiguous-customer" },
  { id: "reference-unbound-consequential", category: "ambiguity_reference_date", instruction: "Send the proposal to them. Do not guess who I mean. {nonce}", entrypoint: "rail", expectedModels: ["CLARIFY"] },
  { id: "date-relative-schedule", category: "ambiguity_reference_date", instruction: "Show the schedule next Friday. {nonce}", entrypoint: "rail", expectedModels: ["QUERY"], expectedCapability: "schedule_range" },
  { id: "surface-context-roundtrip", category: "operating_surface", instruction: "How much cash have we collected? Read only; do not create, update, approve, or execute anything. {nonce}", entrypoint: "surface", expectedModels: ["QUERY"], expectedCapability: "money_summary", surfaceJourney: "thread_customer_money_work_schedule_thread" },
];

function queryScenario(row: HumanCapabilityCoverageRow): HumanOperabilityScenario {
  return {
    id: `query-${row.capability}`,
    category: "canonical_query",
    instruction: `${row.instruction} Read only; do not create, update, approve, or execute anything. {nonce}`,
    entrypoint: "rail",
    expectedModels: ["QUERY"],
    expectedCapability: row.capability,
  };
}

export function createHumanOperabilityMatrix(registry: UserCapabilityRegistry): HumanOperabilityMatrix {
  const capabilities = registry.all();
  const coverage: HumanCapabilityCoverageRow[] = capabilities.map((row) => ({
    id: row.id,
    category: "capability_registry",
    capability: row.capability,
    capabilityKind: row.kind,
    instruction: row.kind === "QUERY"
      ? QUERY_UTTERANCES[row.capability as CanonicalOperationalQueryIntent]
      : ACTION_UTTERANCES[row.capability] ?? "",
    expectedRoutes: row.reachableRoutes,
    sourceOwner: row.sourceOwner,
    precondition: dealerZeroPreconditionFor(row.capability),
  }));
  const matrix: HumanOperabilityMatrix = {
    version: HUMAN_OPERABILITY_MATRIX_VERSION,
    generatedFrom: {
      userCapabilityRegistry: true,
      canonicalQueryCount: 13,
      objectivePatterns: true,
      ambiguityReferenceDateCases: true,
      operatingSurfaceJourneys: true,
      failureRecoveryCases: true,
    },
    capabilityCoverage: coverage,
    executableScenarios: [
      ...coverage.filter((row) => row.capabilityKind === "QUERY").map(queryScenario),
      ...HELD_OUT_FOUNDER_SCENARIOS,
      ...LINKED_SCENARIOS,
    ],
  };
  validateHumanOperabilityMatrix(matrix, registry);
  return matrix;
}

export function validateHumanOperabilityMatrix(matrix: HumanOperabilityMatrix, registry: UserCapabilityRegistry): void {
  const registered = registry.all();
  if (matrix.version !== 1 || matrix.generatedFrom.canonicalQueryCount !== 13) throw new Error("Human Operability Matrix version/source contract is invalid");
  const covered = matrix.capabilityCoverage.map((row) => row.capability);
  const expected = registered.map((row) => row.capability);
  const missing = expected.filter((capability) => !covered.includes(capability));
  const extra = covered.filter((capability) => !expected.includes(capability));
  if (matrix.capabilityCoverage.length !== registered.length || new Set(covered).size !== covered.length || missing.length || extra.length) {
    throw new Error(`Human Operability capability drift: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
  const actionCapabilities = new Set(registry.actions().map((row) => row.capability));
  const utteranceKeys = Object.keys(ACTION_UTTERANCES);
  const missingActionUtterances = [...actionCapabilities].filter((capability) => !utteranceKeys.includes(capability));
  const extraActionUtterances = utteranceKeys.filter((capability) => !actionCapabilities.has(capability));
  if (missingActionUtterances.length || extraActionUtterances.length) throw new Error(`Human action utterance drift: missing=${missingActionUtterances.join(",")} extra=${extraActionUtterances.join(",")}`);
  for (const row of matrix.capabilityCoverage) {
    if (!row.instruction.trim() || row.expectedRoutes.length === 0 || row.precondition.requiredFacts.length === 0) throw new Error(`Human capability ${row.capability} has no usable English/precondition/route`);
  }
  const scenarios = matrix.executableScenarios;
  if (new Set(scenarios.map((row) => row.id)).size !== scenarios.length) throw new Error("Human Operability scenarios contain duplicate ids");
  const categories = new Set(scenarios.map((row) => row.category));
  for (const category of ["canonical_query", "objective_pattern", "ambiguity_reference_date", "operating_surface", "failure_recovery", "held_out_founder"] as const) {
    if (!categories.has(category)) throw new Error(`Human Operability Matrix has no ${category} scenario`);
  }
  const queryCapabilities = registry.queries().map((row) => row.capability);
  const executableQueries = scenarios.filter((row) => row.category === "canonical_query").map((row) => row.expectedCapability);
  if (queryCapabilities.some((capability) => !executableQueries.includes(capability))) throw new Error("Human Operability Matrix does not execute all 13 queries through JARVIS");
  if (scenarios.filter((row) => row.heldOut).length < 8) throw new Error("Human Operability Matrix requires at least eight held-out founder prompts");
  for (const row of scenarios) {
    if (!row.instruction.includes("{nonce}") || row.expectedModels.length === 0) throw new Error(`Human scenario ${row.id} is not nonce-scoped or has no expected route`);
  }
}
