// P3.T6 — configured live-binding smoke. This is the only Phase 3 runner that
// permits provider egress, and it requires an explicit live flag, a proven
// non-production target, an allowlist acknowledgement, write-enable acknowledgement,
// and a case file whose bindings are exactly the configured live binding list.
// Missing credentials/accounts are BLOCKED-CONFIG, never skipped-passing.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateStagingGuards, formatStagingGuardReport, type StagingGuardReport } from "./staging-guards";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-live-binding-smoke.json");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/release/evidence/P3");

interface LiveSmokeCase {
  binding: string;
  actionType: string;
  instruction: string;
  expectedProvider: string;
  tenant?: "alpha" | "bravo" | "charlie";
  typedConfirmation?: boolean;
}

interface SafeResponse {
  status: number;
  ok: boolean;
  elapsedMs: number;
  actionId: string | null;
  receiptCount: number;
  finalizedReceiptCount: number;
  idempotent: boolean;
  providerLabels: string[];
}

function tokenFor(tenant: "alpha" | "bravo" | "charlie"): string {
  const name = tenant === "alpha" ? "STAGING_JWT_ALPHA" : tenant === "bravo" ? "STAGING_JWT_BRAVO" : "STAGING_JWT_CHARLIE";
  const token = process.env[name];
  if (!token) throw new Error(`${name} is required; token value withheld`);
  return token;
}

function baseUrl(): string {
  const value = process.env.STAGING_API_URL;
  if (!value) throw new Error("STAGING_API_URL is required");
  return value;
}

