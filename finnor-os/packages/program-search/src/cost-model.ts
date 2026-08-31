import {
  analyzeProgramGraph,
  type OperationalProgram,
  type ProgramEffectSummary,
  type ProgramNode,
} from "@finnor/operational-ir";
import {
  PROGRAM_SEARCH_COST_MODEL_VERSION,
  PROGRAM_SEARCH_SUCCESS_MODEL_VERSION,
  type CandidateOrigin,
  type NumericEstimate,
  type ProgramCostEstimate,
  type SearchCapability,
  type SuccessEstimate,
} from "./contracts";

type CostKey = keyof ProgramCostEstimate;

const DEFAULTS: Record<CostKey, { unit: string; fallback: number }> = {
  modelCalls: { unit: "calls", fallback: 1 },
  tokens: { unit: "tokens", fallback: 2_000 },
  providerCalls: { unit: "calls", fallback: 1 },
  financialSpend: { unit: "currency_units", fallback: 100 },
  expectedLatencyMs: { unit: "ms", fallback: 30_000 },
  humanInterruptions: { unit: "interruptions", fallback: 1 },
  computerUseMs: { unit: "ms", fallback: 60_000 },
  failureRecoveryBurden: { unit: "ordinal_units", fallback: 10 },
};

function estimate(
  key: CostKey,
  value: number | null,
  input: Partial<NumericEstimate> = {},
  source = "p4 conservative fallback",
): NumericEstimate {
  const defaults = DEFAULTS[key];
  return {
    value,
    unit: input.unit ?? defaults.unit,
    source: input.source ?? source,
    version: input.version ?? PROGRAM_SEARCH_COST_MODEL_VERSION,
    quality: input.quality ?? (value === null ? "UNKNOWN" : "CONSERVATIVE_HEURISTIC"),
    confidence: input.confidence ?? (value === null ? "UNKNOWN" : "LOW"),
    fallbackAssumption: input.fallbackAssumption ?? {
      value: defaults.fallback,
      rationale: `Unknown ${key} is conservatively scored as ${defaults.fallback} ${defaults.unit}; it is never zero-filled.`,
    },
  };
}

function fromProfile(key: CostKey, profile: SearchCapability["cost"][CostKey], capability: string): NumericEstimate {
  if (!profile) return estimate(key, null, {}, `capability:${capability}:missing`);
  return estimate(key, profile.value, profile, `capability:${capability}`);
}

function combine(key: CostKey, values: NumericEstimate[]): NumericEstimate {
  if (values.length === 0) return estimate(key, 0, {
    source: "program contains no applicable executable capability",
    quality: "CONFIGURED",
    confidence: "HIGH",
    fallbackAssumption: { value: 0, rationale: "No executable capability contributes this cost." },
  });
  const unknown = values.some((value) => value.value === null);
  const knownTotal = values.reduce((total, value) => total + (value.value ?? 0), 0);
  const fallbackTotal = values.reduce((total, value) => total + (value.value ?? value.fallbackAssumption.value), 0);
  const qualities = new Set(values.map((value) => value.quality));
  return estimate(key, unknown ? null : knownTotal, {
    unit: values[0]!.unit,
    source: [...new Set(values.map((value) => value.source))].sort().join(" + "),
    version: PROGRAM_SEARCH_COST_MODEL_VERSION,
    quality: unknown ? "UNKNOWN" : qualities.size === 1 ? values[0]!.quality : "CONSERVATIVE_HEURISTIC",
    confidence: unknown ? "UNKNOWN" : values.every((value) => value.confidence === "HIGH") ? "HIGH" : "LOW",
    fallbackAssumption: {
      value: fallbackTotal,
      rationale: unknown
        ? "Sum uses explicit conservative assumptions for unknown components."
        : "Exact sum of the contributing estimates.",
    },
  });
}

function combineMaximum(key: CostKey, values: NumericEstimate[]): NumericEstimate {
  if (values.length === 0) return combine(key, values);
  const unknown = values.some((value) => value.value === null);
  const knownMaximum = Math.max(...values.map((value) => value.value ?? Number.NEGATIVE_INFINITY));
  const fallbackMaximum = Math.max(...values.map((value) => value.value ?? value.fallbackAssumption.value));
  return estimate(key, unknown ? null : knownMaximum, {
    unit: values[0]!.unit,
    source: [...new Set(values.map((value) => value.source))].sort().join(" max "),
    version: PROGRAM_SEARCH_COST_MODEL_VERSION,
    quality: unknown ? "UNKNOWN" : "CONSERVATIVE_HEURISTIC",
    confidence: unknown ? "UNKNOWN" : values.every((value) => value.confidence === "HIGH") ? "HIGH" : "LOW",
    fallbackAssumption: {
      value: fallbackMaximum,
      rationale: unknown
        ? "Parallel/alternative latency uses the maximum explicit conservative assumption."
        : "Parallel/alternative latency uses the maximum contributing estimate.",
    },
  });
}

function requiredCapabilities(program: OperationalProgram): string[] {
  const graph = analyzeProgramGraph(program.body);
  return [...graph.nodes.values()].flatMap((entry) => {
    if (entry.node.kind === "effect") return [entry.node.requiredCapability];
    if (entry.node.kind === "query") return [`query:${entry.node.request.intent}`];
    return [];
  });
}

export function effectiveEstimate(value: NumericEstimate): number {
  return value.value ?? value.fallbackAssumption.value;
}

