import type { CausalReplayNode } from "@finnor/shared-types";
import type { SearchProblem, SearchResult } from "./contracts";
import { deterministicReplayKey } from "./identity";

export interface ProgramSearchDecisionReceipt {
  version: 1;
  receiptId: string;
  decisionId: string;
  recordedAt: string;
  goalHash: string;
  bounds: SearchProblem["searchBounds"];
  solverVersions: SearchProblem["solverVersions"];
  costModelVersion: string;
  rewriteSetVersion: string;
  candidateOrigins: Array<{ candidateId: string; origin: string; originRef: string; programHash: string }>;
  rewrites: Array<{ ruleId: string; parentProgramHash: string; resultProgramHash: string; safetyClass: string; effectRelation: string }>;
  hardRejections: Array<{ programHash: string; stage: string; reasonCode: string; detailCodes: string[] }>;
  solverResults: Array<{ programHash: string; constraintId: string; solver: string; solverVersion: string; status: string; reasonCodes: string[] }>;
  survivors: Array<{ programHash: string; score: SearchResult["extractionScore"] }>;
  selectedProgramHash: string | null;
  tieBreak: string | null;
  searchStats: SearchResult["searchStats"];
  status: SearchResult["status"];
  redaction: "STRUCTURED_DECISIONS_ONLY";
}

/** No prompts, model rationale, provider payloads, entity values, or chain-of-thought. */
export function createProgramSearchDecisionReceipt(
  problem: SearchProblem,
  result: SearchResult,
): ProgramSearchDecisionReceipt {
  const candidates = [...result.survivingCandidates, ...result.rejectedCandidates];
  const body = {
    decisionId: problem.epistemicState.scope.decisionId,
    recordedAt: problem.fixedNow,
    goalHash: deterministicReplayKey(problem.goal),
    selectedProgramHash: result.selectedProgramHash,
    replay: result.deterministicReplayKey,
  };
  return {
    version: 1,
    receiptId: deterministicReplayKey(body).replace("p4:replay:sha256:", "p4:receipt:sha256:"),
    decisionId: body.decisionId,
    recordedAt: body.recordedAt,
    goalHash: body.goalHash,
    bounds: { ...problem.searchBounds },
    solverVersions: { ...problem.solverVersions },
    costModelVersion: problem.costModelVersion,
    rewriteSetVersion: problem.rewriteSetVersion,
    candidateOrigins: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      origin: candidate.origin,
      originRef: candidate.originRef,
      programHash: candidate.programHash,
    })).sort((left, right) => `${left.programHash}:${left.candidateId}`.localeCompare(`${right.programHash}:${right.candidateId}`)),
    rewrites: candidates.flatMap((candidate) => candidate.rewriteApplications.map((rewrite) => ({
      ruleId: rewrite.ruleId,
      parentProgramHash: rewrite.parentProgramHash,
      resultProgramHash: rewrite.resultProgramHash,
      safetyClass: rewrite.safetyClass,
      effectRelation: rewrite.effectRelation,
    }))).filter((rewrite, index, values) => values.findIndex((value) => value.resultProgramHash === rewrite.resultProgramHash && value.ruleId === rewrite.ruleId) === index)
      .sort((left, right) => `${left.resultProgramHash}:${left.ruleId}`.localeCompare(`${right.resultProgramHash}:${right.ruleId}`)),
    hardRejections: result.rejectedCandidates.flatMap((candidate) => candidate.rejection ? [{
      programHash: candidate.programHash,
      stage: candidate.rejection.stage,
      reasonCode: candidate.rejection.reasonCode,
      detailCodes: candidate.rejection.detailCodes,
    }] : []),
    solverResults: candidates.flatMap((candidate) => candidate.constraintResults.map((solver) => ({
      programHash: candidate.programHash,
      constraintId: solver.constraintId,
      solver: solver.solver,
      solverVersion: solver.solverVersion,
      status: solver.status,
      reasonCodes: solver.reasonCodes,
    }))),
    survivors: result.survivingCandidates.map((candidate) => ({ programHash: candidate.programHash, score: candidate.extractionScore ?? null })),
    selectedProgramHash: result.selectedProgramHash,
    tieBreak: result.extractionScore?.tieBreak ?? null,
    searchStats: result.searchStats,
    status: result.status,
    redaction: "STRUCTURED_DECISIONS_ONLY",
  };
}

export function programSearchReceiptToCausalReplayNodes(receipt: ProgramSearchDecisionReceipt): CausalReplayNode[] {
  const source = `decision_context_snapshot.program_search.${receipt.receiptId}`;
  const evidence = [{
    source,
    ref: receipt.receiptId,
    recordedAt: receipt.recordedAt,
    availability: "available" as const,
    integrityHash: deterministicReplayKey(receipt),
  }];
  return [{
    id: `${receipt.receiptId}:search`,
    stage: "planning",
    title: "Bounded program search decision",
    summary: `${receipt.candidateOrigins.length} candidates · ${receipt.survivors.length} legal survivors · ${receipt.status}`,
    status: receipt.status === "SELECTED" ? "resolved" : receipt.status.toLowerCase(),
    occurredAt: receipt.recordedAt,
    sourceRefs: [source],
    evidence,
    facts: {
      goalHash: receipt.goalHash,
      bounds: receipt.bounds,
      solverVersions: receipt.solverVersions,
      candidates: receipt.candidateOrigins,
      rewrites: receipt.rewrites,
      hardRejections: receipt.hardRejections,
      solverResults: receipt.solverResults,
      survivors: receipt.survivors,
      selectedProgramHash: receipt.selectedProgramHash,
      tieBreak: receipt.tieBreak,
    },
    entityRefs: [],
  }];
}
