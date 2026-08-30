import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as toolExports from "../../packages/tools/src/index";
import { createDefaultRegistry } from "../../packages/tools/src/index";
import { OPERATIONAL_QUERY_INTENTS } from "../../packages/shared-types/src/operational-queries";
import { ACTION_HARDENING_SPEC_BY_ACTION } from "../release/action-hardening-spec";
import { discoverActionRegistry } from "../release/discover-action-registry";
import { BASELINE_SHA, deterministicHash, P0_BRANCH, PREVIOUS_BASELINE_SHA } from "./lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const outputPath = join(root, "architecture/p0/capability-inventory.json");

type RuntimeContract = {
  domain: string;
  capability: string;
  version: number;
  retryPolicy: { attempts: number; baseDelayMs: number; timeoutMs: number };
  requiredPermission: string;
  piiAllowlist: readonly string[];
  retryOnUnknown: boolean;
};

type RuntimeBinding = {
  name: string;
  reconcile?: unknown;
  compensate?: unknown;
};

const CONTRACT_BINDINGS: Record<string, readonly string[]> = {
  bookProviderAppointmentContract: ["bookProviderAppointmentEmulatorBinding", "bookProviderAppointmentNativeBinding", "bookProviderAppointmentGhlBinding"],
  confirmAppointmentContract: ["confirmAppointmentEmulatorBinding", "confirmAppointmentNativeBinding"],
  createPaymentLinkContract: ["createPaymentLinkEmulatorBinding", "stripeCreatePaymentLinkBinding"],
  generateDocumentContract: ["generateDocumentEmulatorBinding", "generateDocumentNativeBinding"],
  holdAppointmentContract: ["emulatorSchedulingBinding", "nativeSchedulingBinding"],
  launchAdCampaignContract: ["launchAdCampaignEmulatorBinding", "launchAdCampaignDryRunBinding"],
  receiveProcurementContract: ["receiveProcurementEmulatorBinding", "receiveProcurementNativeBinding"],
  requestSignatureContract: ["requestSignatureEmulatorBinding", "requestSignatureDocusignBinding"],
  reserveStockContract: ["reserveStockEmulatorBinding", "reserveStockNativeBinding"],
  sendConfirmationContract: ["emulatorCommunicationsBinding", "vapiCommunicationsBinding"],
  sendMessageContract: ["sendMessageEmulatorBinding", "sendMessageNativeBinding", "sendMessageGhlBinding"],
  sendReviewRequestContract: ["sendReviewRequestEmulatorBinding", "sendReviewRequestNativeBinding", "sendReviewRequestGhlBinding"],
  syncInvoiceContract: ["syncInvoiceEmulatorBinding", "syncInvoiceQuickbooksBinding"],
  upsertContactContract: ["upsertContactEmulatorBinding", "upsertContactNativeBinding", "upsertContactGhlBinding"],
};

async function sourceLocation(exportName: string): Promise<{ path: string; line: number }> {
  const capabilityRoot = join(root, "packages/tools/src/capabilities");
  for (const entry of (await readdir(capabilityRoot)).sort()) {
    if (!entry.endsWith(".ts")) continue;
    const path = join(capabilityRoot, entry);
    const lines = (await readFile(path, "utf8")).split("\n");
    const line = lines.findIndex((candidate) => candidate.includes(`export const ${exportName}`));
    if (line >= 0) return { path: relative(root, path), line: line + 1 };
  }
  throw new Error(`Cannot locate exported capability contract ${exportName}`);
}

