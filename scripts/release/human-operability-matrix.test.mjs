import assert from "node:assert/strict"
import test from "node:test"
import {
  HUMAN_OPERABILITY_MATRIX,
  HUMAN_OPERABILITY_SCENARIOS,
  materializeHumanOperabilityInstruction,
  validateHumanOperabilityArtifact,
} from "./human-operability-matrix.mjs"

test("generated Human Operability Matrix covers the exact registry and all required black-box categories", () => {
  assert.doesNotThrow(() => validateHumanOperabilityArtifact())
  assert.equal(HUMAN_OPERABILITY_MATRIX.capabilityCoverage.length, 72)
  assert.equal(HUMAN_OPERABILITY_MATRIX.capabilityCoverage.filter((row) => row.capabilityKind === "ACTION").length, 59)
  assert.equal(HUMAN_OPERABILITY_MATRIX.capabilityCoverage.filter((row) => row.capabilityKind === "QUERY").length, 13)
  assert.equal(HUMAN_OPERABILITY_SCENARIOS.filter((row) => row.category === "canonical_query").length, 13)
})

test("held-out founder English is nonce-scoped and never embeds a typed planner shortcut", () => {
  const heldOut = HUMAN_OPERABILITY_SCENARIOS.filter((row) => row.heldOut)
  assert.ok(heldOut.length >= 8)
  for (const row of heldOut) {
    const prompt = materializeHumanOperabilityInstruction(row, "held-out-probe")
    assert.match(prompt, /held-out-probe/)
    assert.doesNotMatch(prompt, /\b(?:action_type|plugin|planner|execution_model)\b/i)
  }
})
