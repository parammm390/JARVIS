import { z } from "zod";
import type { ObjectiveSuccessCondition, OperationalQueryRequest } from "@finnor/shared-types";
import {
  IR_HASH_PREFIX,
  IR_SCHEMA_VERSION,
  type Budget,
  type Constraint,
  type Effect,
  type EntityRef,
  type Goal,
  type JsonObject,
  type JsonValue,
  type Observation,
  type OperationalProgram,
  type OperationalProgramDraft,
  type Predicate,
  type ProgramNode,
  type ProgramScope,
  type Provenance,
  type Query,
  type SuccessCondition,
} from "./contracts";

const DateTimeSchema = z.string().datetime({ offset: true });
const SemanticIdSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9._:-]*$/i);
const NonEmptyString = z.string().trim().min(1);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(JsonValueSchema);

const PredicateSubjectSchema = z.object({
  kind: z.enum(["program", "entity", "query", "effect", "observation"]),
  ref: SemanticIdSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === "program" && value.ref !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ref"], message: "program predicate subjects cannot carry a ref" });
  }
  if (value.kind !== "program" && !value.ref) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ref"], message: `${value.kind} predicate subjects require a ref` });
  }
});

const PredicateOperatorSchema = z.enum(["exists", "not_exists", "eq", "not_eq", "gte", "lte", "contains", "array_contains"]);

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.object({
    kind: z.literal("assertion"),
    subject: PredicateSubjectSchema,
    path: z.array(z.union([z.string().min(1).max(120), z.number().int().nonnegative()])).max(24),
    operator: PredicateOperatorSchema,
    expected: JsonValueSchema.optional(),
  }).strict().superRefine((value, context) => {
    const takesNoExpected = value.operator === "exists" || value.operator === "not_exists";
    if (!takesNoExpected && value.expected === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["expected"], message: `${value.operator} requires an expected value` });
    }
    if (takesNoExpected && value.expected !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["expected"], message: `${value.operator} cannot carry an expected value` });
    }
    if ((value.operator === "gte" || value.operator === "lte") && typeof value.expected !== "number") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["expected"], message: `${value.operator} requires a numeric expected value` });
    }
    if (value.operator === "contains" && typeof value.expected !== "string") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["expected"], message: "contains requires a string expected value" });
    }
  }),
  z.object({
    kind: z.enum(["all", "any"]),
    predicates: z.array(PredicateSchema).min(1).max(100),
  }).strict(),
  z.object({ kind: z.literal("not"), predicate: PredicateSchema }).strict(),
]));

export const GoalSchema: z.ZodType<Goal> = z.object({
  kind: z.literal("goal"),
  semanticId: SemanticIdSchema,
  statement: NonEmptyString.max(10_000),
  predicate: PredicateSchema,
  subjectRefs: z.array(SemanticIdSchema).max(100),
}).strict();

export const ConstraintSchema: z.ZodType<Constraint> = z.object({
  kind: z.literal("constraint"),
  semanticId: SemanticIdSchema,
  severity: z.enum(["HARD", "SOFT"]),
  category: z.enum(["entity", "relationship", "temporal", "capability", "user_restriction", "cost", "risk_exposure", "dependency", "completion_requirement"]),
  description: NonEmptyString.max(4_000),
  predicate: PredicateSchema,
  evaluation: z.enum(["UNKNOWN", "SATISFIED", "VIOLATED"]),
  entityRefs: z.array(SemanticIdSchema).max(100),
}).strict();

const CanonicalEntityIdentitySchema = z.object({
  kind: z.enum(["entity", "party", "resource"]),
  type: NonEmptyString.max(120),
  id: NonEmptyString.max(500),
}).strict();

export const EntityRefSchema: z.ZodType<EntityRef> = z.object({
  kind: z.literal("entity_ref"),
  semanticId: SemanticIdSchema,
  entityType: NonEmptyString.max(120),
  resolution: z.discriminatedUnion("status", [
    z.object({ status: z.literal("resolved"), canonical: CanonicalEntityIdentitySchema, source: z.literal("canonical") }).strict(),
    z.object({ status: z.literal("unresolved"), expression: NonEmptyString.max(2_000), reason: NonEmptyString.max(2_000) }).strict(),
    z.object({
      status: z.literal("ambiguous"),
      expression: NonEmptyString.max(2_000),
      candidates: z.array(CanonicalEntityIdentitySchema).min(2).max(100),
      reason: NonEmptyString.max(2_000),
    }).strict(),
  ]),
}).strict();

