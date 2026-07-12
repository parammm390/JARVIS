// bulk_notify_existing_customers: consent-filtered promotional outreach. The consent
// filter (households.marketing_consent = true) is NON-NEGOTIABLE — TCPA exposure on
// unconsented promotional calls/texts. draft() speaks the count and a sample line
// before anything executes; the batch is always confirmation-gated.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { personaAssistantId } from "@finnor/tools";
import { withTenant, households, communicationsLog, serviceVisits } from "@finnor/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const ACTION = "bulk_notify_existing_customers";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const BulkNotifyPayloadSchema = z.object({
  offerScript: z.string().min(10).max(1000),
  channel: z.enum(["sms", "call"]).default("sms"),
  // Selects a specialized voice persona for channel="call" — falls back to the
  // default Finnor assistant if omitted or unrecognized.
  voicePersona: opt(z.enum(["winback", "service_reminder", "install_followup"])),
  // Inactivity window in months since last logged interaction (communications_log
  // or a service visit). Omit either bound to leave it open-ended.
  minMonthsInactive: opt(z.number().min(0).max(60)),
  maxMonthsInactive: opt(z.number().min(0).max(60)),
});

interface ConsentedTarget {
  householdId: string;
  label: string;
  phone: string;
}

export interface InactivityWindow {
  minMonthsInactive?: number;
  maxMonthsInactive?: number;
}

/** Exported so the consent behavior is directly unit-testable. */
export async function findConsentedTargets(tenantId: string, window?: InactivityWindow): Promise<ConsentedTarget[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        id: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
      })
      .from(households)
      .where(eq(households.marketingConsent, true)); // the TCPA line — never widened
    if (rows.length === 0) return [];

    // Last logged interaction per household — the more recent of any communications_log
    // entry or a completed service visit. Households with no history are inactive too
    // (they're a customer of record but never engaged): treated as maximally inactive.
    const lastSeen = await db.execute<{ household_id: string; last_at: string | null }>(sql`
      SELECT h.id AS household_id, GREATEST(MAX(cl.timestamp), MAX(sv.completed_at)) AS last_at
      FROM households h
      LEFT JOIN communications_log cl ON cl.household_id = h.id
      LEFT JOIN service_visits sv ON sv.household_id = h.id
      WHERE h.tenant_id = ${tenantId}
      GROUP BY h.id
    `);
    const lastSeenById = new Map(lastSeen.rows.map((r) => [r.household_id, r.last_at]));

    const now = Date.now();
    const monthsAgo = (iso: string | null) =>
      iso ? (now - new Date(iso).getTime()) / (30.44 * 24 * 3600 * 1000) : Infinity;

    return rows
      .filter((r) => {
        if (!window) return true;
        const months = monthsAgo(lastSeenById.get(r.id) ?? null);
        if (window.minMonthsInactive !== undefined && months < window.minMonthsInactive) return false;
        if (window.maxMonthsInactive !== undefined && months > window.maxMonthsInactive) return false;
        return true;
      })
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
    const targets = await findConsentedTargets(policy.tenantId, {
      minMonthsInactive: p.minMonthsInactive as number | undefined,
      maxMonthsInactive: p.maxMonthsInactive as number | undefined,
    });
    const sample = targets[0];
    const windowNote =
      p.minMonthsInactive !== undefined || p.maxMonthsInactive !== undefined
        ? ` inactive ${p.minMonthsInactive ?? 0}-${p.maxMonthsInactive ?? "∞"} months`
        : "";
    const summary =
      targets.length === 0
        ? "No customers match — either no marketing consent on file, or none fall in that inactivity window. Nothing will be sent."
        : `Send this offer to ${targets.length} customer${targets.length === 1 ? "" : "s"} with marketing consent${windowNote}` +
          ` via ${p.channel}${p.voicePersona ? ` (${p.voicePersona} persona)` : ""} (sample: ${sample!.label}): "${p.offerScript}" — approve to send all?`;
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
    const voicePersona = draft.payload.voicePersona ? String(draft.payload.voicePersona) : undefined;
    const assistantId = personaAssistantId(voicePersona);
    if (targets.length === 0) return { status: "success", output: { sent: 0 }, expected: { sent: 0 } };

    let sent = 0;
    const failures: string[] = [];
    for (const t of targets) {
      if (channel === "call") {
        const call = await tools.call("vapi_place_call", {
          phoneNumber: t.phone,
          instructions: script,
          tenantId,
          assistantId,
          purpose: voicePersona ?? "bulk_notify",
        });
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
