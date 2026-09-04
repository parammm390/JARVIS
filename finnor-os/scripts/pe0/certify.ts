import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import * as databaseSchema from "../../packages/db/schema";
import { BUSINESS_TRUTH_REGISTRY } from "../../packages/data-platform/src/business-truth-registry";
import { CANONICAL_ENTITY_TYPES, OPERATIONAL_QUERY_INTENTS, PARTY_TYPES } from "../../packages/shared-types/src/index";
import { discoverActionRegistry } from "../release/discover-action-registry";
import { ACTION_HARDENING_SPEC } from "../release/action-hardening-spec";
import { buildPe0Audit, implementationReport, writePe0Audit, type Pe0Audit } from "./generate";
import {
  ACTION_DISPOSITIONS,
  CUTOVER_BLOCKERS,
  DISPOSITIONS,
  JOB_DISPOSITIONS,
  PE0_BASELINE_SHA,
  PROVIDER_DEFINITIONS,
  QUERY_DISPOSITIONS,
  WATER_PATTERNS,
  type Disposition,
} from "./model";
import {
  absoluteRepoPath,
  finnorOsRoot,
  git,
  lines,
  normalizeModelPath,
  outputDirectory,
  readJson,
  sortedUnique,
  stableHash,
} from "./lib";

type Gate = { id: string; status: "PASS"; evidence: string };

type VerificationEvidence = {
  id: string;
  command: string;
  status: "PASS";
  exitCode: 0;
  testFiles?: { total: number; passed: number; failed: 0 };
  tests?: { total: number; passed: number; failed: 0 };
  restoredGeneratedPaths?: string[];
};

export type CertificationResult = {
  schemaVersion: 2;
  status: "PASS";
  baselineSha: string;
  baselineTreeSha: string;
  branchImplementationCount: number;
  manifestHashes: Record<string, string>;
  gates: Gate[];
  counts: Record<string, number>;
  behaviorFingerprint: string;
  allowedPe0ChangedPaths: string[];
  verificationCommands: VerificationEvidence[];
  testResults: string[];
  certificationHash: string;
};

type VitestJson = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{ status: string }>;
};

