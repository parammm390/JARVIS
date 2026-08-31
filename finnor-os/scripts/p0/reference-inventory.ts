import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_SHA, P0_BRANCH, P0_RUNTIME_CORRECTION_PATHS } from "./lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const outputPath = join(root, "architecture/p0/reference-inventory.json");

export const REFERENCE_PATTERNS: Record<string, string> = {
  instruction_route: "InstructionExecutionModel|InstructionRouteDecision|classifyInstructionRoute|executionModel",
  canonical_entity_identity: "CanonicalEntityRef|PartyRef|canonicalEntity|canonical_entity",
  grounding: "groundedPayload|grounded_payload|groundAction|CompiledCommandGraph|compiledGraph",
  capability_identity: "CapabilityContract|capability|actionType|action_type",
  action_intent: "DomainAction|domainActions|domain_actions|DraftAction",
  business_effect: "BusinessEffect|businessEffects|business_effects",
  effect_identity: "semanticHash|semantic_hash|scopeHash|scope_hash|businessEffectHash",
  authority_decision: "AuthorityDecision|authorityDecisions|authority_decisions|evaluateAuthority",
  approval: "ApprovalRequest|approvalRequests|approval_requests|approvalSteps|approval_steps",
  work: "WorkStatus|WORK_STATUSES|workInputs|work_inputs|works",
  objective: "ObjectiveLoop|workObjectiveLoops|work_objective_loops|ObjectiveState",
  execution_claim: "executionState|claimedAt|claimedBy|claimStep|claim.*Execution",
  provider_operation: "externalOperations|external_operations|integrationOperations|integration_operations",
  idempotency: "idempotencyKey|idempotency_key|operationKey|operation_key",
  external_outcome: "unknown_outcome|unknownOutcome|providerAccepted|awaiting_observation",
  reconciliation: "reconciliationCases|reconciliation_cases|reconcil",
  verification: "verification|successVerifiedAt|verified",
  receipt: "DecisionReceipt|decisionReceipts|decision_receipts",
  context: "OperatingContext|InteractionContext|operating_context|interaction_context",
  memory: "MemorySnapshot|memoryCorrections|memory_corrections|semanticMemory|semantic_memory|querySemantic|buildMemorySnapshot",
  business_truth: "SourceOwnership|source_ownership|CANONICAL_ENTITY_TYPES|canonical business|fieldOwnership",
  computer_task: "ComputerTask|computerRuns|computer_runs|computer_run",
  frontend_work_state: "executionProjection|ExecutionProjection|workCases|WorkCases|operationalDeltas|operational_deltas|readModelProjections|read_model_projections",
  causal_replay: "causalReplay|causal_replay|CausalReplay",
};

type ScopeSummary = {
  fileCount: number;
  lineCount: number;
  byFile: Array<{ path: string; lineCount: number }>;
};

function commandLines(command: string, args: string[]): string[] {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

function summarize(lines: string[], baselineSha?: string): ScopeSummary {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const normalized = baselineSha ? line.replace(new RegExp(`^${baselineSha}:`), "") : line;
    const match = normalized.match(/^(.+?):\d+:/);
    if (!match) throw new Error(`Cannot parse reference line: ${line}`);
    counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  const byFile = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, lineCount]) => ({ path, lineCount }));
  return { fileCount: byFile.length, lineCount: lines.length, byFile };
}

function baselineMatches(pattern: string, paths: string[], baselineSha: string): ScopeSummary {
  return summarize(commandLines("git", ["grep", "-n", "-E", pattern, baselineSha, "--", ...paths]), baselineSha);
}

function currentMatches(pattern: string, paths: string[]): ScopeSummary {
  return summarize(commandLines("rg", ["-n", "--no-heading", "--color", "never", "-g", "*.ts", "-g", "*.tsx", "-g", "*.js", "-g", "*.mjs", "-g", "*.sql", "-g", "*.json", pattern, ...paths]), undefined);
}

function movedFiles(pre: ScopeSummary, post: ScopeSummary): string[] {
  const before = new Map(pre.byFile.map((row) => [row.path, row.lineCount]));
  const after = new Map(post.byFile.map((row) => [row.path, row.lineCount]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

export function buildReferenceInventory(options: {
  baselineSha?: string;
  branch?: string;
  allowedProductionPaths?: readonly string[];
} = {}) {
  const baselineSha = options.baselineSha ?? BASELINE_SHA;
  const branch = options.branch ?? P0_BRANCH;
  const allowedProductionPaths = options.allowedProductionPaths ?? P0_RUNTIME_CORRECTION_PATHS;
  const concepts = Object.entries(REFERENCE_PATTERNS).map(([concept, pattern]) => {
    const productionPre = baselineMatches(pattern, ["apps", "packages"], baselineSha);
    const productionPost = currentMatches(pattern, ["apps", "packages"]);
    const assurancePre = baselineMatches(pattern, ["scripts", "tests"], baselineSha);
    const assurancePost = currentMatches(pattern, ["scripts", "tests"]);
    const productionChangedFiles = movedFiles(productionPre, productionPost);
    const unexpectedProductionChangedFiles = productionChangedFiles.filter((path) => !allowedProductionPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)));
    return {
      concept,
      pattern,
      production: {
        pre: productionPre,
        post: productionPost,
        delta: {
          files: productionPost.fileCount - productionPre.fileCount,
          lines: productionPost.lineCount - productionPre.lineCount,
          changedFiles: productionChangedFiles,
          unexpectedChangedFiles: unexpectedProductionChangedFiles,
        },
        explanation: productionPre.fileCount === productionPost.fileCount && productionPre.lineCount === productionPost.lineCount
          ? "P0 changed no runtime reference locations."
          : unexpectedProductionChangedFiles.length === 0
            ? "Explained by the exact invariant-conformance corrections in architecture/p0/runtime-corrections.json."
            : "UNEXPECTED_RUNTIME_REFERENCE_MOVEMENT",
      },
      assurance: {
        pre: assurancePre,
        post: assurancePost,
        delta: { files: assurancePost.fileCount - assurancePre.fileCount, lines: assurancePost.lineCount - assurancePre.lineCount },
        explanation: "P0 may add only architecture certification scripts/tests; exact movement is enumerated above.",
      },
    };
  });
  return {
    schemaVersion: 1,
    baselineSha,
    branch,
    scopes: {
      production: ["apps", "packages"],
      assurance: ["scripts", "tests"],
      excluded: ["architecture/p0 generated manifests (prevents recursive self-counting)", "node_modules", "build output"],
    },
    concepts,
    productionReferenceMovement: concepts.reduce((sum, row) => sum + Math.abs(row.production.delta.files) + Math.abs(row.production.delta.lines), 0),
    unexplainedProductionReferenceMovement: concepts.reduce((sum, row) => sum + (row.production.delta.unexpectedChangedFiles.length > 0
      ? Math.abs(row.production.delta.files) + Math.abs(row.production.delta.lines)
      : 0), 0),
  };
}

if (process.argv.includes("--write")) {
  void mkdir(dirname(outputPath), { recursive: true })
    .then(() => writeFile(outputPath, `${JSON.stringify(buildReferenceInventory(), null, 2)}\n`))
    .then(() => console.log(`Wrote ${relative(root, outputPath)}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
