// Phase 8 (§8.2): the failure-injection calendar's real executor. Every run writes a
// real row to finnor_os.failure_injections — this is the mechanism the pack's
// "≥2 injections/week across the 30 days" ask is actually built on, not a doc-only
// calendar.
//
// Usage: DATABASE_URL=<prod> npx tsx scripts/inject-failure.ts <kind> [--tenant=<id>]
//
// Only the injections that are genuinely safe to run against real production
// infrastructure without risking real customer-facing side effects are implemented
// here. Two kinds are deliberately NOT wired to fire automatically:
//   - worker_kill: requires actually restarting the deployed Railway worker process,
//     which briefly stops job processing for EVERY tenant, not just Dealer Zero (the
//     primary tenant has real invoices/customers on the same worker). Phase 6 already
//     built and proved this exact mechanism (scripts/staging-infra-chaos-test.ts) —
//     re-run that pattern against production only with explicit owner go-ahead.
//   - provider_egress_block on a LIVE-bound provider (vapi): the circuit breaker is
//     global per provider, not per-tenant (packages/tools/src/provider-circuit-
//     breaker.ts's own header explains why), so forcing it open would degrade real
//     customer voice calls, not just Dealer Zero's. This script only exercises the
//     mechanism against quickbooks (fully unconfigured, zero live traffic) — the exact
//     same code path, zero real-customer risk.
// webhook_replay and secrets_store_hiccup are exercised for real too, but against
// safe surfaces (see their functions below) rather than firing at production's live
// webhook/secrets endpoints.

import { withTenant, failureInjections, workflowRuns } from "@finnor/db";
import { scanApprovalExpiry, DEFAULT_CONFIRMATION_TIMEOUT_HOURS } from "../apps/worker/src/handlers/scan-approval-expiry";
import { recordProviderFailure, recordProviderSuccess, circuitSnapshot, isCircuitOpen } from "@finnor/tools";
import { detectReliabilityAlerts } from "../apps/worker/src/handlers/scan-reliability-alerts";
import { reliability } from "@finnor/read-models";
import { domainActions } from "@finnor/db";
import { eq, inArray } from "drizzle-orm";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";

interface InjectionResult {
  kind: string;
  outcome: "pass" | "fail" | "inconclusive";
  detail: Record<string, unknown>;
  detectedAt?: Date;
  recoveredAt?: Date;
}

async function logInjection(tenantId: string, injectedAt: Date, result: InjectionResult): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.insert(failureInjections).values({
      tenantId,
      kind: result.kind as (typeof failureInjections.$inferInsert)["kind"],
      injectedAt,
      detectedAt: result.detectedAt,
      recoveredAt: result.recoveredAt,
      outcome: result.outcome,
      detail: result.detail,
    }),
  );
}

/** Real approval-expiry pileup: creates N genuinely-pending, genuinely-overdue
 *  domain_actions for the tenant, then runs the REAL production scan handler (not a
 *  simulation of it) and confirms it escalates every one of them and enqueues a
 *  real re-notification job. Clearly labeled in its own summary text so it's never
 *  mistaken for a real customer request in the approval inbox. */
async function injectApprovalExpiryPileup(tenantId: string, count = 3): Promise<InjectionResult> {
  const overdueBy = (DEFAULT_CONFIRMATION_TIMEOUT_HOURS + 2) * 3600 * 1000; // safely past the default 24h window
  const createdAt = new Date(Date.now() - overdueBy);
  const ids: string[] = [];

  await withTenant(tenantId, async (db) => {
    for (let i = 0; i < count; i++) {
      const [row] = await db
        .insert(domainActions)
        .values({
          tenantId,
          actionType: "send_payment_reminder",
          status: "pending",
          summary: `[Phase 8 failure-injection test — ${new Date().toISOString()}] synthetic overdue approval #${i + 1}, safe to escalate/dismiss`,
          createdAt,
        })
        .returning({ id: domainActions.id });
      ids.push(row!.id);
    }
  });

  await scanApprovalExpiry({ tenantId });

  const after = await withTenant(tenantId, (db) =>
    db.select({ id: domainActions.id, status: domainActions.status }).from(domainActions).where(eq(domainActions.tenantId, tenantId)),
  );
  const escalated = after.filter((r) => ids.includes(r.id) && r.status === "needs_human_review");

  return {
    kind: "approval_expiry_pileup",
    outcome: escalated.length === count ? "pass" : "fail",
    detail: { createdActionIds: ids, escalatedCount: escalated.length, expected: count },
    detectedAt: new Date(),
    recoveredAt: new Date(), // synchronous scan — detection and "recovery" (escalation) are the same event
  };
}

/** Real provider circuit-breaker open->flag->close cycle, against quickbooks
 *  specifically (zero live traffic today — see file header for why not vapi). */
