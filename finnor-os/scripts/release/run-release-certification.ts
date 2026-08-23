import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "@finnor/db";
import { loadClientManifest } from "../client-manifest";
import { runClientCertificationGates, type ClientJourneyEvidence } from "./client-certification-gates";
import {
  createClientCertification,
  createClientRelease,
  createCoreCertification,
  CORE_GATE_KEYS,
  CORE_CERTIFICATION_SUITE_VERSION,
  assertCoreCertificationIntegrity,
  gateResult,
  hashClientConfiguration,
  reusableCoreCertification,
  type CertificationStatus,
  type CoreCertification,
} from "./certification-model";
import { CertificationArtifactStore, assertClientReleaseRollbackReferences, persistClientReleaseBundle, persistCoreCertification } from "./certification-store";
import { inspectCoreDiff } from "./core-diff-guard";
import { runCoreCommandGates, sourceProvenanceGate } from "./core-certification-gates";
import { runFinalCertificationCommand } from "./run-final-certification";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINNOR_OS_ROOT = resolve(SCRIPT_DIR, "../..");
const REPO_ROOT = resolve(FINNOR_OS_ROOT, "..");

function cliArgs(): { command: string; options: Record<string, string | boolean> } {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith("--")) ?? "help";
  const options = Object.fromEntries(args.filter((arg) => arg.startsWith("--")).map((argument) => {
    const [key, ...rest] = argument.slice(2).split("=");
    return [key!, rest.length ? rest.join("=") : true];
  }));
  return { command, options };
}

function stringOption(options: Record<string, string | boolean>, name: string, required = false): string | undefined {
  const value = options[name];
  if (typeof value === "string" && value.trim()) return value;
  if (required) throw new Error(`--${name}=<value> is required`);
  return undefined;
}

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().toLowerCase();
}