export function unknownProgramCost(source = "program unavailable before structural validation"): ProgramCostEstimate {
  const result = {} as ProgramCostEstimate;
  for (const key of Object.keys(DEFAULTS) as CostKey[]) result[key] = estimate(key, null, {}, source);
  return result;
}

function latencyForNode(
  node: ProgramNode,
  capabilityMap: ReadonlyMap<string, SearchCapability>,
): NumericEstimate {
  if (node.kind === "effect") {
    const profile = capabilityMap.get(node.requiredCapability);
    return profile
      ? fromProfile("expectedLatencyMs", profile.cost.expectedLatencyMs, node.requiredCapability)
      : estimate("expectedLatencyMs", null, {}, `capability:${node.requiredCapability}:unknown`);
  }
  if (node.kind === "query") {
    const capability = `query:${node.request.intent}`;
    const profile = capabilityMap.get(capability);
    return profile
      ? fromProfile("expectedLatencyMs", profile.cost.expectedLatencyMs, capability)
      : estimate("expectedLatencyMs", null, {}, `capability:${capability}:unknown`);
  }
  if (node.kind === "sequence") return combine("expectedLatencyMs", node.steps.map((child) => latencyForNode(child, capabilityMap)));
  if (node.kind === "parallel") return combineMaximum("expectedLatencyMs", node.branches.map((child) => latencyForNode(child, capabilityMap)));
  if (node.kind === "branch") {
    const outcomes = [...node.cases.map((entry) => latencyForNode(entry.then, capabilityMap)), ...(node.otherwise ? [latencyForNode(node.otherwise, capabilityMap)] : [])];
    return combineMaximum("expectedLatencyMs", outcomes);
  }
  // Wait and compensation are conditional/runtime-controlled. Their direct time is
  // represented by computer-use and recovery-burden estimates, not zero-filled
  // into provider latency.
  return combine("expectedLatencyMs", []);
}

export function estimateProgramCost(input: {
  program: OperationalProgram;
  capabilities: readonly SearchCapability[];
  origin: CandidateOrigin;
  overrides?: Partial<ProgramCostEstimate>;
}): ProgramCostEstimate {
  const capabilityMap = new Map(input.capabilities.map((capability) => [capability.capability, capability]));
  const capabilities = requiredCapabilities(input.program);
  const result = {} as ProgramCostEstimate;
  for (const key of Object.keys(DEFAULTS) as CostKey[]) {
    const parts = capabilities.map((capability) => {
      const profile = capabilityMap.get(capability);
      return profile ? fromProfile(key, profile.cost[key], capability) : estimate(key, null, {}, `capability:${capability}:unknown`);
    });
    // Candidate generation cost is explicit for model-origin candidates. It is a
    // sunk search cost, but retaining it makes the receipt complete.
    if (key === "modelCalls" && input.origin === "MODEL_CANDIDATE") {
      parts.push(estimate(key, 1, {
        source: "candidate origin",
        quality: "CONFIGURED",
        confidence: "HIGH",
        fallbackAssumption: { value: 1, rationale: "MODEL_CANDIDATE records one originating model call." },
      }));
    }
    result[key] = input.overrides?.[key] ?? combine(key, parts);
  }
  result.expectedLatencyMs = input.overrides?.expectedLatencyMs
    ?? latencyForNode(input.program.body, capabilityMap);
  return result;
}

export function estimateProgramSuccess(input: {
  program: OperationalProgram;
  capabilities: readonly SearchCapability[];
  summary?: ProgramEffectSummary;
  override?: SuccessEstimate;
}): SuccessEstimate {
  if (input.override) return input.override;
  const capabilityMap = new Map(input.capabilities.map((capability) => [capability.capability, capability]));
  const estimates = requiredCapabilities(input.program).map((capability) => capabilityMap.get(capability)?.success);
  const known = estimates.filter((value): value is SuccessEstimate => Boolean(value));
  const ordinals = known.map((value) => value.ordinal ?? value.fallbackAssumption.ordinal);
  const conflictPenalty = (input.summary?.conflicts.length ?? 0) * 200;
  if (known.length === 0 || known.length !== estimates.length) {
    return {
      ordinal: null,
      source: "missing capability outcome evidence",
      version: PROGRAM_SEARCH_SUCCESS_MODEL_VERSION,
      quality: "UNKNOWN",
      confidence: "UNKNOWN",
      calibratedProbability: false,
      fallbackAssumption: {
        ordinal: Math.max(0, Math.min(ordinals.length ? Math.min(...ordinals) : 300, 300) - conflictPenalty),
        rationale: "Unknown success remains an explicit conservative ordinal, not a probability or zero.",
      },
    };
  }
  return {
    ordinal: Math.max(0, Math.min(...ordinals) - conflictPenalty),
    source: [...new Set(known.map((value) => value.source))].sort().join(" + "),
    version: PROGRAM_SEARCH_SUCCESS_MODEL_VERSION,
    quality: known.every((value) => value.quality === "EMPIRICAL") ? "EMPIRICAL" : "CONSERVATIVE_HEURISTIC",
    confidence: known.every((value) => value.confidence === "HIGH") ? "HIGH" : "LOW",
    calibratedProbability: false,
    fallbackAssumption: {
      ordinal: Math.max(0, Math.min(...ordinals) - conflictPenalty),
      rationale: "Worst contributing capability ordinal is used conservatively.",
    },
  };
}
