import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  authorityApprovalRequests,
  authorityApprovalRequestSteps,
  commands,
  compensationCases,
  computerRuns,
  domainActions,
  externalOperations,
  integrationOperations,
  reconciliationCases,
  workflowRuns,
  workflowSteps,
  workObjectiveLoops,
  works,
} from "../../packages/db/schema";
import {
  CANONICAL_ENTITY_TYPES,
  OPERATING_INTERACTION_PRECEDENCE,
  OPERATING_TRUTH_PRECEDENCE,
  OPERATIONAL_QUERY_INTENTS,
} from "../../packages/shared-types/src/index";
import { WORK_STATUSES } from "../../packages/db/index";
import { buildCapabilityInventory } from "./generate-capability-inventory";
import { buildReferenceInventory, REFERENCE_PATTERNS } from "./reference-inventory";
import { BASELINE_SHA, deterministicHash, P0_BRANCH, P0_RUNTIME_CORRECTION_PATHS, readJson } from "./lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const repositoryRoot = resolve(root, "..");

type JsonObject = Record<string, unknown>;
type Lifecycle = JsonObject & { states: string[]; transitionPolicy: JsonObject };
type SubstrateContract = JsonObject & {
  baseline: { sha: string; branch: string };
  authoritativeExecutionMap: { nodes: unknown[]; edges: unknown[]; branchExceptions: JsonObject };
  executionModels: Array<{ name: string }>;
  semanticOwnership: Array<JsonObject & { concept: string; classification: string }>;
  governedEffectBoundary: JsonObject;
  lifecycles: {
    Work: Lifecycle;
    Objective: Lifecycle;
    DomainAction: Lifecycle;
    ApprovalRequest: Lifecycle & { stepStates: string[] };
    Command: Lifecycle;
    WorkflowRun: Lifecycle;
    WorkflowStep: Lifecycle & { executionStates: string[] };
    ProviderOperation: Lifecycle & { verificationStates: string[] };
    ComputerRun: Lifecycle & { effectStates: string[] };
    ReconciliationCase: Lifecycle;
    CompensationCase: Lifecycle;
  };
  contextAndTruth: { operatingTruthPrecedence: string[]; interactionPrecedence: string[] };
  canonicalBusinessTruth: { concepts: Array<{ concept: string }> };
  compatibilityAndLegacySeams: Array<{ id: string; classification: string }>;
  deferredBeyondP0: string[];
};
type InvariantManifest = {
  baselineSha: string;
  invariants: Array<{ id: string; statement: string; owner: string; enforcement: Array<{ path: string; anchor: string }>; tests: Array<{ file: string; title: string }> }>;
  hardGates: Array<{ id: string; expected: number; evidence: string }>;
};
type ReplayManifest = {
  corpusId: string;
  baselineSha: string;
  determinism: { liveLlm: boolean; liveProviders: boolean; network: boolean };
  cases: Array<{ id: string; category: string; selectors: Array<{ file: string; title: string }> }>;
  corpusHash: string;
};
type RuntimeCorrectionManifest = {
  baselineSha: string;
  architectureIntroduced: boolean;
  corrections: Array<{
    id: string;
    path: string;
    classification: string;
    invariant: string;
    enforcementAnchor: string;
    tests: Array<{ file: string; title: string }>;
  }>;
};

