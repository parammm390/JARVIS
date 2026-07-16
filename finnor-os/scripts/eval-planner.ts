// Planner eval harness (Phase 6, docs/jarvis-90-execution-blueprint.md §6). Confirmed
// by repo-wide grep before this phase: no eval harness of any kind existed. A fixed
// scenario set drives the REAL LLMPlanner.plan() (no mocking) against the real seeded
// tenant (packages/db/seed.ts's SEED_TENANT_ID — the same "Petersons"/"Marcus Webb"
// households the planner's own system prompt example already refers to), scoring
// action_type match + required-field presence. A dev-time tool, run by hand
// (`npx tsx scripts/eval-planner.ts`) — not a CI gate, since there is no established
// baseline pass rate yet to gate on. The first run against a real LLM establishes that
// baseline honestly rather than assuming one.

import { migrate } from "../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../packages/db/seed";
import { closePool } from "@finnor/db";
import { LLMPlanner, createDefaultPluginRegistry } from "@finnor/orchestration";
import type { MemorySnapshot, TenantContext, DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

interface Scenario {
  name: string;
  instruction: string;
  expectedActionType: string | null; // null = expect an EMPTY actions array
  requiredFields?: string[]; // payload keys that must be present and non-empty
  /** For the memory-reference scenarios: a prior turn to seed shortTerm memory with,
   *  simulating what appendShortTerm() would have already written from an earlier turn
   *  in the same call. */
  priorTurn?: { instruction: string; actionType: string; payload: Record<string, unknown> };
}

const emptyMemory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });

