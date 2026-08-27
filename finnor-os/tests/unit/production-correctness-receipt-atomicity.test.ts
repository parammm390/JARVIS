import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../packages/workflow-runtime/src/${path}`, import.meta.url)), "utf8");
}

describe("production-correctness DecisionReceipt atomicity", () => {
  it("claims a step and creates its receipt in one tenant transaction", () => {
    const steps = source("steps.ts");
    const claim = steps.slice(steps.indexOf("export async function claimStep"), steps.indexOf("function extractCitations"));

    expect(claim).toContain("if (claimed) await openReceiptForClaimTx(db, tenantId, claimed)");
    expect(claim).not.toMatch(/if \(claimed\) await openReceiptForClaimTx\([^\n]*\);\s*return claimed;/);
    expect(steps).not.toContain("failed to open receipt for step");
  });

  it("finalizes the receipt before the step terminal transaction can commit", () => {
    const steps = source("steps.ts");
    const complete = steps.slice(steps.indexOf("export async function completeStep"), steps.indexOf("export async function awaitStepObservation"));
    const fail = steps.slice(steps.indexOf("export async function failStep"), steps.indexOf("export async function advanceWorkflow"));

    expect(complete).toContain("await finalizeReceiptForStepTx(db, tenantId, stepId");
    expect(fail).toContain("await finalizeReceiptForStepTx(db, tenantId, stepId");
    expect(steps).not.toContain("no receipt found to finalize");
    expect(steps).not.toContain("failed to finalize receipt for step");
  });

  it("records pause/resume/cancel/retry/escalate receipts inside their mutation transactions", () => {
    const controls = source("run-controls.ts");

    expect(controls).toContain("if (row) await recordRunControlReceiptTx(");
    expect(controls.match(/await recordRunControlReceiptTx\(/g)).toHaveLength(3);
    expect(controls).not.toContain("openReceipt({");
    expect(controls).not.toContain(".then(({ receiptId })");
  });
});
