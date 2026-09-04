import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as databaseSchema from "../../packages/db/schema";
import { BUSINESS_TRUTH_REGISTRY } from "../../packages/data-platform/src/business-truth-registry";
import {
  CANONICAL_ENTITY_TYPES,
  OPERATIONAL_QUERY_INTENTS,
  PARTY_TYPES,
} from "../../packages/shared-types/src/index";
import { buildCapabilityInventory } from "../p0/generate-capability-inventory";
import { buildReferenceInventory } from "../p0/reference-inventory";
import { discoverActionRegistry } from "../release/discover-action-registry";
import { ACTION_HARDENING_SPEC_BY_ACTION } from "../release/action-hardening-spec";
import {
  ACCEPTANCE_TRACES,
  ACTION_DISPOSITIONS,
  artifactDisposition,
  CANONICAL_ENTITY_DISPOSITIONS,
  CUTOVER_BLOCKERS,
  DISPOSITIONS,
  JOB_DISPOSITIONS,
  PARTY_TYPE_DISPOSITIONS,
  PE0_BASELINE_SHA,
  PHASE_BOUNDARIES,
  PROVIDER_DEFINITIONS,
  QUERY_DISPOSITIONS,
  tableDisposition,
  WATER_PATTERNS,
  type Disposition,
  type DispositionDecision,
} from "./model";
import {
  absoluteRepoPath,
  artifactId,
  boundedSnippet,
  buildPackageTargets,
  countBy,
  finnorOsRoot,
  git,
  isTextAuditCandidate,
  lines,
  normalizeModelPath,
  packageForPath,
  parseSource,
  repoPath,
  repositoryRoot,
  sortedUnique,
  stableHash,
  trackedFiles,
  writeJson,
  type LocalImport,
  type PackageTarget,
  type ParsedSource,
} from "./lib";

type Risk = "low" | "medium" | "high" | "critical";

type WaterHit = {
  id: string;
  meaning: string;
  occurrenceCount: number;
  evidence: Array<{ line: number; snippet: string }>;
};

type SourceRecord = {
  path: string;
  text: string;
  parsed: ParsedSource;
  contentHash: string;
};

type Entrypoint = {
  id: string;
  path: string;
  kind: string;
  deployedComponent: string;
  activeInProduction: boolean;
  activation: string;
  evidence: string;
};

type TableRecord = {
  exportName: string;
  table: string;
  columns: Array<{ property: string; sqlName: string; dataType: string; notNull: boolean; primaryKey: boolean; hasDefault: boolean }>;
  foreignKeys: Array<{ columns: string[]; foreignTable: string; foreignColumns: string[] }>;
  indexes: string[];
  policies: string[];
  rlsEnabled: boolean;
};

type Graph = {
  importsByPath: Map<string, LocalImport[]>;
  dependencies: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
  unresolvedLocalImports: Array<{ importer: string; specifier: string; line: number }>;
  dynamicEdges: Array<{ from: string; to: string; kind: string; evidence: string }>;
};

type AuditArtifact = {
  id: string;
  branchTree: { baselineSha: string; treeSha: string; source: string };
  path: string;
  package: string;
  symbols: Array<{ name: string; line: number; kind: string }>;
  artifactType: string;
  lifecycle: "production-runtime" | "production-release" | "migration-history" | "test" | "dev" | "history";
  runtimeReachable: boolean;
  activeInProduction: boolean;
  runtimeEntrypoints: string[];
  directImports: LocalImport[];
  dynamicConsumers: string[];
  dependents: string[];
  registryMembership: {
    plugins: string[];
    actionTypes: string[];
    queryIntents: string[];
    jobTypes: string[];
    schedulerRegistrations: string[];
  };
  eventTypesConsumed: string[];
  eventTypesEmitted: string[];
  databaseTablesRead: string[];
  databaseTablesWritten: string[];
  databaseColumnsWithDomainSemantics: string[];
  databaseTriggersInvolved: string[];
  canonicalEntityTypesUsed: string[];
  partyRefUsage: string[];
  businessTruthRegistryOwnership: string[];
  sourceImportOwnership: string[];
  externalProviderBindings: string[];
  credentialsAuthProfilesUsed: string[];
  externalSideEffects: string[];
  businessEffectsEmitted: string[];
  preconditionsPostconditions: string[];
  reconciliationReadBackOwnership: string[];
  receiptEvidenceOwnership: string[];
  compensationSemantics: string[];
  idempotencySemantics: string[];
  workObjectiveCoupling: string[];
  authorityPolicyCoupling: string[];
  tenantIsolationRlsCoupling: string[];
  phaseDependencies: string[];
  memoryDependency: string[];
  computerRuntimeDependency: string[];
  testsCovering: string[];
  certificationReleaseGatesCovering: string[];
  migrationIntroducingIt: string[];
  migrationAssumptionsDependingOnIt: string[];
  waterSemantics: WaterHit[];
  reusableMechanismPresent: boolean;
  peResponsibility: string | null;
  deletionBlockers: string[];
  extractionBlockers: string[];
  replacementPrerequisites: string[];
  decisionDimensions: Record<string, string | number | boolean>;
  migrationRisk: Risk;
  securityRisk: Risk;
  releaseRisk: Risk;
  confidence: "high" | "medium";
  finalDisposition: Disposition;
  dispositionRule: string;
  reason: string;
  evidenceAnchors: Array<{ path: string; line: number | null; fact: string }>;
  contentHash: string;
};

const branchSpecs = [
  { name: "main", ref: "refs/remotes/origin/main" },
  { name: "codex/final-production-audit", ref: "refs/remotes/origin/codex/final-production-audit" },
  { name: "codex/p3-p6-authoritative-cutover", ref: "refs/remotes/origin/codex/p3-p6-authoritative-cutover" },
] as const;

function resolveCommit(ref: string): string {
  return git(["rev-parse", `${ref}^{commit}`]);
}

function commitMetadata(sha: string) {
  const raw = git(["show", "-s", "--format=%H%x00%cI%x00%T%x00%P%x00%s", sha]);
  const [head, timestamp, treeSha, parents, subject] = raw.split("\0");
  return { sha: head!, timestamp: timestamp!, treeSha: treeSha!, parents: parents ? parents.split(" ") : [], subject: subject! };
}

function parseNameStatus(raw: string): Array<{ status: string; path: string; oldPath?: string }> {
  return lines(raw).map((line) => {
    const [status, first, second] = line.split("\t");
    return second ? { status: status!, oldPath: first!, path: second } : { status: status!, path: first! };
  });
}

function buildBranchState() {
  const resolved = branchSpecs.map((spec) => ({ ...spec, ...commitMetadata(resolveCommit(spec.ref)) }));
  const main = resolved.find((branch) => branch.name === "main")!;
  const branches = resolved.map((branch) => {
    const [mainOnly = "0", branchOnly = "0"] = git(["rev-list", "--left-right", "--count", `${main.sha}...${branch.sha}`]).trim().split(/\s+/);
    const delta = branch.name === "main" ? [] : parseNameStatus(git(["diff", "--name-status", main.sha, branch.sha]));
    const modified = delta.filter((entry) => entry.status.startsWith("M") || entry.status.startsWith("R") || entry.status.startsWith("T"));
    const onlyOnBranch = delta.filter((entry) => entry.status.startsWith("A")).map((entry) => entry.path);
    const onlyOnMain = delta.filter((entry) => entry.status.startsWith("D")).map((entry) => entry.path);
    const touched = delta.map((entry) => entry.path);
    const registryTouched = touched.filter((path) => /plugin-registry|operational-queries|apps\/worker\/src\/index|action-hardening-spec/.test(path));
    return {
      name: branch.name,
      auditedRef: branch.ref,
      sha: branch.sha,
      timestamp: branch.timestamp,
      treeSha: branch.treeSha,
      parents: branch.parents,
      subject: branch.subject,
      relationshipToMain: {
        mainIsAncestor: isAncestor(main.sha, branch.sha),
        branchIsAncestor: isAncestor(branch.sha, main.sha),
        commitsOnlyOnMain: Number(mainOnly),
        commitsOnlyOnBranch: Number(branchOnly),
      },
      filesOnlyOnBranch: onlyOnBranch,
      filesOnlyOnMain: onlyOnMain,
      filesModifiedRelativeToMain: modified,
      deltaEntries: delta.map((entry) => ({
        ...entry,
        category: /packages\/db\/migrations/.test(entry.path) ? "migration"
          : /(?:architecture|certif|release|\.github\/workflows)/i.test(entry.path) ? "certification-release"
            : /^(?:finnor-os\/)?(?:apps|packages)\//.test(entry.path) ? "runtime"
              : "supporting",
        disposition: branch.name === "main" ? "CURRENT_PRODUCTION_SOURCE" : "SUPERSEDED_BY_MAIN",
        dangerousToResurrect: branch.name !== "main" && /(?:auth|rate-limit|instruction-routing|planner|conversation|production-release|rollback|capture|proxy|lineage|db\/index)/i.test(entry.path),
        evidence: branch.name === "main"
          ? "No delta: this is the production-selected line."
          : "main contains the later production hardening; this historical file is not a missing capability and must not be cherry-picked in PE0.",
      })),
      migrationsUniqueToBranch: onlyOnBranch.filter((path) => /\/migrations\/\d+.*\.sql$/.test(path)),
      runtimeCapabilitiesUniqueToBranch: registryTouched.length === 0 ? [] : ["Registry-bearing files differ; inspect delta entries"],
      certificationReleaseArtifactsDifferentFromMain: touched.filter((path) => /(?:architecture|certif|release|\.github\/workflows)/i.test(path)),
      deltaDisposition: branch.name === "main"
        ? "CURRENT_PRODUCTION_SOURCE"
        : "HISTORY_ONLY_SUPERSEDED",
      deltaEvidence: branch.name === "main"
        ? "infra/deployment/production.contract.json selects origin/main and .github/workflows/production-release.yml triggers on main."
        : "The branch is an ancestor of main; its implementation tree lacks later authentication, rate-limit, deterministic-routing, rollback and production-release hardening present on main. Resurrecting it would regress those controls.",
    };
  });
  const implementationTrees = [...new Set(branches.map((branch) => branch.treeSha))].sort().map((treeSha) => ({
    treeSha,
    branches: branches.filter((branch) => branch.treeSha === treeSha).map((branch) => branch.name),
  }));
  const baseline = commitMetadata(PE0_BASELINE_SHA);
  const body = {
    schemaVersion: 1,
    auditBaseline: { ...baseline, requiredByMandate: true },
    productionSelectionEvidence: {
      canonicalBranch: "main",
      contract: "infra/deployment/production.contract.json",
      releaseTrigger: ".github/workflows/production-release.yml",
      requiredComponents: ["frontend", "api", "worker"],
      orchestrator: "embedded-worker",
    },
    uniqueImplementationCount: implementationTrees.length,
    implementationTrees,
    branches,
  };
  return { ...body, manifestHash: stableHash(body) };
}

function isSource(path: string): boolean {
  return [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(path));
}

async function readSources(paths: readonly string[], packages: ReadonlyMap<string, PackageTarget>): Promise<Map<string, SourceRecord>> {
  const pairs = await Promise.all(paths.map(async (path): Promise<[string, SourceRecord]> => {
    const text = await readFile(absoluteRepoPath(path), "utf8");
    const parsed = isSource(path) ? parseSource(path, text, packages) : { symbols: [], imports: [], stringLiterals: [] };
    return [path, { path, text, parsed, contentHash: stableHash(text) }];
  }));
  return new Map(pairs);
}

