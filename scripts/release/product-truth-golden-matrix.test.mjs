import assert from "node:assert/strict"
import test from "node:test"
import { GOLDEN_JOURNEY_IDS, GOLDEN_JOURNEYS, materializeGoldenInstruction, validateGoldenMatrix } from "./product-truth-golden-matrix.mjs"

test("Product Truth certification keeps the permanent 30-journey order and coverage", () => {
  assert.equal(GOLDEN_JOURNEYS.length, 30)
  assert.deepEqual(GOLDEN_JOURNEYS.map((row) => row.id), GOLDEN_JOURNEY_IDS)
  assert.doesNotThrow(() => validateGoldenMatrix())
  assert.match(materializeGoldenInstruction(GOLDEN_JOURNEYS[0], "probe"), /probe/)
})

test("golden matrix validation rejects a missing or duplicate journey", () => {
  assert.throws(() => validateGoldenMatrix(GOLDEN_JOURNEYS.slice(0, 29)), /exactly 30/)
  const duplicate = [...GOLDEN_JOURNEYS]
  duplicate[29] = { ...duplicate[29], id: duplicate[0].id }
  assert.throws(() => validateGoldenMatrix(duplicate), /duplicate|order\/coverage/i)
})

