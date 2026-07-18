// Finnor OS core schema (§7). Every tenant-scoped table carries tenant_id and gets RLS
// (see migrations/0000_init.sql — RLS lives in SQL, enforced at the database layer).

import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  vector,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { money, provenanceColumns, archivable } from "./columns";

// Everything Finnor owns lives in its own Postgres schema — this is what lets it
// share a database (e.g. an existing Supabase project's `public` schema already
// running a different app) with zero collision risk on table names.
export const finnorOsSchema = pgSchema("finnor_os");
const pgTable = finnorOsSchema.table;

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerPhone: text("owner_phone"),
  // IANA zone (e.g. "America/Chicago"). Drives voice-scheduling/business-hours logic;
  // defaults to the current target market's most common zone, never guessed per-request.
  timezone: text("timezone").notNull().default("America/Chicago"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["owner", "dispatcher", "technician"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  address: text("address").notNull(),
  contactInfo: jsonb("contact_info").notNull().default({}),
  waterProfile: jsonb("water_profile").notNull().default({}),
  // TCPA: bulk outreach filters on this — false means never contact promotionally.
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  type: text("type").notNull(),
  model: text("model"),
  installDate: timestamp("install_date", { withTimezone: true }),
  source: text("source", { enum: ["finnor", "competitor"] }).notNull().default("finnor"),
});

export const technicians = pgTable("technicians", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  contactInfo: jsonb("contact_info").notNull().default({}),
  availability: jsonb("availability").notNull().default({}),
});

export const serviceVisits = pgTable("service_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  technicianId: uuid("technician_id").references(() => technicians.id),
  type: text("type").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
});

export const maintenanceAgreements = pgTable("maintenance_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  cadence: text("cadence").notNull(),
  terms: jsonb("terms").notNull().default({}),
  status: text("status", { enum: ["active", "renewal_window", "renewal_sent", "renewed", "lapsed"] })
    .notNull()
    .default("active"),
  renewalDate: timestamp("renewal_date", { withTimezone: true }),
  // §2.6: the AMC renewal sequence's "wait" state, ported from Temporal's durable
  // timer to a periodically-ticked scan (scheduled-reminder.ts) — null until that
  // reminder has actually been sent.
  firstReminderSentAt: timestamp("first_reminder_sent_at", { withTimezone: true }),
  secondReminderSentAt: timestamp("second_reminder_sent_at", { withTimezone: true }),
});

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  content: jsonb("content").notNull().default({}),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // Nullable: proposals predating the quotes table have no quote to point to.
  quoteId: uuid("quote_id"),
});

export const communicationsLog = pgTable("communications_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  channel: text("channel").notNull(),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const domainPolicies = pgTable(
  "domain_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actionType: text("action_type").notNull(),
    policy: jsonb("policy").notNull().default({}),
    requiresConfirmation: boolean("requires_confirmation").notNull().default(true),
    confirmationTemplate: text("confirmation_template"),
    modelProvider: text("model_provider"),
    // §2.8: how long a gated action may sit "pending" before scan_approval_expiry
    // escalates it to needs_human_review. Null = the application-level default (24h)
    // applies — never a fabricated per-row guess.
    confirmationTimeoutHours: integer("confirmation_timeout_hours"),
    // §3.1: bumped whenever this row's policy/requiresConfirmation config changes —
    // what decision_receipts.policy_applied.version actually cites (previously always
    // null, migration 0023).
    version: integer("version").notNull().default(1),
  },
  (t) => [index("domain_policies_tenant_action_idx").on(t.tenantId, t.actionType)],
);

export const domainActions = pgTable(
  "domain_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actionType: text("action_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    policyId: uuid("policy_id").references(() => domainPolicies.id),
    status: text("status", {
      enum: [
        "draft",
        "pending",
        "approved",
        "rejected",
        "executing",
        "completed",
        "failed",
        "needs_human_review",
        "blocked_integration_unavailable",
      ],
    })
      .notNull()
      .default("draft"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    executionStartedAt: timestamp("execution_started_at", { withTimezone: true }),
    // Phase 6 typed plan compiler (§6): populated once, right after the Planner's LLM
    // output is validated, before the row is ever gated or executed. Nullable — rows
    // created before this phase, and any row inserted by a path that bypasses the
    // compiler, simply have neither.
    groundedPayload: jsonb("grounded_payload"),
    compiledGraph: jsonb("compiled_graph"),
  },
  (t) => [index("domain_actions_tenant_status_idx").on(t.tenantId, t.status)],
);

