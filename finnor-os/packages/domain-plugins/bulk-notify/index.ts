// bulk_notify_existing_customers: consent-filtered promotional outreach — the real
// "win-back campaign" primitive (find everyone inactive N-M months, call/text them
// with a specific offer). The consent filter (households.marketing_consent = true)
// is NON-NEGOTIABLE — TCPA exposure on unconsented promotional calls/texts. draft()
// speaks the count and a sample line before anything executes; the batch is always
// confirmation-gated.
//
// Personalization (added alongside the certification pass): each target's own most
// recent equipment record is pulled and woven into THEIR call/text only — never
// shared across targets, matching the household-privacy boundary every other call
// in this system already respects. discountPercent is a real, separately-typed
// field specifically so a live offer number is always a value the owner actually
// gave (typed or spoken, either way through the same planner), never an LLM
// improvisation — the assistant's own system prompt already refuses to invent one;
// this is what gives it something real to say instead.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { personaAssistantId, claimBudget, withCircuitBreaker, DAILY_VAPI_CALL_CAP } from "@finnor/tools";
import { withTenant, households, communicationsLog, serviceVisits, equipment } from "@finnor/db";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";

const ACTION = "bulk_notify_existing_customers";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const BulkNotifyPayloadSchema = z
  .object({
    // Optional now: when omitted, a personalized default is composed per-target from
    // their name + equipment + discountPercent (see composeMessage below) — the
    // owner can still hand-write exact wording, which always wins verbatim (with
    // {name}/{equipment}/{discount} placeholders substituted per target if present).
    offerScript: opt(z.string().min(10).max(1000)),
    channel: z.enum(["sms", "call"]).default("sms"),
    // Selects a specialized voice persona for channel="call" — falls back to the
    // default Finnor assistant if omitted or unrecognized. Auto-selects "winback"
    // when discountPercent is set and no persona was explicitly chosen.
    voicePersona: opt(z.enum(["winback", "service_reminder", "install_followup"])),
    // Inactivity window in months since last logged interaction (communications_log
    // or a service visit). Omit either bound to leave it open-ended.
    minMonthsInactive: opt(z.number().min(0).max(60)),
    maxMonthsInactive: opt(z.number().min(0).max(60)),
    // The one real number the whole campaign is allowed to state — set by the owner
    // (typed or spoken), never invented downstream. Omit for a non-discount check-in.
    discountPercent: opt(z.number().min(0).max(100)),
  })
  .refine((p) => Boolean(p.offerScript) || p.discountPercent !== undefined, {
    message: "Provide either offerScript or discountPercent — a campaign needs real content, not a blank call.",
  });

interface ConsentedTarget {
  householdId: string;
  label: string;
  phone: string;
  /** Their own most recent equipment type only — e.g. "water softener". Undefined
   *  when the household has no equipment on file (never another household's). */
  equipmentSummary?: string;
}

/** Per-target message, never a shared broadcast string. If the owner supplied
 *  offerScript, their exact wording wins — {name}/{equipment}/{discount} tokens are
 *  substituted if present, otherwise it's used verbatim. Otherwise a solid default
 *  win-back line is composed from what's actually known about THIS household. */