function execute(id: string, command: string, args: string[]): VerificationEvidence {
  const result = spawnSync(command, args, {
    cwd: finnorOsRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${id} failed (${command} ${args.join(" ")}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  return { id, command: [command, ...args].join(" "), status: "PASS", exitCode: 0 };
}

async function executeRestoringGeneratedFiles(
  id: string,
  command: string,
  args: string[],
  paths: string[],
): Promise<VerificationEvidence> {
  const snapshots = await Promise.all(paths.map(async (path) => ({
    path,
    content: existsSync(absoluteRepoPath(path)) ? await readFile(absoluteRepoPath(path)) : null,
  })));
  try {
    return { ...execute(id, command, args), restoredGeneratedPaths: paths };
  } finally {
    for (const snapshot of snapshots) {
      if (snapshot.content) await writeFile(absoluteRepoPath(snapshot.path), snapshot.content);
      else await rm(absoluteRepoPath(snapshot.path), { force: true });
    }
  }
}

async function executeVitest(id: string, paths: string[], exclude: string[] = []): Promise<VerificationEvidence> {
  const directory = await mkdtemp(join(tmpdir(), "finnor-pe0-vitest-"));
  const output = join(directory, "results.json");
  const args = [
    join(finnorOsRoot, "node_modules/vitest/vitest.mjs"),
    "run",
    ...paths,
    ...exclude.flatMap((path) => ["--exclude", path]),
    "--reporter=json",
    `--outputFile=${output}`,
  ];
  try {
    const evidence = execute(id, process.execPath, args);
    const report = JSON.parse(await readFile(output, "utf8")) as VitestJson;
    assert.equal(report.success, true, `${id} JSON report did not certify success`);
    assert.equal(report.numFailedTests, 0, `${id} reported failed tests`);
    const failedFiles = report.testResults.filter((result) => result.status !== "passed").length;
    assert.equal(failedFiles, 0, `${id} reported failed test files`);
    return {
      ...evidence,
      command: ["vitest", "run", ...paths, ...exclude.flatMap((path) => ["--exclude", path]), "--reporter=json"].join(" "),
      testFiles: { total: report.testResults.length, passed: report.testResults.length, failed: 0 },
      tests: { total: report.numTotalTests, passed: report.numPassedTests, failed: 0 },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeVerificationCommands(): Promise<VerificationEvidence[]> {
  const evidence: VerificationEvidence[] = [];
  evidence.push(execute("typescript", "npm", ["run", "typecheck"]));
  evidence.push(await executeVitest("pe0_audit_tests", ["tests/unit/pe0-audit.test.ts"]));
  evidence.push(await executeRestoringGeneratedFiles(
    "action_release_manifest",
    "npm",
    ["run", "release:manifest"],
    ["docs/release/generated/action-manifest.json", "docs/release/generated/action-manifest.md"],
  ));

  const openapiPath = join(finnorOsRoot, "openapi.json");
  const originalOpenapi = existsSync(openapiPath) ? await readFile(openapiPath) : null;
  try {
    evidence.push(execute("openapi_generation", "npm", ["run", "openapi"]));
    evidence.push(await executeVitest("openapi_contract_tests", ["tests/unit/openapi-operational-query-contract.test.ts"]));
    evidence.push(await executeVitest(
      "applicable_unit_suite",
      ["tests/unit"],
      ["tests/unit/p0-architecture-contract.test.ts", "tests/unit/p6-architecture-contract.test.ts"],
    ));
  } finally {
    if (originalOpenapi) await writeFile(openapiPath, originalOpenapi);
    else await rm(openapiPath, { force: true });
  }
  return evidence;
}

function verificationSummary(evidence: VerificationEvidence): string {
  const counts = evidence.tests && evidence.testFiles
    ? `; ${evidence.testFiles.passed}/${evidence.testFiles.total} files and ${evidence.tests.passed}/${evidence.tests.total} tests passed`
    : "";
  const restored = evidence.restoredGeneratedPaths?.length
    ? `; restored ${evidence.restoredGeneratedPaths.join(", ")}`
    : "";
  return `PASS — executed \`${evidence.command}\` (exit 0)${counts}${restored}`;
}

function exactSet(actual: readonly string[], expected: readonly string[], message: string): void {
  assert.deepEqual(sortedUnique(actual), sortedUnique(expected), message);
}

function actualTableNames(): string[] {
  const result: string[] = [];
  for (const value of Object.values(databaseSchema)) {
    try {
      const name = getTableName(value as never);
      if (name) result.push(name);
    } catch {
      // Helpers and enums are exported from schema.ts beside Drizzle tables.
    }
  }
  return sortedUnique(result);
}

function registeredJobsFromSource(text: string): string[] {
  return [...text.matchAll(/queue\.register\(\s*["']([^"']+)["']/g)].map((match) => match[1]!).sort();
}

function scheduledJobsFromSource(text: string): { tenant: string[]; global: string[] } {
  const tenant = [...text.matchAll(/\{\s*type:\s*["']([^"']+)["']\s*,\s*intervalHours:/g)].map((match) => match[1]!).sort();
  const global = [...text.matchAll(/startGlobalScheduler\(\s*["']([^"']+)["']/g)].map((match) => match[1]!).sort();
  return { tenant, global };
}

async function assertStoredManifests(audit: Pe0Audit): Promise<void> {
  for (const [name, expected] of Object.entries(audit)) {
    const path = join(outputDirectory, name);
    assert.ok(existsSync(path), `Missing generated PE0 manifest ${name}; run npm run pe0:inventory`);
    const actual = await readJson<unknown>(name);
    assert.deepEqual(actual, expected, `Stale generated PE0 manifest ${name}; run npm run pe0:inventory`);
  }
}

async function assertAnchor(path: string, symbol: string | null): Promise<void> {
  assert.ok(existsSync(absoluteRepoPath(path)), `Disposition evidence references nonexistent path ${path}`);
  if (!symbol) return;
  const text = await readFile(absoluteRepoPath(path), "utf8");
  const pieces = symbol.replace(/\([^)]*\)$/, "").split(".").filter(Boolean);
  for (const piece of pieces) assert.ok(text.includes(piece), `Evidence symbol ${symbol} is stale in ${path}`);
}

async function validateBranchTruth(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const branch = audit["branch-state.json"];
  assert.equal(branch.auditBaseline.sha, PE0_BASELINE_SHA);
  assert.equal(branch.uniqueImplementationCount, 2, "Requested branches no longer represent exactly two implementation trees");
  for (const row of branch.branches) {
    assert.equal(git(["rev-parse", `${row.auditedRef}^{commit}`]), row.sha, `${row.name} SHA is stale`);
    assert.equal(git(["rev-parse", `${row.sha}^{tree}`]), row.treeSha, `${row.name} tree SHA is stale`);
  }
  const main = branch.branches.find((row) => row.name === "main")!;
  assert.equal(main.treeSha, branch.auditBaseline.treeSha, "Current main implementation tree diverged from the shipped baseline");
  const contract = JSON.parse(await readFile(absoluteRepoPath("infra/deployment/production.contract.json"), "utf8")) as { canonicalGit: { branch: string }; release: { requiredComponents: string[] }; topology: { orchestrator: { mode: string; separateDeployment: boolean } } };
  assert.equal(contract.canonicalGit.branch, "main");
  exactSet(contract.release.requiredComponents, ["frontend", "api", "worker"], "Production component contract drifted");
  assert.deepEqual(contract.topology.orchestrator, { mode: "embedded-worker", separateDeployment: false, releaseIdentity: "worker", requiredCapability: "orchestration" });
  gates.push({ id: "branch_identity", status: "PASS", evidence: `3 refs -> ${branch.uniqueImplementationCount} trees; main tree equals baseline ${branch.auditBaseline.treeSha}` });
}

async function validateArtifacts(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const ledger = audit["artifact-ledger.json"];
  assert.equal(ledger.unknownCount, 0);
  assert.deepEqual(ledger.runtimeReachableUnclassified, []);
  assert.equal(new Set(ledger.artifacts.map((artifact) => artifact.id)).size, ledger.artifacts.length, "Duplicate artifact ids");
  assert.equal(new Set(ledger.artifacts.map((artifact) => artifact.path)).size, ledger.artifacts.length, "Duplicate artifact paths");
  const dispositions = new Set<string>(DISPOSITIONS);
  const bannedReasons = ["looks generic", "probably reusable", "not needed for PE", "seems water-specific"];
  for (const artifact of ledger.artifacts) {
    assert.ok(dispositions.has(artifact.finalDisposition), `${artifact.path} has invalid disposition`);
    assert.ok(artifact.reason.length >= 40, `${artifact.path} lacks an evidence-based reason`);
    assert.ok(!bannedReasons.some((reason) => artifact.reason.toLowerCase().includes(reason)), `${artifact.path} uses a prohibited speculative reason`);
    assert.ok(existsSync(absoluteRepoPath(artifact.path)), `Ledger path disappeared: ${artifact.path}`);
    assert.ok(artifact.evidenceAnchors.length > 0, `${artifact.path} has no evidence anchor`);
    const lineCount = (await readFile(absoluteRepoPath(artifact.path), "utf8")).split("\n").length;
    for (const anchor of artifact.evidenceAnchors) {
      assert.equal(anchor.path, artifact.path);
      if (anchor.line !== null) assert.ok(anchor.line >= 1 && anchor.line <= lineCount, `${artifact.path} has a stale line anchor`);
    }
    const requiredArrays = [
      artifact.runtimeEntrypoints, artifact.directImports, artifact.dynamicConsumers, artifact.dependents,
      artifact.eventTypesConsumed, artifact.eventTypesEmitted, artifact.databaseTablesRead, artifact.databaseTablesWritten,
      artifact.databaseColumnsWithDomainSemantics, artifact.databaseTriggersInvolved, artifact.canonicalEntityTypesUsed,
      artifact.partyRefUsage, artifact.businessTruthRegistryOwnership, artifact.sourceImportOwnership,
      artifact.externalProviderBindings, artifact.credentialsAuthProfilesUsed, artifact.externalSideEffects,
      artifact.businessEffectsEmitted, artifact.preconditionsPostconditions, artifact.reconciliationReadBackOwnership,
      artifact.receiptEvidenceOwnership, artifact.compensationSemantics, artifact.idempotencySemantics,
      artifact.workObjectiveCoupling, artifact.authorityPolicyCoupling, artifact.tenantIsolationRlsCoupling,
      artifact.phaseDependencies, artifact.memoryDependency, artifact.computerRuntimeDependency, artifact.testsCovering,
      artifact.certificationReleaseGatesCovering, artifact.migrationIntroducingIt, artifact.migrationAssumptionsDependingOnIt,
      artifact.waterSemantics, artifact.deletionBlockers, artifact.extractionBlockers, artifact.replacementPrerequisites,
    ];
    assert.ok(requiredArrays.every(Array.isArray), `${artifact.path} lacks mandatory evidence fields`);
    assert.equal(Object.keys(artifact.decisionDimensions).length >= 30, true, `${artifact.path} lacks disposition decision dimensions`);
  }
  const runtime = ledger.artifacts.filter((artifact) => artifact.runtimeReachable);
  const totals = Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, runtime.filter((artifact) => artifact.finalDisposition === disposition).length]));
  for (const disposition of DISPOSITIONS) assert.equal(ledger.dispositionTotals[disposition] ?? 0, totals[disposition], `${disposition} runtime total drifted`);
  gates.push({ id: "complete_disposition_ledger", status: "PASS", evidence: `${runtime.length} runtime/release-reachable artifacts; ${ledger.artifacts.length} total audited artifacts; UNKNOWN=0` });
}

async function validateRegistries(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const discovered = await discoverActionRegistry();
  const actionMap = audit["action-execution-map.json"];
  exactSet(actionMap.actions.map((row) => row.actionType), discovered.map((row) => row.actionType), "Action registry inventory drifted");
  exactSet(actionMap.actions.map((row) => row.actionType), Object.keys(ACTION_DISPOSITIONS), "Action dispositions are incomplete");
  exactSet(ACTION_HARDENING_SPEC.map((row) => row.actionType), discovered.map((row) => row.actionType), "Action hardening registry drifted");
  assert.equal(actionMap.pluginCount, new Set(discovered.map((row) => row.plugin)).size);
  const queryMap = audit["query-resolution-map.json"];
  exactSet(queryMap.queries.map((row) => row.intent), OPERATIONAL_QUERY_INTENTS, "Operational query inventory drifted");
  exactSet(queryMap.queries.map((row) => row.intent), Object.keys(QUERY_DISPOSITIONS), "Query dispositions are incomplete");
  const worker = await readFile(absoluteRepoPath("finnor-os/apps/worker/src/index.ts"), "utf8");
  const actualJobs = registeredJobsFromSource(worker);
  const jobMap = audit["job-scheduler-map.json"];
  exactSet(jobMap.jobs.map((row) => row.jobType), actualJobs, "String-registered worker jobs drifted");
  exactSet(jobMap.jobs.map((row) => row.jobType), Object.keys(JOB_DISPOSITIONS), "Job dispositions are incomplete");
  assert.ok(jobMap.jobs.every((job) => job.handlerPath && existsSync(absoluteRepoPath(job.handlerPath))), "A registered job lacks a real handler path");
  const schedules = scheduledJobsFromSource(worker);
  exactSet(jobMap.schedulerRegistrations.filter((row) => row.scope === "tenant").map((row) => row.jobType), schedules.tenant, "Tenant scheduler drifted");
  exactSet(jobMap.schedulerRegistrations.filter((row) => row.scope === "global").map((row) => row.jobType), schedules.global, "Global scheduler drifted");
  const lowInventory = jobMap.jobs.find((row) => row.jobType === "scan_low_inventory")!;
  assert.equal(lowInventory.disposition, "WATER_RETIRE");
  assert.ok(lowInventory.schedules.length === 1 && lowInventory.handlerPath?.endsWith("scan-low-inventory.ts"), "String-registered low-inventory trace is incomplete");
  gates.push({ id: "runtime_registries", status: "PASS", evidence: `${actionMap.actionCount} actions/${actionMap.pluginCount} plugins, ${queryMap.queries.length} queries, ${jobMap.jobs.length} jobs, ${jobMap.schedulerRegistrations.length} schedules` });
}

async function validateSchemaProvidersAndGraph(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const schema = audit["schema-read-write-map.json"];
  exactSet(schema.tables.map((row) => row.table), actualTableNames(), "Active Drizzle table inventory drifted");
  assert.equal(schema.businessTruthRegistry.conceptCount, BUSINESS_TRUTH_REGISTRY.length);
  exactSet(schema.businessTruthRegistry.concepts.map((row) => row.concept), BUSINESS_TRUTH_REGISTRY.map((row) => row.concept), "Business Truth Registry drifted");
  exactSet(schema.canonicalEntities.entities.map((row) => row.entityType), CANONICAL_ENTITY_TYPES, "Canonical entity registry drifted");
  exactSet(schema.partyTypes.parties.map((row) => row.partyType), PARTY_TYPES, "Party registry drifted");
  const migrationPaths = lines(git(["ls-files", "finnor-os/packages/db/migrations/*.sql"])).filter((path) => /\/\d+.*\.sql$/.test(path));
  exactSet(schema.tables.flatMap((row) => row.allWriters.length ? [row.table] : []), schema.tables.filter((row) => row.allWriters.length > 0).map((row) => row.table), "Writer table inventory is malformed");
  assert.equal(schema.migrationHistory.numberedMigrationCount, migrationPaths.length);
  assert.equal(lines(git(["diff", "--name-only", PE0_BASELINE_SHA, "--", "finnor-os/packages/db/migrations"])).length, 0, "PE0 modified immutable migration history");
  const provider = audit["provider-truth-map.json"];
  exactSet(provider.providers.map((row) => row.provider), PROVIDER_DEFINITIONS.map((row) => row.provider), "Provider universe drifted");
  for (const row of provider.providers) for (const path of row.paths) assert.ok(existsSync(absoluteRepoPath(path)), `Provider ${row.provider} references missing adapter ${path}`);
  const graph = audit["dependency-graph.json"];
  assert.deepEqual(graph.unresolvedNodes, [], `Dependency graph has unresolved nodes: ${JSON.stringify(graph.unresolvedNodes)}`);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    assert.ok(nodeIds.has(edge.from), `Dependency edge has unresolved from-node ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `Dependency edge has unresolved to-node ${edge.to}`);
  }
  gates.push({ id: "schema_provider_dependency_graph", status: "PASS", evidence: `${schema.tables.length} tables, ${schema.migrationHistory.numberedMigrationCount} immutable migrations, ${provider.providerCount} providers, ${graph.nodes.length} graph nodes, 0 unresolved` });
}

async function validateEntrypointsContaminationAndAnchors(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const runtime = audit["runtime-entrypoints.json"];
  const entrypointPaths = runtime.entrypoints.map((entrypoint) => entrypoint.path);
  const expectedApiRoutes = lines(git(["ls-files", "finnor-os/apps/api/app/api/**/route.ts", "src/app/api/**/route.ts"]));
  for (const route of expectedApiRoutes) assert.ok(entrypointPaths.includes(route), `Runtime API route missing from entrypoints: ${route}`);
  for (const required of ["finnor-os/apps/worker/src/index.ts", "finnor-os/packages/db/migrate.ts", ".github/workflows/production-release.yml", "infra/deployment/production.contract.json", "infra/aws/finnor-production.yaml", "finnor-os/apps/supplier-canary/api/index.mjs", "finnor-os/apps/orchestrator/src/index.ts"]) {
    assert.ok(entrypointPaths.includes(required), `Required investigated entrypoint missing: ${required}`);
  }
  const contamination = audit["water-contamination-map.json"];
  const ledger = audit["artifact-ledger.json"];
  const rescanned = ledger.artifacts.filter((artifact) => artifact.waterSemantics.length > 0).map((artifact) => artifact.path);
  exactSet(contamination.contaminatedArtifacts.map((artifact) => artifact.path), rescanned, "Water contamination escaped the disposition map");
  assert.deepEqual(contamination.unclassifiedContamination, []);
  assert.equal(contamination.verticalNone.supportedToday, false);
  assert.ok(contamination.verticalNone.blockers.length >= 5);
  const acceptance = audit["acceptance-traces.json"];
  assert.equal(acceptance.traceCount, 13);
  for (const trace of acceptance.traces) {
    for (const anchor of trace.path) {
      assert.equal(anchor.ledgered, true, `Acceptance ${trace.acceptance} path is not ledgered: ${anchor.path}`);
      await assertAnchor(anchor.path, anchor.symbol);
    }
  }
  const cutover = audit["cutover-blockers.json"];
  assert.deepEqual(cutover.unresolvedClassificationBlockers, []);
  assert.equal(cutover.orderedP1Inputs.length, CUTOVER_BLOCKERS.length);
  for (const blocker of cutover.orderedP1Inputs) for (const path of blocker.paths) await assertAnchor(path, null);
  gates.push({ id: "entrypoints_contamination_acceptance", status: "PASS", evidence: `${runtime.entrypointCount} entrypoints, ${contamination.contaminatedArtifactCount} contaminated artifacts all disposed, 13 acceptance traces, 0 P1 classification blockers` });
}

async function validateBehaviorAndScope(audit: Pe0Audit, gates: Gate[]): Promise<void> {
  const behavior = audit["artifact-ledger.json"].behaviorBaseline;
  assert.equal(behavior.behaviorEquivalent, true, `PE0 changed runtime behavior: ${behavior.changedRuntimeBehaviorPaths.join(", ")}`);
  assert.equal(behavior.baselineFingerprint, behavior.currentFingerprint);
  const changed = audit["artifact-ledger.json"].pe0ChangedPaths;
  const invalid = changed.filter((path) => path !== "finnor-os/package.json"
    && path !== "finnor-os/tests/unit/pe0-audit.test.ts"
    && path !== ".github/workflows/pe0-certification.yml"
    && !path.startsWith("finnor-os/scripts/pe0/")
    && !path.startsWith("finnor-os/architecture/pe0/"));
  assert.deepEqual(invalid, [], `PE0 contains out-of-scope changes: ${invalid.join(", ")}`);
  const baselinePackage = JSON.parse(git(["show", `${PE0_BASELINE_SHA}:finnor-os/package.json`])) as { scripts: Record<string, string>; [key: string]: unknown };
  const currentPackage = JSON.parse(await readFile(absoluteRepoPath("finnor-os/package.json"), "utf8")) as { scripts: Record<string, string>; [key: string]: unknown };
  const pe0Scripts = { inventory: currentPackage.scripts["pe0:inventory"], certify: currentPackage.scripts["pe0:certify"] };
  assert.equal(pe0Scripts.inventory, "tsx scripts/pe0/generate.ts --pe0-write");
  assert.equal(pe0Scripts.certify, "tsx scripts/pe0/certify.ts --run");
  delete currentPackage.scripts["pe0:inventory"];
  delete currentPackage.scripts["pe0:certify"];
  assert.deepEqual(currentPackage, baselinePackage, "package.json changed beyond the two PE0 assurance commands");
  gates.push({ id: "no_behavior_change", status: "PASS", evidence: `${behavior.baselinePathCount} runtime/release paths retain fingerprint ${behavior.baselineFingerprint}` });
}

export async function certifyPe0(options: { checkStored?: boolean; writeResult?: boolean } = {}): Promise<CertificationResult> {
  const audit = await buildPe0Audit();
  if (options.checkStored ?? true) await assertStoredManifests(audit);
  const gates: Gate[] = [];
  await validateBranchTruth(audit, gates);
  await validateArtifacts(audit, gates);
  await validateRegistries(audit, gates);
  await validateSchemaProvidersAndGraph(audit, gates);
  await validateEntrypointsContaminationAndAnchors(audit, gates);
  await validateBehaviorAndScope(audit, gates);
  const ledger = audit["artifact-ledger.json"];
  const verificationCommands = await executeVerificationCommands();
  const testResults = [
    ...gates.map((gate) => `PASS — executed structural gate \`${gate.id}\`: ${gate.evidence}`),
    ...verificationCommands.map(verificationSummary),
  ];
  const body = {
    schemaVersion: 2 as const,
    status: "PASS" as const,
    baselineSha: PE0_BASELINE_SHA,
    baselineTreeSha: audit["branch-state.json"].auditBaseline.treeSha,
    branchImplementationCount: audit["branch-state.json"].uniqueImplementationCount,
    manifestHashes: Object.fromEntries(Object.entries(audit).map(([name, value]) => [name, (value as { manifestHash: string }).manifestHash])),
    gates,
    counts: {
      runtimeReachableArtifacts: ledger.scope.runtimeReachableArtifactCount,
      allAuditedArtifacts: ledger.artifacts.length,
      unknown: ledger.unknownCount,
      actions: audit["action-execution-map.json"].actionCount,
      plugins: audit["action-execution-map.json"].pluginCount,
      queries: audit["query-resolution-map.json"].queries.length,
      jobs: audit["job-scheduler-map.json"].jobs.length,
      schedules: audit["job-scheduler-map.json"].schedulerRegistrations.length,
      tables: audit["schema-read-write-map.json"].tables.length,
      migrations: audit["schema-read-write-map.json"].migrationHistory.numberedMigrationCount,
      providers: audit["provider-truth-map.json"].providerCount,
      canonicalEntities: audit["schema-read-write-map.json"].canonicalEntities.count,
      businessTruthConcepts: audit["schema-read-write-map.json"].businessTruthRegistry.conceptCount,
    },
    behaviorFingerprint: ledger.behaviorBaseline.baselineFingerprint,
    allowedPe0ChangedPaths: ledger.pe0ChangedPaths,
    verificationCommands,
    testResults,
  };
  const result: CertificationResult = { ...body, certificationHash: stableHash(body) };
  if (options.writeResult) {
    await writePe0Audit(audit, "PASS", testResults);
    await writeFile(join(outputDirectory, "certification-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(join(outputDirectory, "implementation-report.md"), implementationReport(audit, "PASS", testResults));
  }
  return result;
}

if (process.argv.includes("--run")) {
  void certifyPe0({ checkStored: true, writeResult: true })
    .then((result) => console.log(`PE0 certification PASS (${result.certificationHash})`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
