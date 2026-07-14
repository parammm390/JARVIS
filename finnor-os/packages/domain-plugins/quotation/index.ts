// quotation domain plugin: size_equipment_for_household uses the standard industry
// sizing formula against households.water_profile — real math, public knowledge.
// generate_quote prices from the shared pricing catalog (never guessed). send_proposal
// delivers an already-generated quote for real, via email or SMS.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import { containsPlaceholder } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { z } from "zod";
import { withTenant, proposals } from "@finnor/db";
import { eq } from "drizzle-orm";
import { findHousehold } from "../shared/db-helpers";
import { loadPricingCatalog, priceForItem } from "../shared/pricing-catalog";
import type { PricingCatalog } from "../shared/pricing-catalog.schema";

export const SizingPayloadSchema = z.object({
  hardnessGpg: z.number().positive(),
  ironPpm: z.number().min(0).default(0),
  peopleInHousehold: z.number().int().positive().max(20),
  gallonsPerPersonPerDay: z.number().positive().default(75), // standard planning figure
});

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const QuotePayloadSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  householdLabel: z.string().min(1),
  items: z.array(z.string()).min(1),
  notes: opt(z.string().max(1000)),
});

export const SendProposalPayloadSchema = z.object({
  proposalId: z.string().uuid(),
  channel: z.enum(["email", "sms"]).default("email"),
  email: opt(z.string().email()),
  phone: opt(z.string()),
});

function renderQuoteBody(quote: Record<string, unknown>): string {
  const lines = (quote.lines ?? []) as Array<{ item: string; priceUsd: number | null }>;
  const body = lines.map((l) => `- ${l.item}${l.priceUsd !== null ? `: $${l.priceUsd.toLocaleString()}` : " (price TBD)"}`).join("\n");
  const total = typeof quote.totalUsd === "number" ? `\n\nTotal: $${(quote.totalUsd as number).toLocaleString()}` : "";
  const notes = quote.notes ? `\n\nNotes: ${quote.notes}` : "";
  return `Here's your quote:\n\n${body}${total}${notes}`;
}

/**
 * Standard softener sizing: compensated hardness (add 4 gpg per 1 ppm iron) ×
 * daily gallons × 7-day regeneration cycle → grain capacity, rounded up to the
 * common commercial sizes.
 */
export function sizeSoftener(input: z.infer<typeof SizingPayloadSchema>) {
  const compensatedHardness = input.hardnessGpg + input.ironPpm * 4;
  const dailyGallons = input.peopleInHousehold * input.gallonsPerPersonPerDay;
  const weeklyGrains = compensatedHardness * dailyGallons * 7;
  const commonSizes = [24_000, 32_000, 40_000, 48_000, 64_000, 80_000, 96_000, 110_000];
  const recommended = commonSizes.find((s) => s >= weeklyGrains) ?? commonSizes[commonSizes.length - 1]!;
  return { compensatedHardness, dailyGallons, weeklyGrains: Math.round(weeklyGrains), recommendedCapacityGrains: recommended };
}

