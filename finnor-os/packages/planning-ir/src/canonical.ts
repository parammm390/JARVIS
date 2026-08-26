import { createHash } from "node:crypto";
import { PlanningIrArtifactSchema } from "./schema";
import { IR_HASH_NAMESPACE, PLANNING_IR_SCHEMA_VERSION, type PlanningIrArtifact, type PlanningIrInput } from "./types";

// Runtime metadata is ignored only when it is actually metadata.  Do not put
// business identifiers such as `workId` or `field` in this global set: those
// names are valid semantic payload/entity-reference fields.
const NON_SEMANTIC_RUNTIME_KEYS = new Set([
  "createdAt", "updatedAt", "compiledAt", "observedAt", "generatedAt", "timestamp",
  "traceId", "correlationId",
]);

function stripRuntimeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimeMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, nested]) => nested !== undefined && !NON_SEMANTIC_RUNTIME_KEYS.has(key))
    .map(([key, nested]) => [key, stripRuntimeMetadata(nested)]));
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

/** `field` and `provenance` describe where a reference came from, not which
 * canonical entity it names.  They are removed only for known entity-reference
 * values; a payload field with the same name remains semantic. */
function canonicalEntityRef(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { field: _field, provenance: _provenance, ...semantic } = value as Record<string, unknown>;
  return semantic;
}

function canonicalSubject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return (value as Record<string, unknown>).kind === "business_state" ? value : canonicalEntityRef(value);
}

function canonicalConstraint(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return {
    ...row,
    subjectRefs: Array.isArray(row.subjectRefs) ? row.subjectRefs.map(canonicalEntityRef) : row.subjectRefs,
    values: stripRuntimeMetadata(row.values),
  };
}

function canonicalEffect(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return {
    ...row,
    targetRefs: Array.isArray(row.targetRefs) ? row.targetRefs.map(canonicalEntityRef) : row.targetRefs,
    payload: stripRuntimeMetadata(row.payload),
  };
}

function semanticPayload(input: PlanningIrInput | PlanningIrArtifact): Record<string, unknown> {
  const effects = new Map(input.effects.map((effect) => {
    const base = stripRuntimeMetadata(canonicalEffect(without(effect as unknown as Record<string, unknown>, ["id"])));
    return [effect.id, { label: digest({ namespace: "effect", base }), base }] as const;
  }));
  const observations = new Map(input.observations.map((observation) => {
    const effectLabel = observation.effectId ? effects.get(observation.effectId)?.label ?? "missing_effect" : null;
    const base = stripRuntimeMetadata({ ...without(observation as unknown as Record<string, unknown>, ["id", "effectId"]), effect: effectLabel });
    return [observation.id, { label: digest({ namespace: "observation", base }), base }] as const;
  }));
  const nodeBase = new Map(input.plan.nodes.map((node) => {
    const specific = node.kind === "effect" ? { effect: effects.get(node.effectId)?.label ?? "missing_effect" }
      : node.kind === "observe" ? { observation: observations.get(node.observationId)?.label ?? "missing_observation" }
        : node.kind === "query" ? { request: stripRuntimeMetadata(node.request) }
          : { condition: node.condition, deadlineAt: node.deadlineAt, eventRef: stripRuntimeMetadata(node.eventRef) };
    return [node.id, stripRuntimeMetadata({ kind: node.kind, requiredCapabilities: [...node.requiredCapabilities].sort(), ...specific })] as const;
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
  return {
    intent: {
      requestedOutcome: input.intent.requestedOutcome,
      executionModel: input.intent.executionModel,
      groundedEntities: sorted((input.intent.groundedEntities ?? []).map(canonicalEntityRef)),
      scope: {
        included: sorted(input.intent.scope.included.map(canonicalEntityRef)),
        excluded: sorted(input.intent.scope.excluded.map(canonicalEntityRef)),
        textExclusions: [...input.intent.scope.textExclusions].sort(),
      },
      unresolvedAmbiguity: sorted(input.intent.unresolvedAmbiguity.map((ambiguity) => ({
        code: ambiguity.code,
        description: ambiguity.description,
        candidates: sorted(ambiguity.candidates.map(canonicalEntityRef)),
      }))),
    },
    goal: {
      statement: input.goal.statement,
      desiredState: sorted(input.goal.desiredState.map((predicate) => ({
        subject: canonicalSubject(predicate.subject),
        path: predicate.path,
        operator: predicate.operator,
        ...(predicate.expected === undefined ? {} : { expected: predicate.expected }),
      }))),
      completionMode: input.goal.completionMode,
      objectiveCompatibility: input.goal.objectiveCompatibility,
    },
    constraints: {
      hard: sorted(input.constraints.hard.map(canonicalConstraint)),
      soft: sorted(input.constraints.soft.map(canonicalConstraint)),
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
