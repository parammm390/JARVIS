import {
  propositionById,
  requirementResolved,
  type DecisionRequirement,
  type EpistemicState,
} from "@finnor/epistemic-runtime";

export interface KnowledgeSufficiency {
  ready: boolean;
  unresolvedMandatory: string[];
  reasonCodes: string[];
}

/** P4 never acquires information. It consumes only the P3 decision-ready state. */
export function decisionReady(
  state: EpistemicState,
  requirements: readonly DecisionRequirement[],
): KnowledgeSufficiency {
  const unresolvedMandatory = requirements
    .filter((requirement) => requirement.mandatory && !requirementResolved(state, requirement))
    .map((requirement) => requirement.propositionId)
    .sort();
  return {
    ready: unresolvedMandatory.length === 0,
    unresolvedMandatory,
    reasonCodes: unresolvedMandatory.map((id) => `P3_MANDATORY_UNKNOWN:${id}`),
  };
}

export function candidateKnowledgeReady(
  state: EpistemicState,
  requiredPropositionIds: readonly string[],
): KnowledgeSufficiency {
  const unresolvedMandatory = [...new Set(requiredPropositionIds)]
    .filter((id) => propositionById(state, id)?.status !== "KNOWN")
    .sort();
  return {
    ready: unresolvedMandatory.length === 0,
    unresolvedMandatory,
    reasonCodes: unresolvedMandatory.map((id) => `P3_CANDIDATE_MANDATORY_UNKNOWN:${id}`),
  };
}