/** The query plane owns detailed request validation. IR verifies a deterministic,
 * tenant-less JSON request with a named intent and preserves it byte-semantically. */
export const OperationalQueryRequestSchema: z.ZodType<OperationalQueryRequest> = z.object({
  intent: NonEmptyString.max(120),
}).catchall(JsonValueSchema) as z.ZodType<OperationalQueryRequest>;

export const QuerySchema: z.ZodType<Query> = z.object({
  kind: z.literal("query"),
  semanticId: SemanticIdSchema,
  request: OperationalQueryRequestSchema,
  purpose: NonEmptyString.max(4_000),
  entityRefs: z.array(SemanticIdSchema).max(100),
  dependsOn: z.array(SemanticIdSchema).max(100),
}).strict();

const ExistingCommandGraphSchema = z.object({
  kind: z.enum(["workflow", "single_action"]),
  commandType: NonEmptyString.max(200),
  requiresConfirmation: z.boolean(),
  autoApprove: z.boolean(),
}).strict();

export const EffectSchema: z.ZodType<Effect> = z.object({
  kind: z.literal("effect"),
  semanticId: SemanticIdSchema,
  operation: NonEmptyString.max(200),
  arguments: JsonObjectSchema,
  targets: z.array(z.object({
    entityRef: SemanticIdSchema,
    payloadPath: NonEmptyString.max(500),
  }).strict()).max(100),
  intendedState: PredicateSchema,
  requiredCapability: NonEmptyString.max(300),
  consequential: z.boolean(),
  expectedObservationRefs: z.array(SemanticIdSchema).min(1).max(100),
  dependsOn: z.array(SemanticIdSchema).max(100),
  domainActionCompatibility: z.object({
    compiledGraph: ExistingCommandGraphSchema,
    groundedPayload: z.array(z.object({
      field: NonEmptyString.max(500),
      status: z.enum(["verified", "not_found", "unverifiable"]),
    }).strict()).nullable().optional(),
  }).strict().optional(),
}).strict();

const AssertionPathSchema = z.array(z.union([z.string().min(1).max(120), z.number().int().nonnegative()])).max(24);
const ObjectiveAssertionSchema = z.object({
  path: AssertionPathSchema,
  operator: PredicateOperatorSchema,
  expected: JsonValueSchema.optional(),
}).strict();
const ObjectiveQueryEvidenceSchema = z.object({
  kind: z.literal("canonical_query"),
  request: OperationalQueryRequestSchema,
  assertion: ObjectiveAssertionSchema,
}).strict();
const ObjectiveCriterionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_open_execution") }).strict(),
  z.object({ kind: z.literal("all_objective_effects_verified"), minimumCount: z.number().int().min(0).max(25) }).strict(),
  ObjectiveQueryEvidenceSchema,
  z.object({ kind: z.literal("matched_wait"), minimumCount: z.number().int().min(1).max(25), eventType: NonEmptyString.max(200).optional() }).strict(),
  z.object({ kind: z.literal("delegation_state"), minimumCount: z.number().int().min(1).max(25), requiredStatus: z.enum(["acknowledged", "accepted", "completed"]) }).strict(),
  z.object({ kind: z.literal("computer_run_state"), minimumCount: z.number().int().min(1).max(25), requiredStatus: z.literal("succeeded"), evidenceRequired: z.boolean() }).strict(),
  z.object({
    kind: z.literal("decision_evidence"),
    minimumCount: z.number().int().min(1).max(25),
    accepted: z.array(z.enum(["canonical_query", "business_effect", "matched_event", "delegation", "computer_run"])).min(1).max(5),
  }).strict(),
  z.object({ kind: z.literal("manual_verification"), reason: NonEmptyString.max(2_000) }).strict(),
]);

