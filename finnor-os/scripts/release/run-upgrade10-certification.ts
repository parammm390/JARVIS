// Upgrade 10 — whole-system certification on a disposable, clean local database.
//
// This runner is deliberately narrower than the full regression/build/deployment
// gates. It proves the eight required integrated employee journeys without touching
// a shared or production database, fails on skips, and writes a machine-readable
// artifact containing the measured convergence/recovery/duplication outcomes.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/upgrade10-whole-system-certification.json");
const BASE_DATABASE_URL = process.env.UPGRADE10_CERTIFICATION_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TEST_FILES = [
  "tests/integration/whole-system-integration.test.ts",
  "tests/integration/agentic-objective-loop.test.ts",
  "tests/integration/employee-authority-runtime.test.ts",
  "tests/integration/tenant-isolation.test.ts",
] as const;
const REQUIRED_METRICS = [
  "voice_text_handoff_approval_completion",
  "durable_operation_partial_failure_recovery",
  "waiting_restart_resume",
  "provider_failure_safe_recovery",
  "cross_projection_business_change",
] as const;

interface CommandResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  output: string;
}

interface UpgradeMetric {
  name: string;
  [key: string]: string | number | boolean;
}

function disposableDatabase(base: string): { adminUrl: string; testUrl: string; database: string; host: string } {
  const parsed = new URL(base);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`Upgrade 10 clean-database certification refuses non-local host ${parsed.hostname}`);
  }
  const database = `finnor_upgrade10_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  if (!/^finnor_upgrade10_[a-f0-9]{16}$/.test(database)) throw new Error("Unsafe disposable database name");
  const admin = new URL(parsed);
  admin.pathname = "/postgres";
  const test = new URL(parsed);
  test.pathname = `/${database}`;
  return { adminUrl: admin.toString(), testUrl: test.toString(), database, host: parsed.hostname };
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const started = performance.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: FINNOR_OS_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { const text = chunk.toString(); output += text; process.stdout.write(text); });
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); output += text; process.stderr.write(text); });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => resolvePromise({
      command: [command, ...args].join(" "),
      exitCode,
      signal,
      durationMs: Math.round(performance.now() - started),
      output,
    }));
  });
}

function metricsFrom(output: string): UpgradeMetric[] {
  const metrics: UpgradeMetric[] = [];
  for (const line of output.split(/\r?\n/)) {
    const marker = line.indexOf("[upgrade10-metric]");
    if (marker < 0) continue;
    const json = line.slice(marker + "[upgrade10-metric]".length).trim();
    const value = JSON.parse(json) as UpgradeMetric;
    if (!value.name || typeof value.name !== "string") throw new Error("Upgrade 10 metric is missing its name");
    metrics.push(value);
  }
  return metrics;
}

function commitSha(): string | null {
  const result = spawnSync("git", ["show", "-s", "--format=%H", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const rendered = String(error).trim();
  return rendered && rendered !== "Error" ? rendered : fallback;
}

async function main(): Promise<void> {
  const disposable = disposableDatabase(BASE_DATABASE_URL);
  const admin = new pg.Client({ connectionString: disposable.adminUrl, connectionTimeoutMillis: 3_000 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: disposable.testUrl,
    FINNOR_ENVIRONMENT: "test",
    NODE_ENV: "test",
    AUTH_DEV_BYPASS: "1",
    COMMS_MODE: "sandbox",
    SECRETS_PROVIDER: "env",
  };
  for (const key of [
    "DATABASE_APP_URL",
    "MIGRATIONS_DATABASE_URL",
    "LANGGRAPH_DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
  ]) delete env[key];
  const startedAt = new Date().toISOString();
  let migration: CommandResult | null = null;
  let tests: CommandResult | null = null;
  let cleanupSucceeded = false;
  let localAppRoleReady = false;
  let failure: string | null = null;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${disposable.database}"`);
    migration = await run(process.execPath, [resolve(FINNOR_OS_ROOT, "node_modules/tsx/dist/cli.mjs"), "packages/db/migrate.ts"], env);
    if (migration.exitCode !== 0) throw new Error("Clean-database migration failed");
    // finnor_app is cluster-scoped, while migration 0001 deliberately grants its
    // weak local password only to a database literally named `finnor`. This runner
    // uses randomized database names, so provision LOGIN only after the non-local
    // guard above has succeeded. Migration 0032 has already applied the restricted
    // grants, NOBYPASSRLS posture, and search_path.
    const runtimeRole = new pg.Client({ connectionString: disposable.testUrl, connectionTimeoutMillis: 3_000 });
    await runtimeRole.connect();
    try {
      await runtimeRole.query("ALTER ROLE finnor_app LOGIN PASSWORD 'finnor_app' NOSUPERUSER NOBYPASSRLS");
      const posture = await runtimeRole.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='finnor_app'",
      );
      localAppRoleReady = posture.rows[0]?.rolcanlogin === true
        && posture.rows[0]?.rolsuper === false
        && posture.rows[0]?.rolbypassrls === false;
      if (!localAppRoleReady) throw new Error("Disposable finnor_app role did not reach the required restricted posture");
    } finally {
      await runtimeRole.end().catch(() => undefined);
    }
    tests = await run(process.execPath, [
      resolve(FINNOR_OS_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      ...TEST_FILES,
      "--reporter=verbose",
      "--pool=forks",
      "--maxWorkers=1",
    ], env);
    if (tests.exitCode !== 0) throw new Error("Upgrade 10 journey certification failed");
    if (/\bskipped\b|\bskip\b/i.test(tests.output)) throw new Error("Upgrade 10 journey certification contained skipped tests");
  } catch (error) {
    failure = failureMessage(error, "Upgrade 10 database setup or journey execution failed");
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${disposable.database}" WITH (FORCE)`);
      cleanupSucceeded = true;
    } catch (error) {
      failure ??= `Disposable database cleanup failed: ${failureMessage(error, "unknown cleanup error")}`;
    }
    await admin.end().catch(() => undefined);
  }

  let metrics: UpgradeMetric[] = [];
  try {
    metrics = tests ? metricsFrom(tests.output) : [];
  } catch (error) {
    failure ??= failureMessage(error, "Upgrade 10 metric parsing failed");
  }
  const metricNames = new Set(metrics.map((metric) => metric.name));
  const missingMetrics = REQUIRED_METRICS.filter((name) => !metricNames.has(name));
  const duplicateFailures = metrics.filter((metric) => typeof metric.duplicateSideEffects === "number" && metric.duplicateSideEffects !== 0);
  const correctnessFailures = metrics.filter((metric) => "objectiveCompletionCorrect" in metric && metric.objectiveCompletionCorrect !== true);
  if (missingMetrics.length > 0) failure ??= `Missing required metrics: ${missingMetrics.join(", ")}`;
  if (duplicateFailures.length > 0) failure ??= `Duplicate side effects observed: ${duplicateFailures.map((metric) => metric.name).join(", ")}`;
  if (correctnessFailures.length > 0) failure ??= `Incorrect objective completion: ${correctnessFailures.map((metric) => metric.name).join(", ")}`;
  if (!cleanupSucceeded) failure ??= "Disposable database was not removed";

  const report = {
    schemaVersion: 1,
    upgrade: 10,
    status: failure ? "FAIL" : "PASS",
    startedAt,
    completedAt: new Date().toISOString(),
    sourceCommit: commitSha(),
    environment: {
      databaseHost: disposable.host,
      disposableDatabasePrefix: "finnor_upgrade10_",
      cleanDatabaseCreated: Boolean(migration),
      cleanDatabaseRemoved: cleanupSucceeded,
      restrictedRuntimeRoleReady: localAppRoleReady,
      providerMode: "sandbox",
    },
    commands: {
      migration: migration && { exitCode: migration.exitCode, signal: migration.signal, durationMs: migration.durationMs },
      journeys: tests && { exitCode: tests.exitCode, signal: tests.signal, durationMs: tests.durationMs, files: TEST_FILES },
    },
    journeys: [
      { id: 1, name: "voice customer issue through verified completion", evidence: "whole-system-integration: voice-started customer objective" },
      { id: 2, name: "cross-employee approval and Work handoff", evidence: "whole-system-integration: handoff plus owner approval" },
      { id: 3, name: "durable bulk operation partial failure and recovery", evidence: "whole-system-integration: frozen cohort recovery" },
      { id: 4, name: "waiting objective survives process restart", evidence: "whole-system-integration: persisted timer and recovery scan" },
      { id: 5, name: "provider failure and idempotent recovery", evidence: "agentic-objective-loop: provider outage recovery" },
      { id: 6, name: "fresh business state changes the plan", evidence: "whole-system-integration: external resolution stops send" },
      { id: 7, name: "cross-projection convergence", evidence: "whole-system-integration: Work, Customer, Schedule, Agents, workspace" },
      { id: 8, name: "tenant and authority isolation", evidence: "whole-system, employee-authority-runtime, and tenant-isolation" },
    ],
    metrics,
    invariants: {
      requiredMetricsPresent: missingMetrics.length === 0,
      duplicateSideEffects: duplicateFailures.length,
      objectiveCompletionCorrect: correctnessFailures.length === 0,
      noSkippedTests: tests ? !/\bskipped\b|\bskip\b/i.test(tests.output) : false,
    },
    failure,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`UPGRADE10_CERTIFICATION_${report.status} output=docs/release/generated/upgrade10-whole-system-certification.json`);
  if (failure) throw new Error(failure);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
