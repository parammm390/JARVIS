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
} from "drizzle-orm/pg-core";

// Everything Finnor owns lives in its own Postgres schema — this is what lets it
// share a database (e.g. an existing Supabase project's `public` schema already
// running a different app) with zero collision risk on table names.
export const finnorOsSchema = pgSchema("finnor_os");
const pgTable = finnorOsSchema.table;

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerPhone: text("owner_phone"),
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
});

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  content: jsonb("content").notNull().default({}),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
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
    // Idempotency: callers may supply a key; enqueue is a no-op if it already exists.
    idempotencyKey: text("idempotency_key").unique(),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

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
  unitCostUsd: text("unit_cost_usd"),
});

// Native accounting ledger.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  householdId: uuid("household_id").notNull().references(() => households.id),
  amountUsd: text("amount_usd").notNull(),
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
});
