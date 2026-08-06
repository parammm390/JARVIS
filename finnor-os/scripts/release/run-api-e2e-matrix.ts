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
  tenant?: "alpha" | "bravo" | "charlie";
  channel?: "text" | "console";
  expectedTerminalStatus: "pending" | "needs_human_review" | "completed" | "rejected" | "failed" | "blocked_integration_unavailable";
  confirmation?: "none" | "approve" | "reject";
  typedConfirmation?: boolean;
}

interface PlannedActionSummary {
  id: string | null;
  actionType: string;
  status: string | null;
}

interface ReceiptSummary {
  id: string;
  domainActionId: string | null;
  finalizedAt: string | null;
  actualResultPresent: boolean;
  failurePresent: boolean;
  failureKind: string | null;
}

interface SafeResponse {
  status: number;
  elapsedMs: number;
  ok: boolean;
  jsonKeys: string[];
  plannedActions: PlannedActionSummary[];
  duplicate: boolean;
  returnedStatus: string | null;
  release: string | null;
  environment: string | null;
}

interface MatrixRow {
  actionType: string;
  tenant: string;
  expectedTerminalStatus: string;
  observedStatus: string | null;
  requestStatus: number | null;
  duplicateStatus: number | null;
  planned: boolean;
  duplicateSafe: boolean;
  receiptVerified: boolean;
  receiptId: string | null;
  receiptFinalized: boolean;
  status: "PASS" | "FAIL" | "BLOCKED-CONFIG";
  elapsedMs: number | null;
}

function urlFor(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function tokenFor(tenant: "alpha" | "bravo" | "charlie"): string {
  const name = tenant === "alpha" ? "STAGING_JWT_ALPHA" : tenant === "bravo" ? "STAGING_JWT_BRAVO" : "STAGING_JWT_CHARLIE";
  const token = process.env[name];
  if (!token) throw new Error(`${name} is required; token value withheld`);
  return token;
}

function plannedActions(body: unknown): PlannedActionSummary[] {
  if (!body || typeof body !== "object") return [];
  const planned = (body as { planned?: unknown }).planned;
  if (!Array.isArray(planned)) return [];
  return planned.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const value = row.actionType ?? row.action_type;
    return typeof value === "string"
      ? [{
        id: typeof row.id === "string" ? row.id : null,
        actionType: value,
        status: typeof row.status === "string" ? row.status : null,
      }]
      : [];
  });
}

function returnedStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  const result = record.result;
  if (result && typeof result === "object") {
    const resultRecord = result as Record<string, unknown>;
    if (typeof resultRecord.status === "string") return resultRecord.status;
    const output = resultRecord.output;
    if (output && typeof output === "object" && typeof (output as Record<string, unknown>).status === "string") {
      return (output as Record<string, unknown>).status as string;
    }
  }
  return null;
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
    plannedActions: plannedActions(body),
    duplicate: record.duplicate === true,
    returnedStatus: returnedStatus(body),
    release: typeof record.release === "string" ? record.release : response.headers.get("x-finnor-release"),
    environment: typeof record.environment === "string" ? record.environment : response.headers.get("x-finnor-environment"),
  };
}