const REQUIRED_OWNERSHIP = [
  "instruction route", "canonical entity identity", "grounding", "capability identity", "action intent", "business effect", "effect identity",
  "authority decision", "approval", "Work", "Objective state", "execution claim", "provider operation", "idempotency", "external outcome",
  "reconciliation", "verification", "receipt", "context", "memory", "business truth", "computer task", "frontend Work state", "causal replay",
];
const REQUIRED_INVARIANTS = [
  "tenant_isolation", "canonical_truth_ownership", "consequential_effect_governance", "authority_enforcement", "approval_integrity",
  "business_effect_identity_integrity", "idempotency", "unknown_outcome_reconciliation", "durable_work_monotonicity", "terminal_state_integrity",
  "verification_evidence", "computer_governance", "provider_boundary", "projection_only_frontend_state", "replay_reconstructability",
];
const REQUIRED_REPLAY_CASES = [
  "canonical_queries", "conversation", "single_consequential_action", "objectives", "approval", "rejection", "wait_resume", "provider_execution",
  "provider_failure", "unknown_external_outcome", "reconciliation", "compensation", "computer_read", "computer_write", "ambiguous_entity",
  "cross_tenant_forged_reference", "stale_precondition", "authority_change", "duplicate_callback_job", "worker_restart", "terminal_failure",
  "realtime_ui_reconstruction", "receipt", "causal_replay",
];
const REQUIRED_HARD_GATES = [
  "unexplained_execution_model_changes", "new_semantic_sources_of_truth", "new_authority_systems", "new_business_effect_identity_domains",
  "new_work_lifecycle_systems", "new_context_memory_architectures", "consequential_business_effect_bypasses", "cross_tenant_forged_refs_accepted",
  "unknown_outcome_blind_retries", "duplicate_consequential_effects", "verified_completion_without_required_evidence",
  "provider_ack_promoted_to_unsupported_verified_truth", "computer_governance_bypasses", "terminal_work_resurrection",
  "frontend_state_overriding_backend_truth", "new_internal_package_cycles", "unexplained_locked_replay_regressions",
];

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function exactSet(actual: readonly string[], expected: readonly string[], label: string): void {
  assert.deepEqual(sorted(actual), sorted(expected), label);
}

function enumValues(column: unknown, label: string): string[] {
  const values = (column as { enumValues?: string[] }).enumValues;
  assert.ok(values && values.length > 0, `${label} has no runtime enum values`);
  return [...values];
}

