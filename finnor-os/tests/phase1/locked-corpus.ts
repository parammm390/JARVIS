import { createHash } from "node:crypto";
import {
  canonicalSerialize,
  computeIrSemanticHash,
  createPlanningIrArtifact,
  type ConstraintSpec,
  type PlanningIrArtifact,
  type PlanningSemanticSnapshot,
} from "@finnor/planning-ir";
import { semanticSnapshotFromArtifact } from "@finnor/orchestration";

export const PHASE1_CORPUS_VERSION = "phase1-1.0.0" as const;
export const PHASE1_CORPUS_SEED = 0x0f1a0b1c;
export const PHASE1_FIXED_CLOCK = "2026-08-26T00:00:00.000Z";

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

export type LockedCase =
  | { id: string; suite: "routing"; semantic: string; expected: "QUERY" | "ATOMIC_EFFECT" | "OBJECTIVE" | "CONVERSATION"; instruction: string; conversational?: boolean; fastRead: boolean }
  | { id: string; suite: "ir"; semantic: string; expected: "ADMISSIBLE_AND_LOWERABLE"; artifact: PlanningIrArtifact; assetDomain?: "WATER" | "HVAC" | "PLUMBING" }
  | { id: string; suite: "malformed"; semantic: string; expected: "REJECT"; artifact: PlanningIrArtifact }
  | { id: string; suite: "forged"; semantic: string; expected: "REJECT_NOT_GROUNDED"; artifact: PlanningIrArtifact; forgery: "CROSS_TENANT" | "NONEXISTENT" }
  | { id: string; suite: "constraint"; semantic: string; expected: "REJECT_HARD" | "ADMIT_SOFT"; artifact: PlanningIrArtifact }
  | { id: string; suite: "semantic_diff"; semantic: string; expected: "EQUIVALENT" | "EXPECTED_IMPROVEMENT" | "REGRESSION"; legacy: PlanningSemanticSnapshot; ir: PlanningSemanticSnapshot };

function artifact(index: number, options: { domain?: "WATER" | "HVAC" | "PLUMBING"; hard?: ConstraintSpec[]; soft?: ConstraintSpec[] } = {}): PlanningIrArtifact {
  const propertyId = uuid(10_000 + index);
  const equipmentId = uuid(20_000 + index);
  const effectId = `effect-${index}`;
  const observationId = `observation-${index}`;
  const effectNodeId = `effect-node-${index}`;
  const observationNodeId = `observation-node-${index}`;
  const domain = options.domain ?? "GENERIC";
  const refs = [
    { kind: "property" as const, entityType: "property", entityId: propertyId, field: "propertyId", relationship: "service_location" },
    { kind: "asset" as const, entityType: "equipment", entityId: equipmentId, field: "equipmentId", relationship: "installed_at" },
  ];
  return createPlanningIrArtifact({
    intent: {
      requestedOutcome: `Set ${domain.toLowerCase()} asset operating predicate ${index} to threshold ${(index * 17) % 997}`,
      executionModel: index % 4 === 0 ? "OBJECTIVE" : "ATOMIC_EFFECT",
      groundedEntities: refs,
      scope: { included: refs, excluded: [], textExclusions: [`exclude failure mode ${(index * 13) % 89}`] },
      unresolvedAmbiguity: [],
      provenance: { source: "deterministic_fixture", sourceRef: `${PHASE1_CORPUS_VERSION}:${index}`, createdAt: PHASE1_FIXED_CLOCK, traceId: `trace-${index}` },
    },
    goal: {
      statement: `Canonical ${domain} asset predicate ${index} satisfies target ${(index * 17) % 997}`,
      desiredState: [{ subject: refs[1]!, path: ["fixturePredicate", index % 23], operator: "eq", expected: (index * 17) % 997 }],
      completionMode: "all",
      objectiveCompatibility: "reuse_existing_objective_semantics",
    },
    constraints: { hard: options.hard ?? [], soft: options.soft ?? [] },
    plan: {
      nodes: [
        { id: effectNodeId, kind: "effect", effectId, dependsOn: [], causalPrerequisites: [], requiredCapabilities: ["action:fixture_action"] },
        { id: observationNodeId, kind: "observe", observationId, dependsOn: [effectNodeId], causalPrerequisites: [effectNodeId], requiredCapabilities: [] },
      ],
      completion: { mode: "all", observationIds: [observationId] },
    },
    effects: [{ id: effectId, actionType: "fixture_action", effectIntent: `Apply fixture predicate ${index}`, payload: { propertyId, equipmentId, assetDomain: domain, predicateIndex: index % 23, threshold: (index * 17) % 997 }, targetRefs: refs, requiredCapability: "action:fixture_action", risk: index % 7 === 0 ? "high" : "medium", exposure: null, proposalOnly: true }],
    observations: [{ id: observationId, effectId, kind: "canonical_state", predicate: { predicateIndex: index % 23, threshold: (index * 17) % 997 }, requiredEvidence: ["canonical_read_back"], acknowledgementSufficient: false, verificationFloor: "at_least_existing" }],
  }, { compilerVersion: "phase1-admissibility-1", provenance: { source: "deterministic_fixture", sourceRef: `${PHASE1_CORPUS_VERSION}:${index}`, createdAt: PHASE1_FIXED_CLOCK, traceId: `trace-${index}` } });
}

