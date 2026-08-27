// Deterministic, fail-closed fixtures used by the deployed Product Truth golden
// matrix. These mutate the same durable Work/Objective records used by runtime;
// they are available only when explicitly enabled and keyed in certification.

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  businessEffects,
  createWorkEventWaitTx,
  decisionReceipts,
  domainActions,
  ingestIntegrationEventTx,
  workEvents,
  workObjectiveLoops,
  workObjectivePlannerAttempts,
  workObjectiveSteps,
  works,
  withTenant,
  type Db,
} from "@finnor/db";
import { errorResponse, requireContext } from "../../../../lib/auth";

const FIXTURES = new Set([
  "external-wait",
  "external-wake",
  "blocked-objective",
  "provider-unavailable",
  "failed-action-recovery",
  "completed-verified-outcome",
]);
type FixtureName = "external-wait" | "external-wake" | "blocked-objective" | "provider-unavailable" | "failed-action-recovery" | "completed-verified-outcome";
type FixtureResponse = {
  ok: true;
  scenario: FixtureName;
  nonce: string;
  workId: string;
  objectiveLoopId: string;
  objectiveStepId: string;
  waitId?: string;
  eventId?: string;
  wakeClaimId?: string;
  actionId?: string;
  effectId?: string;
  receiptId?: string;
  expectedEventType?: string;
  conditionSummary?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unavailable(): Response {
  // Do not reveal whether this route is deployed/configured to an unauthenticated
  // caller. The certification key is an explicit deployment-time capability.
  return Response.json({ error: "Product Truth certification fixtures are unavailable" }, { status: 404, headers: { "cache-control": "no-store" } });
}

async function appendWorkEventTx(
  db: Db,
  tenantId: string,
  workId: string,
  eventType: string,
  toStatus: "waiting" | "blocked" | "recovery" | "completed",
  payload: Record<string, unknown>,
): Promise<void> {
  const [work] = await db.select().from(works).where(and(eq(works.tenantId, tenantId), eq(works.id, workId))).limit(1);
  if (!work) throw new Error("Work disappeared while applying Product Truth fixture");
  const [latest] = await db.select({ maxSeq: sql<number>`coalesce(max(${workEvents.seq}), 0)::int` }).from(workEvents).where(eq(workEvents.workId, workId));
  await db.insert(workEvents).values({
    tenantId,
    workId,
    seq: (latest?.maxSeq ?? 0) + 1,
    eventType,
    fromStatus: work.status,
    toStatus,
    payload,
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (process.env.PRODUCT_TRUTH_CERTIFICATION_FIXTURES !== "1") return unavailable();
    const expectedKey = process.env.PRODUCT_TRUTH_CERTIFICATION_KEY?.trim();
    const providedKey = req.headers.get("x-product-truth-certification-key")?.trim();
    if (!expectedKey || !providedKey || providedKey !== expectedKey) return unavailable();

    const ctx = await requireContext(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const workId = typeof body.workId === "string" ? body.workId : "";
    const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
    const scenario = typeof body.scenario === "string" ? body.scenario : "";
    if (!UUID_RE.test(workId) || !nonce || nonce.length > 200 || !FIXTURES.has(scenario)) {
      return Response.json({ error: "workId, nonce, and a supported scenario are required" }, { status: 400 });
    }
    const fixture = scenario as FixtureName;
    const idempotencyKey = `product-truth-fixture:${fixture}:${nonce}`;

    const result = await withTenant(ctx.tenantId, async (db): Promise<FixtureResponse> => {
      await db.execute(sql`SELECT id FROM ${works} WHERE ${works.tenantId}=${ctx.tenantId} AND ${works.id}=${workId} FOR UPDATE`);
      const [work] = await db.select().from(works).where(and(eq(works.tenantId, ctx.tenantId), eq(works.id, workId))).limit(1);
      if (!work) throw new Error("Work not found");
      const [loop] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.workId, workId))).limit(1);
      if (!loop) throw new Error("Objective Loop not found");

      const [existing] = await db.select().from(workObjectiveSteps).where(and(
        eq(workObjectiveSteps.tenantId, ctx.tenantId),
        eq(workObjectiveSteps.objectiveLoopId, loop.id),
        eq(workObjectiveSteps.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (existing) {
        const metadata = objectValue(existing.decision).fixture;
        return {
          ok: true,
          scenario: fixture,
          nonce,
          workId,
          objectiveLoopId: loop.id,
          objectiveStepId: existing.id,
          ...(objectValue(metadata) as Omit<FixtureResponse, "ok" | "scenario" | "nonce" | "workId" | "objectiveLoopId" | "objectiveStepId">),
        };
      }

      const now = new Date();
      const stepId = randomUUID();
      const actionId = fixture === "failed-action-recovery" || fixture === "completed-verified-outcome" ? randomUUID() : undefined;
      const effectId = fixture === "completed-verified-outcome" ? randomUUID() : undefined;
      const receiptId = fixture === "completed-verified-outcome" ? randomUUID() : undefined;
      const failure = fixture === "provider-unavailable"
        ? { code: "provider_unavailable", provider: "product-truth-fixture", retryable: true, nonce }
        : fixture === "blocked-objective"
          ? { code: "required_integration_unavailable", reason: "deterministic Product Truth block fixture", nonce }
          : fixture === "failed-action-recovery"
            ? { code: "provider_action_failed", provider: "product-truth-fixture", nonce }
            : null;
      const expectedEventType = "product_truth.external_response";
      const correlationId = `product-truth:${fixture}:${nonce}`;
      const conditionSummary = `Product Truth fixture ${fixture} waits for the exact external response correlation ${correlationId}`;

      const stepPhase = fixture === "external-wait" || fixture === "external-wake" ? "observing" : fixture === "completed-verified-outcome" ? "finished" : fixture === "failed-action-recovery" ? "deciding" : "finished";
      const decisionKind = fixture === "external-wait" || fixture === "external-wake" ? "wait" : fixture === "completed-verified-outcome" ? "complete" : fixture === "failed-action-recovery" ? "action" : "block";
      const iterationOutcome = fixture === "external-wait" ? "waiting" : fixture === "external-wake" ? "continue" : fixture === "failed-action-recovery" ? "continue" : fixture === "completed-verified-outcome" ? "completed" : "blocked";
      const recoveryKind = fixture === "failed-action-recovery" ? "recover" : null;
      const successVerification = fixture === "completed-verified-outcome" ? { state: "verified", receiptId, effectId, marker: nonce } : null;
      const decision = {
        fixture: { ...(actionId ? { actionId } : {}), ...(effectId ? { effectId } : {}), ...(receiptId ? { receiptId } : {}), expectedEventType, conditionSummary },
        scenario: fixture,
        nonce,
      };
      await db.insert(workObjectiveSteps).values({
        id: stepId,
        tenantId: ctx.tenantId,
        objectiveLoopId: loop.id,
        workId,
        stepNumber: loop.stepCount + 1,
        idempotencyKey,
        phase: stepPhase,
        inspection: { source: "product-truth-fixture", nonce },
        inspectionHash: digest(`product-truth:${fixture}:${nonce}:inspection`),
        decisionKind,
        decision,
        decisionReason: fixture === "failed-action-recovery" ? "The provider action failed; recover and reconcile before claiming success." : conditionSummary,
        domainActionId: null,
        observation: { source: "product-truth-fixture", nonce },
        progressMade: fixture === "completed-verified-outcome" || fixture === "external-wake",
        iterationOutcome,
        recoveryKind,
        successVerification,
        failure,
        // Keep the step open until an optional DomainAction is bound. The scope
        // trigger intentionally rejects actions attached to a completed step.
        completedAt: null,
      });

      // The objective-action scope trigger requires the step to exist before a
      // DomainAction can bind to it. Insert the step first, then bind the action
      // and (for the verified row) its immutable Business Effect and receipt.
      if (actionId) {
        await db.insert(domainActions).values({
          id: actionId,
          tenantId: ctx.tenantId,
          actionType: fixture === "completed-verified-outcome" ? "product_truth_verified_outcome" : "product_truth_failed_provider_action",
          payload: { fixture, nonce },
          status: fixture === "completed-verified-outcome" ? "completed" : "failed",
          summary: fixture === "completed-verified-outcome" ? "Verified Product Truth fixture outcome" : "Deterministic failed provider action requiring recovery",
          workId,
          objectiveStepId: stepId,
        });
        await db.update(workObjectiveSteps).set({ domainActionId: actionId }).where(and(eq(workObjectiveSteps.tenantId, ctx.tenantId), eq(workObjectiveSteps.id, stepId)));
      }
      if (effectId && actionId && receiptId) {
        const semanticHash = digest(`product-truth:${fixture}:${nonce}:semantic`);
        const scopeHash = digest(`product-truth:${fixture}:${nonce}:scope`);
        await db.insert(businessEffects).values({
          id: effectId,
          tenantId: ctx.tenantId,
          domainActionId: actionId,
          semanticHash,
          scopeHash,
          operationClass: "internal_draft",
          effect: {
            fixture,
            nonce,
            verified: true,
            source: { domainActionId: actionId, workId, objectiveStepId: stepId },
          },
          status: "verified",
          observedResult: { marker: nonce, source: "product-truth-fixture" },
          verification: { state: "verified", evidence: [{ kind: "deterministic_fixture", nonce }] },
          observedAt: now,
        });
        await db.update(domainActions).set({ businessEffectId: effectId }).where(and(eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.id, actionId)));
        await db.insert(decisionReceipts).values({
          id: receiptId,
          tenantId: ctx.tenantId,
          domainActionId: actionId,
          workId,
          objective: loop.objective,
          evidence: [{ kind: "business_effect", id: effectId }, { kind: "deterministic_fixture", nonce }],
          riskTier: "low",
          proposedAction: { fixture, nonce },
          approval: { required: false },
          expectedResult: { state: "verified", marker: nonce },
          actualResult: { state: "verified", marker: nonce },
          verification: { state: "verified", evidence: [{ kind: "business_effect", id: effectId }] },
          businessEffectId: effectId,
          finalizedAt: now,
        });
      }
      if (fixture !== "external-wait" && fixture !== "external-wake") {
        await db.update(workObjectiveSteps).set({ completedAt: now }).where(and(eq(workObjectiveSteps.tenantId, ctx.tenantId), eq(workObjectiveSteps.id, stepId)));
      }

      if (fixture === "provider-unavailable") {
        await db.insert(workObjectivePlannerAttempts).values({
          tenantId: ctx.tenantId,
          objectiveLoopId: loop.id,
          objectiveStepId: stepId,
          attempt: 1,
          status: "failed",
          provider: "product-truth-fixture",
          inspectionHash: digest(`product-truth:${fixture}:${nonce}:inspection`),
          failure,
          startedAt: now,
          completedAt: now,
        });
      }

      let waitId: string | undefined;
      let eventId: string | undefined;
      let wakeClaimId: string | undefined;
      if (fixture === "external-wait" || fixture === "external-wake") {
        await db.update(workObjectiveLoops).set({
          state: "waiting",
          revision: loop.revision + 1,
          stepCount: loop.stepCount + 1,
          reason: "Waiting for the exact Product Truth external event correlation.",
          nextStep: "Reinspect the matched canonical event before continuing.",
          nextRunAt: null,
          lastObservation: { fixture, nonce },
          updatedAt: now,
        }).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.id, loop.id), eq(workObjectiveLoops.revision, loop.revision)));
        const waitResult = await createWorkEventWaitTx(db, {
          tenantId: ctx.tenantId,
          workId,
          objectiveLoopId: loop.id,
          objectiveStepId: stepId,
          waitFor: { eventType: expectedEventType, correlationId },
          conditionSummary,
          earliestAt: now,
        });
        waitId = waitResult.wait.id;
        if (fixture === "external-wake") {
          const ingested = await ingestIntegrationEventTx(db, {
            tenantId: ctx.tenantId,
            source: "product-truth-fixture",
            provider: "product-truth-fixture",
            sourceEventId: `product-truth:${fixture}:${nonce}`,
            eventType: expectedEventType,
            occurredAt: new Date(now.getTime() + 1),
            workId,
            correlationId,
            payload: { fixture, nonce, deterministic: true },
            trustClass: "trusted_runtime",
          });
          eventId = ingested.eventId;
          wakeClaimId = ingested.wakeClaimIds[0];
          if (!wakeClaimId) throw new Error("Product Truth external-wake fixture did not create a semantic wake claim");
          await db.update(workObjectiveSteps).set({ decision: { ...decision, fixture: { ...objectValue(decision.fixture), waitId, eventId, wakeClaimId } } }).where(and(eq(workObjectiveSteps.tenantId, ctx.tenantId), eq(workObjectiveSteps.id, stepId)));
        }
      } else {
        const targetStatus = fixture === "blocked-objective" || fixture === "provider-unavailable" ? "blocked" : fixture === "failed-action-recovery" ? "recovery" : "completed";
        await db.update(workObjectiveLoops).set({
          state: fixture === "completed-verified-outcome" ? "completed" : fixture === "failed-action-recovery" ? "continue" : "blocked",
          revision: loop.revision + 1,
          stepCount: loop.stepCount + 1,
          actionCount: actionId ? loop.actionCount + 1 : loop.actionCount,
          reason: fixture === "completed-verified-outcome" ? "Completed only after the canonical business effect and receipt were verified." : failure ? String(failure.code) : "Deterministic Product Truth blocked state.",
          nextStep: fixture === "failed-action-recovery" ? "Reconcile the failed action and replan from its durable failure evidence." : null,
          nextRunAt: fixture === "failed-action-recovery" ? new Date(now.getTime() + 60 * 60 * 1000) : null,
          lastObservation: { fixture, nonce },
          successVerification,
          successVerifiedAt: fixture === "completed-verified-outcome" ? now : null,
          completedAt: fixture === "completed-verified-outcome" ? now : null,
          updatedAt: now,
        }).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.id, loop.id), eq(workObjectiveLoops.revision, loop.revision)));
        await db.update(works).set({
          status: targetStatus,
          ...(failure ? { failure } : {}),
          ...(fixture === "failed-action-recovery" ? { recovery: { kind: "recover", failedActionId: actionId, reason: "Provider action failed; recovery is required before completion.", nonce } } : {}),
          ...(fixture === "completed-verified-outcome" ? { finalOutcome: { state: "completed", verification: successVerification, receiptId, effectId, nonce } } : {}),
          updatedAt: now,
        }).where(and(eq(works.tenantId, ctx.tenantId), eq(works.id, workId)));
        await appendWorkEventTx(db, ctx.tenantId, workId, `product_truth_fixture_${fixture.replaceAll("-", "_")}`, targetStatus, { fixture, nonce, objectiveLoopId: loop.id, objectiveStepId: stepId });
      }

      if (fixture === "external-wait") {
        await db.update(workObjectiveSteps).set({ decision: { ...decision, fixture: { ...objectValue(decision.fixture), waitId } } }).where(and(eq(workObjectiveSteps.tenantId, ctx.tenantId), eq(workObjectiveSteps.id, stepId)));
        await db.update(works).set({ status: "waiting", updatedAt: now }).where(and(eq(works.tenantId, ctx.tenantId), eq(works.id, workId)));
        await appendWorkEventTx(db, ctx.tenantId, workId, "product_truth_fixture_external_wait", "waiting", { fixture, nonce, objectiveLoopId: loop.id, objectiveStepId: stepId, waitId });
      }
      if (fixture === "external-wake") {
        const [freshLoop] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.id, loop.id))).limit(1);
        await db.update(workObjectiveLoops).set({ lastObservation: { fixture, nonce, waitId, eventId, wakeClaimId }, updatedAt: now }).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.id, loop.id), eq(workObjectiveLoops.revision, freshLoop?.revision ?? loop.revision + 1)));
      }
      return {
        ok: true,
        scenario: fixture,
        nonce,
        workId,
        objectiveLoopId: loop.id,
        objectiveStepId: stepId,
        ...(waitId ? { waitId } : {}),
        ...(eventId ? { eventId } : {}),
        ...(wakeClaimId ? { wakeClaimId } : {}),
        ...(actionId ? { actionId } : {}),
        ...(effectId ? { effectId } : {}),
        ...(receiptId ? { receiptId } : {}),
        ...(fixture === "external-wait" || fixture === "external-wake" ? { expectedEventType, conditionSummary } : {}),
      };
    });
    return Response.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
