// Zod schemas for DomainPolicy / DomainAction — the config-over-code contract (§13, §29 blueprint).
// Business rule CONTENT never lives here; only its shape does.

import { z } from "zod";

export const RoleSchema = z.enum(["owner", "dispatcher", "technician"]);

export const DomainActionStatusSchema = z.enum([
  "draft",
  "pending",
  "approved",
  "rejected",
  "executing",
  "completed",
  "failed",
  "needs_human_review",
  "blocked_integration_unavailable",
]);

export const DomainPolicySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actionType: z.string().min(1),
  policy: z.record(z.unknown()),
  requiresConfirmation: z.boolean(),
  confirmationTemplate: z.string().nullable(),
  modelProvider: z.string().optional(),
  // §2.8: hours a gated action may sit "pending" before scan_approval_expiry
  // escalates it to needs_human_review — never auto-approved, never auto-rejected.
  // Unset means the application default (24h) applies.
  confirmationTimeoutHours: z.number().int().positive().nullable().optional(),
  // §3.1: what decision_receipts.policy_applied.version cites. Real rows start at 1
  // (migration 0023's column default) — never a fabricated per-row guess.
  version: z.number().int().nonnegative(),
});
export type DomainPolicyInput = z.infer<typeof DomainPolicySchema>;

export const DomainActionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actionType: z.string().min(1),
  payload: z.record(z.unknown()),
  policyId: z.string().uuid().nullable(),
  status: DomainActionStatusSchema,
  createdAt: z.string(),
});
export type DomainActionInput = z.infer<typeof DomainActionSchema>;

// ---- API boundary schemas (every route validates with these) ----

export const SubmitInstructionSchema = z.object({
  instruction: z.string().min(1).max(10_000),
  channel: z.enum(["voice", "text", "console"]).default("console"),
  sessionId: z.string().optional(),
});
export type SubmitInstruction = z.infer<typeof SubmitInstructionSchema>;

export const ConfirmActionSchema = z.object({
  note: z.string().max(2000).optional(),
});

export const RejectActionSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const UpsertPolicySchema = z.object({
  policy: z.record(z.unknown()),
  requiresConfirmation: z.boolean(),
  confirmationTemplate: z.string().nullable().optional(),
  modelProvider: z.string().optional(),
  confirmationTimeoutHours: z.number().int().positive().nullable().optional(),
  // Server-side upsert logic bumps this on a real config change (see
  // scripts/seed-tenant-policies.ts) — a caller may omit it and let the server decide.
  version: z.number().int().positive().optional(),
});

export const AuditQuerySchema = z.object({
  actionType: z.string().optional(),
  status: DomainActionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Vapi webhook: transcript events feed the Planner as instructions.
// `call` uses .passthrough() at every level — Vapi's payload carries fields (customer.number,
// phoneNumberId, metadata, ...) this schema doesn't enumerate, and zod's default object behavior
// STRIPS unknown keys on parse. Previously call was `z.object({ id }).partial()` with no
// passthrough, which silently deleted call.customer.number and call.phoneNumberId on every
// webhook — caller-identity resolution and tenant-by-phone-number routing both depend on fields
// that never survived parsing.
export const VapiWebhookSchema = z.object({
  message: z
    .object({
      type: z.string(),
      call: z
        .object({
          id: z.string().optional(),
          phoneNumberId: z.string().optional(),
          customer: z.object({ number: z.string().optional() }).passthrough().optional(),
          phoneNumber: z.object({ number: z.string().optional() }).passthrough().optional(),
          metadata: z.record(z.unknown()).optional(),
        })
        .passthrough()
        .optional(),
      transcript: z.string().optional(),
      artifact: z.record(z.unknown()).optional(),
    })
    .passthrough(),
});

// GoHighLevel webhook: CRM sync events.
export const GhlWebhookSchema = z
  .object({
    type: z.string(),
    locationId: z.string().optional(),
    contactId: z.string().optional(),
  })
  .passthrough();
