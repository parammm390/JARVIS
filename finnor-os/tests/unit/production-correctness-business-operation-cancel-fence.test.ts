import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const worker = readFileSync(fileURLToPath(new URL("../../apps/worker/src/handlers/business-operation.ts", import.meta.url)), "utf8");
const cancelRoute = readFileSync(fileURLToPath(new URL("../../apps/api/app/api/instructions/[id]/cancel/route.ts", import.meta.url)), "utf8");

describe("production-correctness business-operation cancellation fence", () => {
  it("serializes target claims and provider mutations on the operation row", () => {
    const fence = worker.slice(
      worker.indexOf("async function withActiveOperationEffectFence"),
      worker.indexOf("async function claimTarget("),
    );
    expect(fence).toContain("businessOperations.id}=${operationId} FOR UPDATE");
    expect(fence).toContain('["queued", "running"].includes(operation.status)');
    expect(fence).toContain('work.status === "cancelled" || work.status === "completed"');

    const sms = worker.slice(
      worker.indexOf("export async function executeBusinessOperationTarget"),
      worker.indexOf("export async function executeBusinessOperationCallBatch"),
    );
    expect(sms.indexOf("withActiveOperationEffectFence")).toBeLessThan(sms.indexOf('scoped.call("ghl_create_contact"'));
    expect(sms).toContain("claimTargetTx(db, tenantId, operationId, targetId)");

    const calls = worker.slice(worker.indexOf("export async function executeBusinessOperationCallBatch"));
    expect(calls.indexOf("withActiveOperationEffectFence")).toBeLessThan(calls.indexOf('scoped.call("vapi_create_campaign"'));
    expect(calls).toContain("claimTargetTx(db, tenantId, operationId, row.id)");
  });

  it("makes cancellation contend on the same operation row before terminal Work", () => {
    expect(cancelRoute).toContain("db.update(businessOperations).set({");
    expect(cancelRoute.indexOf("db.update(businessOperations).set({")).toBeLessThan(cancelRoute.indexOf("await transitionWork("));
  });
});