const SCENARIOS: Scenario[] = [
  // --- crm ---
  { name: "crm: create_lead", instruction: "New lead, name is Dave Simmons, phone 319-555-0900, wants a water test.", expectedActionType: "create_lead", requiredFields: ["name"] },
  { name: "crm: update_lead_status", instruction: "Mark Marcus Webb's lead as qualified.", expectedActionType: "update_lead_status" },
  { name: "crm: log_interaction", instruction: "Log that I talked to the Petersons on the phone today about their upcoming installation.", expectedActionType: "log_interaction" },
  { name: "crm: assign_lead_to_technician", instruction: "Assign the Okafors' lead to a technician for a site visit.", expectedActionType: "assign_lead_to_technician" },
  // --- inventory ---
  { name: "inventory: check_stock_level", instruction: "How many RO membranes do we have in stock?", expectedActionType: "check_stock_level" },
  { name: "inventory: flag_reorder_needed", instruction: "Flag sediment filters for reorder, we're running low.", expectedActionType: "flag_reorder_needed" },
  { name: "inventory: log_stock_used_on_visit", instruction: "Log that we used two carbon filters on today's install visit.", expectedActionType: "log_stock_used_on_visit" },
  // --- scheduling ---
  { name: "scheduling: check_technician_availability", instruction: "Is a technician available tomorrow afternoon for a water test?", expectedActionType: "check_technician_availability" },
  { name: "scheduling: reschedule_visit", instruction: "Reschedule Linda Chen's visit to next Friday at 10am.", expectedActionType: "reschedule_visit" },
  { name: "scheduling: assign_technician_to_visit", instruction: "Assign a technician to Angela Ruiz's scheduled visit.", expectedActionType: "assign_technician_to_visit" },
  // --- quotation ---
  { name: "quotation: generate_quote", instruction: "Generate a quote for the Whitfields' water treatment system.", expectedActionType: "generate_quote" },
  { name: "quotation: size_equipment_for_household", instruction: "What size water softener does Marcus Webb's household need?", expectedActionType: "size_equipment_for_household" },
  { name: "quotation: send_proposal", instruction: "Send the proposal to the Petersons for their quote.", expectedActionType: "send_proposal" },
  // --- accounting ---
  { name: "accounting: create_invoice", instruction: "Create a $450 invoice for the Hendersons for their annual service.", expectedActionType: "create_invoice", requiredFields: ["amountUsd"] },
  { name: "accounting: send_payment_reminder", instruction: "Send a payment reminder for Ruth Alvarez's overdue invoice.", expectedActionType: "send_payment_reminder" },
  { name: "accounting: record_payment", instruction: "Mark the Okafors' invoice as paid.", expectedActionType: "record_payment" },
  { name: "accounting: call_overdue_invoices", instruction: "Call every customer with an overdue invoice.", expectedActionType: "call_overdue_invoices" },
  // --- marketing ---
  { name: "marketing: summarize_ad_performance", instruction: "How is our current Facebook ad campaign performing?", expectedActionType: "summarize_ad_performance" },
  { name: "marketing: launch_ad_campaign", instruction: "Launch a new Google ad campaign targeting Cedar Falls homeowners, budget $500.", expectedActionType: "launch_ad_campaign" },
  { name: "marketing: create_review_request", instruction: "Send a review request to Angela Ruiz after her recent install.", expectedActionType: "create_review_request" },
  // --- customer-comm ---
  { name: "customer-comm: send_customer_message", instruction: "Text Linda Chen to confirm her appointment time.", expectedActionType: "send_customer_message" },
  { name: "customer-comm: send_follow_up", instruction: "Send a follow-up message to the Whitfields checking how their new system is working.", expectedActionType: "send_follow_up" },
  // --- water-domain-knowledge / water-test / maintenance-agreement / service-reminders / compliance / web-research / bulk-notify / proposal-batch / ops-overview ---
  { name: "water-domain-knowledge: answer_water_question", instruction: "What's a safe iron level for well water before treatment is needed?", expectedActionType: "answer_water_question" },
  { name: "water-test: schedule_water_test", instruction: "Schedule a free water test for the Petersons next Tuesday.", expectedActionType: "schedule_water_test" },
  { name: "maintenance-agreement: renew_maintenance_agreement", instruction: "Send a renewal offer to the Hendersons for their annual maintenance plan.", expectedActionType: "renew_maintenance_agreement" },
  { name: "service-reminders: check_reminder_due", instruction: "Is anyone due for a filter replacement reminder this month?", expectedActionType: "check_reminder_due" },
  { name: "compliance-documentation: generate_compliance_summary", instruction: "Generate a compliance summary report for this quarter.", expectedActionType: "generate_compliance_summary" },
  { name: "web-research: search_web", instruction: "Search the web for the latest EPA lead-in-water guidelines.", expectedActionType: "search_web" },
  { name: "web-research: scan_competitors", instruction: "Scan our local competitors' pricing for water softeners.", expectedActionType: "scan_competitors" },
  { name: "web-research: check_business_reviews", instruction: "Check our latest Google reviews.", expectedActionType: "check_business_reviews" },
  { name: "bulk-notify: bulk_notify_existing_customers", instruction: "Send a spring promotion offer to all existing customers who've consented to marketing.", expectedActionType: "bulk_notify_existing_customers" },
  { name: "proposal-batch: send_proposal_to_recent_installs", instruction: "Send a follow-up proposal to everyone who had an install in the last 30 days.", expectedActionType: "send_proposal_to_recent_installs" },
  { name: "ops-overview: get_business_overview", instruction: "Give me a full overview of the business right now.", expectedActionType: "get_business_overview" },
  { name: "technician-reports: log_visit_report", instruction: "Log a visit report for today's install at the Petersons' house.", expectedActionType: "log_visit_report" },
  { name: "technician-reports: flag_visit_issue", instruction: "Flag an issue from today's visit — the customer's water pressure looked low.", expectedActionType: "flag_visit_issue" },
  // --- vertical workflows (Phase 4/5) ---
  { name: "workflow: start_water_test_workflow", instruction: "Book and confirm a water test appointment for Marcus Webb this Thursday.", expectedActionType: "start_water_test_workflow" },
  { name: "workflow: start_invoice_to_cash_workflow", instruction: "Get the Hendersons' invoice paid — send them a payment link.", expectedActionType: "start_invoice_to_cash_workflow" },
  // --- answer_business_question fallback (per planner's own system prompt rule) ---
  { name: "fallback: revenue question routes to answer_business_question", instruction: "What was our total revenue last month?", expectedActionType: "answer_business_question" },
  // --- chit-chat / out of scope: expect an EMPTY actions array ---
  { name: "chit-chat: no action", instruction: "Ha, that's a funny customer story, thanks for sharing.", expectedActionType: null },
  // --- memory-reference cases (the system prompt's own documented capability) ---
  {
    name: "memory: 'call them' resolves the household from the prior turn",
    instruction: "Actually, call them instead to confirm.",
    expectedActionType: "send_customer_message",
    requiredFields: ["contactId"],
    priorTurn: {
      instruction: "Text Linda Chen to confirm her appointment time.",
      actionType: "send_customer_message",
      payload: { contactId: "linda-chen-household-id", channel: "sms", message: "Confirming your appointment." },
    },
  },
  {
    name: "memory: awaitingApproval trap — no id invented for a still-pending draft",
    instruction: "Remind him about that invoice.",
    expectedActionType: "answer_business_question",
    priorTurn: { instruction: "Create a $200 invoice for Marcus Webb.", actionType: "create_invoice", payload: { amountUsd: 200 } },
  },
];

