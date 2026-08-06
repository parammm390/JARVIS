// P3.T8/T9 — Node-only staging load certification. It uses the built-in fetch
// implementation and the exact plan scenarios: 15 users for 20 minutes, then
// 25 users for 10 minutes. It is intentionally impossible to start without a
// verified staging contract, 25 distinct auth tokens, and a post-run DB
// reconciliation artifact.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateStagingGuards, formatStagingGuardReport, type StagingGuardReport } from "./staging-guards";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-load-results.json");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/release/evidence/P3");

type RequestKind = "read" | "draft" | "approval" | "vitals";

interface Sample {
  kind: RequestKind;
  status: number;
  elapsedMs: number;
  ok: boolean;
  queueOldestAgeSeconds: number | null;
}

interface ScenarioResult {
  name: string;
  users: number;
  durationMinutes: number;
  startedAt: string;
  endedAt: string;
  requestCount: number;
  failureCount: number;
  errorRate: number;
  p50Ms: Record<RequestKind, number | null>;
  p95Ms: Record<RequestKind, number | null>;
  p99Ms: Record<RequestKind, number | null>;
  oldestQueueAgeSeconds: number | null;
  pass: boolean;
}

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

async function loadTokens(): Promise<string[]> {
  const path = process.env.P3_LOAD_JWTS_FILE;
  if (!path) throw new Error("P3_LOAD_JWTS_FILE is required; token values are never printed");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 25 || parsed.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("P3_LOAD_JWTS_FILE must contain at least 25 non-empty JWT strings");
  }
  return parsed as string[];
}

function baseUrl(): string {
  const value = process.env.STAGING_API_URL;
  if (!value) throw new Error("STAGING_API_URL is required");
  return value;
}

async function request(kind: RequestKind, token: string, userIndex: number, iteration: number): Promise<Sample> {
  const base = baseUrl();
  const started = Date.now();
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  let response: Response;
  if (kind === "draft") {
    const idempotencyKey = `p3-load-${userIndex}-${iteration}`;
    response = await fetch(new URL("/api/actions", base), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "x-correlation-id": idempotencyKey },
      body: JSON.stringify({ instruction: process.env.P3_LOAD_INSTRUCTION, channel: "text", idempotencyKey }),
      signal: AbortSignal.timeout(30_000),
    });
  } else {
    const path = kind === "read" ? "/api/read-models/cash-collections" : kind === "approval" ? "/api/actions/pending" : "/api/vitals";
    response = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(30_000) });
  }
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* response shape is not evidence */ }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const queue = record.queue && typeof record.queue === "object" ? record.queue as Record<string, unknown> : {};
  const age = typeof queue.oldestPendingAgeSeconds === "number" ? queue.oldestPendingAgeSeconds : null;
  return { kind, status: response.status, elapsedMs, ok: response.ok, queueOldestAgeSeconds: age };
}

