import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { closePool, getPool } from "@finnor/db";
import { loadClientManifest, parseClientManifest, type ClientManifest } from "./client-manifest";
import {
  createFactoryAuthFromEnv,
  inspectClientFactory,
  runClientFactory,
  startClientFactory,
  type ImportSourceResolver,
} from "./client-factory";
import type { TenantAuthAdmin } from "./tenant-user";
import { runClientCertificationGates, type ClientJourneyEvidence } from "./release/client-certification-gates";
import { buildClientImpactPlan, type ClientImpactPlan } from "./release/client-lifecycle-model";
import {
  activeClientReleaseBundle,
  beginLifecycleOperation,
  completeLifecycleOperation,
  detectClientDrift,
  failLifecycleOperation,
  inspectClientLifecycle,
  inspectIrreversibleEffects,
  materializeRollbackManifest,
  persistClientReleaseConfiguration,
  promoteClientRelease,
  readClientReleaseBundle,
  type ClientDriftReport,
  type ClientReleaseBundle,
  type LifecycleOperation,
} from "./release/client-lifecycle-store";
import {
  createClientCertification,
  createClientRelease,
  deploymentEvidenceProjection,
  hashClientConfiguration,
  sha256,
  type CertificationGateResult,
  type CoreCertification,
} from "./release/certification-model";
import { CertificationArtifactStore, persistClientReleaseBundle } from "./release/certification-store";
import { inspectCoreDiff, type CoreDiffResult } from "./release/core-diff-guard";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");

export interface ClientLifecycleDependencies {
  pool?: pg.Pool;
  auth?: TenantAuthAdmin;
  resolveImportSource?: ImportSourceResolver;
  inspectCore?: (canonicalCoreSha: string) => CoreDiffResult;
  store?: CertificationArtifactStore;
}

function poolOf(dependencies: ClientLifecycleDependencies): pg.Pool {
  return dependencies.pool ?? getPool();
}

function coreDiff(dependencies: ClientLifecycleDependencies, canonicalCoreSha: string): CoreDiffResult {
  return dependencies.inspectCore?.(canonicalCoreSha) ?? inspectCoreDiff(REPO_ROOT, canonicalCoreSha);
}

async function safeFail(pool: pg.Pool, operation: LifecycleOperation, error: unknown): Promise<void> {
  await failLifecycleOperation(pool, operation, error).catch(() => undefined);
}

export async function planClientLifecycleUpdate(
  desiredManifest: ClientManifest,
  dependencies: ClientLifecycleDependencies = {},
  desiredCoreSha?: string | null,
): Promise<{ plan: ClientImpactPlan; current: ClientReleaseBundle | null }> {
  const current = await activeClientReleaseBundle(poolOf(dependencies), desiredManifest.clientKey);
  return {
    current,
    plan: buildClientImpactPlan({
      currentManifest: current?.manifest ?? null,
      desiredManifest,
      currentReleaseId: current?.release.releaseId ?? null,
      currentCoreSha: current?.release.core.canonicalSha ?? null,
      desiredCoreSha,
    }),
  };
}

export async function recordClientDiff(
  desiredManifest: ClientManifest,
  dependencies: ClientLifecycleDependencies = {},
  operationType: "diff" | "dry_run" = "diff",
  desiredCoreSha?: string | null,
): Promise<{ plan: ClientImpactPlan; drift: ClientDriftReport | null }> {
  const pool = poolOf(dependencies);
  const { plan, current } = await planClientLifecycleUpdate(desiredManifest, dependencies, desiredCoreSha);
  const operation = await beginLifecycleOperation(pool, {
    clientKey: desiredManifest.clientKey,
    tenantId: current?.release.client.tenantId,
    operationType,
    plan,
    desiredManifestHash: plan.desiredManifestHash,
    fromReleaseId: current?.release.releaseId,
  });
  const drift = current
    ? await detectClientDrift(pool, { clientKey: desiredManifest.clientKey })
    : null;
  await completeLifecycleOperation(pool, operation, plan.noChange ? "NOOP" : "PASS", {
    mutation: false,
    plan,
    currentDrift: drift,
    statement: "Dry-run and diff retain evidence but do not mutate tenant configuration, policies, providers, imports, or releases.",
  });
  return { plan, drift };
}