function git(args: string[], cwd = repositoryRoot): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function normalizeChangedPath(path: string): string {
  const cleaned = path.replace(/^"|"$/g, "").replace(/^finnor-os\//, "");
  return cleaned;
}

function changedPaths(): string[] {
  const committed = git(["diff", "--name-only", BASELINE_SHA, "--", "finnor-os"])
    .split("\n").filter(Boolean).map(normalizeChangedPath);
  const status = git(["status", "--porcelain=v1", "-uall", "--", "finnor-os"])
    .split("\n").filter(Boolean)
    .map((line) => normalizeChangedPath(line.slice(3).split(" -> ").at(-1)!));
  return [...new Set([...committed, ...status])].sort();
}

function validateChangeScope(): string[] {
  assert.equal(git(["merge-base", "--is-ancestor", BASELINE_SHA, "HEAD"]) === "", true, "baseline SHA is not an ancestor of HEAD");
  assert.equal(git(["branch", "--show-current"], root), P0_BRANCH, "P0 must run on its dedicated branch");
  const paths = changedPaths();
  const allowed = paths.filter((path) =>
    path === "package.json"
    || path.startsWith("architecture/p0/")
    || path.startsWith("scripts/p0/")
    || /^tests\/unit\/p0-[^/]+\.test\.ts$/.test(path)
    || path === "tests/integration/external-effect-observation.test.ts"
    || path === "tests/integration/inbox-dedup.test.ts"
    || path === "tests/integration/phase6-conversation-context-kernel.test.ts"
    || path === "tests/integration/agentic-objective-loop.test.ts"
    || path === "tests/integration/chaos-matrix.test.ts"
    || path === "tests/integration/scan-watchdog.test.ts"
    || path === "tests/integration/universal-action-fabric.test.ts"
    || path === "tests/integration/whole-system-integration.test.ts"
    || path === "tests/integration/work-cases.test.ts"
    || P0_RUNTIME_CORRECTION_PATHS.includes(path as typeof P0_RUNTIME_CORRECTION_PATHS[number])
  );
  assert.deepEqual(paths, allowed, `P0 contains out-of-scope changes: ${paths.filter((path) => !allowed.includes(path)).join(", ")}`);
  exactSet(
    paths.filter((path) => path.startsWith("apps/") || path.startsWith("packages/")),
    P0_RUNTIME_CORRECTION_PATHS,
    "P0 runtime changes differ from the exact invariant-correction ledger",
  );
  return paths;
}

async function validateRuntimeCorrections(manifest: RuntimeCorrectionManifest): Promise<void> {
  assert.equal(manifest.baselineSha, BASELINE_SHA);
  assert.equal(manifest.architectureIntroduced, false, "P0 runtime corrections introduced architecture");
  exactSet(manifest.corrections.map((row) => row.path), P0_RUNTIME_CORRECTION_PATHS, "runtime correction manifest path drifted");
  for (const correction of manifest.corrections) {
    assert.equal(correction.classification, "INVARIANT_CONFORMANCE");
    assert.ok(REQUIRED_INVARIANTS.includes(correction.invariant), `${correction.id} names an unknown invariant`);
    const source = await readFile(join(root, correction.path), "utf8");
    assert.ok(source.includes(correction.enforcementAnchor), `${correction.id} enforcement anchor is missing`);
    assert.ok(correction.tests.length > 0, `${correction.id} has no executable proof`);
    for (const test of correction.tests) {
      const proof = await readFile(join(root, test.file), "utf8");
      assert.ok(proof.includes(test.title), `${correction.id} proof is missing: ${test.file}#${test.title}`);
    }
  }
}

async function validateContract(contract: SubstrateContract): Promise<void> {
  assert.equal(contract.baseline.sha, BASELINE_SHA);
  assert.equal(contract.baseline.branch, P0_BRANCH);
  assert.ok(contract.authoritativeExecutionMap.nodes.length >= 10, "authoritative execution map is incomplete");
  assert.ok(contract.authoritativeExecutionMap.edges.length >= 9, "authoritative execution edges are incomplete");
  exactSet(contract.executionModels.map((model) => model.name), ["QUERY", "CONVERSATION", "ATOMIC_EFFECT", "OBJECTIVE", "KNOWN_ACTION_COMPATIBILITY"], "execution model inventory drifted");
  exactSet(contract.semanticOwnership.map((row) => row.concept), REQUIRED_OWNERSHIP, "semantic ownership inventory drifted");
  for (const row of contract.semanticOwnership) {
    for (const key of ["canonicalType", "owner", "persistenceOwner", "mutationOwner", "readProjectionOwners", "legacyAliases", "duplicateRepresentations", "allowedDependencies"]) {
      assert.ok(key in row, `${row.concept} is missing ownership field ${key}`);
    }
    assert.ok(["CANONICAL", "COMPATIBILITY", "LEGACY", "DUPLICATE", "PROJECTION_ONLY"].includes(row.classification), `${row.concept} has invalid classification`);
  }
  exactSet(contract.lifecycles.Work.states, WORK_STATUSES, "Work lifecycle differs from runtime");
  exactSet(contract.lifecycles.Objective.states, enumValues(workObjectiveLoops.state, "Objective.state"), "Objective lifecycle differs from schema");
  exactSet(contract.lifecycles.DomainAction.states, enumValues(domainActions.status, "DomainAction.status"), "DomainAction lifecycle differs from schema");
  exactSet(contract.lifecycles.ApprovalRequest.states, enumValues(authorityApprovalRequests.status, "ApprovalRequest.status"), "approval lifecycle differs from schema");
  exactSet(contract.lifecycles.ApprovalRequest.stepStates, enumValues(authorityApprovalRequestSteps.status, "ApprovalStep.status"), "approval step lifecycle differs from schema");
  exactSet(contract.lifecycles.Command.states, enumValues(commands.status, "Command.status"), "command lifecycle differs from schema");
  exactSet(contract.lifecycles.WorkflowRun.states, enumValues(workflowRuns.status, "WorkflowRun.status"), "workflow run lifecycle differs from schema");
  exactSet(contract.lifecycles.WorkflowStep.states, enumValues(workflowSteps.status, "WorkflowStep.status"), "workflow step lifecycle differs from schema");
  exactSet(contract.lifecycles.WorkflowStep.executionStates, enumValues(workflowSteps.executionState, "WorkflowStep.executionState"), "workflow execution lifecycle differs from schema");
  exactSet(contract.lifecycles.ProviderOperation.states, enumValues(externalOperations.status, "ExternalOperation.status"), "provider operation lifecycle differs from schema");
  exactSet(contract.lifecycles.ProviderOperation.states, enumValues(integrationOperations.status, "IntegrationOperation.status"), "provider operation universes diverged");
  exactSet(contract.lifecycles.ProviderOperation.verificationStates, enumValues(integrationOperations.verificationStatus, "IntegrationOperation.verificationStatus"), "provider verification lifecycle differs from schema");
  exactSet(contract.lifecycles.ComputerRun.states, enumValues(computerRuns.status, "ComputerRun.status"), "computer lifecycle differs from schema");
  exactSet(contract.lifecycles.ComputerRun.effectStates, enumValues(computerRuns.effectStatus, "ComputerRun.effectStatus"), "computer effect lifecycle differs from schema");
  exactSet(contract.lifecycles.ReconciliationCase.states, enumValues(reconciliationCases.status, "ReconciliationCase.status"), "reconciliation lifecycle differs from schema");
  exactSet(contract.lifecycles.CompensationCase.states, enumValues(compensationCases.status, "CompensationCase.status"), "compensation lifecycle differs from schema");
  for (const [name, lifecycle] of Object.entries(contract.lifecycles)) {
    assert.ok(Object.keys(lifecycle.transitionPolicy).length > 0, `${name} has states but no machine-readable transition policy`);
  }
  exactSet(contract.contextAndTruth.operatingTruthPrecedence, OPERATING_TRUTH_PRECEDENCE, "truth precedence differs from code");
  exactSet(contract.contextAndTruth.interactionPrecedence, OPERATING_INTERACTION_PRECEDENCE, "interaction precedence differs from code");
  exactSet(contract.canonicalBusinessTruth.concepts.map((row) => row.concept), CANONICAL_ENTITY_TYPES, "canonical business truth registry differs from code");
  assert.ok(contract.compatibilityAndLegacySeams.some((seam) => seam.id === "manual_operational_routes" && seam.classification === "COMPATIBILITY"), "manual operational mutation seam is not recorded");
  assert.ok(contract.compatibilityAndLegacySeams.some((seam) => seam.id === "read_model_projections" && seam.classification === "PROJECTION_ONLY"), "projection ownership seam is not recorded");
  assert.ok(contract.deferredBeyondP0.length > 0, "P0 must record intentionally deferred architecture work");
  const routeSource = await readFile(join(root, "packages/orchestration/src/instruction-routing.ts"), "utf8");
  for (const route of ["QUERY", "ATOMIC_EFFECT", "OBJECTIVE", "CONVERSATION"]) assert.ok(routeSource.includes(`\"${route}\"`), `route ${route} missing from current type`);
  assert.equal(OPERATIONAL_QUERY_INTENTS.length, 13, "actual query registry count changed; update the audited inventory intentionally");
}

async function validateInvariants(manifest: InvariantManifest): Promise<void> {
  assert.equal(manifest.baselineSha, BASELINE_SHA);
  exactSet(manifest.invariants.map((row) => row.id), REQUIRED_INVARIANTS, "invariant set drifted");
  exactSet(manifest.hardGates.map((row) => row.id), REQUIRED_HARD_GATES, "hard gate set drifted");
  for (const gate of manifest.hardGates) assert.equal(gate.expected, 0, `${gate.id} is not a zero-tolerance gate`);
  for (const invariant of manifest.invariants) {
    assert.ok(invariant.statement && invariant.owner && invariant.enforcement.length > 0 && invariant.tests.length > 0, `${invariant.id} is documentation-only`);
    for (const enforcement of invariant.enforcement) {
      const source = await readFile(join(root, enforcement.path), "utf8");
      assert.ok(source.includes(enforcement.anchor), `${invariant.id} enforcement anchor missing: ${enforcement.path}#${enforcement.anchor}`);
    }
    for (const test of invariant.tests) {
      const source = await readFile(join(root, test.file), "utf8");
      assert.ok(source.includes(test.title), `${invariant.id} proof test missing: ${test.file}#${test.title}`);
    }
  }
}

async function validateReplay(manifest: ReplayManifest): Promise<void> {
  assert.equal(manifest.baselineSha, BASELINE_SHA);
  assert.equal(manifest.determinism.liveLlm, false);
  assert.equal(manifest.determinism.liveProviders, false);
  assert.equal(manifest.determinism.network, false);
  exactSet(manifest.cases.map((row) => row.id), REQUIRED_REPLAY_CASES, "locked replay categories drifted");
  const body = { ...manifest } as ReplayManifest;
  delete (body as Partial<ReplayManifest>).corpusHash;
  assert.equal(manifest.corpusHash, deterministicHash(body), "locked replay corpus hash mismatch");
  for (const replayCase of manifest.cases) {
    assert.ok(replayCase.selectors.length > 0, `${replayCase.id} has no executable selector`);
    for (const selector of replayCase.selectors) {
      assert.equal(selector.file.includes("/live/"), false, `${replayCase.id} depends on a live test`);
      const source = await readFile(join(root, selector.file), "utf8");
      assert.ok(source.includes(selector.title), `${replayCase.id} selector missing: ${selector.file}#${selector.title}`);
    }
  }
}

async function packageJsonPaths(directory: string): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "package.json") paths.push(path);
    }
  };
  await walk(directory);
  return paths.sort();
}

