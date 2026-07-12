// bulk_notify_existing_customers: consent-filtered promotional outreach. The consent
// filter (households.marketing_consent = true) is NON-NEGOTIABLE — TCPA exposure on
// unconsented promotional calls/texts. draft() speaks the count and a sample line
// before anything executes; the batch is always confirmation-gated.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, households } from "@finnor/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const ACTION = "bulk_notify_existing_customers";

export const BulkNotifyPayloadSchema = z.object({
  offerScript: z.string().min(10).max(1000),
  channel: z.enum(["sms", "call"]).default("sms"),
});

interface ConsentedTarget {
  householdId: string;
  label: string;
  phone: string;
}

/** Exported so the consent behavior is directly unit-testable. */
export async function findConsentedTargets(tenantId: string): Promise<ConsentedTarget[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        id: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
      })
      .from(households)
      .where(eq(households.marketingConsent, true)); // the TCPA line — never widened
    return rows
      .map((r) => {
        const contact = (r.contactInfo ?? {}) as Record<string, unknown>;
        return {
          householdId: r.id,
          label: String(contact.name ?? r.address),
          phone: String(contact.phone ?? ""),
        };
      })
      .filter((t) => t.phone.length > 0);
  });
}

export const bulkNotifyPlugin: DomainEnginePlugin = {
  name: "bulk-notify",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: BulkNotifyPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = BulkNotifyPayloadSchema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  async draft(actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    const p = BulkNotifyPayloadSchema.parse(payload);
    const targets = await findConsentedTargets(policy.tenantId);
    const sample = targets[0];
    const summary =
      targets.length === 0
        ? "No customers have marketing consent on file — nothing will be sent. Record consent before running promotions."
        : `Send this offer to ${targets.length} customer${targets.length === 1 ? "" : "s"} with marketing consent` +
          ` (sample: ${sample!.label}): "${p.offerScript}" — approve to send all?`;
    return {
      actionType,
      summary,
      payload: { ...p, tenantId: policy.tenantId, targets: targets as unknown as Record<string, unknown>[] },
      requiresConfirmation: true, // bulk promotional outreach is ALWAYS gated
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const targets = (draft.payload.targets ?? []) as unknown as ConsentedTarget[];
    const script = String(draft.payload.offerScript ?? "");
    const channel = String(draft.payload.channel ?? "sms");
    const tenantId = String(draft.payload.tenantId ?? "");
    if (targets.length === 0) return { status: "success", output: { sent: 0 }, expected: { sent: 0 } };

    let sent = 0;
    const failures: string[] = [];
    for (const t of targets) {
      if (channel === "call") {
        const call = await tools.call("vapi_place_call", { phoneNumber: t.phone, instructions: script, tenantId });
        call.ok ? sent++ : failures.push(`${t.label}: ${call.error}`);
      } else {
        const contact = await tools.call("ghl_create_contact", { phone: t.phone, firstName: t.label, tenantId });
        const sms = contact.ok
          ? await tools.call("ghl_send_sms", {
              contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
              message: script,
              tenantId,
            })
          : contact;
        sms.ok ? sent++ : failures.push(`${t.label}: ${sms.error}`);
      }
    }
    if (sent === 0 && failures.length > 0) {
      return { status: "integration_unavailable", output: { failures }, error: failures[0] };
    }
    return { status: "success", output: { sent, failures }, expected: { sent: targets.length } };
  },
};

export default bulkNotifyPlugin;