function exitCode(status: CertificationStatus): number {
  return status === "PASS" ? 0 : status === "BLOCKED_CONFIG" ? 2 : 1;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function coreCommand(options: Record<string, string | boolean>, store: CertificationArtifactStore): Promise<void> {
  const canonicalCoreSha = (stringOption(options, "core-sha") ?? gitSha()).toLowerCase();
  const diff = inspectCoreDiff(REPO_ROOT, canonicalCoreSha);
  if (diff.clean && options["force"] !== true) {
    const reusable = reusableCoreCertification(await store.findCoreCertifications(), {
      canonicalCoreSha,
      coreSourceTreeHash: diff.coreSourceTreeHash,
    });
    if (reusable) {
      console.log(JSON.stringify({ reused: true, certification: reusable }, null, 2));
      process.exitCode = 0;
      return;
    }
    if (process.env.DATABASE_URL) {
      let durable: CoreCertification[] = [];
      try {
        const result = await getPool().query<{ artifact: CoreCertification }>(
          `SELECT artifact FROM finnor_os.core_certifications
           WHERE canonical_core_sha=$1 AND core_source_tree_hash=$2 AND status='PASS'
             AND artifact->>'suiteVersion'=$3
           ORDER BY certified_at DESC`,
          [canonicalCoreSha, diff.coreSourceTreeHash, CORE_CERTIFICATION_SUITE_VERSION],
        );
        durable = result.rows.map((row) => row.artifact);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42P01") throw error;
      }
      durable.forEach(assertCoreCertificationIntegrity);
      const reusableDurable = reusableCoreCertification(durable, {
        canonicalCoreSha,
        coreSourceTreeHash: diff.coreSourceTreeHash,
      });
      if (reusableDurable) {
        const stored = await store.writeCoreCertification(reusableDurable);
        console.log(JSON.stringify({ reused: true, source: "durable-certification-store", path: stored.path, certification: stored.artifact }, null, 2));
        process.exitCode = 0;
        return;
      }
    }
  }
  const gates = diff.clean
    ? runCoreCommandGates(REPO_ROOT)
    : CORE_GATE_KEYS.filter((gate) => gate !== "source_provenance").map((gate) => gateResult(gate, "FAIL", {
      notRun: true,
      reason: "shared core differs from the requested canonical SHA; certify a deliberate new core release first",
    }));
  gates.push(sourceProvenanceGate(diff));
  const artifact = createCoreCertification({
    canonicalCoreSha,
    coreSourceTreeHash: diff.coreSourceTreeHash,
    gates,
    source: process.env.FINNOR_RELEASE_SOURCE ?? "release:certify/core",
  });
  const stored = await store.writeCoreCertification(artifact);
  if (process.env.DATABASE_URL) {
    await persistCoreCertification(getPool(), stored.artifact);
  }
  console.log(JSON.stringify({ reused: stored.reused, path: stored.path, certification: stored.artifact }, null, 2));
  process.exitCode = exitCode(stored.artifact.status);
}

async function clientCommand(options: Record<string, string | boolean>, store: CertificationArtifactStore): Promise<void> {
  const manifestPath = stringOption(options, "manifest", true)!;
  const factoryRunId = stringOption(options, "factory-run");
  const coreCertificationPath = stringOption(options, "core-certification", true)!;
  const deploymentEvidencePath = stringOption(options, "deployment-evidence", true)!;
  const manifest = await loadClientManifest(resolve(manifestPath));
  const coreCertification = await store.readCoreCertification(resolve(coreCertificationPath));
  const deploymentEvidence = await readJson(deploymentEvidencePath);
  const journeyEvidencePath = stringOption(options, "journey-evidence");
  const journeyEvidence = journeyEvidencePath ? await readJson(journeyEvidencePath) as ClientJourneyEvidence : undefined;
  const diff = inspectCoreDiff(REPO_ROOT, coreCertification.canonicalCoreSha);
  const result = await runClientCertificationGates({
    manifest,
    pool: getPool(),
    factoryRunId,
    canonicalCoreSha: coreCertification.canonicalCoreSha,
    coreCertificationId: coreCertification.certificationId,
    deploymentEvidence,
    coreDiff: diff,
    journeyEvidence,
  });
  const clientCertification = createClientCertification({
    clientKey: manifest.clientKey,
    tenantId: result.tenantId || "unresolved-tenant",
    coreCertification,
    configurationHashes: hashClientConfiguration(manifest),
    deploymentEvidence,
    migrationVersion: result.migrationVersion,
    schemaHash: result.schemaHash,
    gates: result.gates,
  });
  const release = createClientRelease({
    coreCertification,
    clientCertification,
    deploymentEvidence,
    integrations: result.integrations,
    predecessorReleaseId: stringOption(options, "predecessor-release") ?? null,
    rollbackTargetReleaseId: stringOption(options, "rollback-target") ?? null,
    factoryRunId: factoryRunId ?? null,
    source: process.env.FINNOR_RELEASE_SOURCE ?? "release:certify/client",
  });
  if (result.tenantId) await assertClientReleaseRollbackReferences(getPool(), release);
  const storedCertification = await store.writeClientCertification(clientCertification);
  const storedRelease = await store.writeClientRelease(release);
  if (result.tenantId) {
    await persistClientReleaseBundle(getPool(), {
      core: coreCertification,
      certification: storedCertification.artifact,
      release: storedRelease.artifact,
    });
  }
  console.log(JSON.stringify({
    certification: { reused: storedCertification.reused, path: storedCertification.path, artifact: storedCertification.artifact },
    release: { reused: storedRelease.reused, path: storedRelease.path, artifact: storedRelease.artifact },
  }, null, 2));
  process.exitCode = exitCode(storedRelease.artifact.certification.status);
}

async function main(): Promise<void> {
  const { command, options } = cliArgs();
  const storeRoot = resolve(stringOption(options, "store") ?? resolve(FINNOR_OS_ROOT, ".certifications"));
  const store = new CertificationArtifactStore(storeRoot);
  if (command === "final") return runFinalCertificationCommand(options, store);
  if (command === "core") return coreCommand(options, store);
  if (command === "client") return clientCommand(options, store);
  console.error([
    "Usage:",
    "  npm run release:certify -- final [--core-sha=<40-char-sha>] [--deployment-evidence=<json>] [--store=<dir>] [--skip-core] [--dry-run]",
    "  npm run release:certify -- core [--core-sha=<40-char-sha>] [--store=<dir>] [--force]",
    "  npm run release:certify -- client --manifest=<json> --factory-run=<uuid> --core-certification=<json> --deployment-evidence=<json> [--journey-evidence=<json>] [--predecessor-release=<id>] [--rollback-target=<id>] [--store=<dir>]",
  ].join("\n"));
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => closePool());
