import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const db = readFileSync(fileURLToPath(new URL("../../packages/db/index.ts", import.meta.url)), "utf8");
const route = readFileSync(fileURLToPath(new URL("../../apps/api/app/api/works/[id]/retry/route.ts", import.meta.url)), "utf8");

describe("production-correctness Work recovery claim", () => {
  it("claims recovery and its exact durable input under one Work lock", () => {
    const claim = db.slice(db.indexOf("export async function claimWorkRecovery"), db.indexOf("export async function beginWorkPlannerAttempt"));
    expect(claim).toContain("schema.works.id}=${params.workId}");
    expect(claim).toContain("FOR UPDATE");
    expect(claim).toContain('work.status === "recovery" && !stale');
    expect(claim).toContain('work.status !== "failed" && work.status !== "recovery"');
    expect(claim).toContain("eq(schema.workInputs.workId, params.workId)");
    expect(claim.indexOf("db.select().from(schema.workInputs)")).toBeLessThan(claim.indexOf('status: "recovery"'));
    expect(claim).toContain("WORK_RECOVERY_CLAIM_TTL_MS");
  });

  it("does not perform a read-then-transition recovery in the HTTP route", () => {
    expect(route).toContain("await claimWorkRecovery({");
    expect(route).not.toContain("latestWorkInput");
    expect(route).not.toContain("transitionWork");
    expect(route).toContain("activeAttemptKey: claim.activeAttemptKey");
  });
});
