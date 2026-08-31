import { createHash } from "node:crypto";
import {
  canonicalIrSemanticJson,
  canonicalSerialize,
  canonicalizeIrFragment,
  type OperationalProgram,
  type ProgramEffectSummary,
} from "@finnor/operational-ir";
import {
  PROGRAM_SEARCH_HASH_PREFIX,
  type ProgramSearchHash,
} from "./contracts";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeProgramSearchHash(program: OperationalProgram): ProgramSearchHash {
  return `${PROGRAM_SEARCH_HASH_PREFIX}${sha256(canonicalIrSemanticJson(program))}`;
}

function stripEffectIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEffectIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "effectId")
    .map(([key, child]) => [key, stripEffectIdentity(child)]));
}

/**
 * An equivalence class groups programs only by guarded goal/effect semantics. It
 * deliberately does not replace programHash: schedules with different performance
 * remain separate search nodes even when a proof says their business effects match.
 */
export function computeEquivalenceClass(
  program: OperationalProgram,
  summary?: ProgramEffectSummary,
): string {
  const semantic = canonicalizeIrFragment({
    goal: program.goal,
    hardConstraints: program.constraints.filter((constraint) => constraint.severity === "HARD"),
    entities: program.entities,
    scope: program.scope,
    observations: program.observations,
    successCondition: program.successCondition,
    effects: summary ? stripEffectIdentity({
      possible: summary.possible,
      guaranteed: summary.guaranteed,
      authorityRequirements: summary.authorityRequirements,
      informationFlows: summary.informationFlows,
      compensationLinks: summary.compensationLinks,
    }) : null,
  });
  return `p4:eclass:sha256:${sha256(canonicalSerialize(semantic))}`;
}

export function deterministicReplayKey(value: unknown): string {
  return `p4:replay:sha256:${sha256(canonicalSerialize(canonicalizeIrFragment(value)))}`;
}

export function estimatedCanonicalBytes(value: unknown): number {
  return Buffer.byteLength(canonicalSerialize(canonicalizeIrFragment(value)), "utf8");
}

export function stableFragment(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}
