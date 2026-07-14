import { z } from "zod";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const LaunchCampaignPayloadSchema = z.object({
  name: z.string().min(1),
  dailyBudgetUsd: z.number().positive(),
  objective: opt(z.string()),
  targetZip: opt(z.string()),
});

export const LaunchCampaignPolicySchema = z.object({
  default_daily_budget_usd: z.union([z.number().positive(), z.literal(PLACEHOLDER_NEEDS_REAL_VALUE)]),
  max_daily_budget_usd: z.number().positive().default(50),
});

export const ReviewRequestPayloadSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  email: opt(z.string().email()),
  contactName: opt(z.string()),
});

export const ReviewRequestPolicySchema = z.object({
  review_link_url: z.union([z.string().url(), z.literal(PLACEHOLDER_NEEDS_REAL_VALUE)]),
  channel: z.enum(["sms", "email"]).default("sms"),
  message_template: z.string().default("Hi {{name}}, thanks for choosing us! We'd really appreciate a quick review: {{link}}"),
});
