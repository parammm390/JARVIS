import type { OperationalProgram } from "@finnor/operational-ir";
import type { CandidateOrigin, CandidateProgramInput } from "./contracts";
import { computeProgramSearchHash } from "./identity";

export interface CandidateSourceBatch {
  origin: CandidateOrigin;
  originRef: string;
  programs: Array<{
    candidateId: string;
    program: OperationalProgram;
    requiredPropositionIds?: string[];
    solverFacts?: CandidateProgramInput["solverFacts"];
    costOverrides?: CandidateProgramInput["costOverrides"];
    successOverride?: CandidateProgramInput["successOverride"];
  }>;
}

export interface BoundedCandidateGenerationResult {
  candidates: CandidateProgramInput[];
  omitted: Array<{ candidateId: string; origin: CandidateOrigin; reasonCode: "DUPLICATE_PROGRAM" | "MAX_INITIAL_CANDIDATES" | "SIMPLE_FAST_PATH" }>;
  stats: {
    received: number;
    emitted: number;
    duplicates: number;
    bounded: boolean;
    mode: "SIMPLE_FAST_PATH" | "MULTI_CANDIDATE";
  };
}

const ORIGIN_ORDER: Record<CandidateOrigin, number> = {
  PROCEDURE_TEMPLATE: 0,
  MODEL_CANDIDATE: 1,
  CAPABILITY_ALTERNATIVE: 2,
  RECOVERY_ALTERNATIVE: 3,
  DETERMINISTIC_REWRITE: 4,
};

/**
 * Normalizes already-produced candidate sources without invoking a model. Complex
 * callers may supply multiple model/template/alternative candidates; simple
 * callers deterministically retain one and avoid the rewrite/search fan-out.
 */
export function generateBoundedInitialCandidates(input: {
  sources: CandidateSourceBatch[];
  requestComplexity: "SIMPLE" | "COMPLEX";
  maxInitialCandidates: number;
}): BoundedCandidateGenerationResult {
  if (!Number.isSafeInteger(input.maxInitialCandidates) || input.maxInitialCandidates <= 0) throw new TypeError("INVALID_MAX_INITIAL_CANDIDATES");
  const rows = input.sources.flatMap((source) => source.programs.map((program) => ({ source, program })))
    .sort((left, right) => {
      const origin = ORIGIN_ORDER[left.source.origin] - ORIGIN_ORDER[right.source.origin];
      return origin || `${left.program.candidateId}\u0000${left.source.originRef}`.localeCompare(`${right.program.candidateId}\u0000${right.source.originRef}`);
    });
  const uniqueIds = new Set<string>();
  const hashes = new Set<string>();
  const candidates: CandidateProgramInput[] = [];
  const omitted: BoundedCandidateGenerationResult["omitted"] = [];
  const effectiveMax = input.requestComplexity === "SIMPLE" ? 1 : input.maxInitialCandidates;
  let duplicates = 0;
  for (const { source, program } of rows) {
    if (uniqueIds.has(program.candidateId)) throw new TypeError(`DUPLICATE_CANDIDATE_ID:${program.candidateId}`);
    uniqueIds.add(program.candidateId);
    const hash = computeProgramSearchHash(program.program);
    if (hashes.has(hash)) {
      duplicates += 1;
      omitted.push({ candidateId: program.candidateId, origin: source.origin, reasonCode: "DUPLICATE_PROGRAM" });
      continue;
    }
    if (candidates.length >= effectiveMax) {
      omitted.push({
        candidateId: program.candidateId,
        origin: source.origin,
        reasonCode: input.requestComplexity === "SIMPLE" ? "SIMPLE_FAST_PATH" : "MAX_INITIAL_CANDIDATES",
      });
      continue;
    }
    hashes.add(hash);
    candidates.push({
      candidateId: program.candidateId,
      origin: source.origin,
      originRef: source.originRef,
      program: program.program,
      ...(program.requiredPropositionIds ? { requiredPropositionIds: [...program.requiredPropositionIds] } : {}),
      ...(program.solverFacts ? { solverFacts: { ...program.solverFacts } } : {}),
      ...(program.costOverrides ? { costOverrides: program.costOverrides } : {}),
      ...(program.successOverride ? { successOverride: program.successOverride } : {}),
    });
  }
  return {
    candidates,
    omitted,
    stats: {
      received: rows.length,
      emitted: candidates.length,
      duplicates,
      bounded: omitted.some((entry) => entry.reasonCode === "MAX_INITIAL_CANDIDATES" || entry.reasonCode === "SIMPLE_FAST_PATH"),
      mode: input.requestComplexity === "SIMPLE" ? "SIMPLE_FAST_PATH" : "MULTI_CANDIDATE",
    },
  };
}
