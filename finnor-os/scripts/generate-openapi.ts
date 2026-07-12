// OpenAPI docs generated from the SAME Zod schemas that validate each route (§29):
// one source of truth, not two documents that can drift apart.

import { writeFileSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SubmitInstructionSchema,
  ConfirmActionSchema,
  RejectActionSchema,
  UpsertPolicySchema,
  AuditQuerySchema,
  VapiWebhookSchema,
  GhlWebhookSchema,
} from "@finnor/policy-schema";

const s = (schema: Parameters<typeof zodToJsonSchema>[0]) =>
  zodToJsonSchema(schema, { $refStrategy: "none" });

const doc = {
  openapi: "3.1.0",
  info: {
    title: "Finnor OS API",
    version: "0.1.0",
    description:
      "Multi-tenant AI orchestration API for water treatment dealers. All /api routes (except webhooks) require a Supabase bearer token; every response is tenant-scoped by RLS.",
  },
  paths: {
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
        responses: { "200": { description: "Pending actions" }, "401": { description: "Bad auth" } },
      },
    },
    "/api/actions/{id}/confirm": {
      post: {
        summary: "Approve a pending action — clears the confirmation gate and executes",
        requestBody: { content: { "application/json": { schema: s(ConfirmActionSchema) } } },
        responses: { "200": { description: "Execution result" }, "403": { description: "Role cannot approve" }, "409": { description: "Not pending" } },
      },
    },
    "/api/actions/{id}/reject": {
      post: {
        summary: "Reject a pending action — halts it permanently",
        requestBody: { content: { "application/json": { schema: s(RejectActionSchema) } } },
        responses: { "200": { description: "Rejected" } },
      },
    },
    "/api/audit": {
      get: {
        summary: "Paginated, filterable audit log",
        parameters: [{ name: "actionType", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Audit entries", content: { "application/json": { schema: s(AuditQuerySchema) } } } },
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
    "/api/comms": {
      get: { summary: "Outbox + communications history (native comms layer)", responses: { "200": { description: "Outbox and communications entries" } } },
    },
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
