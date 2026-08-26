import { createHash } from "node:crypto";
import { PlanningIrArtifactSchema } from "./schema";
import { IR_HASH_NAMESPACE, PLANNING_IR_SCHEMA_VERSION, type PlanningIrArtifact, type PlanningIrInput } from "./types";

const NON_SEMANTIC_KEYS = new Set([
  "createdAt", "updatedAt", "compiledAt", "observedAt", "generatedAt", "timestamp",
  "traceId", "correlationId", "instructionId", "workId", "objectiveStepId", "plannerAttemptId",
  "provenance", "field",
]);

function stripNonSemantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNonSemantic);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, nested]) => nested !== undefined && !NON_SEMANTIC_KEYS.has(key))
    .map(([key, nested]) => [key, stripNonSemantic(nested)]));
}

export function canonicalSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalSerialize(nested)}`).join(",")}}`;
}

const digest = (value: unknown) => createHash("sha256").update(canonicalSerialize(value)).digest("hex");
const sorted = <T>(values: T[]) => [...values].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));

function without<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

function semanticPayload(input: PlanningIrInput | PlanningIrArtifact): Record<string, unknown> {
  const effects = new Map(input.effects.map((effect) => {
    const base = stripNonSemantic(without(effect as unknown as Record<string, unknown>, ["id"]));
    return [effect.id, { label: digest({ namespace: "effect", base }), base }] as const;
  }));
  const observations = new Map(input.observations.map((observation) => {
    const effectLabel = observation.effectId ? effects.get(observation.effectId)?.label ?? "missing_effect" : null;
    const base = stripNonSemantic({ ...without(observation as unknown as Record<string, unknown>, ["id", "effectId"]), effect: effectLabel });
    return [observation.id, { label: digest({ namespace: "observation", base }), base }] as const;
  }));
  const nodeBase = new Map(input.plan.nodes.map((node) => {
    const specific = node.kind === "effect" ? { effect: effects.get(node.effectId)?.label ?? "missing_effect" }
      : node.kind === "observe" ? { observation: observations.get(node.observationId)?.label ?? "missing_observation" }
        : node.kind === "query" ? { request: stripNonSemantic(node.request) }
          : { condition: node.condition, deadlineAt: node.deadlineAt, eventRef: stripNonSemantic(node.eventRef) };
    return [node.id, stripNonSemantic({ kind: node.kind, requiredCapabilities: [...node.requiredCapabilities].sort(), ...specific })] as const;
  }));
  let labels = new Map([...nodeBase].map(([id, base]) => [id, digest({ namespace: "node", base })]));
  for (let round = 0; round <= input.plan.nodes.length; round += 1) {
    labels = new Map(input.plan.nodes.map((node) => [node.id, digest({
      namespace: "node",
      base: nodeBase.get(node.id),
      dependsOn: node.dependsOn.map((id) => labels.get(id) ?? "missing_node").sort(),
      causalPrerequisites: node.causalPrerequisites.map((id) => labels.get(id) ?? "missing_node").sort(),
    })]));
  }
  const graph = sorted(input.plan.nodes.map((node) => ({
    label: labels.get(node.id),
    base: nodeBase.get(node.id),
    dependsOn: node.dependsOn.map((id) => labels.get(id) ?? "missing_node").sort(),
    causalPrerequisites: node.causalPrerequisites.map((id) => labels.get(id) ?? "missing_node").sort(),
  })));
  const intent = stripNonSemantic(input.intent) as typeof input.intent;
  return {
    intent: {
      ...intent,
      groundedEntities: sorted(intent.groundedEntities ?? []),
      scope: {
        included: sorted(intent.scope.included),
        excluded: sorted(intent.scope.excluded),
        textExclusions: [...intent.scope.textExclusions].sort(),
      },
      unresolvedAmbiguity: sorted(intent.unresolvedAmbiguity.map((ambiguity) => ({ ...ambiguity, candidates: sorted(ambiguity.candidates) }))),
    },
    goal: { ...stripNonSemantic(input.goal) as Record<string, unknown>, desiredState: sorted(input.goal.desiredState.map(stripNonSemantic)) },
    constraints: {
      hard: sorted(input.constraints.hard.map(stripNonSemantic)),
      soft: sorted(input.constraints.soft.map(stripNonSemantic)),
    },
    plan: {
      nodes: graph,
      completion: { mode: input.plan.completion.mode, observationLabels: input.plan.completion.observationIds.map((id) => observations.get(id)?.label ?? "missing_observation").sort() },
    },
    effects: sorted([...effects.values()].map(({ base }) => base)),
    observations: sorted([...observations.values()].map(({ base }) => base)),
  };
}

export function canonicalSerializePlanningIr(input: PlanningIrInput | PlanningIrArtifact): string {
  return canonicalSerialize(semanticPayload(input));
}

export function computeIrSemanticHash(input: PlanningIrInput | PlanningIrArtifact): string {
  return createHash("sha256").update(`${IR_HASH_NAMESPACE}\0${canonicalSerializePlanningIr(input)}`).digest("hex");
}

export function createPlanningIrArtifact(input: PlanningIrInput, options: { compilerVersion: string; provenance: PlanningIrArtifact["metadata"]["provenance"] }): PlanningIrArtifact {
  const artifact: PlanningIrArtifact = {
    ...input,
    metadata: {
      irSchemaVersion: PLANNING_IR_SCHEMA_VERSION,
      compilerVersion: options.compilerVersion,
      provenance: options.provenance,
      irSemanticHash: computeIrSemanticHash(input),
    },
  };
  return PlanningIrArtifactSchema.parse(artifact) as PlanningIrArtifact;
}

export function parsePlanningIrArtifact(value: unknown): PlanningIrArtifact {
  const artifact = PlanningIrArtifactSchema.parse(value) as PlanningIrArtifact;
  const actual = computeIrSemanticHash(artifact);
  if (artifact.metadata.irSemanticHash !== actual) throw new Error("Planning IR semantic hash does not match its canonical semantics");
  return artifact;
}