// Episodic memory: append-only, never updated or deleted (§10, §19).
export const actionLog = pgTable(
  "action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainActionId: uuid("domain_action_id").notNull().references(() => domainActions.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    step: text("step").notNull(),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output").notNull().default({}),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("action_log_action_idx").on(t.domainActionId)],
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sourceDocId: text("source_doc_id"),
    // Additive alongside the loose sourceDocId text field above — new ingestion can
    // point here once a real documents row exists; sourceDocId stays for back-compat.
    documentId: uuid("document_id"),
    chunk: text("chunk").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [index("embeddings_tenant_idx").on(t.tenantId)],
);

// RBAC permission matrix — which roles can approve which action_types, per tenant (§18).
export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  role: text("role", { enum: ["owner", "dispatcher", "technician"] }).notNull(),
  actionType: text("action_type").notNull(),
  canApprove: boolean("can_approve").notNull().default(false),
});

// Postgres-backed job queue (§15–16). Not tenant-scoped: payloads carry tenant_id,
// workers re-establish tenant context per job.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "dead_letter"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    // Idempotency: callers may supply a key; enqueue is a no-op if it already exists.
    idempotencyKey: text("idempotency_key").unique(),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

export const apiRateLimits = pgTable("api_rate_limits", {
  bucketKey: text("bucket_key").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const webhookReceipts = pgTable("webhook_receipts", {
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const externalOperations = pgTable("external_operations", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  domainActionId: uuid("domain_action_id").notNull().references(() => domainActions.id),
  operationKey: text("operation_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status", { enum: ["running", "succeeded", "failed", "unknown"] }).notNull(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Workflow engine state machines (§14): explicit state + transition history per subject.
export const workflowStates = pgTable("workflow_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workflow: text("workflow").notNull(), // e.g. "lead_to_install", "amc_renewal"
  subjectType: text("subject_type").notNull(), // "household" | "maintenance_agreement"
  subjectId: uuid("subject_id").notNull(),
  state: text("state").notNull(),
  history: jsonb("history").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sandbox outbox: real, observable record of every outbound comm while carriers are
// not yet connected. The console's Communications view reads this.
export const sandboxOutbox = pgTable("sandbox_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  channel: text("channel", { enum: ["sms", "call", "email"] }).notNull(),
  toNumber: text("to_number").notNull(),
  content: text("content").notNull(),
  simulated: boolean("simulated").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Native inventory ledger — Finnor is the system of record, no external SaaS.
export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(0),
  reorderThreshold: integer("reorder_threshold").notNull().default(0),
  unitCostUsd: money("unit_cost_usd"),
});

// Native accounting ledger.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  amountUsd: money("amount_usd").notNull(),
  status: text("status", { enum: ["draft", "sent", "paid", "overdue", "void"] }).notNull().default("draft"),
  memo: text("memo"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Proactive scan findings (§14 extension): a staging area for scans with no natural
// mutating action to draft into (low inventory, service-due) — the owner digest job
// reads undigested rows, speaks/logs them, marks them digested.
export const scanFindings = pgTable("scan_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  scanType: text("scan_type").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  digestedAt: timestamp("digested_at", { withTimezone: true }),
  // Phase 12 (loop closure): severity feeds risk tiering, draftedActionId links a
  // finding to the gated action it caused a config-gated scan to draft (null when the
  // scan only recorded a finding — no config, or the scan has no drafting path at all).
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  draftedActionId: uuid("drafted_action_id").references(() => domainActions.id),
});

// ---------------------------------------------------------------------------
// Canonical business data platform (Phase 1, docs/jarvis-90-execution-blueprint.md §1).
// Every table below: direct tenant_id RLS (see migrations/0008), archivable, and
// provenance columns where the entity can originate from an import. `households`
// remains the de facto customer/account entity (renaming it is out of scope — too
// much blast radius); these tables add the canonical layer around it instead of
// replacing it. Writes to these tables should go through @finnor/data-platform,
// not raw inserts from a plugin.
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").references(() => households.id),
  name: text("name").notNull(),
  role: text("role"), // e.g. "primary", "spouse", "billing" — free text, not enforced
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactMethods = pgTable(
  "contact_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    methodType: text("method_type", { enum: ["phone", "email", "sms"] }).notNull(),
    value: text("value").notNull(),
    consent: boolean("consent").notNull().default(false),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("contact_methods_contact_value_idx").on(t.contactId, t.methodType, t.value)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    // Nullable at the schema level (a lead need not eagerly own a household), but the
    // crm plugin populates this immediately today — see packages/data-platform/src/leads.ts
    // for the documented dual-write compromise.
    householdId: uuid("household_id").references(() => households.id),
    contactMethodId: uuid("contact_method_id").references(() => contactMethods.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    status: text("status", {
      enum: ["new", "contacted", "qualified", "disqualified", "converted"],
    })
      .notNull()
      .default("new"),
    disqualifyReason: text("disqualify_reason"),
    source: text("source"), // e.g. "voice", "web", "referral"
    notes: text("notes"),
    ...archivable(),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("leads_tenant_source_external_idx").on(t.tenantId, t.sourceSystem, t.externalId)],
);

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id").references(() => leads.id),
  householdId: uuid("household_id").references(() => households.id),
  pipelineStage: text("pipeline_stage", { enum: ["open", "quote_sent", "won", "lost"] })
    .notNull()
    .default("open"),
  expectedValueUsd: money("expected_value_usd"),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  lostReason: text("lost_reason"),
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generic task tracker — mirrors workflow_states' subjectType/subjectId polymorphic
// pattern so a task can hang off any entity (a lead, a work order, an invoice, ...).
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  assigneeType: text("assignee_type", { enum: ["user", "technician"] }),
  assigneeId: uuid("assignee_id"),
  status: text("status", { enum: ["open", "done", "cancelled"] }).notNull().default("open"),
  priority: text("priority", { enum: ["low", "normal", "high"] }).notNull().default("normal"),
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Also polymorphic subject (a lead's water-test hold, a work order's install slot, ...).
export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  technicianId: uuid("technician_id").references(() => technicians.id),
  status: text("status", {
    enum: ["hold", "confirmed", "completed", "canceled", "no_show"],
  })
    .notNull()
    .default("hold"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes"),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  notes: text("notes"),
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const technicianCapacity = pgTable("technician_capacity", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  technicianId: uuid("technician_id").notNull().references(() => technicians.id),
  dayOfWeek: integer("day_of_week"), // 0=Sunday..6=Saturday, nullable = every day
  startTime: text("start_time"), // "HH:MM", 24h
  endTime: text("end_time"),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(1),
  serviceRadiusMiles: integer("service_radius_miles"),
  ...archivable(),
});

export const priceBookItems = pgTable(
  "price_book_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sku: text("sku").notNull(),
    label: text("label").notNull(),
    priceUsd: money("price_usd").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull().default("each"),
    ...archivable(),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("price_book_items_tenant_sku_idx").on(t.tenantId, t.sku)],
);

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").references(() => households.id),
  leadId: uuid("lead_id").references(() => leads.id),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id),
  status: text("status", { enum: ["draft", "sent", "accepted", "declined", "expired"] })
    .notNull()
    .default("draft"),
  totalUsd: money("total_usd"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteLineItems = pgTable("quote_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  sku: text("sku"), // nullable — a custom line item (e.g. labor) need not map to a SKU
  label: text("label").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceUsd: money("unit_price_usd").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// New, distinct from service_visits (which stays as-is for recurring service calls) —
// install/repair jobs need deposit + stock-reservation fields service_visits has no room for.
export const workOrders = pgTable("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  type: text("type", { enum: ["install", "repair", "warranty", "other"] }).notNull(),
  status: text("status", {
    enum: ["draft", "scheduled", "in_progress", "completed", "canceled"],
  })
    .notNull()
    .default("draft"),
  technicianId: uuid("technician_id").references(() => technicians.id),
  depositAmountUsd: money("deposit_amount_usd"),
  stockReservation: jsonb("stock_reservation").notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Distinct from invoices.status — a real record of each payment event/method.
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  amountUsd: money("amount_usd").notNull(),
  method: text("method", { enum: ["card", "ach", "check", "cash", "other"] })
    .notNull()
    .default("other"),
  status: text("status", { enum: ["pending", "succeeded", "failed", "refunded"] })
    .notNull()
    .default("succeeded"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generalizes inventory_items (single-location-per-tenant, unchanged, stays the default)
// for multi-location stock + reorder tracking. Consolidation is future work.
export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  address: text("address"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const warehouseStock = pgTable(
  "warehouse_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull().default(0),
    unitOfMeasure: text("unit_of_measure").notNull().default("each"),
    reorderThreshold: integer("reorder_threshold").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("warehouse_stock_warehouse_sku_idx").on(t.warehouseId, t.sku)],
);

export const procurementOrders = pgTable("procurement_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
  sku: text("sku").notNull(),
  quantityOrdered: integer("quantity_ordered").notNull(),
  status: text("status", { enum: ["draft", "ordered", "received", "canceled"] })
    .notNull()
    .default("draft"),
  expectedAt: timestamp("expected_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Persists what communications_log/sandbox_outbox never captured: a queryable,
// permanent record of calls/messages, replacing the old "transcript embedded once in
// jobs.payload, then discarded" pattern in webhooks/vapi/route.ts.
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").references(() => households.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  channel: text("channel", { enum: ["voice", "sms", "email", "webchat"] }).notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    transcript: text("transcript"),
    recordingUrl: text("recording_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    raw: jsonb("raw").notNull().default({}),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("calls_tenant_source_external_idx").on(t.tenantId, t.sourceSystem, t.externalId)],
);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  channel: text("channel").notNull(),
  content: text("content").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Canonical document entity; embeddings.documentId (added above) can point here.
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").references(() => households.id),
  kind: text("kind").notNull(), // e.g. "proposal_pdf", "invoice_pdf", "compliance_report"
  title: text("title").notNull(),
  storageRef: text("storage_ref"), // URL or storage key; no ingestion pipeline this phase
  ...archivable(),
  ...provenanceColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Real queryable cross-entity timeline — distinct from action_log (requires a non-null
// domain_action_id, so it structurally can't represent an imported row or a data-quality
// resolution) and scan_findings (a transient "digest once" staging queue, not history).
export const businessEvents = pgTable(
  "business_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source"), // which system/action produced this event
  },
  (t) => [
    index("business_events_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("business_events_type_time_idx").on(t.tenantId, t.eventType, t.occurredAt),
  ],
);

// Its own table, not a scan_findings reuse — scan_findings is a one-way "digest once"
// contract; data-quality findings need an open/resolved lifecycle and re-surfacing.
export const dataQualityFindings = pgTable(
  "data_quality_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    findingType: text("finding_type", {
      enum: ["duplicate_candidate", "missing_critical_field", "stale_data", "ambiguous_match"],
    }).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    relatedEntityId: uuid("related_entity_id"),
    details: jsonb("details").notNull().default({}),
    severity: text("severity", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("data_quality_findings_unresolved_idx").on(t.tenantId, t.resolvedAt)],
);

// ---------------------------------------------------------------------------
// Durable execution runtime (Phase 2, docs/jarvis-90-execution-blueprint.md §3).
// Command/step lifecycle mirrors domainActions' proven atomic
// UPDATE...WHERE status=<expected> concurrency boundary (see runAction()/decide() in
// packages/orchestration/src/index.ts). Step execution is driven through the existing
// Postgres job queue (apps/worker/src/queue.ts) — workflow_steps' own lease_expires_at
// is an additional, finer-grained atomic claim on top of the job-level lease, not a
// second queue system. workflowStates (the existing 2-workflow business-state tracker)
// is untouched — it answers "what business stage is this," while workflow_runs/
// workflow_steps is durable execution scaffolding (leases, attempts, evidence).
// ---------------------------------------------------------------------------

export const commands = pgTable(
  "commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    commandType: text("command_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    requestedBy: text("requested_by"),
    // Created already-approved — approval happens upstream of this runtime.
    status: text("status", { enum: ["approved", "running", "completed", "failed"] })
      .notNull()
      .default("approved"),
    // §2.4: finishes the Phase-16(e) correlationId thread into the durable runtime —
    // forwarded from the originating DomainAction/TenantContext, so every receipt this
    // command's steps produce is greppable back to the request that caused it.
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("commands_tenant_idempotency_idx").on(t.tenantId, t.idempotencyKey)],
);

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commandId: uuid("command_id").notNull().references(() => commands.id),
  workflowType: text("workflow_type").notNull(),
  status: text("status", {
    enum: ["running", "completed", "failed", "compensating", "compensated", "paused", "cancelled", "escalated"],
  })
    .notNull()
    .default("running"),
  // §2.7: optimistic concurrency for run controls (pause/resume/cancel/retry/escalate)
  // — every status-changing UPDATE (here and in advanceWorkflow) increments this, and
  // callers condition their UPDATE on the version they last read so two concurrent
  // control calls can't both believe they made the transition.
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    stepType: text("step_type").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status", {
      enum: ["pending", "leased", "completed", "failed", "compensating", "compensated"],
    })
      .notNull()
      .default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    evidence: jsonb("evidence").notNull().default({}),
    terminalReason: text("terminal_reason"),
    payload: jsonb("payload").notNull().default({}),
    // §2.4: denormalized copy of the parent command's correlationId — lets receipts.ts
    // read it straight off the step row with no join, same convention as tenantId.
    correlationId: text("correlation_id"),
    // §2.8 finding: the §2.5 runtime bridge's single-action steps originate from a
    // gated domain_action but had no way to link a receipt back to it — this is that
    // link, set only for steps the runtime bridge creates (workflow-kind commands
    // have no single originating domain_action, so it stays null for those).
    domainActionId: uuid("domain_action_id").references(() => domainActions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workflow_steps_run_sequence_idx").on(t.workflowRunId, t.sequence)],
);

// Generalizes external_operations (packages/tools/src/idempotent-call.ts) from being
// keyed by domain_action_id to being keyed by workflow_step_id — same claim/reclaim
// logic, one level up in the new runtime.
export const integrationOperations = pgTable(
  "integration_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    workflowStepId: uuid("workflow_step_id").notNull().references(() => workflowSteps.id),
    operationKey: text("operation_key").notNull(),
    capability: text("capability").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed", "unknown"] }).notNull(),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("integration_operations_step_key_idx").on(t.workflowStepId, t.operationKey)],
);

// Side effects queued in the same transaction as the state change that produced them.
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status", { enum: ["pending", "delivering", "delivered", "unknown", "failed"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  // Envelope major version (§2.2b) — a relayer that doesn't recognize the version
  // rejects the event into dead_letters rather than guessing at an unknown payload shape.
  envelopeVersion: integer("envelope_version").notNull().default(1),
  // §2.3: jittered backoff delay + last classified failure kind. next_attempt_at is
  // NULL for a never-yet-attempted row (immediately claimable).
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastErrorKind: text("last_error_kind"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

// Inbound provider events, deduplicated by (provider, event_id) — unlike
// webhookReceipts (transport-level dedup only, insert-once, no status column), this
// additionally tracks whether the event was matched and applied to an open
// workflow_step, or needs a reconciliation_case.
export const inboxEvents = pgTable(
  "inbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    matchedStepId: uuid("matched_step_id").references(() => workflowSteps.id),
    status: text("status", { enum: ["received", "matched", "unmatched", "duplicate"] })
      .notNull()
      .default("received"),
    envelopeVersion: integer("envelope_version").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("inbox_events_provider_event_idx").on(t.provider, t.eventId)],
);

// Opened automatically when an outbox event's delivery is unknown after retries
// exhaust, or an inbox event can't be matched to an open step.
export const reconciliationCases = pgTable("reconciliation_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  caseType: text("case_type", { enum: ["unknown_delivery", "unmatched_inbox_event"] }).notNull(),
  relatedOutboxEventId: uuid("related_outbox_event_id").references(() => outboxEvents.id),
  relatedInboxEventId: uuid("related_inbox_event_id").references(() => inboxEvents.id),
  relatedStepId: uuid("related_step_id").references(() => workflowSteps.id),
  details: jsonb("details").notNull().default({}),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// Opened when a step must be undone; records whether the compensation succeeded.
export const compensationCases = pgTable("compensation_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workflowStepId: uuid("workflow_step_id").notNull().references(() => workflowSteps.id),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// Phase 2 (JARVIS 95% MAESTRO PACK §2.2): one receipt per executed action — created at
// proposal time (before the step's external effect runs), finalized with
// actualResult/failure at completion. Answers "what did I intend, what evidence did I
// use, what policy allowed it, who approved it, what actually happened, how do we
// recover" in one row. `workflowStepId` is unique — a step has exactly one receipt,
// finalized in place, never a second row per retry (attempts already live on the step).
export const decisionReceipts = pgTable(
  "decision_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
    domainActionId: uuid("domain_action_id").references(() => domainActions.id),
    objective: text("objective").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
    policyApplied: jsonb("policy_applied"),
    riskTier: text("risk_tier", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
    proposedAction: jsonb("proposed_action").notNull().default({}),
    approval: jsonb("approval").notNull().default({ required: false }),
    expectedResult: jsonb("expected_result"),
    actualResult: jsonb("actual_result"),
    failure: jsonb("failure"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [
    unique("decision_receipts_step_idx").on(t.workflowStepId),
    index("decision_receipts_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

// Phase 2 (§2.3): terminal outbox/step failures land here instead of silently vanishing
// into a generic reconciliation_case — a queryable, replayable row an owner can act on.
// Distinct from jobs.status='dead_letter' (apps/worker/src/queue.ts), which is the
// generic job-queue's own retry-exhaustion marker for ANY job type; this table is
// specifically the durable-runtime's external-effect DLQ (outbox dispatch + workflow
// steps), matching the pack's §2.3 shape exactly so replay can reuse the idempotency key.
export const deadLetters = pgTable(
  "dead_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    relatedOutboxEventId: uuid("related_outbox_event_id").references(() => outboxEvents.id),
    relatedWorkflowStepId: uuid("related_workflow_step_id").references(() => workflowSteps.id),
    envelope: jsonb("envelope").notNull(),
    errorKind: text("error_kind", {
      enum: ["retryable", "terminal", "conflict", "auth", "validation", "provider_down"],
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error").notNull(),
    replayable: boolean("replayable").notNull().default(true),
    status: text("status", { enum: ["open", "replayed", "discarded"] }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("dead_letters_tenant_status_idx").on(t.tenantId, t.status)],
);

// ---------------------------------------------------------------------------
// Voice OS (Phase 5, docs/jarvis-90-execution-blueprint.md §5). Replaces
// webhooks/vapi/route.ts's hardcoded owner identity and its "confirm the newest
// pending domain_actions tenant-wide" heuristic with real caller resolution and a
// confirmation bound to the specific action a session's own instruction drafted.
// ---------------------------------------------------------------------------

export const voiceIdentities = pgTable(
  "voice_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    phoneNumber: text("phone_number").notNull(),
    matchedHouseholdId: uuid("matched_household_id").references(() => households.id),
    matchedUserId: uuid("matched_user_id").references(() => users.id),
    role: text("role", { enum: ["owner", "dispatcher", "technician", "customer", "unknown"] })
      .notNull()
      .default("unknown"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("voice_identities_tenant_phone_idx").on(t.tenantId, t.phoneNumber)],
);

export const voiceSessions = pgTable("voice_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  callExternalId: text("call_external_id").notNull().unique(),
  voiceIdentityId: uuid("voice_identity_id").references(() => voiceIdentities.id),
  channel: text("channel").notNull().default("vapi"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: text("status", { enum: ["active", "ended"] }).notNull().default("active"),
});

export const voiceTurns = pgTable(
  "voice_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["caller", "assistant"] }).notNull(),
    transcriptText: text("transcript_text").notNull(),
    resolvedActionIds: jsonb("resolved_action_ids").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("voice_turns_session_sequence_idx").on(t.voiceSessionId, t.sequence)],
);

// The row finnor_confirm resolves against — binds a spoken yes/no to the exact
// domain_action this session's own finnor_instruct drafted, not "whatever is newest."
export const pendingConfirmations = pgTable("pending_confirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
  domainActionId: uuid("domain_action_id").notNull().references(() => domainActions.id),
  promptText: text("prompt_text").notNull(),
  status: text("status", { enum: ["awaiting", "confirmed", "rejected", "expired"] })
    .notNull()
    .default("awaiting"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const handoffs = pgTable("handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
  reason: text("reason").notNull(),
  toRole: text("to_role"),
  toUserId: uuid("to_user_id").references(() => users.id),
  status: text("status", { enum: ["open", "acknowledged", "resolved"] }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// Resolves which tenant a Vapi call belongs to from the DIALED number. Not
// tenant-scoped, no RLS (same convention as `jobs`) — looked up during tenant
// *resolution*, before tenant_id is known. Uniques are GLOBAL: one dialed number
// resolves to exactly one tenant.
export const tenantPhoneNumbers = pgTable("tenant_phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  phoneNumber: text("phone_number").notNull().unique(),
  vapiPhoneNumberId: text("vapi_phone_number_id").unique(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
