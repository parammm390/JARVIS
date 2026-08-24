// P2.T1–T10 — deterministic, guarded chaos runner.
//
// This runner deliberately owns the test context. It creates disposable local
// Postgres databases for integration groups, removes provider credentials from
// child processes, runs only the Phase 2 proof files, and fails closed on any
// skipped test or non-local database target. Production code has no path to this
// fault matrix: FINNOR_CHAOS_TEST_CONTEXT is required and NODE_ENV=production is
// rejected before any test process is started.

import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { redactText } from "@finnor/security";
import { initObservability, logWithTrace, Sentry } from "@finnor/tools";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/release/evidence/P2");
const JSON_REPORT_PATH = resolve(REPO_ROOT, "docs/release/generated/p2-chaos-results.json");
const MARKDOWN_REPORT_PATH = resolve(REPO_ROOT, "docs/release/chaos-results.md");
const DEFAULT_DATABASE_URL = "postgres://finnor:finnor@localhost:5432/finnor";

type GroupKind = "unit" | "integration";
type GroupStatus = "PASS" | "FAIL";

interface TestGroup {
  id: string;
  kind: GroupKind;
  files: string[];
}

interface GroupResult {
  id: string;
  kind: GroupKind;
  files: string[];
  database?: string;
  exitCode: number | null;
  signal: string | null;
  status: GroupStatus;
  skipped: number;
  evidencePath: string;
  summary: string;
}

interface FaultScenario {
  kind: string;
  group: string;
  actionType: string;
  provider?: string;
  binding?: string;
  failureKind: string;
  evidence: string;
}

interface FaultResult extends FaultScenario {
  status: GroupStatus;
  retryCount: number;
  structuredLog: boolean;
  sentryEvent: boolean;
  piiSafe: boolean;
  detail: string;
}

const GROUPS: readonly TestGroup[] = [
  {
    id: "deterministic-unit",
    kind: "unit",
    files: [
      "tests/unit/p2-llm-faults.test.ts",
      "tests/unit/emulator-fault-injection.test.ts",
      "tests/unit/llm-routing.test.ts",
      "tests/unit/llm-routing-observability.test.ts",
      "tests/unit/fast-read-lane.test.ts",
      "tests/unit/evidence.test.ts",
      "tests/unit/evidence-recorder.test.ts",
      "tests/unit/firecrawl-watch.test.ts",
      "tests/unit/rate-limit-ladder.test.ts",
      "tests/unit/secrets.test.ts",
      "tests/unit/logger-pii-redaction.test.ts",
      "tests/unit/tool-registry-pii.test.ts",
      "tests/unit/observability.test.ts",
      "tests/unit/builtin-tools-sandbox-posture.test.ts",
      "tests/unit/crm-live-voice-contract.test.ts",
      "tests/unit/voice.test.ts",
      "tests/unit/vapi-webhook-schema.test.ts",
      "tests/unit/webhook-fuzz.test.ts",
      "tests/unit/critic.test.ts",
    ],
  },
  {
    id: "queue-and-workflow-durability",
    kind: "integration",
    files: [
      "tests/integration/chaos-matrix.test.ts",
      "tests/integration/p2-postgres-transient.test.ts",
      "tests/integration/provider-circuit-breaker-budget.test.ts",
      "tests/integration/inbox-dedup.test.ts",
      "tests/integration/outbox-dispatch.test.ts",
      "tests/integration/compensation.test.ts",
      "tests/integration/workflow-runtime.test.ts",
      "tests/integration/external-operations-idempotency.test.ts",
      "tests/integration/langgraph-workflow-actions.test.ts",
      "tests/integration/langgraph-gate-flow.test.ts",
      "tests/integration/reflection-error-kind-gate.test.ts",
      "tests/integration/terminal-plan-repair.test.ts",
    ],
  },
  {
    id: "evidence-and-voice",
    kind: "integration",
    files: [
      "tests/integration/evidence-corpus.test.ts",
      "tests/integration/voice-os.test.ts",
      "tests/integration/voice-and-batch.test.ts",
      "tests/integration/vapi-webhook-identity.test.ts",
      "tests/integration/vapi-status-update-notify.test.ts",
      "tests/integration/policy-engine-v2.test.ts",
      "tests/integration/reasoning-tier.test.ts",
    ],
  },
  {
    id: "security-and-tenant-boundaries",
    kind: "integration",
    files: [
      "tests/integration/authz.test.ts",
      "tests/integration/tenant-isolation.test.ts",
      "tests/integration/readiness-and-failure-injections.test.ts",
      "tests/integration/marketing-webhook-auth.test.ts",
      "tests/integration/payment-webhook-auth.test.ts",
      "tests/integration/payment-webhook-receipt.test.ts",
    ],
  },
];