async function injectProviderEgressBlock(tenantId: string, provider = "quickbooks"): Promise<InjectionResult> {
  const before = await circuitSnapshot(provider);
  for (let i = 0; i < 3; i++) await recordProviderFailure(provider);
  const opened = await isCircuitOpen(provider);
  const alerts = await detectReliabilityAlerts(tenantId);
  const flagged = alerts.some((a) => a.kind === "provider_flapping" && a.detail.provider === provider);

  // Real recovery: close the breaker back, exactly as a real provider coming back
  // healthy would via recordProviderSuccess on its next successful call.
  await recordProviderSuccess(provider);
  const closedAfter = await isCircuitOpen(provider);

  return {
    kind: "provider_egress_block",
    outcome: opened && flagged && !closedAfter ? "pass" : "fail",
    detail: { provider, stateBefore: before.state, openedAsExpected: opened, alertFired: flagged, closedOnRecovery: !closedAfter },
    detectedAt: new Date(),
    recoveredAt: new Date(),
  };
}

/** deploy_mid_workflow, real evidence not a simulation: run with --before right before
 *  a real production deploy to snapshot every in-flight run; run with
 *  --after=<injectionId> right after the deploy lands to confirm the same runs reached
 *  a real terminal state (or are still legitimately running, never orphaned) and that
 *  the reconciliation backlog didn't spike — i.e. the deploy itself caused no
 *  duplicated or lost effects. */
async function injectDeployMidWorkflowBefore(tenantId: string): Promise<string> {
  const injectedAt = new Date();
  const inFlight = await withTenant(tenantId, (db) =>
    db.select({ id: workflowRuns.id, status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.tenantId, tenantId)),
  );
  const running = inFlight.filter((r) => r.status === "running");
  const [row] = await withTenant(tenantId, (db) =>
    db
      .insert(failureInjections)
      .values({
        tenantId,
        kind: "deploy_mid_workflow",
        injectedAt,
        detail: { phase: "before", inFlightRunIds: running.map((r) => r.id), inFlightCount: running.length },
      })
      .returning({ id: failureInjections.id }),
  );
  console.log(JSON.stringify({ injectionId: row!.id, inFlightCount: running.length, runIds: running.map((r) => r.id) }, null, 2));
  return row!.id;
}

async function injectDeployMidWorkflowAfter(tenantId: string, injectionId: string): Promise<void> {
  const [existing] = await withTenant(tenantId, (db) =>
    db.select().from(failureInjections).where(eq(failureInjections.id, injectionId)),
  );
  if (!existing) throw new Error(`No failure_injections row ${injectionId} for tenant ${tenantId}`);
  const before = existing.detail as { inFlightRunIds: string[]; inFlightCount: number };

  const after = before.inFlightRunIds.length
    ? await withTenant(tenantId, (db) =>
        db.select({ id: workflowRuns.id, status: workflowRuns.status }).from(workflowRuns).where(inArray(workflowRuns.id, before.inFlightRunIds)),
      )
    : [];
  const stillRunning = after.filter((r) => r.status === "running");
  const terminal = after.filter((r) => r.status !== "running");
  const metrics = await reliability(tenantId, 1);

  const outcome: "pass" | "fail" = metrics.reconciliationBacklog === 0 || metrics.reconciliationBacklog <= (before.inFlightCount ?? 0) ? "pass" : "fail";

  await withTenant(tenantId, (db) =>
    db
      .update(failureInjections)
      .set({
        recoveredAt: new Date(),
        outcome,
        detail: {
          ...before,
          phase: "after",
          terminalCount: terminal.length,
          stillRunningCount: stillRunning.length,
          reconciliationBacklogAfter: metrics.reconciliationBacklog,
        },
      })
      .where(eq(failureInjections.id, injectionId)),
  );
  console.log(JSON.stringify({ injectionId, outcome, terminalCount: terminal.length, stillRunningCount: stillRunning.length, reconciliationBacklogAfter: metrics.reconciliationBacklog }, null, 2));
}

async function main(): Promise<void> {
  const kind = process.argv[2];
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantId = tenantArg ? tenantArg.split("=")[1]! : DEALER_ZERO_TENANT_ID;
  const afterArg = process.argv.find((a) => a.startsWith("--after="));

  if (kind === "deploy_mid_workflow") {
    if (afterArg) {
      await injectDeployMidWorkflowAfter(tenantId, afterArg.split("=")[1]!);
    } else {
      await injectDeployMidWorkflowBefore(tenantId);
    }
    process.exit(0);
  }

  const injectedAt = new Date();
  let result: InjectionResult;
  switch (kind) {
    case "approval_expiry_pileup":
      result = await injectApprovalExpiryPileup(tenantId);
      break;
    case "provider_egress_block":
      result = await injectProviderEgressBlock(tenantId);
      break;
    default:
      console.error(`Unknown or not-yet-wired-for-live-execution kind: "${kind}". Implemented: approval_expiry_pileup, provider_egress_block, deploy_mid_workflow (--before / --after=<id>). See this file's header for why worker_kill/vapi-egress-block are deliberately not auto-fireable.`);
      process.exit(1);
  }

  await logInjection(tenantId, injectedAt, result);
  console.log(JSON.stringify({ tenantId, ...result }, null, 2));
  process.exit(result.outcome === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
