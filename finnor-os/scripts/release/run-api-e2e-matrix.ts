// P3.T1/T5/T6 — guarded staging API matrix. The runner never falls back to a
// local database, localhost service, production URL, or direct provider binding.
// It requires an owner-provided case corpus with exactly one case per fixed action.
// Request bodies and provider responses are never written to evidence.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { ACTION_HARDENING_SPEC } from "./action-hardening-spec";
import { evaluateStagingGuards, formatStagingGuardReport, type StagingGuardReport } from "./staging-guards";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/release/evidence/P3");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p3-api-e2e-results.json");

interface E2ECase {
  actionType: string;
  instruction: string;
  tenant?: "alpha" | "charlie";
  channel?: "text" | "console";
  expectedTerminalStatus?: string;
}

interface SafeResponse {
  status: number;
  elapsedMs: number;
  ok: boolean;
  jsonKeys: string[];
  plannedActionTypes: string[];
  duplicate: boolean;
  release: string | null;
  environment: string | null;
}

interface MatrixRow {
  actionType: string;
  tenant: string;
  requestStatus: number | null;
  duplicateStatus: number | null;
  planned: boolean;
  duplicateSafe: boolean;
  receiptVerified: boolean;
  status: "PASS" | "FAIL" | "BLOCKED-CONFIG";
  elapsedMs: number | null;
}

function urlFor(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function tokenFor(tenant: "alpha" | "charlie"): string {
  const name = tenant === "alpha" ? "STAGING_JWT_ALPHA" : "STAGING_JWT_CHARLIE";
  const token = process.env[name];
  if (!token) throw new Error(`${name} is required; token value withheld`);
  return token;
}

function plannedActionTypes(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const planned = (body as { planned?: unknown }).planned;
  if (!Array.isArray(planned)) return [];
  return planned.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const value = row.actionType ?? row.action_type;
    return typeof value === "string" ? [value] : [];
  });
}

async function requestJson(base: string, path: string, token?: string, init?: RequestInit): Promise<SafeResponse> {
  const started = Date.now();
  const response = await fetch(urlFor(base, path), {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* shape remains empty */ }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    status: response.status,
    elapsedMs,
    ok: response.ok,
    jsonKeys: Object.keys(record).sort(),
    plannedActionTypes: plannedActionTypes(body),
    duplicate: record.duplicate === true,
    release: typeof record.release === "string" ? record.release : response.headers.get("x-finnor-release"),
    environment: typeof record.environment === "string" ? record.environment : response.headers.get("x-finnor-environment"),
  };
}

async function loadCases(): Promise<E2ECase[]> {
  const path = process.env.P3_E2E_CASES_FILE;
  if (!path) throw new Error("P3_E2E_CASES_FILE is required; no staging action corpus was supplied");
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const rows = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(rows)) throw new Error("P3_E2E_CASES_FILE must contain an array or {cases: []}");
  const cases = rows as E2ECase[];
  if (cases.length !== ACTION_HARDENING_SPEC.length) throw new Error(`P3 E2E case corpus has ${cases.length} rows; expected 44`);
  const expected = new Set(ACTION_HARDENING_SPEC.map((row) => row.actionType));
  const seen = new Set<string>();
  for (const row of cases) {
    if (!expected.has(row.actionType)) throw new Error(`P3 E2E case corpus contains an unknown action type: ${row.actionType}`);
    if (seen.has(row.actionType)) throw new Error(`P3 E2E case corpus duplicates action type: ${row.actionType}`);
    if (typeof row.instruction !== "string" || row.instruction.trim().length === 0) throw new Error(`P3 E2E case ${row.actionType} has no instruction`);
    seen.add(row.actionType);
  }
  if (seen.size !== expected.size) throw new Error("P3 E2E case corpus does not cover every fixed action type");
  return cases;
}