export async function buildCapabilityInventory() {
  const discovered = await discoverActionRegistry();
  const actions = discovered.map((action) => {
    const spec = ACTION_HARDENING_SPEC_BY_ACTION.get(action.actionType);
    if (!spec) throw new Error(`Missing hardening specification for ${action.actionType}`);
    const consequential = spec.profile !== "READ_ONLY" && spec.profile !== "META_NO_SIDE_EFFECT";
    return {
      name: action.actionType,
      universe: "DomainAction",
      owner: `packages/domain-plugins/${action.plugin}`,
      inputContract: {
        type: `${action.plugin}.payloadSchemas[${action.actionType}]`,
        path: action.schemaSourcePath?.replace(/^finnor-os\//, "") ?? action.sourcePath.replace(/^finnor-os\//, ""),
        line: action.schemaSourceLine ?? action.sourceLine,
      },
      outputContract: "ExecutionResult from packages/shared-types/src/index.ts",
      readWriteClass: spec.profile,
      businessEffectRelationship: action.actionType === "computer_task"
        ? "Conditional: WRITE compiles one BusinessEffect; READ_ONLY is explicitly nonconsequential."
        : consequential
          ? "Compiles exactly one immutable BusinessEffect before authority/approval/execution."
          : "Current nonconsequential action; no BusinessEffect is created.",
      authorityRelationship: `action:${action.actionType}; approval floor ${spec.approvalFloor}`,
      idempotencyBehavior: consequential
        ? "Authorized semantic effect id/hash -> durable command/workflow claim; scoped tools claim external_operations by action/tool operation key."
        : "Read/meta execution is not a consequential provider idempotency domain.",
      verificationBehavior: consequential
        ? "recordBusinessEffectOutcome applies the action's current canonical/provider observation contract before verified truth."
        : "ExecutionResult is retained; no mutation verification is fabricated.",
      providerBinding: spec.capabilityFamily,
      reconciliation: spec.external
        ? "Unknown or inconclusive delivery is reconciliation-required; blind consequential retry is prohibited."
        : "Canonical postcondition/precondition checks govern local ambiguity; no provider delivery is inferred.",
      compensation: spec.profile === "DURABLE_WORKFLOW"
        ? "Workflow step compensation is capability-specific and recorded as a new governed effect when supported."
        : "No action-level generic compensation is declared; reversibility is compiled per exact effect.",
      currentCallers: ["Planner.plan", "FinnorOrchestrator.draftKnownAction", "objective-loop/system action callers"],
      source: { path: action.sourcePath.replace(/^finnor-os\//, ""), line: action.sourceLine },
    };
  });

  const contractEntries = Object.entries(toolExports)
    .filter(([name, value]) => name.endsWith("Contract") && value && typeof value === "object" && "capability" in value)
    .sort(([left], [right]) => left.localeCompare(right));
  const capabilityContracts = [];
  for (const [exportName, rawContract] of contractEntries) {
    const contract = rawContract as RuntimeContract;
    const bindingNames = CONTRACT_BINDINGS[exportName];
    if (!bindingNames) throw new Error(`Missing audited binding map for ${exportName}`);
    const bindings = bindingNames.map((bindingExport) => {
      const binding = toolExports[bindingExport as keyof typeof toolExports] as RuntimeBinding | undefined;
      if (!binding) throw new Error(`Missing binding export ${bindingExport}`);
      return {
        export: bindingExport,
        provider: binding.name,
        reconciliation: typeof binding.reconcile === "function",
        compensation: typeof binding.compensate === "function",
      };
    });
    capabilityContracts.push({
      name: contract.capability,
      universe: "CapabilityContract",
      export: exportName,
      owner: `packages/tools/src/capabilities/${contract.domain}.ts`,
      inputContract: `${exportName} generic input schema plus idempotencyKeyFrom`,
      outputContract: `${exportName} generic output type through CapabilityResult`,
      readWriteClass: "CONSEQUENTIAL_WORKFLOW_OPERATION",
      businessEffectRelationship: "workflow_steps.business_effect_id binds the operation to the existing exact effect when the step is governed",
      authorityRelationship: contract.requiredPermission,
      idempotencyBehavior: `integration_operations composite operation key; retryOnUnknown=${contract.retryOnUnknown}`,
      verificationBehavior: "provider response is stored; awaitingObservation remains distinct from verified business state",
      providerBinding: bindings,
      reconciliation: contract.retryOnUnknown
        ? "Contract permits its declared retry policy; exhausted/ambiguous outcome still opens reconciliation."
        : "Potentially dispatched unknown outcome is never automatically retried and opens reconciliation.",
      compensation: bindings.some((binding) => binding.compensation)
        ? `Supported by: ${bindings.filter((binding) => binding.compensation).map((binding) => binding.provider).join(", ")}`
        : "No binding compensation procedure; attempts fail explicitly rather than silently succeeding.",
      currentCallers: ["workflow-runtime.executeCapability", "workflow handlers", "compensation resolver"],
      version: contract.version,
      retryPolicy: contract.retryPolicy,
      piiAllowlist: [...contract.piiAllowlist],
      source: await sourceLocation(exportName),
    });
  }

  const registry = createDefaultRegistry();
  const tools = registry.list().sort().map((name) => ({
    name,
    universe: "Tool",
    owner: "packages/tools/src/builtin-tools.ts plus tenant provider adapters",
    inputContract: "Tool.inputSchema (Zod), with tenant/runtime metadata injected outside planner input",
    outputContract: "ToolCallResult<Record<string, unknown>>",
    readWriteClass: ["get_ad_performance", "web_search", "firecrawl_scrape", "geocode_address", "distance_miles", "ghl_list_contacts"].includes(name) ? "READ_ONLY" : "PROVIDER_OR_EXTERNAL_WRITE",
    businessEffectRelationship: "Not an independent authority boundary; production mutation calls receive trusted ScopedToolRegistry BusinessEffect id/hash context.",
    authorityRelationship: "Inherited from the owning DomainAction/execution claim; the base unscoped registry is a compatibility/testing seam.",
    idempotencyBehavior: "ScopedToolRegistry claims external_operations using DomainAction plus deterministic tool operation key.",
    verificationBehavior: "Tool ACK/result is input to BusinessEffect observation; it is not independently promoted to verified canonical truth.",
    providerBinding: registry.integrationFor(name),
    reconciliation: "Unknown outcomes are recorded in external_operations and resolved before unsafe replay.",
    compensation: "No generic tool compensation contract; workflow CapabilityContracts own supported compensation.",
    currentCallers: ["domain plugin execute methods through ScopedToolRegistry"],
  }));

  const queries = OPERATIONAL_QUERY_INTENTS.map((intent) => ({
    name: intent,
    universe: "OperationalQuery",
    owner: "packages/shared-types/src/operational-queries.ts and packages/read-models/src/operational-queries.ts",
    inputContract: `${intent} request variant in OperationalQueryRequest`,
    outputContract: `${intent} result variant in OperationalQueryResult`,
    readWriteClass: "CANONICAL_READ_ONLY",
    businessEffectRelationship: "No BusinessEffect or DomainAction; the typed query plane is intentionally outside mutation machinery.",
    authorityRelationship: `query:${intent}`,
    idempotencyBehavior: "work_query_executions claims one Work/Input query execution and duplicate intake replays the stored result.",
    verificationBehavior: "source.kind=canonical_postgres and bounded query metadata are durably recorded.",
    providerBinding: "tenant-scoped canonical Postgres read model",
    reconciliation: "Query failure remains a typed Work failure; no provider mutation reconciliation applies.",
    compensation: "not applicable",
    currentCallers: ["FastReadOnlyRouter", "objective inspection", "operational query API"],
  }));

  const body = {
    schemaVersion: 1,
    baselineSha: BASELINE_SHA,
    previousBaselineSha: PREVIOUS_BASELINE_SHA,
    branch: P0_BRANCH,
    generatedFromCurrentCode: true,
    counts: {
      domainActions: actions.length,
      domainPlugins: new Set(discovered.map((row) => row.plugin)).size,
      operationalQueries: queries.length,
      capabilityContracts: capabilityContracts.length,
      defaultTools: tools.length,
      totalNamedCapabilities: actions.length + queries.length + capabilityContracts.length + tools.length,
    },
    universes: { domainActions: actions, operationalQueries: queries, capabilityContracts, defaultTools: tools },
    overlaps: [
      { names: ["launch_ad_campaign"], universes: ["DomainAction", "CapabilityContract", "Tool"], classification: "DUPLICATE", resolution: "Explicit bridges only; identities are not interchangeable." },
      { names: ["send_message"], universes: ["DomainAction", "CapabilityContract"], classification: "DUPLICATE", resolution: "DomainAction is user intent; CapabilityContract is a workflow provider operation." },
      { names: ["external_operations", "integration_operations"], universes: ["Tool", "CapabilityContract"], classification: "COMPATIBILITY", resolution: "Distinct current idempotency domains; do not normalize in P0." },
      { names: ["GatedExecutor", "AllowlistExecutor"], universes: ["legacy orchestration", "LangGraph"], classification: "COMPATIBILITY", resolution: "Both converge on the same runtime bridge/governed effect execution boundary." },
    ],
  };
  return { ...body, manifestHash: deterministicHash(body) };
}

export async function writeCapabilityInventory(): Promise<void> {
  const inventory = await buildCapabilityInventory();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
}

if (process.argv.includes("--write")) {
  void writeCapabilityInventory()
    .then(() => console.log(`Wrote ${relative(root, outputPath)}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
