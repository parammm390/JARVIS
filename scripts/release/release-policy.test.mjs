import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"
import {
  assertAlbTargetsHealthy,
  assertAwsTarget,
  assertAwsWorkerHealth,
  assertCanonicalRelease,
  assertEcsDeploymentStable,
  assertFreshAwsPreflight,
  assertImmutableEcrRelease,
  assertRuntimeParity,
  assertWorkerHeartbeat,
  expectedRelease,
  loadContract,
} from "./release-policy.mjs"

const contract = loadContract()
const SHA = "a".repeat(40)
const expected = expectedRelease(SHA)

test("the production contract is the AWS embedded-worker topology", () => {
  const worker = contract.topology.worker
  assert.equal(contract.canonicalGit.repository, "parammm390/finnor-ai")
  assert.equal(worker.provider, "aws-ecs-fargate")
  assert.equal(worker.accountId, "601804670058")
  assert.equal(worker.region, "us-east-1")
  assert.equal(worker.clusterName, "finnor-production")
  assert.equal(worker.serviceName, "finnor-worker")
  assert.equal(worker.sseGatewayUrl, "https://realtime.finnorai.com")
  assert.equal(contract.topology.orchestrator.separateDeployment, false)
  assert.equal(contract.topology.orchestrator.releaseIdentity, "worker")
  const serialized = JSON.stringify(worker)
  assert.doesNotMatch(serialized, /azure|systemd|RunCommand|cloudapp\.azure/i)
})

test("canonical Git and AWS target guards reject drift", () => {
  assert.throws(() => assertCanonicalRelease({ head: SHA, remoteMain: "b".repeat(40), dirty: "" }), /canonical remote main/)
  const base = { accountId: "601804670058", region: "us-east-1", clusterName: "finnor-production", serviceName: "finnor-worker", taskFamily: "finnor-worker", ecrRepository: "finnor-worker" }
  for (const [key, value] of [["accountId", "wrong"], ["region", "ap-southeast-1"], ["clusterName", "wrong"], ["serviceName", "wrong"]]) {
    assert.throws(() => assertAwsTarget(contract, { ...base, [key]: value }), new RegExp(`AWS ${key}`))
  }
})

test("ECR release guards reject missing, mutable, and mismatched images", () => {
  const repository = { imageTagMutability: "IMMUTABLE" }
  const image = { imageDigest: "sha256:" + "1".repeat(64), imageTags: [SHA] }
  assert.equal(assertImmutableEcrRelease({ repository, image, expectedCommitSha: SHA, expectedDigest: image.imageDigest }), image.imageDigest)
  assert.throws(() => assertImmutableEcrRelease({ repository: { imageTagMutability: "MUTABLE" }, image, expectedCommitSha: SHA }), /mutable/)
  assert.throws(() => assertImmutableEcrRelease({ repository, image: undefined, expectedCommitSha: SHA }), /missing/)
  assert.throws(() => assertImmutableEcrRelease({ repository, image, expectedCommitSha: SHA, expectedDigest: "sha256:" + "2".repeat(64) }), /differs/)
})

test("preflight evidence is bound to the exact contract hash and freshness window", () => {
  const evidence = { ok: true, checkedAt: new Date(1_000).toISOString(), commitSha: SHA, remoteMain: SHA, contractSha256: "hash" }
  assert.equal(assertFreshAwsPreflight(evidence, { commitSha: SHA, contractHash: "hash", now: 1_000 + 1_000 }), 1_000)
  assert.throws(() => assertFreshAwsPreflight({ ...evidence, checkedAt: new Date(1).toISOString() }, { commitSha: SHA, contractHash: "hash", now: 30 * 60 * 1000 }), /fresh/)
  assert.throws(() => assertFreshAwsPreflight({ ...evidence, contractSha256: "wrong" }, { commitSha: SHA, contractHash: "hash", now: 1_000 }), /fresh/)
})

test("ECS rollout and ALB target guards fail closed", () => {
  const arn = "arn:aws:ecs:us-east-1:601804670058:task-definition/finnor-worker:2"
  const stable = { desiredCount: 1, runningCount: 1, pendingCount: 0, deployments: [{ status: "PRIMARY", taskDefinition: arn }] }
  assert.doesNotThrow(() => assertEcsDeploymentStable(stable, arn, 1))
  assert.throws(() => assertEcsDeploymentStable({ ...stable, deployments: [{ status: "PRIMARY", taskDefinition: arn }, { status: "ACTIVE", taskDefinition: "old" }] }, arn, 1), /stable/)
  assert.doesNotThrow(() => assertAlbTargetsHealthy([{ TargetHealth: { State: "healthy" } }]))
  assert.throws(() => assertAlbTargetsHealthy([]), /healthy/)
  assert.throws(() => assertAlbTargetsHealthy([{ TargetHealth: { State: "unhealthy", Reason: "Target.Timeout" } }]), /healthy/)
})