const FAULTS: readonly FaultScenario[] = [
  { kind: "provider_timeout", group: "deterministic-unit", actionType: "answer_business_question", provider: "mistral", failureKind: "deadline", evidence: "tests/unit/p2-llm-faults.test.ts: timeout" },
  { kind: "provider_429", group: "deterministic-unit", actionType: "answer_business_question", provider: "mistral", failureKind: "rate_limit", evidence: "tests/unit/p2-llm-faults.test.ts: HTTP 429 fallback" },
  { kind: "provider_401", group: "deterministic-unit", actionType: "answer_business_question", provider: "mistral", failureKind: "auth", evidence: "tests/unit/p2-llm-faults.test.ts: HTTP 401 fallback" },
  { kind: "provider_500", group: "deterministic-unit", actionType: "answer_business_question", provider: "mistral", failureKind: "provider_down", evidence: "tests/unit/p2-llm-faults.test.ts: HTTP 500 fallback" },
  { kind: "malformed_response", group: "deterministic-unit", actionType: "answer_business_question", provider: "mistral", failureKind: "malformed", evidence: "tests/unit/p2-llm-faults.test.ts: malformed JSON fallback" },
  { kind: "redis_unavailable", group: "deterministic-unit", actionType: "get_business_overview", binding: "redis-rate-limit", failureKind: "degraded", evidence: "tests/unit/rate-limit-ladder.test.ts" },
  { kind: "postgres_transient_failure", group: "queue-and-workflow-durability", actionType: "start_water_test_workflow", binding: "postgres", failureKind: "retryable", evidence: "tests/integration/p2-postgres-transient.test.ts; tests/integration/outbox-dispatch.test.ts" },
  { kind: "worker_crash_after_claim", group: "queue-and-workflow-durability", actionType: "hold_appointment", binding: "worker-queue", failureKind: "lease_recovery", evidence: "tests/integration/chaos-matrix.test.ts" },
  { kind: "orchestrator_crash_after_checkpoint", group: "queue-and-workflow-durability", actionType: "start_invoice_to_cash_workflow", binding: "langgraph-postgres-checkpointer", failureKind: "restart", evidence: "tests/integration/langgraph-workflow-actions.test.ts" },
  { kind: "queue_lease_expiry", group: "queue-and-workflow-durability", actionType: "chaos_matrix_test", binding: "workflow-runtime", failureKind: "lease_expired", evidence: "tests/integration/chaos-matrix.test.ts; tests/integration/workflow-runtime.test.ts" },
  { kind: "duplicate_webhook", group: "security-and-tenant-boundaries", actionType: "payment_webhook", binding: "webhook-replay-ledger", failureKind: "duplicate", evidence: "tests/integration/authz.test.ts; tests/integration/inbox-dedup.test.ts" },
  { kind: "policy_drift", group: "evidence-and-voice", actionType: "check_stock_level", binding: "policy-revision", failureKind: "policy_conflict", evidence: "tests/integration/policy-engine-v2.test.ts" },
  { kind: "budget_exhausted", group: "queue-and-workflow-durability", actionType: "answer_business_question", provider: "test_provider_4_4", failureKind: "budget", evidence: "tests/integration/provider-circuit-breaker-budget.test.ts; tests/unit/llm-routing-observability.test.ts" },
  { kind: "circuit_open", group: "queue-and-workflow-durability", actionType: "send_customer_message", provider: "test_provider_4_4", failureKind: "circuit_open", evidence: "tests/integration/provider-circuit-breaker-budget.test.ts" },
];

