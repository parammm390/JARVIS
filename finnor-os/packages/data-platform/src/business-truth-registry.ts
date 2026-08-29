import type { CanonicalImportEntity } from "./import-writes";

export type BusinessSourceOwner = "finnor" | "external" | "governed";

export interface BusinessTruthDefinition {
  /** Stable business-language fact name. */
  concept: string;
  /** The single writable model. A model may span tables, but has one owning boundary. */
  authoritativeModel: readonly string[];
  writableOwner: string;
  /** Approved command/repository entry points; callers never write the model directly. */
  mutations: readonly string[];
  events: readonly string[];
  identity: readonly string[];
  sourceOwnership: {
    default: BusinessSourceOwner;
    fields?: Readonly<Record<string, BusinessSourceOwner>>;
  };
  importability: CanonicalImportEntity | "not_importable";
  /** Read-only compatibility names only. Never a mutation target. */
  legacyProjection: readonly string[];
}

/**
 * The executable Business Truth Registry. This is deliberately code—not a wiki—so
 * import, sync, mutation and certification tests can ratchet against the same list.
 */
export const BUSINESS_TRUTH_REGISTRY = [
  {
    concept: "customer",
    authoritativeModel: ["households", "contacts", "contact_methods"],
    writableOwner: "@finnor/data-platform#customer",
    mutations: ["createCustomerHousehold", "ensureCustomerContact", "updateCustomerCoordinates", "createLead", "createContact", "addContactMethod", "writeCanonicalImportRow"],
    events: ["customer_household_created", "customer_location_changed", "lead_created", "contact_created", "contact_imported", "contact_import_updated"],
    identity: ["tenant_id + household.id", "tenant-scoped verified phone/email", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { phone: "governed", email: "governed", marketingConsent: "finnor" } },
    importability: "customer",
    legacyProjection: ["households.contact_info"],
  },
  {
    concept: "lead",
    authoritativeModel: ["leads"],
    writableOwner: "@finnor/data-platform#lead",
    mutations: ["createLead", "updateLeadStatus", "convertLeadToOpportunity", "writeCanonicalImportRow"],
    events: ["lead_created", "lead_status_changed", "lead_imported", "lead_import_updated"],
    identity: ["tenant_id + leads.id", "tenant + source_system + external_id"],
    sourceOwnership: { default: "finnor", fields: { source: "governed" } },
    importability: "lead",
    legacyProjection: ["workflow_states:lead_to_install"],
  },
  {
    concept: "opportunity",
    authoritativeModel: ["opportunities"],
    writableOwner: "@finnor/data-platform#opportunity",
    mutations: ["convertLeadToOpportunity"],
    events: ["opportunity_created", "opportunity_stage_changed"],
    identity: ["tenant_id + opportunities.id", "latest tenant + household opportunity"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: ["workflow_states:lead_to_install"],
  },
  {
    concept: "customer_communication",
    authoritativeModel: ["conversations", "messages"],
    writableOwner: "@finnor/data-platform#message",
    mutations: ["recordCustomerMessage", "persistMessage"],
    events: ["message_recorded"],
    identity: ["tenant_id + messages.id", "tenant + source_system + external_id"],
    sourceOwnership: { default: "finnor", fields: { providerDeliveryId: "external" } },
    importability: "not_importable",
    legacyProjection: ["communications_log (read-only view)"],
  },
  {
    concept: "voice_call",
    authoritativeModel: ["conversations", "calls"],
    writableOwner: "@finnor/data-platform#call",
    mutations: ["persistCall"],
    events: ["call_recorded"],
    identity: ["tenant + source_system + external_id"],
    sourceOwnership: { default: "governed", fields: { transcript: "external", recordingUrl: "external" } },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "appointment",
    authoritativeModel: ["appointments"],
    writableOwner: "@finnor/data-platform#appointment",
    mutations: ["createAppointment", "updateAppointmentStatus", "writeCanonicalImportRow"],
    events: ["appointment_created", "appointment_status_changed"],
    identity: ["tenant_id + appointments.id", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { providerStatus: "external" } },
    importability: "appointment",
    legacyProjection: ["service_visits scheduling projection"],
  },
  {
    concept: "service_visit",
    authoritativeModel: ["service_visits"],
    writableOwner: "@finnor/data-platform#service-visit",
    mutations: ["createServiceVisit", "assignServiceVisit", "completeServiceVisit", "writeCanonicalImportRow"],
    events: ["service_visit_created", "service_visit_assigned", "service_visit_completed"],
    identity: ["tenant_id + service_visits.id", "external_refs"],
    sourceOwnership: { default: "finnor" },
    importability: "service_visit",
    legacyProjection: [],
  },
  {
    concept: "equipment",
    authoritativeModel: ["equipment"],
    writableOwner: "@finnor/data-platform#equipment",
    mutations: ["ensureEquipment", "writeCanonicalImportRow"],
    events: ["equipment_created", "equipment_imported", "equipment_import_updated"],
    identity: ["tenant_id + equipment.id", "external_refs"],
    sourceOwnership: { default: "finnor" },
    importability: "equipment",
    legacyProjection: [],
  },
  {
    concept: "maintenance_agreement",
    authoritativeModel: ["maintenance_agreements"],
    writableOwner: "@finnor/data-platform#maintenance-agreement",
    mutations: ["ensureMaintenanceAgreement", "updateMaintenanceAgreement"],
    events: ["maintenance_agreement_created", "maintenance_agreement_changed"],
    identity: ["tenant_id + maintenance_agreements.id"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "quote",
    authoritativeModel: ["quotes", "quote_line_items"],
    writableOwner: "@finnor/data-platform#quote",
    mutations: ["createQuote", "markQuoteSent", "setQuoteStatus", "writeCanonicalImportRow"],
    events: ["quote_created", "quote_sent", "quote_status_changed"],
    identity: ["tenant_id + quotes.id", "external_refs"],
    sourceOwnership: { default: "finnor" },
    importability: "quote",
    legacyProjection: [],
  },
  {
    concept: "proposal",
    authoritativeModel: ["proposals"],
    writableOwner: "@finnor/data-platform#proposal",
    mutations: ["createProposal", "setProposalStatus", "writeCanonicalImportRow"],
    events: ["proposal_created", "proposal_status_changed"],
    identity: ["tenant_id + proposals.id", "quote_id", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { signatureStatus: "external" } },
    importability: "proposal",
    legacyProjection: [],
  },
  {
    concept: "work_order",
    authoritativeModel: ["work_orders"],
    writableOwner: "@finnor/data-platform#work-order",
    mutations: ["createWorkOrder", "updateWorkOrderStatus", "writeCanonicalImportRow"],
    events: ["work_order_created", "work_order_status_changed"],
    identity: ["tenant_id + work_orders.id", "external_refs"],
    sourceOwnership: { default: "finnor" },
    importability: "work_order",
    legacyProjection: [],
  },
  {
    concept: "invoice",
    authoritativeModel: ["invoices"],
    writableOwner: "@finnor/data-platform#invoice",
    mutations: ["createInvoice", "recordPayment", "writeCanonicalImportRow"],
    events: ["invoice_created", "invoice_status_changed"],
    identity: ["tenant_id + invoices.id", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { accountingProviderId: "external" } },
    importability: "invoice",
    legacyProjection: [],
  },
  {
    concept: "payment",
    authoritativeModel: ["payments"],
    writableOwner: "@finnor/data-platform#payment",
    mutations: ["recordPayment", "writeCanonicalImportRow"],
    events: ["payment_recorded", "payment_imported", "payment_import_updated"],
    identity: ["tenant_id + payments.id", "tenant + source_system + external_id"],
    sourceOwnership: { default: "governed", fields: { status: "external" } },
    importability: "payment",
    legacyProjection: ["invoices.status=paid"],
  },
  {
    concept: "inventory_item",
    authoritativeModel: ["inventory_items"],
    writableOwner: "@finnor/data-platform#inventory",
    mutations: ["createInventoryItem", "reconcileInventoryItemMetadata", "adjustInventoryItem", "writeCanonicalImportRow"],
    events: ["inventory_item_created", "inventory_item_metadata_reconciled", "inventory_item_adjusted", "inventory_item_imported", "inventory_item_import_updated"],
    identity: ["tenant + sku", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { quantity: "finnor" } },
    importability: "inventory_item",
    legacyProjection: [],
  },
  {
    concept: "warehouse_stock",
    authoritativeModel: ["warehouse_stock"],
    writableOwner: "@finnor/data-platform#inventory",
    mutations: ["adjustWarehouseStock"],
    events: ["warehouse_stock_adjusted"],
    identity: ["tenant + warehouse_id + sku"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: ["inventory_items.quantity"],
  },
  {
    concept: "task",
    authoritativeModel: ["tasks"],
    writableOwner: "@finnor/data-platform#task",
    mutations: ["createTask", "updateTask", "writeCanonicalImportRow"],
    events: ["task_created", "task_updated"],
    identity: ["tenant_id + tasks.id", "external_refs"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "technician",
    authoritativeModel: ["technicians", "technician_capacity", "technician_dispatch_profiles"],
    writableOwner: "@finnor/provisioning#employee",
    mutations: ["reconcileDealerZeroStatic", "provisionClient", "writeCanonicalImportRow"],
    events: ["technician_imported"],
    identity: ["tenant + employee email", "tenant + technician id", "external_refs"],
    sourceOwnership: { default: "finnor", fields: { externalProviderUserId: "external" } },
    importability: "technician",
    legacyProjection: ["users.technician_id"],
  },
  {
    concept: "employee",
    authoritativeModel: ["users", "employee_role_assignments", "org_unit_memberships"],
    writableOwner: "@finnor/provisioning#employee",
    mutations: ["reconcileDealerZeroStatic", "provisionClient", "handoffWork"],
    events: ["employee_provisioned", "work_handed_off"],
    identity: ["tenant + normalized employee email", "tenant_id + users.id"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: ["users.role"],
  },
  {
    concept: "company_configuration",
    authoritativeModel: ["tenants", "tenant_settings", "tenant_locations", "org_units", "domain_policies", "communication_identities", "application_accounts", "auth_profiles"],
    writableOwner: "@finnor/provisioning#manifest",
    mutations: ["provisionClient", "reconcileDealerZeroStatic", "seedTenantPolicies"],
    events: ["client_factory_stage_completed"],
    identity: ["tenants.client_key", "tenant-scoped natural keys"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "communication_delivery",
    authoritativeModel: ["communication_deliveries", "sandbox_outbox"],
    writableOwner: "@finnor/domain-plugins/universal-actions#delivery",
    mutations: ["executeCommunication", "executeRequestAcknowledgement", "recordOutbound"],
    events: ["communication_dispatched", "acknowledgement_request_delivered"],
    identity: ["domain_action + recipient + channel", "provider message reference"],
    sourceOwnership: { default: "finnor", fields: { providerMessageRef: "external" } },
    importability: "not_importable",
    legacyProjection: ["sandbox_outbox"],
  },
  {
    concept: "delegation",
    authoritativeModel: ["delegations", "delegation_events", "acknowledgement_requests"],
    writableOwner: "@finnor/domain-plugins/universal-actions#delegation",
    mutations: ["executeDelegateObjective", "transitionDelegation", "acknowledgeDelegation", "acceptDelegation", "completeDelegation"],
    events: ["delegation_created", "delegation.sent", "delegation.delivered", "delegation.acknowledged", "delegation.accepted", "delegation.completed", "delegation.escalated", "delegation.cancelled"],
    identity: ["domain_action_id", "tenant_id + delegations.id"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "internal_event",
    authoritativeModel: ["internal_events", "internal_event_participants", "internal_event_events"],
    writableOwner: "@finnor/domain-plugins/universal-actions#internal-event",
    mutations: ["executeScheduleInternalEvent", "executeRescheduleInternalEvent"],
    events: ["internal_event_scheduled", "internal_event_rescheduled"],
    identity: ["origin_domain_action_id", "tenant_id + internal_events.id"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: ["schedule projection"],
  },
  {
    concept: "business_document",
    authoritativeModel: ["documents", "document_contents", "document_shares"],
    writableOwner: "@finnor/data-platform#document",
    mutations: ["createDocument", "recordDocumentContent", "executeShareDocument"],
    events: ["document_created", "document_shared", "document_share_pending_manual"],
    identity: ["tenant_id + documents.id", "tenant + source_system + external_id"],
    sourceOwnership: { default: "finnor", fields: { storageRef: "governed" } },
    importability: "not_importable",
    legacyProjection: [],
  },
  {
    concept: "business_research",
    authoritativeModel: ["research_runs", "research_run_hits", "evidence_sources", "evidence_source_versions", "evidence_chunks"],
    writableOwner: "@finnor/memory#research",
    mutations: ["runResearch", "writeSemantic"],
    events: ["research_completed", "evidence_ingested"],
    identity: ["tenant_id + research_runs.id", "tenant + canonical source URL/version"],
    sourceOwnership: { default: "external" },
    importability: "not_importable",
    legacyProjection: ["embeddings"],
  },
  {
    concept: "external_business_operation",
    authoritativeModel: ["business_operations", "business_operation_targets", "business_operation_events", "external_operations"],
    writableOwner: "@finnor/workflow-runtime#external-operation",
    mutations: ["startBusinessOperation", "runBusinessOperationTarget", "callIdempotent"],
    events: ["business_operation_started", "target_succeeded", "target_failed", "external_operation_reconciled"],
    identity: ["tenant + domain action", "tenant + provider idempotency key"],
    sourceOwnership: { default: "governed", fields: { providerRef: "external" } },
    importability: "not_importable",
    legacyProjection: ["domain_actions bulk-operation projection"],
  },
  {
    concept: "operating_work",
    authoritativeModel: ["works", "work_inputs", "work_events", "decision_receipts"],
    writableOwner: "@finnor/db#canonical-work-lifecycle",
    mutations: ["receiveWork", "transitionWork", "reconcileWorkStatus"],
    events: ["work_received", "work_status_changed", "decision_receipt_recorded"],
    identity: ["tenant_id + works.id", "tenant + idempotency key"],
    sourceOwnership: { default: "finnor" },
    importability: "not_importable",
    legacyProjection: ["workspace/projector UI state"],
  },
] as const satisfies readonly BusinessTruthDefinition[];

export type BusinessConcept = (typeof BUSINESS_TRUTH_REGISTRY)[number]["concept"];

export interface CapabilityTruthDefinition {
  capability: string;
  concepts: readonly BusinessConcept[];
}

function capabilityGroup(capabilities: readonly string[], concepts: readonly BusinessConcept[]): CapabilityTruthDefinition[] {
  return capabilities.map((capability) => ({ capability, concepts }));
}

/** Every user-facing action/query is attached to the fact registries it can read or
 * mutate. Kept executable so adding a plugin/query without truth ownership fails CI. */
export const BUSINESS_CAPABILITY_REGISTRY = [
  ...capabilityGroup(["create_lead", "update_lead_status", "assign_lead_to_technician"], ["lead", "customer"]),
  ...capabilityGroup(["log_interaction", "answer_customer_question", "send_customer_message", "send_follow_up", "create_review_request"], ["customer_communication", "communication_delivery", "customer"]),
  ...capabilityGroup(["schedule_water_test", "start_water_test_workflow"], ["appointment", "service_visit", "customer"]),
  ...capabilityGroup(["assign_technician_to_visit", "reschedule_visit", "log_visit_report", "flag_visit_issue", "route_suggestion"], ["service_visit", "technician"]),
  ...capabilityGroup(["check_technician_availability"], ["technician", "appointment", "internal_event"]),
  ...capabilityGroup(["renew_maintenance_agreement"], ["maintenance_agreement", "communication_delivery"]),
  ...capabilityGroup(["check_stock_level", "flag_reorder_needed"], ["inventory_item", "warehouse_stock"]),
  ...capabilityGroup(["log_stock_used_on_visit"], ["inventory_item", "warehouse_stock", "service_visit"]),
  ...capabilityGroup(["size_equipment_for_household", "check_reminder_due"], ["equipment"]),
  ...capabilityGroup(["generate_quote"], ["quote", "customer"]),
  ...capabilityGroup(["send_proposal", "request_proposal_signature"], ["proposal", "communication_delivery", "external_business_operation"]),
  ...capabilityGroup(["send_proposal_to_recent_installs"], ["proposal", "service_visit", "communication_delivery"]),
  ...capabilityGroup(["start_installation_workflow"], ["quote", "work_order", "invoice", "inventory_item", "operating_work"]),
  ...capabilityGroup(["create_invoice", "send_payment_reminder", "call_overdue_invoices"], ["invoice", "customer", "communication_delivery"]),
  ...capabilityGroup(["record_payment"], ["invoice", "payment"]),
  ...capabilityGroup(["start_invoice_to_cash_workflow"], ["invoice", "payment", "operating_work"]),
  ...capabilityGroup(["summarize_ad_performance", "launch_ad_campaign", "bulk_notify_existing_customers"], ["external_business_operation", "communication_delivery"]),
  ...capabilityGroup(["answer_water_question"], ["business_research"]),
  ...capabilityGroup(["generate_compliance_summary"], ["business_document", "customer"]),
  ...capabilityGroup(["search_web", "scan_competitors", "check_business_reviews"], ["business_research"]),
  ...capabilityGroup(["get_business_overview", "answer_business_question", "clarification_request", "manual_step_suggestion"], ["operating_work"]),
  ...capabilityGroup(["send_message", "place_call", "notify_group"], ["communication_delivery", "customer_communication"]),
  ...capabilityGroup(["request_acknowledgement"], ["communication_delivery", "delegation"]),
  ...capabilityGroup(["create_task", "assign_task", "update_task"], ["task"]),
  ...capabilityGroup(["handoff_work"], ["operating_work", "employee"]),
  ...capabilityGroup(["delegate_objective", "escalate_work", "cancel_delegation"], ["delegation", "task", "operating_work"]),
  ...capabilityGroup(["schedule_internal_event", "reschedule_internal_event"], ["internal_event"]),
  ...capabilityGroup(["share_document"], ["business_document"]),
  ...capabilityGroup(["computer_task"], ["external_business_operation", "company_configuration"]),
  ...capabilityGroup(["customer_lookup", "customer_cohort"], ["customer", "customer_communication"]),
  ...capabilityGroup(["schedule_range"], ["appointment", "service_visit", "internal_event"]),
  ...capabilityGroup(["money_summary"], ["invoice", "payment"]),
  ...capabilityGroup(["work_list", "agent_activity", "business_state"], ["operating_work"]),
  ...capabilityGroup(["inventory_status"], ["inventory_item", "warehouse_stock"]),
  ...capabilityGroup(["company_context"], ["company_configuration"]),
  ...capabilityGroup(["party_lookup", "party_context"], ["employee", "customer", "company_configuration"]),
  ...capabilityGroup(["team_roster"], ["employee", "company_configuration"]),
  ...capabilityGroup(["party_availability"], ["employee", "technician", "appointment", "internal_event"]),
] as const satisfies readonly CapabilityTruthDefinition[];

const CAPABILITY_TRUTH_BY_NAME = new Map(BUSINESS_CAPABILITY_REGISTRY.map((entry) => [entry.capability, entry] as const));

export function getBusinessTruthForCapability(capability: string): readonly BusinessTruthDefinition[] {
  const ownership = CAPABILITY_TRUTH_BY_NAME.get(capability);
  if (!ownership) throw new Error(`No Business Truth ownership is registered for capability: ${capability}`);
  return ownership.concepts.map((concept) => getBusinessTruth(concept));
}

export function getBusinessTruth(concept: BusinessConcept): (typeof BUSINESS_TRUTH_REGISTRY)[number] {
  const definition = BUSINESS_TRUTH_REGISTRY.find((entry) => entry.concept === concept);
  if (!definition) throw new Error(`Unknown business truth concept: ${concept}`);
  return definition;
}

/** Fail-fast integrity check used by CI/release certification. */
export function validateBusinessTruthRegistry(): void {
  const concepts = new Set<string>();
  for (const rawDefinition of BUSINESS_TRUTH_REGISTRY) {
    const definition: BusinessTruthDefinition = rawDefinition;
    if (concepts.has(definition.concept)) throw new Error(`Duplicate business concept: ${definition.concept}`);
    concepts.add(definition.concept);
    if (definition.authoritativeModel.length === 0) throw new Error(`${definition.concept} has no authoritative model`);
    if (!definition.writableOwner) throw new Error(`${definition.concept} has no writable owner`);
    if (definition.mutations.length === 0) throw new Error(`${definition.concept} has no approved mutation boundary`);
    if (definition.identity.length === 0) throw new Error(`${definition.concept} has no identity rule`);
  }
  const capabilities = new Set<string>();
  for (const ownership of BUSINESS_CAPABILITY_REGISTRY) {
    if (capabilities.has(ownership.capability)) throw new Error(`Duplicate capability truth ownership: ${ownership.capability}`);
    capabilities.add(ownership.capability);
    if (ownership.concepts.length === 0) throw new Error(`${ownership.capability} has no business truth owner`);
    for (const concept of ownership.concepts) {
      if (!concepts.has(concept)) throw new Error(`${ownership.capability} references unknown business concept ${concept}`);
    }
  }
}
