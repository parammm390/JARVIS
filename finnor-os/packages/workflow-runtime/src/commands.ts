// submitCommand(): the entry point into the durable execution runtime. A command is
// created already-approved (approval happens upstream, e.g. an existing domain_action
// gate) — this table exists to give every workflow_run a stable, idempotent parent.

import { commands, workflowRuns, workflowSteps, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";

export interface StepDefinition {
  stepType: string;
  payload: Record<string, unknown>;
}

export interface SubmitCommandParams {
  tenantId: string;
  commandType: string;
  payload: Record<string, unknown>;
  workflowType: string;
  steps: StepDefinition[];
  idempotencyKey?: string;
  requestedBy?: string;
  /** §2.4: forwarded from the originating DomainAction/TenantContext (Phase 16(e)) —
   *  carried onto both the command and every one of its steps so a receipt can read it
   *  with no join. */
  correlationId?: string;
  /** §2.8: the originating domain_action id, for single-action commands the §2.5
   *  runtime bridge submits — carried onto every step so its receipt can be looked up
   *  by domain_action_id, not just workflow_step_id. Left undefined for genuine
   *  multi-step workflow-kind commands, which have no single originating action. */
  domainActionId?: string;
}

export interface SubmitCommandResult {
  commandId: string;
  workflowRunId: string;
  stepIds: string[];
  alreadyExisted: boolean;
}

export async function submitCommand(db: Db, params: SubmitCommandParams): Promise<SubmitCommandResult> {
  if (params.idempotencyKey) {
    const [existingCommand] = await db
      .select()
      .from(commands)
      .where(and(eq(commands.tenantId, params.tenantId), eq(commands.idempotencyKey, params.idempotencyKey)));
    if (existingCommand) {
      const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.commandId, existingCommand.id));
      const steps = run ? await db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, run.id)) : [];
      return {
        commandId: existingCommand.id,
        workflowRunId: run?.id ?? "",
        stepIds: steps.map((s) => s.id),
        alreadyExisted: true,
      };
    }
  }

  const [command] = await db
    .insert(commands)
    .values({
      tenantId: params.tenantId,
      commandType: params.commandType,
      payload: params.payload,
      idempotencyKey: params.idempotencyKey ?? null,
      requestedBy: params.requestedBy ?? null,
      correlationId: params.correlationId ?? null,
      status: "approved",
    })
    .returning();

  const [run] = await db
    .insert(workflowRuns)
    .values({ tenantId: params.tenantId, commandId: command!.id, workflowType: params.workflowType, status: "running" })
    .returning();

  const stepRows = await db
    .insert(workflowSteps)
    .values(
      params.steps.map((s, i) => ({
        tenantId: params.tenantId,
        workflowRunId: run!.id,
        stepType: s.stepType,
        sequence: i,
        payload: s.payload,
        idempotencyKey: `${run!.id}:${i}`,
        correlationId: params.correlationId ?? null,
        domainActionId: params.domainActionId ?? null,
      })),
    )
    .returning();

  await db.update(commands).set({ status: "running", updatedAt: new Date() }).where(eq(commands.id, command!.id));

  return {
    commandId: command!.id,
    workflowRunId: run!.id,
    stepIds: stepRows.map((s) => s.id),
    alreadyExisted: false,
  };
}