async function probeServices(): Promise<{ pass: boolean; services: Record<string, SafeResponse> }> {
  const api = process.env.STAGING_API_URL!;
  const services: Record<string, SafeResponse> = {};
  services.api = await requestJson(api, "/api/health");
  services.frontend = await requestJson(process.env.STAGING_FRONTEND_URL!, "/");
  services.worker = await requestJson(process.env.STAGING_WORKER_URL!, "/healthz");
  services.orchestrator = await requestJson(process.env.STAGING_ORCHESTRATOR_URL!, "/health");
  const labels = services.api.jsonKeys.includes("service") && services.orchestrator.jsonKeys.includes("plugins");
  return { pass: Object.values(services).every((service) => service.ok) && labels, services };
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function blockedReport(mode: string, guard: StagingGuardReport, error?: string): Record<string, unknown> {
  return {
    phase: "P3",
    gate: mode,
    status: "BLOCKED-CONFIG",
    pass: false,
    productionEgress: false,
    guard,
    error: error ?? null,
    rows: [],
    evidence: "docs/release/generated/p3-api-e2e-results.json",
  };
}

export async function runApiE2EMatrix(identityOnly = process.argv.includes("--identity-only")): Promise<Record<string, unknown>> {
  const guard = evaluateStagingGuards(identityOnly ? "identity" : "e2e");
  if (guard.status !== "PASS") {
    const report = blockedReport(identityOnly ? "staging-identity" : "api-e2e", guard);
    await writeReport(report);
    console.error(formatStagingGuardReport(guard));
    return report;
  }

  const services = await probeServices();
  if (identityOnly) {
    const report = {
      phase: "P3",
      gate: "staging-identity",
      status: services.pass ? "PASS" : "FAIL",
      pass: services.pass,
      productionEgress: false,
      guard,
      services: services.services,
      evidence: "docs/release/generated/p3-api-e2e-results.json",
    };
    await writeReport(report);
    if (!services.pass) throw new Error("Staging identity health probes did not pass");
    console.log(`P3_STAGING_IDENTITY_PASS services=${Object.keys(services.services).length}`);
    return report;
  }

  if (!services.pass) throw new Error("Staging service health probes did not pass; no action requests were sent");
  const cases = await loadCases();
  const rows: MatrixRow[] = [];
  for (const row of cases) {
    const tenant = row.tenant ?? "alpha";
    const token = tokenFor(tenant);
    const idempotencyKey = `p3-e2e-${row.actionType}-${randomUUID()}`;
    const body = JSON.stringify({ instruction: row.instruction, channel: row.channel ?? "text", idempotencyKey });
    const first = await requestJson(process.env.STAGING_API_URL!, "/api/actions", token, { method: "POST", body, headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey } });
    const second = await requestJson(process.env.STAGING_API_URL!, "/api/actions", token, { method: "POST", body, headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey } });
    const planned = first.plannedActionTypes.includes(row.actionType);
    const duplicateSafe = second.duplicate || (second.status === first.status && first.status >= 200 && first.status < 300);
    // A draft response alone is not a certification receipt. The supplied case
    // corpus must carry the terminal expectation and a deployed receipt assertion
    // before this row can become PASS.
    const receiptVerified = false;
    rows.push({
      actionType: row.actionType,
      tenant,
      requestStatus: first.status,
      duplicateStatus: second.status,
      planned,
      duplicateSafe,
      receiptVerified,
      status: planned && duplicateSafe && receiptVerified ? "PASS" : "FAIL",
      elapsedMs: first.elapsedMs,
    });
  }
  const report = {
    phase: "P3",
    gate: "api-e2e",
    status: rows.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    pass: rows.length === 44 && rows.every((row) => row.status === "PASS"),
    productionEgress: false,
    guard,
    services: services.services,
    rows,
    evidence: "docs/release/generated/p3-api-e2e-results.json",
  };
  await writeReport(report);
  if (!report.pass) throw new Error("P3 API E2E matrix did not prove every action and receipt path");
  console.log("P3_API_E2E_PASS rows=44/44");
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runApiE2EMatrix().then((report) => {
    if (!report.pass) process.exitCode = 1;
  }).catch(async (error) => {
    const guard = evaluateStagingGuards(process.argv.includes("--identity-only") ? "identity" : "e2e");
    await writeReport(blockedReport(process.argv.includes("--identity-only") ? "staging-identity" : "api-e2e", guard, error instanceof Error ? error.message : "unknown error"));
    console.error(`P3_API_E2E_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
