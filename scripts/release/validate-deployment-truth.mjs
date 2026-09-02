import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContract } from "./release-policy.mjs"

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const contract = loadContract()
const failures = []
const fail = (message) => failures.push(message)
const required = (value, message) => { if (!value) fail(message) }

if (contract.schemaVersion !== 2 || contract.environment !== "production") fail("contract schema/environment is invalid")
if (contract.canonicalGit.branch !== "main" || contract.canonicalGit.remote !== "origin" || contract.canonicalGit.repository !== "parammm390/finnor-ai") fail("canonical Git target must be origin/main for parammm390/finnor-ai")
if (!contract.canonicalGit.requireCleanWorktree) fail("production contract must require a clean worktree")
if (contract.release.concurrencyGroup !== "finnor-production-release") fail("production concurrency lock changed")
if (!/^\d{4}_.+\.sql$/.test(contract.release.requiredMigrationHead)) fail("required migration head is invalid")
for (const name of ["frontend", "api", "worker", "orchestrator", "database"]) if (!contract.topology[name]) fail(`topology is missing ${name}`)
if (contract.topology.frontend.provider !== "vercel" || contract.topology.api.provider !== "vercel") fail("frontend/API provider must be Vercel")
for (const name of ["frontend", "api"]) {
  const target = contract.topology[name]
  if (!target.releaseWorkingDirectory || target.installCommand !== "npm ci") fail(`${name} must use a source-locked npm ci build contract`)
}

const worker = contract.topology.worker
if (worker.provider !== "aws-ecs-fargate") fail("worker provider must be AWS ECS Fargate")
for (const key of ["accountId", "region", "stackName", "vpcId", "clusterName", "serviceName", "taskFamily", "containerName", "ecrRepository", "loadBalancerName", "targetGroupName", "executionRoleName", "taskRoleName", "githubActionsRoleName", "logGroupName", "sseGatewayUrl"]) required(worker[key], `AWS worker contract is missing ${key}`)
if (worker.accountId !== "601804670058" || worker.region !== "us-east-1") fail("AWS worker account or region differs from the authenticated production target")
if (!Array.isArray(worker.publicSubnetIds) || worker.publicSubnetIds.length !== 2 || new Set(worker.publicSubnetIds).size !== 2) fail("AWS worker contract must contain exactly two public subnets")
for (const [key, value] of [["containerPort", 8090], ["sseGatewayPort", 8090], ["desiredCount", 1], ["cpu", 512], ["memory", 1024], ["logRetentionDays", 7]]) if (worker[key] !== value) fail(`AWS worker ${key} must be ${value}`)
for (const [key, value] of [["autoscaling", false], ["fargateSpot", false], ["natGateway", false], ["sseGatewayEnabled", true]]) if (worker[key] !== value) fail(`AWS worker ${key} must be ${value}`)
if (worker.sseGatewayUrl !== "https://realtime.finnorai.com") fail("AWS worker SSE URL drifted")
if (Object.keys(worker.secretMap ?? {}).sort().join(",") !== ["DATABASE_URL", "GROQ_API_KEY", "REDIS_URL", "SENTRY_DSN", "SUPABASE_SERVICE_ROLE_KEY", "VAPI_API_KEY", "VAPI_WEBHOOK_SECRET"].join(",")) fail("AWS worker secret map does not preserve the canonical seven managed secrets")
if (worker.sseGatewayPort !== worker.containerPort) fail("SSE and worker ports must remain one process/one port")
if (contract.topology.orchestrator.separateDeployment !== false || contract.topology.orchestrator.mode !== "embedded-worker" || contract.topology.orchestrator.releaseIdentity !== "worker") fail("orchestrator must remain embedded in the worker")
if (!contract.topology.orchestrator.requiredCapability) fail("embedded orchestrator capability is missing")
if (!contract.release.requiredComponents.includes("worker")) fail("worker must be required for every production release")

