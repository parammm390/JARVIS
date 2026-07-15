// Vertical workflow 1 (Phase 4, docs/jarvis-90-execution-blueprint.md §4.1): lead to
// booked water test. Intake/qualification are already real (crm plugin's createLead/
// convertLeadToOpportunity, Phase 1). This plugin covers the part that was previously
// missing: availability+hold, booking, and confirmation — driven through the durable
// execution runtime (@finnor/workflow-runtime) rather than the ad hoc service_visits
// writes the legacy `scheduling` plugin still uses. This is additive: the existing
// `schedule_water_test` action type (water-test plugin, LangGraph-driven, tested) is
// untouched — this is a new, separate action type.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, appointments } from "@finnor/db";
import { submitCommand, enqueueStep } from "@finnor/workflow-runtime";
import { eq } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const StartWaterTestWorkflowSchema = z.object({
  householdId: z.string().uuid(),
  technicianId: opt(z.string().uuid()),
  scheduledAt: z.string(),
  phoneNumber: z.string().min(7),
  confirmationMessage: opt(z.string().max(500)),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  start_water_test_workflow: StartWaterTestWorkflowSchema,
};

export const leadToWaterTestPlugin: DomainEnginePlugin = {
  name: "lead-to-water-test",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = StartWaterTestWorkflowSchema.parse(payload);
    return {
      actionType,
      summary: `Hold a water test appointment on ${p.scheduledAt.slice(0, 10)} and confirm it with the customer at ${p.phoneNumber}.`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, _tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;
    const householdId = String(p.householdId);
    const scheduledAt = String(p.scheduledAt);
    // Deterministic, not time-based — a retried/duplicate-delivered execute() must
    // converge on the SAME command, never start the workflow twice.
    const idempotencyKey = `lead-to-water-test:${householdId}:${scheduledAt}`;

    const submitted = await withTenant(tenantId, (db) =>
      submitCommand(db, {
        tenantId,
        commandType: "start_water_test_workflow",
        payload: { householdId },
        workflowType: "lead_to_water_test",
        idempotencyKey,
        steps: [
          {
            stepType: "hold_appointment",
            payload: {
              tenantId,
              subjectType: "household",
              subjectId: householdId,
              technicianId: p.technicianId ?? undefined,
              scheduledAt,
              idempotencyKey: `${idempotencyKey}:hold`,
            },
          },
          {
            stepType: "send_confirmation_call",
            payload: {
              tenantId,
              phoneNumber: String(p.phoneNumber),
              message:
                p.confirmationMessage ?? `Your water test is scheduled for ${scheduledAt.slice(0, 10)}. Reply or call if you need to reschedule.`,
              idempotencyKey: `${idempotencyKey}:confirm-call`,
            },
          },
          {
            // Runs after the customer has been notified — appointments starts 'hold',
            // becomes 'confirmed' only once notification succeeds (never confirmed
            // silently with no one told).
            stepType: "confirm_appointment",
            // holdId is filled in by advanceWorkflow's caller once step 1 completes —
            // this plugin can't know the appointment id yet, so the confirm step reads
            // it from step 1's evidence at execution time (see run-workflow-step.ts /
            // the confirm_appointment case below).
            payload: { tenantId, idempotencyKey: `${idempotencyKey}:confirm` },
          },
        ],
      }),
    );

    if (!submitted.alreadyExisted) {
      // Kick off async processing via the existing job queue (run_workflow_step,
      // registered in apps/worker/src/index.ts) — this execute() returns immediately;
      // the actual hold/notify/confirm sequence runs out-of-band, exactly like every
      // other durable command in this runtime.
      await enqueueStep(tenantId, submitted.stepIds[0]!, `${idempotencyKey}:hold`);
    }

    return {
      status: "success",
      output: { commandId: submitted.commandId, workflowRunId: submitted.workflowRunId, alreadyStarted: submitted.alreadyExisted },
      expected: { started: true },
    };
  },
};

export default leadToWaterTestPlugin;

/** Test/inspection helper: find the appointment created by a given workflow_run's
 *  hold_appointment step, since the confirm step doesn't carry the hold id directly. */
export async function findAppointmentForSubject(tenantId: string, householdId: string) {
  return withTenant(tenantId, (db) =>
    db.select().from(appointments).where(eq(appointments.subjectId, householdId)),
  );
}
