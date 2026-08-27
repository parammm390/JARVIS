import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const db = readFileSync(fileURLToPath(new URL("../../packages/db/index.ts", import.meta.url)), "utf8");
const worker = readFileSync(fileURLToPath(new URL("../../apps/worker/src/handlers/business-operation.ts", import.meta.url)), "utf8");
const cancelRoute = readFileSync(fileURLToPath(new URL("../../apps/api/app/api/instructions/[id]/cancel/route.ts", import.meta.url)), "utf8");

describe("production-correctness business-operation recovery", () => {
  const retry = db.slice(db.indexOf("export async function retryBusinessOperation"), db.indexOf("// ---------------------------------------------------------------------------\n// Upgrade 2"));

  it("locks and rejects recovery for terminal parent Work", () => {
    expect(retry.indexOf("businessOperations.id}=${params.operationId} FOR UPDATE")).toBeLessThan(retry.indexOf("schema.works.id}=${operation.workId} FOR UPDATE"));
    expect(retry).toContain("schema.works.id}=${operation.workId} FOR UPDATE");
    expect(retry).toContain('work.status === "cancelled" || work.status === "completed"');
  });

  it("keeps target attempts monotonic so recovery cannot reuse a consumed job key", () => {
    expect(retry).not.toContain("attempts: 0");
    expect(retry).toContain("maxAttempts: sql`${schema.businessOperationTargets.attempts} + 3`");
    expect(worker).toContain("target:${target.id}:attempt:${target.attempts}");
  });

  it("cancels review-held operations and settles defensive worker cancellation", () => {
    expect(cancelRoute.match(/\["awaiting_approval", "queued", "running", "needs_human_review"\]/g)).toHaveLength(2);
    const parentFence = worker.slice(worker.indexOf("async function operationWorkStillActive"), worker.indexOf("async function safetyCheck"));
    expect(parentFence).toContain('set({ status: "rejected", executionStartedAt: null })');
  });
});
