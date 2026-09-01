import type { EpistemicState, Proposition } from "@finnor/epistemic-runtime";
import {
  analyzeProgramGraph,
  validateOperationalProgram,
  type EffectResource,
  type OperationalProgram,
  type Predicate,
} from "@finnor/operational-ir";
import type { BusinessWorldProjection } from "@finnor/shared-types";
import {
  SPECULATIVE_RUNTIME_VERSION,
  type EpistemicSnapshotInput,
  type SnapshotMaterialization,
  type SnapshotMaterializationRequest,
  type SnapshotObservationInput,
  type WorldEntityRef,
  type WorldMaterializationSelector,
  type WorldSnapshot,
  type WorldSnapshotSource,
  type WorldStateInput,
  type WorldStateRecord,
} from "./contracts";
import { assertCanonicalJson, assertIsoTimestamp, assertNonEmpty, compareStable, immutableClone } from "./immutable";
import { materializationIdentity, snapshotIdentity, stateIdentity } from "./identity";

const FORBIDDEN_SNAPSHOT_FIELD_SEGMENTS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "session",
  "token",
]);

function refKey(ref: WorldEntityRef): string {
  return `${ref.kind}\u0000${ref.type}\u0000${ref.id}`;
}

function fieldPath(field: string): Array<string | number> {
  const trimmed = field.trim();
  if (!trimmed || trimmed === "*" || trimmed.includes("**")) throw new Error(`UNBOUNDED_SNAPSHOT_FIELD:${field}`);
  const path = trimmed.split(".").map((segment): string | number => /^\d+$/.test(segment) ? Number(segment) : segment);
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Number.isSafeInteger(segment) || segment < 0) throw new Error(`INVALID_SNAPSHOT_FIELD_PATH:${field}`);
      continue;
    }
    const normalized = segment.replace(/[_-]/g, "").toLowerCase();
    if (!segment || FORBIDDEN_SNAPSHOT_FIELD_SEGMENTS.has(normalized)) throw new Error(`FORBIDDEN_SNAPSHOT_FIELD:${field}`);
  }
  return path;
}

function boundedValueAtPath(value: unknown, path: Array<string | number>): { exists: boolean; value?: unknown } {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false };
      current = current[segment];
    } else {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return { exists: false };
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return { exists: true, value: current };
}

function setBoundedValue(root: Record<string, unknown>, path: Array<string | number>, value: unknown): void {
  if (path.length === 0 || typeof path[0] !== "string") throw new Error("INVALID_SNAPSHOT_FIELD_ROOT");
  let current: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]!;
    const last = index === path.length - 1;
    if (last) {
      if (Array.isArray(current) && typeof segment === "number") current[segment] = structuredClone(value);
      else if (!Array.isArray(current) && typeof segment === "string") current[segment] = structuredClone(value);
      else throw new Error("INVALID_SNAPSHOT_FIELD_PATH");
      return;
    }
    const next = path[index + 1]!;
    if (Array.isArray(current)) {
      if (typeof segment !== "number") throw new Error("INVALID_SNAPSHOT_FIELD_PATH");
      if (!current[segment] || typeof current[segment] !== "object") current[segment] = typeof next === "number" ? [] : {};
      current = current[segment] as Record<string, unknown> | unknown[];
    } else {
      if (typeof segment !== "string") throw new Error("INVALID_SNAPSHOT_FIELD_PATH");
      if (!current[segment] || typeof current[segment] !== "object") current[segment] = typeof next === "number" ? [] : {};
      current = current[segment] as Record<string, unknown> | unknown[];
    }
  }
}