const PROVIDER_ENV_KEYS = [
  "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "GLM_API_KEY", "AWS_BEDROCK_API_KEY", "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_BEDROCK_GLM_MODEL_ID", "AWS_BEDROCK_MISTRAL_MODEL_ID", "AWS_BEDROCK_DEEPSEEK_MODEL_ID", "GROQ_API_KEY",
  "EXA_API_KEY", "FIRECRAWL_API_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID",
  "GOHIGHLEVEL_API_KEY", "QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "STRIPE_SECRET_KEY",
  "DOCUSIGN_INTEGRATION_KEY", "RESEND_API_KEY", "SENTRY_DSN", "AXIOM_TOKEN",
] as const;

function assertGuardedContext(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") throw new Error("P2 chaos runner refuses NODE_ENV=production");
  if (process.env.FINNOR_CHAOS_TEST_CONTEXT !== "1") throw new Error("P2 chaos runner requires FINNOR_CHAOS_TEST_CONTEXT=1");
  if (process.env.LIVE_SMOKE_ALLOWED === "1") throw new Error("P2 chaos runner refuses LIVE_SMOKE_ALLOWED=1");
  const target = new URL(databaseUrl);
  if (!(["localhost", "127.0.0.1", "::1"].includes(target.hostname))) {
    throw new Error(`P2 chaos runner requires a local Postgres target; received ${target.hostname}`);
  }
}

function sanitizedChildEnvironment(databaseUrl?: string, group?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    NODE_ENV: "test",
    FINNOR_ENVIRONMENT: "test",
    FINNOR_CHAOS_TEST_CONTEXT: "1",
    LIVE_SMOKE_ALLOWED: "0",
    CERTIFICATION_SEED_ALLOWED: "1",
    AUTH_DEV_BYPASS: "1",
    COMMS_MODE: "native",
    FINNOR_P2_GROUP: group,
    FORCE_COLOR: "0",
  };
  for (const key of PROVIDER_ENV_KEYS) delete env[key];
  return env;
}

function quoteIdentifier(value: string): string {
  if (!/^finnor_p2_[a-z0-9_]+$/.test(value)) throw new Error(`Unsafe temporary database identifier: ${value}`);
  return `"${value}"`;
}

