// P3.T5 — preserve the exact observed state of the interrupted deterministic run.
//
// This artifact is a hard prerequisite for any later 44-row rerun. It deliberately
// distinguishes terminal failures, the row that was interrupted, and rows that
// were never attempted. No row is silently converted into a PASS or FAIL.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..", "..");
const CORPUS_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-e2e-cases.json");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-t5-known-action-interrupted.json");
const EVIDENCE_PATH = resolve(REPO_ROOT, "docs/release/evidence/P3/p3-t5-known-action-interrupted-20260807.txt");

type CorpusRow = {
  actionType: string;
  tenant: string;
  expectedTerminalStatus: string;
};

type ObservedState = "PASS" | "FAIL" | "INTERRUPTED" | "NOT_RUN";

const observed: Record<number, {
  state: ObservedState;
  actionStatus: string | null;
  elapsedMs: number | null;
  reason?: string;
}> = {
  18: {
    state: "FAIL",
    actionStatus: "draft",
    elapsedMs: 5182,
    reason: "deterministic runner emitted FAIL; persisted action remained draft",
  },
  19: {
    state: "FAIL",
    actionStatus: "draft",
    elapsedMs: 5128,
    reason: "deterministic runner emitted FAIL; persisted action remained draft",
  },
  20: {
    state: "FAIL",
    actionStatus: "needs_human_review",
    elapsedMs: 69168,
    reason: "deterministic runner emitted FAIL; persisted action ended needs_human_review",
  },
  23: {
    state: "INTERRUPTED",
    actionStatus: "executing",
    elapsedMs: null,
    reason: "runner was stopped after launch_ad_campaign exceeded the available bounded observation window; no terminal row was emitted",
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function corpusRows(value: unknown): CorpusRow[] {
  const root = record(value);
  const rows = Array.isArray(value) ? value : root.cases;
  if (!Array.isArray(rows)) throw new Error("P3 corpus is not an array or {cases: []}");
  return rows.map((entry) => {
    const row = record(entry);
    if (typeof row.actionType !== "string" || typeof row.tenant !== "string" || typeof row.expectedTerminalStatus !== "string") {
      throw new Error("P3 corpus contains an incomplete row");
    }
    return {
      actionType: row.actionType,
      tenant: row.tenant,
      expectedTerminalStatus: row.expectedTerminalStatus,
    };
  });
}

async function main(): Promise<void> {
  const cases = corpusRows(JSON.parse(await readFile(CORPUS_PATH, "utf8")) as unknown);
  if (cases.length !== 44) throw new Error(`P3 corpus has ${cases.length} rows; expected 44`);

  const rows = cases.map((row, index) => {
    const number = index + 1;
    const special = observed[number];
    const state: ObservedState = special?.state ?? (number <= 17 || number === 21 || number === 22 ? "PASS" : "NOT_RUN");
    return {
      number,
      actionType: row.actionType,
      tenant: row.tenant,
      expectedTerminalStatus: row.expectedTerminalStatus,
      state,
      attempted: state !== "NOT_RUN",
      actionStatus: special?.actionStatus ?? (state === "PASS" ? "completed" : null),
      elapsedMs: special?.elapsedMs ?? null,
      reason: special?.reason ?? (state === "PASS" ? "runner emitted PASS" : "row was not reached before the runner stopped"),
      executionPath: "draftKnownAction",
      plannerInvoked: false,
    };
  });

  const report = {
    phase: "P3",
    task: "P3.T5",
    gate: "known-action-e2e",
    status: "INTERRUPTED",
    pass: false,
    source: "corrected deterministic draftKnownAction matrix attempt",
    priorFailurePreflight: "docs/release/generated/p3-t5-failing-rows-before-known-action.json",
    exactRows: 44,
    observedRows: rows.filter((row) => row.attempted).length,
    passRows: rows.filter((row) => row.state === "PASS").length,
    failRows: rows.filter((row) => row.state === "FAIL").length,
    interruptedRows: rows.filter((row) => row.state === "INTERRUPTED").length,
    notRunRows: rows.filter((row) => row.state === "NOT_RUN").length,
    stopReason: "row 23 launch_ad_campaign did not return a terminal result within the bounded observation window; the process was stopped",
    noFullRerunBeforeThisReport: true,
    plannerInvocations: 0,
    rows,
    nonPassRows: rows.filter((row) => row.state !== "PASS").map((row) => ({
      number: row.number,
      actionType: row.actionType,
      tenant: row.tenant,
      state: row.state,
      actionStatus: row.actionStatus,
      elapsedMs: row.elapsedMs,
      reason: row.reason,
    })),
    evidence: "docs/release/evidence/P3/p3-t5-known-action-interrupted-20260807.txt",
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [
    "P3.T5 — EXACT INTERRUPTED-ROW REPORT BEFORE ANY FURTHER MATRIX RERUN",
    `generatedAt=${new Date().toISOString()}`,
    `source=${report.source}`,
    `gate=${report.gate} status=${report.status} pass=${report.pass}`,
    `exactRows=${report.exactRows} observedRows=${report.observedRows} passRows=${report.passRows} failRows=${report.failRows} interruptedRows=${report.interruptedRows} notRunRows=${report.notRunRows}`,
    `stopReason=${report.stopReason}`,
    "",
    "number action tenant expectedStatus state attempted actionStatus elapsedMs reason",
    ...rows.map((row) => [
      row.number, row.actionType, row.tenant, row.expectedTerminalStatus, row.state,
      row.attempted, row.actionStatus ?? "null", row.elapsedMs ?? "null", row.reason,
    ].map((value) => String(value).replace(/[^A-Za-z0-9 _.:-]/g, "")).join(" ")),
    "",
    "This is an interruption/failure artifact, not a certification claim. Rows 24–44 were not run. The next full matrix run is forbidden until the targeted harness repair is validated.",
  ];
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`P3_T5_INTERRUPTED_REPORT_PASS exactRows=${report.exactRows} nonPassRows=${report.nonPassRows.length} output=docs/release/generated/p3-t5-known-action-interrupted.json`);
}

main().catch((error) => {
  console.error(`P3_T5_INTERRUPTED_REPORT_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