interface ScenarioResult {
  scenario: string;
  status: "pass" | "fail" | "error";
  detail: string;
}

async function runScenario(planner: LLMPlanner, ctx: TenantContext, scenario: Scenario): Promise<ScenarioResult> {
  const memory = emptyMemory();
  if (scenario.priorTurn) {
    memory.shortTerm = {
      turns: [
        {
          instruction: scenario.priorTurn.instruction,
          actionType: scenario.priorTurn.actionType,
          payload: scenario.priorTurn.payload,
          awaitingApproval: true,
        },
      ],
    };
  }

  let actions: DomainAction[];
  try {
    actions = await planner.plan(scenario.instruction, ctx, memory);
  } catch (err) {
    return { scenario: scenario.name, status: "error", detail: (err as Error).message };
  }

  if (scenario.expectedActionType === null) {
    return actions.length === 0
      ? { scenario: scenario.name, status: "pass", detail: "correctly returned no actions" }
      : { scenario: scenario.name, status: "fail", detail: `expected no actions, got: ${actions.map((a) => a.actionType).join(", ")}` };
  }

  const match = actions.find((a) => a.actionType === scenario.expectedActionType);
  if (!match) {
    return {
      scenario: scenario.name,
      status: "fail",
      detail: actions.length === 0 ? "planner returned no actions at all" : `expected "${scenario.expectedActionType}", got: ${actions.map((a) => a.actionType).join(", ")}`,
    };
  }

  const missing = (scenario.requiredFields ?? []).filter((f) => match.payload[f] === undefined || match.payload[f] === null || match.payload[f] === "");
  if (missing.length > 0) {
    return { scenario: scenario.name, status: "fail", detail: `action_type matched but missing required field(s): ${missing.join(", ")}` };
  }

  return { scenario: scenario.name, status: "pass", detail: `matched "${match.actionType}"` };
}

async function main(): Promise<void> {
  process.env.DATABASE_URL = DB_URL;
  await migrate(DB_URL);
  await seed(DB_URL);

  const registry = createDefaultPluginRegistry();
  const planner = new LLMPlanner(registry);
  const ctx: TenantContext = { tenantId: SEED_TENANT_ID, userId: "eval-harness", role: "owner" };

  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    const result = await runScenario(planner, ctx, scenario);
    results.push(result);
    console.log(`${result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "!"} ${result.scenario} — ${result.detail}`);
    // Real free/dev-tier LLM API keys (e.g. Groq's default tier) hit a tokens-per-minute
    // ceiling well before 40 sequential planner calls finish — this paces the harness
    // to stay under that, rather than reporting a wall of rate-limit errors as if the
    // planner itself were failing. On a higher-tier key this is just unused headroom.
    await new Promise((r) => setTimeout(r, 4_000));
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed, ${errored} errored (LLM call failures — check credentials, not scored as fail).`);

  await closePool();
  process.exit(failed > 0 || errored === results.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
