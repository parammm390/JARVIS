// B6.T2: reports a candidate policy's counterfactual gate effect without executing
// or mutating historical actions. It is intentionally a report, never an auto-apply.
import { decisionReceipts, withTenant } from "@finnor/db";
import { and, eq, gte } from "drizzle-orm";

export async function simulatePolicy(tenantId: string, actionType: string, candidate: { requiresConfirmation: boolean }, now = new Date()) {
  const since = new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1000);
  const receipts = await withTenant(tenantId, (db) => db.select().from(decisionReceipts).where(and(eq(decisionReceipts.tenantId, tenantId), gte(decisionReceipts.createdAt, since))));
  const matching = receipts.filter((receipt) => (receipt.proposedAction as { actionType?: unknown }).actionType === actionType);
  // Receipt approval is the durable historical gate evidence; action status alone
  // cannot distinguish an ungated completion from an approved one.
  const historicalGated = matching.filter((receipt) => (receipt.approval as { required?: unknown }).required === true).length;
  const candidateGated = candidate.requiresConfirmation ? matching.length : 0;
  return { actionType, window: { from: since.toISOString(), to: now.toISOString() }, evaluatedReceipts: matching.length, historicalGated, candidateGated, gateDelta: candidateGated - historicalGated, candidate: { requiresConfirmation: candidate.requiresConfirmation }, simulated: true };
}