export const ExistingObjectiveSuccessConditionSchema: z.ZodType<ObjectiveSuccessCondition> = z.object({
  version: z.literal(1),
  statement: NonEmptyString.max(10_000),
  mode: z.literal("all"),
  source: z.enum(["explicit", "objective_first_policy", "legacy_backfill"]),
  criteria: z.array(ObjectiveCriterionSchema).min(1).max(20),
}).strict() as z.ZodType<ObjectiveSuccessCondition>;

const ObservationEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canonical_query"), queryRef: SemanticIdSchema, assertion: PredicateSchema }).strict(),
  z.object({ kind: z.literal("canonical_state"), entityRef: SemanticIdSchema, assertion: PredicateSchema }).strict(),
  z.object({ kind: z.literal("effect_verification"), effectRef: SemanticIdSchema, minimumState: z.literal("verified") }).strict(),
  z.object({ kind: z.literal("objective_success"), condition: ExistingObjectiveSuccessConditionSchema }).strict(),
  z.object({ kind: z.literal("matched_event"), eventType: NonEmptyString.max(200), subjectRefs: z.array(SemanticIdSchema).max(100) }).strict(),
  z.object({ kind: z.literal("delegation_state"), entityRef: SemanticIdSchema, requiredStatus: z.enum(["acknowledged", "accepted", "completed"]) }).strict(),
  z.object({ kind: z.literal("computer_state"), effectRef: SemanticIdSchema, evidenceRequired: z.literal(true) }).strict(),
  z.object({ kind: z.literal("workflow_completion"), effectRef: SemanticIdSchema }).strict(),
  z.object({ kind: z.literal("recorded_result"), effectRef: SemanticIdSchema }).strict(),
]);

export const ObservationSchema: z.ZodType<Observation> = z.object({
  kind: z.literal("observation"),
  semanticId: SemanticIdSchema,
  subject: z.object({ kind: z.enum(["goal", "effect"]), ref: SemanticIdSchema }).strict(),
  description: NonEmptyString.max(4_000),
  strength: z.enum(["REQUIRED", "SUPPLEMENTAL"]),
  verificationFloor: z.literal("EXISTING_OR_STRONGER"),
  evidence: ObservationEvidenceSchema,
}).strict();

export const ProgramNodeSchema: z.ZodType<ProgramNode> = z.lazy(() => z.union([
  QuerySchema,
  EffectSchema,
  z.object({
    kind: z.literal("sequence"),
    semanticId: SemanticIdSchema,
    steps: z.array(ProgramNodeSchema).min(1).max(200),
  }).strict(),
  z.object({
    kind: z.literal("parallel"),
    semanticId: SemanticIdSchema,
    branches: z.array(ProgramNodeSchema).min(2).max(100),
  }).strict(),
  z.object({
    kind: z.literal("branch"),
    semanticId: SemanticIdSchema,
    evaluation: z.literal("FIRST_MATCH"),
    cases: z.array(z.object({ caseId: SemanticIdSchema, when: PredicateSchema, then: ProgramNodeSchema }).strict()).min(1).max(100),
    otherwise: ProgramNodeSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("wait"),
    semanticId: SemanticIdSchema,
    condition: PredicateSchema,
    event: z.object({
      eventType: NonEmptyString.max(200),
      refs: z.array(z.object({ type: NonEmptyString.max(120), id: NonEmptyString.max(500) }).strict()).max(100),
    }).strict().optional(),
    deadlineAt: DateTimeSchema.optional(),
    dependsOn: z.array(SemanticIdSchema).max(100),
  }).strict().superRefine((value, context) => {
    if (!value.event && !value.deadlineAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "wait requires an event, a deadlineAt, or both" });
    }
  }),
  z.object({
    kind: z.literal("compensation"),
    semanticId: SemanticIdSchema,
    forEffectId: SemanticIdSchema,
    trigger: z.enum(["ON_FAILURE", "ON_PARTIAL_FAILURE", "MANUAL"]),
    effect: EffectSchema,
    dependsOn: z.array(SemanticIdSchema).max(100),
  }).strict(),
]));