export function composeMessage(target: ConsentedTarget, offerScript: string | undefined, discountPercent: number | undefined): string {
  if (offerScript) {
    return offerScript
      .replaceAll("{name}", target.label)
      .replaceAll("{equipment}", target.equipmentSummary ?? "your water system")
      .replaceAll("{discount}", discountPercent !== undefined ? `${discountPercent}%` : "a special offer");
  }
  const equipmentLine = target.equipmentSummary ? ` on your ${target.equipmentSummary}` : " with your water system";
  const offerLine =
    discountPercent !== undefined
      ? ` We're running ${discountPercent}% off right now if you'd like to take advantage of it.`
      : "";
  return `Hi ${target.label}! This is Finnor, your water treatment dealer — it's been a while since we've connected${equipmentLine}, so I wanted to check in.${offerLine}`;
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
      // §0.3.5: RLS + an explicit tenant predicate, both, always — never RLS alone.
      // The TCPA consent line is equally non-negotiable — never widened.
      .where(and(eq(households.tenantId, tenantId), eq(households.marketingConsent, true)));
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

    // Each household's own most recent equipment type only — one row per household,
    // never leaked across households. equipment has no tenant_id column of its own
    // (RLS scopes it via a household_id subquery, same as service_visits/
    // communications_log above) — explicitly scoped here too via inArray against
    // THIS tenant's own already-fetched household ids, not RLS alone.
    const equipmentRows = await db
      .select({ householdId: equipment.householdId, type: equipment.type, installDate: equipment.installDate })
      .from(equipment)
      .where(inArray(equipment.householdId, rows.map((r) => r.id)))
      .orderBy(desc(equipment.installDate));
    const equipmentByHousehold = new Map<string, string>();
    for (const e of equipmentRows) {
      if (!equipmentByHousehold.has(e.householdId)) equipmentByHousehold.set(e.householdId, e.type);
    }

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
          equipmentSummary: equipmentByHousehold.get(r.id),
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
    const discountNote = p.discountPercent !== undefined ? ` at ${p.discountPercent}% off` : "";
    const sampleLine = sample ? composeMessage(sample, p.offerScript as string | undefined, p.discountPercent as number | undefined) : "";
    const cappedNote = targets.length > DAILY_VAPI_CALL_CAP && p.channel === "call"
      ? ` (only the first ${DAILY_VAPI_CALL_CAP}/day will actually go out — your daily call cap — the rest queue for the following day)`
      : "";
    const summary =
      targets.length === 0
        ? "No customers match — either no marketing consent on file, or none fall in that inactivity window. Nothing will be sent."
        : `Reach ${targets.length} customer${targets.length === 1 ? "" : "s"} with marketing consent${windowNote}${discountNote}` +
          ` via ${p.channel}${p.voicePersona ? ` (${p.voicePersona} persona)` : ""}${cappedNote} — each gets their own personalized message` +
          ` (sample, ${sample?.label}): "${sampleLine}" — approve to send all?`;
    return {
      actionType,
      summary,
      payload: { ...p, tenantId: policy.tenantId, targets: targets as unknown as Record<string, unknown>[] },
      requiresConfirmation: true, // bulk promotional outreach is ALWAYS gated
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const targets = (draft.payload.targets ?? []) as unknown as ConsentedTarget[];
    const offerScript = draft.payload.offerScript ? String(draft.payload.offerScript) : undefined;
    const discountPercent = typeof draft.payload.discountPercent === "number" ? draft.payload.discountPercent : undefined;
    const channel = String(draft.payload.channel ?? "sms");
    const tenantId = String(draft.payload.tenantId ?? "");
    // Auto-select the winback persona for a discount campaign when the caller didn't
    // pick one explicitly — the assistant that's actually built for this moment.
    const voicePersona = draft.payload.voicePersona ? String(draft.payload.voicePersona) : discountPercent !== undefined ? "winback" : undefined;
    const assistantId = personaAssistantId(voicePersona);
    if (targets.length === 0) return { status: "success", output: { sent: 0 }, expected: { sent: 0 } };

    let sent = 0;
    let capped = 0;
    const failures: string[] = [];
    for (const t of targets) {
      const message = composeMessage(t, offerScript, discountPercent);
      if (channel === "call") {
        // Same real per-tenant daily cap every other real dial-out path enforces
        // (packages/tools/src/capabilities/communications.ts) — a bulk campaign
        // must never be the one path that bypasses it. Checked before EVERY dial,
        // not just once, since claimBudget is the atomic source of truth.
        const budget = await claimBudget(tenantId, "vapi", "call", DAILY_VAPI_CALL_CAP);
        if (!budget.allowed) {
          capped = targets.length - sent - failures.length;
          break;
        }
        const call = await withCircuitBreaker("vapi", () =>
          tools.call("vapi_place_call", {
            phoneNumber: t.phone,
            instructions: message,
            tenantId,
            assistantId,
            purpose: voicePersona ?? "bulk_notify",
          }),
        ).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
        call.ok ? sent++ : failures.push(`${t.label}: ${call.error}`);
      } else {
        const contact = await tools.call("ghl_create_contact", { phone: t.phone, firstName: t.label, tenantId });
        const sms = contact.ok
          ? await tools.call("ghl_send_sms", {
              contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
              message,
              tenantId,
            })
          : contact;
        sms.ok ? sent++ : failures.push(`${t.label}: ${sms.error}`);
      }
    }
    if (sent === 0 && failures.length > 0 && capped === 0) {
      return { status: "integration_unavailable", output: { failures }, error: failures[0] };
    }
    return { status: "success", output: { sent, failures, capped }, expected: { sent: targets.length } };
  },
};

export default bulkNotifyPlugin;