const migrationPath = join(repoRoot, "finnor-os/packages/db/migrations", contract.release.requiredMigrationHead)
if (!existsSync(migrationPath)) fail(`required migration does not exist: ${relative(repoRoot, migrationPath)}`)
for (const obsolete of ["finnor-os/railway.json", "finnor-os/railway.staging.json", "finnor-os/infra/deployment/worker-service.yaml"]) if (existsSync(join(repoRoot, obsolete))) fail(`obsolete deployment surface still exists: ${obsolete}`)

const dockerfile = readFileSync(join(repoRoot, "finnor-os/Dockerfile.worker"), "utf8")
const dockerignore = readFileSync(join(repoRoot, "finnor-os/.dockerignore"), "utf8")
for (const invariant of ["FROM node:22", "COPY package.json package-lock.json", "COPY apps ./apps", "COPY packages ./packages", "COPY scripts ./scripts", "npm ci", "EXPOSE 8090", "apps/worker/src/index.ts"]) if (!dockerfile.includes(invariant)) fail(`worker container lost ${invariant}`)
for (const invariant of [".env", ".vercel", "node_modules", ".git"]) if (!dockerignore.includes(invariant)) fail(`worker Docker context does not exclude ${invariant}`)
const cfnPath = join(repoRoot, "infra/aws/finnor-production.yaml")
if (!existsSync(cfnPath)) fail("AWS CloudFormation target template is missing")
else {
  const cfn = readFileSync(cfnPath, "utf8")
  for (const invariant of ["AWSAgentToolkit: aws-cloudformation@2", "AWS::ECR::Repository", "ImageTagMutability: IMMUTABLE", "AWS::ECS::Cluster", "AWS::ECS::Service", "AWS::ElasticLoadBalancingV2::LoadBalancer", "AWS::ElasticLoadBalancingV2::Listener", "HealthCheckPath: /healthz", "AssignPublicIp: ENABLED", "MinimumHealthyPercent: 100", "MaximumPercent: 200", "Rollback: true", "RetentionInDays: 7", "aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeLoadBalancerAttributes", "ec2:DescribeSecurityGroups", "ec2:DescribeNatGateways"]) if (!cfn.includes(invariant)) fail(`AWS template lost ${invariant}`)
}

const workflowPath = join(repoRoot, ".github/workflows/production-release.yml")
const workflow = readFileSync(workflowPath, "utf8")
const activeFiles = [
  workflowPath,
  join(repoRoot, "scripts/release/release-policy.mjs"),
  join(repoRoot, "scripts/release/preflight-production.mjs"),
  join(repoRoot, "scripts/release/deploy-aws-worker.mjs"),
  join(repoRoot, "finnor-os/apps/api/lib/worker-readiness.ts"),
  join(repoRoot, "finnor-os/scripts/release/migrate-production.ts"),
  join(repoRoot, "scripts/release/verify-production-parity.mjs"),
  join(repoRoot, "scripts/release/deploy-production.mjs"),
  join(repoRoot, "scripts/release/certify-product-truth-deployed.mjs"),
  join(repoRoot, "package.json"),
]
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml"])
function scanActiveSource(path) {
  if (!existsSync(path)) return
  const info = statSync(path)
  if (info.isDirectory()) { for (const name of readdirSync(path)) scanActiveSource(join(path, name)); return }
  if (!sourceExtensions.has(extname(path))) return
  const content = readFileSync(path, "utf8")
  const forbidden = /(?:\bazure\b|AZURE_|azure-vm|azure\.com|cloudapp\.azure|RunCommand|run-command|RunCommandLinux|deploy-azure|recover-azure|configure-azure|systemdUnit|\/srv\/finnor|\/etc\/finnor|\brailway\b|render\.com)/i
  if (forbidden.test(content)) fail(`active release/runtime source mentions a retired provider or remote VM machinery: ${relative(repoRoot, path)}`)
}
for (const file of activeFiles) scanActiveSource(file)
scanActiveSource(join(repoRoot, "finnor-os/apps/worker/src"))