export const SuccessConditionSchema: z.ZodType<SuccessCondition> = z.object({
  kind: z.literal("success_condition"),
  semanticId: SemanticIdSchema,
  statement: NonEmptyString.max(10_000),
  mode: z.literal("ALL"),
  criteria: z.array(z.union([
    z.object({ kind: z.literal("predicate"), predicate: PredicateSchema }).strict(),
    z.object({ kind: z.literal("observation"), observationRef: SemanticIdSchema }).strict(),
    z.object({ kind: z.literal("existing_objective_success"), condition: ExistingObjectiveSuccessConditionSchema }).strict(),
  ])).min(1).max(100),
}).strict();

export const BudgetSchema: z.ZodType<Budget> = z.object({
  kind: z.literal("budget"),
  semanticId: SemanticIdSchema,
  maxSteps: z.number().int().positive().max(10_000).optional(),
  maxEffects: z.number().int().nonnegative().max(10_000).optional(),
  maxQueries: z.number().int().nonnegative().max(10_000).optional(),
  maxWaits: z.number().int().nonnegative().max(10_000).optional(),
  maxCost: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
  deadlineAt: DateTimeSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.maxSteps === undefined && value.maxEffects === undefined && value.maxQueries === undefined && value.maxWaits === undefined && value.maxCost === undefined && value.deadlineAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "budget must define at least one bound" });
  }
});

export const ProgramScopeSchema: z.ZodType<ProgramScope> = z.object({
  kind: z.literal("scope"),
  semanticId: SemanticIdSchema,
  includeEntityRefs: z.array(SemanticIdSchema).max(1_000),
  excludeEntityRefs: z.array(SemanticIdSchema).max(1_000),
  bounded: z.boolean(),
  cohortQueryRef: SemanticIdSchema.optional(),
}).strict();

export const ProvenanceSchema: z.ZodType<Provenance> = z.object({
  representation: z.enum(["human_intent", "instruction_route_decision", "planner_candidate", "domain_action", "objective_decision", "operational_query", "business_effect_inspection", "deterministic_fixture"]),
  sourceRefs: z.array(z.object({
    kind: z.enum(["instruction", "work", "work_input", "planner_attempt", "domain_action", "objective_loop", "objective_step", "query", "fixture"]),
    id: NonEmptyString.max(500),
  }).strict()).min(1).max(100),
  compiledAt: DateTimeSchema,
  traceId: NonEmptyString.max(500).optional(),
  notes: z.array(NonEmptyString.max(2_000)).max(100).optional(),
}).strict();

const OperationalProgramFields = {
  kind: z.literal("operational_program"),
  semanticId: SemanticIdSchema,
  irSchemaVersion: z.literal(IR_SCHEMA_VERSION),
  compilerVersion: NonEmptyString.max(200),
  provenance: ProvenanceSchema,
  nonSemantic: z.object({
    artifactId: NonEmptyString.max(500).optional(),
    runtimeTimestamp: DateTimeSchema.optional(),
    traceIds: z.array(NonEmptyString.max(500)).max(100).optional(),
    labels: z.array(NonEmptyString.max(500)).max(100).optional(),
  }).strict().optional(),
  executionModel: z.enum(["QUERY", "CONVERSATION", "ATOMIC_ACTION", "OBJECTIVE", "CLARIFY"]),
  goal: GoalSchema,
  constraints: z.array(ConstraintSchema).max(1_000),
  entities: z.array(EntityRefSchema).max(1_000),
  scope: ProgramScopeSchema,
  body: ProgramNodeSchema,
  observations: z.array(ObservationSchema).min(1).max(1_000),
  successCondition: SuccessConditionSchema,
  budget: BudgetSchema.optional(),
};

export const OperationalProgramDraftSchema: z.ZodType<OperationalProgramDraft> = z.object(OperationalProgramFields).strict() as z.ZodType<OperationalProgramDraft>;

export const OperationalProgramSchema: z.ZodType<OperationalProgram> = z.object({
  ...OperationalProgramFields,
  irSemanticHash: z.string().regex(new RegExp(`^${IR_HASH_PREFIX.replaceAll(":", "\\:")}[0-9a-f]{64}$`)),
}).strict() as z.ZodType<OperationalProgram>;
