import type { OperatingInteractionContext } from "@finnor/shared-types";
import { effectiveInteractionTargets } from "./interaction-context";

export interface PlannedInteractionAction {
  action_type: string;
  payload: Record<string, unknown>;
  reasoning?: string;
  depends_on?: number[];
}

function contextualReason(reasoning: string | undefined): string {
  const suffix = "Targets were deterministically grounded from the explicit operating-canvas context.";
  return reasoning ? `${reasoning} ${suffix}` : suffix;
}

/** Bind exact explicit targets before schema validation, policy, and authority. */
export function applyOperatingInteractionTargets<T extends PlannedInteractionAction>(
  actions: T[],
  context: OperatingInteractionContext | null | undefined,
): T[] {
  if (!context) return actions;
  const targets = effectiveInteractionTargets(context);
  const invoices = targets.filter((ref) => ref.entityType === "invoice");
  const households = targets.filter((ref) => ref.entityType === "household");
  const visits = targets.filter((ref) => ref.entityType === "service_visit");
  const appointments = targets.filter((ref) => ref.entityType === "appointment");
  const work = targets.filter((ref) => ref.entityType === "work");

  const grounded = actions.map((action) => {
    if (invoices.length > 0 && action.action_type === "call_overdue_invoices") {
      return invoices.map((invoice) => ({
        ...action,
        action_type: "send_payment_reminder",
        payload: { invoiceId: invoice.entityId, channel: "call" },
        reasoning: contextualReason(action.reasoning),
      } as T));
    }
    if (invoices.length > 0 && (action.action_type === "send_payment_reminder" || action.action_type === "record_payment")) {
      return invoices.map((invoice) => ({
        ...action,
        payload: { ...action.payload, invoiceId: invoice.entityId },
        reasoning: contextualReason(action.reasoning),
      } as T));
    }

    let payload = action.payload;
    if (households.length === 1 && ["answer_business_question", "create_invoice", "create_proposal", "create_maintenance_agreement", "schedule_visit", "place_call", "send_message"].includes(action.action_type)) {
      payload = { ...payload, householdId: households[0]!.entityId };
    }
    if (visits.length === 1 && ["reschedule_visit", "assign_technician_to_visit", "log_stock_used_on_visit", "submit_job_report", "escalate_technician_issue"].includes(action.action_type)) {
      payload = { ...payload, visitId: visits[0]!.entityId };
    }
    if (appointments.length === 1 && "appointmentId" in payload) {
      payload = { ...payload, appointmentId: appointments[0]!.entityId };
    }
    if (work.length === 1 && action.action_type === "handoff_work") {
      payload = { ...payload, workRef: { workId: work[0]!.entityId } };
    }
    if (context.cohort && action.action_type === "bulk_notify_existing_customers") {
      const minDays = context.filters.find((filter) => filter.field === "minDaysInactive" && typeof filter.value === "number")?.value;
      payload = {
        ...payload,
        ...(typeof minDays === "number" ? { minDaysInactive: minDays } : {}),
        excludedHouseholdIds: context.excludedEntities.filter((ref) => ref.entityType === "household").map((ref) => ref.entityId),
        cohortExecutionId: context.cohort.executionId,
        cohortCount: context.cohort.count,
      };
    }
    return payload === action.payload ? [action] : [{ ...action, payload, reasoning: contextualReason(action.reasoning) } as T];
  });

  // A single cohort-style action can expand into several exact entity actions.
  // Preserve planner ordering by remapping every original dependency to every
  // concrete action produced for that dependency.
  const outputIndexes: number[][] = [];
  let nextIndex = 0;
  for (const group of grounded) {
    outputIndexes.push(group.map(() => nextIndex++));
  }
  return grounded.flatMap((group) => group.map((action) => {
    if (!action.depends_on) return action;
    const depends_on = [...new Set(action.depends_on.flatMap((dependency) => outputIndexes[dependency] ?? []))];
    return { ...action, depends_on } as T;
  }));
}
