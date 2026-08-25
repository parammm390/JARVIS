// OpenAPI docs generated from the SAME Zod schemas that validate each route (§29):
// one source of truth, not two documents that can drift apart.

import { writeFileSync } from "node:fs";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SubmitInstructionSchema,
  StartObjectiveSchema,
  ControlObjectiveSchema,
  HandoffWorkSchema,
  StartOutcomePackSchema,
  CreateAutonomyGrantSchema,
  RevokeAutonomyGrantSchema,
  SetOutcomePackEnabledSchema,
  ConfirmActionSchema,
  RejectActionSchema,
  EscalateActionSchema,
  UpsertPolicySchema,
  VapiWebhookSchema,
  GhlWebhookSchema,
} from "@finnor/policy-schema";

const s = (schema: Parameters<typeof zodToJsonSchema>[0]) =>
  zodToJsonSchema(schema, { $refStrategy: "none" });

// C1.T1: these two route-local zod schemas aren't exported from @finnor/policy-schema
// (they're small, one-off body shapes defined inline in their own route files) — mirrored
// here verbatim rather than exported solely for doc generation, matching this repo's
// existing convention of route-local validation for narrow, single-use bodies.
const RunControlBodySchema = z.object({ expectedVersion: z.number().int().nonnegative() });
const CompensationBodySchema = z.object({ reason: z.string().trim().min(3).max(2_000) });
const SubmitCorrectionBodySchema = z.object({ receiptId: z.string().uuid(), correctedFact: z.string().min(1).max(2000) });
const RetryWorkBodySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });
const RetryOperationBodySchema = z.object({ recoveryKey: z.string().min(1).max(200) });
const BeginGoogleConnectionBodySchema = z.object({
  authProfileRef: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,126}[a-z0-9]$/),
  redirectUri: z.string().url().optional(),
}).strict();

// Upgrade 3: the typed operational-query request is intentionally mirrored here
// as a strict discriminated union. Tenant identity is never part of this schema;
// the authenticated request context supplies it to the canonical executor.
const OperationalQueryPageSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
const OperationalQueryRangeSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
}).strict();
const OperationalQueryWorkSchema = z.object({
  workId: z.string().uuid().optional(),
  executionKey: z.string().min(1).max(200).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
const PartyRefSchema = z.object({
  partyType: z.enum(["employee", "team", "location", "household", "contact", "external_organization", "external_contact"]),
  partyId: z.string().uuid(),
}).strict();
const TeamRefSchema = z.object({
  partyType: z.literal("team"),
  partyId: z.string().uuid(),
}).strict();
const PartyLocalDateRangeSchema = z.object({
  startDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/),
  endDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/).optional(),
}).strict();
const OperationalQueryRequestSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("customer_lookup"),
    householdId: z.string().uuid().optional(),
    query: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    contact: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(200).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("customer_cohort"),
    cohort: z.literal("inactive"),
    minDaysInactive: z.number().int().min(1).max(3650),
    asOf: z.string().datetime({ offset: true }).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("schedule_range"),
    range: OperationalQueryRangeSchema.optional(),
    localDateRange: z.object({
      startDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/),
      endDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/).optional(),
    }).strict().optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("money_summary"),
    range: OperationalQueryRangeSchema.optional(),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("work_list"),
    section: z.enum(["all", "works", "work_orders", "tasks"]).optional(),
    openOnly: z.boolean().optional(),
    statuses: z.array(z.string().min(1).max(80)).max(20).optional(),
    recordId: z.string().uuid().optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("inventory_status"),
    sku: z.string().trim().min(1).max(120).optional(),
    lowStockOnly: z.boolean().optional(),
    includeOpenProcurement: z.boolean().optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("agent_activity"),
    range: OperationalQueryRangeSchema.optional(),
    localDateRange: z.object({
      startDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/),
      endDate: z.string().regex(/^(?:today|tomorrow|\d{4}-\d{2}-\d{2})$/).optional(),
    }).strict().optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("business_state"),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("company_context"),
    anchor: z.union([
      z.object({
        entityType: z.enum(["household","contact","user","technician","equipment","service_visit","maintenance_agreement","lead","opportunity","quote","proposal","work_order","appointment","invoice","payment","conversation","call","message","communication","document","task","work","domain_action","workflow_run","workflow_step","business_operation","business_operation_target","decision_receipt","business_event","org_unit","tenant_location","external_organization","external_contact"]),
        entityId: z.string().uuid(),
      }).strict(),
      PartyRefSchema,
    ]).optional(),
    householdId: z.string().uuid().optional(),
    query: z.string().trim().min(1).max(300).optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("party_lookup"),
    ref: PartyRefSchema.optional(),
    query: z.string().trim().min(1).max(300).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("party_context"),
    ref: PartyRefSchema.optional(),
    query: z.string().trim().min(1).max(300).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("team_roster"),
    teamRef: TeamRefSchema.optional(),
    query: z.string().trim().min(1).max(300).optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
  z.object({
    intent: z.literal("party_availability"),
    ref: PartyRefSchema.optional(),
    query: z.string().trim().min(1).max(300).optional(),
    localDateRange: PartyLocalDateRangeSchema.optional(),
    includeCapacity: z.boolean().optional(),
    page: OperationalQueryPageSchema.optional(),
  }).merge(OperationalQueryWorkSchema),
]);
// Each discriminated-union branch owns the strict Work metadata fields. An
// intersection of two strict object schemas would emit an unsatisfiable
// allOf/additionalProperties:false contract because each side rejects the
// other's fields.
const OperationalQueryBodySchema = OperationalQueryRequestSchema;

const BusinessEffectResponseSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  semanticHash: z.string().regex(/^[0-9a-f]{64}$/),
  scopeHash: z.string().regex(/^[0-9a-f]{64}$/),
  operation: z.object({ name: z.string(), class: z.string(), external: z.boolean() }),
  targets: z.array(z.object({ kind: z.string(), type: z.string(), id: z.string(), sourcePath: z.string().optional() })),
  bindings: z.array(z.record(z.unknown())),
  before: z.array(z.record(z.unknown())),
  delta: z.object({ operation: z.string(), values: z.record(z.unknown()) }),
  expected: z.record(z.unknown()),
  authority: z.record(z.unknown()),
  approval: z.object({ required: z.boolean(), typedConfirmation: z.boolean(), summary: z.string() }),
  provenance: z.record(z.unknown()),
}).passthrough();
const PendingActionsResponseSchema = z.object({ actions: z.array(z.object({
  id: z.string().uuid(),
  actionType: z.string(),
  summary: z.string().nullable(),
  payload: z.record(z.unknown()),
  status: z.string(),
  businessEffect: BusinessEffectResponseSchema.nullable(),
  businessEffectStatus: z.string().nullable(),
}).passthrough()) });

const doc = {
  openapi: "3.1.0",
  info: {
    title: "Finnor OS API",
    version: "0.1.0",
    description:
      "Multi-tenant AI orchestration API for water treatment dealers. All /api routes (except webhooks) require a Supabase bearer token; every response is tenant-scoped by RLS.",
  },
  paths: {
    "/api/ready": {
      get: { summary: "Dependency readiness for database, migration head, worker fleet, and managed secrets", responses: { "200": { description: "Ready with exact release provenance" }, "503": { description: "A process-level dependency is not ready" } } },
    },
    "/api/connections/google/start": {
      post: {
        summary: "Start a governed Google OAuth connection using one-time state and PKCE",
        requestBody: { content: { "application/json": { schema: s(BeginGoogleConnectionBodySchema) } } },
        responses: { "200": { description: "Safe provider authorization URL and expiry; verifier remains HttpOnly" }, "400": { description: "Invalid or unsupported connection" }, "401": { description: "Bad auth" }, "403": { description: "Employee authority denied" } },
      },
    },
    "/api/connections/google/callback": {
      get: {
        summary: "Consume one Google OAuth callback and bind the verified provider account",
        parameters: [
          { name: "state", in: "query", required: true, schema: { type: "string" } },
          { name: "code", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "303": { description: "Redirect to the connection settings result" } },
      },
    },
    "/api/connections/{ref}": {
      get: {
        summary: "Read safe connection lifecycle status",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Safe status/scopes/timestamps without credential reference or token" }, "401": { description: "Bad auth" }, "404": { description: "Profile not found" } },
      },
      delete: {
        summary: "Revoke a governed connection locally and attempt provider revocation",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Local revocation is authoritative" }, "401": { description: "Bad auth" }, "403": { description: "Employee authority denied" } },
      },
    },
    "/api/connections/{ref}/verify": {
      post: {
        summary: "Run a bounded connection health verification",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Connection usable" }, "409": { description: "Connection degraded, expired, or requires reauthentication" } },
      },
    },
    // --- Proxy-reachable surface (src/app/api/jarvis/[...path]/route.ts's own
    // allowlist) — C1.T1 audited this against every real route.ts file this session,
    // not assumed from the old (9-path) version of this doc. Response bodies mostly
    // stay undocumented here (this codebase has no zod schemas for response shapes,
    // only request bodies) — src/lib/jarvis-client.ts fills that gap with response
    // types hand-verified against each route's actual source, not invented.
    "/api/stats": {
      get: { summary: "Pending/blocked counts + recent actions", responses: { "200": { description: "StatsResponse" }, "401": { description: "Bad auth" } } },
    },
    "/api/actions": {
      post: {
        summary: "Submit a new instruction (voice transcript or text)",
        requestBody: { content: { "application/json": { schema: s(SubmitInstructionSchema) } } },
        responses: { "201": { description: "Planned domain actions" }, "400": { description: "Invalid payload" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/threads": {
      get: {
        summary: "List the authenticated employee's private durable conversation threads",
        responses: { "200": { description: "Bounded Postgres thread summaries owned by the current employee" }, "401": { description: "Bad auth" }, "403": { description: "Canonical human principal required" } },
      },
      post: {
        summary: "Create a private durable conversation thread for the authenticated employee",
        responses: { "201": { description: "Canonical Postgres thread summary" }, "400": { description: "Invalid payload" }, "401": { description: "Bad auth" }, "403": { description: "Canonical human principal required" } },
      },
    },
    "/api/threads/{id}": {
      get: {
        summary: "Load one employee-owned thread and a bounded page of exact original messages",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
          { name: "beforeSequence", in: "query", schema: { type: "integer", minimum: 1 } },
        ],
        responses: { "200": { description: "Thread summary plus exact ordered messages" }, "401": { description: "Bad auth" }, "403": { description: "Canonical human principal required" }, "404": { description: "Thread absent or owned by another employee/tenant" } },
      },
    },
    "/api/objectives": {
      post: {
        summary: "Accept responsibility for one persistent, governed Work objective and queue its first bounded iteration",
        requestBody: { content: { "application/json": { schema: s(StartObjectiveSchema) } } },
        responses: { "202": { description: "Objective persisted and queued" }, "200": { description: "Idempotent replay of an existing objective" }, "400": { description: "Invalid objective or budget" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/outcome-packs": {
      get: {
        summary: "List the five certified outcome contracts, tenant operating state, and evidence-derived autonomy readiness",
        responses: { "200": { description: "Definitions, settings, certifications, active grants, and explicit readiness gates" }, "401": { description: "Bad auth" } },
      },
      post: {
        summary: "Accept responsibility for one versioned Outcome Pack on the existing durable Objective controller",
        requestBody: { content: { "application/json": { schema: s(StartOutcomePackSchema) } } },
        responses: { "202": { description: "Pack, Work, and Objective persisted and first iteration queued" }, "400": { description: "Invalid pack input or disabled pack" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/outcome-packs/grants": {
      get: {
        summary: "List tenant-scoped progressive-autonomy grants and their current status",
        responses: { "200": { description: "Current and historical exact-scope grants" }, "401": { description: "Bad auth" }, "403": { description: "Owner authority required" } },
      },
      post: {
        summary: "Create one narrow, expiring autonomy grant only after deterministic readiness passes",
        requestBody: { content: { "application/json": { schema: s(CreateAutonomyGrantSchema) } } },
        responses: { "201": { description: "Grant persisted" }, "400": { description: "Invalid scope or readiness not earned" }, "403": { description: "Owner authority required" } },
      },
    },
    "/api/outcome-packs/grants/{id}": {
      delete: {
        summary: "Revoke an autonomy grant and prevent all future uncommitted effects that depended on it",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { content: { "application/json": { schema: s(RevokeAutonomyGrantSchema) } } },
        responses: { "200": { description: "Grant revoked" }, "403": { description: "Owner authority required" }, "404": { description: "Grant not found in tenant" } },
      },
    },
    "/api/outcome-packs/control": {
      post: {
        summary: "Enable or disable an Outcome Pack; disabling pauses active runs and suspends grants",
        requestBody: { content: { "application/json": { schema: s(SetOutcomePackEnabledSchema) } } },
        responses: { "200": { description: "Tenant pack operating state updated" }, "403": { description: "Owner authority required" } },
      },
    },
    "/api/employees": {
      get: {
        summary: "List the authenticated tenant's employee directory for governed Work ownership and handoff",
        responses: {
          "200": { description: "{employees: [{id, displayName, status, roles, legacyRole}]}" },
          "401": { description: "Bad auth" },
        },
      },
    },
    "/api/queries": {
      post: {
        summary: "Execute one bounded deterministic operational query without invoking the planner",
        requestBody: { content: { "application/json": { schema: s(OperationalQueryBodySchema) } } },
        responses: {
          "200": { description: "Typed canonical PostgreSQL result with Work/execution metadata" },
          "400": { description: "Invalid or mismatched typed query request" },
          "401": { description: "Bad auth" },
        },
      },
    },
    "/api/dealer-zero/time-compression": {
      post: {
        summary: "Read-only, explicitly synthetic Dealer Zero time-compression script (owner-only)",
        responses: { "200": { description: "{demo:true, synthetic:true, frames} with optional real receipt ids" }, "403": { description: "Not an owner or not the Dealer Zero demo tenant" } },
      },
    },
    "/api/actions/pending": {
      get: {
        summary: "List actions awaiting confirmation (filter=blocked for stuck items)",
        parameters: [{ name: "filter", in: "query", schema: { type: "string", enum: ["pending", "blocked"] } }],
        responses: { "200": { description: "Pending actions with their exact frozen Business Effect", content: { "application/json": { schema: s(PendingActionsResponseSchema) } } }, "401": { description: "Bad auth" } },
      },
    },
    "/api/actions/{id}/confirm": {
      post: {
        summary: "Approve a pending action — executes bounded work or durably queues an associated business operation",
        requestBody: { content: { "application/json": { schema: s(ConfirmActionSchema) } } },
        responses: {
          "200": { description: "{result} or {status, idempotent:true} if already decided" },
          "403": { description: "Role cannot approve" },
          "404": { description: "Action not found" },
          "409": { description: "Not pending/needs_human_review" },
        },
      },
    },
    "/api/operations/{id}": {
      get: {
        summary: "Inspect a durable business operation, its frozen targets, per-target execution state, events, and receipt",
        responses: {
          "200": { description: "{operation: {operation, targets, events, receipt}}" },
          "401": { description: "Bad auth" },
          "404": { description: "Operation not found" },
        },
      },
    },
    "/api/operations/{id}/retry": {
      post: {
        summary: "Recover retryable, configuration, or human-review targets without replaying successful or policy-skipped targets",
        requestBody: { content: { "application/json": { schema: s(RetryOperationBodySchema) } } },
        responses: {
          "202": { description: "{result: {operationId, retried, duplicate, queued}, operation}" },
          "400": { description: "Invalid recovery key" },
          "403": { description: "Role cannot approve recovery" },
          "404": { description: "Operation not found" },
          "409": { description: "Operation has no recoverable targets or cannot be retried in its current state" },
        },
      },
    },
    "/api/computer/runs/{id}": {
      get: {
        summary: "Reconstruct one tenant-scoped computer run from safe durable run, step, and artifact metadata",
        responses: { "200": { description: "{run, steps, artifacts}; no provider/auth handles or artifact bytes" }, "404": { description: "Computer run not found" } },
      },
    },
    "/api/computer/runs/{id}/cancel": {
      post: {
        summary: "Request durable cancellation of an active computer run",
        responses: { "200": { description: "{run, cancellationRequested}" }, "403": { description: "Not the actor or an authorized approver" }, "404": { description: "Computer run not found" } },
      },
    },
    "/api/actions/{id}/reject": {
      post: {
        summary: "Reject a pending action — halts it permanently",
        requestBody: { content: { "application/json": { schema: s(RejectActionSchema) } } },
        responses: { "200": { description: "{status:'rejected'} or {status, idempotent:true}" }, "403": { description: "Role cannot decide" }, "404": { description: "Not found" } },
      },
    },
    "/api/actions/{id}/escalate": {
      post: {
        summary: "Flag a still-pending action as needing human review (not approve/reject)",
        requestBody: { content: { "application/json": { schema: s(EscalateActionSchema) } } },
        responses: {
          "200": { description: "{result} or {status:'needs_human_review', idempotent:true}" },
          "403": { description: "Role cannot decide" },
          "404": { description: "Not found" },
          "409": { description: "Not pending" },
        },
      },
    },
    "/api/workflows/runs": {
      get: {
        summary: "Live + recent-terminal workflow runs with steps",
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "{runs: WorkflowRun[]}" } },
      },
    },
    "/api/workflows/runs/{id}/pause": {
      post: {
        summary: "Pause a running workflow run (owner-only, optimistic concurrency)",
        requestBody: { content: { "application/json": { schema: s(RunControlBodySchema) } } },
        responses: { "200": { description: "{run}" }, "403": { description: "Not owner" }, "404": { description: "Not found" }, "409": { description: "Version conflict / illegal transition" } },
      },
    },
    "/api/workflows/runs/{id}/resume": {
      post: {
        summary: "Resume a paused workflow run",
        requestBody: { content: { "application/json": { schema: s(RunControlBodySchema) } } },
        responses: { "200": { description: "{run}" }, "403": { description: "Not owner" }, "404": { description: "Not found" }, "409": { description: "Version conflict / illegal transition" } },
      },
    },
    "/api/workflows/runs/{id}/cancel": {
      post: {
        summary: "Cancel a workflow run",
        requestBody: { content: { "application/json": { schema: s(RunControlBodySchema) } } },
        responses: { "200": { description: "{run}" }, "403": { description: "Not owner" }, "404": { description: "Not found" }, "409": { description: "Version conflict / illegal transition" } },
      },
    },
    "/api/workflows/runs/{id}/retry": {
      post: {
        summary: "Retry a failed workflow run",
        requestBody: { content: { "application/json": { schema: s(RunControlBodySchema) } } },
        responses: { "200": { description: "{run}" }, "403": { description: "Not owner" }, "404": { description: "Not found" }, "409": { description: "Version conflict / illegal transition" } },
      },
    },
    "/api/workflows/runs/{id}/escalate": {
      post: {
        summary: "Escalate a workflow run",
        requestBody: { content: { "application/json": { schema: s(RunControlBodySchema) } } },
        responses: { "200": { description: "{run}" }, "403": { description: "Not owner" }, "404": { description: "Not found" }, "409": { description: "Version conflict / illegal transition" } },
      },
    },
    "/api/workflows/steps/{id}/compensate": {
      post: {
        summary: "Compensate one completed workflow effect with its registered typed binding",
        requestBody: { content: { "application/json": { schema: s(CompensationBodySchema) } } },
        responses: { "200": { description: "Compensation succeeded or an existing successful case was returned" }, "400": { description: "Invalid reason" }, "403": { description: "Not authorized" }, "404": { description: "Step not found" }, "409": { description: "Illegal or unsupported compensation" }, "502": { description: "Compensation attempted and failed; case and receipt were preserved" } },
      },
    },
    "/api/events": {
      get: {
        summary: "business_events cross-entity timeline (backward `before` paging)",
        parameters: [
          { name: "entityType", in: "query", schema: { type: "string" } },
          { name: "entityId", in: "query", schema: { type: "string" } },
          { name: "before", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: { "200": { description: "{events: EventRow[]}" } },
      },
    },
    "/api/business-world": {
      get: {
        summary: "Bounded canonical Business World projection for one operating scene",
        parameters: [{ name: "scene", in: "query", required: true, schema: { type: "string", enum: ["customer", "schedule", "money", "work", "inventory", "computer"] } }],
        responses: { "200": { description: "{data: BusinessWorldProjection}" }, "400": { description: "Invalid scene" } },
      },
    },
    "/api/operational-deltas": {
      get: {
        summary: "Establish or replay a bounded tenant-scoped operational delta cursor",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 250 } },
        ],
        responses: { "200": { description: "OperationalDeltaPage" }, "400": { description: "Invalid cursor" }, "409": { description: "Cursor tenant scope mismatch" } },
      },
    },
    "/api/read-models/{view}": {
      get: {
        summary:
          "Named cross-entity read-model view (pipeline-health, technician-load, stock-risk, cash-collections, service-due, sla-breaches, follow-up-debt, data-quality, household-360, reliability, readiness, failure-injections)",
        responses: { "200": { description: "{view, data}" }, "404": { description: "Unknown view (or no such household for household-360)" } },
      },
    },
    "/api/comms": {
      get: { summary: "Outbox + communications history (native comms layer)", responses: { "200": { description: "{outbox, communications}" } } },
    },
    "/api/insights": {
      get: { summary: "Action-type failure/rejection stats + critic findings + unclear-confirmation phrasings", responses: { "200": { description: "Insights" } } },
    },
    "/api/setup/status": {
      get: { summary: "Dealer setup readiness + integration self-tests + env/binding posture", responses: { "200": { description: "SetupStatus" } } },
    },
    "/api/integrations/status": {
      get: { summary: "Real self-tests for every external integration (not just presence)", responses: { "200": { description: "IntegrationsStatus" } } },
    },
    "/api/resources/{kind}": {
      get: {
        summary: "Whitelisted table reads (households, inventory, invoices, technicians, visits, compliance-policy, workflows)",
        responses: { "200": { description: "{rows}" }, "404": { description: "Unknown resource kind" } },
      },
    },
    "/api/audit": {
      get: {
        summary: "Paginated, filterable audit log",
        parameters: [
          { name: "actionType", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "{entries, limit, offset}" }, "400": { description: "Invalid query" } },
      },
    },
    "/api/receipts": {
      get: {
        summary: "Look up decision receipts by domainActionId, workflowStepId, or workflowRunId",
        parameters: [
          { name: "domainActionId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "workflowStepId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "workflowRunId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "{receipts}" }, "400": { description: "None of the three ids provided" } },
      },
    },
    "/api/receipts/{id}": {
      get: { summary: "Full DecisionReceipt by id — the 'Why?' view", responses: { "200": { description: "{receipt}" }, "404": { description: "Not found" } } },
    },
    "/api/me": {
      get: { summary: "Caller's own userId/tenantId/role", responses: { "200": { description: "{userId, tenantId, role}" } } },
    },
    "/api/overview": {
      get: {
        summary: "Daily briefing (real receipted get_business_overview action, 5-minute cache unless ?refresh=1)",
        parameters: [{ name: "refresh", in: "query", schema: { type: "string", enum: ["1"] } }],
        responses: { "200": { description: "{domainActionId, receiptId?, cached, ...output}" }, "502": { description: "Briefing could not be generated" } },
      },
    },
    "/api/dlq": {
      get: {
        summary: "Dead-letter queue, owner-only",
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["open", "replayed", "discarded"] } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "{deadLetters}" }, "403": { description: "Not owner" } },
      },
    },
    "/api/dlq/{id}": {
      get: { summary: "Single dead-letter row, owner-only", responses: { "200": { description: "{deadLetter}" }, "403": { description: "Not owner" }, "404": { description: "Not found" } } },
    },
    "/api/dlq/{id}/replay": {
      post: {
        summary: "Re-enqueue a dead-lettered outbox event, owner-only",
        responses: { "200": { description: "{replayed:true}" }, "403": { description: "Not owner" }, "409": { description: "not_open / not_replayable / no_linked_outbox_event" }, "404": { description: "not_found" } },
      },
    },
    "/api/dlq/{id}/discard": {
      post: {
        summary: "Permanently give up on a dead-lettered event, owner-only",
        responses: { "200": { description: "{discarded:true}" }, "403": { description: "Not owner" }, "409": { description: "not_open" }, "404": { description: "not_found" } },
      },
    },
    "/api/corrections": {
      get: { summary: "List memory corrections (gated, owner default)", responses: { "200": { description: "{corrections}" }, "403": { description: "Role cannot view" } } },
      post: {
        summary: "Submit a correction to a past AI answer, receipt-linked",
        requestBody: { content: { "application/json": { schema: s(SubmitCorrectionBodySchema) } } },
        responses: { "201": { description: "{id}" }, "403": { description: "Role cannot submit" }, "404": { description: "Receipt not found" } },
      },
    },
    "/api/vitals": {
      get: {
        summary: "D1.T2 pulse bar — queue depth/oldest-pending age, worker heartbeat age, this tenant's open DLQ count, resolved capability bindings, per-scan-type last-run clocks",
        responses: { "200": { description: "{queue, heartbeat, dlq, bindings, scans}" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/activity": {
      get: {
        summary: "D1.T3 activity theater — merged action_log + workflow_step + computer_step + call feed, forward-only (occurredAt,id) keyset cursor",
        parameters: [
          { name: "since", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "{items, nextCursor, hasMore}" }, "400": { description: "Invalid query" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/policies/{tenantId}/{actionType}": {
      get: { summary: "Read a domain policy", responses: { "200": { description: "Policy" }, "404": { description: "Not configured" } } },
      put: {
        summary: "Create or update a domain policy (owner only)",
        requestBody: { content: { "application/json": { schema: s(UpsertPolicySchema) } } },
        responses: { "200": { description: "Saved policy" } },
      },
    },
    "/api/instructions/{id}": {
      get: {
        summary: "Read one tenant-scoped instruction trace session",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Instruction session" }, "401": { description: "Bad auth" }, "404": { description: "Instruction not found" } },
      },
    },
    "/api/instructions/{id}/events": {
      get: {
        summary: "Read new tenant-scoped instruction lifecycle events after a sequence number",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "after", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: { "200": { description: "Ordered instruction trace events" }, "400": { description: "Invalid after cursor" }, "401": { description: "Bad auth" }, "404": { description: "Instruction not found" } },
      },
    },
    "/api/works": {
      get: {
        summary: "List durable Work, optionally by session or active state",
        parameters: [
          { name: "sessionId", in: "query", schema: { type: "string" } },
          { name: "active", in: "query", schema: { type: "boolean" } },
        ],
        responses: { "200": { description: "{works: Work[]}" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/works/{id}": {
      get: {
        summary: "Read one Work with inputs, planner attempts, query executions, actions, approvals, workflow runs, receipts, recovery, and events",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Canonical durable Work aggregate" }, "401": { description: "Bad auth" }, "404": { description: "Work not found" } },
      },
    },
    "/api/works/{id}/execution": {
      get: {
        summary: "Read one bounded, tenant-scoped execution projection for a durable Work",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Presentation-safe action DAG, authority, workflow, computer, uncertainty, and receipt truth" }, "401": { description: "Bad auth" }, "404": { description: "Work not found" } },
      },
    },
    "/api/works/{id}/replay": {
      get: {
        summary: "Replay one Work's evidence-backed causal history without mutating operational state",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Bounded, privacy-safe trigger-to-outcome causal graph with explicit provenance gaps" }, "401": { description: "Bad auth" }, "404": { description: "Work not found" } },
      },
    },
    "/api/works/{id}/objective": {
      get: {
        summary: "Inspect one Work objective, its bounded iterations, observations, decisions, and planner attempts",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "Durable objective-loop audit" }, "401": { description: "Bad auth" }, "404": { description: "Work objective not found" } },
      },
      post: {
        summary: "Continue, interrupt, or redirect the same persistent Work objective",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { content: { "application/json": { schema: s(ControlObjectiveSchema) } } },
        responses: { "202": { description: "Continuation or redirect durably queued" }, "200": { description: "Objective interrupted" }, "400": { description: "Invalid control command" }, "404": { description: "Work objective not found" } },
      },
    },
    "/api/works/{id}/handoff": {
      post: {
        summary: "Transfer responsibility for the same durable Work to an active employee in the same tenant",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { content: { "application/json": { schema: s(HandoffWorkSchema) } } },
        responses: {
          "202": { description: "Work owner and authority context updated; employee_handoff event appended" },
          "200": { description: "Idempotent handoff to the existing owner" },
          "400": { description: "Inactive, missing, or foreign-tenant target employee" },
          "403": { description: "Only the current owner may hand off this Work" },
          "404": { description: "Work not found" },
          "409": { description: "Concurrent ownership change" },
        },
      },
    },
    "/api/works/{id}/retry": {
      post: {
        summary: "Retry failed Work through the ordinary planner with an idempotent recovery claim",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { content: { "application/json": { schema: s(RetryWorkBodySchema) } } },
        responses: { "201": { description: "Recovery planner result" }, "202": { description: "Duplicate retry still planning" }, "409": { description: "Work is not retryable" } },
      },
    },
    "/api/stream": {
      get: {
        summary: "Stream one instruction lifecycle as Server-Sent Events",
        parameters: [{ name: "instructionId", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "EventSource stream; each data frame is one instruction trace event" },
          "400": { description: "instructionId is missing" },
          "401": { description: "Bad auth" },
          "404": { description: "Instruction not found" },
        },
      },
    },
    // --- Not proxy-reachable from the frontend today (no entry in the jarvis proxy's
    // own allowlist) — documented for completeness/backend-direct use, same as before.
    "/api/webhooks/vapi": {
      post: {
        summary: "Vapi inbound call events (transcripts → Planner instructions)",
        requestBody: { content: { "application/json": { schema: s(VapiWebhookSchema) } } },
        responses: { "200": { description: "Received" } },
      },
    },
    "/api/webhooks/ghl": {
      post: {
        summary: "GoHighLevel CRM sync events",
        requestBody: { content: { "application/json": { schema: s(GhlWebhookSchema) } } },
        responses: { "200": { description: "Received" } },
      },
    },
  },
};

writeFileSync(new URL("../openapi.json", import.meta.url), JSON.stringify(doc, null, 2));
console.log("Wrote openapi.json");
