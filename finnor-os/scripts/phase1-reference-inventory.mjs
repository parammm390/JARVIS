import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const ref = valueFor("--ref");
const out = valueFor("--out");
if (!out) throw new Error("usage: node scripts/phase1-reference-inventory.mjs [--ref <git-ref>] --out <path>");

const root = resolve(import.meta.dirname, "../..");
const git = (...command) => execFileSync("git", command, { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
const excluded = (path) =>
  path === "finnor-os/package-lock.json"
  || path.endsWith("/migrations-bundle.ts")
  || path.endsWith("/scripts/phase1-reference-inventory.mjs")
  || path.includes("/node_modules/")
  || path.includes("/dist/")
  || path.includes("/.next/")
  || path.startsWith("docs/")
  || path.startsWith("evidence/")
  || path.startsWith("finnor-os/docs/")
  || path.startsWith("finnor-os/evidence/")
  || path.startsWith("finnor-os/artifacts/phase1/");

const fileNames = (ref
  ? git("ls-tree", "-r", "--name-only", ref)
  : git("ls-files", "--cached", "--others", "--exclude-standard"))
  .split("\n")
  .filter((path) => path.startsWith("finnor-os/") && !excluded(path));

const read = (path) => ref ? git("show", `${ref}:${path}`) : readFileSync(resolve(root, path), "utf8");
const textExtensions = /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|sql)$/;
const textFiles = fileNames.filter((path) => textExtensions.test(path));

const definitions = [
  {
    key: "instruction_routing",
    pattern: /\b(?:classifyInstructionRoute|finalizeInstructionRoute|InstructionExecutionModel|InstructionRouteDecision|executionModel|execution_model|QUERY|ATOMIC_EFFECT|OBJECTIVE|CONVERSATION)\b/,
  },
  {
    key: "compiler",
    pattern: /\b(?:compileAction|buildCommandGraph|groundEntitiesWithDb|ensureBusinessEffect|compileBusinessEffectWithDb|recordBusinessEffectOutcome|verifyBusinessEffectPreconditions|BusinessEffectBoundaryError)\b|(?:^|\/)compiler\.ts/,
  },
  {
    key: "equipment",
    pattern: /\b(?:equipment|Equipment)\b/,
  },
  {
    key: "equipment_import_write_matching",
    path: /(?:packages\/(?:import-engine|data-platform)|scripts\/.*import|tests\/.*import)/,
    pattern: /\b(?:equipment|writeCanonicalImportRow|runDeclarativeImport|importEntityRefs|identityKey|sourceSystem|sourceId|existingId|ambiguous_match)\b/,
  },
  {
    key: "domain_engine_plugin",
    pattern: /\b(?:DomainEnginePlugin|createStubPlugin|executePluginViaRuntime)\b|\bplugin\.execute\s*\(|^\s*(?:async\s+)?execute\s*\(/,
  },
  {
    key: "business_effect_identity",
    pattern: /\b(?:BusinessEffect|BusinessEffectSet|businessEffects|businessEffectId|businessEffectHash|semanticHash|scopeHash|effectHash|executedEffectHash|authorizedEffectHash|idempotencyKey|operationKey|externalOperations|integrationOperations)\b/,
  },
  {
    key: "work_objective_lifecycle",
    pattern: /\b(?:Work|works|workId|workObjectiveLoops|workObjectiveSteps|Objective|ObjectiveSuccessCondition|objectiveLoopId|transitionWork|reconcileWorkStatus|resumeObjectiveForAction)\b/,
  },
  {
    key: "eval_certification",
    path: /(?:tests\/(?:eval|planner-evals)|scripts\/(?:release\/)?[^/]*(?:certif|eval|gate)|scripts\/release\/run-release-certification|vitest\.config|package\.json$)/,
    pattern: /./,
  },
];

const locationKind = (path) => path.includes("/tests/") ? "test"
  : path.includes("/migrations/") ? "migration"
    : path.endsWith("package.json") || /(?:tsconfig|vitest|workspace)/.test(path) ? "configuration"
      : path.includes("/scripts/") ? "script"
        : path.includes("/apps/") ? "application"
          : "package_source";

const categories = {};
for (const definition of definitions) {
  const locations = [];
  for (const path of textFiles) {
    if (definition.path && !definition.path.test(path)) continue;
    let content;
    try { content = read(path); } catch { continue; }
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!definition.pattern.test(lines[index])) continue;
      locations.push({ path, line: index + 1, kind: locationKind(path), text: lines[index].trim().slice(0, 500) });
    }
  }
  const byKind = {};
  for (const location of locations) byKind[location.kind] = (byKind[location.kind] ?? 0) + 1;
  categories[definition.key] = {
    referenceCount: locations.length,
    fileCount: new Set(locations.map(({ path }) => path)).size,
    byKind: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b))),
    locations,
  };
}

