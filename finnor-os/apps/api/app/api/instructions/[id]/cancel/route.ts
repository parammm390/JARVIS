import { actionLog, domainActions, instructionSessions, workflowRuns, workflowSteps, withTenant, transitionWork } from "@finnor/db";
import { cancelRun } from "@finnor/workflow-runtime";
import { and, eq, inArray } from "drizzle-orm";
import { emitInstructionEvent } from "@finnor/orchestration";
import { canApprove, errorResponse, requireContext } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

/** Cancels the durable instruction, not just its browser presentation. The
 * append-only cancelled event stops an in-flight planner before dispatch;
 * already-gated actions are rejected through the normal audited decision path,
 * and live workflow runs receive their ordinary optimistic cancel control. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot cancel business instructions` }, { status: 403 });
    }

    const snapshot = await withTenant(ctx.tenantId, async (db) => {
      const [instruction] = await db
        .select({ id: instructionSessions.id, workId: instructionSessions.workId })
        .from(instructionSessions)
        .where(and(eq(instructionSessions.id, id), eq(instructionSessions.tenantId, ctx.tenantId)))
        .limit(1);
      if (!instruction) return null;
      const actions = await db
        .select({ id: domainActions.id, status: domainActions.status })
        .from(domainActions)
        .where(and(
          eq(domainActions.tenantId, ctx.tenantId),
          instruction.workId ? eq(domainActions.workId, instruction.workId) : eq(domainActions.instructionId, id),
        ));
      return { instruction, actions };
    });
    if (!snapshot) return Response.json({ error: "Instruction not found" }, { status: 404 });

    await emitInstructionEvent(ctx.tenantId, id, "cancelled", { requestedBy: ctx.userId, source: "product" });

    const draftIds = snapshot.actions.filter((action) => action.status === "draft").map((action) => action.id);
    if (draftIds.length > 0) {
      await withTenant(ctx.tenantId, async (db) => {
        const rejected = await db
          .update(domainActions)
          .set({ status: "rejected" })
          .where(and(eq(domainActions.tenantId, ctx.tenantId), inArray(domainActions.id, draftIds), eq(domainActions.status, "draft")))
          .returning({ id: domainActions.id });
        if (rejected.length > 0) {
          await db.insert(actionLog).values(rejected.map((action) => ({
            tenantId: ctx.tenantId,
            domainActionId: action.id,
            step: "rejected",
            input: { by: ctx.userId, role: ctx.role, reason: "instruction_cancel" },
            output: { cancelledBeforeDispatch: true, instructionId: id },
          })));
        }
      });
    }

    const pendingIds = snapshot.actions
      .filter((action) => action.status === "pending" || action.status === "needs_human_review")
      .map((action) => action.id);
    await Promise.all(pendingIds.map((actionId) =>
      getOrchestrator().decide(actionId, ctx.tenantId, "reject", ctx.userId, {
        role: ctx.role,
        reason: "instruction_cancel",
      }),
    ));

    const actionIds = snapshot.actions.map((action) => action.id);
    const activeRuns = actionIds.length === 0 ? [] : await withTenant(ctx.tenantId, (db) =>
      db
        .selectDistinct({ id: workflowRuns.id, version: workflowRuns.version, status: workflowRuns.status })
        .from(workflowRuns)
        .innerJoin(workflowSteps, eq(workflowSteps.workflowRunId, workflowRuns.id))
        .where(and(
          eq(workflowRuns.tenantId, ctx.tenantId),
          inArray(workflowSteps.domainActionId, actionIds),
          inArray(workflowRuns.status, ["running", "paused"]),
        )),
    );
    const runResults = await Promise.all(activeRuns.map((run) => cancelRun(ctx.tenantId, run.id, run.version, ctx.userId)));
    const inFlightActions = snapshot.actions.filter((action) => action.status === "approved" || action.status === "executing").length;
    if (snapshot.instruction.workId) {
      await transitionWork(ctx.tenantId, snapshot.instruction.workId, "failed", "cancelled", {
        instructionId: id,
        requestedBy: ctx.userId,
        rejectedActions: draftIds.length + pendingIds.length,
        cancelledRuns: runResults.filter((result) => result.ok).length,
        inFlightActions,
      }, {
        finalOutcome: { kind: "cancelled", requestedBy: ctx.userId },
        failure: { kind: "cancelled", message: "Cancelled by user", recoverable: false },
      });
    }

    return Response.json({
      status: "cancelled",
      rejectedActions: draftIds.length + pendingIds.length,
      cancelledRuns: runResults.filter((result) => result.ok).length,
      inFlightActions,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
