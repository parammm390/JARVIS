// OpenAPI docs generated from the SAME Zod schemas that validate each route (§29):
// one source of truth, not two documents that can drift apart.

import { writeFileSync } from "node:fs";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SubmitInstructionSchema,
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
const SubmitCorrectionBodySchema = z.object({ receiptId: z.string().uuid(), correctedFact: z.string().min(1).max(2000) });

const doc = {
  openapi: "3.1.0",
  info: {
    title: "Finnor OS API",
    version: "0.1.0",
    description:
      "Multi-tenant AI orchestration API for water treatment dealers. All /api routes (except webhooks) require a Supabase bearer token; every response is tenant-scoped by RLS.",
  },
  paths: {
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
    "/api/actions/pending": {
      get: {
        summary: "List actions awaiting confirmation (filter=blocked for stuck items)",
        parameters: [{ name: "filter", in: "query", schema: { type: "string", enum: ["pending", "blocked"] } }],
        responses: { "200": { description: "Pending actions" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/actions/{id}/confirm": {
      post: {
        summary: "Approve a pending action — clears the confirmation gate and executes",
        requestBody: { content: { "application/json": { schema: s(ConfirmActionSchema) } } },
        responses: {
          "200": { description: "{result} or {status, idempotent:true} if already decided" },
          "403": { description: "Role cannot approve" },
          "404": { description: "Action not found" },
          "409": { description: "Not pending/needs_human_review" },
        },
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
        summary: "D1.T3 activity theater — merged action_log + workflow_step + call feed, forward-only (occurredAt,id) keyset cursor",
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
