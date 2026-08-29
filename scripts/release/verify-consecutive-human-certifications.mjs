import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { HUMAN_OPERABILITY_SCENARIOS } from "./human-operability-matrix.mjs"
import { GOLDEN_JOURNEYS } from "./product-truth-golden-matrix.mjs"

export function verifyConsecutiveHumanCertifications(certifications, expectedSha) {
  if (!Array.isArray(certifications) || certifications.length !== 2) throw new Error("Operational closure requires exactly two complete certification runs")
  const observedSha = expectedSha ?? certifications[0]?.commitSha
  if (!/^[0-9a-f]{40}$/i.test(observedSha ?? "")) throw new Error("Certification commit SHA is missing or invalid")
  for (const [index, certification] of certifications.entries()) {
    const run = index + 1
    if (certification?.ok !== true || certification.certificationStatus !== "HUMAN_BLACK_BOX_RUN_PASS" || certification.certificationRun !== run) throw new Error(`Certification run ${run} is incomplete or out of order`)
    if (certification.commitSha !== observedSha) throw new Error(`Certification run ${run} was built from a different commit`)
    if (certification.browser?.goldenJourneyCount !== GOLDEN_JOURNEYS.length || certification.browser?.goldenMatrix?.some((row) => row.status !== "PASS")) throw new Error(`Certification run ${run} did not pass all 30 Product Truth journeys`)
    if (certification.browser?.humanOperabilityScenarioCount !== HUMAN_OPERABILITY_SCENARIOS.length || certification.browser?.humanOperabilityMatrix?.some((row) => row.status !== "PASS")) throw new Error(`Certification run ${run} did not pass the complete Human Operability Matrix`)
    if (certification.browser?.registeredCapabilityCount !== 72) throw new Error(`Certification run ${run} did not bind all 72 registered capabilities`)
    for (const component of ["frontend", "api", "workerGateway"]) {
      if (certification.releases?.[component]?.commitSha !== observedSha) throw new Error(`Certification run ${run} ${component} release SHA drifted`)
    }
    if (certification.releases?.migrationHead !== "0108_operating_product_closure.sql") throw new Error(`Certification run ${run} database migration head drifted`)
  }
  return {
    ok: true,
    certificationStatus: "OPERATIONALLY_CLOSED",
    commitSha: observedSha,
    consecutiveGreenRuns: 2,
    productTruthJourneysPerRun: GOLDEN_JOURNEYS.length,
    humanOperabilityScenariosPerRun: HUMAN_OPERABILITY_SCENARIOS.length,
    registeredCapabilities: 72,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2)
  if (paths.length !== 2) throw new Error("Usage: node verify-consecutive-human-certifications.mjs <run-1.json> <run-2.json>")
  const certifications = paths.map((path) => JSON.parse(readFileSync(path, "utf8")))
  console.log(JSON.stringify(verifyConsecutiveHumanCertifications(certifications, process.env.RELEASE_COMMIT_SHA), null, 2))
}