if (workflow.includes("azure/login") || /\baz\s+(?:vm|login)\b/.test(workflow)) fail("production workflow still authenticates or mutates Azure")
for (const invariant of [
  "aws-actions/configure-aws-credentials@v4",
  "docker build",
  "docker run",
  "--entrypoint npx",
  "tsx -e",
  "docker push",
  "preflight-production.mjs",
  "configure-vercel-realtime.mjs --apply",
  "deploy-production.mjs frontend --stage-only",
  "deploy-production.mjs api --stage-only",
  "release:migrate:production",
  "deploy-aws-worker.mjs",
  "verify-production-parity.mjs",
  "verify-consecutive-human-certifications.mjs",
]) if (!workflow.includes(invariant)) fail(`production workflow omits guarded AWS stage: ${invariant}`)
if (/\b(?:prj_|team_)[A-Za-z0-9]+/.test(workflow)) fail("production workflow must resolve Vercel target IDs from the canonical contract")
if (!workflow.includes("production.contract.json').topology.api") || !readFileSync(join(repoRoot, "scripts/release/deploy-production.mjs"), "utf8").includes("infra/deployment/production.contract.json")) fail("Vercel release stages must consume the canonical deployment contract")

const credentialGateAt = workflow.indexOf("Require production credentials before any mutation")
const oidcAt = workflow.indexOf("aws-actions/configure-aws-credentials@v4")
const dockerPushAt = workflow.indexOf("docker push")
const preflightAt = workflow.indexOf("preflight-production.mjs")
const stageFrontendAt = workflow.indexOf("deploy-production.mjs frontend --stage-only")
const stageApiAt = workflow.indexOf("deploy-production.mjs api --stage-only")
const migrationAt = workflow.indexOf("release:migrate:production")
const workerDeployAt = workflow.indexOf("deploy-aws-worker.mjs")
const promoteFrontendAt = workflow.indexOf("deploy-production.mjs frontend --promote-only")
const promoteApiAt = workflow.indexOf("deploy-production.mjs api --promote-only")
const parityAt = workflow.indexOf("verify-production-parity.mjs")
const humanAt = workflow.indexOf("for run in 1 2; do")
if ([credentialGateAt, oidcAt, dockerPushAt, preflightAt, stageFrontendAt, stageApiAt, migrationAt, workerDeployAt, promoteFrontendAt, promoteApiAt, parityAt, humanAt].some((value) => value < 0)) fail("production workflow ordering markers are incomplete")
if (!(credentialGateAt < oidcAt && oidcAt < dockerPushAt && dockerPushAt < preflightAt && preflightAt < stageFrontendAt && stageFrontendAt < stageApiAt && stageApiAt < migrationAt && migrationAt < workerDeployAt && workerDeployAt < promoteFrontendAt && promoteFrontendAt < promoteApiAt && promoteApiAt < parityAt && parityAt < humanAt)) fail("production workflow does not preserve the guarded AWS release order")
const nextStepAt = workflow.indexOf("- name:", credentialGateAt + 8)
const credentialGate = workflow.slice(credentialGateAt, nextStepAt < 0 ? workflow.length : nextStepAt)
for (const credential of ["VERCEL_TOKEN", "AWS_ROLE_ARN", "PRODUCT_TRUTH_AUTH_BEARER", "PRODUCT_TRUTH_OTHER_AUTH_BEARER", "PRODUCT_TRUTH_CERTIFICATION_KEY"]) if (!credentialGate.includes(credential)) fail(`pre-mutation credential gate omits ${credential}`)
if (!workflow.includes("FINNOR_ECR_IMAGE_DIGEST=$digest") && !workflow.includes("FINNOR_ECR_IMAGE_DIGEST=")) fail("workflow does not bind the pushed ECR digest into the release environment")
if (!workflow.includes("--database-env finnor-os/apps/api/.vercel/.env.production.local")) fail("AWS worker deploy/parity are not bound to the protected database environment")
if (!workflow.includes("configure-vercel-realtime.mjs --apply")) fail("workflow does not configure the canonical realtime URL")

if (failures.length) {
  console.error(`Deployment truth validation failed:\n- ${failures.join("\n- ")}`)
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, contract: "infra/deployment/production.contract.json", topology: contract.topology }, null, 2))