export async function applyClientLifecycleUpdate(
  desiredManifest: ClientManifest,
  dependencies: ClientLifecycleDependencies = {},
  options: { reconcileDrift?: boolean } = {},
): Promise<{ plan: ClientImpactPlan; factoryRunId: string | null; status: "PASS" | "NOOP" }> {
  const pool = poolOf(dependencies);
  const { plan, current } = await planClientLifecycleUpdate(desiredManifest, dependencies);
  const operation = await beginLifecycleOperation(pool, {
    clientKey: desiredManifest.clientKey,
    tenantId: current?.release.client.tenantId,
    operationType: "apply",
    plan,
    desiredManifestHash: plan.desiredManifestHash,
    fromReleaseId: current?.release.releaseId,
  });
  try {
    const drift = current ? await detectClientDrift(pool, { clientKey: desiredManifest.clientKey }) : null;
    if (plan.noChange) {
      await completeLifecycleOperation(pool, operation, "NOOP", {
        mutation: false,
        plan,
        drift,
        policyBumps: 0,
        importReplays: 0,
        providerChanges: 0,
        releasesCreated: 0,
      });
      return { plan, factoryRunId: null, status: "NOOP" };
    }
    if (drift && drift.status !== "CLEAN" && !options.reconcileDrift) {
      await completeLifecycleOperation(pool, operation, "BLOCKED_CONFIG", {
        mutation: false,
        reason: "Production drift must be reviewed and explicitly reconciled with --reconcile-drift",
        drift,
        plan,
      });
      throw new Error(`Client update refused because current release drift is ${drift.status}`);
    }
    const conflictingFactory = await pool.query<{ id: string; status: string }>(
      `SELECT id,status FROM finnor_os.client_factory_runs WHERE client_key=$1 AND status IN ('pending','running')
       ORDER BY created_at DESC LIMIT 1`,
      [desiredManifest.clientKey],
    );
    if (conflictingFactory.rows[0]) {
      throw new Error(`Conflicting client factory mutation ${conflictingFactory.rows[0].id} is ${conflictingFactory.rows[0].status}`);
    }
    const started = await startClientFactory(desiredManifest, { pool, enqueue: false });
    const result = await runClientFactory(started.run.id, {
      pool,
      auth: dependencies.auth ?? createFactoryAuthFromEnv(),
      resolveImportSource: dependencies.resolveImportSource,
    });
    if (result.status !== "passed") {
      const operationStatus = result.status === "blocked_config" ? "BLOCKED_CONFIG" : "FAIL";
      await completeLifecycleOperation(pool, operation, operationStatus, { plan, factory: result });
      throw new Error(`Client factory update stopped with ${result.status}`);
    }
    const factory = await inspectClientFactory({ runId: result.id }, pool);
    await completeLifecycleOperation(pool, operation, "PASS", {
      plan,
      factory,
      executedStages: factory?.stages.filter((stage) => stage.attempts > 0).map((stage) => stage.key) ?? [],
      mutation: true,
      newReleaseCreated: false,
    }, { tenantId: result.tenantId });
    return { plan, factoryRunId: result.id, status: "PASS" };
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

export async function certifyClientLifecycleRelease(
  input: {
    manifest: ClientManifest;
    factoryRunId: string;
    coreCertification: CoreCertification;
    deploymentEvidence: unknown;
    journeyEvidence?: ClientJourneyEvidence;
  },
  dependencies: ClientLifecycleDependencies = {},
): Promise<{ plan: ClientImpactPlan; releaseId: string; certificationStatus: string; reusedGates: string[] }> {
  const pool = poolOf(dependencies);
  const current = await activeClientReleaseBundle(pool, input.manifest.clientKey);
  const plan = buildClientImpactPlan({
    currentManifest: current?.manifest ?? null,
    desiredManifest: input.manifest,
    currentReleaseId: current?.release.releaseId ?? null,
    currentCoreSha: current?.release.core.canonicalSha ?? null,
    desiredCoreSha: input.coreCertification.canonicalCoreSha,
  });
  const operation = await beginLifecycleOperation(pool, {
    clientKey: input.manifest.clientKey,
    tenantId: current?.release.client.tenantId,
    operationType: "certify",
    plan,
    desiredManifestHash: plan.desiredManifestHash,
    fromReleaseId: current?.release.releaseId,
  });
  try {
    const sameDeployment = current?.release.deployment.evidenceHash
      === sha256(deploymentEvidenceProjection(input.deploymentEvidence));
    const sameCore = current?.release.core.certificationId === input.coreCertification.certificationId;
    const reusableGateNames = sameDeployment && sameCore
      ? new Set(plan.reusableCertificationGates)
      : new Set<string>();
    const reuseGates: CertificationGateResult[] = current?.certification.status === "PASS"
      ? current.certification.gates.filter((gate) => reusableGateNames.has(gate.gate))
      : [];
    const priorImportReplayGate = sameDeployment && sameCore && current?.certification.status === "PASS"
      ? current.certification.gates.find((gate) => gate.gate === "import_replay_safety")
      : undefined;
    const gateResult = await runClientCertificationGates({
      manifest: input.manifest,
      pool,
      factoryRunId: input.factoryRunId,
      canonicalCoreSha: input.coreCertification.canonicalCoreSha,
      coreCertificationId: input.coreCertification.certificationId,
      deploymentEvidence: input.deploymentEvidence,
      coreDiff: coreDiff(dependencies, input.coreCertification.canonicalCoreSha),
      journeyEvidence: input.journeyEvidence,
      reuseGates,
      invalidatedImportKeys: plan.affectedImportKeys,
      priorImportReplayGate,
    });
    const certification = createClientCertification({
      clientKey: input.manifest.clientKey,
      tenantId: gateResult.tenantId || "unresolved-tenant",
      coreCertification: input.coreCertification,
      configurationHashes: hashClientConfiguration(input.manifest),
      deploymentEvidence: input.deploymentEvidence,
      migrationVersion: gateResult.migrationVersion,
      schemaHash: gateResult.schemaHash,
      gates: gateResult.gates,
    });
    const release = createClientRelease({
      coreCertification: input.coreCertification,
      clientCertification: certification,
      deploymentEvidence: input.deploymentEvidence,
      integrations: gateResult.integrations,
      predecessorReleaseId: current?.release.releaseId ?? null,
      factoryRunId: input.factoryRunId,
      source: process.env.FINNOR_RELEASE_SOURCE ?? "client:lifecycle/certify",
    });
    const store = dependencies.store ?? new CertificationArtifactStore(resolve(FINNOR_OS_ROOT, ".certifications"));
    const storedCertification = await store.writeClientCertification(certification);
    const storedRelease = await store.writeClientRelease(release);
    if (gateResult.tenantId) {
      await persistClientReleaseBundle(pool, {
        core: input.coreCertification,
        certification: storedCertification.artifact,
        release: storedRelease.artifact,
      });
      await persistClientReleaseConfiguration(pool, { release: storedRelease.artifact, manifest: input.manifest });
    }
    await completeLifecycleOperation(pool, operation, certification.status, {
      plan,
      certificationId: certification.certificationId,
      certificationStatus: certification.status,
      releaseId: release.releaseId,
      reusedGates: reuseGates.map((gate) => gate.gate).sort(),
      executedGates: gateResult.gates.filter((gate) => !reuseGates.some((prior) => prior.gate === gate.gate)).map((gate) => gate.gate),
      artifactPaths: { certification: storedCertification.path, release: storedRelease.path },
    }, { tenantId: gateResult.tenantId || null, toReleaseId: release.releaseId });
    return { plan, releaseId: release.releaseId, certificationStatus: certification.status, reusedGates: reuseGates.map((gate) => gate.gate).sort() };
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

export async function promoteClientLifecycleRelease(
  clientKey: string,
  releaseId: string,
  dependencies: ClientLifecycleDependencies = {},
): Promise<Awaited<ReturnType<typeof promoteClientRelease>>> {
  const pool = poolOf(dependencies);
  const current = await activeClientReleaseBundle(pool, clientKey);
  const operation = await beginLifecycleOperation(pool, {
    clientKey,
    tenantId: current?.release.client.tenantId,
    operationType: "promote",
    fromReleaseId: current?.release.releaseId,
    toReleaseId: releaseId,
  });
  try {
    const target = await readClientReleaseBundle(pool, releaseId);
    return await promoteClientRelease(pool, {
      operation,
      releaseId,
      coreDiff: coreDiff(dependencies, target.release.core.canonicalSha),
    });
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

export async function checkClientLifecycleDrift(
  clientKey: string,
  dependencies: ClientLifecycleDependencies = {},
  releaseId?: string,
): Promise<ClientDriftReport> {
  const pool = poolOf(dependencies);
  const current = await activeClientReleaseBundle(pool, clientKey);
  const operation = await beginLifecycleOperation(pool, {
    clientKey,
    tenantId: current?.release.client.tenantId,
    operationType: "drift",
    fromReleaseId: current?.release.releaseId,
    toReleaseId: releaseId,
  });
  try {
    const report = await detectClientDrift(pool, { clientKey, releaseId });
    await completeLifecycleOperation(pool, operation, report.status === "CLEAN" ? "PASS" : report.status === "BLOCKED_CONFIG" ? "BLOCKED_CONFIG" : "FAIL", report);
    return report;
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

export async function inspectClientLifecycleStatus(
  clientKey: string,
  dependencies: ClientLifecycleDependencies = {},
): Promise<unknown> {
  const pool = poolOf(dependencies);
  const current = await activeClientReleaseBundle(pool, clientKey);
  const operation = await beginLifecycleOperation(pool, {
    clientKey,
    tenantId: current?.release.client.tenantId,
    operationType: "status",
    fromReleaseId: current?.release.releaseId,
  });
  try {
    const status = await inspectClientLifecycle(pool, clientKey);
    await completeLifecycleOperation(pool, operation, "PASS", { mutation: false, status });
    return status;
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

export async function rollbackClientLifecycleRelease(
  clientKey: string,
  targetReleaseId: string,
  dependencies: ClientLifecycleDependencies = {},
): Promise<unknown> {
  const pool = poolOf(dependencies);
  const current = await activeClientReleaseBundle(pool, clientKey);
  if (!current) throw new Error(`Client ${clientKey} has no active release to roll back`);
  const target = await readClientReleaseBundle(pool, targetReleaseId);
  if (target.release.client.clientKey !== clientKey || target.release.client.tenantId !== current.release.client.tenantId) {
    throw new Error("Rollback target belongs to a different client or tenant");
  }
  const plan = buildClientImpactPlan({
    currentManifest: current.manifest,
    desiredManifest: target.manifest,
    currentReleaseId: current.release.releaseId,
    currentCoreSha: current.release.core.canonicalSha,
    desiredCoreSha: target.release.core.canonicalSha,
  });
  const operation = await beginLifecycleOperation(pool, {
    clientKey,
    tenantId: current.release.client.tenantId,
    operationType: "rollback",
    plan,
    desiredManifestHash: plan.desiredManifestHash,
    fromReleaseId: current.release.releaseId,
    toReleaseId: targetReleaseId,
  });
  try {
    const activePromotion = await pool.query<{ promoted_at: Date }>(
      "SELECT promoted_at FROM finnor_os.active_client_releases WHERE client_key=$1",
      [clientKey],
    );
    const irreversibleEffects = await inspectIrreversibleEffects(
      pool,
      current.release.client.tenantId,
      activePromotion.rows[0]?.promoted_at ?? new Date(current.release.timestamps.releasedAt),
    );
    if (targetReleaseId === current.release.releaseId) {
      await completeLifecycleOperation(pool, operation, "NOOP", { plan, mutation: false, irreversibleEffects });
      return { status: "NOOP", releaseId: targetReleaseId, irreversibleEffects };
    }
    if (!plan.rollback.supported) {
      const evidence = {
        status: "BLOCKED_CONFIG",
        rollback: "not performed",
        reason: "Only tenant presentation, workspace, policy, and reference-only integration configuration are safely reversible",
        unsupportedAreas: plan.rollback.unsupportedAreas,
        irreversibleEffects,
      };
      await completeLifecycleOperation(pool, operation, "BLOCKED_CONFIG", evidence);
      return evidence;
    }
    if (target.certification.status !== "PASS" || target.coreCertification.status !== "PASS") {
      throw new Error("Rollback target is not backed by PASS client and core certifications");
    }
    const preflight = await detectClientDrift(pool, { clientKey, releaseId: targetReleaseId, includeActivePointer: false });
    const incompatible = preflight.items.filter((item) => item.area === "runtime_core" || item.area === "evidence");
    if (incompatible.length) throw new Error(`Rollback target preflight failed: ${incompatible.map((item) => item.code).join(", ")}`);
    const rollbackCoreDiff = coreDiff(dependencies, target.release.core.canonicalSha);
    if (!rollbackCoreDiff.clean || rollbackCoreDiff.coreSourceTreeHash !== target.release.core.sourceTreeHash) {
      throw new Error("Rollback target core certification is stale or the shared core has an unexpected diff");
    }
    const conflictingFactory = await pool.query<{ id: string; status: string }>(
      `SELECT id,status FROM finnor_os.client_factory_runs WHERE client_key=$1 AND status IN ('pending','running')
       ORDER BY created_at DESC LIMIT 1`,
      [clientKey],
    );
    if (conflictingFactory.rows[0]) {
      throw new Error(`Conflicting client factory mutation ${conflictingFactory.rows[0].id} is ${conflictingFactory.rows[0].status}`);
    }

    const rollbackManifest = materializeRollbackManifest(target);
    const started = await startClientFactory(rollbackManifest, { pool, enqueue: false });
    const factory = await runClientFactory(started.run.id, {
      pool,
      auth: dependencies.auth ?? createFactoryAuthFromEnv(),
      resolveImportSource: dependencies.resolveImportSource,
    });
    if (factory.status !== "passed") throw new Error(`Rollback factory convergence stopped with ${factory.status}`);
    const result = await promoteClientRelease(pool, {
      operation,
      releaseId: targetReleaseId,
      coreDiff: rollbackCoreDiff,
      kind: "rollback",
      additionalEvidence: {
        scope: "configuration_only",
        factoryRunId: factory.id,
        plan,
        irreversibleEffects,
        statement: "This is a configuration rollback, not a complete rollback of external effects or historical facts.",
      },
    });
    return { scope: "configuration_only", ...result, irreversibleEffects };
  } catch (error) {
    await safeFail(pool, operation, error);
    throw error;
  }
}

function cliArgs(): { command: string; options: Record<string, string | boolean> } {
  const args = process.argv.slice(2);
  return {
    command: args.find((arg) => !arg.startsWith("--")) ?? "help",
    options: Object.fromEntries(args.filter((arg) => arg.startsWith("--")).map((argument) => {
      const [key, ...rest] = argument.slice(2).split("=");
      return [key!, rest.length ? rest.join("=") : true];
    })),
  };
}

function requiredOption(options: Record<string, string | boolean>, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key}=<value> is required`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function cliManifest(pathValue: string): Promise<ClientManifest> {
  const path = resolve(pathValue);
  const manifest = await loadClientManifest(path);
  return parseClientManifest({
    ...manifest,
    imports: manifest.imports.map((item) => ({
      ...item,
      sourceRef: item.sourceRef && !item.sourceRef.startsWith("file://") && !isAbsolute(item.sourceRef)
        ? resolve(dirname(path), item.sourceRef)
        : item.sourceRef,
    })),
  });
}

async function main(): Promise<void> {
  const { command, options } = cliArgs();
  const pool = getPool();
  if (command === "status") {
    console.log(JSON.stringify(await inspectClientLifecycleStatus(requiredOption(options, "client-key"), { pool }), null, 2));
    return;
  }
  if (command === "diff" || command === "dry-run") {
    const manifest = await cliManifest(requiredOption(options, "manifest"));
    console.log(JSON.stringify(await recordClientDiff(manifest, { pool }, command === "diff" ? "diff" : "dry_run"), null, 2));
    return;
  }
  if (command === "apply" || command === "update") {
    const manifest = await cliManifest(requiredOption(options, "manifest"));
    console.log(JSON.stringify(await applyClientLifecycleUpdate(manifest, { pool }, { reconcileDrift: options["reconcile-drift"] === true }), null, 2));
    return;
  }
  if (command === "certify") {
    const manifest = await cliManifest(requiredOption(options, "manifest"));
    const store = new CertificationArtifactStore(resolve(typeof options.store === "string" ? options.store : resolve(FINNOR_OS_ROOT, ".certifications")));
    const coreCertification = await store.readCoreCertification(resolve(requiredOption(options, "core-certification")));
    const journeyPath = typeof options["journey-evidence"] === "string" ? options["journey-evidence"] : null;
    console.log(JSON.stringify(await certifyClientLifecycleRelease({
      manifest,
      factoryRunId: requiredOption(options, "factory-run"),
      coreCertification,
      deploymentEvidence: await readJson(requiredOption(options, "deployment-evidence")),
      journeyEvidence: journeyPath ? await readJson(journeyPath) as ClientJourneyEvidence : undefined,
    }, { pool, store }), null, 2));
    return;
  }
  if (command === "promote") {
    console.log(JSON.stringify(await promoteClientLifecycleRelease(
      requiredOption(options, "client-key"), requiredOption(options, "release"), { pool },
    ), null, 2));
    return;
  }
  if (command === "drift") {
    console.log(JSON.stringify(await checkClientLifecycleDrift(
      requiredOption(options, "client-key"), { pool }, typeof options.release === "string" ? options.release : undefined,
    ), null, 2));
    return;
  }
  if (command === "rollback") {
    console.log(JSON.stringify(await rollbackClientLifecycleRelease(
      requiredOption(options, "client-key"), requiredOption(options, "to-release"), { pool },
    ), null, 2));
    return;
  }
  console.error([
    "Usage: npm run client:lifecycle -- <command> [options]",
    "  status --client-key=<key>",
    "  diff|dry-run --manifest=<client.json>",
    "  apply|update --manifest=<client.json> [--reconcile-drift]",
    "  certify --manifest=<client.json> --factory-run=<uuid> --core-certification=<json> --deployment-evidence=<json> [--journey-evidence=<json>] [--store=<dir>]",
    "  promote --client-key=<key> --release=<clientrelease-id>",
    "  drift --client-key=<key> [--release=<clientrelease-id>]",
    "  rollback --client-key=<key> --to-release=<clientrelease-id>",
  ].join("\n"));
  process.exitCode = 2;
}

const isMain = process.argv[1]?.endsWith("client-lifecycle.ts") || process.argv[1]?.endsWith("client-lifecycle.js");
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => closePool());