async function request(path: string, token: string, init?: RequestInit): Promise<SafeResponse> {
  const started = Date.now();
  const response = await fetch(new URL(path, baseUrl()), {
    ...init,
    headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* no raw provider/API body is retained */ }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const planned = Array.isArray(record.planned) ? record.planned : [];
  const first = planned[0] && typeof planned[0] === "object" ? planned[0] as Record<string, unknown> : {};
  const receipts = Array.isArray(record.receipts) ? record.receipts : [];
  const finalizedReceiptCount = receipts.filter((receipt) => receipt && typeof receipt === "object" && Boolean((receipt as Record<string, unknown>).finalizedAt)).length;
  const providerLabels = receipts.flatMap((receipt) => {
    if (!receipt || typeof receipt !== "object") return [];
    const value = (receipt as Record<string, unknown>).actualResult;
    if (!value || typeof value !== "object") return [];
    const result = value as Record<string, unknown>;
    return [result.provider, result.binding, result.integration].filter((label): label is string => typeof label === "string");
  });
  return {
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - started,
    actionId: typeof first.id === "string" ? first.id : null,
    receiptCount: receipts.length,
    finalizedReceiptCount,
    idempotent: record.idempotent === true,
    providerLabels: [...new Set(providerLabels)],
  };
}

async function loadCases(): Promise<LiveSmokeCase[]> {
  const path = process.env.P3_LIVE_SMOKE_CASES_FILE;
  if (!path) throw new Error("P3_LIVE_SMOKE_CASES_FILE is required; no allowlisted live case corpus was supplied");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const cases = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("P3_LIVE_SMOKE_CASES_FILE must contain at least one case");
  const expected = new Set((process.env.P3_LIVE_BINDINGS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const actual = new Set((cases as LiveSmokeCase[]).map((row) => row.binding));
  if (actual.size !== expected.size || [...expected].some((binding) => !actual.has(binding))) throw new Error("Live smoke cases do not cover exactly the configured P3_LIVE_BINDINGS");
  for (const row of cases as LiveSmokeCase[]) {
    if (!row.binding || !row.actionType || !row.instruction || !row.expectedProvider) throw new Error("Every live smoke case needs binding, actionType, instruction, and expectedProvider");
  }
  return cases as LiveSmokeCase[];
}

async function waitForReceipt(actionId: string, token: string, expectedProvider: string): Promise<SafeResponse> {
  let last: SafeResponse | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = await request(`/api/receipts?domainActionId=${encodeURIComponent(actionId)}`, token);
    if (last.finalizedReceiptCount > 0 && last.providerLabels.includes(expectedProvider)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  return last ?? { status: 599, ok: false, elapsedMs: 0, actionId, receiptCount: 0, finalizedReceiptCount: 0, idempotent: false, providerLabels: [] };
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function blockedReport(guard: StagingGuardReport, error?: string): Record<string, unknown> {
  return {
    phase: "P3",
    gate: "live-binding-smoke",
    status: "BLOCKED-CONFIG",
    pass: false,
    productionEgress: false,
    guard,
    error: error ?? null,
    bindings: [],
    evidence: "docs/release/generated/p3-live-binding-smoke.json",
  };
}

export async function runLiveBindingSmoke(): Promise<Record<string, unknown>> {
  const guard = evaluateStagingGuards("live-smoke");
  if (guard.status !== "PASS") {
    const report = blockedReport(guard);
    await writeReport(report);
    console.error(formatStagingGuardReport(guard));
    return report;
  }
  const cases = await loadCases();
  const rows: Array<Record<string, unknown>> = [];
  for (const smoke of cases) {
    const token = tokenFor(smoke.tenant ?? "alpha");
    const key = `p3-live-${smoke.binding}-${Date.now()}`;
    const planned = await request("/api/actions", token, { method: "POST", headers: { "content-type": "application/json", "x-correlation-id": key }, body: JSON.stringify({ instruction: smoke.instruction, channel: "text", idempotencyKey: key }) });
    if (!planned.actionId) {
      rows.push({ binding: smoke.binding, actionType: smoke.actionType, status: "FAIL", plannedStatus: planned.status, confirmStatus: null, receipt: "not_created" });
      continue;
    }
    const confirmed = await request(`/api/actions/${planned.actionId}/confirm`, token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(smoke.typedConfirmation ? { typedConfirmation: true } : {}) });
    const duplicateConfirm = await request(`/api/actions/${planned.actionId}/confirm`, token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(smoke.typedConfirmation ? { typedConfirmation: true } : {}) });
    const receipt = await waitForReceipt(planned.actionId, token, smoke.expectedProvider);
    const providerReconciled = receipt.providerLabels.includes(smoke.expectedProvider);
    const pass = planned.ok && confirmed.ok && duplicateConfirm.idempotent && receipt.finalizedReceiptCount > 0 && providerReconciled;
    rows.push({ binding: smoke.binding, actionType: smoke.actionType, expectedProvider: smoke.expectedProvider, providerReconciled, status: pass ? "PASS" : "FAIL", plannedStatus: planned.status, confirmStatus: confirmed.status, duplicateConfirmStatus: duplicateConfirm.status, receipt: receipt.finalizedReceiptCount > 0 ? "finalized" : "missing", elapsedMs: planned.elapsedMs + confirmed.elapsedMs + receipt.elapsedMs });
  }
  const report = {
    phase: "P3",
    gate: "live-binding-smoke",
    status: rows.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    pass: rows.length > 0 && rows.every((row) => row.status === "PASS"),
    productionEgress: false,
    guard,
    bindings: rows,
    evidence: "docs/release/generated/p3-live-binding-smoke.json",
  };
  await writeReport(report);
  if (!report.pass) throw new Error("P3 live-binding smoke failed; inspect p3-live-binding-smoke.json");
  console.log(`P3_LIVE_BINDING_SMOKE_PASS bindings=${rows.length}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveBindingSmoke().then((report) => {
    if (!report.pass) process.exitCode = 1;
  }).catch(async (error) => {
    const guard = evaluateStagingGuards("live-smoke");
    await writeReport(blockedReport(guard, error instanceof Error ? error.message : "unknown error"));
    console.error(`P3_LIVE_BINDING_SMOKE_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