type PackageGraph = Map<string, string[]>;
function graphCycles(graph: PackageGraph): string[][] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (name: string) => {
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      cycles.push([...stack.slice(start), name]);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name); stack.push(name);
    for (const dependency of graph.get(name) ?? []) if (graph.has(dependency)) visit(dependency);
    stack.pop(); visiting.delete(name); visited.add(name);
  };
  for (const name of graph.keys()) visit(name);
  return cycles;
}

async function packageGraphs(): Promise<{ baseline: PackageGraph; current: PackageGraph }> {
  const paths = await packageJsonPaths(root);
  const current = new Map<string, string[]>();
  const baseline = new Map<string, string[]>();
  for (const path of paths) {
    const relativePath = relative(root, path);
    const currentJson = JSON.parse(await readFile(path, "utf8")) as { name?: string; dependencies?: JsonObject; devDependencies?: JsonObject; peerDependencies?: JsonObject };
    if (!currentJson.name) continue;
    const dependencies = Object.keys({ ...currentJson.dependencies, ...currentJson.devDependencies, ...currentJson.peerDependencies }).filter((name) => name.startsWith("@finnor/"));
    current.set(currentJson.name, dependencies.sort());
    const baselineText = git(["show", `${BASELINE_SHA}:finnor-os/${relativePath}`]);
    const baselineJson = JSON.parse(baselineText) as typeof currentJson;
    const baselineDependencies = Object.keys({ ...baselineJson.dependencies, ...baselineJson.devDependencies, ...baselineJson.peerDependencies }).filter((name) => name.startsWith("@finnor/"));
    baseline.set(baselineJson.name!, baselineDependencies.sort());
  }
  return { baseline, current };
}

