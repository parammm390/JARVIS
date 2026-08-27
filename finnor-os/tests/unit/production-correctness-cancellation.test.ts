import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isInstructionCancellationPayload } from "../../packages/orchestration/src/instruction-trace";

describe("production-correctness cancellation fence", () => {
  it("distinguishes canonical instruction cancellation from action-scoped rejection", () => {
    expect(isInstructionCancellationPayload({ fence: true, canonical: false })).toBe(true);
    expect(isInstructionCancellationPayload({ canonical: true })).toBe(true);
    expect(isInstructionCancellationPayload({ actionId: "action-1" })).toBe(false);
  });

  it("uses one canonical existence query and fails closed when cancellation truth is unavailable", async () => {
    const traceSource = await readFile(new URL("../../packages/orchestration/src/instruction-trace.ts", import.meta.url), "utf8");
    const cancelRouteSource = await readFile(new URL("../../apps/api/app/api/instructions/[id]/cancel/route.ts", import.meta.url), "utf8");

    expect(traceSource).not.toContain(".limit(100)");
    expect(traceSource).toContain(".limit(1)");
    expect(traceSource).toContain("cancellation lookup failed; refusing to continue");
    expect(traceSource).not.toContain("continuing as not cancelled");
    expect(cancelRouteSource).toContain("{ required: true }");
  });
});