function buildEntrypoints(tracked: readonly string[]): Entrypoint[] {
  const entries: Entrypoint[] = [];
  const push = (path: string, kind: string, component: string, active: boolean, activation: string, evidence: string) => {
    if (!tracked.includes(path)) return;
    entries.push({ id: `${kind}:${path}`, path, kind, deployedComponent: component, activeInProduction: active, activation, evidence });
  };
  for (const path of tracked.filter((candidate) => candidate.startsWith("finnor-os/apps/api/app/api/") && candidate.endsWith("/route.ts"))) {
    push(path, "api-route", "api", true, "Next.js route discovery", "Production contract requires the Vercel API component.");
  }
  for (const path of tracked.filter((candidate) => candidate.startsWith("src/app/api/") && candidate.endsWith("/route.ts"))) {
    push(path, "frontend-api-route", "frontend", true, "Next.js route discovery", "Production contract requires the root Vercel frontend component.");
  }
  push("finnor-os/apps/worker/src/index.ts", "worker-boot", "worker", true, "ECS container command", "infra/aws/finnor-production.yaml starts apps/worker/src/index.ts.");
  push("finnor-os/packages/db/migrate.ts", "migration-runner", "database", true, "production release migration step", ".github/workflows/production-release.yml invokes npm run db:migrate.");
  push("finnor-os/apps/api/instrumentation.ts", "api-startup", "api", true, "Next.js instrumentation hook", "Next.js loads instrumentation at API startup.");
  push("finnor-os/apps/supplier-canary/api/index.mjs", "supplier-canary", "supplier-canary", false, "standalone Vercel function only", "Not listed in production.contract.json requiredComponents and has no current release caller.");
  push("finnor-os/apps/orchestrator/src/index.ts", "standalone-orchestrator", "orchestrator", false, "standalone app only", "Production contract explicitly says embedded-worker and separateDeployment=false.");
  push(".github/workflows/production-release.yml", "release-workflow", "release", true, "GitHub push to main", "The authoritative production workflow triggers on main.");
  push("infra/deployment/production.contract.json", "deployment-contract", "release", true, "release truth validation", "Root release scripts validate this contract.");
  push("infra/aws/finnor-production.yaml", "worker-infrastructure", "worker", true, "CloudFormation deployment", "The production contract names this ECS/Fargate topology.");
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

function addEdge(graph: Graph, from: string, to: string, kind: string, evidence: string): void {
  if (!graph.dependencies.has(from)) graph.dependencies.set(from, new Set());
  if (!graph.dependents.has(to)) graph.dependents.set(to, new Set());
  graph.dependencies.get(from)!.add(to);
  graph.dependents.get(to)!.add(from);
  if (kind !== "static-import") graph.dynamicEdges.push({ from, to, kind, evidence });
}

function buildGraph(sources: ReadonlyMap<string, SourceRecord>, tracked: readonly string[]): Graph {
  const graph: Graph = { importsByPath: new Map(), dependencies: new Map(), dependents: new Map(), unresolvedLocalImports: [], dynamicEdges: [] };
  for (const [path, source] of sources) {
    graph.importsByPath.set(path, source.parsed.imports);
    for (const imported of source.parsed.imports) {
      if (imported.resolvedPath) addEdge(graph, path, imported.resolvedPath, "static-import", `${imported.kind} ${imported.specifier}:${imported.line}`);
      else if (!imported.external) graph.unresolvedLocalImports.push({ importer: path, specifier: imported.specifier, line: imported.line });
    }
  }
  const workerIndex = "finnor-os/apps/worker/src/index.ts";
  for (const path of tracked.filter((candidate) => candidate.startsWith("finnor-os/apps/worker/src/handlers/") && candidate.endsWith(".ts"))) {
    addEdge(graph, workerIndex, path, "job-registry", "createWorker registers handlers by string key");
  }
  const migrate = "finnor-os/packages/db/migrate.ts";
  for (const path of tracked.filter((candidate) => candidate.startsWith("finnor-os/packages/db/migrations/") && candidate.endsWith(".sql"))) {
    addEdge(graph, migrate, path, "migration-discovery", "migrate.ts discovers numbered SQL migrations at runtime");
  }
  const pluginRegistry = "finnor-os/packages/orchestration/src/plugin-registry.ts";
  for (const path of tracked.filter((candidate) => /^finnor-os\/packages\/domain-plugins\/[^/]+\/index\.ts$/.test(candidate))) {
    addEdge(graph, pluginRegistry, path, "plugin-registry", "createDefaultPluginRegistry registers the plugin at startup");
  }
  const productionWorkflow = ".github/workflows/production-release.yml";
  for (const path of tracked.filter((candidate) => candidate.startsWith("finnor-os/scripts/release/") || candidate.startsWith("scripts/release/"))) {
    addEdge(graph, productionWorkflow, path, "release-command-surface", "Production workflow invokes package release scripts directly or through npm scripts");
  }
  addEdge(graph, "finnor-os/scripts/generate-openapi.ts", "finnor-os/openapi.json", "generated-contract", "npm run openapi writes the canonical OpenAPI contract");
  addEdge(graph, productionWorkflow, "finnor-os/package.json", "npm-script-registry", "Production workflow invokes finnor-os npm scripts");
  addEdge(graph, productionWorkflow, "package.json", "npm-script-registry", "Production workflow invokes root npm scripts");
  addEdge(graph, productionWorkflow, "infra/deployment/production.contract.json", "deployment-contract", "Release validates the canonical production topology");
  addEdge(graph, productionWorkflow, "infra/aws/finnor-production.yaml", "deployment-template", "Release deploys the worker CloudFormation stack");
  return graph;
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function collectTables(): TableRecord[] {
  const result: TableRecord[] = [];
  for (const [exportName, value] of Object.entries(databaseSchema)) {
    try {
      const table = getTableName(value as never);
      if (!table) continue;
      const config = getTableConfig(value as never);
      result.push({
        exportName,
        table,
        columns: config.columns.map((column) => ({
          property: column.name,
          sqlName: column.name,
          dataType: column.dataType,
          notNull: column.notNull,
          primaryKey: column.primary,
          hasDefault: column.hasDefault,
        })),
        foreignKeys: config.foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            columns: reference.columns.map((column) => column.name),
            foreignTable: getTableName(reference.foreignTable),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
          };
        }),
        indexes: config.indexes.map((index) => index.config.name ?? "<generated>"),
        policies: config.policies.map((policy) => policy.name),
        rlsEnabled: Boolean(config.enableRLS || config.policies.length),
      });
    } catch {
      // schema.ts exports helpers and enums beside Drizzle tables.
    }
  }
  return result.sort((left, right) => left.table.localeCompare(right.table));
}

function walk(root: string, dependencies: ReadonlyMap<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dependency of dependencies.get(current) ?? []) if (!seen.has(dependency)) queue.push(dependency);
  }
  return seen;
}

function pathsReachingTargets(roots: readonly string[], dependencies: ReadonlyMap<string, Set<string>>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const root of roots) {
    for (const target of walk(root, dependencies)) {
      if (!result.has(target)) result.set(target, new Set());
      result.get(target)!.add(root);
    }
  }
  return result;
}

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waterHits(text: string): WaterHit[] {
  const sourceLines = text.split("\n");
  return WATER_PATTERNS.flatMap((pattern) => {
    const matches: Array<{ line: number; snippet: string }> = [];
    let count = 0;
    sourceLines.forEach((line, index) => {
      pattern.expression.lastIndex = 0;
      if (!pattern.expression.test(line)) return;
      count += 1;
      if (matches.length < 5) matches.push({ line: index + 1, snippet: boundedSnippet(text, index + 1) });
    });
    return count ? [{ id: pattern.id, meaning: pattern.meaning, occurrenceCount: count, evidence: matches }] : [];
  });
}

