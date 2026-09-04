export const PE0_BASELINE_SHA = "f40526617c7e22258c12a2b669975ddaaf33e7fc";

export const DISPOSITIONS = [
  "CORE_KEEP",
  "CORE_EXTRACT",
  "PE_REUSE",
  "PE_REPLACE",
  "WATER_RETIRE",
  "HISTORY_ONLY",
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

export interface DispositionDecision {
  disposition: Disposition;
  rule: string;
  rationale: string;
  reusableMechanism: string | null;
  peResponsibility: string | null;
  deletionBlockers: string[];
  extractionBlockers: string[];
  replacementPrerequisites: string[];
  migrationRisk: "low" | "medium" | "high" | "critical";
  securityRisk: "low" | "medium" | "high" | "critical";
  releaseRisk: "low" | "medium" | "high" | "critical";
  confidence: "high" | "medium";
}

const decision = (
  disposition: Disposition,
  rule: string,
  rationale: string,
  options: Partial<Omit<DispositionDecision, "disposition" | "rule" | "rationale">> = {},
): DispositionDecision => ({
  disposition,
  rule,
  rationale,
  reusableMechanism: null,
  peResponsibility: null,
  deletionBlockers: [],
  extractionBlockers: [],
  replacementPrerequisites: [],
  migrationRisk: "low",
  securityRisk: "low",
  releaseRisk: "low",
  confidence: "high",
  ...options,
});

export const ACTION_DISPOSITIONS: Record<string, DispositionDecision> = {
  answer_business_question: decision("PE_REUSE", "action.business_question", "The read-only grounded-answer responsibility remains valid for PE, while its current business-state inputs must be supplied by the PE pack.", { reusableMechanism: "Grounded answer envelope and evidence citations", peResponsibility: "Answer questions over PE-owned business truth", replacementPrerequisites: ["PE read-model inputs"], migrationRisk: "medium" }),
  answer_customer_question: decision("PE_REPLACE", "action.customer_question", "The action resolves Water customer/household context; PE requires target-company and deal-party questions with a different ontology.", { peResponsibility: "Target-company and deal-party question answering", replacementPrerequisites: ["PE Deal/TargetCompany/DealParty truth and queries"], migrationRisk: "high" }),
  answer_water_question: decision("WATER_RETIRE", "action.water_knowledge", "The action is explicitly backed by Water treatment domain knowledge and has no PE business responsibility.", { deletionBlockers: ["Planner catalog and action-count release gates"], releaseRisk: "medium" }),
  assign_lead_to_technician: decision("WATER_RETIRE", "action.water_assignment", "The handler resolves a Water lead/household and creates a technician service visit; employee Work handoff already owns the neutral assignment responsibility.", { deletionBlockers: ["CRM plugin registry, Water policies and fixtures"], migrationRisk: "medium" }),
  assign_task: decision("PE_REUSE", "action.universal_task", "The action assigns a canonical task through employee/authority references without requiring Water business meaning.", { reusableMechanism: "Governed task assignment", peResponsibility: "Assign PE work tasks" }),
  assign_technician_to_visit: decision("WATER_RETIRE", "action.technician_visit", "The action writes service_visits.technician_id and is specific to field-service dispatch.", { deletionBlockers: ["Scheduling plugin, technician authority scopes and service-visit schema"], migrationRisk: "high" }),
  bulk_notify_existing_customers: decision("CORE_EXTRACT", "action.customer_batch", "The action freezes a household cohort into durable business-operation targets; the batching, consent recheck, retry and receipt machinery is reusable but the cohort and target model are Water-specific.", { reusableMechanism: "Durable bounded fan-out, per-target idempotency, safety recheck and receipts", extractionBlockers: ["business-operation worker hard-codes households and marketing consent", "Party/target contract has no VerticalPack owner"], migrationRisk: "critical", releaseRisk: "high" }),
  call_overdue_invoices: decision("WATER_RETIRE", "action.water_receivables_call", "The action calls household customers selected from the Water invoice ledger; PE does not require this operating-company collection workflow.", { deletionBlockers: ["Accounting plugin, Vapi delivery wrapper and invoice policies"], migrationRisk: "medium" }),
  cancel_delegation: decision("CORE_KEEP", "action.delegation", "Delegation cancellation is a vertical-neutral Work/authority operation over canonical delegation records.", { reusableMechanism: "Governed delegation lifecycle" }),
  check_business_reviews: decision("WATER_RETIRE", "action.local_business_reviews", "The action researches local-business review presence, a Water/home-service acquisition channel rather than a PE backend responsibility.", { deletionBlockers: ["Web-research planner examples and tests"] }),
  check_reminder_due: decision("WATER_RETIRE", "action.service_reminder", "The action reads maintenance agreements and service cadence to decide a Water service reminder.", { deletionBlockers: ["Service-reminder scans and policies"] }),
  check_stock_level: decision("WATER_RETIRE", "action.inventory", "The action reads Water installer inventory and reorder thresholds; PE has no equivalent stock responsibility.", { deletionBlockers: ["Inventory query/scan and canonical inventory entities"] }),
  check_technician_availability: decision("WATER_RETIRE", "action.technician_availability", "The action combines technician capacity, service visits and dispatch profiles.", { deletionBlockers: ["Scheduling plugin, party_availability compatibility and technician tables"], migrationRisk: "high" }),
  clarification_request: decision("CORE_KEEP", "action.clarification", "The action records a nonconsequential clarification needed by any vertical and has no Water data dependency.", { reusableMechanism: "Durable clarification request" }),
  computer_task: decision("CORE_KEEP", "action.computer", "The governed computer action compiles read/write effects, authority and evidence without Water ontology.", { reusableMechanism: "Governed browser/computer execution", securityRisk: "high", releaseRisk: "high" }),
  create_invoice: decision("PE_REPLACE", "action.invoice", "The action creates a household-linked operating-company invoice. PE financial truth requires native deal/fund models, not a renamed Water invoice.", { peResponsibility: "PE-native financial obligation or transaction-cost truth if required", replacementPrerequisites: ["PE financial ontology and provider ownership policy"], migrationRisk: "high" }),
  create_lead: decision("PE_REPLACE", "action.lead", "The action creates Water customer/household lead truth. PE sourcing requires a PE-native Deal/TargetCompany intake model.", { peResponsibility: "PE deal sourcing intake", replacementPrerequisites: ["Deal and TargetCompany schema, source mapping and policy"], migrationRisk: "critical" }),
  create_review_request: decision("WATER_RETIRE", "action.review_request", "The action asks a completed Water customer for a public review; this responsibility does not belong to the PE backend.", { deletionBlockers: ["Marketing plugin and communication policy"] }),
  create_task: decision("PE_REUSE", "action.universal_task", "The canonical task responsibility and Work attachment are valid for PE without false business mapping.", { reusableMechanism: "Governed task creation", peResponsibility: "Create PE work tasks" }),
  delegate_objective: decision("CORE_KEEP", "action.delegation", "Objective delegation is part of the durable Work/authority kernel and uses neutral employee/team references.", { reusableMechanism: "Governed objective delegation", migrationRisk: "medium", securityRisk: "high" }),
  escalate_work: decision("CORE_KEEP", "action.work_escalation", "Work escalation is a neutral Work/authority operation.", { reusableMechanism: "Durable Work escalation", securityRisk: "high" }),
  flag_reorder_needed: decision("WATER_RETIRE", "action.inventory", "The action writes reorder findings for Water stock SKUs.", { deletionBlockers: ["Inventory scans, policies and findings"] }),
  flag_visit_issue: decision("WATER_RETIRE", "action.service_visit", "The action records a field-service visit issue against technician/household truth.", { deletionBlockers: ["Technician report plugin and service-visit schema"] }),
  generate_compliance_summary: decision("PE_REPLACE", "action.water_compliance", "The current document summarizes Water customer/equipment compliance; PE needs diligence/regulatory findings over PE-native entities.", { reusableMechanism: "Document rendering remains separately PE_REUSE", peResponsibility: "PE diligence/compliance deliverable", replacementPrerequisites: ["Finding/Deliverable truth and PE evidence policy"], migrationRisk: "high" }),
  generate_quote: decision("PE_REPLACE", "action.quote", "The action prices Water equipment from price-book rows and creates a household quote. A PE offer/LOI is not semantically a quote.", { peResponsibility: "PE-native offer/LOI responsibility if introduced", replacementPrerequisites: ["PE-native Deal terms and approval model"], migrationRisk: "critical" }),
  get_business_overview: decision("PE_REPLACE", "action.water_overview", "The overview is assembled from Water revenue, customers, appointments, inventory and service projections.", { peResponsibility: "PE portfolio/deal operating overview", replacementPrerequisites: ["PE read models and KPI definitions"], migrationRisk: "high" }),
  handoff_work: decision("CORE_KEEP", "action.work_handoff", "The action transfers canonical Work ownership between active employees under authority checks.", { reusableMechanism: "Durable Work ownership handoff", securityRisk: "high" }),
  launch_ad_campaign: decision("WATER_RETIRE", "action.local_marketing", "The action launches local lead-generation advertising with external spend; it is not a PE deal-execution responsibility.", { deletionBlockers: ["Marketing provider binding, spend policy and certification"], securityRisk: "high", releaseRisk: "medium" }),
  log_interaction: decision("PE_REUSE", "action.interaction", "Recording an evidence-backed external-party interaction is valid in PE; only the current customer/household resolver needs adaptation.", { reusableMechanism: "Interaction persistence and provenance", peResponsibility: "Deal-party interaction log", replacementPrerequisites: ["PE party resolver"], migrationRisk: "medium" }),
  log_stock_used_on_visit: decision("WATER_RETIRE", "action.field_inventory", "The action decrements installer stock from a service visit.", { deletionBlockers: ["Inventory and service-visit canonical writers"] }),
  log_visit_report: decision("WATER_RETIRE", "action.service_visit", "The action records technician field-service completion/report truth.", { deletionBlockers: ["Technician report plugin and service-visit workflow"] }),
  manual_step_suggestion: decision("CORE_KEEP", "action.manual_step", "A non-executing manual-step suggestion is vertical-neutral objective machinery.", { reusableMechanism: "Human-required objective step" }),
  notify_group: decision("PE_REUSE", "action.communication", "The action resolves a team PartyRef and uses governed communication delivery; this is directly useful for PE teams.", { reusableMechanism: "Bounded group notification", peResponsibility: "Notify deal teams", securityRisk: "medium" }),
  place_call: decision("PE_REUSE", "action.communication", "The governed outbound-call action is valid for PE external parties once PE PartyRefs are loaded.", { reusableMechanism: "Voice delivery, consent/policy and receipt", peResponsibility: "Call deal parties", replacementPrerequisites: ["PE PartyRef contribution"], securityRisk: "high" }),
  record_payment: decision("PE_REPLACE", "action.payment", "The action mutates a household invoice/payment ledger. PE cash flows and transaction expenses require a PE-native financial model.", { peResponsibility: "PE-native cash-flow/transaction payment truth if required", replacementPrerequisites: ["PE financial ontology and reconciliation"], migrationRisk: "critical" }),
  renew_maintenance_agreement: decision("WATER_RETIRE", "action.maintenance", "The workflow renews household equipment maintenance agreements.", { deletionBlockers: ["Maintenance schedule, document and signature wrapper"] }),
  request_acknowledgement: decision("PE_REUSE", "action.acknowledgement", "A governed acknowledgement request is directly useful for deal-team and external-party coordination.", { reusableMechanism: "Acknowledgement lifecycle and evidence", peResponsibility: "PE request acknowledgement" }),
  request_proposal_signature: decision("PE_REPLACE", "action.proposal_signature", "The wrapper signs a Water proposal linked to a quote/household; PE signatures need Deal/Deliverable-native ownership. The DocuSign transport is separately PE_REUSE.", { reusableMechanism: "DocuSign execution/read-back is retained separately", peResponsibility: "Sign PE-native deliverables", replacementPrerequisites: ["PE Deliverable/DealParty signature contract"], migrationRisk: "high" }),
  reschedule_internal_event: decision("PE_REUSE", "action.internal_event", "Internal event rescheduling is vertical-neutral company coordination.", { reusableMechanism: "Governed internal calendar event", peResponsibility: "Reschedule deal-team events" }),
  reschedule_visit: decision("WATER_RETIRE", "action.service_schedule", "The action changes a technician service visit and sends customer communication.", { deletionBlockers: ["Scheduling plugin, appointment observation and customer messaging"], migrationRisk: "high" }),
  route_suggestion: decision("WATER_RETIRE", "action.field_route", "The action optimizes daily technician service routes over customer addresses.", { deletionBlockers: ["Dispatch profiles, maps provider and scheduled route scan"] }),
  scan_competitors: decision("PE_REUSE", "action.research", "Source-backed competitor research is directly applicable to PE diligence without Water semantics in the acquisition engine.", { reusableMechanism: "Evidence-backed web acquisition", peResponsibility: "Market and competitor diligence" }),
  schedule_internal_event: decision("PE_REUSE", "action.internal_event", "Internal event scheduling is vertical-neutral company coordination.", { reusableMechanism: "Governed internal calendar event", peResponsibility: "Schedule deal-team events" }),
  schedule_water_test: decision("WATER_RETIRE", "action.water_test", "The action books and confirms a household Water test.", { deletionBlockers: ["Water-test plugin, GHL appointment mapping and workflow fixtures"], migrationRisk: "high" }),
  search_web: decision("PE_REUSE", "action.research", "Evidence-backed web research is directly required for PE market and target diligence.", { reusableMechanism: "Exa/Firecrawl research and evidence ingestion", peResponsibility: "PE research" }),
  send_customer_message: decision("WATER_RETIRE", "action.customer_message", "The wrapper resolves a Water customer/household. Universal send_message retains the reusable delivery responsibility.", { reusableMechanism: "Delivery is retained through universal send_message", deletionBlockers: ["Customer communication plugin and Water policy"] }),
  send_follow_up: decision("WATER_RETIRE", "action.customer_followup", "The action is a Water customer follow-up wrapper; universal messaging owns the reusable mechanism.", { reusableMechanism: "Universal messaging remains PE_REUSE", deletionBlockers: ["Customer communication plugin and Water policy"] }),
  send_message: decision("PE_REUSE", "action.communication", "The universal PartyRef-based message action, governed delivery and receipts are directly useful for PE.", { reusableMechanism: "Multi-channel governed message delivery", peResponsibility: "Deal-team and deal-party messaging", replacementPrerequisites: ["PE PartyRef contribution"], securityRisk: "high" }),
  send_payment_reminder: decision("WATER_RETIRE", "action.water_receivables", "The action contacts a household about an operating-company invoice.", { reusableMechanism: "Message transport is retained separately", deletionBlockers: ["Invoice/customer policy and accounting plugin"] }),
  send_proposal: decision("PE_REPLACE", "action.proposal_delivery", "The action delivers a Water proposal/quote. PE needs a Deal/Deliverable-native delivery action; document/message transports remain reusable.", { reusableMechanism: "Document and communication delivery adapters", peResponsibility: "Deliver PE-native documents", replacementPrerequisites: ["PE Deliverable and DealParty contracts"], migrationRisk: "high" }),
  send_proposal_to_recent_installs: decision("WATER_RETIRE", "action.install_batch", "The action targets recently installed Water households for a proposal campaign.", { reusableMechanism: "Durable fan-out must be extracted from the separate business-operation seam", deletionBlockers: ["Proposal batch plugin and household cohort"] }),
  share_document: decision("PE_REUSE", "action.document_share", "Governed document sharing with PartyRefs, receipts and delivery evidence is directly applicable to PE.", { reusableMechanism: "Document share lifecycle", peResponsibility: "Share PE deliverables", securityRisk: "high" }),
  size_equipment_for_household: decision("WATER_RETIRE", "action.equipment_sizing", "The action sizes Water equipment for household facts and price-book entries.", { deletionBlockers: ["Quotation plugin, household/equipment schema and Water knowledge"] }),
  start_installation_workflow: decision("WATER_RETIRE", "action.installation_workflow", "The workflow converts a signed Water proposal into installer scheduling, stock and work-order effects.", { reusableMechanism: "Workflow engine remains CORE_KEEP; this workflow definition retires", deletionBlockers: ["Workflow step registry and proposal/work-order/inventory tables"], migrationRisk: "critical" }),
  start_invoice_to_cash_workflow: decision("WATER_RETIRE", "action.invoice_cash_workflow", "The workflow sends household payment links and reconciles the Water invoice ledger.", { reusableMechanism: "Workflow and provider idempotency remain reusable", deletionBlockers: ["Invoice/payment canonical truth and workflow step registry"], migrationRisk: "high" }),
  start_water_test_workflow: decision("WATER_RETIRE", "action.water_test_workflow", "The workflow creates a Water-test appointment and confirmation call.", { reusableMechanism: "Workflow engine remains CORE_KEEP", deletionBlockers: ["Planner continuation fallback, workflow definitions and GHL/Vapi bindings"], migrationRisk: "critical" }),
  summarize_ad_performance: decision("WATER_RETIRE", "action.local_marketing", "The action summarizes local-business advertising performance, not a PE backend responsibility.", { deletionBlockers: ["Marketing plugin and provider tool registry"] }),
  update_lead_status: decision("PE_REPLACE", "action.lead", "The action advances the Water lead pipeline; PE requires Deal-native stages and admissibility.", { peResponsibility: "Advance a PE Deal sourcing stage", replacementPrerequisites: ["Deal state machine and PE authority policy"], migrationRisk: "critical" }),
  update_task: decision("PE_REUSE", "action.universal_task", "Canonical task updates and Work linkage are valid for PE.", { reusableMechanism: "Governed task lifecycle", peResponsibility: "Update PE work tasks" }),
};

export const QUERY_DISPOSITIONS: Record<string, DispositionDecision> = {
  customer_lookup: decision("PE_REPLACE", "query.customer", "The resolver joins Water households, contacts and service history; PE requires TargetCompany/DealParty-native lookup.", { peResponsibility: "Target-company and deal-party lookup", replacementPrerequisites: ["PE entity registry and read model"], migrationRisk: "critical" }),
  customer_cohort: decision("PE_REPLACE", "query.customer_cohort", "The cohort is defined by Water household inactivity/service/contact semantics, not a PE deal cohort.", { peResponsibility: "PE-native deal/portfolio cohorts", replacementPrerequisites: ["PE cohort definitions and source truth"], migrationRisk: "high" }),
  schedule_range: decision("PE_REPLACE", "query.water_schedule", "The query combines appointments, service visits and technicians; PE meeting/workstream calendars require a native resolver.", { reusableMechanism: "Bounded timezone-aware range pagination", peResponsibility: "PE meeting and milestone calendar", replacementPrerequisites: ["PE event/workstream read model"], migrationRisk: "high" }),
  money_summary: decision("PE_REPLACE", "query.water_money", "The result summarizes household invoices/payments; PE financial analysis has different sources, units and ownership.", { reusableMechanism: "Bounded canonical query envelope", peResponsibility: "PE-native financial summary", replacementPrerequisites: ["PE financial truth and KPI definitions"], migrationRisk: "critical" }),
  work_list: decision("CORE_EXTRACT", "query.mixed_work", "The query correctly reads durable Work/tasks but also exposes Water work_orders and open-state semantics.", { reusableMechanism: "Work/task pagination and durable query receipt", extractionBlockers: ["work_orders section is hard-coded in query contract and resolver"], migrationRisk: "high" }),
  inventory_status: decision("WATER_RETIRE", "query.inventory", "The query reads Water installer stock, warehouse and procurement truth.", { deletionBlockers: ["Inventory scans/actions and read-model projections"] }),
  agent_activity: decision("CORE_KEEP", "query.activity", "The query reads bounded execution/audit activity rather than a Water business entity.", { reusableMechanism: "Tenant-scoped agent activity projection" }),
  business_state: decision("PE_REPLACE", "query.water_business_state", "The projection aggregates Water customers, appointments, invoices, inventory and service operations.", { peResponsibility: "PE-native deal/portfolio state", replacementPrerequisites: ["PE KPI/read-model contract"], migrationRisk: "critical" }),
  company_context: decision("CORE_EXTRACT", "query.company_context", "The graph traversal mechanism is reusable, but its canonical entity union and relationship edges include household/technician/Water tables.", { reusableMechanism: "Bounded canonical graph traversal", extractionBlockers: ["CANONICAL_ENTITY_TYPES and relationship SQL are monolithic"], migrationRisk: "critical" }),
  party_lookup: decision("CORE_EXTRACT", "query.party", "The deterministic resolver is reusable, but PartyRef includes Water household/contact types and Water relationship fallbacks.", { reusableMechanism: "Tenant-scoped deterministic party resolution", extractionBlockers: ["PARTY_TYPES and resolver SQL need VerticalPack contributions"], migrationRisk: "critical", securityRisk: "high" }),
  party_context: decision("CORE_EXTRACT", "query.party", "Party context traversal is reusable but currently admits Water household/contact edges through the monolithic PartyRef registry.", { reusableMechanism: "Bounded party context", extractionBlockers: ["PARTY_TYPES and graph edge ownership"], migrationRisk: "high", securityRisk: "high" }),
  team_roster: decision("CORE_KEEP", "query.team", "The query resolves org-unit membership and active employees without requiring Water entities.", { reusableMechanism: "Employee/team roster" }),
  party_availability: decision("CORE_EXTRACT", "query.availability", "The resolver combines neutral internal events with technician capacity, service visits and appointments.", { reusableMechanism: "Timezone-aware availability calculation", extractionBlockers: ["Technician/appointment readers are embedded beside neutral internal-event readers"], migrationRisk: "high" }),
};

export const JOB_DISPOSITIONS: Record<string, DispositionDecision> = {
  send_message: decision("PE_REUSE", "job.delivery", "The job executes governed outbound communication and retains provider outcome evidence.", { reusableMechanism: "Asynchronous message delivery" }),
  scheduled_reminder: decision("WATER_RETIRE", "job.maintenance_reminder", "The scheduled handler scans maintenance agreements and households."),
  reconciliation: decision("CORE_KEEP", "job.reconciliation", "The handler reconciles provider operation state and integration health independently of business ontology.", { reusableMechanism: "Unknown-outcome reconciliation", securityRisk: "high" }),
  process_instruction: decision("CORE_KEEP", "job.instruction", "The handler resumes the canonical instruction/Work intake path.", { reusableMechanism: "Durable instruction processing" }),
  voice_confirm_request: decision("PE_REUSE", "job.voice", "The job delivers an approval confirmation request through the reusable voice channel.", { reusableMechanism: "Voice approval request" }),
  voice_notify_failure: decision("PE_REUSE", "job.voice", "The job delivers a governed failure notification through the reusable voice channel.", { reusableMechanism: "Voice failure notification" }),
  scan_cold_leads: decision("WATER_RETIRE", "job.lead_scan", "The scan selects stale Water leads and drafts Water follow-up findings."),
  scan_low_inventory: decision("WATER_RETIRE", "job.inventory_scan", "The scan reads installer inventory thresholds and drafts reorder findings."),
  scan_service_due: decision("WATER_RETIRE", "job.service_scan", "The scan reads household equipment and service-visit cadence."),
  scan_data_quality: decision("CORE_EXTRACT", "job.mixed_data_quality", "The finding lifecycle is reusable, but the current rule set directly queries households, leads, work orders, technicians, equipment and appointments.", { reusableMechanism: "Idempotent data-quality finding lifecycle", extractionBlockers: ["Rule selectors are embedded in one handler instead of a VerticalPack"], migrationRisk: "high" }),
  run_workflow_step: decision("CORE_EXTRACT", "job.mixed_workflow_steps", "The lease/idempotency/evidence executor is Core, while STEP_HANDLERS embeds Water appointment, stock, invoice, proposal and contact capability mappings.", { reusableMechanism: "Durable step claim, provider idempotency, observation and compensation", extractionBlockers: ["STEP_HANDLERS and internal handlers need pack registration"], migrationRisk: "critical", securityRisk: "high", releaseRisk: "high" }),
  relay_outbox_events: decision("CORE_KEEP", "job.outbox", "The handler dispatches durable outbox events with idempotency and no Water selector.", { reusableMechanism: "Transactional outbox delivery" }),
  scan_appointment_no_shows: decision("WATER_RETIRE", "job.appointment_scan", "The scan mutates missed Water appointments after a grace period."),
  owner_digest: decision("CORE_EXTRACT", "job.owner_digest", "Digest delivery is reusable, but its summary and recipient assumptions aggregate Water scans, cash and visit forecasts and the legacy owner role.", { reusableMechanism: "Bounded human digest delivery", extractionBlockers: ["Digest content and recipient policy need pack ownership"], migrationRisk: "high" }),
  quickbooks_sync: decision("PE_REPLACE", "job.quickbooks_water_sync", "The job syncs household-linked Water invoices through QuickBooks; the transport is retained separately.", { reusableMechanism: "QuickBooks transport and idempotent provider operation", peResponsibility: "PE-native accounting ingestion if selected", replacementPrerequisites: ["PE financial mappings and ownership policy"], migrationRisk: "high" }),
  critic_review: decision("CORE_KEEP", "job.critic", "The critic reviews planner actions against the durable instruction without a Water data selector.", { reusableMechanism: "Post-plan semantic review" }),
  learning_digest: decision("CORE_EXTRACT", "job.learning", "The statistics/finding mechanism is generic, but action-type observations currently aggregate the monolithic Water action catalog.", { reusableMechanism: "Action outcome learning digest", extractionBlockers: ["Action catalog ownership must be pack-aware"] }),
  scan_approval_expiry: decision("CORE_KEEP", "job.approval", "The handler expires governed approvals by policy timeout and resumes Work safely.", { reusableMechanism: "Approval timeout lifecycle", securityRisk: "high" }),
  simulator_tick: decision("CORE_EXTRACT", "job.dealer_zero", "The deterministic simulator mechanism is valuable, but the tick reads Water households, agreements, technicians and invoices.", { reusableMechanism: "Deterministic time-compressed reference-world tick", extractionBlockers: ["Simulator plan/events and seed world need pack ownership"], migrationRisk: "high" }),
  scan_reliability_alerts: decision("CORE_KEEP", "job.reliability", "The scan evaluates workflow/provider reliability rather than Water business rules.", { reusableMechanism: "Reliability alerting" }),
  scan_integration_health: decision("CORE_KEEP", "job.integration_health", "The scan evaluates tenant integrations and reconciliation backlog without interpreting business entities.", { reusableMechanism: "Integration health monitor" }),
  scan_watchdog: decision("CORE_KEEP", "job.watchdog", "The watchdog finds stuck workflows/actions and missing receipts independent of vertical.", { reusableMechanism: "Execution watchdog" }),
  scan_dlq_triage: decision("CORE_KEEP", "job.dlq", "The handler classifies dead-letter recovery without Water selectors.", { reusableMechanism: "DLQ triage" }),
  backup_db: decision("CORE_KEEP", "job.backup", "The handler backs up the canonical Postgres database as infrastructure.", { reusableMechanism: "Database backup" }),
  daily_scorecard: decision("CORE_KEEP", "job.scorecard", "The scorecard records workflow, receipt, reconciliation and LLM reliability metrics only.", { reusableMechanism: "Daily runtime reliability scorecard" }),
  project_read_models: decision("CORE_EXTRACT", "job.projections", "Projection refresh mechanics are reusable, but the registered views aggregate Water proposals/customers/schedule/money/inventory.", { reusableMechanism: "Debounced and periodic projection refresh", extractionBlockers: ["Projection registry needs VerticalPack ownership"], migrationRisk: "high" }),
  repair_plan_after_terminal_failure: decision("CORE_KEEP", "job.repair", "The handler invokes the neutral Work repair planner after a terminal step failure.", { reusableMechanism: "Durable repair planning" }),
  suggest_daily_routes: decision("WATER_RETIRE", "job.route_scan", "The job drafts technician route suggestions from dispatch profiles."),
  send_push_notification: decision("PE_REUSE", "job.push", "Push notification delivery is valid for PE team members.", { reusableMechanism: "Push delivery" }),
  scan_ewma_reorder: decision("WATER_RETIRE", "job.inventory_scan", "The scan forecasts Water inventory consumption and reorder need."),
  purge_retention: decision("CORE_KEEP", "job.retention", "The handler applies tenant data-retention policy to runtime evidence.", { reusableMechanism: "Retention enforcement", securityRisk: "high" }),
  send_resend_email: decision("PE_REUSE", "job.email", "Resend-backed email delivery is directly reusable for PE.", { reusableMechanism: "Email delivery" }),
  dispatch_business_operation: decision("CORE_EXTRACT", "job.customer_batch", "The dispatcher/lease machinery is generic but the operation model and downstream safety check are a household win-back campaign.", { reusableMechanism: "Durable bulk-operation dispatcher", extractionBlockers: ["Target resolver and consent policy are hard-coded to households"], migrationRisk: "critical" }),
  execute_business_operation_target: decision("CORE_EXTRACT", "job.customer_batch", "Per-target claim/retry/receipt mechanics are reusable, but execution resolves household marketing consent and phone state.", { reusableMechanism: "Per-target idempotent execution and reconciliation", extractionBlockers: ["Vertical target adapter required"], migrationRisk: "critical" }),
  execute_business_operation_call_batch: decision("CORE_EXTRACT", "job.customer_batch", "Call batching and rate caps are reusable, but targets are frozen Water households.", { reusableMechanism: "Rate-bounded call batching", extractionBlockers: ["Vertical target adapter required"], migrationRisk: "critical" }),
  run_objective_iteration: decision("CORE_EXTRACT", "job.objective_boundary", "The job host is neutral, but constructing the default orchestrator injects the Water plugin/query/planner catalog into every objective iteration.", { reusableMechanism: "Durable objective iteration", extractionBlockers: ["Orchestrator must accept an explicit VerticalPack, including vertical=none"], migrationRisk: "critical" }),
  recover_objectives: decision("CORE_KEEP", "job.objective_recovery", "The handler recovers runnable objective loops from durable lifecycle state.", { reusableMechanism: "Objective recovery" }),
  run_client_factory: decision("CORE_EXTRACT", "job.provisioning", "The durable factory runner is reusable, while the manifest/policy/vocabulary/reference-tenant stages currently provision Water defaults.", { reusableMechanism: "Convergent staged client provisioning", extractionBlockers: ["Client manifest needs VerticalPack-owned defaults"], migrationRisk: "critical" }),
  run_computer_task: decision("CORE_KEEP", "job.computer", "The handler executes a governed computer run through the Core broker/effect boundary.", { reusableMechanism: "Computer execution", securityRisk: "critical" }),
  recover_computer_tasks: decision("CORE_KEEP", "job.computer_recovery", "The handler recovers leased computer runs without vertical selectors.", { reusableMechanism: "Computer recovery", securityRisk: "high" }),
  process_work_event_wait_deadline: decision("CORE_KEEP", "job.event_wait", "The handler advances a durable Work event-wait timeout.", { reusableMechanism: "Durable wait deadline" }),
  scan_connection_health: decision("CORE_KEEP", "job.connection_health", "The handler checks governed application/auth connections independently of business entities.", { reusableMechanism: "Connection health and recovery" }),
  release_probe: decision("CORE_KEEP", "job.release", "The handler reports worker release identity/capability for production verification.", { reusableMechanism: "Release provenance probe", releaseRisk: "high" }),
  sync_sources: decision("CORE_EXTRACT", "job.source_sync", "Lease/checkpoint fan-out is Core, but provider defaults and scope ordering select GHL contacts, QuickBooks customer/invoice/payment and Vapi calls.", { reusableMechanism: "Checkpointed per-source fan-out", extractionBlockers: ["Provider scopes/order need VerticalPack ownership"], migrationRisk: "critical" }),
  sync_source: decision("CORE_EXTRACT", "job.source_sync", "Pagination, leases, retry and freshness are Core, while normalized records materialize Water canonical entities through the shared writer.", { reusableMechanism: "Checkpointed pagination, leases, retry, freshness and reconciliation", extractionBlockers: ["Adapter normalization and canonical materializer need separate ports"], migrationRisk: "critical" }),
  observe_external_effect: decision("CORE_EXTRACT", "job.external_observation", "Observation scheduling and evidence are Core, but the observer hard-codes contact, appointment, invoice and payment read-back shapes.", { reusableMechanism: "External-effect read-back and verification", extractionBlockers: ["Observation contract registry needs VerticalPack/provider ownership"], migrationRisk: "critical", securityRisk: "high" }),
  reconcile_interactive_work: decision("CORE_KEEP", "job.interactive_reconciliation", "The handler repairs interactive Work lifecycle state without Water selectors.", { reusableMechanism: "Interactive Work reconciliation" }),
};

export const TABLE_PE_REPLACE = new Set([
  "households", "contacts", "contact_methods", "leads", "opportunities", "appointments",
  "quotes", "quote_line_items", "proposals", "work_orders", "invoices", "payments",
]);

export const TABLE_WATER_RETIRE = new Set([
  "equipment", "technicians", "service_visits", "maintenance_agreements", "inventory_items",
  "technician_capacity", "technician_dispatch_profiles", "price_book_items", "warehouses",
  "warehouse_stock", "procurement_orders",
]);

export const TABLE_PE_REUSE = new Set([
  "external_organizations", "external_contacts", "communication_identities", "communication_identity_bindings",
  "tasks", "conversations", "calls", "messages", "documents", "document_contents", "research_runs",
  "research_run_hits", "communication_deliveries", "internal_events", "internal_event_participants",
  "internal_event_events", "document_shares", "voice_identities", "voice_sessions", "voice_turns",
  "tenant_phone_numbers", "push_subscriptions",
]);

export const TABLE_CORE_EXTRACT = new Set([
  "tenant_settings", "tenant_operating_profiles", "users", "employee_roles", "work_entity_links",
  "domain_policies", "domain_policy_revisions", "outcome_pack_runs", "tenant_outcome_pack_settings",
  "outcome_pack_certifications", "autonomy_grants", "autonomy_evaluations", "outcome_shadow_proposals",
  "scan_findings", "business_operations", "business_operation_targets", "business_operation_events",
  "workflow_steps", "external_refs", "business_events", "tenant_operational_delta_cursors",
  "operational_deltas", "data_quality_findings", "import_runs", "import_rows", "import_entity_refs",
  "client_factory_runs", "client_factory_stages", "client_factory_stage_attempts", "client_certifications",
  "client_releases", "client_release_configurations", "client_lifecycle_operations", "client_release_promotions",
  "active_client_releases", "dealer_zero_replay_recordings", "dealer_zero_replay_reports",
  "dealer_zero_shadow_reports", "read_model_projections", "role_permissions",
]);

export const TABLE_HISTORY_ONLY = new Set(["communications_log", "workflow_states", "legacy_zep_graph_quarantine"]);

export function tableDisposition(table: string): DispositionDecision {
  if (TABLE_PE_REPLACE.has(table)) return decision("PE_REPLACE", "table.pe_replacement", `${table} stores current Water business semantics that cannot be renamed into a PE entity.`, { replacementPrerequisites: ["PE-native schema and forward data migration"], migrationRisk: "critical" });
  if (TABLE_WATER_RETIRE.has(table)) return decision("WATER_RETIRE", "table.water", `${table} exists for Water/home-service operations and has no PE responsibility.`, { deletionBlockers: ["All readers, writers, triggers and historical migration compatibility must be detached first"], migrationRisk: "high" });
  if (TABLE_PE_REUSE.has(table)) return decision("PE_REUSE", "table.business_portable", `${table} owns a business-facing communication, document, research, task or external-party responsibility that remains semantically valid for PE.`, { migrationRisk: "medium" });
  if (TABLE_CORE_EXTRACT.has(table)) return decision("CORE_EXTRACT", "table.mixed", `${table} persists a reusable Core mechanism but its current rows, enums, references or selectors admit Water-owned semantics.`, { extractionBlockers: ["Introduce Core/VerticalPack ownership before changing active rows or references"], migrationRisk: "critical" });
  if (TABLE_HISTORY_ONLY.has(table)) return decision("HISTORY_ONLY", "table.legacy", `${table} is an explicit compatibility/quarantine model retained to explain historical data and migrations.`, { migrationRisk: "high" });
  return decision("CORE_KEEP", "table.core", `${table} persists vertical-neutral identity, Work, authority, policy execution, queue, evidence, reliability, release or computer-runtime state.`, { migrationRisk: "medium" });
}

const CORE_ACTIONS = new Set(Object.entries(ACTION_DISPOSITIONS).filter(([, value]) => value.disposition === "CORE_KEEP").map(([name]) => name));

export const WATER_PATTERNS: ReadonlyArray<{ id: string; expression: RegExp; meaning: string }> = [
  { id: "water_domain", expression: /\bwater(?:[_ -](?:test|treatment|quality|dealer|system))?\b/i, meaning: "Water treatment business vocabulary" },
  { id: "dealer", expression: /\bdealer(?:[_ -]?zero)?\b/i, meaning: "Water dealer/reference-tenant vocabulary" },
  { id: "household", expression: /\bhouseholds?\b|household[_A-Z]/i, meaning: "Water household canonical truth" },
  { id: "customer", expression: /\bcustomers?\b|customer[_A-Z]/i, meaning: "Current Water customer model" },
  { id: "technician", expression: /\btechnicians?\b|technician[_A-Z]/i, meaning: "Field-service technician role/entity" },
  { id: "dispatch", expression: /\bdispatch(?:er|ing)?\b|dispatch[_A-Z]/i, meaning: "Field-service dispatch behavior" },
  { id: "service_visit", expression: /\bservice[_ -]?visits?\b|serviceVisit/i, meaning: "Water field-service visit" },
  { id: "equipment", expression: /\bequipment\b|equipment[_A-Z]/i, meaning: "Installed Water equipment" },
  { id: "maintenance", expression: /\bmaintenance[_ -]?agreements?\b|maintenanceAgreement/i, meaning: "Water maintenance agreement" },
  { id: "inventory", expression: /\binventory\b|warehouse[_A-Z]|\bwarehouses?\b|\breorder\b|procurement[_A-Z]/i, meaning: "Water installer inventory/procurement" },
  { id: "quote_proposal", expression: /\bquotes?\b|\bproposals?\b|quote[_A-Z]|proposal[_A-Z]/i, meaning: "Water quote/proposal commercial model" },
  { id: "work_order", expression: /\bwork[_ -]?orders?\b|workOrder/i, meaning: "Water installation/service work order" },
  { id: "appointment", expression: /\bappointments?\b|appointment[_A-Z]/i, meaning: "Current Water appointment model" },
  { id: "invoice_payment", expression: /\binvoices?\b|\bpayments?\b|invoice[_A-Z]|payment[_A-Z]/i, meaning: "Current household invoice/payment model" },
  { id: "lead_pipeline", expression: /\bleads?\b|\bopportunities\b|lead[_A-Z]|opportunity[_A-Z]/i, meaning: "Water lead/opportunity pipeline" },
  { id: "installation", expression: /\binstall(?:ation|er|ed|ing)\b/i, meaning: "Water equipment installation workflow" },
  { id: "price_book", expression: /\bprice[_ -]?book\b|priceBook/i, meaning: "Water equipment price book" },
];

const CORE_MARKER = /\b(?:work|objective|authority|approval|policy|receipt|idempot|tenant|rls|queue|lease|reconcil|compensat|computer|audit|evidence|retry|workflow|outbox|inbox|security|auth|release|provenance)\b/i;

const pathContains = (path: string, fragments: string[]): boolean => fragments.some((fragment) => path.includes(fragment));

export function artifactDisposition(path: string, text: string, waterHitIds: string[]): DispositionDecision {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();

  if (lower.startsWith("finnor-os/architecture/p") && !lower.startsWith("finnor-os/architecture/pe0/")) {
    return decision("HISTORY_ONLY", "artifact.prior_architecture", "This prior phase contract/certification is immutable historical evidence, not current runtime truth.");
  }
  if (lower.includes("/packages/db/migrations/") && lower.endsWith(".sql")) {
    return decision("HISTORY_ONLY", "artifact.migration_history", "The numbered SQL migration is immutable forward-migration history; current ownership is derived from schema.ts and active readers/writers.", { migrationRisk: "critical", releaseRisk: "high" });
  }
  if (lower.startsWith("supabase/") || lower.includes("/corpus/") || lower.includes("/fixtures/")) {
    return decision("HISTORY_ONLY", "artifact.fixture_or_legacy_schema", "This file is a fixture, generated corpus, or non-canonical legacy schema and is not an active production truth owner.");
  }
  if (lower.startsWith("docs/release/generated/")) {
    return waterHitIds.length
      ? decision("CORE_EXTRACT", "artifact.generated_release_mixed", "This generated release contract is current assurance output but fixes Water action, entity, journey or provider assumptions that must become pack-owned.", { extractionBlockers: ["Generate from a Core plus active VerticalPack manifest"], releaseRisk: "critical" })
      : decision("CORE_KEEP", "artifact.generated_release_core", "This generated release contract records a vertical-neutral deployment/runtime invariant.", { releaseRisk: "high" });
  }
  if (lower.startsWith("docs/release/") && lower.endsWith(".md")) {
    return decision("HISTORY_ONLY", "artifact.release_history", "This narrative release report is historical evidence; executable current truth is derived from code, registries and release gates.");
  }
  if (lower.includes("supplier-canary")) {
    return decision("CORE_EXTRACT", "artifact.supplier_canary", "The authenticated browser-verification mechanism is reusable, while the single WS-48 supplier-order fixture and vocabulary are Water/reference-world content.", { reusableMechanism: "Deterministic authenticated browser evidence fixture", extractionBlockers: ["Fixture content and credential profile need VerticalPack ownership"], migrationRisk: "medium" });
  }

  const isTest = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(lower) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(lower);
  if (isTest) {
    if (waterHitIds.length && CORE_MARKER.test(text)) return decision("CORE_EXTRACT", "artifact.test_mixed", "This test proves a reusable Core invariant with Water entities/fixtures; preserve the invariant and replace the fixture behind the future pack boundary.", { reusableMechanism: "Executable Core invariant", extractionBlockers: ["Neutral or PE fixture required before Water fixture retirement"] });
    if (waterHitIds.length) return decision("WATER_RETIRE", "artifact.test_water", "This test certifies only current Water business behavior and retires with that behavior after replacement/cutover.");
    return decision("CORE_KEEP", "artifact.test_core", "This executable test certifies a vertical-neutral runtime, security, authority, Work, reliability or evidence invariant.");
  }

  if (lower.includes("packages/domain-plugins/")) {
    const plugin = normalized.split("packages/domain-plugins/")[1]?.split("/")[0] ?? "";
    if (["clarification", "manual-step", "computer-task"].includes(plugin)) return decision("CORE_KEEP", "artifact.plugin_core", `${plugin} implements a vertical-neutral Core action.`);
    if (plugin === "web-research") return decision("PE_REUSE", "artifact.plugin_research", "The source-backed research plugin is directly applicable to PE diligence.", { reusableMechanism: "Evidence-backed web research", peResponsibility: "PE research" });
    if (plugin === "universal-actions") return decision("CORE_EXTRACT", "artifact.plugin_universal_mixed", "Universal action mechanics are reusable, but their PartyRef/CanonicalEntityRef schemas import the monolithic Water-contaminated entity registries.", { reusableMechanism: "Communication, task, delegation, event and document actions", extractionBlockers: ["PartyRef and CanonicalEntityRef must accept pack contributions"], migrationRisk: "critical" });
    if (["bulk-notify", "proposal-batch", "shared"].includes(plugin)) return decision("CORE_EXTRACT", "artifact.plugin_hidden_mechanism", "Reusable workflow/batch/plugin machinery is interleaved with Water household, proposal, appointment or inventory assumptions.", { reusableMechanism: "Plugin/workflow/batch mechanics", extractionBlockers: ["Split neutral engine from Water registrations"], migrationRisk: "high" });
    if (["customer-comm", "crm", "ops-overview", "quotation", "proposal-signature", "compliance-documentation"].includes(plugin)) return decision("PE_REPLACE", "artifact.plugin_pe_replacement", "This business wrapper owns Water customer/pipeline/quote/proposal semantics; any PE responsibility requires a PE-native plugin while lower-level adapters are inventoried separately.", { replacementPrerequisites: ["PE-native entities, queries, policy and receipts"], migrationRisk: "high" });
    return decision("WATER_RETIRE", "artifact.plugin_water", "This registered plugin implements Water/home-service business behavior; reusable provider/runtime machinery is owned by lower-level artifacts.", { deletionBlockers: ["Remove from pack-owned registry only after replacement and release-gate updates"], migrationRisk: "high" });
  }

  if (lower.includes("packages/data-platform/src/")) {
    if (pathContains(lower, ["/documents.ts", "/conversations.ts", "/tasks.ts"])) return decision("PE_REUSE", "artifact.business_data_portable", "This repository owns document, communication or task truth that remains semantically valid for PE.", { migrationRisk: "medium" });
    if (pathContains(lower, ["/equipment.ts", "/inventory.ts", "/maintenance-agreements.ts", "/price-book.ts", "/service-visits.ts"])) return decision("WATER_RETIRE", "artifact.data_water", "This canonical repository writes Water equipment/service/inventory truth.", { migrationRisk: "high" });
    if (pathContains(lower, ["/appointments.ts", "/contacts.ts", "/invoices.ts", "/leads.ts", "/payments.ts", "/quotes.ts", "/work-orders.ts"])) return decision("PE_REPLACE", "artifact.data_pe_replacement", "This canonical writer owns a Water business entity whose PE responsibility requires a native schema and writer.", { replacementPrerequisites: ["PE-native schema and repository"], migrationRisk: "critical" });
    return decision("CORE_EXTRACT", "artifact.data_mixed", "The source/event/import/truth mechanism is reusable but directly consumes the monolithic Water canonical entity and writer set.", { reusableMechanism: "Canonical provenance, events, source truth or import boundary", extractionBlockers: ["Introduce neutral engine and pack-supplied materializers"], migrationRisk: "critical" });
  }

  if (lower.includes("packages/import-engine/")) {
    if (lower.endsWith("/parser.ts")) return decision("CORE_KEEP", "artifact.import_parser", "CSV/JSON/JSONL parsing is vertical-neutral and has no canonical writer dependency.", { reusableMechanism: "Bounded source parsing" });
    return decision("CORE_EXTRACT", "artifact.import_mixed", "Batching, mapping, update modes, provenance and quarantine are reusable, but supported entities, fields, relationships and the writer are entirely Water-owned.", { reusableMechanism: "Declarative import parsing/mapping/idempotency/provenance/quarantine", extractionBlockers: ["ImportEntity and writer registries need VerticalPack ownership"], migrationRisk: "critical" });
  }

  if (lower.includes("packages/tools/src/")) {
    if (pathContains(lower, ["docusign.ts", "email.ts", "resend.ts", "vapi-rest.ts", "exa.ts", "firecrawl.ts", "quickbooks.ts", "stripe.ts", "/pdf/"])) return decision("PE_REUSE", "artifact.provider_portable", "The provider transport/evidence adapter remains directly useful for PE; Water business wrappers are classified separately.", { reusableMechanism: "Provider transport and read-back", migrationRisk: "medium", securityRisk: "high" });
    if (pathContains(lower, ["ads.ts", "ads-write.ts", "maps.ts"])) return decision("WATER_RETIRE", "artifact.provider_water_selected", "This adapter exists for Water local marketing or technician routing and has no committed PE responsibility.");
    if (pathContains(lower, ["source-adapters.ts", "binding-resolution.ts", "builtin-tools.ts", "tenant-provider.ts", "voice-personas.ts"]) || waterHitIds.length) return decision("CORE_EXTRACT", "artifact.provider_registry_mixed", "Reusable provider selection/tool/source mechanics are combined with Water providers, scopes, payloads or personas.", { reusableMechanism: "Provider registry, binding resolution or normalized source adapter interface", extractionBlockers: ["Pack-owned provider registrations and mappings required"], migrationRisk: "high", securityRisk: "high" });
    return decision("CORE_KEEP", "artifact.tools_core", "This module implements vertical-neutral provider governance, idempotency, budgeting, health, logging, release or sandbox machinery.", { securityRisk: lower.includes("credential") || lower.includes("idempot") ? "high" : "low" });
  }

  if (lower.includes("packages/authority/")) return decision("CORE_EXTRACT", "artifact.authority_mixed", "The authority decision/approval engine is critical Core, but assigned/self scope evaluation imports technicians, service visits, households and work orders.", { reusableMechanism: "Tenant-scoped authority decisions and approvals", extractionBlockers: ["Vertical resource-assignment resolver must be injected"], migrationRisk: "critical", securityRisk: "critical", releaseRisk: "critical" });
  if (lower.includes("packages/policy-schema/")) return decision("CORE_EXTRACT", "artifact.policy_schema_mixed", "The policy schema is Core-facing but validates the monolithic Water-contaminated canonical entity union and Water interaction context.", { extractionBlockers: ["Pack-owned entity/action policy schemas"], migrationRisk: "critical", securityRisk: "high" });
  if (lower.includes("packages/security/")) return decision("CORE_KEEP", "artifact.security", "Authentication, tenant credential resolution, redaction and secret loading are vertical-neutral security boundaries.", { securityRisk: "critical", releaseRisk: "high" });
  if (lower.includes("packages/computer/")) return decision("CORE_KEEP", "artifact.computer", "The governed computer broker, repository, runner, effects, origins and redaction are vertical-neutral.", { reusableMechanism: "Governed computer runtime", securityRisk: "critical", releaseRisk: "high" });
  if (lower.includes("packages/voice-os/")) return decision("PE_REUSE", "artifact.voice", "The voice session/turn delivery mechanism remains valid for PE communication.", { reusableMechanism: "Voice session lifecycle", securityRisk: "high" });
  if (lower.includes("packages/workflow-runtime/")) return decision("CORE_KEEP", "artifact.workflow_core", "The workflow lease, command, step, receipt, outbox/inbox, compensation and reconciliation machinery is vertical-neutral; Water step registration lives in the worker.", { reusableMechanism: "Durable workflow kernel", migrationRisk: "high", securityRisk: "high" });
  if (lower.includes("packages/read-models/")) {
    if (pathContains(lower, ["causal-replay.ts", "execution-projection.ts", "work-cases.ts", "reliability.ts"])) return decision("CORE_KEEP", "artifact.read_model_core", "This projection reads vertical-neutral Work/execution/reliability evidence.");
    return decision("CORE_EXTRACT", "artifact.read_model_mixed", "The read-model boundary combines reusable projection/query mechanics with Water tables, entity types, surfaces or relationship edges.", { reusableMechanism: "Bounded tenant-scoped read/projection mechanics", extractionBlockers: ["Vertical query and projection registry required"], migrationRisk: "critical" });
  }
  if (lower.includes("packages/projections/")) return decision("CORE_EXTRACT", "artifact.projection_registry", "Projection refresh mechanics are reusable, while registered views and invalidation surfaces include Water customer/schedule/money/inventory/proposal truth.", { reusableMechanism: "Projection refresh/invalidation", extractionBlockers: ["Pack-owned projection registration"], migrationRisk: "high" });
  if (lower.includes("packages/db/schema.ts") || lower.endsWith("packages/db/index.ts") || lower.endsWith("packages/db/seed.ts")) return decision("CORE_EXTRACT", "artifact.db_mixed", "The active schema/barrel/seed is a single dependency surface containing Core tables plus Water entities, roles, policies, defaults and reference-world data.", { reusableMechanism: "Postgres tenant/RLS/schema machinery", extractionBlockers: ["Split logical schema ownership without rewriting migrations"], migrationRisk: "critical", securityRisk: "high", releaseRisk: "critical" });
  if (lower.includes("packages/db/")) return decision("CORE_KEEP", "artifact.db_core", "This database module implements migration, tenant, event, queue, backup or column mechanics without owning Water semantics.", { migrationRisk: "high", securityRisk: "high" });

  if (lower.includes("packages/operational-ir/")) {
    if (waterHitIds.length || /@finnor\/shared-types/.test(text)) return decision("CORE_EXTRACT", "artifact.p1_p2_boundary", "The IR/effect algorithm is reusable, but this boundary imports current OperationalQuery, BusinessEffect or canonical entity contracts and embeds Water resource mappings.", { reusableMechanism: "Operational IR/effect algorithm", extractionBlockers: ["Neutral resource/query/entity ports"], migrationRisk: "critical" });
    return decision("CORE_KEEP", "artifact.p1_p2_algorithm", "The canonicalization, graph, predicate, admissibility or analysis algorithm is vertical-neutral.");
  }
  if (lower.includes("packages/epistemic-runtime/")) {
    if (waterHitIds.length || /@finnor\/shared-types/.test(text)) return decision("CORE_EXTRACT", "artifact.p3_boundary", "The epistemic algorithm is reusable, but this adapter/fixture imports current OperatingContext/causal types or Water propositions.", { reusableMechanism: "Epistemic state/evidence evaluation", extractionBlockers: ["Neutral evidence/context port"], migrationRisk: "high" });
    return decision("CORE_KEEP", "artifact.p3_algorithm", "The epistemic state, uncertainty, evidence or acquisition algorithm is vertical-neutral.");
  }
  if (lower.includes("packages/program-search/")) {
    if (waterHitIds.length || /@finnor\/shared-types/.test(text)) return decision("CORE_EXTRACT", "artifact.p4_boundary", "The search algorithm is reusable, but this adapter/trace boundary imports current runtime contracts.", { reusableMechanism: "Bounded program search", extractionBlockers: ["Neutral trace/world ports"] });
    return decision("CORE_KEEP", "artifact.p4_algorithm", "The search, dominance, identity and frontier algorithms are vertical-neutral.");
  }
  if (lower.includes("packages/speculative-runtime/")) {
    if (waterHitIds.length || /BusinessWorldProjection|@finnor\/shared-types/.test(text)) return decision("CORE_EXTRACT", "artifact.p5_boundary", "The branch/world algorithm is reusable, but this snapshot/replay/fixture boundary imports current BusinessWorld projections or Water example entities.", { reusableMechanism: "Immutable branchable world simulation", extractionBlockers: ["Neutral world projection port"], migrationRisk: "high" });
    return decision("CORE_KEEP", "artifact.p5_algorithm", "The immutable branch, variable, intervention and comparison algorithms are vertical-neutral.");
  }
  if (lower.includes("packages/trace-compiler/")) {
    if (waterHitIds.length || /@finnor\/shared-types/.test(text)) return decision("CORE_EXTRACT", "artifact.p6_boundary", "The trace compiler is reusable, but this adapter/redaction/fixture boundary imports current Work/world types or embeds Water sensitivity labels.", { reusableMechanism: "Deterministic trace compilation/redaction", extractionBlockers: ["Pack-owned resource sensitivity vocabulary and neutral source adapters"], migrationRisk: "high", securityRisk: "high" });
    return decision("CORE_KEEP", "artifact.p6_algorithm", "The trace normalization, hashing, validation and compilation algorithm is vertical-neutral.");
  }

  if (lower.includes("packages/shared-types/")) {
    if (waterHitIds.length || pathContains(lower, ["company-graph", "operational-queries", "business-world", "universal-actions", "operating-interaction"])) return decision("CORE_EXTRACT", "artifact.shared_contract_mixed", "The shared contract carries Water canonical entity, PartyRef, query, world or interaction variants into otherwise generic consumers.", { extractionBlockers: ["Separate Core contract from VerticalPack contributions"], migrationRisk: "critical", releaseRisk: "high" });
    return decision("CORE_KEEP", "artifact.shared_contract_core", "The shared contract defines vertical-neutral Work, authority, effects, evidence, workflow, error or release semantics.");
  }

  if (lower.includes("packages/orchestration/")) {
    if (waterHitIds.length || pathContains(lower, ["plugin-registry", "planner.ts", "compiler.ts", "read-routing", "fast-read", "objective-loop", "operating-context", "interaction-", "outcome-packs", "dealer-zero", "user-capability", "planning-health", "human-operating"])) return decision("CORE_EXTRACT", "artifact.orchestration_mixed", "The orchestration mechanism is valuable Core, but this module imports or constructs the Water action/query/entity/world catalog or Water planner fallbacks.", { reusableMechanism: "Planner/compiler/objective/orchestration mechanics", extractionBlockers: ["Explicit Core/VerticalPack dependency injection, including vertical=none"], migrationRisk: "critical", releaseRisk: "high" });
    return decision("CORE_KEEP", "artifact.orchestration_core", "The module implements vertical-neutral Work routing, durable execution, authority, repair, reflection, graph or event-wait mechanics.", { migrationRisk: "medium" });
  }

  if (lower.includes("apps/worker/src/handlers/")) {
    const job = Object.keys(JOB_DISPOSITIONS).find((name) => lower.endsWith(`/handlers/${name.replaceAll("_", "-")}.ts`));
    if (job) return JOB_DISPOSITIONS[job]!;
    if (waterHitIds.length) return decision("CORE_EXTRACT", "artifact.worker_mixed", "This worker handler combines reusable job/receipt mechanics with Water selectors.", { extractionBlockers: ["Pack-owned handler registration"] });
    return decision("CORE_KEEP", "artifact.worker_core", "This handler performs vertical-neutral runtime work.");
  }
  if (lower.endsWith("apps/worker/src/index.ts")) return decision("CORE_EXTRACT", "artifact.worker_registry", "The worker host/queue boot is Core, while the same static registry and schedule array register all Water scans and handlers.", { reusableMechanism: "Worker boot and queue host", extractionBlockers: ["Pack-owned job and scheduler registration"], migrationRisk: "critical", releaseRisk: "critical" });
  if (lower.includes("apps/worker/")) return waterHitIds.length
    ? decision("CORE_EXTRACT", "artifact.worker_boundary", "The worker infrastructure is reusable but this module exposes Water projection/event surfaces.", { extractionBlockers: ["Pack-owned surface registration"] })
    : decision("CORE_KEEP", "artifact.worker_core", "The queue, scheduler, heartbeat or SSE infrastructure is vertical-neutral.");
  if (lower.includes("apps/orchestrator/")) return decision("CORE_EXTRACT", "artifact.orchestrator_host", "The optional host is not separately deployed, and its request role enum/default orchestrator injects the Water catalog.", { reusableMechanism: "Thin orchestrator HTTP host", extractionBlockers: ["Neutral role and explicit VerticalPack"], migrationRisk: "high" });
  if (lower.includes("apps/api/lib/auth.ts")) return decision("CORE_EXTRACT", "artifact.auth_identity_mixed", "JWT/tenant/rate-limit authentication is Core, but TenantContext still carries the legacy owner/dispatcher/technician Role contract.", { reusableMechanism: "Supabase authentication and tenant resolution", extractionBlockers: ["Separate authentication principal from vertical role vocabulary"], securityRisk: "critical", migrationRisk: "critical" });
  if (lower.includes("apps/api/lib/workspace-config.ts") || lower.includes("apps/api/app/api/dealer-zero") || lower.includes("apps/api/app/api/technician") || lower.includes("apps/api/app/api/dispatch") || lower.includes("apps/api/app/api/price-book")) return decision("WATER_RETIRE", "artifact.api_water", "This route/config directly exposes Water workspace, Dealer Zero, technician, dispatch or price-book behavior.", { releaseRisk: "high" });
  if (lower.includes("apps/api/app/api/webhooks/esign") || lower.includes("apps/api/app/api/webhooks/payment")) return decision("PE_REPLACE", "artifact.api_water_webhook", "The authenticated provider webhook is useful, but it materializes Water proposal or invoice/payment truth and must be replaced by a PE-native outcome contract.", { reusableMechanism: "Webhook authentication/replay protection", replacementPrerequisites: ["PE-native provider outcome materializer"], securityRisk: "critical", migrationRisk: "critical" });
  if (lower.includes("apps/api/app/api/webhooks/ghl") || lower.includes("apps/api/app/api/webhooks/marketing")) return decision("WATER_RETIRE", "artifact.api_water_webhook", "This webhook ingests Water CRM/marketing lead and appointment truth.", { securityRisk: "critical" });
  if (lower.includes("apps/api/") && waterHitIds.length) return decision("CORE_EXTRACT", "artifact.api_mixed", "The route/library exposes reusable authenticated runtime mechanics together with Water entities, queries, policies or projections.", { extractionBlockers: ["Route contract must depend on Core plus an explicit VerticalPack"], migrationRisk: "high", securityRisk: lower.includes("webhook") ? "critical" : "medium" });
  if (lower.includes("apps/api/")) return decision("CORE_KEEP", "artifact.api_core", "The authenticated API route/library exposes vertical-neutral Work, authority, receipt, reliability, release, connection or computer behavior.", { securityRisk: lower.includes("auth") || lower.includes("webhook") ? "critical" : "medium" });

  if (lower.startsWith("src/app/api/")) {
    if (pathContains(lower, ["/demo", "ai-concierge", "generate-demo", "lifecycle/water"])) return decision("WATER_RETIRE", "artifact.frontend_api_demo", "This root Next route supports the Water/demo/marketing acquisition experience rather than the canonical PE backend.");
    if (lower.includes("voice/webhook")) return decision("PE_REUSE", "artifact.frontend_api_voice", "The voice webhook transport remains useful for PE communication.", { securityRisk: "critical" });
    return decision("CORE_KEEP", "artifact.frontend_api_proxy", "This root Next route proxies or reports the canonical backend/release surface without owning Water business truth.", { securityRisk: "high", releaseRisk: "high" });
  }

  if (lower.startsWith("infra/") || lower.startsWith(".github/workflows/") || lower.startsWith("scripts/release/")) {
    if (waterHitIds.length || /TOTAL_ACTION_COUNT|LEGACY_ACTION_COUNT|dealer.zero|actionCount/i.test(text)) return decision("CORE_EXTRACT", "artifact.release_mixed", "The release/deployment mechanism is reusable, but its gates, journeys, counts or topology assumptions bind the current Water catalog/reference tenant.", { reusableMechanism: "Release provenance and deployment certification", extractionBlockers: ["Pack-aware manifests and certification journeys"], releaseRisk: "critical" });
    return decision("CORE_KEEP", "artifact.release_core", "The deployment/release artifact enforces vertical-neutral provenance, build, migration, security or infrastructure invariants.", { releaseRisk: "critical", securityRisk: "high" });
  }

  if (lower.includes("scripts/client-factory") || lower.includes("scripts/client-lifecycle") || lower.includes("scripts/seed-demo") || lower.includes("scripts/import-client")) return decision("CORE_EXTRACT", "artifact.provisioning_mixed", "The staged provisioning/import mechanism is reusable, but its manifest, vocabulary, policies, roles and seed data are Water-owned.", { reusableMechanism: "Convergent client provisioning/import", extractionBlockers: ["VerticalPack provisioning contract"], migrationRisk: "critical" });
  if (lower.includes("scripts/") && waterHitIds.length) return decision("CORE_EXTRACT", "artifact.script_mixed", "This operational/certification script combines reusable machinery with Water fixtures, action names or schema assumptions.", { releaseRisk: "high" });
  if (lower.includes("scripts/")) return decision("CORE_KEEP", "artifact.script_core", "This operational/certification script checks a vertical-neutral runtime invariant.");

  if (waterHitIds.length && CORE_MARKER.test(text)) return decision("CORE_EXTRACT", "artifact.default_mixed", "The artifact contains both reusable Core mechanics and concrete Water ontology/policy/schema references.", { extractionBlockers: ["Introduce an explicit VerticalPack boundary"], migrationRisk: "high" });
  if (waterHitIds.length) return decision("WATER_RETIRE", "artifact.default_water", "The artifact contains Water business responsibility without an independently evidenced reusable mechanism.");
  return decision("CORE_KEEP", "artifact.default_core", "The artifact is vertical-neutral runtime/build/configuration machinery.");
}

export const PROVIDER_DEFINITIONS = [
  { provider: "ghl", category: "crm/source", paths: ["packages/tools/src/source-adapters.ts", "packages/tools/src/builtin-tools.ts", "apps/api/app/api/webhooks/ghl/route.ts"], sourceScopes: ["contacts", "appointments", "messages"], initialScopes: ["contacts"], incrementalScopes: ["contacts"], canonicalMappings: ["contact -> customer/household", "appointment -> appointment with household relationship", "message -> customer_communication"], transportDisposition: "CORE_EXTRACT", mappingDisposition: "PE_REPLACE", active: true, reason: "Current adapter and webhook directly materialize Water customer/appointment truth." },
  { provider: "quickbooks", category: "accounting/source", paths: ["packages/tools/src/quickbooks.ts", "packages/tools/src/source-adapters.ts", "apps/worker/src/handlers/quickbooks-sync.ts"], sourceScopes: ["customers", "invoices", "payments", "accounting_changes"], initialScopes: ["customers", "invoices", "payments"], incrementalScopes: ["accounting_changes"], canonicalMappings: ["Customer -> customer/household", "Invoice.CustomerRef -> invoice.householdId", "Payment.LinkedTxn -> payment.invoiceId"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REPLACE", active: true, reason: "HTTP/query transport is portable; canonical mappings are Water-owned." },
  { provider: "stripe", category: "payments/source", paths: ["packages/tools/src/stripe.ts", "packages/tools/src/source-adapters.ts"], sourceScopes: ["checkout_sessions"], initialScopes: [], incrementalScopes: [], canonicalMappings: ["checkout_session -> payment/invoice observation"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REPLACE", active: true, reason: "Payment transport is portable; current observation binds the Water invoice ledger." },
  { provider: "vapi", category: "voice/source", paths: ["packages/tools/src/vapi-rest.ts", "packages/tools/src/source-adapters.ts", "apps/api/app/api/webhooks/vapi/route.ts"], sourceScopes: ["calls"], initialScopes: ["calls"], incrementalScopes: ["calls"], canonicalMappings: ["call -> voice_call/conversation"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REUSE", active: true, reason: "Call/session semantics remain honest for PE." },
  { provider: "docusign", category: "esign", paths: ["packages/tools/src/docusign.ts", "packages/tools/src/capabilities/documents.ts", "apps/api/app/api/webhooks/esign/route.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["envelope status -> current proposal signature outcome"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REPLACE", active: true, reason: "Envelope execution/read-back is reusable; proposal outcome materialization is Water-owned." },
  { provider: "gmail/google", category: "communication/auth", paths: ["apps/api/app/api/connections/google/start/route.ts", "apps/api/app/api/connections/google/callback/route.ts", "packages/domain-plugins/universal-actions/runtime.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["OAuth auth profile -> application account", "mail delivery -> communication_delivery"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REUSE", active: true, reason: "External-party email and OAuth connection semantics remain valid." },
  { provider: "resend", category: "communication", paths: ["packages/tools/src/resend.ts", "apps/worker/src/handlers/send-resend-email.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["email acknowledgement -> communication delivery evidence"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REUSE", active: true, reason: "Email delivery is directly reusable." },
  { provider: "ads", category: "marketing", paths: ["packages/tools/src/ads.ts", "packages/tools/src/ads-write.ts", "packages/domain-plugins/marketing/index.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["campaign metrics -> Water marketing summary"], transportDisposition: "WATER_RETIRE", mappingDisposition: "WATER_RETIRE", active: true, reason: "Local lead-generation advertising is not a PE backend responsibility." },
  { provider: "exa/firecrawl/web", category: "research", paths: ["packages/tools/src/exa.ts", "packages/tools/src/firecrawl.ts", "packages/domain-plugins/web-research/index.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["search/scrape result -> evidence source/version/chunk"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REUSE", active: true, reason: "Evidence-backed market/target research is directly useful for PE." },
  { provider: "steel", category: "computer", paths: ["packages/computer/src/steel-provider.ts", "packages/computer/src/runner.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["browser observation/artifact -> governed computer evidence"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "Governed computer execution is vertical-neutral." },
  { provider: "groq/bedrock", category: "llm", paths: ["packages/tools/src/llm.ts", "scripts/release/run-bedrock-live-smoke.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["model call -> llm_calls/cost evidence"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "LLM invocation and cost governance are Core." },
  { provider: "zep/voyage", category: "memory/embedding", paths: ["packages/memory/src/index.ts", "packages/tools/src/llm.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["memory/evidence text -> embeddings and memory provenance"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_EXTRACT", active: true, reason: "Embedding mechanics are Core; current memory subjects/context can carry Water entities." },
  { provider: "supabase-postgres", category: "database/auth", paths: ["packages/db/index.ts", "packages/security/src/index.ts", "infra/deployment/production.contract.json"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["JWT -> tenant employee identity", "Postgres -> canonical truth"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_EXTRACT", active: true, reason: "Infrastructure and authentication are Core; the shared schema is mixed." },
  { provider: "aws-secrets-ecs", category: "infrastructure", paths: ["packages/security/src/secrets.ts", "../infra/aws/finnor-production.yaml", "../infra/deployment/production.contract.json"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["secret id -> tenant/runtime credential", "image digest -> worker release"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "Secrets and worker deployment are Core infrastructure." },
  { provider: "redis", category: "queue/cache", paths: ["packages/db/index.ts", "apps/api/lib/rate-limit.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["rate-limit/cache state"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "Runtime cache/rate limiting is Core." },
  { provider: "sentry/axiom", category: "observability", paths: ["packages/tools/src/observability.ts", "packages/tools/src/logger.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["runtime error/log -> redacted telemetry"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "Observability is Core." },
  { provider: "github-backup", category: "backup", paths: ["packages/tools/src/backup-storage-github.ts", "apps/worker/src/handlers/backup-db.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["database dump -> encrypted backup artifact"], transportDisposition: "CORE_KEEP", mappingDisposition: "CORE_KEEP", active: true, reason: "Backup transport is Core infrastructure." },
  { provider: "web-push", category: "communication", paths: ["apps/worker/src/handlers/send-push-notification.ts", "apps/api/app/api/push-subscriptions/route.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["subscription -> employee notification"], transportDisposition: "PE_REUSE", mappingDisposition: "PE_REUSE", active: true, reason: "Team-member push notifications remain valid." },
  { provider: "maps/geocode", category: "routing", paths: ["packages/tools/src/maps.ts", "packages/domain-plugins/route-optimization/index.ts"], sourceScopes: [], initialScopes: [], incrementalScopes: [], canonicalMappings: ["customer/technician address -> field-service route"], transportDisposition: "WATER_RETIRE", mappingDisposition: "WATER_RETIRE", active: true, reason: "The only active responsibility is Water technician routing." },
] as const;

export const CANONICAL_ENTITY_DISPOSITIONS: Record<string, Disposition> = {
  household: "PE_REPLACE", contact: "PE_REPLACE", user: "CORE_EXTRACT", technician: "WATER_RETIRE",
  equipment: "WATER_RETIRE", service_visit: "WATER_RETIRE", maintenance_agreement: "WATER_RETIRE",
  lead: "PE_REPLACE", opportunity: "PE_REPLACE", quote: "PE_REPLACE", proposal: "PE_REPLACE",
  work_order: "PE_REPLACE", appointment: "PE_REPLACE", invoice: "PE_REPLACE", payment: "PE_REPLACE",
  conversation: "PE_REUSE", call: "PE_REUSE", message: "PE_REUSE", communication: "PE_REUSE",
  document: "PE_REUSE", task: "PE_REUSE", work: "CORE_KEEP", domain_action: "CORE_KEEP",
  workflow_run: "CORE_KEEP", workflow_step: "CORE_EXTRACT", business_operation: "CORE_EXTRACT",
  business_operation_target: "CORE_EXTRACT", decision_receipt: "CORE_KEEP", business_event: "CORE_EXTRACT",
  org_unit: "CORE_KEEP", tenant_location: "CORE_KEEP", external_organization: "PE_REUSE",
  external_contact: "PE_REUSE", delegation: "CORE_KEEP", acknowledgement_request: "PE_REUSE",
  communication_delivery: "PE_REUSE", internal_event: "PE_REUSE", document_share: "PE_REUSE",
  inventory_item: "WATER_RETIRE", computer_run: "CORE_KEEP",
};

export const PARTY_TYPE_DISPOSITIONS: Record<string, Disposition> = {
  employee: "CORE_KEEP", team: "CORE_KEEP", location: "CORE_KEEP", household: "PE_REPLACE",
  contact: "PE_REPLACE", external_organization: "PE_REUSE", external_contact: "PE_REUSE",
};

export const CORE_ACTION_SET = CORE_ACTIONS;

export const CUTOVER_BLOCKERS = [
  { order: 1, id: "vertical_pack_contract", risk: "critical", owner: "P1", paths: ["packages/orchestration/src/plugin-registry.ts", "packages/shared-types/src/company-graph.ts"], blocker: "There is no explicit Core ↔ VerticalPack contract and no vertical=none boot path.", requiredWork: "Define pack-owned action, query, entity, party, job, projection, source mapping, import writer, prompt and provisioning contributions." },
  { order: 2, id: "canonical_entity_union", risk: "critical", owner: "P1", paths: ["packages/shared-types/src/company-graph.ts", "packages/data-platform/src/business-truth-registry.ts", "packages/operational-ir/src/resolution.ts", "packages/policy-schema/src/index.ts"], blocker: "CANONICAL_ENTITY_TYPES and PARTY_TYPES mix Core, Water and reusable PE-facing parties and fan out into validation, policy, IR, Work context and read models.", requiredWork: "Split fixed Core identifiers from pack-contributed entity/party registries with explicit compatibility serialization." },
  { order: 3, id: "mixed_database_contract", risk: "critical", owner: "P1", paths: ["packages/db/schema.ts", "packages/db/index.ts", "packages/db/migrations/0092_phase2_live_business_world.sql"], blocker: "One schema/barrel and trigger surface mixes Core and Water tables and Water projection channels.", requiredWork: "Create logical repository/schema ownership boundaries and additive forward migrations; never edit migrations 0000-0108." },
  { order: 4, id: "authority_resource_resolver", risk: "critical", owner: "P1", paths: ["packages/authority/src/index.ts", "apps/api/lib/auth.ts"], blocker: "Generic authority evaluation hard-codes users.technician_id, technicians, work_orders, service_visits and households; authentication still carries legacy Water roles.", requiredWork: "Inject pack-owned resource assignment/scope resolution and separate authenticated employee identity from vertical role vocabulary." },
  { order: 5, id: "action_plugin_registry", risk: "critical", owner: "P1", paths: ["packages/orchestration/src/plugin-registry.ts", "scripts/release/action-hardening-spec.ts"], blocker: "All 59 actions and 26 plugins are registered in one startup catalog and release hardening fixes exact Water counts/names.", requiredWork: "Make action registration and hardening manifests compositional while keeping current Water pack active through cutover." },
  { order: 6, id: "planner_cognition", risk: "critical", owner: "P1", paths: ["packages/orchestration/src/planner.ts", "packages/orchestration/src/read-routing.ts", "packages/orchestration/src/objective-loop.ts", "packages/orchestration/src/operating-context.ts"], blocker: "Planner prompts, safe fallbacks, continuation logic and Objective context assume Water customers, scheduling, inventory, invoices and Water-test workflows.", requiredWork: "Move vocabulary, examples, safe fallbacks, query catalog and objective context into the active VerticalPack; prove vertical=none cannot emit a business action." },
  { order: 7, id: "query_projection_registry", risk: "critical", owner: "P1", paths: ["packages/shared-types/src/operational-queries.ts", "packages/read-models/src/operational-queries.ts", "packages/projections/src/index.ts"], blocker: "The query union and projection registry combine Core Work/activity with Water customer/schedule/money/inventory/business-state reads.", requiredWork: "Split Core query execution/pagination from pack-owned query schemas, resolvers, projections and invalidation surfaces." },
  { order: 8, id: "worker_job_scheduler_registry", risk: "critical", owner: "P1", paths: ["apps/worker/src/index.ts", "apps/worker/src/handlers/run-workflow-step.ts", "apps/worker/src/handlers/business-operation.ts"], blocker: "The Core worker registers 47 handlers, 24 tenant schedules and Water workflow steps/bulk target logic in static monoliths.", requiredWork: "Keep queue/scheduler/lease machinery in Core; register Water handlers, scans and workflow steps through the active pack." },
  { order: 9, id: "source_truth_mapping", risk: "critical", owner: "P1", paths: ["packages/tools/src/source-adapters.ts", "packages/data-platform/src/source-truth.ts", "apps/worker/src/handlers/sync-source.ts"], blocker: "Source-sync mechanics are coupled to GHL and QuickBooks scopes/order and Water canonical materialization.", requiredWork: "Separate checkpoint/lease/page/freshness engine from pack-owned provider scopes, normalization, relationship names and materializers." },
  { order: 10, id: "import_writer_registry", risk: "critical", owner: "P1", paths: ["packages/import-engine/src/definition.ts", "packages/import-engine/src/index.ts", "packages/data-platform/src/import-writes.ts"], blocker: "Reusable parsing/batching/provenance calls a closed Water entity/field/relationship union and monolithic canonical writer.", requiredWork: "Introduce pack-provided import definitions, validators and canonical writers while retaining Core run/quarantine/idempotency." },
  { order: 11, id: "p1_p6_boundaries", risk: "high", owner: "P1", paths: ["packages/operational-ir/src/effect-inference.ts", "packages/epistemic-runtime/src/context-adapter.ts", "packages/speculative-runtime/src/snapshot.ts", "packages/trace-compiler/src/adapters.ts"], blocker: "P1-P6 algorithms are mostly Core, but their runtime adapters import current Water query/resource/world/redaction contracts.", requiredWork: "Preserve algorithms; replace boundary imports with neutral Core ports and pack-owned resource sensitivity/query mappings." },
  { order: 12, id: "reference_tenant_provisioning", risk: "high", owner: "P1/P6", paths: ["scripts/client-factory.ts", "packages/db/seed.ts", "packages/orchestration/src/dealer-zero-replay.ts"], blocker: "Deterministic provisioning/replay machinery and Dealer Zero Water world are interleaved.", requiredWork: "Extract manifest/replay engine in P1; retain Dealer Zero as Water history until a later PE phase builds Deal Zero." },
  { order: 13, id: "release_certification_coupling", risk: "critical", owner: "P1", paths: ["scripts/release/action-hardening-spec.ts", "scripts/release/run-action-contract-matrix.ts", "../.github/workflows/production-release.yml"], blocker: "Release tests and generated manifests assert exact Water actions, fixtures, schema head and journeys.", requiredWork: "Make gates consume the active pack manifest and certify unchanged Core invariants plus pack-specific contracts; preserve migration lineage." },
] as const;

export const PHASE_BOUNDARIES = [
  { phase: "P1", package: "@finnor/operational-ir", coreAlgorithms: ["canonical serialization", "IR graph/schema primitives", "lowering framework"], extractBoundaries: ["effect-inference Water resource catalog", "OperationalQueryRequest adapters", "CANONICAL_ENTITY_TYPES resolution", "DomainAction/BusinessEffect runtime mappings"] },
  { phase: "P2", package: "@finnor/operational-ir", coreAlgorithms: ["static admissibility", "effect-set analysis", "conflict/compensation checks"], extractBoundaries: ["runtime BusinessEffect/ComputerAuthorizedEffect adapters", "Water resource classifications inherited from effect-inference"] },
  { phase: "P3", package: "@finnor/epistemic-runtime", coreAlgorithms: ["proposition/evidence state", "uncertainty lattice", "acquisition policy", "source precedence"], extractBoundaries: ["OperatingContext adapter", "CausalReplay trace adapter", "invoice test-support propositions", "orchestration shadow adapter"] },
  { phase: "P4", package: "@finnor/program-search", coreAlgorithms: ["bounded search", "frontier/dominance", "program identity", "budgeting"], extractBoundaries: ["CausalReplay trace adapter", "orchestration program-search shadow inputs"] },
  { phase: "P5", package: "@finnor/speculative-runtime", coreAlgorithms: ["immutable branches", "interventions", "world variables", "comparison"], extractBoundaries: ["BusinessWorldProjection snapshot adapter", "read-model provenance", "household/invoice test support", "orchestration speculative shadow"] },
  { phase: "P6", package: "@finnor/trace-compiler", coreAlgorithms: ["normalization", "deterministic compilation", "hashing", "validation"], extractBoundaries: ["Work/effect/query/read-model adapters", "Water-specific redaction labels", "runtime source ownership table"] },
] as const;

export const ACCEPTANCE_TRACES = [
  { id: "api_typed_query", acceptance: 2, kind: "api", path: ["apps/api/app/api/queries/route.ts#POST", "apps/api/lib/auth.ts#requireContext", "apps/api/lib/orchestrator.ts#getOrchestrator", "packages/orchestration/src/index.ts#handleOperationalQuery", "packages/read-models/src/operational-queries.ts#executeOperationalQuery", "packages/db/schema.ts#workQueryExecutions", "packages/db/index.ts#recordWorkResponse"], proof: "Authenticated tenant context reaches the canonical query executor and a durable Work/query receipt; query-specific Water tables are enumerated in query-resolution-map.json." },
  { id: "api_instruction_action", acceptance: 2, kind: "api", path: ["apps/api/app/api/actions/route.ts#POST", "apps/api/lib/auth.ts#requireContext", "packages/db/index.ts#receiveWork", "packages/orchestration/src/instruction-routing.ts#classifyInstructionRoute", "packages/orchestration/src/index.ts#handleInstructionResult", "packages/orchestration/src/plugin-registry.ts#createDefaultPluginRegistry", "packages/orchestration/src/compiler.ts", "packages/orchestration/src/authority-runtime.ts", "packages/orchestration/src/durable-execution.ts"], proof: "The representative mutation path crosses auth, Work, route compilation, Water-contaminated catalog, effect/authority and durable execution." },
  { id: "string_registered_low_inventory", acceptance: 3, kind: "job", path: ["apps/worker/src/index.ts#PROACTIVE_SCANS(scan_low_inventory)", "apps/worker/src/scheduler.ts#scheduleTick", "packages/db/index.ts#enqueueJob", "apps/worker/src/queue.ts#JobQueue.tick", "apps/worker/src/index.ts#createWorker.register(scan_low_inventory)", "apps/worker/src/handlers/scan-low-inventory.ts#scanLowInventory", "packages/db/schema.ts#inventoryItems", "packages/db/schema.ts#scanFindings"], proof: "The job is reached by string registration and scheduled data, not an import-only call graph; it reads inventory/policy/action rows and writes a finding." },
  { id: "durable_work_objective", acceptance: 4, kind: "work", path: ["packages/db/index.ts#receiveWork", "packages/orchestration/src/index.ts#handleInstructionResult", "packages/orchestration/src/objective-loop.ts#ObjectiveLoopRuntime", "packages/db/schema.ts#workObjectiveLoops", "apps/worker/src/handlers/run-objective-iteration.ts#runObjectiveIteration", "packages/orchestration/src/plugin-registry.ts#createDefaultPluginRegistry", "packages/orchestration/src/runtime-bridge.ts", "packages/workflow-runtime/src/receipts.ts"], proof: "Work lifecycle, iteration claims, authority and receipts are Core; default plugin/query/prompt injection is the exact Water boundary." },
  { id: "canonical_entity_fanout", acceptance: 5, kind: "contract", path: ["packages/shared-types/src/company-graph.ts#CANONICAL_ENTITY_TYPES", "packages/policy-schema/src/index.ts#CanonicalEntityRefSchema", "packages/operational-ir/src/resolution.ts", "packages/domain-plugins/universal-actions/schemas.ts", "packages/orchestration/src/operating-context.ts", "packages/read-models/src/index.ts", "scripts/generate-openapi.ts", "scripts/p0/certify.ts"], proof: "Removing household/technician changes validation, IR resolution, actions, context, graph queries, generated contracts and certification; database/trigger fan-out is in schema-read-write-map.json." },
  { id: "quickbooks_invoice_source", acceptance: 6, kind: "source", path: ["apps/worker/src/handlers/sync-source.ts#DEFAULT_INITIAL_SCOPES", "packages/tools/src/source-adapters.ts#quickBooksSourceAdapter", "packages/tools/src/quickbooks.ts#readQuickBooksObject", "packages/tools/src/source-adapters.ts#normalizeQboInvoice", "packages/data-platform/src/source-truth.ts#materializeSourceRecord", "packages/data-platform/src/import-writes.ts#writeCanonicalImportRow(invoice)", "packages/db/schema.ts#externalRefs", "packages/data-platform/src/events.ts#recordBusinessEvent"], proof: "Checkpoint/pagination/lease/freshness is Core; CustomerRef->householdId and invoice/payment writes are PE_REPLACE Water mappings." },
  { id: "docusign_inside_proposal", acceptance: 7, kind: "provider", path: ["packages/domain-plugins/proposal-signature/index.ts#request_proposal_signature", "packages/tools/src/capabilities/documents.ts#requestSignatureContract", "packages/tools/src/docusign.ts", "apps/worker/src/handlers/run-workflow-step.ts#request_signature", "apps/api/app/api/webhooks/esign/route.ts#POST"], proof: "The Water proposal wrapper is PE_REPLACE while DocuSign execution/read-back is PE_REUSE and the step executor is CORE_EXTRACT." },
  { id: "planner_vertical_none", acceptance: 8, kind: "planner", path: ["packages/orchestration/src/plugin-registry.ts#createDefaultPluginRegistry", "packages/orchestration/src/planner.ts#LLMPlanner", "packages/orchestration/src/read-routing.ts#clarificationContinuationAction", "packages/orchestration/src/fast-read-lane.ts", "packages/orchestration/src/objective-loop.ts#ObjectiveLoopRuntime", "packages/orchestration/src/user-capability-registry.ts#createUserCapabilityRegistry"], proof: "Core cannot plan with vertical=none: every default orchestrator constructs all 26 plugins; prompts/fallbacks reference Water action/query vocabulary and there is no empty-pack constructor." },
  { id: "migration_history", acceptance: 9, kind: "migration", path: ["packages/db/migrations/0000_init.sql", "packages/db/migrations/0108_operating_product_closure.sql", "packages/db/migrate.ts", "packages/db/migration-head.ts", "packages/db/schema.ts"], proof: "All 109 numbered migrations are HISTORY_ONLY and immutable; schema.ts plus active readers/writers separately represents current ownership." },
  { id: "technician_authority", acceptance: 10, kind: "authority", path: ["packages/security/src/auth.ts#resolveTenantFromBearerToken", "packages/db/schema.ts#users.technicianId", "packages/authority/src/index.ts#loadAuthorities", "packages/authority/src/index.ts#isAssigned", "packages/db/schema.ts#employeeRoleAssignments", "packages/db/schema.ts#roleAuthorityGrants", "packages/orchestration/src/authority-runtime.ts", "packages/orchestration/src/runtime-bridge.ts"], proof: "Auth and grant evaluation are Core; legacy role/technician mapping and assigned household/work-order resolution are CORE_EXTRACT." },
  { id: "p1_p6_boundaries", acceptance: 11, kind: "phase", path: ["packages/operational-ir/src/effect-inference.ts", "packages/epistemic-runtime/src/context-adapter.ts", "packages/program-search/src/trace.ts", "packages/speculative-runtime/src/snapshot.ts", "packages/trace-compiler/src/adapters.ts", "packages/trace-compiler/src/redaction.ts"], proof: "phase-boundary-map.json lists the preserved algorithms and every current Water/world/query boundary per phase." },
  { id: "unreachable_water_console", acceptance: 12, kind: "dead_code", path: ["apps/console/app/customers/page.tsx", "infra/deployment/production.contract.json"], proof: "The finnor-os console customer UI is absent from required production components and runtime roots; it is not counted as active backend contamination." },
  { id: "water_fixture_core_invariant", acceptance: 13, kind: "test", path: ["tests/integration/source-truth-loop.test.ts", "packages/data-platform/src/source-truth.ts"], proof: "GHL/customer fixtures prove tenant isolation, ordering, tombstones and reconciliation; the test is CORE_EXTRACT, so those invariants survive with neutral/PE fixtures." },
] as const;