async function runScenario(name: string, users: number, durationMinutes: number, tokens: string[]): Promise<ScenarioResult> {
  const start = Date.now();
  const end = start + durationMinutes * 60_000;
  const samples: Sample[] = [];
  let iteration = 0;
  async function userLoop(userIndex: number): Promise<void> {
    while (Date.now() < end) {
      const current = iteration++;
      for (const kind of ["read", "draft", "approval", "vitals"] as const) {
        try {
          samples.push(await request(kind, tokens[userIndex]!, userIndex, current));
        } catch {
          samples.push({ kind, status: 599, elapsedMs: 30_000, ok: false, queueOldestAgeSeconds: null });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: users }, (_, index) => userLoop(index)));
  const byKind = (kind: RequestKind) => samples.filter((sample) => sample.kind === kind);
  const p = (kind: RequestKind, value: number) => percentile(byKind(kind).map((sample) => sample.elapsedMs), value);
  const failureCount = samples.filter((sample) => !sample.ok).length;
  const errorRate = samples.length ? failureCount / samples.length : 1;
  const oldestQueueAgeSeconds = Math.max(...samples.map((sample) => sample.queueOldestAgeSeconds ?? 0));
  const p50Ms = Object.fromEntries((["read", "draft", "approval", "vitals"] as const).map((kind) => [kind, p(kind, 50)])) as Record<RequestKind, number | null>;
  const p95Ms = Object.fromEntries((["read", "draft", "approval", "vitals"] as const).map((kind) => [kind, p(kind, 95)])) as Record<RequestKind, number | null>;
  const p99Ms = Object.fromEntries((["read", "draft", "approval", "vitals"] as const).map((kind) => [kind, p(kind, 99)])) as Record<RequestKind, number | null>;
  const pass = samples.length > 0
    && errorRate < 0.01
    && (p95Ms.read ?? Number.POSITIVE_INFINITY) < 2_500
    && (p95Ms.draft ?? Number.POSITIVE_INFINITY) < 8_000
    && (p95Ms.approval ?? Number.POSITIVE_INFINITY) < 2_000
    && oldestQueueAgeSeconds < 30;
  return {
    name,
    users,
    durationMinutes,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date().toISOString(),
    requestCount: samples.length,
    failureCount,
    errorRate,
    p50Ms,
    p95Ms,
    p99Ms,
    oldestQueueAgeSeconds,
    pass,
  };
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function blockedReport(guard: StagingGuardReport, error?: string): Record<string, unknown> {
  return {
    phase: "P3",
    gate: "load",
    status: "BLOCKED-CONFIG",
    pass: false,
    productionEgress: false,
    guard,
    error: error ?? null,
    scenarios: [],
    reconciliation: "not_run",
    evidence: "docs/release/generated/p3-load-results.json",
  };
}

export async function runLoadCertification(): Promise<Record<string, unknown>> {
  const guard = evaluateStagingGuards("load");
  if (guard.status !== "PASS") {
    const report = blockedReport(guard);
    await writeReport(report);
    console.error(formatStagingGuardReport(guard));
    return report;
  }
  const tokens = await loadTokens();
  const scenarios = [
    await runScenario("15-user-20-minute", 15, 20, tokens),
    await runScenario("25-user-10-minute", 25, 10, tokens),
  ];
  const reconciliationPath = process.env.P3_LOAD_RECONCILIATION_FILE!;
  const reconciliation = JSON.parse(await readFile(reconciliationPath, "utf8")) as { pass?: boolean; duplicateEffects?: number; tenantLeaks?: number; dataCorruption?: number };
  const report = {
    phase: "P3",
    gate: "load",
    status: scenarios.every((scenario) => scenario.pass) && reconciliation.pass === true ? "PASS" : "FAIL",
    pass: scenarios.length === 2 && scenarios.every((scenario) => scenario.pass) && reconciliation.pass === true && reconciliation.duplicateEffects === 0 && reconciliation.tenantLeaks === 0 && reconciliation.dataCorruption === 0,
    productionEgress: false,
    guard,
    scenarios,
    reconciliation: { pass: reconciliation.pass === true, duplicateEffects: reconciliation.duplicateEffects ?? null, tenantLeaks: reconciliation.tenantLeaks ?? null, dataCorruption: reconciliation.dataCorruption ?? null },
    evidence: "docs/release/generated/p3-load-results.json",
  };
  await writeReport(report);
  if (!report.pass) throw new Error("P3 load gates failed; inspect p3-load-results.json and reconciliation evidence");
  console.log("P3_LOAD_PASS scenarios=2/2");
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadCertification().then((report) => {
    if (!report.pass) process.exitCode = 1;
  }).catch(async (error) => {
    const guard = evaluateStagingGuards("load");
    await writeReport(blockedReport(guard, error instanceof Error ? error.message : "unknown error"));
    console.error(`P3_LOAD_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
