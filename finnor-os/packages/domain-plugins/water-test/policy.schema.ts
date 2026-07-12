// Evidence-backed policy schema for schedule_water_test (derived from the Culligan pull
// earlier in this project — a real dealer workflow, not a guess). Policy VALUES that
// require dealer input are placeholder-marked in seed data, never invented here.

import { z } from "zod";

export const WaterTestPolicySchema = z.object({
  service_radius_miles: z.union([z.number().positive(), z.literal("PLACEHOLDER_NEEDS_REAL_VALUE")]),
  default_duration_minutes: z.number().int().positive().default(45),
  allowed_windows: z.array(z.string()).default(["09:00-12:00", "13:00-17:00"]),
});
export type WaterTestPolicy = z.infer<typeof WaterTestPolicySchema>;

export const WaterTestPayloadSchema = z.object({
  householdId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  address: z.string().min(1),
  contactPhone: z.string().min(7),
  contactName: z.string().min(1).nullish().transform((v) => v ?? undefined),
  requestedAt: z.string().nullish().transform((v) => v ?? undefined), // ISO datetime the customer asked for
  technicianId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  notes: z.string().max(2000).nullish().transform((v) => v ?? undefined),
});
export type WaterTestPayload = z.infer<typeof WaterTestPayloadSchema>;
