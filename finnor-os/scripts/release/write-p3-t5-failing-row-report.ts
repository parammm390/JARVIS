// P3.T5 preflight: preserve the exact failing rows from the prior planner-path
// attempt before any corrected full-matrix execution. This is deliberately a
// separate artifact from the deterministic known-action report.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..", "..");
const SOURCE_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-api-e2e-results.json");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-t5-failing-rows-before-known-action.json");
const EVIDENCE_PATH = resolve(REPO_ROOT, "docs/release/evidence/P3/p3-t5-failing-rows-before-known-action-20260807.txt");

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function safe(value: unknown): string {
  return String(value ?? "null").replace(/[^A-Za-z0-9 _.:-]/g, "");
}

async function main(): Promise<void> {
  const source = record(JSON.parse(await readFile(SOURCE_PATH, "utf8")) as unknown);
  const rows = Array.isArray(source.rows) ? source.rows.map(record) : [];
  if (source.gate !== "api-e2e" || source.status !== "FAIL" || rows.length !== 44) {
    throw new Error("prior planner-path report is not the exact 44-row FAIL report required for the corrected rerun");
  }
  const numberedRows: Array<Record<string, unknown>> = rows.map((row, index) => ({ ...row, number: index + 1 }));
  const failingRows = numberedRows.filter((row) => row["status"] !== "PASS");
  if (failingRows.length !== 44) {
    throw new Error(`prior planner-path report has ${failingRows.length}/44 failing rows; refusing to create an incomplete preflight report`);
  }

  const report = {
    phase: "P3",
    task: "P3.T5",
    purpose: "exact failing-row report required before corrected full-matrix rerun",
    generatedAt: new Date().toISOString(),
    sourceReport: "docs/release/generated/p3-api-e2e-results.json",
    sourceGate: source.gate,
    sourceStatus: source.status,
    priorHarness: "planner-path API E2E attempt; not deterministic known-action certification",
    rowCount: rows.length,
    failCount: failingRows.length,
    rows: failingRows,
    nextHarness: "draftKnownAction deterministic matrix; planner smoke is separate and bounded",
    evidence: "docs/release/evidence/P3/p3-t5-failing-rows-before-known-action-20260807.txt",
  };
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [
    "P3.T5 — EXACT FAILING-ROW PREFLIGHT BEFORE CORRECTED KNOWN-ACTION RERUN",
    `generatedAt=${report.generatedAt}`,
    `source=${report.sourceReport}`,
    `sourceGate=${source.gate} sourceStatus=${source.status}`,
    `priorHarness=${report.priorHarness}`,
    `rows=${rows.length} failures=${failingRows.length}`,
    "",
    "number action tenant requestStatus duplicateStatus observedStatus receiptVerified status error",
    ...failingRows.map((row) => [
      safe(row["number"]), safe(row["actionType"]), safe(row["tenant"]), safe(row["requestStatus"]),
      safe(row["duplicateStatus"]), safe(row["observedStatus"]), safe(row["receiptVerified"]),
      safe(row["status"]), safe(row["error"]),
    ].join(" ")),
    "",
    "This report is a preserved failure artifact, not a certification claim. The corrected rerun uses draftKnownAction and forbids planner invocation.",
  ];
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`P3_T5_FAILING_ROWS_PASS rows=${rows.length} failures=${failingRows.length} output=docs/release/generated/p3-t5-failing-rows-before-known-action.json`);
}

main().catch((error) => {
  console.error(`P3_T5_FAILING_ROWS_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
