import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { ACTION_HARDENING_SPEC_BY_ACTION } from "./release/action-hardening-spec";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "artifacts/phase1/legacy-domain-engine-execution.post.json");
const migratedActions = new Set(["log_stock_used_on_visit", "send_customer_message", "computer_task"]);
const withoutComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const registry = createDefaultPluginRegistry();
const actionTypes = registry.actionTypes().sort();
const actions = actionTypes.map((actionType) => {
  const plugin = registry.resolve(actionType)!;
  const hardening = ACTION_HARDENING_SPEC_BY_ACTION.get(actionType);
  if (!hardening) throw new Error(`${actionType} is registered but absent from the fixed action hardening spec`);
  const pureIntelligenceMigrated = Boolean(plugin.intelligence?.actionTypes.includes(actionType));
  if (pureIntelligenceMigrated !== migratedActions.has(actionType)) throw new Error(`${actionType} pure migration inventory is out of sync`);
  const consequential = hardening.profile !== "READ_ONLY" && hardening.profile !== "META_NO_SIDE_EFFECT";
  return {
    plugin: plugin.name,
    actionType,
    profile: hardening.profile,
    approvalFloor: hardening.approvalFloor,
    external: hardening.external,
    consequential,
    pureIntelligenceMigrated,
    legacyExecutionStatus: pureIntelligenceMigrated ? "MIGRATED_COMPATIBILITY_ADAPTER" : "BOUNDED_LEGACY_EXECUTE",
    executionBoundary: consequential
      ? "BusinessEffect compiler -> authority/approval -> durable workflow command -> durable worker -> plugin.execute -> observation/reconciliation -> receipt"
      : "audited authorization -> synchronous runtime bridge -> plugin.execute -> DecisionReceipt",
    bypassPermitted: false,
    newDecisionIntelligencePermittedInExecute: false,
  };
});

const tsFiles = walk(root).filter((path) => /\.(?:ts|tsx)$/.test(path));
const pluginImplementations = tsFiles.filter((path) => path.includes("/packages/domain-plugins/") && !path.includes(".test.") && /^\s*(?:async\s+)?execute\s*\(/m.test(withoutComments(readFileSync(path, "utf8"))))
  .map((path) => relative(root, path)).sort();
const pluginExecuteImplementationCount = tsFiles.filter((path) => path.includes("/packages/domain-plugins/") && !path.includes(".test."))
  .reduce((count, path) => count + [...withoutComments(readFileSync(path, "utf8")).matchAll(/^\s*(?:async\s+)?execute\s*\(/gm)].length, 0);
const invocationPattern = /\b(?:[A-Za-z0-9_]*[pP]lugin|params\.plugin)\.execute\s*\(/g;
const invocationSites = tsFiles.flatMap((path) => {
  const source = withoutComments(readFileSync(path, "utf8"));
  const locations: Array<{ file: string; line: number; environment: "runtime" | "test" | "certification" }> = [];
  for (const match of source.matchAll(invocationPattern)) {
    const file = relative(root, path);
    locations.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      environment: file.startsWith("tests/") || file.includes(".test.") ? "test" : file.startsWith("scripts/") ? "certification" : "runtime",
    });
  }
  return locations;
});
const runtimeInvocationSites = invocationSites.filter(({ environment }) => environment === "runtime");
const permittedRuntimeCallSites = new Set([
  "packages/orchestration/src/runtime-bridge.ts",
  "packages/orchestration/src/durable-execution.ts",
]);
const forbiddenRuntimeInvocationSites = runtimeInvocationSites.filter(({ file }) => !permittedRuntimeCallSites.has(file));

const report = {
  schemaVersion: 1,
  generatedFrom: "current_worktree",
  counts: {
    registeredActionTypes: actions.length,
    consequentialActionTypes: actions.filter(({ consequential }) => consequential).length,
    readOrMetaActionTypes: actions.filter(({ consequential }) => !consequential).length,
    migratedPureActionTypes: actions.filter(({ pureIntelligenceMigrated }) => pureIntelligenceMigrated).length,
    remainingBoundedLegacyActionTypes: actions.filter(({ pureIntelligenceMigrated }) => !pureIntelligenceMigrated).length,
    pluginExecuteImplementations: pluginExecuteImplementationCount,
    pluginExecuteImplementationFiles: pluginImplementations.length,
    runtimePluginExecuteCallSites: runtimeInvocationSites.length,
    forbiddenRuntimePluginExecuteCallSites: forbiddenRuntimeInvocationSites.length,
    testOrCertificationDirectCallSites: invocationSites.length - runtimeInvocationSites.length,
  },
  migratedPureActionTypes: actions.filter(({ pureIntelligenceMigrated }) => pureIntelligenceMigrated),
  remainingLegacyActionTypes: actions.filter(({ pureIntelligenceMigrated }) => !pureIntelligenceMigrated),
  allActions: actions,
  pluginExecuteImplementationFiles: pluginImplementations,
  runtimeInvocationSites,
  forbiddenRuntimeInvocationSites,
  nonRuntimeDirectInvocationSites: invocationSites.filter(({ environment }) => environment !== "runtime"),
  governanceProof: {
    consequentialCompileBoundary: "packages/orchestration/src/compiler.ts#ensureBusinessEffect",
    authorizationAndQueueBoundary: "packages/orchestration/src/runtime-bridge.ts#authorizeActionExecutionTx",
    consequentialWorkerCallSite: "packages/orchestration/src/durable-execution.ts",
    nonConsequentialCompatibilityCallSite: "packages/orchestration/src/runtime-bridge.ts#executePluginViaRuntime",
    fixedClassificationSource: "scripts/release/action-hardening-spec.ts",
    newDeepDecisionIntelligencePolicy: "PureDomainEngine only; legacy execute is a bounded compatibility adapter and may not acquire new decision intelligence",
  },
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: relative(root, output), ...report.counts }, null, 2));
if (forbiddenRuntimeInvocationSites.length > 0) process.exitCode = 1;