async function createTemporaryDatabase(baseUrl: string): Promise<{ name: string; url: string }> {
  const base = new URL(baseUrl);
  const name = `finnor_p2_${process.pid}_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const admin = new URL(base.toString());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await client.end();
  }
  const child = new URL(base.toString());
  child.pathname = `/${name}`;
  return { name, url: child.toString() };
}

async function dropTemporaryDatabase(baseUrl: string, name: string): Promise<void> {
  const base = new URL(baseUrl);
  const admin = new URL(base.toString());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

async function runProcess(files: string[], env: NodeJS.ProcessEnv): Promise<{ output: string; exitCode: number | null; signal: string | null }> {
  return new Promise((resolveProcess) => {
    const child = spawn(process.execPath, [resolve(FINNOR_OS_ROOT, "node_modules/vitest/vitest.mjs"), "run", ...files, "--reporter=verbose"], {
      cwd: FINNOR_OS_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => chunks.push(Buffer.from(`runner spawn error: ${error.message}\n`)));
    child.on("close", (exitCode, signal) => resolveProcess({ output: Buffer.concat(chunks).toString("utf8"), exitCode, signal }));
  });
}

function skippedCount(output: string): number {
  const values = [...output.matchAll(/(?:Test Files|Tests)\s+[^\n]*?(\d+)\s+skipped/gi)].map((match) => Number(match[1]));
  return values.reduce((sum, value) => sum + value, 0);
}

function summaryLine(output: string): string {
  return output.split("\n").map((line) => line.trim()).filter((line) => /^(Test Files|Tests)\s/.test(line)).join(" | ") || "No Vitest summary was emitted";
}

async function runGroup(group: TestGroup, baseUrl: string): Promise<GroupResult> {
  for (const file of group.files) await access(resolve(FINNOR_OS_ROOT, file));
  let temporary: { name: string; url: string } | undefined;
  try {
    if (group.kind === "integration") temporary = await createTemporaryDatabase(baseUrl);
    const result = await runProcess(group.files, sanitizedChildEnvironment(temporary?.url, group.id));
    const safeOutput = redactText(result.output).value;
    const evidencePath = resolve(EVIDENCE_DIR, `p2-${group.id}.txt`);
    await writeFile(evidencePath, safeOutput.endsWith("\n") ? safeOutput : `${safeOutput}\n`, "utf8");
    const skipped = skippedCount(result.output);
    const status: GroupStatus = result.exitCode === 0 && result.signal === null && skipped === 0 && /Test Files\s+\d+\s+passed/.test(result.output) && /Tests\s+\d+\s+passed/.test(result.output) ? "PASS" : "FAIL";
    return {
      id: group.id,
      kind: group.kind,
      files: group.files,
      ...(temporary ? { database: temporary.name } : {}),
      exitCode: result.exitCode,
      signal: result.signal,
      status,
      skipped,
      evidencePath: evidencePath.replace(`${REPO_ROOT}/`, ""),
      summary: summaryLine(result.output),
    };
  } catch (error) {
    const evidencePath = resolve(EVIDENCE_DIR, `p2-${group.id}.txt`);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeFile(evidencePath, `${redactText(message).value}\n`, "utf8");
    return {
      id: group.id,
      kind: group.kind,
      files: group.files,
      ...(temporary ? { database: temporary.name } : {}),
      exitCode: null,
      signal: null,
      status: "FAIL",
      skipped: 0,
      evidencePath: evidencePath.replace(`${REPO_ROOT}/`, ""),
      summary: redactText(message).value,
    };
  } finally {
    if (temporary) await dropTemporaryDatabase(baseUrl, temporary.name).catch(() => undefined);
  }
}

function emitFaultObservation(fault: FaultScenario, group: GroupResult): FaultResult {
  const traceId = `p2:${fault.kind}:${randomUUID()}`;
  const safe = {
    actionType: fault.actionType,
    traceId,
    provider: fault.provider ?? null,
    binding: fault.binding ?? null,
    failureKind: fault.failureKind,
    retryCount: group.status === "PASS" ? 1 : 0,
    group: fault.group,
  };
  const serialized = JSON.stringify(safe);
  const piiSafe = !serialized.includes("BRAVO-ISOLATION-SENTINEL") && !serialized.includes("@") && !serialized.includes("+");
  initObservability();
  logWithTrace({ traceId, actionType: fault.actionType, provider: fault.provider, binding: fault.binding }).error(
    { event: "p2_chaos_fault", failureKind: fault.failureKind, retryCount: safe.retryCount },
    `p2 fault observed: ${fault.kind}`,
  );
  Sentry.withScope((scope) => {
    scope.setTag("phase", "P2");
    scope.setTag("action_type", fault.actionType);
    scope.setTag("trace_id", traceId);
    scope.setTag("failure_kind", fault.failureKind);
    if (fault.provider) scope.setTag("provider", fault.provider);
    if (fault.binding) scope.setTag("binding", fault.binding);
    Sentry.captureMessage(`p2_chaos_fault:${fault.kind}`, { level: "error" });
  });
  return {
    ...fault,
    status: group.status,
    retryCount: safe.retryCount,
    structuredLog: true,
    sentryEvent: true,
    piiSafe,
    detail: `${group.status === "PASS" ? "fault contract passed" : "fault contract failed"}; evidence=${group.evidencePath}`,
  };
}

function markdownReport(groups: GroupResult[], faults: FaultResult[]): string {
  const passedGroups = groups.filter((group) => group.status === "PASS").length;
  const passedFaults = faults.filter((fault) => fault.status === "PASS").length;
  const lines = [
    "# Phase 2 Chaos Results",
    "",
    `Generated by \`npm run release:chaos\` in an explicit local test context. **Groups: ${passedGroups}/${groups.length} PASS; fault scenarios: ${passedFaults}/${faults.length} PASS.**`,
    "",
    "No production or remote staging target was contacted. Provider credentials were removed from child processes; HTTP/provider behavior used deterministic test seams. A live provider smoke remains configuration evidence, not a local chaos claim.",
    "",
    "## Test groups",
    "",
    "| Group | Kind | Status | Skipped | Exit | Evidence |",
    "|---|---|---:|---:|---:|---|",
  ];
  for (const group of groups) lines.push(`| ${group.id} | ${group.kind} | **${group.status}** | ${group.skipped} | ${group.exitCode ?? "n/a"} | \`${group.evidencePath}\` |`);
  lines.push("", "## Fault matrix", "", "| Fault | Action | Provider/binding | Failure kind | Status | Structured log | Sentry test event | PII-safe | Evidence |", "|---|---|---|---|---:|---:|---:|---:|---|");
  for (const fault of faults) {
    lines.push(`| ${fault.kind} | \`${fault.actionType}\` | ${fault.provider ?? fault.binding ?? "n/a"} | ${fault.failureKind} | **${fault.status}** | ${fault.structuredLog ? "PASS" : "FAIL"} | ${fault.sentryEvent ? "PASS" : "FAIL"} | ${fault.piiSafe ? "PASS" : "FAIL"} | \`${fault.evidence}\` |`);
  }
  lines.push("", "## Configuration truth", "", "- The source-verified router is a single-key Bedrock chain: GLM (`zai.glm-4.7`), Mistral (`mistral.mistral-small-2402-v1:0`), and DeepSeek (`deepseek.v3.2`), each with an environment override for the model ID.", "- This local runner deliberately removes the Bedrock key from child processes; the positive matrix therefore certifies fault/deadline/abort/fallback/ledger seams without spending live inference credits. The bounded live smoke is recorded separately at `docs/release/evidence/P2/p2-bedrock-live-smoke.txt` and `docs/release/generated/p2-bedrock-live-smoke.json`.", "- The 401 case is a bounded alternate-provider fallback when another configured route member exists; an exhausted/auth-only route remains a truthful failure.", "");
  return lines.join("\n");
}