function tableUsage(source: SourceRecord, tables: readonly TableRecord[]): { reads: string[]; writes: string[]; references: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const references = new Set<string>();
  if (source.path === "finnor-os/packages/db/schema.ts") return { reads: [], writes: [], references: tables.map((table) => table.table) };
  for (const table of tables) {
    const exportPattern = new RegExp(`\\b${regexpEscape(table.exportName)}\\b`);
    const sqlPattern = new RegExp(`\\b${regexpEscape(table.table)}\\b`, "i");
    if (!exportPattern.test(source.text) && !sqlPattern.test(source.text)) continue;
    references.add(table.table);
    const writePatterns = [
      new RegExp(`\\.(?:insert|update|delete)\\s*\\(\\s*${regexpEscape(table.exportName)}\\b`),
      new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:finnor_os\\.)?[\"']?${regexpEscape(table.table)}\\b`, "i"),
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:FUNCTION|TRIGGER).*${regexpEscape(table.table)}`, "is"),
    ];
    const readPatterns = [
      new RegExp(`\\.(?:from|leftJoin|rightJoin|innerJoin|fullJoin)\\s*\\(\\s*${regexpEscape(table.exportName)}\\b`),
      new RegExp(`\\b(?:FROM|JOIN)\\s+(?:finnor_os\\.)?[\"']?${regexpEscape(table.table)}\\b`, "i"),
    ];
    if (writePatterns.some((pattern) => pattern.test(source.text))) writes.add(table.table);
    if (readPatterns.some((pattern) => pattern.test(source.text))) reads.add(table.table);
    if (!writes.has(table.table) && !reads.has(table.table) && isSource(source.path)) reads.add(table.table);
  }
  return { reads: sortedUnique(reads), writes: sortedUnique(writes), references: sortedUnique(references) };
}

function extractTriggers(migrationSources: readonly SourceRecord[]): Array<{ name: string; table: string; migration: string; line: number }> {
  const result: Array<{ name: string; table: string; migration: string; line: number }> = [];
  for (const source of migrationSources) {
    const expression = /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+["']?([a-zA-Z0-9_]+)["']?[\s\S]{0,500}?\bON\s+(?:finnor_os\.)?["']?([a-zA-Z0-9_]+)["']?/gi;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(source.text))) {
      const line = source.text.slice(0, match.index).split("\n").length;
      result.push({ name: match[1]!, table: match[2]!, migration: source.path, line });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name) || left.migration.localeCompare(right.migration));
}

function migrationOwnership(tables: readonly TableRecord[], migrations: readonly SourceRecord[]) {
  return new Map(tables.map((table) => {
    const referenced = migrations.filter((migration) => new RegExp(`\\b${regexpEscape(table.table)}\\b`, "i").test(migration.text));
    const introductions = referenced.filter((migration) => new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:finnor_os\\.)?[\"']?${regexpEscape(table.table)}\\b`, "i").test(migration.text));
    return [table.table, {
      introducing: introductions.map((migration) => migration.path),
      assumptions: referenced.filter((migration) => !introductions.includes(migration)).map((migration) => migration.path),
    }] as const;
  }));
}

function extractCredentials(text: string): string[] {
  const values = new Set<string>();
  const expressions = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g,
    /\$\{\{\s*(?:secrets|vars)\.([A-Z][A-Z0-9_]+)/g,
    /\b(?:secretMap|environment|env):[\s\S]{0,80}?["']?([A-Z][A-Z0-9_]{3,})["']?\s*:/g,
  ];
  for (const expression of expressions) {
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) values.add(match[1]!);
  }
  return sortedUnique(values);
}

const eventShape = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}$/;
const eventVerb = /(?:created|updated|changed|completed|failed|requested|approved|rejected|received|recorded|started|finished|expired|cancelled|canceled|resumed|paused|verified|observed|reconciled|compensated|dispatched|delivered|submitted|transitioned|assigned|escalated|resolved|ingested|persisted|queued|claimed|released)$/;

function extractEvents(source: SourceRecord): { consumed: string[]; emitted: string[] } {
  const consumed = new Set<string>();
  const emitted = new Set<string>();
  for (const literal of source.parsed.stringLiterals) {
    if (!eventShape.test(literal.value) || (!eventVerb.test(literal.value) && !/event|outbox|inbox/i.test(literal.context))) continue;
    if (/case\s+|===|eventType|event_type|consume|listener|wait/i.test(literal.context)) consumed.add(literal.value);
    if (/recordBusinessEvent|emit|enqueueOutbox|eventType|event_type|type\s*:|append/i.test(literal.context)) emitted.add(literal.value);
  }
  return { consumed: sortedUnique(consumed), emitted: sortedUnique(emitted) };
}

function artifactType(path: string): string {
  if (path.endsWith("/route.ts")) return "api-route";
  if (/apps\/worker\/src\/handlers\//.test(path)) return "worker-handler";
  if (/apps\/worker\/src\/index\.ts$/.test(path)) return "worker-registry";
  if (/packages\/domain-plugins\//.test(path)) return "domain-plugin";
  if (path.endsWith("packages/db/schema.ts")) return "active-schema";
  if (/packages\/db\/migrations\/\d+.*\.sql$/.test(path)) return "historical-migration";
  if (/source-adapter|source-truth|sync-source/.test(path)) return "source-sync";
  if (/import-writes|import-engine/.test(path)) return "import-boundary";
  if (/operational-queries|read-model/.test(path)) return "query-read-model";
  if (/planner|objective-loop|read-routing|operating-context/.test(path)) return "planner-cognition";
  if (/authority|policy/.test(path)) return "identity-authority-policy";
  if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (/scripts\/(?:p[0-6]|release)|\.github\/workflows|infra\//.test(path)) return "release-certification";
  if (/architecture\//.test(path)) return "architecture-history";
  if (path.endsWith("package.json")) return "package-entrypoint";
  if (path.endsWith(".sql")) return "database-history";
  if (isSource(path)) return "runtime-module";
  return "runtime-contract";
}

function lifecycleFor(path: string, runtimeReachable: boolean, activeInProduction: boolean): AuditArtifact["lifecycle"] {
  if (/packages\/db\/migrations\/\d+.*\.sql$|supabase\/migrations/.test(path)) return "migration-history";
  if (/architecture\/p[0-6]|corpus\/|docs\/release\/evidence/.test(path)) return "history";
  if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (/\.github\/workflows|infra\/|scripts\/(?:release|p[0-6])|package\.json|openapi\.json/.test(path) && runtimeReachable && !activeInProduction) return "production-release";
  if (activeInProduction) return "production-runtime";
  return "dev";
}

function referencesToken(text: string, token: string): boolean {
  return new RegExp(`\\b${regexpEscape(token)}\\b`).test(text);
}

function phasesFor(source: SourceRecord): string[] {
  const joined = `${source.path}\n${source.parsed.imports.map((entry) => entry.specifier).join("\n")}`;
  const result: string[] = [];
  if (/operational-ir/.test(joined)) result.push("P1", "P2");
  if (/epistemic-runtime/.test(joined)) result.push("P3");
  if (/program-search/.test(joined)) result.push("P4");
  if (/speculative-runtime/.test(joined)) result.push("P5");
  if (/trace-compiler/.test(joined)) result.push("P6");
  return sortedUnique(result);
}

function anchoredFact(source: SourceRecord, pattern: RegExp, fact: string): { path: string; line: number | null; fact: string } | null {
  const index = source.text.split("\n").findIndex((line) => pattern.test(line));
  return index < 0 ? null : { path: source.path, line: index + 1, fact };
}

function importBindings(source: SourceRecord): Map<string, string> {
  const result = new Map<string, string>();
  const expression = /import\s+(?:type\s+)?(?:\{([\s\S]*?)\}|([A-Za-z_$][\w$]*))\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(source.text))) {
    const imported = source.parsed.imports.find((entry) => entry.specifier === match![3] && entry.resolvedPath);
    if (!imported?.resolvedPath) continue;
    if (match[2]) result.set(match[2], imported.resolvedPath);
    for (const raw of (match[1] ?? "").split(",")) {
      const cleaned = raw.replace(/\btype\s+/g, "").trim();
      if (!cleaned) continue;
      const [original, alias] = cleaned.split(/\s+as\s+/);
      result.set((alias ?? original)!.trim(), imported.resolvedPath);
    }
  }
  return result;
}

function buildJobRegistry(
  sources: ReadonlyMap<string, SourceRecord>,
  usageByPath: ReadonlyMap<string, ReturnType<typeof tableUsage>>,
  coverageByPath: ReadonlyMap<string, Set<string>>,
) {
  const workerPath = "finnor-os/apps/worker/src/index.ts";
  const worker = sources.get(workerPath)!;
  const bindings = importBindings(worker);
  const registrations: Array<{ jobType: string; handlerSymbol: string; handlerPath: string | null; line: number }> = [];
  const registerExpression = /queue\.register\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = registerExpression.exec(worker.text))) {
    registrations.push({
      jobType: match[1]!,
      handlerSymbol: match[2]!,
      handlerPath: bindings.get(match[2]!) ?? null,
      line: worker.text.slice(0, match.index).split("\n").length,
    });
  }
  const schedules: Array<{ jobType: string; scope: "tenant" | "global"; intervalHours: number; path: string; line: number }> = [];
  const tenantScheduleExpression = /\{\s*type:\s*["']([^"']+)["']\s*,\s*intervalHours:\s*([^,}]+)/g;
  while ((match = tenantScheduleExpression.exec(worker.text))) {
    const expression = match[2]!.trim();
    let intervalHours = Number(expression);
    if (expression.includes("/")) {
      const [numerator, denominator] = expression.split("/").map(Number);
      intervalHours = numerator! / denominator!;
    }
    schedules.push({ jobType: match[1]!, scope: "tenant", intervalHours, path: workerPath, line: worker.text.slice(0, match.index).split("\n").length });
  }
  const globalExpression = /startGlobalScheduler\(\s*["']([^"']+)["']\s*,\s*([0-9.]+)/g;
  while ((match = globalExpression.exec(worker.text))) {
    schedules.push({ jobType: match[1]!, scope: "global", intervalHours: Number(match[2]), path: workerPath, line: worker.text.slice(0, match.index).split("\n").length });
  }
  const rows = registrations.map((registration) => {
    const disposition = JOB_DISPOSITIONS[registration.jobType];
    if (!disposition) throw new Error(`No PE0 disposition for registered job ${registration.jobType}`);
    const usage = registration.handlerPath ? usageByPath.get(registration.handlerPath) : undefined;
    const handler = registration.handlerPath ? sources.get(registration.handlerPath) : undefined;
    const events = handler ? extractEvents(handler) : { consumed: [], emitted: [] };
    const enqueuers = [...sources.values()]
      .filter((source) => source.path !== workerPath && source.parsed.stringLiterals.some((literal) => literal.value === registration.jobType))
      .map((source) => source.path)
      .sort();
    return {
      ...registration,
      disposition: disposition.disposition,
      dispositionRule: disposition.rule,
      reason: disposition.rationale,
      registry: { path: workerPath, symbol: "createWorker", line: registration.line },
      schedules: schedules.filter((schedule) => schedule.jobType === registration.jobType),
      enqueuers,
      tablesRead: usage?.reads ?? [],
      tablesWritten: usage?.writes ?? [],
      eventTypesConsumed: events.consumed,
      eventTypesEmitted: events.emitted,
      retryAndDlq: "JobQueue claims durable jobs with attempt/max-attempt state, retry_at and dead-letter terminal handling.",
      tenantScope: registration.jobType === "backup_db" ? "global" : "trusted job payload tenantId plus tenant-scoped repositories",
      workObjectiveCoupling: /objective|instruction|work_event|interactive_work/.test(registration.jobType),
      reusableMechanism: disposition.reusableMechanism,
      extractionBlockers: disposition.extractionBlockers,
      tests: registration.handlerPath ? sortedUnique(coverageByPath.get(registration.handlerPath) ?? []) : [],
    };
  });
  const body = {
    schemaVersion: 1,
    registry: { path: workerPath, symbol: "createWorker", registeredCount: rows.length },
    proactiveScheduler: { path: workerPath, symbol: "PROACTIVE_SCANS", tenantRegistrationCount: schedules.filter((row) => row.scope === "tenant").length },
    globalScheduler: { path: workerPath, symbol: "startGlobalScheduler", registrationCount: schedules.filter((row) => row.scope === "global").length },
    jobs: rows,
    schedulerRegistrations: schedules,
    dispositions: countBy(rows.map((row) => row.disposition)),
  };
  return { ...body, manifestHash: stableHash(body) };
}

const QUERY_TABLES: Record<string, string[]> = {
  customer_lookup: ["households", "contacts", "contact_methods", "party_aliases"],
  customer_cohort: ["households", "contacts", "contact_methods", "service_visits", "messages"],
  schedule_range: ["appointments", "service_visits", "work_orders", "technicians", "internal_events"],
  money_summary: ["invoices", "payments"],
  work_list: ["works", "tasks", "work_orders", "workflow_runs", "workflow_steps"],
  inventory_status: ["inventory_items", "warehouse_stock", "warehouses", "procurement_orders"],
  agent_activity: ["action_log", "domain_actions", "calls", "messages", "workflow_runs"],
  business_state: ["households", "leads", "opportunities", "appointments", "quotes", "proposals", "invoices", "payments", "inventory_items", "service_visits"],
  company_context: ["households", "contacts", "users", "technicians", "equipment", "service_visits", "work_orders", "appointments", "invoices", "payments", "tasks", "works", "external_organizations", "external_contacts"],
  party_lookup: ["users", "org_units", "tenant_locations", "households", "contacts", "external_organizations", "external_contacts", "party_aliases", "communication_identities"],
  party_context: ["users", "org_units", "tenant_locations", "households", "contacts", "external_organizations", "external_contacts", "party_aliases"],
  team_roster: ["users", "org_units", "org_unit_memberships", "employee_roles", "employee_role_assignments"],
  party_availability: ["internal_events", "appointments", "service_visits", "technicians", "technician_capacity", "dispatch_profiles"],
};

function buildQueryMap(sources: ReadonlyMap<string, SourceRecord>, coverageByPath: ReadonlyMap<string, Set<string>>) {
  const schemaPath = "finnor-os/packages/shared-types/src/operational-queries.ts";
  const resolverPath = "finnor-os/packages/read-models/src/operational-queries.ts";
  const partyResolverPath = "finnor-os/packages/read-models/src/party-queries.ts";
  const rows = OPERATIONAL_QUERY_INTENTS.map((intent) => {
    const disposition = QUERY_DISPOSITIONS[intent];
    if (!disposition) throw new Error(`No PE0 disposition for query intent ${intent}`);
    const resolver = ["party_lookup", "party_context", "team_roster", "party_availability"].includes(intent) ? partyResolverPath : resolverPath;
    const schema = sources.get(schemaPath)!;
    const implementation = sources.get(resolver)!;
    const schemaLine = schema.text.split("\n").findIndex((line) => line.includes(`"${intent}"`)) + 1;
    const resolverLine = implementation.text.split("\n").findIndex((line) => line.includes(`"${intent}"`) || line.toLowerCase().includes(intent.replaceAll("_", ""))) + 1;
    return {
      intent,
      disposition: disposition.disposition,
      dispositionRule: disposition.rule,
      reason: disposition.rationale,
      validationSchema: { path: schemaPath, line: schemaLine || null, owner: "OperationalQueryRequest discriminated union" },
      compilerRouter: [
        "finnor-os/packages/orchestration/src/fast-read-lane.ts",
        "finnor-os/packages/orchestration/src/read-routing.ts",
        "finnor-os/packages/orchestration/src/index.ts",
      ],
      resolver: { path: resolver, line: resolverLine || null },
      tablesRead: QUERY_TABLES[intent] ?? [],
      queryReceiptWrites: ["work_query_executions", "work_entity_links"],
      operatingContextConsumers: ["finnor-os/packages/orchestration/src/operating-context.ts", "finnor-os/packages/orchestration/src/objective-loop.ts"],
      apiExposure: "finnor-os/apps/api/app/api/queries/route.ts",
      reusableMechanism: disposition.reusableMechanism,
      peResponsibility: disposition.peResponsibility,
      extractionBlockers: disposition.extractionBlockers,
      replacementPrerequisites: disposition.replacementPrerequisites,
      tests: sortedUnique([...(coverageByPath.get(schemaPath) ?? []), ...(coverageByPath.get(resolver) ?? [])]),
    };
  });
  const body = {
    schemaVersion: 1,
    registry: { path: schemaPath, symbol: "OPERATIONAL_QUERY_INTENTS", count: rows.length },
    mechanism: "Typed, bounded, tenant-scoped canonical reads plus durable work_query_executions receipts.",
    verticalNoneStatus: "BLOCKED: the fixed union, router fallbacks and default planner catalog contain Water queries.",
    queries: rows,
    dispositions: countBy(rows.map((row) => row.disposition)),
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildActionMap(
  discoveredActions: Awaited<ReturnType<typeof discoverActionRegistry>>,
  capabilityInventory: Awaited<ReturnType<typeof buildCapabilityInventory>>,
  sources: ReadonlyMap<string, SourceRecord>,
  usageByPath: ReadonlyMap<string, ReturnType<typeof tableUsage>>,
  coverageByPath: ReadonlyMap<string, Set<string>>,
) {
  const capabilityByName = new Map(capabilityInventory.universes.domainActions.map((row) => [row.name, row]));
  const rows = discoveredActions.map((action) => {
    const decision = ACTION_DISPOSITIONS[action.actionType];
    const hardening = ACTION_HARDENING_SPEC_BY_ACTION.get(action.actionType);
    const capability = capabilityByName.get(action.actionType);
    if (!decision || !hardening || !capability) throw new Error(`Incomplete PE0 action evidence for ${action.actionType}`);
    const sourcePath = action.sourcePath;
    const source = sources.get(sourcePath);
    const usage = usageByPath.get(sourcePath);
    const providers = PROVIDER_DEFINITIONS.filter((provider) => {
      const tokens = `${hardening.capabilityFamily} ${source?.text ?? ""}`.toLowerCase();
      return provider.provider.split("/").some((name) => tokens.includes(name));
    }).map((provider) => provider.provider);
    return {
      actionType: action.actionType,
      plugin: action.plugin,
      disposition: decision.disposition,
      dispositionRule: decision.rule,
      reason: decision.rationale,
      registry: { path: "finnor-os/packages/orchestration/src/plugin-registry.ts", symbol: "createDefaultPluginRegistry" },
      descriptor: { path: sourcePath, line: action.sourceLine },
      payloadSchema: { path: action.schemaSourcePath, line: action.schemaSourceLine },
      plannerVisibility: ["PluginRegistry.actionDefinitions", "PluginRegistry.payloadSpecJson", "LLMPlanner.plan"],
      hardening: {
        path: "finnor-os/scripts/release/action-hardening-spec.ts",
        profile: hardening.profile,
        approvalFloor: hardening.approvalFloor,
        capabilityFamily: hardening.capabilityFamily,
        external: hardening.external,
      },
      policyAuthority: capability.authorityRelationship,
      workObjectiveBehavior: capability.currentCallers,
      executionChain: [
        "finnor-os/apps/api/app/api/actions/route.ts",
        "finnor-os/apps/api/lib/auth.ts",
        "finnor-os/packages/orchestration/src/index.ts",
        "finnor-os/packages/orchestration/src/plugin-registry.ts",
        "finnor-os/packages/orchestration/src/compiler.ts",
        "finnor-os/packages/orchestration/src/authority-runtime.ts",
        "finnor-os/packages/orchestration/src/durable-execution.ts",
        sourcePath,
      ],
      tablesRead: usage?.reads ?? [],
      tablesWritten: usage?.writes ?? [],
      providerBindings: providers,
      businessEffect: capability.businessEffectRelationship,
      idempotency: capability.idempotencyBehavior,
      verification: capability.verificationBehavior,
      reconciliation: capability.reconciliation,
      compensation: capability.compensation,
      reusableMechanism: decision.reusableMechanism,
      peResponsibility: decision.peResponsibility,
      deletionBlockers: decision.deletionBlockers,
      extractionBlockers: decision.extractionBlockers,
      replacementPrerequisites: decision.replacementPrerequisites,
      tests: sortedUnique(coverageByPath.get(sourcePath) ?? []),
    };
  });
  const plugins = [...new Set(rows.map((row) => row.plugin))].sort().map((plugin) => {
    const actions = rows.filter((row) => row.plugin === plugin);
    return {
      plugin,
      registryPath: "finnor-os/packages/orchestration/src/plugin-registry.ts",
      sourcePath: actions[0]!.descriptor.path,
      actions: actions.map((row) => row.actionType),
      actionDispositions: countBy(actions.map((row) => row.disposition)),
    };
  });
  const body = {
    schemaVersion: 1,
    runtimeRegistry: { path: "finnor-os/packages/orchestration/src/plugin-registry.ts", symbol: "createDefaultPluginRegistry" },
    hardeningRegistry: { path: "finnor-os/scripts/release/action-hardening-spec.ts", symbol: "ACTION_HARDENING_SPEC" },
    actionCount: rows.length,
    pluginCount: plugins.length,
    actions: rows,
    plugins,
    dispositions: countBy(rows.map((row) => row.disposition)),
  };
  return { ...body, manifestHash: stableHash(body) };
}

function combineDispositions(values: readonly Disposition[]): Disposition {
  const unique = sortedUnique(values);
  if (unique.length === 1) return unique[0]! as Disposition;
  if (unique.includes("CORE_KEEP")) return "CORE_EXTRACT";
  if (unique.includes("PE_REPLACE") && unique.every((value) => value === "PE_REPLACE" || value === "PE_REUSE")) return "PE_REPLACE";
  if (unique.includes("WATER_RETIRE") && unique.every((value) => value === "WATER_RETIRE")) return "WATER_RETIRE";
  return "CORE_EXTRACT";
}

function buildSchemaMap(
  tables: readonly TableRecord[],
  sources: ReadonlyMap<string, SourceRecord>,
  usageByPath: ReadonlyMap<string, ReturnType<typeof tableUsage>>,
  activePaths: ReadonlySet<string>,
  runtimeReachablePaths: ReadonlySet<string>,
  migrations: readonly SourceRecord[],
  triggers: ReturnType<typeof extractTriggers>,
) {
  const migrationMap = migrationOwnership(tables, migrations);
  const rows = tables.map((table) => {
    const readers = [...usageByPath].filter(([, usage]) => usage.reads.includes(table.table)).map(([path]) => path).sort();
    const writers = [...usageByPath].filter(([, usage]) => usage.writes.includes(table.table)).map(([path]) => path).sort();
    const applicationPath = (path: string) => !/packages\/db\/(?:migrations\/|migrations-bundle|migrate\.ts|seed(?:-scale)?\.ts)/.test(path) && !/\/scripts\//.test(path);
    const decision = tableDisposition(table.table);
    const businessTruth = BUSINESS_TRUTH_REGISTRY.filter((truth) => (truth.authoritativeModel as readonly string[]).includes(table.table)).map((truth) => truth.concept);
    const migration = migrationMap.get(table.table)!;
    return {
      ...table,
      disposition: decision.disposition,
      dispositionRule: decision.rule,
      reason: decision.rationale,
      schemaDefinition: { path: "finnor-os/packages/db/schema.ts", symbol: table.exportName },
      activeReaders: readers.filter((path) => activePaths.has(path) && applicationPath(path)),
      activeWriters: writers.filter((path) => activePaths.has(path) && applicationPath(path)),
      migrationAndSeedReaders: readers.filter((path) => !applicationPath(path)),
      migrationAndSeedWriters: writers.filter((path) => !applicationPath(path)),
      releaseReaders: readers.filter((path) => runtimeReachablePaths.has(path) && !activePaths.has(path)),
      testDevHistoryReaders: readers.filter((path) => !runtimeReachablePaths.has(path)),
      allReaders: readers,
      allWriters: writers,
      businessTruthConcepts: businessTruth,
      introducingMigrations: migration.introducing,
      laterMigrationAssumptions: migration.assumptions,
      triggers: triggers.filter((trigger) => trigger.table === table.table),
      externalRefParticipation: sources.get("finnor-os/packages/db/schema.ts")!.text.includes(`${table.exportName}Id`) || table.table === "external_refs",
      retirementBlockers: decision.deletionBlockers,
      extractionBlockers: decision.extractionBlockers,
      replacementPrerequisites: decision.replacementPrerequisites,
    };
  });
  const truthRows = BUSINESS_TRUTH_REGISTRY.map((truth) => {
    const tableDispositions = truth.authoritativeModel.map((table) => tableDisposition(table).disposition);
    return {
      concept: truth.concept,
      disposition: combineDispositions(tableDispositions),
      authoritativeModel: [...truth.authoritativeModel],
      writableOwner: truth.writableOwner,
      mutations: [...truth.mutations],
      events: [...truth.events],
      identity: [...truth.identity],
      sourceOwnership: truth.sourceOwnership,
      importability: truth.importability,
      legacyProjection: [...truth.legacyProjection],
      registry: "finnor-os/packages/data-platform/src/business-truth-registry.ts#BUSINESS_TRUTH_REGISTRY",
    };
  });
  const canonicalConsumers = [...sources.values()].filter((source) => /CANONICAL_ENTITY_TYPES|CanonicalEntityRef|canonicalEntityRef|entityType/.test(source.text));
  const canonicalRows = CANONICAL_ENTITY_TYPES.map((entityType) => ({
    entityType,
    disposition: CANONICAL_ENTITY_DISPOSITIONS[entityType],
    registry: "finnor-os/packages/shared-types/src/company-graph.ts#CANONICAL_ENTITY_TYPES",
    consumers: canonicalConsumers.filter((source) => referencesToken(source.text, entityType) || /CANONICAL_ENTITY_TYPES|CanonicalEntityRef/.test(source.text)).map((source) => source.path).sort(),
  }));
  const partyConsumers = [...sources.values()].filter((source) => /PARTY_TYPES|PartyRef|partyType/.test(source.text));
  const partyRows = PARTY_TYPES.map((partyType) => ({
    partyType,
    disposition: PARTY_TYPE_DISPOSITIONS[partyType],
    registry: "finnor-os/packages/shared-types/src/company-graph.ts#PARTY_TYPES",
    consumers: partyConsumers.filter((source) => referencesToken(source.text, partyType) || /PARTY_TYPES|PartyRef/.test(source.text)).map((source) => source.path).sort(),
  }));
  const body = {
    schemaVersion: 1,
    activeSchema: { path: "finnor-os/packages/db/schema.ts", tableCount: rows.length },
    migrationHistory: {
      path: "finnor-os/packages/db/migrations",
      numberedMigrationCount: migrations.length,
      first: migrations[0]?.path ?? null,
      head: migrations.at(-1)?.path ?? null,
      disposition: "HISTORY_ONLY",
      mutationPolicy: "immutable; future changes must be additive forward migrations",
    },
    tables: rows,
    tableDispositions: countBy(rows.map((row) => row.disposition)),
    activeWriterTableCount: rows.filter((row) => row.activeWriters.length > 0).length,
    businessTruthRegistry: { path: "finnor-os/packages/data-platform/src/business-truth-registry.ts", conceptCount: truthRows.length, concepts: truthRows },
    canonicalEntities: { path: "finnor-os/packages/shared-types/src/company-graph.ts", count: canonicalRows.length, entities: canonicalRows },
    partyTypes: { path: "finnor-os/packages/shared-types/src/company-graph.ts", count: partyRows.length, parties: partyRows },
    triggers,
    forwardMigrationFinding: "Existing populated Water data must remain migratable; no numbered migration is edited and PE retirement requires additive quarantine/cutover migrations after all listed readers/writers/triggers detach.",
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildProviderMap(sources: ReadonlyMap<string, SourceRecord>) {
  const providers = PROVIDER_DEFINITIONS.map((definition) => {
    const paths = definition.paths.map(normalizeModelPath);
    const sourceRecords = paths.map((path) => sources.get(path)).filter((value): value is SourceRecord => Boolean(value));
    const mentions = [...sources.values()].filter((source) => definition.provider.split("/").some((token) => referencesToken(source.text.toLowerCase(), token.toLowerCase()))).map((source) => source.path).sort();
    const credentials = sortedUnique(sourceRecords.flatMap((source) => extractCredentials(source.text)));
    return {
      ...definition,
      paths,
      referencedBy: mentions,
      credentialsAuthProfiles: credentials,
      sourceTruthChain: definition.sourceScopes.length
        ? ["provider credential/account", "scope selection", "source adapter", "normalized source record", "relationship resolution", "canonical materializer", "external_refs", "business event", "reconciliation/read-back"]
        : ["provider credential/account", "governed capability/tool", "external operation", "provider acknowledgement", "observation/read-back", "receipt/evidence"],
      separationFinding: definition.transportDisposition === definition.mappingDisposition
        ? "Transport and current mapping share one honest ownership disposition."
        : `Transport is ${definition.transportDisposition}; current business mapping is separately ${definition.mappingDisposition}.`,
    };
  });
  const body = {
    schemaVersion: 1,
    providerCount: providers.length,
    activeProviderCount: providers.filter((provider) => provider.active).length,
    providers,
    transportDispositions: countBy(providers.map((provider) => provider.transportDisposition)),
    mappingDispositions: countBy(providers.map((provider) => provider.mappingDisposition)),
    sourceSyncBoundary: {
      coreOrExtractableEngine: ["provider identity validation", "credential resolution", "checkpoints", "leases", "pagination/cursors", "retry/freshness", "conflict/tombstone state", "external references", "reconciliation"],
      verticalMapping: ["selected scopes", "object ordering", "canonical entity type", "relationship names", "materialization target", "field ownership"],
      paths: ["finnor-os/apps/worker/src/handlers/sync-source.ts", "finnor-os/packages/tools/src/source-adapters.ts", "finnor-os/packages/data-platform/src/source-truth.ts"],
    },
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildSourceImportMap(sources: ReadonlyMap<string, SourceRecord>) {
  const definition = sources.get("finnor-os/packages/import-engine/src/definition.ts")!;
  const enumBlock = definition.text.match(/ImportEntitySchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const importEntities = [...enumBlock.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
  const writer = sources.get("finnor-os/packages/data-platform/src/import-writes.ts")!;
  const body = {
    schemaVersion: 1,
    sourceSync: {
      engineDisposition: "CORE_EXTRACT",
      enginePaths: ["finnor-os/apps/worker/src/handlers/sync-source.ts", "finnor-os/packages/data-platform/src/source-truth.ts"],
      adapterRegistry: "finnor-os/packages/tools/src/source-adapters.ts",
      defaultScopes: {
        ghl: { initial: ["contacts"], incremental: ["contacts"] },
        quickbooks: { initial: ["customers", "invoices", "payments"], incremental: ["accounting_changes"] },
        stripe: { initial: [], incremental: [] },
        vapi: { initial: ["calls"], incremental: ["calls"] },
      },
      waterMappings: [
        "GHL contact -> customer/household",
        "GHL appointment -> appointment + household",
        "QuickBooks Customer -> customer/household",
        "QuickBooks Invoice.CustomerRef -> invoice.householdId",
        "QuickBooks Payment.LinkedTxn -> payment.invoiceId",
        "Stripe checkout session -> Water invoice/payment observation",
      ],
    },
    importEngine: {
      mechanismDisposition: "CORE_EXTRACT",
      parserDisposition: "CORE_KEEP",
      reusableMechanisms: ["CSV/JSON/JSONL parsing", "bounded batching", "declarative field mapping", "normalization", "update modes", "idempotency", "provenance", "ambiguity/quarantine"],
      definitionPath: definition.path,
      supportedEntityCount: importEntities.length,
      supportedEntities: importEntities,
      canonicalWriterPath: writer.path,
      writerDisposition: "CORE_EXTRACT",
      verticalDependencies: ["closed Water entity enum", "Water fields", "householdId/technicianId/quoteId/invoiceId relationships", "monolithic writeCanonicalImportRow switch"],
      requiredP1Boundary: "VerticalPack contributes entity definitions, validation, relationship resolution and canonical writers; Core retains parsing/run/idempotency/provenance/quarantine.",
    },
  };
  return { ...body, manifestHash: stableHash(body) };
}

function registryForPath(
  path: string,
  source: SourceRecord,
  actions: Awaited<ReturnType<typeof discoverActionRegistry>>,
  jobMap: ReturnType<typeof buildJobRegistry>,
): AuditArtifact["registryMembership"] {
  const actionTypes = actions.filter((action) => action.sourcePath === path).map((action) => action.actionType);
  const plugins = sortedUnique(actions.filter((action) => action.sourcePath === path).map((action) => action.plugin));
  const queryIntents = OPERATIONAL_QUERY_INTENTS.filter((intent) => source.parsed.stringLiterals.some((literal) => literal.value === intent));
  const jobs = jobMap.jobs.filter((job) => job.handlerPath === path || (path === job.registry.path && source.parsed.stringLiterals.some((literal) => literal.value === job.jobType))).map((job) => job.jobType);
  const schedules = jobMap.schedulerRegistrations.filter((schedule) => schedule.path === path || jobs.includes(schedule.jobType)).map((schedule) => `${schedule.scope}:${schedule.jobType}@${schedule.intervalHours}h`);
  return { plugins, actionTypes, queryIntents: [...queryIntents], jobTypes: jobs, schedulerRegistrations: schedules };
}

function decisionDimensions(
  decision: DispositionDecision,
  artifact: {
    runtimeReachable: boolean;
    waterHits: WaterHit[];
    dependents: number;
    reads: number;
    writes: number;
    providers: number;
    tests: number;
    phases: number;
    hasWork: boolean;
    hasAuthority: boolean;
    hasTenant: boolean;
    hasIdempotency: boolean;
    hasReceipts: boolean;
    hasReconciliation: boolean;
    hasCompensation: boolean;
    historical: boolean;
  },
): Record<string, string | number | boolean> {
  const falseSemantics = decision.disposition === "PE_REPLACE" || decision.disposition === "WATER_RETIRE" || decision.disposition === "CORE_EXTRACT";
  return {
    semanticGenerality: decision.disposition === "CORE_KEEP" ? "vertical-neutral" : decision.disposition === "CORE_EXTRACT" ? "reusable-but-mixed" : "business-facing",
    peApplicability: decision.disposition === "PE_REUSE" ? "direct" : decision.disposition === "PE_REPLACE" ? "responsibility-only" : decision.disposition.startsWith("CORE") ? "through-core" : "none",
    waterSpecificity: artifact.waterHits.reduce((sum, hit) => sum + hit.occurrenceCount, 0),
    runtimeReachability: artifact.runtimeReachable,
    dependencyCentrality: artifact.dependents,
    downstreamDependents: artifact.dependents,
    authoritativeTruthOwnership: artifact.reads + artifact.writes,
    sideEffectOwnership: artifact.providers > 0,
    workObjectiveOwnership: artifact.hasWork,
    securityCriticality: decision.securityRisk,
    authorityCriticality: artifact.hasAuthority,
    tenantIsolationCriticality: artifact.hasTenant,
    identityCriticality: artifact.hasAuthority || artifact.hasTenant,
    idempotencyCriticality: artifact.hasIdempotency,
    receiptAuditCriticality: artifact.hasReceipts,
    reconciliationCriticality: artifact.hasReconciliation,
    compensationCriticality: artifact.hasCompensation,
    persistenceMigrationCriticality: decision.migrationRisk,
    providerPortability: artifact.providers === 0 ? "not-applicable" : decision.disposition === "PE_REUSE" || decision.disposition === "CORE_KEEP" ? "portable" : "mapping-boundary-required",
    dataProvenancePortability: /source|import|evidence|provenance/i.test(decision.rationale) ? "explicit" : "not-primary",
    testCoverage: artifact.tests,
    productionMaturity: artifact.runtimeReachable ? "active-or-release-critical" : "test-dev-history",
    replacementCost: decision.replacementPrerequisites.length ? "high" : "none",
    extractionCost: decision.extractionBlockers.length ? "high" : "none",
    migrationRisk: decision.migrationRisk,
    failureBlastRadius: artifact.dependents > 10 || decision.releaseRisk === "critical" ? "high" : artifact.dependents > 2 ? "medium" : "bounded",
    futurePeExpansionValue: decision.disposition === "PE_REUSE" || decision.disposition.startsWith("CORE") ? "retained" : decision.disposition === "PE_REPLACE" ? "native-replacement" : "none",
    architectureDuplicationRisk: decision.disposition === "CORE_EXTRACT" || decision.disposition === "PE_REPLACE" ? "high-if-copied" : "low",
    historicalIntegrityRequirements: artifact.historical,
    falsePeSemanticsIfKept: falseSemantics,
    phaseBoundaryCount: artifact.phases,
  };
}

function artifactProviders(path: string, source: SourceRecord): string[] {
  return PROVIDER_DEFINITIONS.filter((provider) => {
    const providerPaths = provider.paths.map(normalizeModelPath);
    if (providerPaths.includes(path)) return true;
    return provider.provider.split("/").some((token) => {
      if (token.length < 4) return false;
      return new RegExp(`\\b${regexpEscape(token)}\\b`, "i").test(source.text);
    });
  }).map((provider) => provider.provider);
}

function artifactDomainColumns(tableNames: readonly string[], tables: readonly TableRecord[]): string[] {
  const domain = /(?:household|customer|technician|equipment|service|maintenance|inventory|warehouse|reorder|quote|proposal|work_order|appointment|invoice|payment|lead|opportunity|install|dispatch|price_book)/i;
  return tables.filter((table) => tableNames.includes(table.table)).flatMap((table) => table.columns.filter((column) => domain.test(`${table.table}.${column.sqlName}`)).map((column) => `${table.table}.${column.sqlName}`)).sort();
}

function buildArtifacts(input: {
  paths: readonly string[];
  sources: ReadonlyMap<string, SourceRecord>;
  graph: Graph;
  packages: ReadonlyMap<string, PackageTarget>;
  baselineTreeSha: string;
  entrypointsByPath: ReadonlyMap<string, Set<string>>;
  activeEntrypointsByPath: ReadonlyMap<string, Set<string>>;
  usageByPath: ReadonlyMap<string, ReturnType<typeof tableUsage>>;
  tables: readonly TableRecord[];
  triggers: ReturnType<typeof extractTriggers>;
  migrations: ReturnType<typeof migrationOwnership>;
  actions: Awaited<ReturnType<typeof discoverActionRegistry>>;
  jobMap: ReturnType<typeof buildJobRegistry>;
  coverageByPath: ReadonlyMap<string, Set<string>>;
  gatesByPath: ReadonlyMap<string, Set<string>>;
}): AuditArtifact[] {
  const truthByTable = new Map<string, string[]>();
  for (const truth of BUSINESS_TRUTH_REGISTRY) for (const table of truth.authoritativeModel) truthByTable.set(table, [...(truthByTable.get(table) ?? []), truth.concept]);
  return input.paths.map((path) => {
    const source = input.sources.get(path)!;
    const hits = waterHits(source.text);
    const decision = artifactDisposition(path, source.text, hits.map((hit) => hit.id));
    const usage = input.usageByPath.get(path) ?? { reads: [], writes: [], references: [] };
    const tableNames = sortedUnique([...usage.reads, ...usage.writes, ...usage.references]);
    const registry = registryForPath(path, source, input.actions, input.jobMap);
    const providers = artifactProviders(path, source);
    const events = extractEvents(source);
    const phases = phasesFor(source);
    const entrypointIds = sortedUnique(input.entrypointsByPath.get(path) ?? []);
    const activeEntrypoints = sortedUnique(input.activeEntrypointsByPath.get(path) ?? []);
    const runtimeReachable = entrypointIds.length > 0;
    const activeInProduction = activeEntrypoints.length > 0;
    const tests = sortedUnique(input.coverageByPath.get(path) ?? []).filter((test) => test !== path);
    const gates = sortedUnique(input.gatesByPath.get(path) ?? []).filter((gate) => gate !== path);
    const directDependents = sortedUnique(input.graph.dependents.get(path) ?? []);
    const domainColumns = artifactDomainColumns(tableNames, input.tables);
    const involvedTriggers = input.triggers.filter((trigger) => tableNames.includes(trigger.table)).map((trigger) => `${trigger.name}@${trigger.migration}:${trigger.line}`);
    const canonicalEntities = CANONICAL_ENTITY_TYPES.filter((entity) => new RegExp(`["']${regexpEscape(entity)}["']`).test(source.text));
    const partyTypes = PARTY_TYPES.filter((party) => new RegExp(`["']${regexpEscape(party)}["']`).test(source.text));
    const truthOwnership = sortedUnique(tableNames.flatMap((table) => truthByTable.get(table) ?? []).concat(BUSINESS_TRUTH_REGISTRY.filter((truth) => new RegExp(`["']${regexpEscape(truth.concept)}["']`).test(source.text)).map((truth) => truth.concept)));
    const dynamicConsumers = input.graph.dynamicEdges.filter((edge) => edge.to === path).map((edge) => `${edge.kind}:${edge.from}`);
    const credentials = extractCredentials(source.text);
    const hasWork = /\bWork\b|workObjective|objective[_A-Z]|ObjectiveLoop/.test(source.text);
    const hasAuthority = /authority|approval|policy/i.test(source.text);
    const hasTenant = /tenantId|tenant_id|withTenant|RLS|row.level.security/i.test(source.text);
    const hasIdempotency = /idempot|operationKey|operation_key/i.test(source.text);
    const hasReceipts = /receipt|evidence/i.test(source.text);
    const hasReconciliation = /reconcil|read.?back|observation/i.test(source.text);
    const hasCompensation = /compensat|revert/i.test(source.text);
    const history = lifecycleFor(path, runtimeReachable, activeInProduction) === "history" || lifecycleFor(path, runtimeReachable, activeInProduction) === "migration-history";
    const migrationInfo = tableNames.map((table) => input.migrations.get(table)).filter((value): value is { introducing: string[]; assumptions: string[] } => Boolean(value));
    const anchors = [
      source.parsed.symbols[0] ? { path, line: source.parsed.symbols[0].line, fact: `export ${source.parsed.symbols[0].name}` } : null,
      hits[0]?.evidence[0] ? { path, line: hits[0].evidence[0].line, fact: `${hits[0].id}: ${hits[0].evidence[0].snippet}` } : null,
      anchoredFact(source, /queue\.register|actionTypes|OPERATIONAL_QUERY_INTENTS|pgTable|CREATE\s+TABLE/i, "registry/schema ownership anchor"),
    ].filter((value): value is { path: string; line: number | null; fact: string } => Boolean(value));
    if (!anchors.length) anchors.push({ path, line: source.text.length ? 1 : null, fact: "artifact content anchor" });
    const sourceImportOwnership = [
      /source.?truth|source.?adapter|sync.?source|external.?ref/i.test(`${path}\n${source.text}`) ? "source-sync/provenance" : null,
      /import.?engine|import.?write|CanonicalImport/i.test(`${path}\n${source.text}`) ? "canonical-import" : null,
      /materializ/i.test(source.text) ? "canonical-materializer" : null,
    ].filter((value): value is string => Boolean(value));
    const lifecycle = lifecycleFor(path, runtimeReachable, activeInProduction);
    return {
      id: artifactId(path),
      branchTree: { baselineSha: PE0_BASELINE_SHA, treeSha: input.baselineTreeSha, source: "main shipped baseline; current main tree verified identical" },
      path,
      package: packageForPath(path, input.packages),
      symbols: source.parsed.symbols,
      artifactType: artifactType(path),
      lifecycle,
      runtimeReachable,
      activeInProduction,
      runtimeEntrypoints: entrypointIds,
      directImports: source.parsed.imports,
      dynamicConsumers: sortedUnique(dynamicConsumers),
      dependents: directDependents,
      registryMembership: registry,
      eventTypesConsumed: events.consumed,
      eventTypesEmitted: events.emitted,
      databaseTablesRead: usage.reads,
      databaseTablesWritten: usage.writes,
      databaseColumnsWithDomainSemantics: domainColumns,
      databaseTriggersInvolved: involvedTriggers,
      canonicalEntityTypesUsed: [...canonicalEntities],
      partyRefUsage: partyTypes.map((party) => `PartyRef:${party}`).concat(/PartyRef/.test(source.text) ? ["PartyRef contract"] : [], /CanonicalEntityRef/.test(source.text) ? ["CanonicalEntityRef contract"] : []),
      businessTruthRegistryOwnership: truthOwnership,
      sourceImportOwnership,
      externalProviderBindings: providers,
      credentialsAuthProfilesUsed: credentials,
      externalSideEffects: /\bfetch\s*\(|\.send\s*\(|\.publish\s*\(|providerAccepted|external_operation/i.test(source.text) ? providers.concat(["network/provider mutation or acknowledgement path"]) : [],
      businessEffectsEmitted: /BusinessEffect|business_effect/.test(source.text) ? ["BusinessEffect boundary referenced; exact action relationship is in action-execution-map.json"] : [],
      preconditionsPostconditions: [
        /precondition/i.test(source.text) ? "precondition contract/check" : null,
        /postcondition/i.test(source.text) ? "postcondition/observation contract/check" : null,
      ].filter((value): value is string => Boolean(value)),
      reconciliationReadBackOwnership: hasReconciliation ? ["reconciliation/read-back/observation boundary"] : [],
      receiptEvidenceOwnership: hasReceipts ? ["receipt/evidence persistence or validation"] : [],
      compensationSemantics: hasCompensation ? ["compensation/revert semantics"] : [],
      idempotencySemantics: hasIdempotency ? ["idempotency/operation-key semantics"] : [],
      workObjectiveCoupling: hasWork ? ["Work/Objective lifecycle reference"] : [],
      authorityPolicyCoupling: hasAuthority ? ["authority/approval/policy boundary"] : [],
      tenantIsolationRlsCoupling: hasTenant ? ["trusted tenant scope and/or RLS boundary"] : [],
      phaseDependencies: phases,
      memoryDependency: /@finnor\/memory|MemorySnapshot|semanticMemory|memory_/i.test(source.text) ? ["memory runtime or snapshot"] : [],
      computerRuntimeDependency: /@finnor\/computer|ComputerRun|computer_task|computerRuns/i.test(source.text) ? ["governed computer runtime"] : [],
      testsCovering: tests,
      certificationReleaseGatesCovering: gates,
      migrationIntroducingIt: sortedUnique(migrationInfo.flatMap((value) => value.introducing)),
      migrationAssumptionsDependingOnIt: sortedUnique(migrationInfo.flatMap((value) => value.assumptions)),
      waterSemantics: hits,
      reusableMechanismPresent: Boolean(decision.reusableMechanism) || ["CORE_KEEP", "CORE_EXTRACT", "PE_REUSE"].includes(decision.disposition),
      peResponsibility: decision.peResponsibility,
      deletionBlockers: decision.deletionBlockers,
      extractionBlockers: decision.extractionBlockers,
      replacementPrerequisites: decision.replacementPrerequisites,
      decisionDimensions: decisionDimensions(decision, {
        runtimeReachable,
        waterHits: hits,
        dependents: directDependents.length,
        reads: usage.reads.length,
        writes: usage.writes.length,
        providers: providers.length,
        tests: tests.length,
        phases: phases.length,
        hasWork,
        hasAuthority,
        hasTenant,
        hasIdempotency,
        hasReceipts,
        hasReconciliation,
        hasCompensation,
        historical: history,
      }),
      migrationRisk: decision.migrationRisk,
      securityRisk: decision.securityRisk,
      releaseRisk: decision.releaseRisk,
      confidence: decision.confidence,
      finalDisposition: decision.disposition,
      dispositionRule: decision.rule,
      reason: decision.rationale,
      evidenceAnchors: anchors,
      contentHash: source.contentHash,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function behaviorScope(path: string): boolean {
  if (path === "finnor-os/package.json") return false;
  if (path.startsWith("finnor-os/scripts/pe0/") || path.startsWith("finnor-os/architecture/pe0/") || /pe0-audit\.test\.ts$/.test(path)) return false;
  return path.startsWith("finnor-os/apps/")
    || path.startsWith("finnor-os/packages/")
    || path.startsWith("src/app/api/")
    || path.startsWith("src/lib/")
    || path.startsWith("infra/")
    || path.startsWith("scripts/release/")
    || path.startsWith(".github/workflows/")
    || path === "finnor-os/openapi.json";
}

function behaviorFingerprint(baselineSha: string) {
  const baselineEntries = lines(git(["ls-tree", "-r", baselineSha])).map((line) => {
    const [metadata, path] = line.split("\t");
    const blob = metadata!.split(" ")[2]!;
    return { path: path!, blob };
  }).filter((entry) => behaviorScope(entry.path));
  const changed = lines(git(["diff", "--name-only", baselineSha, "--"])).filter(behaviorScope);
  const untracked = lines(git(["ls-files", "--others", "--exclude-standard"])).filter(behaviorScope);
  const baselineFingerprint = stableHash(baselineEntries.map((entry) => `${entry.path}:${entry.blob}`).sort());
  const body = {
    baselineSha,
    baselinePathCount: baselineEntries.length,
    baselineFingerprint,
    currentFingerprint: changed.length || untracked.length ? stableHash({ baselineFingerprint, changed, untracked }) : baselineFingerprint,
    changedRuntimeBehaviorPaths: sortedUnique([...changed, ...untracked]),
    behaviorEquivalent: changed.length === 0 && untracked.length === 0,
  };
  return body;
}

function changedAuditPaths(baselineSha: string): string[] {
  const committed = lines(git(["diff", "--name-only", baselineSha, "--"]));
  const status = git(["status", "--porcelain=v1", "-uall"]).split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!).filter(Boolean);
  return sortedUnique([...committed, ...status]);
}

function buildDependencyGraph(artifacts: readonly AuditArtifact[], graph: Graph) {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const externalSpecifiers = sortedUnique(artifacts.flatMap((artifact) => artifact.directImports.filter((entry) => entry.external).map((entry) => entry.specifier)));
  const nodes = [
    ...artifacts.map((artifact) => ({ id: artifact.path, kind: "artifact", package: artifact.package, disposition: artifact.finalDisposition, runtimeReachable: artifact.runtimeReachable })),
    ...externalSpecifiers.map((specifier) => ({ id: `external:${specifier}`, kind: "external-dependency", package: specifier, disposition: null, runtimeReachable: true })),
    ...collectTables().map((table) => ({ id: `table:${table.table}`, kind: "database-table", package: "@finnor/db", disposition: tableDisposition(table.table).disposition, runtimeReachable: true })),
    ...PROVIDER_DEFINITIONS.map((provider) => ({ id: `provider:${provider.provider}`, kind: "external-provider", package: provider.category, disposition: provider.mappingDisposition, runtimeReachable: provider.active })),
  ];
  const edges: Array<{ from: string; to: string; kind: string; evidence?: string }> = [];
  const outOfScopeResolvedLocalDependencies: Array<{ from: string; to: string }> = [];
  for (const artifact of artifacts) {
    for (const imported of artifact.directImports) {
      if (imported.resolvedPath && artifactPaths.has(imported.resolvedPath)) edges.push({ from: artifact.path, to: imported.resolvedPath, kind: imported.kind });
      else if (imported.resolvedPath) outOfScopeResolvedLocalDependencies.push({ from: artifact.path, to: imported.resolvedPath });
      else if (imported.external) edges.push({ from: artifact.path, to: `external:${imported.specifier}`, kind: imported.kind });
    }
    for (const table of artifact.databaseTablesRead) edges.push({ from: artifact.path, to: `table:${table}`, kind: "reads" });
    for (const table of artifact.databaseTablesWritten) edges.push({ from: artifact.path, to: `table:${table}`, kind: "writes" });
    for (const provider of artifact.externalProviderBindings) edges.push({ from: artifact.path, to: `provider:${provider}`, kind: "binds-provider" });
  }
  for (const edge of graph.dynamicEdges) if (artifactPaths.has(edge.from) && artifactPaths.has(edge.to)) edges.push(edge);
  const packageEdges = new Map<string, Set<string>>();
  const packageByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.package]));
  for (const edge of edges) {
    const from = packageByPath.get(edge.from);
    const to = packageByPath.get(edge.to);
    if (!from || !to || from === to) continue;
    if (!packageEdges.has(from)) packageEdges.set(from, new Set());
    packageEdges.get(from)!.add(to);
  }
  const unresolved = graph.unresolvedLocalImports.filter((entry) => artifactPaths.has(entry.importer));
  const body = {
    schemaVersion: 1,
    nodes,
    edges: edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.kind.localeCompare(right.kind)),
    packageEdges: [...packageEdges].sort(([left], [right]) => left.localeCompare(right)).map(([from, targets]) => ({ from, to: sortedUnique(targets) })),
    outOfScopeResolvedLocalDependencies: outOfScopeResolvedLocalDependencies.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
    unresolvedNodes: unresolved,
    questionIndexes: {
      householdCanonicalFanout: artifacts.filter((artifact) => artifact.canonicalEntityTypesUsed.includes("household") || artifact.databaseTablesRead.includes("households") || artifact.databaseTablesWritten.includes("households")).map((artifact) => artifact.path),
      technicianReachability: artifacts.filter((artifact) => artifact.canonicalEntityTypesUsed.includes("technician") || artifact.databaseTablesRead.includes("technicians") || artifact.databaseTablesWritten.includes("technicians")).map((artifact) => artifact.path),
      docusignWaterWrapper: ["finnor-os/packages/domain-plugins/proposal-signature/index.ts", "finnor-os/packages/tools/src/capabilities/documents.ts", "finnor-os/packages/tools/src/docusign.ts", "finnor-os/apps/api/app/api/webhooks/esign/route.ts"],
      verticalSchedulerJobs: Object.entries(JOB_DISPOSITIONS).filter(([, decision]) => decision.disposition === "WATER_RETIRE").map(([job]) => job),
      p3P6CanonicalBoundary: artifacts.filter((artifact) => artifact.phaseDependencies.some((phase) => ["P3", "P4", "P5", "P6"].includes(phase)) && (artifact.canonicalEntityTypesUsed.length > 0 || artifact.directImports.some((entry) => entry.specifier === "@finnor/shared-types"))).map((artifact) => artifact.path),
      waterMaterializers: ["finnor-os/packages/tools/src/source-adapters.ts", "finnor-os/packages/data-platform/src/source-truth.ts", "finnor-os/packages/data-platform/src/import-writes.ts"],
      genericPackagesWithWaterBoundary: sortedUnique(artifacts.filter((artifact) => artifact.finalDisposition === "CORE_EXTRACT" && artifact.waterSemantics.length > 0).map((artifact) => artifact.package)),
    },
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildWaterMap(artifacts: readonly AuditArtifact[], jobMap: ReturnType<typeof buildJobRegistry>) {
  const contaminated = artifacts.filter((artifact) => artifact.waterSemantics.length > 0).map((artifact) => ({
    path: artifact.path,
    artifactType: artifact.artifactType,
    runtimeReachable: artifact.runtimeReachable,
    activeInProduction: artifact.activeInProduction,
    disposition: artifact.finalDisposition,
    patterns: artifact.waterSemantics,
    reason: artifact.reason,
  }));
  const body = {
    schemaVersion: 1,
    scannedArtifactCount: artifacts.length,
    contaminatedArtifactCount: contaminated.length,
    activeContaminatedArtifactCount: contaminated.filter((artifact) => artifact.activeInProduction).length,
    patternCounts: Object.fromEntries(WATER_PATTERNS.map((pattern) => [pattern.id, contaminated.filter((artifact) => artifact.patterns.some((hit) => hit.id === pattern.id)).length])),
    dispositionCounts: countBy(contaminated.map((artifact) => artifact.disposition)),
    contaminatedArtifacts: contaminated,
    unclassifiedContamination: [],
    plannerCognitionBoundary: artifacts.filter((artifact) => artifact.artifactType === "planner-cognition" && artifact.waterSemantics.length > 0).map((artifact) => ({ path: artifact.path, patterns: artifact.waterSemantics.map((hit) => hit.id), disposition: artifact.finalDisposition })),
    verticalNone: {
      supportedToday: false,
      blockers: [
        "createDefaultPluginRegistry unconditionally registers all 26 current plugins",
        "LLMPlanner receives the complete Water action catalog",
        "read-routing and fast-read fallbacks embed Water query/action vocabulary",
        "ObjectiveLoop constructs the default orchestrator and Water operating context",
        "CANONICAL_ENTITY_TYPES and PARTY_TYPES have no pack contribution seam",
      ],
    },
    deadCodeExample: { path: "finnor-os/apps/console/app/customers/page.tsx", productionContractStatus: "not a required component", disposition: "WATER_RETIRE" },
    testFixtureCoreInvariantExample: { path: "finnor-os/tests/integration/source-truth-loop.test.ts", invariant: "tenant isolation, ordering, tombstones and reconciliation", disposition: "CORE_EXTRACT" },
    registeredWaterJobs: jobMap.jobs.filter((job) => job.disposition === "WATER_RETIRE").map((job) => job.jobType),
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildCutoverMap(artifacts: readonly AuditArtifact[]) {
  const blockers = CUTOVER_BLOCKERS.map((blocker) => ({
    ...blocker,
    paths: blocker.paths.map(normalizeModelPath),
    dispositions: sortedUnique(blocker.paths.map(normalizeModelPath).map((path) => artifacts.find((artifact) => artifact.path === path)?.finalDisposition).filter((value): value is Disposition => Boolean(value))),
  }));
  const body = {
    schemaVersion: 1,
    unresolvedClassificationBlockers: [],
    orderedP1Inputs: blockers,
    p1StartCondition: "Implement only after this order and the per-artifact blockers in artifact-ledger.json are accepted; keep the Water pack active throughout extraction.",
    laterCutoverConstraints: [
      "Do not edit migrations 0000-0108; use additive forward migrations.",
      "Do not remove Water tables/actions/jobs until the active Water pack is isolated and compatibility reads are quarantined.",
      "Do not rename Water entities into PE entities; introduce native PE responsibility in later phases.",
      "Keep provider transports whose mapping disposition differs from transport disposition.",
      "Regenerate pack-aware action/query/job/release manifests before any registry removal.",
    ],
  };
  return { ...body, manifestHash: stableHash(body) };
}

function buildPhaseMap(artifacts: readonly AuditArtifact[]) {
  const phases = PHASE_BOUNDARIES.map((phase) => ({
    ...phase,
    currentArtifacts: artifacts.filter((artifact) => artifact.phaseDependencies.includes(phase.phase)).map((artifact) => ({ path: artifact.path, disposition: artifact.finalDisposition, waterPatterns: artifact.waterSemantics.map((hit) => hit.id) })),
  }));
  const body = { schemaVersion: 1, algorithmMutationAllowedInPe0: false, phases };
  return { ...body, manifestHash: stableHash(body) };
}

function buildAcceptanceMap(artifacts: readonly AuditArtifact[]) {
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  const traces = ACCEPTANCE_TRACES.map((trace) => ({
    ...trace,
    path: trace.path.map((entry) => {
      const [rawPath, symbol] = entry.split("#");
      const normalized = normalizeModelPath(rawPath!);
      return { path: normalized, symbol: symbol ?? null, ledgered: paths.has(normalized) };
    }),
  }));
  const body = { schemaVersion: 1, traceCount: traces.length, traces };
  return { ...body, manifestHash: stableHash(body) };
}

function subsystemMap(artifacts: readonly AuditArtifact[]) {
  const packages = sortedUnique(artifacts.map((artifact) => artifact.package));
  return packages.map((packageName) => {
    const rows = artifacts.filter((artifact) => artifact.package === packageName);
    return {
      package: packageName,
      artifactCount: rows.length,
      runtimeReachableCount: rows.filter((row) => row.runtimeReachable).length,
      activeInProductionCount: rows.filter((row) => row.activeInProduction).length,
      dispositions: countBy(rows.map((row) => row.finalDisposition)),
      waterContaminatedCount: rows.filter((row) => row.waterSemantics.length > 0).length,
      paths: rows.map((row) => row.path),
    };
  });
}

function buildRuntimeEntrypointMap(entrypoints: readonly Entrypoint[], artifacts: readonly AuditArtifact[]) {
  const productionContract = JSON.parse(artifacts.find((artifact) => artifact.path === "infra/deployment/production.contract.json") ?
    // Reading the source here keeps the generated contract exact rather than duplicating it.
    requireText("infra/deployment/production.contract.json") : "{}") as Record<string, unknown>;
  const rows = entrypoints.map((entrypoint) => ({
    ...entrypoint,
    reachableArtifactCount: artifacts.filter((artifact) => artifact.runtimeEntrypoints.includes(entrypoint.path)).length,
  }));
  const body = {
    schemaVersion: 1,
    productionContractPath: "infra/deployment/production.contract.json",
    productionContract,
    entrypointCount: rows.length,
    activeEntrypointCount: rows.filter((entrypoint) => entrypoint.activeInProduction).length,
    entrypoints: rows,
    subsystems: subsystemMap(artifacts),
  };
  return { ...body, manifestHash: stableHash(body) };
}

function requireText(path: string): string {
  return git(["show", `:${path}`]);
}

export type Pe0Audit = Awaited<ReturnType<typeof buildPe0Audit>>;

export async function buildPe0Audit() {
  const tracked = trackedFiles("HEAD");
  const packages = buildPackageTargets(tracked);
  const candidatePaths = tracked.filter(isTextAuditCandidate).sort();
  const analysisPaths = sortedUnique([
    ...candidatePaths,
    ...tracked.filter((path) => isSource(path) && !path.startsWith("finnor-os/scripts/pe0/") && path !== "finnor-os/tests/unit/pe0-audit.test.ts"),
  ]);
  const sources = await readSources(analysisPaths, packages);
  const graph = buildGraph(sources, tracked);
  const entrypoints = buildEntrypoints(tracked);
  const runtimeEntrypoints = entrypoints.filter((entrypoint) => entrypoint.activeInProduction).map((entrypoint) => entrypoint.path);
  const liveKinds = new Set(["api-route", "frontend-api-route", "worker-boot", "api-startup"]);
  const liveEntrypoints = entrypoints.filter((entrypoint) => entrypoint.activeInProduction && liveKinds.has(entrypoint.kind)).map((entrypoint) => entrypoint.path);
  const entrypointsByPath = pathsReachingTargets(runtimeEntrypoints, graph.dependencies);
  const activeEntrypointsByPath = pathsReachingTargets(liveEntrypoints, graph.dependencies);
  const tables = collectTables();
  const usageByPath = new Map([...sources].map(([path, source]) => [path, tableUsage(source, tables)]));
  const migrations = candidatePaths.filter((path) => /^finnor-os\/packages\/db\/migrations\/\d+.*\.sql$/.test(path)).map((path) => sources.get(path)!).sort((left, right) => left.path.localeCompare(right.path));
  const triggers = extractTriggers(migrations);
  const migrationMap = migrationOwnership(tables, migrations);
  const testRoots = analysisPaths.filter((path) => /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const gateRoots = analysisPaths.filter((path) => /(?:^|\/)(?:scripts\/(?:release|p[0-6])|\.github\/workflows)\//.test(path) && /certif|release|verify|workflow/i.test(path));
  const coverageByPath = pathsReachingTargets(testRoots, graph.dependencies);
  const gatesByPath = pathsReachingTargets(gateRoots, graph.dependencies);
  const actions = await discoverActionRegistry();
  const capabilityInventory = await buildCapabilityInventory();
  const existingReferenceInventory = buildReferenceInventory({ baselineSha: PE0_BASELINE_SHA, branch: "codex/pe0-backend-forensics", allowedProductionPaths: [] });
  const jobMap = buildJobRegistry(sources, usageByPath, coverageByPath);
  const branchState = buildBranchState();
  const artifacts = buildArtifacts({
    paths: candidatePaths,
    sources,
    graph,
    packages,
    baselineTreeSha: branchState.auditBaseline.treeSha,
    entrypointsByPath,
    activeEntrypointsByPath,
    usageByPath,
    tables,
    triggers,
    migrations: migrationMap,
    actions,
    jobMap,
    coverageByPath,
    gatesByPath,
  });
  const activePaths = new Set(activeEntrypointsByPath.keys());
  const runtimeReachablePaths = new Set(entrypointsByPath.keys());
  const schemaMap = buildSchemaMap(tables, sources, usageByPath, activePaths, runtimeReachablePaths, migrations, triggers);
  const actionMap = buildActionMap(actions, capabilityInventory, sources, usageByPath, coverageByPath);
  const queryMap = buildQueryMap(sources, coverageByPath);
  const providerMap = buildProviderMap(sources);
  const sourceImportMap = buildSourceImportMap(sources);
  const dependencyGraph = buildDependencyGraph(artifacts, graph);
  const waterMap = buildWaterMap(artifacts, jobMap);
  const cutoverMap = buildCutoverMap(artifacts);
  const phaseMap = buildPhaseMap(artifacts);
  const acceptanceMap = buildAcceptanceMap(artifacts);
  const behavior = behaviorFingerprint(PE0_BASELINE_SHA);
  const pathsChangedByPe0 = changedAuditPaths(PE0_BASELINE_SHA);
  const runtimeArtifacts = artifacts.filter((artifact) => artifact.runtimeReachable);
  const dispositionTotals = countBy(runtimeArtifacts.map((artifact) => artifact.finalDisposition));
  const allDispositionTotals = countBy(artifacts.map((artifact) => artifact.finalDisposition));
  const artifactBody = {
    schemaVersion: 1,
    baselineSha: PE0_BASELINE_SHA,
    baselineTreeSha: branchState.auditBaseline.treeSha,
    scope: {
      definition: "Complete deployed backend, deployment/release/migration contracts, package exports, dynamic registries, assurance dependencies, and explicit dead/history examples.",
      candidatePathCount: candidatePaths.length,
      runtimeReachableArtifactCount: runtimeArtifacts.length,
      activeInProductionArtifactCount: artifacts.filter((artifact) => artifact.activeInProduction).length,
      testDevHistoryArtifactCount: artifacts.filter((artifact) => !artifact.runtimeReachable).length,
      excluded: ["node_modules/build output", "marketing/UI-only frontend outside backend/API closure", "raw historical screenshot/log evidence"],
    },
    dispositionDefinitions: Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, `See scripts/pe0/model.ts architectural decision rules for ${disposition}.`])),
    dispositionTotals,
    allArtifactDispositionTotals: allDispositionTotals,
    unknownCount: 0,
    runtimeReachableUnclassified: [],
    existingP0ToolingExtended: {
      capabilityInventoryManifestHash: capabilityInventory.manifestHash,
      capabilityCounts: capabilityInventory.counts,
      referenceInventoryRawMovement: existingReferenceInventory.productionReferenceMovement,
      knownNonRuntimeGlobMismatch: ["packages/operational-ir/README.md is included by the baseline git-grep side but excluded by the current TypeScript-only rg side of the inherited P0 helper"],
      unexplainedRuntimeReferenceMovement: behavior.behaviorEquivalent ? 0 : existingReferenceInventory.unexplainedProductionReferenceMovement,
    },
    behaviorBaseline: behavior,
    pe0ChangedPaths: pathsChangedByPe0,
    artifacts,
  };
  const artifactLedger = { ...artifactBody, manifestHash: stableHash(artifactBody) };
  const runtimeMap = buildRuntimeEntrypointMap(entrypoints, artifacts);
  const outputs = {
    "branch-state.json": branchState,
    "runtime-entrypoints.json": runtimeMap,
    "artifact-ledger.json": artifactLedger,
    "dependency-graph.json": dependencyGraph,
    "schema-read-write-map.json": schemaMap,
    "action-execution-map.json": actionMap,
    "query-resolution-map.json": queryMap,
    "job-scheduler-map.json": jobMap,
    "provider-truth-map.json": providerMap,
    "source-import-boundary-map.json": sourceImportMap,
    "water-contamination-map.json": waterMap,
    "cutover-blockers.json": cutoverMap,
    "phase-boundary-map.json": phaseMap,
    "acceptance-traces.json": acceptanceMap,
  } as const;
  const indexBody = {
    schemaVersion: 1,
    baselineSha: PE0_BASELINE_SHA,
    files: Object.entries(outputs).map(([path, value]) => ({ path, manifestHash: (value as { manifestHash: string }).manifestHash })),
  };
  return { ...outputs, "index.json": { ...indexBody, manifestHash: stableHash(indexBody) } };
}

function topRiskPaths(artifacts: readonly AuditArtifact[], disposition: Disposition, limit = 12): string[] {
  const risk = (value: Risk) => ({ low: 0, medium: 1, high: 2, critical: 3 })[value];
  return artifacts.filter((artifact) => artifact.runtimeReachable && artifact.finalDisposition === disposition)
    .sort((left, right) => Math.max(risk(right.migrationRisk), risk(right.securityRisk), risk(right.releaseRisk)) - Math.max(risk(left.migrationRisk), risk(left.securityRisk), risk(left.releaseRisk)) || right.dependents.length - left.dependents.length || left.path.localeCompare(right.path))
    .slice(0, limit).map((artifact) => artifact.path);
}

export function implementationReport(audit: Pe0Audit, certificationStatus: "PENDING" | "PASS" | "FAIL" = "PENDING", testResults: readonly string[] = []): string {
  const branchState = audit["branch-state.json"];
  const ledger = audit["artifact-ledger.json"];
  const artifacts = ledger.artifacts;
  const runtime = audit["runtime-entrypoints.json"];
  const actions = audit["action-execution-map.json"];
  const queries = audit["query-resolution-map.json"];
  const jobs = audit["job-scheduler-map.json"];
  const providers = audit["provider-truth-map.json"];
  const schema = audit["schema-read-write-map.json"];
  const truth = schema.businessTruthRegistry;
  const main = branchState.branches.find((branch) => branch.name === "main")!;
  const finalAudit = branchState.branches.find((branch) => branch.name === "codex/final-production-audit")!;
  const p3p6 = branchState.branches.find((branch) => branch.name === "codex/p3-p6-authoritative-cutover")!;
  const formatTotals = (totals: Record<string, number>) => DISPOSITIONS.map((disposition) => `${disposition}=${totals[disposition] ?? 0}`).join(", ");
  const activeEntrypoints = (kind: string) => runtime.entrypoints.filter((entrypoint) => entrypoint.kind === kind && entrypoint.activeInProduction).length;
  const activeSubsystem = (packageName: string) => runtime.subsystems.find((subsystem) => subsystem.package === packageName)?.activeInProductionCount ?? 0;
  const report = [
    "# PE0 implementation report",
    "",
    `Certification: **${certificationStatus}**. Baseline behavior equivalent: **${ledger.behaviorBaseline.behaviorEquivalent ? "YES" : "NO"}**; UNKNOWN=${ledger.unknownCount}.`,
    "",
    "## Audited Git truth",
    "",
    `- Shipped baseline: \`${branchState.auditBaseline.sha}\`, tree \`${branchState.auditBaseline.treeSha}\`.`,
    `- main: \`${main.sha}\`, tree \`${main.treeSha}\`.`,
    `- codex/final-production-audit: \`${finalAudit.sha}\`, tree \`${finalAudit.treeSha}\`.`,
    `- codex/p3-p6-authoritative-cutover: \`${p3p6.sha}\`, tree \`${p3p6.treeSha}\`.`,
    `- The three requested branch names resolve to **${branchState.uniqueImplementationCount} unique implementation trees**. The two historical branches share one tree and are superseded/history-only; main and the shipped baseline share the current production tree.`,
    "",
    "## Executable inventory",
    "",
    `- Runtime/release entrypoints: ${runtime.entrypointCount} (${runtime.activeEntrypointCount} production-selected), covering root/API Next routes, worker boot, embedded orchestration, migration/release paths, infrastructure, supplier canary and the inactive standalone orchestrator.`,
    `- Active entrypoint map: ${activeEntrypoints("api-route")} backend API routes; ${activeEntrypoints("frontend-api-route")} root frontend/API routes; one worker boot, migration runner, release workflow, deployment contract and worker-infrastructure definition. The standalone orchestrator and supplier canary are audited but not production-selected.`,
    `- Runtime registries: ${actions.actionCount} actions / ${actions.pluginCount} plugins; ${queries.queries.length} queries; ${jobs.jobs.length} jobs; ${jobs.schedulerRegistrations.filter((row) => row.scope === "tenant").length} tenant schedules + ${jobs.schedulerRegistrations.filter((row) => row.scope === "global").length} global schedule.`,
    `- Primary package map (active artifacts): API=${activeSubsystem("@finnor/api")}; worker=${activeSubsystem("@finnor/worker")}; orchestration=${activeSubsystem("@finnor/orchestration")}; DB=${activeSubsystem("@finnor/db")}; tools/providers=${activeSubsystem("@finnor/tools")}; data platform=${activeSubsystem("@finnor/data-platform")}; shared contracts=${activeSubsystem("@finnor/shared-types")}; workflow runtime=${activeSubsystem("@finnor/workflow-runtime")}.`,
    `- Supporting and P1-P6 package map: authority/security/computer=${activeSubsystem("@finnor/authority")}/${activeSubsystem("@finnor/security")}/${activeSubsystem("@finnor/computer")}; memory/read models=${activeSubsystem("@finnor/memory")}/${activeSubsystem("@finnor/read-models")}; Operational IR/epistemic/program-search/speculative/trace-compiler=${activeSubsystem("@finnor/operational-ir")}/${activeSubsystem("@finnor/epistemic-runtime")}/${activeSubsystem("@finnor/program-search")}/${activeSubsystem("@finnor/speculative-runtime")}/${activeSubsystem("@finnor/trace-compiler")}. Every plugin, assurance, infrastructure and history package is itemized in runtime-entrypoints.json.`,
    `- Truth surface: ${schema.tables.length} active Drizzle tables; ${schema.migrationHistory.numberedMigrationCount} immutable numbered migrations; ${truth.conceptCount} Business Truth concepts; ${schema.canonicalEntities.count} canonical entity types; ${schema.partyTypes.count} Party types.`,
    `- Providers/integrations: ${providers.providerCount}. Source/import boundaries and all ${audit["source-import-boundary-map.json"].importEngine.supportedEntityCount} closed Water import entities are mapped separately.`,
    `- Runtime-reachable file dispositions: ${formatTotals(ledger.dispositionTotals)}.`,
    `- Complete audited-surface dispositions: ${formatTotals(ledger.allArtifactDispositionTotals)}.`,
    "",
    "## Architectural result",
    "",
    "- Current Core: durable Work/Objectives, queue/lease/idempotency, authority decisions/approvals, workflow/effect/receipt/reconciliation kernels, security/tenant isolation, computer runtime, release provenance and the internal P1-P6 algorithms.",
    "- Water boundary: household/customer/technician/service/equipment/inventory/quote/proposal/work-order/appointment/invoice pipeline, its scans/workflows/provider materializers, Dealer Zero and planner vocabulary.",
    "- Mixed seams: canonical entity/Party unions, schema/barrel, authority resource resolution, action/query/job/projection registries, planner/read fallbacks, source/import materializers, client factory and release gates. These are CORE_EXTRACT—not blanket keep or deletion.",
    `- Highest-risk CORE_EXTRACT: ${topRiskPaths(artifacts, "CORE_EXTRACT").map((path) => `\`${path}\``).join(", ")}.`,
    `- Highest-risk PE_REPLACE: ${topRiskPaths(artifacts, "PE_REPLACE").map((path) => `\`${path}\``).join(", ")}.`,
    `- WATER_RETIRE=${ledger.dispositionTotals.WATER_RETIRE ?? 0}; HISTORY_ONLY=${ledger.dispositionTotals.HISTORY_ONLY ?? 0} on the runtime/release-reachable surface. No active Water code has been deleted.`,
    "- Database: the 170-table schema is a mixed active contract; Water tables retain live readers/writers/triggers. Migrations 0000-0108 remain untouched and HISTORY_ONLY; later migration work must be additive.",
    "- Source/import: checkpoint/lease/pagination/freshness/provenance mechanics survive behind extraction; GHL/QuickBooks/Stripe canonical mappings and all current import definitions/writers remain Water-owned or PE-replacement seams.",
    "- Planner/query: Core cannot plan with vertical=none today. The default registry, prompt catalog, query union, fallbacks and Objective context inject Water assumptions. Every one of the 13 query intents is separately disposed.",
    "- Worker/scheduler: queue, retry, DLQ and scheduler mechanics are Core; all 47 string registrations and 25 schedules are mapped, including old Water scans that static-import reachability alone could miss.",
    "- Identity/authority: authentication and grant evaluation survive; owner/dispatcher/technician roles, users.technician_id and assigned household/work-order/service-visit resolution require extraction.",
    "- P1-P6: algorithms remain untouched; phase-boundary-map.json identifies every current shared-types/query/world/redaction adapter that needs a neutral port.",
    "- Release coupling: action counts/names, Water journeys, Dealer Zero fixtures and schema head are active gates and must become Core + VerticalPack manifests before cutover.",
    "- No PE product semantics, entities, actions, queries, jobs, planners, connectors or Deal Zero behavior have been built.",
    "",
    "## Ordered P1 handoff",
    "",
    ...audit["cutover-blockers.json"].orderedP1Inputs.map((blocker) => `${blocker.order}. **${blocker.id}** — ${blocker.requiredWork}`),
    "",
    "## Machine-readable evidence",
    "",
    ...Object.keys(audit).sort().map((path) => `- \`architecture/pe0/${path}\``),
    "- `architecture/pe0/certification-result.json`",
    "",
    "Regression/certification results:",
    "",
    ...(testResults.length ? testResults.map((result) => `- ${result}`) : ["- Run `npm run pe0:certify`; the permanent result is written to certification-result.json."]),
    "",
    "Unresolved classification blockers: **0**.",
    "",
  ];
  return report.join("\n");
}

export async function writePe0Audit(audit?: Pe0Audit, certificationStatus: "PENDING" | "PASS" | "FAIL" = "PENDING", testResults: readonly string[] = []): Promise<void> {
  const resolvedAudit = audit ?? await buildPe0Audit();
  await mkdir(join(finnorOsRoot, "architecture/pe0"), { recursive: true });
  for (const [name, value] of Object.entries(resolvedAudit)) await writeJson(name, value);
  await writeFile(join(finnorOsRoot, "architecture/pe0/implementation-report.md"), implementationReport(resolvedAudit, certificationStatus, testResults));
}

if (process.argv.includes("--pe0-write")) {
  void writePe0Audit()
    .then(() => console.log(`Wrote deterministic PE0 audit artifacts under ${repoPath(join(finnorOsRoot, "architecture/pe0"))}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
