import assert from "node:assert/strict"
import test from "node:test"
import { GOLDEN_JOURNEYS } from "./product-truth-golden-matrix.mjs"
import { HUMAN_OPERABILITY_SCENARIOS } from "./human-operability-matrix.mjs"
import { verifyConsecutiveHumanCertifications } from "./verify-consecutive-human-certifications.mjs"

const SHA = "a".repeat(40)

function certification(run) {
  return {
    ok: true,
    certificationStatus: "HUMAN_BLACK_BOX_RUN_PASS",
    certificationRun: run,
    commitSha: SHA,
    releases: {
      frontend: { commitSha: SHA }, api: { commitSha: SHA }, workerGateway: { commitSha: SHA },
      migrationHead: "0108_operating_product_closure.sql",
    },
    browser: {
      goldenJourneyCount: GOLDEN_JOURNEYS.length,
      goldenMatrix: GOLDEN_JOURNEYS.map((row) => ({ id: row.id, status: "PASS" })),
      humanOperabilityScenarioCount: HUMAN_OPERABILITY_SCENARIOS.length,
      humanOperabilityMatrix: HUMAN_OPERABILITY_SCENARIOS.map((row) => ({ id: row.id, status: "PASS" })),
      registeredCapabilityCount: 72,
    },
  }
}

test("only two consecutive complete same-SHA runs close the product", () => {
  assert.deepEqual(verifyConsecutiveHumanCertifications([certification(1), certification(2)], SHA), {
    ok: true,
    certificationStatus: "OPERATIONALLY_CLOSED",
    commitSha: SHA,
    consecutiveGreenRuns: 2,
    productTruthJourneysPerRun: 30,
    humanOperabilityScenariosPerRun: HUMAN_OPERABILITY_SCENARIOS.length,
    registeredCapabilities: 72,
  })
})

test("one run, a failed row, or release SHA drift cannot claim closure", () => {
  assert.throws(() => verifyConsecutiveHumanCertifications([certification(1)], SHA), /exactly two/)
  const failed = certification(2)
  failed.browser.humanOperabilityMatrix[0].status = "FAIL"
  assert.throws(() => verifyConsecutiveHumanCertifications([certification(1), failed], SHA), /complete Human Operability/)
  const drifted = certification(2)
  drifted.releases.workerGateway.commitSha = "b".repeat(40)
  assert.throws(() => verifyConsecutiveHumanCertifications([certification(1), drifted], SHA), /workerGateway release SHA drifted/)
})