export const quotationPlugin: DomainEnginePlugin = {
  name: "quotation",
  actionTypes: ["generate_quote", "size_equipment_for_household", "send_proposal"],
  payloadSchemas: {
    size_equipment_for_household: SizingPayloadSchema,
    generate_quote: QuotePayloadSchema,
    send_proposal: SendProposalPayloadSchema,
  },
  canHandle(t) {
    return this.actionTypes.includes(t);
  },

  validate(actionType, payload): ValidationResult {
    if (actionType === "size_equipment_for_household") {
      const p = SizingPayloadSchema.safeParse(payload);
      return p.success
        ? { valid: true, errors: [] }
        : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
    }
    if (actionType === "send_proposal") {
      const p = SendProposalPayloadSchema.safeParse(payload);
      return p.success
        ? { valid: true, errors: [] }
        : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
    }
    if (payload !== null && typeof payload === "object") return { valid: true, errors: [] };
    return { valid: false, errors: ["payload must be an object"] };
  },

  async draft(actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    if (actionType === "size_equipment_for_household") {
      const p = SizingPayloadSchema.parse(payload);
      return {
        actionType,
        summary: `Size a softener for a ${p.peopleInHousehold}-person household at ${p.hardnessGpg} gpg hardness${p.ironPpm ? ` with ${p.ironPpm} ppm iron` : ""}.`,
        payload: { ...p },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    if (actionType === "generate_quote") {
      const p = QuotePayloadSchema.parse(payload);
      const catalog = await loadPricingCatalog(policy.tenantId);
      const priced = p.items.every((item) => priceForItem(catalog, item) !== null) && catalog.items.length > 0;
      return {
        actionType,
        summary:
          `Generate a quote for ${p.householdLabel}: ${p.items.join(", ")}.` +
          (priced ? "" : " Prices aren't fully configured yet, so the quote may list items without amounts."),
        payload: { ...p, tenantId: policy.tenantId, pricingCatalog: catalog as unknown as Record<string, unknown> },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    if (actionType === "send_proposal") {
      const p = SendProposalPayloadSchema.parse(payload);
      const row = await withTenant(policy.tenantId, async (db) => {
        const [r] = await db.select().from(proposals).where(eq(proposals.id, p.proposalId));
        return r;
      });
      const content = row?.content as Record<string, unknown> | undefined;
      const target = p.channel === "email" ? p.email : p.phone;
      return {
        actionType,
        summary: row
          ? `Send the ${content?.kind ?? "quote"} for ${content?.for ?? "this customer"} via ${p.channel}${target ? ` to ${target}` : ""}. Approve?`
          : `Send proposal ${p.proposalId} — no matching proposal record found.`,
        payload: { ...p, tenantId: policy.tenantId, quote: content ?? null },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    const unconfigured = Object.keys(policy.policy).length === 0 || containsPlaceholder(policy.policy);
    return {
      actionType,
      summary: unconfigured
        ? `${actionType.replaceAll("_", " ")} — not yet configured for this dealer. Pricing lives in your policy, never guessed.`
        : policy.confirmationTemplate ?? `quotation: ${actionType} per your configured pricing.`,
      payload: (payload ?? {}) as Record<string, unknown>,
      requiresConfirmation: unconfigured ? true : policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    if (draft.actionType === "size_equipment_for_household") {
      const p = SizingPayloadSchema.parse(draft.payload);
      const sizing = sizeSoftener(p);
      return {
        status: "success",
        output: {
          ...sizing,
          recommendation: `A ${sizing.recommendedCapacityGrains.toLocaleString()}-grain softener covers ~${sizing.weeklyGrains.toLocaleString()} grains/week with a weekly regeneration cycle.`,
        },
        expected: { sized: true },
      };
    }
    if (draft.actionType === "generate_quote") {
      const tenantId = String(draft.payload.tenantId ?? "");
      const catalog = (draft.payload.pricingCatalog ?? { items: [] }) as unknown as PricingCatalog;
      const items = (draft.payload.items ?? []) as string[];
      const lines = items.map((item) => ({
        item,
        // A price appears ONLY if the dealer's pricing catalog has it — never guessed.
        priceUsd: priceForItem(catalog, item),
      }));
      const hh = await findHousehold(tenantId, {
        householdId: draft.payload.householdId ? String(draft.payload.householdId) : undefined,
        phone: draft.payload.phone ? String(draft.payload.phone) : undefined,
      });
      const content = {
        kind: "quote",
        for: draft.payload.householdLabel,
        lines,
        notes: draft.payload.notes ?? null,
        totalUsd: lines.every((l) => l.priceUsd !== null) ? lines.reduce((s2, l) => s2 + (l.priceUsd ?? 0), 0) : null,
        pricingNote: lines.some((l) => l.priceUsd === null)
          ? "One or more prices are not configured — set them in the pricing catalog."
          : null,
      };
      if (hh) {
        const row = await withTenant(tenantId, async (db) => {
          const [r] = await db.insert(proposals).values({ householdId: hh.id, content, status: "draft" }).returning();
          return r!;
        });
        return { status: "success", output: { proposalId: row.id, quote: content }, expected: { generated: true } };
      }
      return { status: "success", output: { quote: content, note: "No matching customer record — quote not attached to a household." }, expected: { generated: true } };
    }
    if (draft.actionType === "send_proposal") {
      const tenantId = String(draft.payload.tenantId ?? "");
      const quote = draft.payload.quote as Record<string, unknown> | null;
      if (!quote) return { status: "failure", output: {}, error: "No matching proposal record to send." };
      const body = renderQuoteBody(quote);
      if (draft.payload.channel === "email") {
        const to = draft.payload.email ? String(draft.payload.email) : undefined;
        if (!to) return { status: "failure", output: {}, error: "No email address on file to send the proposal to." };
        const r = await tools.call("send_email", { to, subject: "Your quote", body });
        if (!r.ok) return { status: r.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: `Could not send the proposal email: ${r.error}` };
      } else {
        const phone = draft.payload.phone ? String(draft.payload.phone) : undefined;
        if (!phone) return { status: "failure", output: {}, error: "No phone number on file to text the proposal to." };
        const contact = await tools.call("ghl_create_contact", { phone, tenantId });
        if (!contact.ok) return { status: contact.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: `Could not reach the CRM to create the contact: ${contact.error}` };
        const sms = await tools.call("ghl_send_sms", {
          contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
          message: body,
          tenantId,
        });
        if (!sms.ok) return { status: sms.integrationUnavailable ? "integration_unavailable" : "failure", output: { contact: contact.output }, error: `The proposal text could not be sent: ${sms.error}` };
      }
      await withTenant(tenantId, (db) =>
        db.update(proposals).set({ status: "sent", sentAt: new Date() }).where(eq(proposals.id, String(draft.payload.proposalId))),
      ).catch(() => undefined);
      return { status: "success", output: { proposalId: draft.payload.proposalId, channel: draft.payload.channel }, expected: { sent: true } };
    }
    return {
      status: "not_implemented",
      output: { actionType: draft.actionType },
      error: "Quoting rules and pricing are not yet configured for this dealer. Populate the quotation policy first.",
    };
  },
};

export default quotationPlugin;
