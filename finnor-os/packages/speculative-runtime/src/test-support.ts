import type { OperationalProgram } from "@finnor/operational-ir";
import {
  createInMemoryWorldSnapshotSource,
  materializeWorldSnapshot,
} from "./snapshot";
import type {
  SimulateOperationalProgramInput,
  SimulationBounds,
  WorldSnapshot,
  WorldStateInput,
  WorldVariable,
  WorldVariableOutcome,
} from "./contracts";

export const P5_TEST_TENANT = "10000000-0000-4000-8000-000000000001";
export const P5_TEST_NOW = "2026-09-01T00:00:00.000Z";
export const P5_TEST_P4_HASH = `p4:program:sha256:${"5".repeat(64)}` as `p4:program:sha256:${string}`;

export const DEFAULT_SIMULATION_BOUNDS: SimulationBounds = Object.freeze({
  maxBranches: 32,
  maxDepth: 24,
  maxEffects: 128,
  maxSimulationSteps: 512,
  maxSimulationMs: 10_000,
  maxMemory: 8 * 1024 * 1024,
});

function initialValues(type: string): WorldStateInput["values"] {
  if (type === "invoice") return { status: "open", amount: 125, currency: "USD" };
  if (type === "household") return {
    status: "active",
    communications: { requiredMessage: { received: false } },
    tasks: { confirmationFollowup: { exists: false } },
    marketing: { campaign: { launched: false } },
  };
  return { status: "open" };
}

export async function snapshotForProgram(input: {
  program: OperationalProgram;
  tenantId?: string;
  variables?: WorldVariable[];
  observations?: Parameters<typeof createInMemoryWorldSnapshotSource>[0]["relevantObservations"];
  stateOverrides?: Record<string, WorldStateInput["values"]>;
}): Promise<WorldSnapshot> {
  const tenantId = input.tenantId ?? P5_TEST_TENANT;
  const canonicalState: WorldStateInput[] = input.program.entities.flatMap((entity) => entity.resolution.status === "resolved" ? [{
    tenantId,
    ref: {
      kind: entity.resolution.canonical.kind,
      type: entity.resolution.canonical.type,
      id: entity.resolution.canonical.id,
    },
    values: structuredClone(input.stateOverrides?.[entity.resolution.canonical.id] ?? initialValues(entity.resolution.canonical.type)),
    observedAt: P5_TEST_NOW,
    sourceVersion: "fixture:v1",
    provenance: { owner: "fixture:canonical-owner", sourceRef: `fixture:${entity.resolution.canonical.type}:${entity.resolution.canonical.id}`, evidenceRefs: [] },
  }] : []);
  const epistemicInputs = (input.variables ?? []).map((variable) => ({
    propositionId: variable.sourcePropositionId,
    status: "UNCERTAIN" as const,
    value: variable.possibleOutcomes.map((outcome) => outcome.value),
    confidenceQuality: variable.confidenceQuality,
    evidenceRefs: variable.evidence,
    provenanceComplete: true,
  }));
  const source = createInMemoryWorldSnapshotSource({
    tenantId,
    canonicalState,
    workState: [],
    relevantObservations: input.observations ?? [],
    epistemicInputs,
    sourceRefs: canonicalState.map((record) => record.provenance.sourceRef),
  });
  return materializeWorldSnapshot({ tenantId, asOf: P5_TEST_NOW, program: input.program, source });
}

export function effectWorldVariable(input: {
  effectRef: string;
  outcomes: WorldVariableOutcome[];
  tenantId?: string;
  id?: string;
}): WorldVariable {
  const propositionId = `p3:effect-outcome:${input.effectRef}`;
  return {
    id: input.id ?? `world-variable:${input.effectRef}`,
    tenantId: input.tenantId ?? P5_TEST_TENANT,
    sourcePropositionId: propositionId,
    binding: { kind: "EFFECT_OUTCOME", effectRef: input.effectRef },
    possibleOutcomes: input.outcomes,
    evidence: [propositionId],
    confidenceQuality: "LOW",
    provenance: { owner: "P3", propositionId, evidenceRefs: [propositionId], asOf: P5_TEST_NOW },
  };
}

export function outcome(
  outcomeId: string,
  operationalStatus: WorldVariableOutcome["operationalStatus"],
  options: Partial<Omit<WorldVariableOutcome, "outcomeId" | "operationalStatus">> = {},
): WorldVariableOutcome {
  return {
    outcomeId,
    value: options.value ?? operationalStatus,
    operationalStatus,
    risk: options.risk ?? (operationalStatus === "SUCCESS" ? "LOW" : "HIGH"),
    likelihood: options.likelihood ?? { kind: "UNRANKED" },
    evidenceRefs: options.evidenceRefs ?? [`fixture:${outcomeId}`],
    ...(options.recovery ? { recovery: options.recovery } : {}),
  };
}

export function simulationInput(input: {
  program: OperationalProgram;
  snapshot: WorldSnapshot;
  variables?: WorldVariable[];
  bounds?: Partial<SimulationBounds>;
  p2Status?: SimulateOperationalProgramInput["gates"]["p2Status"];
  p3Status?: SimulateOperationalProgramInput["gates"]["p3Status"];
}): SimulateOperationalProgramInput {
  return {
    snapshot: input.snapshot,
    program: input.program,
    worldVariables: input.variables ?? [],
    bounds: { ...DEFAULT_SIMULATION_BOUNDS, ...input.bounds },
    gates: {
      p2Status: input.p2Status ?? "ADMISSIBLE",
      p3Status: input.p3Status ?? "RESOLVED",
      p4CandidateHash: P5_TEST_P4_HASH,
      p4SelectionAuthority: "P4",
    },
  };
}
