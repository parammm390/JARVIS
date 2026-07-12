// Evidence-backed policy schema for renew_maintenance_agreement (the second proven
// action type from the Culligan-derived evidence). Values needing dealer input are
// placeholder-marked in seed data.

import { z } from "zod";

export const MaintenanceAgreementPolicySchema = z.object({
  renewal_window_days: z.number().int().positive().default(30),
  price_usd: z.union([z.number().positive(), z.literal("PLACEHOLDER_NEEDS_REAL_VALUE")]),
  cadence_options: z.array(z.enum(["annual", "semi_annual", "quarterly"])).default(["annual"]),
});
export type MaintenanceAgreementPolicy = z.infer<typeof MaintenanceAgreementPolicySchema>;

export const RenewalPayloadSchema = z.object({
  agreementId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  householdId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  householdLabel: z.string().min(1),
  contactPhone: z.string().min(7),
  cadence: z.enum(["annual", "semi_annual", "quarterly"]).default("annual"),
  message: z.string().max(2000).nullish().transform((v) => v ?? undefined),
});
export type RenewalPayload = z.infer<typeof RenewalPayloadSchema>;
