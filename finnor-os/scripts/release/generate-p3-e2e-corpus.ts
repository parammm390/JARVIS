// P3.T5 — generate the staging E2E case corpus from the fixed action spec and
// the shared certification fixtures. This is deliberately generated rather than
// hand-maintained: the corpus cannot drift from the 44-action contract.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { LEGACY_ACTION_HARDENING_SPEC as ACTION_HARDENING_SPEC } from "./action-hardening-spec";
import { buildActionFixture } from "./run-action-contract-matrix";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = resolve(SCRIPT_DIR, "../..", "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-e2e-cases.json");

const noApprovalActions = new Set(ACTION_HARDENING_SPEC.filter((row) => row.approvalFloor === "NONE").map((row) => row.actionType));
const typedApprovalActions = new Set(ACTION_HARDENING_SPEC.filter((row) => row.approvalFloor === "TYPED_REQUIRED").map((row) => row.actionType));

function tenantFor(actionType: string): "alpha" | "bravo" | "charlie" {
  // These two rows have no Alpha-only entity identifiers and deliberately prove
  // that the authenticated Bravo and Charlie contexts traverse the same API path.
  if (actionType === "get_business_overview") return "bravo";
  if (actionType === "check_stock_level") return "charlie";
  return "alpha";
}

function fixtureFor(actionType: string): Record<string, unknown> {
  if (actionType === "get_business_overview") return { focus: "pending" };
  if (actionType === "check_stock_level") return { sku: "SED-FILT-10" };
  return buildActionFixture(actionType);
}

function instructionFor(actionType: string, payload: Record<string, unknown>): string {
  return [
    "For isolated staging certification, execute exactly the named action type below.",
    `action_type=${actionType}`,
    "Use this exact JSON payload and do not select a different action:",
    JSON.stringify(payload),
  ].join("\n");
}

async function main(): Promise<void> {
  const cases = ACTION_HARDENING_SPEC.map((row) => {
    const actionType = row.actionType;
    const confirmation = noApprovalActions.has(actionType) ? "none" : "approve";
    return {
      actionType,
      instruction: instructionFor(actionType, fixtureFor(actionType)),
      tenant: tenantFor(actionType),
      channel: "text",
      expectedTerminalStatus: "completed",
      confirmation,
      typedConfirmation: typedApprovalActions.has(actionType),
    };
  });
  const report = {
    phase: "P3",
    generatedFrom: [
      "finnor-os/scripts/release/action-hardening-spec.ts",
      "finnor-os/scripts/release/run-action-contract-matrix.ts#buildActionFixture",
    ],
    syntheticOnly: true,
    cases,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`P3_E2E_CORPUS_PASS rows=${cases.length} tenants=${new Set(cases.map((row) => row.tenant)).size} output=docs/release/generated/p3-e2e-cases.json`);
}

main().catch((error) => {
  console.error(`P3_E2E_CORPUS_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