function assertNoForbiddenKeys(value: unknown, field: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoForbiddenKeys(child, `${field}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    if (FORBIDDEN_SNAPSHOT_FIELD_SEGMENTS.has(normalized)) throw new Error(`FORBIDDEN_SNAPSHOT_VALUE:${field}.${key}`);
    assertNoForbiddenKeys(child, `${field}.${key}`);
  }
}

function projectBoundedValues(values: WorldStateInput["values"], fields: readonly string[], field: string): WorldStateInput["values"] {
  const projected: Record<string, unknown> = {};
  for (const requested of [...new Set(fields)].sort()) {
    const path = fieldPath(requested);
    const selected = boundedValueAtPath(values, path);
    if (selected.exists) setBoundedValue(projected, path, selected.value);
  }
  assertCanonicalJson(projected, `${field}.projectedValues`);
  assertNoForbiddenKeys(projected, `${field}.projectedValues`);
  return projected as WorldStateInput["values"];
}

function selectedFields(selectors: readonly WorldMaterializationSelector[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const selector of selectors) {
    const key = refKey(selector.ref);
    const fields = [...new Set([...(result.get(key) ?? []), ...selector.fields])].sort();
    fields.forEach(fieldPath);
    result.set(key, fields);
  }
  return result;
}

function predicatePaths(predicate: Predicate, output: Map<string, Set<string>>): void {
  if (predicate.kind === "assertion") {
    if (predicate.subject.kind === "entity" && predicate.subject.ref) {
      const paths = output.get(predicate.subject.ref) ?? new Set<string>();
      paths.add(predicate.path.map(String).join("."));
      output.set(predicate.subject.ref, paths);
    }
    return;
  }
  if (predicate.kind === "not") predicatePaths(predicate.predicate, output);
  else for (const child of predicate.predicates) predicatePaths(child, output);
}

function resolvedRef(program: OperationalProgram, semanticRef: string): WorldEntityRef | null {
  const entity = program.entities.find((candidate) => candidate.semanticId === semanticRef);
  if (!entity || entity.resolution.status !== "resolved") return null;
  return {
    kind: entity.resolution.canonical.kind,
    type: entity.resolution.canonical.type,
    id: entity.resolution.canonical.id,
  };
}

function resourceRef(program: OperationalProgram, resource: EffectResource): WorldEntityRef | null {
  if (resource.selector !== "EXISTING") return null;
  if (resource.entityRef) return resolvedRef(program, resource.entityRef);
  if (!resource.id) return null;
  return { kind: resource.kind, type: resource.type, id: resource.id };
}

export function deriveSnapshotMaterializationSelectors(program: OperationalProgram): WorldMaterializationSelector[] {
  const validation = validateOperationalProgram(program);
  if (!validation.valid || !validation.program) throw new TypeError(`INVALID_OPERATIONAL_PROGRAM:${validation.errors.map((issue) => issue.code).join(",")}`);
  const paths = new Map<string, Set<string>>();
  predicatePaths(program.goal.predicate, paths);
  for (const constraint of program.constraints) predicatePaths(constraint.predicate, paths);
  for (const observation of program.observations) {
    if (observation.evidence.kind === "canonical_state") predicatePaths(observation.evidence.assertion, paths);
    if (observation.evidence.kind === "canonical_query") predicatePaths(observation.evidence.assertion, paths);
  }
  for (const criterion of program.successCondition.criteria) if (criterion.kind === "predicate") predicatePaths(criterion.predicate, paths);
  for (const entry of analyzeProgramGraph(program.body).allProgramNodes) {
    if (entry.kind === "effect") {
      predicatePaths(entry.intendedState, paths);
      for (const predicate of entry.effectDeclaration?.contract.requires ?? []) predicatePaths(predicate, paths);
      for (const predicate of entry.effectDeclaration?.contract.ensures ?? []) predicatePaths(predicate, paths);
    } else if (entry.kind === "wait") predicatePaths(entry.condition, paths);
    else if (entry.kind === "branch") for (const branchCase of entry.cases) predicatePaths(branchCase.when, paths);
  }

  const selectors: WorldMaterializationSelector[] = [];
  const push = (selector: WorldMaterializationSelector): void => {
    const normalized = { ...selector, fields: [...new Set(selector.fields.filter(Boolean))].sort() };
    const key = `${refKey(normalized.ref)}\u0000${normalized.purpose}\u0000${normalized.sourceSemanticRef}`;
    const existing = selectors.find((candidate) => `${refKey(candidate.ref)}\u0000${candidate.purpose}\u0000${candidate.sourceSemanticRef}` === key);
    if (existing) existing.fields = [...new Set([...existing.fields, ...normalized.fields])].sort();
    else selectors.push(normalized);
  };

  for (const entity of program.entities) {
    if (entity.resolution.status !== "resolved") continue;
    push({
      ref: {
        kind: entity.resolution.canonical.kind,
        type: entity.resolution.canonical.type,
        id: entity.resolution.canonical.id,
      },
      fields: [...(paths.get(entity.semanticId) ?? new Set(["status"]))],
      purpose: "PROGRAM_ENTITY",
      sourceSemanticRef: entity.semanticId,
    });
  }

  for (const graphNode of analyzeProgramGraph(program.body).nodes.values()) {
    if (graphNode.node.kind === "query") {
      for (const entityRef of graphNode.node.entityRefs) {
        const ref = resolvedRef(program, entityRef);
        if (ref) push({ ref, fields: [...(paths.get(entityRef) ?? new Set(["status"]))], purpose: "EFFECT_READ", sourceSemanticRef: graphNode.semanticId });
      }
      continue;
    }
    if (graphNode.node.kind !== "effect") continue;
    const declaration = graphNode.node.effectDeclaration;
    for (const access of declaration?.contract.reads ?? []) {
      const ref = resourceRef(program, access.resource);
      if (ref) push({ ref, fields: access.fields, purpose: "EFFECT_READ", sourceSemanticRef: graphNode.semanticId });
    }
    for (const access of [...(declaration?.contract.writes ?? []), ...(declaration?.contract.modifies ?? [])]) {
      const ref = resourceRef(program, access.resource);
      if (ref) push({ ref, fields: access.fields, purpose: "EFFECT_WRITE", sourceSemanticRef: graphNode.semanticId });
    }
    for (const target of graphNode.node.targets) {
      const ref = resolvedRef(program, target.entityRef);
      if (ref) push({ ref, fields: [...(paths.get(target.entityRef) ?? new Set(["status"]))], purpose: "EFFECT_WRITE", sourceSemanticRef: graphNode.semanticId });
    }
  }

  for (const source of program.provenance.sourceRefs) if (source.kind === "work") {
    push({ ref: { kind: "work", type: "work", id: source.id }, fields: ["status"], purpose: "WORK_CONTEXT", sourceSemanticRef: source.id });
  }
  for (const observation of program.observations) {
    const entityRef = observation.evidence.kind === "canonical_state" ? observation.evidence.entityRef : null;
    const ref = entityRef ? resolvedRef(program, entityRef) : null;
    if (ref) push({ ref, fields: [...(paths.get(entityRef!) ?? new Set(["status"]))], purpose: "OBSERVATION", sourceSemanticRef: observation.semanticId });
  }

  return selectors.sort(compareStable);
}

function epistemicValue(proposition: Proposition): EpistemicSnapshotInput["value"] {
  if (proposition.value.kind === "DETERMINISTIC") return structuredClone(proposition.value.value);
  if (proposition.value.kind === "ALTERNATIVES") return proposition.value.alternatives.map((alternative) => structuredClone(alternative.value));
  return null;
}

export function projectEpistemicInputs(
  state: EpistemicState,
  propositionIds: readonly string[] = state.propositions.map((proposition) => proposition.id),
): EpistemicSnapshotInput[] {
  const selected = new Set(propositionIds);
  return state.propositions.filter((proposition) => selected.has(proposition.id)).map((proposition) => ({
    propositionId: proposition.id,
    status: proposition.status,
    value: epistemicValue(proposition),
    confidenceQuality: proposition.confidence.level,
    evidenceRefs: [...proposition.evidenceRefs].sort(),
    provenanceComplete: state.provenance.find((entry) => entry.propositionId === proposition.id)?.complete === true,
  })).sort((left, right) => left.propositionId.localeCompare(right.propositionId));
}

function validateRef(ref: WorldEntityRef, field: string): void {
  assertNonEmpty(ref.kind, `${field}.kind`);
  assertNonEmpty(ref.type, `${field}.type`);
  assertNonEmpty(ref.id, `${field}.id`);
}

function stateRecord(input: WorldStateInput, tenantId: string, asOfMs: number, field: string, fields: readonly string[]): WorldStateRecord {
  if (input.tenantId !== tenantId) throw new Error(`CROSS_TENANT_WORLD_ACCESS:${field}`);
  validateRef(input.ref, `${field}.ref`);
  assertIsoTimestamp(input.observedAt, `${field}.observedAt`);
  if (Date.parse(input.observedAt) > asOfMs) throw new Error(`SNAPSHOT_FUTURE_STATE:${field}`);
  assertCanonicalJson(input.values, `${field}.values`);
  assertNonEmpty(input.provenance.owner, `${field}.provenance.owner`);
  assertNonEmpty(input.provenance.sourceRef, `${field}.provenance.sourceRef`);
  const material = {
    tenantId,
    ref: input.ref,
    values: projectBoundedValues(input.values, fields, field),
    observedAt: input.observedAt,
    sourceVersion: input.sourceVersion ?? null,
    provenance: { ...input.provenance, evidenceRefs: [...input.provenance.evidenceRefs].sort() },
  };
  return { ...structuredClone(material), stateHash: stateIdentity(material) };
}

function validateObservations(inputs: SnapshotObservationInput[], tenantId: string, asOfMs: number): SnapshotObservationInput[] {
  const ids = new Set<string>();
  return inputs.map((input, index) => {
    if (input.tenantId !== tenantId) throw new Error(`CROSS_TENANT_WORLD_ACCESS:relevantObservations[${index}]`);
    if (ids.has(input.id)) throw new Error(`DUPLICATE_SNAPSHOT_OBSERVATION:${input.id}`);
    ids.add(input.id);
    assertNonEmpty(input.id, `relevantObservations[${index}].id`);
    assertIsoTimestamp(input.observedAt, `relevantObservations[${index}].observedAt`);
    if (Date.parse(input.observedAt) > asOfMs) throw new Error(`SNAPSHOT_FUTURE_OBSERVATION:${input.id}`);
    assertCanonicalJson(input.value, `relevantObservations[${index}].value`);
    assertNoForbiddenKeys(input.value, `relevantObservations[${index}].value`);
    return structuredClone({ ...input, evidenceRefs: [...input.evidenceRefs].sort() });
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export interface MaterializeWorldSnapshotInput {
  tenantId: string;
  asOf: string;
  program: OperationalProgram;
  source: WorldSnapshotSource;
  epistemicState?: EpistemicState;
  epistemicPropositionIds?: string[];
}

/**
 * Deterministically materializes only program/effect selectors through a read-only
 * source. It copies no table wholesale and rejects every cross-tenant or future row.
 */
export async function materializeWorldSnapshot(input: MaterializeWorldSnapshotInput): Promise<WorldSnapshot> {
  assertNonEmpty(input.tenantId, "tenantId");
  assertIsoTimestamp(input.asOf, "asOf");
  if (input.source.mode !== "READ_ONLY") throw new Error("SNAPSHOT_SOURCE_MUST_BE_READ_ONLY");
  assertNonEmpty(input.source.sourceId, "source.sourceId");
  if (input.epistemicState && input.epistemicState.scope.tenantId !== input.tenantId) throw new Error("CROSS_TENANT_EPISTEMIC_INPUT");
  const selectors = deriveSnapshotMaterializationSelectors(input.program);
  const materialized = await input.source.materialize({
    tenantId: input.tenantId,
    asOf: input.asOf,
    programIrSemanticHash: input.program.irSemanticHash,
    selectors: structuredClone(selectors),
  });
  if (materialized.tenantId !== input.tenantId) throw new Error("CROSS_TENANT_WORLD_ACCESS:materialization");
  const asOfMs = Date.parse(input.asOf);
  const fieldsByRef = selectedFields(selectors);
  const boundedRecord = (row: WorldStateInput, index: number, collection: "canonicalState" | "workState"): WorldStateRecord => {
    const fields = fieldsByRef.get(refKey(row.ref));
    if (!fields) throw new Error(`UNREQUESTED_WORLD_STATE:${collection}[${index}]`);
    return stateRecord(row, input.tenantId, asOfMs, `${collection}[${index}]`, fields);
  };
  const canonicalState = materialized.canonicalState.map((row, index) => boundedRecord(row, index, "canonicalState")).sort((left, right) => refKey(left.ref).localeCompare(refKey(right.ref)));
  const workState = materialized.workState.map((row, index) => boundedRecord(row, index, "workState")).sort((left, right) => refKey(left.ref).localeCompare(refKey(right.ref)));
  const allKeys = new Set<string>();
  for (const row of [...canonicalState, ...workState]) {
    const key = refKey(row.ref);
    if (allKeys.has(key)) throw new Error(`DUPLICATE_WORLD_STATE:${key}`);
    allKeys.add(key);
  }
  const relevantObservations = validateObservations(materialized.relevantObservations, input.tenantId, asOfMs);
  const epistemicInputs = input.epistemicState
    ? projectEpistemicInputs(input.epistemicState, input.epistemicPropositionIds)
    : [...(materialized.epistemicInputs ?? [])].sort((left, right) => left.propositionId.localeCompare(right.propositionId));
  assertCanonicalJson(epistemicInputs, "epistemicInputs");
  const materializationMaterial = {
    tenantId: input.tenantId,
    asOf: input.asOf,
    programIrSemanticHash: input.program.irSemanticHash,
    selectors,
    canonicalState,
    workState,
    relevantObservations,
    epistemicInputs,
    sourceId: input.source.sourceId,
    sourceRefs: [...new Set(materialized.sourceRefs)].sort(),
  };
  const materializationHash = materializationIdentity(materializationMaterial);
  const snapshotMaterial = {
    version: SPECULATIVE_RUNTIME_VERSION,
    kind: "world_snapshot" as const,
    tenantId: input.tenantId,
    asOf: input.asOf,
    canonicalState,
    workState,
    relevantObservations,
    epistemicInputs,
    provenance: {
      sourceId: input.source.sourceId,
      sourceRefs: [...new Set(materialized.sourceRefs)].sort(),
      programIrSemanticHash: input.program.irSemanticHash,
      materializationSelectors: selectors,
      materializationHash,
    },
    immutable: true as const,
  };
  return immutableClone({ ...snapshotMaterial, snapshotId: snapshotIdentity(snapshotMaterial) });
}

/** Validates serialized/replayed snapshots before the interpreter trusts them. */
export function validateWorldSnapshot(snapshot: WorldSnapshot): void {
  if (snapshot.version !== SPECULATIVE_RUNTIME_VERSION || snapshot.kind !== "world_snapshot" || snapshot.immutable !== true) throw new Error("INVALID_WORLD_SNAPSHOT_CONTRACT");
  assertNonEmpty(snapshot.tenantId, "snapshot.tenantId");
  assertIsoTimestamp(snapshot.asOf, "snapshot.asOf");
  const asOfMs = Date.parse(snapshot.asOf);
  const selectors = [...snapshot.provenance.materializationSelectors].sort(compareStable);
  const fieldsByRef = selectedFields(selectors);
  const keys = new Set<string>();
  const validateRows = (rows: readonly WorldStateRecord[], collection: "canonicalState" | "workState"): void => {
    const sorted = [...rows].sort((left, right) => refKey(left.ref).localeCompare(refKey(right.ref)));
    if (compareStable(rows, sorted) !== 0) throw new Error(`NON_DETERMINISTIC_WORLD_STATE_ORDER:${collection}`);
    rows.forEach((row, index) => {
      if (row.tenantId !== snapshot.tenantId) throw new Error(`CROSS_TENANT_WORLD_ACCESS:${collection}[${index}]`);
      const key = refKey(row.ref);
      if (keys.has(key)) throw new Error(`DUPLICATE_WORLD_STATE:${key}`);
      keys.add(key);
      const fields = fieldsByRef.get(key);
      if (!fields) throw new Error(`UNREQUESTED_WORLD_STATE:${collection}[${index}]`);
      const expected = stateRecord({
        tenantId: row.tenantId,
        ref: row.ref,
        values: row.values,
        observedAt: row.observedAt,
        ...(row.sourceVersion !== null ? { sourceVersion: row.sourceVersion } : {}),
        provenance: row.provenance,
      }, snapshot.tenantId, asOfMs, `${collection}[${index}]`, fields);
      if (expected.stateHash !== row.stateHash || compareStable(expected.values, row.values) !== 0) throw new Error(`WORLD_STATE_INTEGRITY_MISMATCH:${collection}[${index}]`);
    });
  };
  validateRows(snapshot.canonicalState, "canonicalState");
  validateRows(snapshot.workState, "workState");
  const observations = validateObservations([...snapshot.relevantObservations], snapshot.tenantId, asOfMs);
  if (compareStable(observations, snapshot.relevantObservations) !== 0) throw new Error("NON_DETERMINISTIC_SNAPSHOT_OBSERVATION_ORDER");
  const sourceRefs = [...new Set(snapshot.provenance.sourceRefs)].sort();
  if (compareStable(sourceRefs, snapshot.provenance.sourceRefs) !== 0) throw new Error("NON_DETERMINISTIC_SNAPSHOT_SOURCE_REFS");
  const materializationMaterial = {
    tenantId: snapshot.tenantId,
    asOf: snapshot.asOf,
    programIrSemanticHash: snapshot.provenance.programIrSemanticHash,
    selectors,
    canonicalState: snapshot.canonicalState,
    workState: snapshot.workState,
    relevantObservations: snapshot.relevantObservations,
    epistemicInputs: snapshot.epistemicInputs,
    sourceId: snapshot.provenance.sourceId,
    sourceRefs,
  };
  if (materializationIdentity(materializationMaterial) !== snapshot.provenance.materializationHash) throw new Error("SNAPSHOT_MATERIALIZATION_INTEGRITY_MISMATCH");
  const { snapshotId: _snapshotId, ...snapshotMaterial } = snapshot;
  if (snapshotIdentity(snapshotMaterial) !== snapshot.snapshotId) throw new Error("SNAPSHOT_IDENTITY_MISMATCH");
}

export interface InMemoryWorldSnapshotSourceInput extends SnapshotMaterialization {
  sourceId?: string;
}

/** Explicit in-memory source for fixtures and already-materialized shadow reads. */
export function createInMemoryWorldSnapshotSource(input: InMemoryWorldSnapshotSourceInput): WorldSnapshotSource {
  const materialization = immutableClone(input);
  return Object.freeze({
    mode: "READ_ONLY" as const,
    sourceId: input.sourceId ?? "p5:in-memory-materialization",
    async materialize(request: SnapshotMaterializationRequest) {
      if (request.tenantId !== materialization.tenantId) throw new Error("CROSS_TENANT_WORLD_ACCESS:in-memory-source");
      const wanted = new Set(request.selectors.map((selector) => refKey(selector.ref)));
      const filter = (row: WorldStateInput) => wanted.has(refKey(row.ref));
      const observationRefs = new Set([
        ...request.selectors.map((selector) => selector.sourceSemanticRef),
      ]);
      return structuredClone({
        tenantId: materialization.tenantId,
        canonicalState: materialization.canonicalState.filter(filter),
        workState: materialization.workState.filter(filter),
        relevantObservations: materialization.relevantObservations.filter((observation) =>
          observationRefs.has(observation.id) || observation.subject.kind === "query" || observation.subject.kind === "event"),
        epistemicInputs: materialization.epistemicInputs ?? [],
        sourceRefs: materialization.sourceRefs,
      });
    },
  });
}

/** Reuses the existing bounded BusinessWorld projection instead of creating a new truth model. */
export function businessWorldProjectionSource(input: {
  tenantId: string;
  projections: BusinessWorldProjection[];
  workState?: WorldStateInput[];
  observations?: SnapshotObservationInput[];
  sourceId?: string;
}): WorldSnapshotSource {
  const canonicalState: WorldStateInput[] = input.projections.flatMap((projection) => projection.objects.map((object) => ({
    tenantId: input.tenantId,
    ref: { kind: object.entityType === "work" ? "work" as const : "entity" as const, type: object.entityType, id: object.entityId },
    values: {
      label: object.label,
      status: object.status,
      occurredAt: object.occurredAt,
      relatedWork: object.relatedWork.map((ref) => ({ type: ref.entityType, id: ref.entityId })),
      interactionEligible: object.interactionEligible,
    },
    observedAt: projection.asOf,
    sourceVersion: `business-world:${projection.version}:${projection.scene}`,
    provenance: { owner: "@finnor/read-models#businessWorld", sourceRef: object.provenance.table, evidenceRefs: [] },
  })));
  return createInMemoryWorldSnapshotSource({
    tenantId: input.tenantId,
    canonicalState: canonicalState.filter((row) => row.ref.kind !== "work"),
    workState: [...canonicalState.filter((row) => row.ref.kind === "work"), ...(input.workState ?? [])],
    relevantObservations: input.observations ?? [],
    sourceRefs: [...new Set(input.projections.flatMap((projection) => projection.source.tables))].sort(),
    sourceId: input.sourceId ?? "@finnor/read-models#businessWorld",
  });
}
