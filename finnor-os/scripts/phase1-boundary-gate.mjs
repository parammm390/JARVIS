import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceExtensions = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const manifests = walk(root).filter((path) => path.endsWith("package.json"));
const packages = new Map(manifests.map((path) => {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return [manifest.name, { path, manifest }];
}).filter(([name]) => typeof name === "string" && name.startsWith("@finnor/")));
const graph = new Map([...packages].map(([name, { manifest }]) => [name, Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }).filter((dependency) => packages.has(dependency)).sort()]));

const cycles = [];
const visited = new Set();
const stack = [];
const inStack = new Set();
function visit(name) {
  if (inStack.has(name)) {
    const start = stack.indexOf(name);
    cycles.push([...stack.slice(start), name]);
    return;
  }
  if (visited.has(name)) return;
  inStack.add(name); stack.push(name);
  for (const dependency of graph.get(name) ?? []) visit(dependency);
  stack.pop(); inStack.delete(name); visited.add(name);
}
for (const name of graph.keys()) visit(name);

const planning = packages.get("@finnor/planning-ir");
if (!planning) throw new Error("@finnor/planning-ir is missing");
const planningDependencies = Object.keys({ ...planning.manifest.dependencies, ...planning.manifest.devDependencies, ...planning.manifest.peerDependencies }).sort();
const allowedPlanningDependencies = new Set(["@finnor/shared-types", "zod"]);
const forbiddenDependencies = planningDependencies.filter((dependency) => !allowedPlanningDependencies.has(dependency));
const planningFiles = walk(resolve(root, "packages/planning-ir")).filter((path) => sourceExtensions.test(path));
const forbiddenImports = [];
for (const path of planningFiles) {
  const source = withoutComments(readFileSync(path, "utf8"));
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith("@finnor/") && specifier !== "@finnor/shared-types") forbiddenImports.push({ file: relative(root, path), specifier });
  }
}

const sourceFiles = walk(root).filter((path) => sourceExtensions.test(path) && !path.includes("/tests/") && !path.includes(".test.") && !path.endsWith("phase1-boundary-gate.mjs"));
const irIdentityMisuse = [];
for (const path of sourceFiles) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (/\b(?:businessEffect(?:Id|Hash)?|semanticHash|effectHash|idempotencyKey|externalOperationId|operationIdentity)\b\s*[:=].*\birSemanticHash\b|\birSemanticHash\b.*\b(?:businessEffect|idempotency|effectHash|semanticHash)\b/i.test(line)) {
      irIdentityMisuse.push({ file: relative(root, path), line: index + 1 });
    }
  });
}

const interfaceSource = readFileSync(resolve(root, "packages/domain-plugins/shared/plugin-interface.ts"), "utf8");
const pureBlock = interfaceSource.match(/export interface PureDomainEngine\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const forbiddenPureMethods = [...pureBlock.matchAll(/^\s*(execute|persist|authorize|browser|provider|api|tools?)\s*\(/gim)].map((match) => match[1]);

const pluginExecuteInvocationPattern = /\b(?:[A-Za-z0-9_]*[pP]lugin|params\.plugin)\.execute\s*\(/g;
const permittedRuntimePluginCallSites = new Set([
  "packages/orchestration/src/runtime-bridge.ts",
  "packages/orchestration/src/durable-execution.ts",
]);
const runtimePluginExecuteCallSites = [];
for (const path of sourceFiles.filter((candidate) => candidate.includes("/packages/") || candidate.includes("/apps/"))) {
  const source = withoutComments(readFileSync(path, "utf8"));
  for (const match of source.matchAll(pluginExecuteInvocationPattern)) runtimePluginExecuteCallSites.push({
    file: relative(root, path),
    line: source.slice(0, match.index).split("\n").length,
  });
}
const forbiddenRuntimePluginExecuteCallSites = runtimePluginExecuteCallSites.filter(({ file }) => !permittedRuntimePluginCallSites.has(file));

const report = {
  status: cycles.length || forbiddenDependencies.length || forbiddenImports.length || irIdentityMisuse.length || forbiddenPureMethods.length || forbiddenRuntimePluginExecuteCallSites.length ? "FAIL" : "PASS",
  packageGraph: { nodes: graph.size, edges: [...graph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0), cycles },
  planningIrBoundary: { dependencies: planningDependencies, forbiddenDependencies, forbiddenImports },
  hashSeparation: { misuseCount: irIdentityMisuse.length, locations: irIdentityMisuse },
  pureDomainEngine: { forbiddenExecutionMethodCount: forbiddenPureMethods.length, forbiddenMethods: forbiddenPureMethods },
  legacyExecutionBoundary: {
    permittedRuntimeCallSites: [...permittedRuntimePluginCallSites],
    runtimePluginExecuteCallSites,
    forbiddenRuntimePluginExecuteCallSites,
  },
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
