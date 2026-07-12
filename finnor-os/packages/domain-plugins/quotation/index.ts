// quotation domain plugin: size_equipment_for_household uses the standard industry
// sizing formula against households.water_profile — real math, public knowledge.
// generate_quote stays scaffolded: prices are dealer config, never guessed.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import { containsPlaceholder } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { z } from "zod";
import { withTenant, proposals } from "@finnor/db";
import { findHousehold } from "../shared/db-helpers";

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
  actionTypes: ["generate_quote", "size_equipment_for_household", "send_proposal", "draft_quote"],
  payloadSchemas: {
    size_equipment_for_household: SizingPayloadSchema,
    generate_quote: QuotePayloadSchema,
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
    if (payload !== null && typeof payload === "object") return { valid: true, errors: [] };
    return { valid: false, errors: ["payload must be an object"] };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
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
      const priced = !containsPlaceholder(policy.policy) && Object.keys(policy.policy).length > 0;
      return {
        actionType,
        summary:
          `Generate a quote for ${p.householdLabel}: ${p.items.join(", ")}.` +
          (priced ? "" : " Prices aren't configured yet, so the quote lists items without amounts."),
        payload: { ...p, tenantId: policy.tenantId, pricing: policy.policy },
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

  async execute(draft: DraftAction): Promise<ExecutionResult> {
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
      const pricing = (draft.payload.pricing ?? {}) as Record<string, unknown>;
      const items = (draft.payload.items ?? []) as string[];
      const lines = items.map((item) => {
        const price = pricing[item];
        return {
          item,
          // A price appears ONLY if the dealer configured it — never guessed.
          priceUsd: typeof price === "number" ? price : null,
        };
      });
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
          ? "One or more prices are not configured — set them in the quotation policy."
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
    return {
      status: "not_implemented",
      output: { actionType: draft.actionType },
      error: "Quoting rules and pricing are not yet configured for this dealer. Populate the quotation policy first.",
    };
  },
};

export default quotationPlugin;