test("worker health and heartbeat guards reject wrong SHA, missing realtime, orchestration, or ECS identity", () => {
  const body = { ok: true, realtime: true, capabilities: ["jobs", "orchestration", "realtime", "sse"], release: expected }
  assert.doesNotThrow(() => assertAwsWorkerHealth({ status: 200, body, expected }))
  assert.throws(() => assertAwsWorkerHealth({ status: 200, body: { ...body, release: { ...expected, commitSha: "b".repeat(40) } }, expected }), /exact release/)
  assert.throws(() => assertAwsWorkerHealth({ status: 200, body: { ...body, capabilities: ["jobs", "sse"] }, expected }), /missing orchestration/)
  assert.throws(() => assertAwsWorkerHealth({ status: 200, body: { ...body, realtime: false }, expected }), /exact release/)
  const heartbeat = { releaseSha: SHA, buildId: expected.buildId, version: expected.version, releaseSource: expected.source, environment: expected.environment, migrationHead: "0108_operating_product_closure.sql", deploymentId: "ecs:finnor-production:finnor-worker:" + SHA, capabilities: body.capabilities, ageSeconds: 10 }
  assert.doesNotThrow(() => assertWorkerHeartbeat(heartbeat, expected, "0108_operating_product_closure.sql"))
  assert.throws(() => assertWorkerHeartbeat({ ...heartbeat, releaseSha: "b".repeat(40) }, expected, "0108_operating_product_closure.sql"), /heartbeat/)
  assert.throws(() => assertWorkerHeartbeat({ ...heartbeat, deploymentId: "azure:old" }, expected, "0108_operating_product_closure.sql"), /heartbeat/)
})

test("active release path has no Azure or static worker AWS credential seam", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/production-release.yml", import.meta.url), "utf8")
  const worker = readFileSync(new URL("../../finnor-os/apps/worker/src/index.ts", import.meta.url), "utf8")
  assert.doesNotMatch(workflow, /azure\/login|AZURE_|deploy-azure|recover-azure|RunCommand|cloudapp\.azure/i)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /docker build/)
  assert.match(workflow, /docker push/)
  assert.doesNotMatch(worker, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/)
})

