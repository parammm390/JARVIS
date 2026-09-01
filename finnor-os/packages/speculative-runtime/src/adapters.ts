import {
  inferExecutableNodeEffects,
  type Effect,
  type EffectDeclaration,
  type JsonValue,
  type OperationalProgram,
  type Predicate,
} from "@finnor/operational-ir";
import {
  SPECULATIVE_ADAPTER_CLASSES,
  type HypotheticalEffect,
  type SimulatedOperationalStatus,
  type SpeculativeAdapterClass,
  type WorldStateChange,
} from "./contracts";
import { compareStable, immutableClone } from "./immutable";
import { hypotheticalEffectIdentity } from "./identity";
import { entityValues, resolvedWorldRef, valueAtPath, type PredicateRuntimeState } from "./predicates";

export interface SpeculativeAdapterDescriptor {
  adapterClass: SpeculativeAdapterClass;
  adapterId: string;
  input: "OperationalProgram Query" | "P2 EffectDeclaration" | "Wait" | "Observation";
  output: "hypothetical_only";
  realSideEffects: 0;
}

export const SPECULATIVE_ADAPTER_INVENTORY: readonly SpeculativeAdapterDescriptor[] = Object.freeze([
  { adapterClass: "CANONICAL_READ", adapterId: "p5:canonical-read:v1", input: "OperationalProgram Query", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "CANONICAL_WRITE", adapterId: "p5:canonical-write-overlay:v1", input: "P2 EffectDeclaration", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "COMMUNICATION", adapterId: "p5:communication-outcome:v1", input: "P2 EffectDeclaration", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "FINANCIAL_EFFECT", adapterId: "p5:financial-outcome:v1", input: "P2 EffectDeclaration", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "PROVIDER_MUTATION", adapterId: "p5:provider-outcome:v1", input: "P2 EffectDeclaration", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "COMPUTER_MUTATION", adapterId: "p5:computer-outcome:v1", input: "P2 EffectDeclaration", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "WAIT_EVENT", adapterId: "p5:wait-event:v1", input: "Wait", output: "hypothetical_only", realSideEffects: 0 },
  { adapterClass: "OBSERVATION", adapterId: "p5:predicted-observation:v1", input: "Observation", output: "hypothetical_only", realSideEffects: 0 },
]);

if (SPECULATIVE_ADAPTER_INVENTORY.length !== SPECULATIVE_ADAPTER_CLASSES.length) throw new Error("P5_ADAPTER_INVENTORY_INCOMPLETE");

export interface ClassifiedEffectAdapter {
  status: "SUPPORTED" | "UNSUPPORTED";
  adapterClass?: Exclude<SpeculativeAdapterClass, "CANONICAL_READ" | "WAIT_EVENT" | "OBSERVATION">;
  declaration?: EffectDeclaration;
  reasonCodes: string[];
}

export function classifyEffectAdapter(effect: Effect, program: OperationalProgram): ClassifiedEffectAdapter {
  const inferred = effect.effectDeclaration
    ? { support: "SUPPORTED" as const, declaration: effect.effectDeclaration, reasonCodes: ["IR_DECLARED_EFFECT_SEMANTICS"] }
    : inferExecutableNodeEffects(effect, program);
  if (inferred.support !== "SUPPORTED" || !inferred.declaration) return { status: "UNSUPPORTED", reasonCodes: [...inferred.reasonCodes, "P2_EFFECT_SEMANTICS_REQUIRED"] };
  const declaration = inferred.declaration;
  const specializedClasses = [
    ...(declaration.computerMutations.length > 0 ? ["COMPUTER_MUTATION" as const] : []),
    ...(declaration.financial.length > 0 ? ["FINANCIAL_EFFECT" as const] : []),
    ...(declaration.communications.length > 0 ? ["COMMUNICATION" as const] : []),
  ];
  if (specializedClasses.length > 1) {
    return {
      status: "UNSUPPORTED",
      declaration,
      reasonCodes: [...inferred.reasonCodes, "MULTI_CLASS_EXTERNAL_EFFECT_REQUIRES_EXPLICIT_P2_LOWERING"],
    };
  }
  const adapterClass = specializedClasses[0]
    ?? (declaration.externalMutations.length > 0 ? "PROVIDER_MUTATION"
      : declaration.contract.writes.length > 0 || declaration.contract.modifies.length > 0 ? "CANONICAL_WRITE" : null);
  return adapterClass
    ? { status: "SUPPORTED", adapterClass, declaration, reasonCodes: inferred.reasonCodes }
    : { status: "UNSUPPORTED", declaration, reasonCodes: [...inferred.reasonCodes, "NO_SUPPORTED_EFFECT_ADAPTER_CLASS"] };
}

function exactAssertions(predicate: Predicate): Array<Extract<Predicate, { kind: "assertion" }>> | null {
  if (predicate.kind === "assertion") return predicate.operator === "eq" && predicate.expected !== undefined ? [predicate] : [];
  if (predicate.kind === "all") {
    const children = predicate.predicates.map(exactAssertions);
    return children.some((child) => child === null) ? null : children.flatMap((child) => child!);
  }
  return null;
}