const manifestPaths = fileNames.filter((path) => path.endsWith("/package.json"));
const manifests = manifestPaths.map((path) => ({ path, manifest: JSON.parse(read(path)) }));
const internalNames = new Set(manifests.map(({ manifest }) => manifest.name).filter((name) => typeof name === "string" && name.startsWith("@finnor/")));
const graph = {};
for (const { path, manifest } of manifests) {
  if (!internalNames.has(manifest.name)) continue;
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  graph[manifest.name] = {
    path,
    dependencies: Object.keys(dependencies).filter((name) => internalNames.has(name)).sort(),
  };
}

const cycles = [];
const seenCycles = new Set();
const visit = (node, stack) => {
  const index = stack.indexOf(node);
  if (index >= 0) {
    const cycle = [...stack.slice(index), node];
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, offset) => [...body.slice(offset), ...body.slice(0, offset)]);
    const canonical = rotations.map((row) => row.join(" -> ")).sort()[0];
    if (!seenCycles.has(canonical)) { seenCycles.add(canonical); cycles.push(cycle); }
    return;
  }
  for (const dependency of graph[node]?.dependencies ?? []) visit(dependency, [...stack, node]);
};
for (const node of Object.keys(graph).sort()) visit(node, []);

const compilerPath = "finnor-os/packages/orchestration/src/compiler.ts";
const compiler = read(compilerPath);
const pluginExecuteLocations = categories.domain_engine_plugin.locations.filter((location) =>
  location.path.includes("/packages/domain-plugins/") && /^async execute\s*\(|^execute\s*\(/.test(location.text),
);
const inventory = {
  inventorySchemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: ref ? { mode: "git_ref", ref, sha: git("rev-parse", ref).trim() } : { mode: "worktree", sha: git("rev-parse", "HEAD").trim() },
  methodology: {
    countUnit: "matching source lines",
    scope: "tracked/untracked FINNOR OS source, tests, migrations, scripts, and configuration",
    excluded: ["generated migrations-bundle.ts", "package-lock.json", "documentation/evidence", "build dependencies/output", "this inventory generator", "generated Phase-1 artifacts"],
  },
  summary: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, { referenceCount: value.referenceCount, fileCount: value.fileCount, byKind: value.byKind }])),
  categories,
  compiler: {
    path: compilerPath,
    lineCount: compiler.split("\n").length,
    sha256: createHash("sha256").update(compiler).digest("hex"),
  },
  legacyPluginExecution: {
    implementationCount: pluginExecuteLocations.length,
    locations: pluginExecuteLocations,
  },
  packageGraph: {
    nodeCount: Object.keys(graph).length,
    edgeCount: Object.values(graph).reduce((sum, node) => sum + node.dependencies.length, 0),
    cycleCount: cycles.length,
    cycles,
    nodes: graph,
  },
};

const outputPath = resolve(root, out);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ out, source: inventory.source, summary: inventory.summary, compiler: inventory.compiler, legacyPluginExecution: { implementationCount: inventory.legacyPluginExecution.implementationCount }, packageGraph: { nodeCount: inventory.packageGraph.nodeCount, edgeCount: inventory.packageGraph.edgeCount, cycleCount: inventory.packageGraph.cycleCount } }, null, 2));
