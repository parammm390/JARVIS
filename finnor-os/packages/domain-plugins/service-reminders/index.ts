// service-reminders: check_reminder_due — REAL starting defaults (standard published
// filter/membrane intervals), overridable per dealer via domain_policies. Read-only.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { z } from "zod";

const ACTION = "check_reminder_due";

/** Standard published intervals — real data, not placeholders (§6 of the extension brief). */
export const DEFAULT_INTERVALS = {
  sediment_filter_months: "3-6",
  carbon_filter_months: "6-12",
  ro_membrane_years: "2-3",
} as const;

export const ReminderPolicySchema = z.object({
  sediment_filter_months: z.string().default(DEFAULT_INTERVALS.sediment_filter_months),
  carbon_filter_months: z.string().default(DEFAULT_INTERVALS.carbon_filter_months),
  ro_membrane_years: z.string().default(DEFAULT_INTERVALS.ro_membrane_years),
});

export const ReminderPayloadSchema = z.object({
  equipmentType: z.enum(["sediment_filter", "carbon_filter", "ro_membrane", "water_softener"]),
  lastServicedAt: z.string(), // ISO date of last service/install
});

/** Months since a date, using the conservative (earliest) bound of a "3-6" style range. */
export function monthsUntilDue(intervalSpec: string, unit: "months" | "years"): number {
  const first = Number(intervalSpec.split("-")[0]);
  return unit === "years" ? first * 12 : first;
}

export function isReminderDue(
  equipmentType: string,
  lastServicedAt: string,
  policy: z.infer<typeof ReminderPolicySchema>,
): { due: boolean; monthsElapsed: number; dueAtMonths: number } {
  const elapsedMs = Date.now() - new Date(lastServicedAt).getTime();
  const monthsElapsed = elapsedMs / (30.44 * 24 * 3600 * 1000);
  const dueAtMonths =
    equipmentType === "sediment_filter"
      ? monthsUntilDue(policy.sediment_filter_months, "months")
      : equipmentType === "carbon_filter"
        ? monthsUntilDue(policy.carbon_filter_months, "months")
        : equipmentType === "ro_membrane"
          ? monthsUntilDue(policy.ro_membrane_years, "years")
          : 12; // softener: annual checkup convention
  return { due: monthsElapsed >= dueAtMonths, monthsElapsed: Math.round(monthsElapsed * 10) / 10, dueAtMonths };
}

export const serviceRemindersPlugin: DomainEnginePlugin = {
  name: "service-reminders",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: ReminderPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = ReminderPayloadSchema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = ReminderPayloadSchema.parse(payload);
    // Merge dealer overrides (policy.policy) with published defaults here — this is
    // the only place in the pipeline that sees `policy`, so it must be carried
    // forward in the payload for execute() to actually use it.
    const intervals = ReminderPolicySchema.parse(policy.policy);
    return {
      actionType,
      summary: `Check whether a ${p.equipmentType.replaceAll("_", " ")} last serviced ${p.lastServicedAt.slice(0, 10)} is due for service.`,
      payload: { ...p, intervals },
      // Read-only computation — safe to run ungated when the policy allows it.
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, _tools, ): Promise<ExecutionResult> {
    const policy = ReminderPolicySchema.parse(draft.payload.intervals ?? {});
    const result = isReminderDue(String(draft.payload.equipmentType), String(draft.payload.lastServicedAt), policy);
    return {
      status: "success",
      output: {
        ...result,
        intervals: policy,
        recommendation: result.due
          ? "Due now — schedule a service visit."
          : `Not due yet — check again in about ${Math.max(0, Math.round(result.dueAtMonths - result.monthsElapsed))} month(s).`,
      },
      expected: { answered: true },
    };
  },
};

export default serviceRemindersPlugin;
