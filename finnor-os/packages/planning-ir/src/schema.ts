import { z } from "zod";
import { PLANNING_IR_SCHEMA_VERSION } from "./types";

export const IrProvenanceSchema = z.object({
  source: z.enum(["instruction_planner", "objective_controller", "deterministic_fixture", "compatibility_adapter"]),
  sourceRef: z.string().min(1).max(500).optional(),
  instructionId: z.string().min(1).max(500).optional(),
  workId: z.string().min(1).max(500).optional(),
  objectiveStepId: z.string().min(1).max(500).optional(),
  plannerAttemptId: z.string().min(1).max(500).optional(),
  traceId: z.string().min(1).max(500).optional(),
  createdAt: z.string().datetime().optional(),
}).strict();

export const CanonicalEntityRefSchema = z.object({
  kind: z.enum(["party", "property", "asset", "work", "entity", "resource"]),
  entityType: z.string().trim().min(1).max(120),
  entityId: z.string().trim().min(1).max(500),
  field: z.string().trim().min(1).max(240).optional(),
  relationship: z.string().trim().min(1).max(120).optional(),
  provenance: z.string().trim().min(1).max(240).optional(),
}).strict();

export const IntentSpecSchema = z.object({
  requestedOutcome: z.string().trim().min(1).max(10_000),
  executionModel: z.enum(["ATOMIC_EFFECT", "OBJECTIVE"]),
  groundedEntities: z.array(CanonicalEntityRefSchema).max(500),
  scope: z.object({
    included: z.array(CanonicalEntityRefSchema).max(500),
    excluded: z.array(CanonicalEntityRefSchema).max(500),
    textExclusions: z.array(z.string().trim().min(1).max(1000)).max(100),
  }).strict(),
  unresolvedAmbiguity: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    candidates: z.array(CanonicalEntityRefSchema).max(100),
  }).strict()).max(100),
  provenance: IrProvenanceSchema,
}).strict();

const GoalSubjectSchema = z.union([
  CanonicalEntityRefSchema,
  z.object({ kind: z.literal("business_state"), key: z.string().trim().min(1).max(240) }).strict(),
]);

export const GoalSpecSchema = z.object({
  statement: z.string().trim().min(1).max(10_000),
  desiredState: z.array(z.object({
    subject: GoalSubjectSchema,
    path: z.array(z.union([z.string().max(240), z.number().int().nonnegative()])).max(40),
    operator: z.enum(["exists", "not_exists", "eq", "not_eq", "gte", "lte", "contains", "array_contains", "completed"]),
    expected: z.unknown().optional(),
  }).strict()).min(1).max(200),
  completionMode: z.literal("all"),
  objectiveCompatibility: z.literal("reuse_existing_objective_semantics"),
}).strict();

export const ConstraintSpecSchema = z.object({
  id: z.string().trim().min(1).max(240),
  strength: z.enum(["HARD", "SOFT"]),
  kind: z.enum(["entity_relationship", "temporal", "capability", "precondition", "user_restriction", "policy_authority", "cost_risk_exposure", "preference"]),
  description: z.string().trim().min(1).max(4000),
  status: z.enum(["satisfied", "violated", "unresolved"]),
  subjectRefs: z.array(CanonicalEntityRefSchema).max(100),
  values: z.record(z.unknown()),
}).strict();

export const ConstraintSetSchema = z.object({
  hard: z.array(ConstraintSpecSchema).max(500),
  soft: z.array(ConstraintSpecSchema).max(500),
}).strict().superRefine((value, context) => {
  value.hard.forEach((constraint, index) => {
    if (constraint.strength !== "HARD") context.addIssue({ code: z.ZodIssueCode.custom, path: ["hard", index, "strength"], message: "hard constraints must be explicitly HARD" });
  });
  value.soft.forEach((constraint, index) => {
    if (constraint.strength !== "SOFT") context.addIssue({ code: z.ZodIssueCode.custom, path: ["soft", index, "strength"], message: "soft constraints must be explicitly SOFT" });
  });
});

const PlanNodeBase = {
  id: z.string().trim().min(1).max(240),
  dependsOn: z.array(z.string().trim().min(1).max(240)).max(500),
  causalPrerequisites: z.array(z.string().trim().min(1).max(240)).max(500),
  requiredCapabilities: z.array(z.string().trim().min(1).max(240)).max(100),
};

export const PlanNodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...PlanNodeBase, kind: z.literal("query"), request: z.record(z.unknown()) }).strict(),
  z.object({ ...PlanNodeBase, kind: z.literal("observe"), observationId: z.string().trim().min(1).max(240) }).strict(),
  z.object({ ...PlanNodeBase, kind: z.literal("wait"), condition: z.string().trim().min(1).max(4000), deadlineAt: z.string().datetime().optional(), eventRef: z.record(z.unknown()).optional() }).strict(),
  z.object({ ...PlanNodeBase, kind: z.literal("effect"), effectId: z.string().trim().min(1).max(240) }).strict(),
]);

export const PlanGraphSchema = z.object({
  nodes: z.array(PlanNodeSchema).min(1).max(1000),
  completion: z.object({ mode: z.literal("all"), observationIds: z.array(z.string().trim().min(1).max(240)).min(1).max(500) }).strict(),
}).strict();

export const EffectSpecSchema = z.object({
  id: z.string().trim().min(1).max(240),
  actionType: z.string().trim().min(1).max(200),
  effectIntent: z.string().trim().min(1).max(4000),
  payload: z.record(z.unknown()),
  targetRefs: z.array(CanonicalEntityRefSchema).max(500),
  requiredCapability: z.string().trim().min(1).max(240),
  risk: z.enum(["low", "medium", "high"]),
  exposure: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().trim().regex(/^[A-Z]{3}$/) }).strict().nullable(),
  proposalOnly: z.literal(true),
}).strict();

export const ObservationSpecSchema = z.object({
  id: z.string().trim().min(1).max(240),
  effectId: z.string().trim().min(1).max(240).optional(),
  kind: z.enum(["canonical_state", "provider_delivery", "computer_state", "workflow_completion", "recorded_result", "canonical_query"]),
  predicate: z.record(z.unknown()),
  requiredEvidence: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
  acknowledgementSufficient: z.literal(false),
  verificationFloor: z.literal("at_least_existing"),
}).strict();

export const PlanningIrArtifactSchema = z.object({
  metadata: z.object({
    irSchemaVersion: z.literal(PLANNING_IR_SCHEMA_VERSION),
    compilerVersion: z.string().trim().min(1).max(120),
    provenance: IrProvenanceSchema,
    irSemanticHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  intent: IntentSpecSchema,
  goal: GoalSpecSchema,
  constraints: ConstraintSetSchema,
  plan: PlanGraphSchema,
  effects: z.array(EffectSpecSchema).max(500),
  observations: z.array(ObservationSpecSchema).min(1).max(500),
}).strict();
