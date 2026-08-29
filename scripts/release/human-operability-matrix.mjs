import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { GOLDEN_JOURNEY_IDS } from "./product-truth-golden-matrix.mjs"

const matrixPath = resolve(fileURLToPath(new URL("./human-operability-matrix.generated.json", import.meta.url)))
export const HUMAN_OPERABILITY_MATRIX = Object.freeze(JSON.parse(readFileSync(matrixPath, "utf8")))
export const HUMAN_OPERABILITY_SCENARIOS = Object.freeze(HUMAN_OPERABILITY_MATRIX.executableScenarios)

export function materializeHumanOperabilityInstruction(row, nonce) {
  return row.instruction.replaceAll("{nonce}", nonce)
}

export function validateHumanOperabilityArtifact(matrix = HUMAN_OPERABILITY_MATRIX) {
  if (matrix?.version !== 1 || matrix?.generatedFrom?.userCapabilityRegistry !== true) throw new Error("Human Operability Matrix has an invalid generated-source contract")
  if (!Array.isArray(matrix.capabilityCoverage) || matrix.capabilityCoverage.length !== 72) throw new Error("Human Operability Matrix must cover exactly 72 registered capabilities")
  const capabilities = matrix.capabilityCoverage.map((row) => row.capability)
  if (new Set(capabilities).size !== 72) throw new Error("Human Operability Matrix capability coverage contains duplicates")
  const actions = matrix.capabilityCoverage.filter((row) => row.capabilityKind === "ACTION")
  const queries = matrix.capabilityCoverage.filter((row) => row.capabilityKind === "QUERY")
  if (actions.length !== 59 || queries.length !== 13) throw new Error(`Human Operability Matrix registry split is ${actions.length}/${queries.length}, expected 59/13`)
  if (!Array.isArray(matrix.executableScenarios) || matrix.executableScenarios.length < 30) throw new Error("Human Operability Matrix has too few executable black-box scenarios")
  const ids = matrix.executableScenarios.map((row) => row.id)
  if (new Set(ids).size !== ids.length) throw new Error("Human Operability Matrix executable scenarios contain duplicate ids")
  const categories = new Set(matrix.executableScenarios.map((row) => row.category))
  for (const category of ["canonical_query", "objective_pattern", "ambiguity_reference_date", "operating_surface", "failure_recovery", "held_out_founder"]) {
    if (!categories.has(category)) throw new Error(`Human Operability Matrix has no ${category} scenario`)
  }
  for (const row of matrix.executableScenarios) {
    if (!row.instruction?.includes("{nonce}") || !Array.isArray(row.expectedModels) || row.expectedModels.length === 0) throw new Error(`Human scenario ${row.id} has no nonce-scoped English/route contract`)
    if (row.linkedGoldenJourneyId && !GOLDEN_JOURNEY_IDS.includes(row.linkedGoldenJourneyId)) throw new Error(`Human scenario ${row.id} links unknown golden journey ${row.linkedGoldenJourneyId}`)
  }
  if (matrix.executableScenarios.filter((row) => row.heldOut).length < 8) throw new Error("Human Operability Matrix has fewer than eight held-out founder prompts")
  return matrix
}

validateHumanOperabilityArtifact()
