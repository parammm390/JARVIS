import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(fileURLToPath(new URL("../../packages/db/index.ts", import.meta.url)), "utf8");
const receiveWork = dbSource.slice(
  dbSource.indexOf("export async function receiveWork"),
  dbSource.indexOf("export async function handoffWork"),
);

describe("production-correctness receiveWork identity", () => {
  it("claims instruction and caller idempotency before creating Work", () => {
    const inputLookup = receiveWork.indexOf("const matchingInputs");
    const workCreation = receiveWork.indexOf(".insert(schema.works)");

    expect(receiveWork).toContain("pg_advisory_xact_lock");
    expect(receiveWork).toContain("instruction:${params.tenantId}:${desiredInstructionId}");
    expect(receiveWork).toContain("idempotency:${params.tenantId}:${params.idempotencyKey}");
    expect(inputLookup).toBeGreaterThan(-1);
    expect(inputLookup).toBeLessThan(workCreation);
  });

  it("assembles duplicate metadata only from the input's canonical Work", () => {
    const duplicateProjection = receiveWork.slice(
      receiveWork.indexOf("const duplicateForInput"),
      receiveWork.indexOf("const matchingInputs"),
    );

    expect(duplicateProjection).toContain("eq(schema.works.id, input.workId)");
    expect(duplicateProjection).toContain("workId: canonicalWork.id");
    expect(duplicateProjection).toContain("status: canonicalWork.status");
    expect(duplicateProjection).toContain("finalOutcome: canonicalWork.finalOutcome");
    expect(receiveWork).not.toContain("workId: raced.workId, workInputId: raced.id");
  });

  it("rejects contradictory instruction and idempotency claims instead of guessing", () => {
    expect(receiveWork).toContain("distinctInputs.length > 1");
    expect(receiveWork).toContain("idempotency claims resolve to different canonical inputs");
  });
});
