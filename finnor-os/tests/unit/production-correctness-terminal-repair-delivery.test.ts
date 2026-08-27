import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const steps = readFileSync(
  fileURLToPath(new URL("../../packages/workflow-runtime/src/steps.ts", import.meta.url)),
  "utf8",
);

describe("terminal workflow repair delivery", () => {
  it("commits the failed step receipt, Work recovery transition, and repair job in one tenant transaction", () => {
    const failStep = steps.slice(steps.indexOf("export async function failStep"), steps.indexOf("export async function advanceWorkflow"));

    expect(failStep).toContain("finalizeReceiptForStepTx(db");
    expect(failStep).toContain("transitionWorkTx(db");
    expect(failStep).toContain("db.insert(jobs)");
    expect(failStep).toContain('type: "repair_plan_after_terminal_failure"');
    expect(failStep).not.toContain(".catch(() => undefined)");
  });
});
