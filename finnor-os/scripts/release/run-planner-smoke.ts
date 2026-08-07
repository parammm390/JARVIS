// P3.T5 — bounded planner smoke suite.
//
// This suite intentionally exercises only one synthetic instruction per fixed
// action profile. It is a separate measurement from the 44-row deterministic
// known-action certification; planner latency/failures never get mixed into the
// core-path row count.

import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_HARDENING_SPEC, type ActionProfile } from "./action-hardening-spec";
import { evaluateStagingGuards, formatStagingGuardReport } from "./staging-guards";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-planner-smoke-results.json");
const EVIDENCE_PATH = resolve(REPO_ROOT, "docs/release/evidence/P3/p3-t5-planner-smoke-20260807.txt");

type TenantKey = "alpha" | "bravo" | "charlie";

interface SmokeCase {
  actionType: string;
  tenant: TenantKey;
  instruction: string;
}

interface PlannedAction {
  actionType: string;
  status: string | null;
}

interface SmokeRow {
  number: number;
  actionType: string;
  domain: string;
  profile: ActionProfile;
  tenant: TenantKey;
  requestStatus: number | null;
  elapsedMs: number | null;
  plannedActionTypes: string[];
  expectedActionPlanned: boolean;
  status: "PASS" | "FAIL";
  failure?: string;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "unknown error")
    .replace(/https?:\/\/[^\s)]+/g, "<url>")
    .replace(/[^A-Za-z0-9 _.:-]/g, "")
    .slice(0, 500);
}

function timeoutMs(): number {
  const configured = Number(process.env.P3_PLANNER_SMOKE_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 5_000), 120_000) : 120_000;
}

function tokenFor(tenant: TenantKey): string {
  const name = tenant === "alpha" ? "STAGING_JWT_ALPHA" : tenant === "bravo" ? "STAGING_JWT_BRAVO" : "STAGING_JWT_CHARLIE";
  const token = process.env[name];
  if (!token) throw new Error(`${name} is required; token value withheld`);
  return token;
}

function urlFor(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function plannedActions(body: unknown): PlannedAction[] {
  if (!body || typeof body !== "object") return [];
  const planned = (body as { planned?: unknown }).planned;
  if (!Array.isArray(planned)) return [];
  return planned.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const actionType = row.actionType ?? row.action_type;
    return typeof actionType === "string"
      ? [{ actionType, status: typeof row.status === "string" ? row.status : null }]
      : [];
  });
}

async function loadCases(): Promise<Map<string, SmokeCase>> {
  const path = process.env.P3_E2E_CASES_FILE;
  if (!path) throw new Error("P3_E2E_CASES_FILE is required; planner smoke has no instruction corpus");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const rows = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown })?.cases;
  if (!Array.isArray(rows) || rows.length !== ACTION_HARDENING_SPEC.length) throw new Error("planner smoke requires the exact 44-row generated corpus");
  const result = new Map<string, SmokeCase>();
  for (const value of rows) {
    if (!value || typeof value !== "object") throw new Error("planner smoke corpus contains a non-object row");
    const row = value as Record<string, unknown>;
    if (typeof row.actionType !== "string" || typeof row.instruction !== "string") throw new Error("planner smoke corpus row is missing actionType/instruction");
    if (row.tenant !== "alpha" && row.tenant !== "bravo" && row.tenant !== "charlie") throw new Error(`invalid planner smoke tenant for ${row.actionType}`);
    result.set(row.actionType, { actionType: row.actionType, tenant: row.tenant, instruction: row.instruction });
  }
  return result;
}

function representativeCases(corpus: Map<string, SmokeCase>): Array<SmokeCase & { domain: string; profile: ActionProfile }> {
  // A representative is selected for each unique domain/profile pair. This is
  // bounded (36 of 44 fixed rows), covers every domain and every action profile,
  // and deliberately leaves the 44-row certification entirely planner-free.
  const selected = new Map<string, SmokeCase & { domain: string; profile: ActionProfile }>();
  for (const spec of ACTION_HARDENING_SPEC) {
    const key = `${spec.plugin}/${spec.profile}`;
    if (selected.has(key)) continue;
    const row = corpus.get(spec.actionType);
    if (!row) throw new Error(`planner smoke corpus missing ${spec.actionType}`);
    selected.set(key, { ...row, domain: spec.plugin, profile: spec.profile });
  }
  return [...selected.values()];
}