function rehash(value: PlanningIrArtifact): PlanningIrArtifact {
  value.metadata.irSemanticHash = computeIrSemanticHash(value);
  return value;
}

const cases: LockedCase[] = [];
const queryMetrics = ["overdue_value", "cash_collected", "open_leads", "technician_load", "service_due", "stock_shortage", "approval_queue", "workflow_health", "customer_history", "schedule_capacity"];
const horizons = ["today", "this_week", "this_month", "this_quarter", "year_to_date", "rolling_30_days"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-query-${i}`, suite: "routing", semantic: `Read canonical ${queryMetrics[i % 10]} for ${horizons[Math.floor(i / 10)]}`, expected: "QUERY", instruction: `Show ${queryMetrics[i % 10]} for ${horizons[Math.floor(i / 10)]}`, fastRead: true });
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-atomic-${i}`, suite: "routing", semantic: `Set operational field ${i % 15} to governed value ${Math.floor(i / 15) + 1}`, expected: "ATOMIC_EFFECT", instruction: `Set field_${i % 15} to ${Math.floor(i / 15) + 1} for operator${i}@example.test`, fastRead: false });
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-objective-${i}`, suite: "routing", semantic: `Ensure outcome family ${i % 12} reaches terminal state using continuation policy ${Math.floor(i / 12) + 1}`, expected: "OBJECTIVE", instruction: `Ensure outcome_${i % 12} reaches target_${Math.floor(i / 12) + 1} and keep working until canonical completion is observed`, fastRead: false });
const speechActs = ["greeting", "gratitude", "farewell", "capability_chat", "identity_chat", "small_talk", "courtesy", "acknowledgement", "rapport", "orientation"];
const conversationTopics = ["morning", "assistance", "system_identity", "weather_chat", "thanks", "goodbye"];
for (let i = 0; i < 60; i += 1) cases.push({ id: `routing-conversation-${i}`, suite: "routing", semantic: `${speechActs[i % 10]} about ${conversationTopics[Math.floor(i / 10)]}`, expected: "CONVERSATION", instruction: `${speechActs[i % 10]} ${conversationTopics[Math.floor(i / 10)]}`, conversational: true, fastRead: false });

for (let i = 0; i < 320; i += 1) {
  const domain = i >= 260 && i < 280 ? "WATER" : i >= 280 && i < 300 ? "HVAC" : i >= 300 ? "PLUMBING" : undefined;
  cases.push({ id: `ir-${i}`, suite: "ir", semantic: `${domain ?? "GENERIC"} admissible predicate family ${i % 23} threshold ${(i * 17) % 997}`, expected: "ADMISSIBLE_AND_LOWERABLE", artifact: artifact(i, { domain }), ...(domain ? { assetDomain: domain } : {}) });
}

const malformedFamilies = ["self_dependency", "missing_dependency", "cycle", "duplicate_dependency", "duplicate_node_id", "causal_not_dependency", "missing_effect", "missing_observation", "ack_only_verification", "weakened_observation"] as const;
for (let i = 0; i < 200; i += 1) {
  const candidate = structuredClone(artifact(1_000 + i));
  const family = malformedFamilies[i % malformedFamilies.length];
  const effectNode = candidate.plan.nodes[0]!;
  const observeNode = candidate.plan.nodes[1]!;
  if (family === "self_dependency") effectNode.dependsOn = [effectNode.id];
  if (family === "missing_dependency") effectNode.dependsOn = [`missing-${i}`];
  if (family === "cycle") { effectNode.dependsOn = [observeNode.id]; observeNode.dependsOn = [effectNode.id]; }
  if (family === "duplicate_dependency") observeNode.dependsOn = [effectNode.id, effectNode.id];
  if (family === "duplicate_node_id") observeNode.id = effectNode.id;
  if (family === "causal_not_dependency") observeNode.dependsOn = [];
  if (family === "missing_effect" && effectNode.kind === "effect") effectNode.effectId = `missing-effect-${i}`;
  if (family === "missing_observation" && observeNode.kind === "observe") observeNode.observationId = `missing-observation-${i}`;
  if (family === "ack_only_verification") candidate.observations[0]!.requiredEvidence = ["provider_acknowledgement"];
  if (family === "weakened_observation") candidate.observations[0]!.kind = "recorded_result";
  cases.push({ id: `malformed-${i}`, suite: "malformed", semantic: `${family} against business predicate ${i % 20} threshold ${(i * 31) % 1009}`, expected: "REJECT", artifact: rehash(candidate) });
}

for (let i = 0; i < 100; i += 1) {
  const candidate = artifact(2_000 + i);
  cases.push({ id: `forged-${i}`, suite: "forged", semantic: `${i < 50 ? "Cross-tenant" : "nonexistent"} ${i % 10 === 0 ? "property" : "asset"} target for operation family ${i % 25} at required authority revision ${i + 1}`, expected: "REJECT_NOT_GROUNDED", artifact: candidate, forgery: i < 50 ? "CROSS_TENANT" : "NONEXISTENT" });
}

const constraintKinds: ConstraintSpec["kind"][] = ["entity_relationship", "temporal", "capability", "precondition", "user_restriction", "policy_authority", "cost_risk_exposure", "preference"];
for (let i = 0; i < 100; i += 1) {
  const hard = i < 50;
  const constraint: ConstraintSpec = { id: `constraint-${i}`, strength: hard ? "HARD" : "SOFT", kind: constraintKinds[i % constraintKinds.length]!, description: `${hard ? "Mandatory" : "Preferred"} bound ${i % 25} at value ${(i * 19) % 503}`, status: "violated", subjectRefs: [], values: { boundFamily: i % 25, value: (i * 19) % 503 } };
  cases.push({ id: `constraint-${i}`, suite: "constraint", semantic: `${constraint.strength} ${constraint.kind} family ${i % 25} value ${(i * 19) % 503}`, expected: hard ? "REJECT_HARD" : "ADMIT_SOFT", artifact: artifact(3_000 + i, hard ? { hard: [constraint] } : { soft: [constraint] }) });
}

for (let i = 0; i < 100; i += 1) {
  const base = semanticSnapshotFromArtifact(artifact(4_000 + i));
  const ir = structuredClone(base);
  let expected: "EQUIVALENT" | "EXPECTED_IMPROVEMENT" | "REGRESSION" = "EQUIVALENT";
  if (i >= 50 && i < 75) {
    expected = "EXPECTED_IMPROVEMENT";
    ir.hardConstraints.push({ id: `strength-${i}`, strength: "HARD", kind: "precondition", description: `Require canonical revision ${i}`, status: "satisfied", subjectRefs: [], values: { revision: i } });
  } else if (i >= 75) {
    expected = "REGRESSION";
    ir.intendedOutcome = `${ir.intendedOutcome} with materially different terminal state ${i}`;
  }
  cases.push({ id: `semantic-diff-${i}`, suite: "semantic_diff", semantic: `${expected} comparison for predicate family ${i % 25} threshold ${(i * 17) % 997}`, expected, legacy: base, ir });
}

export const PHASE1_LOCKED_CORPUS = Object.freeze(cases);
export const PHASE1_LOCKED_COUNTS = Object.freeze({
  routing: cases.filter((entry) => entry.suite === "routing").length,
  ir: cases.filter((entry) => entry.suite === "ir").length,
  malformed: cases.filter((entry) => entry.suite === "malformed").length,
  forged: cases.filter((entry) => entry.suite === "forged").length,
  constraint: cases.filter((entry) => entry.suite === "constraint").length,
  semanticDiff: cases.filter((entry) => entry.suite === "semantic_diff").length,
  total: cases.length,
  water: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "WATER").length,
  hvac: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "HVAC").length,
  plumbing: cases.filter((entry) => entry.suite === "ir" && entry.assetDomain === "PLUMBING").length,
});
export const PHASE1_LOCKED_CORPUS_HASH = createHash("sha256").update(canonicalSerialize({ version: PHASE1_CORPUS_VERSION, seed: PHASE1_CORPUS_SEED, fixedClock: PHASE1_FIXED_CLOCK, cases })).digest("hex");
export const PHASE1_EXPECTED_CORPUS_HASH = "b982071249a6af5e08c72b228114d5343989908ef84f6a974e86770565ac06c0" as const;