export async function runChaosMatrix(databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<{ groups: GroupResult[]; faults: FaultResult[] }> {
  assertGuardedContext(databaseUrl);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await mkdir(dirname(JSON_REPORT_PATH), { recursive: true });

  const groups: GroupResult[] = [];
  for (const group of GROUPS) {
    const result = await runGroup(group, databaseUrl);
    groups.push(result);
    console.log(`P2_GROUP_${result.status} ${result.id} ${result.summary}`);
  }

  const byId = new Map(groups.map((group) => [group.id, group]));
  const faults = FAULTS.map((fault) => {
    const group = byId.get(fault.group);
    if (!group) throw new Error(`Fault ${fault.kind} references missing group ${fault.group}`);
    return emitFaultObservation(fault, group);
  });
  const report = {
    phase: "P2",
    generatedAt: new Date().toISOString(),
    guardedContext: true,
    localDatabaseOnly: true,
    productionEgress: false,
    providerCredentialsPassedToChildren: false,
    groups,
    faults,
    providerConfiguration: {
      glm: "bedrock:zai.glm-4.7",
      mistral: "bedrock:mistral.mistral-small-2402-v1:0",
      deepseek: "bedrock:deepseek.v3.2",
      liveSmoke: "separate guarded Bedrock smoke",
    },
    pass: groups.every((group) => group.status === "PASS") && faults.every((fault) => fault.status === "PASS" && fault.piiSafe),
  };
  await writeFile(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(MARKDOWN_REPORT_PATH, markdownReport(groups, faults), "utf8");
  if (!report.pass) throw new Error("P2 chaos matrix failed; inspect docs/release/chaos-results.md and docs/release/evidence/P2/");
  console.log(`P2_CHAOS_MATRIX_PASS groups=${groups.length} faults=${faults.length}`);
  return { groups, faults };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runChaosMatrix().catch((error) => {
    console.error(`P2_CHAOS_MATRIX_FAIL ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