async function validateGeneratedInventories(): Promise<{ packageCount: number; packageCycles: number }> {
  const storedCapability = await readJson<JsonObject>(join(root, "architecture/p0/capability-inventory.json"));
  const generatedCapability = await buildCapabilityInventory();
  assert.deepEqual(storedCapability, generatedCapability, "capability inventory is stale; run p0:inventory");
  assert.deepEqual((storedCapability.counts as JsonObject), { domainActions: 59, domainPlugins: 26, operationalQueries: 13, capabilityContracts: 14, defaultTools: 16, totalNamedCapabilities: 102 });
  const storedReferences = await readJson<ReturnType<typeof buildReferenceInventory>>(join(root, "architecture/p0/reference-inventory.json"));
  const generatedReferences = buildReferenceInventory();
  assert.deepEqual(storedReferences, generatedReferences, "reference inventory is stale; run p0:inventory");
  assert.equal(storedReferences.unexplainedProductionReferenceMovement, 0, "P0 has unexplained production architecture reference movement");
  exactSet(storedReferences.concepts.map((row) => row.concept), Object.keys(REFERENCE_PATTERNS), "reference concepts drifted");
  const graphs = await packageGraphs();
  const baselineCycles = graphCycles(graphs.baseline);
  const currentCycles = graphCycles(graphs.current);
  assert.deepEqual(currentCycles, baselineCycles, "P0 introduced an internal package cycle");
  assert.equal(currentCycles.length, 0, `current package graph contains a cycle: ${currentCycles.map((cycle) => cycle.join(" -> ")).join("; ")}`);
  return { packageCount: graphs.current.size, packageCycles: currentCycles.length };
}