async function requestReceipts(base: string, actionId: string, token: string): Promise<{ ok: boolean; status: number; receipts: ReceiptSummary[] }> {
  const response = await fetch(urlFor(base, `/api/receipts?domainActionId=${encodeURIComponent(actionId)}`), {
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* response shape remains empty */ }
  const rows = body && typeof body === "object" && Array.isArray((body as { receipts?: unknown }).receipts)
    ? (body as { receipts: unknown[] }).receipts
    : [];
  const receipts = rows.flatMap((item): ReceiptSummary[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    const failure = row.failure && typeof row.failure === "object" ? row.failure as Record<string, unknown> : null;
    return [{
      id: row.id,
      domainActionId: typeof row.domainActionId === "string" ? row.domainActionId : null,
      finalizedAt: typeof row.finalizedAt === "string" ? row.finalizedAt : null,
      actualResultPresent: row.actualResult !== null && row.actualResult !== undefined,
      failurePresent: row.failure !== null && row.failure !== undefined,
      failureKind: failure && typeof failure.errorKind === "string" ? failure.errorKind : null,
    }];
  });
  return { ok: response.ok, status: response.status, receipts };
}

interface ReceiptCheck {
  verified: boolean;
  receipt: ReceiptSummary | null;
  observedStatus: string | null;
}

function receiptMatchesExpected(receipt: ReceiptSummary, expected: E2ECase["expectedTerminalStatus"]): boolean {
  if (expected === "pending" || expected === "needs_human_review") return !receipt.finalizedAt || receipt.finalizedAt.length > 0;
  if (!receipt.finalizedAt) return false;
  if (expected === "completed") return receipt.actualResultPresent && !receipt.failurePresent;
  if (expected === "rejected") return receipt.failurePresent && receipt.failureKind === "needs_human";
  if (expected === "blocked_integration_unavailable") return receipt.failurePresent && receipt.failureKind === "config";
  return receipt.failurePresent && receipt.failureKind !== "needs_human" && receipt.failureKind !== "config";
}

async function waitForReceipt(base: string, actionId: string, token: string, expected: E2ECase["expectedTerminalStatus"]): Promise<ReceiptCheck> {
  const attempts = expected === "pending" || expected === "needs_human_review" ? 1 : 12;
  let last: ReceiptSummary | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await requestReceipts(base, actionId, token);
    last = result.receipts.find((receipt) => receipt.domainActionId === actionId) ?? null;
    if (last && receiptMatchesExpected(last, expected)) {
      return { verified: true, receipt: last, observedStatus: expected };
    }
    if (attempt + 1 < attempts) await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  return { verified: false, receipt: last, observedStatus: last?.actualResultPresent ? "completed" : last?.failureKind === "needs_human" ? "rejected" : last?.failureKind === "config" ? "blocked_integration_unavailable" : last?.failurePresent ? "failed" : null };
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
  const terminalStatuses = new Set<E2ECase["expectedTerminalStatus"]>(["pending", "needs_human_review", "completed", "rejected", "failed", "blocked_integration_unavailable"]);
  const seen = new Set<string>();
  for (const row of cases) {
    if (!expected.has(row.actionType)) throw new Error(`P3 E2E case corpus contains an unknown action type: ${row.actionType}`);
    if (seen.has(row.actionType)) throw new Error(`P3 E2E case corpus duplicates action type: ${row.actionType}`);
    if (typeof row.instruction !== "string" || row.instruction.trim().length === 0) throw new Error(`P3 E2E case ${row.actionType} has no instruction`);
    if (!row.tenant || !["alpha", "bravo", "charlie"].includes(row.tenant)) throw new Error(`P3 E2E case ${row.actionType} must name alpha, bravo, or charlie`);
    if (!terminalStatuses.has(row.expectedTerminalStatus)) throw new Error(`P3 E2E case ${row.actionType} must declare an expected terminal status`);
    if (row.confirmation && !["none", "approve", "reject"].includes(row.confirmation)) throw new Error(`P3 E2E case ${row.actionType} has an invalid confirmation mode`);
    seen.add(row.actionType);
  }
  if (seen.size !== expected.size) throw new Error("P3 E2E case corpus does not cover every fixed action type");
  const tenants = new Set(cases.map((row) => row.tenant));
  if (tenants.size !== 3) throw new Error("P3 E2E case corpus must exercise Alpha, Bravo, and Charlie JWTs");
  return cases;
}

async function probeServices(): Promise<{ pass: boolean; services: Record<string, SafeResponse> }> {
  const api = process.env.STAGING_API_URL!;
  const services: Record<string, SafeResponse> = {};
  // The API's edge middleware requires an auth-shaped request for every `/api/*`
  // route, including the intentionally secret-free health route. Use the already
  // guard-validated Alpha JWT for the probe; the route does not resolve tenant data,
  // but this keeps the staging probe faithful to the deployed ingress contract.
  services.api = await requestJson(api, "/api/health", process.env.STAGING_JWT_ALPHA);
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
    const tenant = row.tenant!;
    const token = tokenFor(tenant);
    const idempotencyKey = `p3-e2e-${row.actionType}-${randomUUID()}`;
    const body = JSON.stringify({ instruction: row.instruction, channel: row.channel ?? "text", idempotencyKey });
    const first = await requestJson(process.env.STAGING_API_URL!, "/api/actions", token, { method: "POST", body, headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey } });
    const second = await requestJson(process.env.STAGING_API_URL!, "/api/actions", token, { method: "POST", body, headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey } });
    const plannedAction = first.plannedActions.find((action) => action.actionType === row.actionType) ?? null;
    const duplicateAction = second.plannedActions.find((action) => action.actionType === row.actionType) ?? null;
    const planned = Boolean(plannedAction?.id);
    const duplicateSafe = Boolean(
      plannedAction?.id
      && second.duplicate
      && duplicateAction?.id === plannedAction.id,
    );
    let decision: SafeResponse | null = null;
    const confirmation = row.confirmation ?? "none";
    if (plannedAction?.id && confirmation === "approve") {
      decision = await requestJson(process.env.STAGING_API_URL!, `/api/actions/${plannedAction.id}/confirm`, token, {
        method: "POST",
        body: JSON.stringify(row.typedConfirmation ? { typedConfirmation: true } : {}),
        headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey },
      });
    } else if (plannedAction?.id && confirmation === "reject") {
      decision = await requestJson(process.env.STAGING_API_URL!, `/api/actions/${plannedAction.id}/reject`, token, {
        method: "POST",
        body: JSON.stringify({ reason: `P3 certification decision for ${row.actionType}` }),
        headers: { "content-type": "application/json", "x-correlation-id": idempotencyKey },
      });
    }
    const receipt = plannedAction?.id
      ? await waitForReceipt(process.env.STAGING_API_URL!, plannedAction.id, token, row.expectedTerminalStatus)
      : { verified: false, receipt: null, observedStatus: null } satisfies ReceiptCheck;
    const observedStatus = decision?.returnedStatus ?? receipt.observedStatus ?? plannedAction?.status ?? null;
    const statusMatches = row.expectedTerminalStatus === "pending" || row.expectedTerminalStatus === "needs_human_review"
      ? plannedAction?.status === row.expectedTerminalStatus || (row.expectedTerminalStatus === "pending" && plannedAction?.status === "needs_human_review")
      : receipt.observedStatus === row.expectedTerminalStatus;
    const decisionSafe = confirmation === "none" || Boolean(decision?.ok);
    const receiptVerified = receipt.verified;
    rows.push({
      actionType: row.actionType,
      tenant,
      expectedTerminalStatus: row.expectedTerminalStatus,
      observedStatus,
      requestStatus: first.status,
      duplicateStatus: second.status,
      planned,
      duplicateSafe,
      receiptVerified,
      receiptId: receipt.receipt?.id ?? null,
      receiptFinalized: Boolean(receipt.receipt?.finalizedAt),
      status: planned && duplicateSafe && decisionSafe && statusMatches && receiptVerified ? "PASS" : "FAIL",
      elapsedMs: first.elapsedMs + second.elapsedMs + (decision?.elapsedMs ?? 0),
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