test("the release certifies staged artifacts before promotion and smoke-tests production once", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/production-release.yml", import.meta.url), "utf8")
  const refreshUrl = new URL("./refresh-product-truth-auth.mjs", import.meta.url)
  const restartUrl = new URL("../../.github/scripts/certification-aws-hardening.cjs", import.meta.url)
  const refresh = readFileSync(refreshUrl, "utf8")
  const restartHardening = readFileSync(restartUrl, "utf8")
  const cfn = readFileSync(new URL("../../infra/aws/finnor-production.yaml", import.meta.url), "utf8")
  const githubRole = cfn.slice(cfn.indexOf("  GitHubActionsRole:"), cfn.indexOf("  AlbSecurityGroup:"))

  execFileSync(process.execPath, ["--check", fileURLToPath(refreshUrl)], { stdio: "pipe" })
  execFileSync(process.execPath, ["--check", fileURLToPath(restartUrl)], { stdio: "pipe" })

  assert.match(refresh, /SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/)
  assert.match(refresh, /protected production env is missing Supabase admin configuration/)
  assert.match(refresh, /--validate-only/)
  assert.doesNotMatch(refresh, /SecretsManagerClient|GetSecretValueCommand|secretsmanager/)

  const authPreflight = workflow.indexOf("Validate Product Truth auth chain before expensive mutation")
  const imageBuild = workflow.indexOf("Build, smoke-test, and push exact worker image to ECR")
  assert.ok(authPreflight > 0 && authPreflight < imageBuild)
  assert.match(workflow, /refresh-product-truth-auth\.mjs[\s\S]*--validate-only/)

  const certificationBlock = workflow.slice(workflow.indexOf("Certify the staged production-equivalent environment twice"), workflow.indexOf("Promote certified frontend artifact"))
  assert.match(certificationBlock, /for run in 1 2/)
  assert.match(certificationBlock, /PRODUCT_TRUTH_CERTIFICATION_MODE=full/)
  assert.match(certificationBlock, /PRODUCT_TRUTH_FRONTEND_URL/)
  assert.match(certificationBlock, /PRODUCT_TRUTH_API_URL/)
  assert.match(certificationBlock, /refresh-product-truth-auth\.mjs/)
  assert.match(certificationBlock, /export PRODUCT_TRUTH_AUTH_BEARER/)
  assert.match(certificationBlock, /export PRODUCT_TRUTH_OTHER_AUTH_BEARER/)
  assert.match(certificationBlock, /certification-aws-hardening\.cjs/)

  assert.match(restartHardening, /ACTIONS_ID_TOKEN_REQUEST_URL/)
  assert.match(restartHardening, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/)
  assert.match(restartHardening, /AWS_ROLE_ARN/)
  assert.match(restartHardening, /audience["']?,\s*["']sts\.amazonaws\.com/)
  assert.match(restartHardening, /assume-role-with-web-identity/)
  const credentialRefresh = restartHardening.indexOf("await refreshAwsOidcCredentials(region)")
  const preRestartTasks = restartHardening.indexOf("const beforeTasks = await listRunningTasks")
  assert.ok(credentialRefresh > 0 && credentialRefresh < preRestartTasks)
  assert.match(restartHardening, /--force-new-deployment/)
  assert.match(restartHardening, /deployments\?\.length === 1/)
  assert.match(restartHardening, /runningTasks\.every\(\(arn\) => !beforeTasks\.includes\(arn\)\)/)
  assert.match(githubRole, /ecs:UpdateService/)
  assert.match(githubRole, /ecs:ListTasks/)
  assert.match(githubRole, /ecs:DescribeServices/)

  const stagedAt = workflow.indexOf("Certify the staged production-equivalent environment twice")
  const promoteAt = workflow.indexOf("Promote certified frontend artifact")
  const smokeAt = workflow.indexOf("Run bounded five-minute production smoke")
  const rollbackAt = workflow.indexOf("Automatic rollback after any post-mutation gate failure")
  assert.ok(stagedAt < promoteAt && promoteAt < smokeAt && smokeAt < rollbackAt)
  const smokeBlock = workflow.slice(smokeAt, rollbackAt)
  assert.match(smokeBlock, /PRODUCT_TRUTH_CERTIFICATION_MODE=smoke/)
  assert.match(smokeBlock, /timeout 300s/)
  assert.doesNotMatch(smokeBlock, /for run in 1 2/)
  assert.match(workflow, /capture-production-state\.mjs/)
  assert.match(workflow, /rollback-production\.mjs/)
})

test("ECS task role trusts are scoped to this account's ECS source ARNs", () => {
  const cfn = readFileSync(new URL("../../infra/aws/finnor-production.yaml", import.meta.url), "utf8")
  assert.equal((cfn.match(/aws:SourceArn: !Sub 'arn:\${AWS::Partition}:ecs:\${AWS::Region}:\${AWS::AccountId}:\*'/g) ?? []).length, 2)
  assert.equal((cfn.match(/aws:SourceAccount: !Ref AWS::AccountId/g) ?? []).length, 2)
})

test("API readiness cannot be satisfied by a non-ECS or capability-incomplete worker heartbeat", () => {
  const readiness = readFileSync(new URL("../../finnor-os/apps/api/lib/worker-readiness.ts", import.meta.url), "utf8")
  assert.match(readiness, /deployment_id\s+LIKE\s+'ecs:%'/)
  assert.match(readiness, /environment='production'/)
  assert.match(readiness, /capabilities\s+@>\s+ARRAY\['jobs','orchestration','realtime','sse'\]::text\[\]/)
})

test("every production JARVIS thread renderer exposes the exact canonical Work projection contract", () => {
  const renderers = [
    new URL("../../src/components/jarvis/bridge/Thread.tsx", import.meta.url),
    new URL("../../src/components/jarvis/workspaces/AdaptiveWorkspaceShell.tsx", import.meta.url),
  ]
  const requiredBindings = [
    /data-thread-document/,
    /data-jarvis-instruction-id=\{thread\??\./,
    /data-jarvis-work-id=\{thread\??\./,
    /data-jarvis-objective-loop-id=\{thread\??\./,
    /data-jarvis-execution-model=\{thread\??\./,
    /data-jarvis-assistant-semantic-kind=\{thread\??\./,
    /data-jarvis-objective-state=\{thread\??\./,
    /data-jarvis-instruction-state=\{thread\??\./,
    /data-jarvis-work-posture=\{thread\??\./,
  ]
  for (const renderer of renderers) {
    const source = readFileSync(renderer, "utf8")
    for (const binding of requiredBindings) assert.match(source, binding, `${renderer.pathname} is missing ${binding}`)
  }
})

test("runtime parity requires jobs, orchestration, realtime, SSE, and exact migration", () => {
  const observed = {
    frontend: { ...expected, service: "finnor-frontend", traceable: true },
    api: { ...expected, service: "finnor-api", traceable: true },
    worker: { ...expected, service: "finnor-worker", traceable: true, capabilities: ["jobs", "orchestration", "realtime", "sse"] },
    migrationHead: "0108_operating_product_closure.sql",
  }
  assert.doesNotThrow(() => assertRuntimeParity(contract, expected, observed))
  assert.throws(() => assertRuntimeParity(contract, expected, { ...observed, worker: { ...observed.worker, capabilities: ["jobs"] } }), /orchestrator/)
})