export interface P0CertificationResult {
  status: "PASS";
  baselineSha: string;
  branch: string;
  changedPaths: string[];
  executionModels: number;
  semanticOwners: number;
  lifecycleCount: number;
  invariants: number;
  hardGates: number;
  replayCases: number;
  replayHash: string;
  capabilityCounts: JsonObject;
  referenceConcepts: number;
  productionReferenceMovement: number;
  unexplainedProductionReferenceMovement: number;
  internalPackages: number;
  internalPackageCycles: number;
}

export async function certifyP0(): Promise<P0CertificationResult> {
  const changed = validateChangeScope();
  const contract = await readJson<SubstrateContract>(join(root, "architecture/p0/substrate-contract.json"));
  const invariants = await readJson<InvariantManifest>(join(root, "architecture/p0/invariants.json"));
  const replay = await readJson<ReplayManifest>(join(root, "architecture/p0/replay-corpus.json"));
  const runtimeCorrections = await readJson<RuntimeCorrectionManifest>(join(root, "architecture/p0/runtime-corrections.json"));
  await validateContract(contract);
  await validateInvariants(invariants);
  await validateReplay(replay);
  await validateRuntimeCorrections(runtimeCorrections);
  const graph = await validateGeneratedInventories();
  const capability = await readJson<{ counts: JsonObject }>(join(root, "architecture/p0/capability-inventory.json"));
  const references = await readJson<{ concepts: unknown[]; productionReferenceMovement: number; unexplainedProductionReferenceMovement: number }>(join(root, "architecture/p0/reference-inventory.json"));
  return {
    status: "PASS",
    baselineSha: BASELINE_SHA,
    branch: P0_BRANCH,
    changedPaths: changed,
    executionModels: contract.executionModels.length,
    semanticOwners: contract.semanticOwnership.length,
    lifecycleCount: Object.keys(contract.lifecycles).length,
    invariants: invariants.invariants.length,
    hardGates: invariants.hardGates.length,
    replayCases: replay.cases.length,
    replayHash: replay.corpusHash,
    capabilityCounts: capability.counts,
    referenceConcepts: references.concepts.length,
    productionReferenceMovement: references.productionReferenceMovement,
    unexplainedProductionReferenceMovement: references.unexplainedProductionReferenceMovement,
    internalPackages: graph.packageCount,
    internalPackageCycles: graph.packageCycles,
  };
}

if (process.argv.includes("--run")) {
  void certifyP0()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