async function requestPlanner(base: string, row: SmokeCase): Promise<{ status: number; elapsedMs: number; planned: PlannedAction[]; bodyKeys: string[] }> {
  const started = Date.now();
  const response = await fetch(urlFor(base, "/api/actions"), {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs()),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${tokenFor(row.tenant)}`,
      "x-correlation-id": `p3-planner-smoke-${randomUUID()}`,
    },
    body: JSON.stringify({ instruction: row.instruction, channel: "text", idempotencyKey: `p3-planner-smoke-${row.actionType}-${randomUUID()}` }),
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* body keys stay empty */ }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    status: response.status,
    elapsedMs: Date.now() - started,
    planned: plannedActions(body),
    bodyKeys: Object.keys(record).sort(),
  };
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function writeEvidence(report: Record<string, unknown>): Promise<void> {
  const rows = Array.isArray(report.rows) ? report.rows.map((value) => value as Record<string, unknown>) : [];
  const latency = report.latencyMs && typeof report.latencyMs === "object" ? report.latencyMs as Record<string, unknown> : {};
  const lines = [
    "P3.T5 — BOUNDED PLANNER SMOKE (SEPARATE FROM 44-ROW CERTIFICATION)",
    `generatedAt=${new Date().toISOString()}`,
    `gate=${String(report.gate ?? "planner-smoke")} status=${String(report.status ?? "unknown")} pass=${String(report.pass ?? false)}`,
    `selection=${String(report.selection ?? "one representative instruction per unique domain/action profile pair")}`,
    `representativeCount=${String(report.representativeCount ?? rows.length)} expectedRepresentativeCount=${String(report.expectedRepresentativeCount ?? "unknown")}`,
    `fixedActionCount=${String(report.fixedActionCount ?? 44)}`,
    `latencyMinMs=${String(latency.min ?? "null")} latencyMaxMs=${String(latency.max ?? "null")} latencyAverageMs=${String(latency.average ?? "null")}`,
    "plannerLatencyAndFailuresAreRecordedSeparately=true",
    "productionEgress=false tokenValuesPrinted=false providerPayloadsPrinted=false",
    "",
    "number action domain profile tenant requestStatus status elapsedMs failure",
    ...rows.map((row) => [
      row.number, row.actionType, row.domain, row.profile, row.tenant, row.requestStatus,
      row.status, row.elapsedMs, row.failure ?? "null",
    ].map((value) => String(value ?? "null").replace(/[^A-Za-z0-9 _.:-]/g, "")).join(" ")),
    "",
    `failures=${JSON.stringify(report.failures ?? [])}`,
  ];
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${lines.join("\n")}\n`, "utf8");
}

export async function runPlannerSmoke(): Promise<Record<string, unknown>> {
  const guard = evaluateStagingGuards("e2e");
  if (guard.status !== "PASS") {
    const report = {
      phase: "P3",
      gate: "planner-smoke",
      status: "BLOCKED-CONFIG",
      pass: false,
      bounded: true,
      productionEgress: false,
      guard,
      rows: [],
      evidence: "docs/release/generated/p3-planner-smoke-results.json",
    };
    await writeReport(report);
    await writeEvidence(report);
    console.error(formatStagingGuardReport(guard));
    return report;
  }
  const corpus = await loadCases();
  const cases = representativeCases(corpus);
  const rows: SmokeRow[] = [];
  for (const [index, row] of cases.entries()) {
    const spec = ACTION_HARDENING_SPEC.find((candidate) => candidate.actionType === row.actionType)!;
    try {
      const response = await requestPlanner(process.env.STAGING_API_URL!, row);
      const actionTypes = response.planned.map((action) => action.actionType);
      const expectedActionPlanned = response.status >= 200
        && response.status < 300
        && actionTypes.includes(row.actionType);
      rows.push({
        number: index + 1,
        actionType: row.actionType,
        domain: row.domain,
        profile: row.profile,
        tenant: row.tenant,
        requestStatus: response.status,
        elapsedMs: response.elapsedMs,
        plannedActionTypes: actionTypes,
        expectedActionPlanned,
        status: expectedActionPlanned ? "PASS" : "FAIL",
        ...(expectedActionPlanned ? {} : { failure: `planner response did not plan ${row.actionType}` }),
      });
      console.log(`P3_PLANNER_SMOKE_ROW ${index + 1}/${cases.length} action=${row.actionType} status=${expectedActionPlanned ? "PASS" : "FAIL"} elapsedMs=${response.elapsedMs}`);
    } catch (error) {
      rows.push({
        number: index + 1,
        actionType: row.actionType,
        domain: spec.plugin,
        profile: spec.profile,
        tenant: row.tenant,
        requestStatus: null,
        elapsedMs: null,
        plannedActionTypes: [],
        expectedActionPlanned: false,
        status: "FAIL",
        failure: safeError(error),
      });
      console.log(`P3_PLANNER_SMOKE_ROW ${index + 1}/${cases.length} action=${row.actionType} status=FAIL`);
    }
  }
  const expectedRepresentativeCount = new Set(ACTION_HARDENING_SPEC.map((spec) => `${spec.plugin}/${spec.profile}`)).size;
  const pass = rows.length === expectedRepresentativeCount && rows.every((row) => row.status === "PASS");
  const elapsed = rows.flatMap((row) => row.elapsedMs === null ? [] : [row.elapsedMs]);
  const report = {
    phase: "P3",
    gate: "planner-smoke",
    status: pass ? "PASS" : "FAIL",
    pass,
    bounded: true,
    selection: "one representative instruction per unique domain/action profile pair",
    representativeCount: rows.length,
    expectedRepresentativeCount,
    fixedActionCount: ACTION_HARDENING_SPEC.length,
    productionEgress: false,
    guard,
    latencyMs: {
      min: elapsed.length ? Math.min(...elapsed) : null,
      max: elapsed.length ? Math.max(...elapsed) : null,
      average: elapsed.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : null,
    },
    failures: rows.filter((row) => row.status === "FAIL").map((row) => ({ number: row.number, actionType: row.actionType, failure: row.failure ?? null })),
    rows,
    evidence: "docs/release/evidence/P3/p3-t5-planner-smoke-20260807.txt",
  };
  await writeReport(report);
  await writeEvidence(report);
  console.log(`P3_PLANNER_SMOKE_${pass ? "PASS" : "FAIL"} rows=${rows.filter((row) => row.status === "PASS").length}/${rows.length}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPlannerSmoke().catch(async (error) => {
    const report = {
      phase: "P3",
      gate: "planner-smoke",
      status: "FAIL",
      pass: false,
      bounded: true,
      productionEgress: false,
      rows: [],
      error: safeError(error),
      evidence: "docs/release/generated/p3-planner-smoke-results.json",
    };
    await writeReport(report).catch(() => undefined);
    await writeEvidence(report).catch(() => undefined);
    console.error(`P3_PLANNER_SMOKE_FAIL ${safeError(error)}`);
    process.exitCode = 1;
  });
}