function changeKey(change: WorldStateChange): string {
  return `${change.target.kind}:${change.target.type}:${change.target.id}:${JSON.stringify(change.path)}`;
}

export function deriveHypotheticalChanges(input: {
  effect: Effect;
  declaration: EffectDeclaration;
  state: PredicateRuntimeState;
}): { status: "SUPPORTED" | "UNSUPPORTED"; changes: WorldStateChange[]; reasonCodes: string[] } {
  const predicates = [input.effect.intendedState, ...input.declaration.contract.ensures];
  const assertions = predicates.flatMap((predicate) => exactAssertions(predicate) ?? []);
  if (predicates.some((predicate) => exactAssertions(predicate) === null)) {
    return { status: "UNSUPPORTED", changes: [], reasonCodes: ["NON_DETERMINISTIC_EFFECT_ENSURE_PREDICATE"] };
  }
  const changes: WorldStateChange[] = [];
  for (const assertion of assertions) {
    if (assertion.subject.kind !== "entity" || !assertion.subject.ref || assertion.expected === undefined) continue;
    const target = resolvedWorldRef(input.state, assertion.subject.ref);
    if (!target) return { status: "UNSUPPORTED", changes: [], reasonCodes: ["UNRESOLVED_EFFECT_TARGET"] };
    const values = entityValues(input.state, target);
    const before = values ? valueAtPath(values, assertion.path) : { exists: false as const };
    const change: WorldStateChange = {
      target,
      path: [...assertion.path],
      beforeExists: before.exists,
      ...(before.exists ? { before: structuredClone(before.value as JsonValue) } : {}),
      after: structuredClone(assertion.expected),
    };
    const existing = changes.find((candidate) => changeKey(candidate) === changeKey(change));
    if (existing && compareStable(existing.after, change.after) !== 0) return { status: "UNSUPPORTED", changes: [], reasonCodes: ["CONFLICTING_EFFECT_ENSURES"] };
    if (!existing) changes.push(change);
  }
  return { status: "SUPPORTED", changes: changes.sort((left, right) => changeKey(left).localeCompare(changeKey(right))), reasonCodes: ["EXACT_P2_ENSURES_OVERLAY"] };
}

function reversibility(declaration: EffectDeclaration): HypotheticalEffect["reversibility"] {
  return declaration.reversibility.classification;
}

export function predictHypotheticalEffect(input: {
  effect: Effect;
  program: OperationalProgram;
  state: PredicateRuntimeState;
  outcome: SimulatedOperationalStatus;
  ordinal: number;
}): { status: "PREDICTED" | "UNSUPPORTED"; effect?: HypotheticalEffect; reasonCodes: string[] } {
  const classification = classifyEffectAdapter(input.effect, input.program);
  if (classification.status !== "SUPPORTED" || !classification.adapterClass || !classification.declaration) {
    return { status: "UNSUPPORTED", reasonCodes: classification.reasonCodes };
  }
  const changes = deriveHypotheticalChanges({ effect: input.effect, declaration: classification.declaration, state: input.state });
  if (changes.status !== "SUPPORTED") return { status: "UNSUPPORTED", reasonCodes: changes.reasonCodes };
  if (classification.adapterClass === "CANONICAL_WRITE" && changes.changes.length === 0) {
    return { status: "UNSUPPORTED", reasonCodes: ["CANONICAL_WRITE_REQUIRES_EXACT_OVERLAY_CHANGE"] };
  }
  // A generic PARTIAL outcome does not identify which subset committed. Applying
  // the full intended state would overclaim certainty, so only SUCCESS overlays
  // exact P2 ensures; partial state remains explicit and requires reconciliation.
  const appliedChanges = input.outcome === "SUCCESS" ? changes.changes : [];
  const identityMaterial = {
    programIrSemanticHash: input.program.irSemanticHash,
    effectSemanticId: input.effect.semanticId,
    operation: input.effect.operation,
    adapterClass: classification.adapterClass,
    outcome: input.outcome,
    ordinal: input.ordinal,
    changes: appliedChanges,
  };
  return {
    status: "PREDICTED",
    reasonCodes: [
      ...classification.reasonCodes,
      ...changes.reasonCodes,
      ...(input.outcome === "PARTIAL" ? ["PARTIAL_EFFECT_SUBSET_UNKNOWN_NO_STATE_OVERCLAIM"] : []),
    ],
    effect: immutableClone({
      kind: "hypothetical_effect" as const,
      hypotheticalEffectId: hypotheticalEffectIdentity(identityMaterial),
      planningEffect: {
        semanticId: input.effect.semanticId,
        operation: input.effect.operation,
        programIrSemanticHash: input.program.irSemanticHash,
      },
      adapterClass: classification.adapterClass,
      outcome: input.outcome,
      changes: appliedChanges,
      reversibility: reversibility(classification.declaration),
      authoritative: false as const,
      realBusinessEffectId: null,
      identityDomain: "P5_HYPOTHETICAL" as const,
    }),
  };
}

export function adapterForQuery(): SpeculativeAdapterDescriptor {
  return SPECULATIVE_ADAPTER_INVENTORY.find((adapter) => adapter.adapterClass === "CANONICAL_READ")!;
}
