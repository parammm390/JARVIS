// daily_scorecard job (Phase 8, §8.3): writes one real readiness_log row per tenant
// per calendar day, computed from the SAME reliability() read-model every hourly
// alert scan already uses — never a second, divergent computation of the same
// numbers. One row per (tenant, day): re-running the same day (a retried job, or a
// manual re-run) upserts in place rather than duplicating, so this is safe to run
// more than once for the same day.
//
// Deliberately does NOT recompute the retrieval-eval score (§5.7's ≥85% CI gate) —
// that's a fixed 40-fixture eval against a real embedding provider, expensive to run
// daily and already gated in CI on every push. The certification doc cites the CI
// eval score directly rather than this table duplicating it.

import { withTenant, readinessLog, llmCalls } from "@finnor/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { reliability } from "@finnor/read-models";
import type { JobHandler } from "../queue";

export const dailyScorecard: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("daily_scorecard requires tenantId");

  const metrics = await reliability(tenantId, 1);
  const logDate = new Date().toISOString().slice(0, 10);
  const start = new Date(`${logDate}T00:00:00.000Z`);
  const [llm] = await withTenant(tenantId, (db) => db.select({ calls: sql<number>`count(*)`, spend: sql<number | null>`sum(${llmCalls.costUsd})` }).from(llmCalls).where(and(eq(llmCalls.tenantId, tenantId), gte(llmCalls.createdAt, start))));

  await withTenant(tenantId, (db) =>
    db
      .insert(readinessLog)
      .values({
        tenantId,
        logDate,
        workflowSuccessRate: metrics.workflowSuccessRate,
        stepLatencyP95Ms: metrics.stepLatencyMs.p95,
        retryRate: metrics.retryRate,
        humanInterventionRate: metrics.humanInterventionRate,
        reconciliationBacklog: metrics.reconciliationBacklog,
        dlqDepth: metrics.dlqDepth,
        receiptCompleteness: metrics.receiptCompleteness,
        llmSpendUsd: llm?.spend === null || llm?.spend === undefined ? null : Number(llm.spend),
        llmCalls: Number(llm?.calls ?? 0),
      })
      .onConflictDoUpdate({
        target: [readinessLog.tenantId, readinessLog.logDate],
        set: {
          workflowSuccessRate: metrics.workflowSuccessRate,
          stepLatencyP95Ms: metrics.stepLatencyMs.p95,
          retryRate: metrics.retryRate,
          humanInterventionRate: metrics.humanInterventionRate,
          reconciliationBacklog: metrics.reconciliationBacklog,
          dlqDepth: metrics.dlqDepth,
          receiptCompleteness: metrics.receiptCompleteness,
          llmSpendUsd: llm?.spend === null || llm?.spend === undefined ? null : Number(llm.spend),
          llmCalls: Number(llm?.calls ?? 0),
        },
      }),
  );
};
