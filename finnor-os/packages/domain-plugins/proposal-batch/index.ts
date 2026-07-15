// send_proposal_to_recent_installs: query recent installs → one proposal per customer →
// read the batch back for a SINGLE spoken/clicked approval → send via existing comms.
// draft() reads the DB (read-only); all sends happen in execute() after the gate.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, serviceVisits, households, equipment, proposals } from "@finnor/db";
import { recordBusinessEvent } from "@finnor/data-platform";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { loadPricingCatalog, isPricingCatalogReady } from "../shared/pricing-catalog";

const ACTION = "send_proposal_to_recent_installs";

export const ProposalBatchPolicySchema = z.object({
  window_days_default: z.number().int().positive().default(30),
  max_batch: z.number().int().positive().max(50).default(10),
});

export const ProposalBatchPayloadSchema = z.object({
  windowDays: z.coerce.number().int().positive().max(365).nullish().transform((v) => v ?? undefined),
  limit: z.coerce.number().int().positive().max(50).nullish().transform((v) => v ?? undefined),
  offerNote: z.string().max(500).nullish().transform((v) => v ?? undefined),
});

interface BatchTarget {
  householdId: string;
  label: string;
  phone: string;
  equipmentType: string | null;
  visitDate: string;
}

async function findTargets(
  tenantId: string,
  windowDays: number,
  limit: number,
): Promise<BatchTarget[]> {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        householdId: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
        visitDate: serviceVisits.completedAt,
        equipmentType: equipment.type,
      })
      .from(serviceVisits)
      .innerJoin(households, eq(serviceVisits.householdId, households.id))
      .leftJoin(equipment, eq(equipment.householdId, households.id))
      .where(and(eq(serviceVisits.type, "install"), gte(serviceVisits.completedAt, since)))
      .orderBy(desc(serviceVisits.completedAt))
      .limit(limit);
    const seen = new Set<string>();
    const targets: BatchTarget[] = [];
    for (const r of rows) {
      if (seen.has(r.householdId)) continue; // one proposal per customer
      seen.add(r.householdId);
      const contact = (r.contactInfo ?? {}) as Record<string, unknown>;
      targets.push({
        householdId: r.householdId,
        label: String(contact.name ?? r.address),
        phone: String(contact.phone ?? ""),
        equipmentType: r.equipmentType,
        visitDate: r.visitDate?.toISOString().slice(0, 10) ?? "recently",
      });
    }
    return targets;
  });
}

export const proposalBatchPlugin: DomainEnginePlugin = {
  name: "proposal-batch",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: ProposalBatchPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = ProposalBatchPayloadSchema.safeParse(payload ?? {});
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  async draft(actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    const p = ProposalBatchPayloadSchema.parse(payload ?? {});
    const pol = ProposalBatchPolicySchema.safeParse(policy.policy);
    const windowDays = p.windowDays ?? (pol.success ? pol.data.window_days_default : 30);
    const limit = p.limit ?? (pol.success ? pol.data.max_batch : 10);
    const targets = await findTargets(policy.tenantId, windowDays, limit);
    const catalog = await loadPricingCatalog(policy.tenantId);
    const pricingReady = isPricingCatalogReady(catalog);

    const roster = targets
      .map((t) => `${t.label} (${t.equipmentType ?? "equipment"} installed ${t.visitDate})`)
      .join("; ");
    const summary =
      targets.length === 0
        ? `No installs found in the last ${windowDays} days — nothing to send.`
        : `Send a follow-up proposal to ${targets.length} recent install${targets.length === 1 ? "" : "s"}: ${roster}.` +
          (pricingReady ? "" : " Note: your pricing catalog isn't configured yet, so proposals will describe the offer without exact prices.") +
          " Approve to send all of them?";

    return {
      actionType,
      summary,
      payload: { ...p, tenantId: policy.tenantId, windowDays, limit, targets: targets as unknown as Record<string, unknown>[] },
      requiresConfirmation: true, // batch outbound comms are always gated
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const targets = (draft.payload.targets ?? []) as unknown as BatchTarget[];
    if (targets.length === 0) return { status: "success", output: { sent: 0 }, expected: { sent: 0 } };
    const tenantId = String(draft.payload.tenantId ?? "");
    const sent: string[] = [];
    const failed: Array<{ label: string; error: string }> = [];

    for (const t of targets) {
      if (!t.phone) {
        failed.push({ label: t.label, error: "no phone number on file" });
        continue;
      }
      const message =
        `Hi ${t.label}! Thanks again for your recent ${t.equipmentType ?? "water treatment"} install. ` +
        `${String(draft.payload.offerNote ?? "We'd love to set you up with a maintenance plan to protect it — reply YES and we'll send details.")}`;
      const contact = await tools.call("ghl_create_contact", { phone: t.phone, firstName: t.label, tenantId });
      const sms = contact.ok
        ? await tools.call("ghl_send_sms", {
            contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
            message,
            tenantId,
          })
        : contact;
      if (sms.ok) {
        sent.push(t.label);
        if (tenantId) {
          await withTenant(tenantId, async (db) => {
            const [row] = await db
              .insert(proposals)
              .values({
                householdId: t.householdId,
                content: { message, kind: "post_install_follow_up" },
                status: "sent",
                sentAt: new Date(),
              })
              .returning();
            await recordBusinessEvent(db, {
              tenantId,
              entityType: "proposal",
              entityId: row!.id,
              eventType: "post_install_followup_sent",
              payload: { householdId: t.householdId },
            });
          }).catch(() => undefined);
        }
      } else {
        failed.push({ label: t.label, error: sms.error ?? "send failed" });
      }
    }

    if (sent.length === 0 && failed.length > 0) {
      return {
        status: failed.every((f) => f.error.includes("not set") || f.error.includes("unavailable"))
          ? "integration_unavailable"
          : "failure",
        output: { failed },
        error: `None of the ${targets.length} proposals could be sent: ${failed[0]!.error}`,
      };
    }
    return {
      status: "success",
      output: { sent: sent.length, sentTo: sent, failed },
      expected: { sent: targets.length },
    };
  },
};

export default proposalBatchPlugin;
