import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const TEAM_ID = process.env.VERCEL_ORG_ID || "team_TlTo8L6Rvgb0H7uJh0G5GLDD"
const APPS = {
  frontend: {
    project: "finnor-agency",
    projectId: "prj_dttKVOUzFBGnSg6zNdRualYjQ3oe",
    directory: ".",
  },
  api: {
    project: "api",
    projectId: "prj_BoMZ2AXdLIJQXAAe6RqDGBveyq3n",
    directory: "finnor-os/apps/api",
  },
}

const appName = process.argv[2]
const outputIndex = process.argv.indexOf("--output-file")
const outputFile = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
const app = APPS[appName]

if (!app) {
  console.error("Usage: node scripts/release/deploy-production.mjs <frontend|api> [--output-file path]")
  process.exit(2)
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim()
}

function run(command, args, cwd, env) {
  const safeArgs = args.map((arg, index) => args[index - 1] === "--token" ? "<redacted>" : arg === "--token" ? arg : arg)
  console.log(`$ ${command} ${safeArgs.join(" ")}`)
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status || 1)
  return result.stdout || ""
}

const commitSha = git(["rev-parse", "HEAD"]).toLowerCase()
const dirty = git(["status", "--porcelain=v1", "--untracked-files=all"])
const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0]
const buildId = process.env.FINNOR_BUILD_ID || `finnor-${commitSha.slice(0, 12)}`
const version = process.env.FINNOR_VERSION || `0.1.0+${commitSha.slice(0, 12)}`
const environment = "production"
const source = process.env.FINNOR_RELEASE_SOURCE || (process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "codex-governed-release")

if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error(`HEAD is not a full commit SHA: ${commitSha}`)
if (dirty) throw new Error(`Refusing to deploy a dirty worktree:\n${dirty}`)
if (remoteMain !== commitSha) throw new Error(`Refusing to deploy ${commitSha}; origin/main is ${remoteMain || "missing"}`)
if (buildId !== `finnor-${commitSha.slice(0, 12)}`) throw new Error(`FINNOR_BUILD_ID must be commit-derived: ${buildId}`)
if (!version.endsWith(`+${commitSha.slice(0, 12)}`)) throw new Error(`FINNOR_VERSION must be commit-derived: ${version}`)

const appDir = resolve(repoRoot, app.directory)
const tokenArgs = process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : []
const env = {
  ...process.env,
  FINNOR_COMMIT_SHA: commitSha,
  FINNOR_BUILD_ID: buildId,
  FINNOR_VERSION: version,
  FINNOR_ENVIRONMENT: environment,
  FINNOR_RELEASE_SOURCE: source,
}

run("vercel", ["link", "--project", app.project, "--scope", TEAM_ID, "--yes", ...tokenArgs], appDir, env)
const linkFile = join(appDir, ".vercel", "project.json")
const linkedProject = JSON.parse(readFileSync(linkFile, "utf8"))
if (linkedProject.projectId !== app.projectId || linkedProject.orgId !== TEAM_ID) {
  throw new Error(`Vercel link mismatch: expected ${TEAM_ID}/${app.projectId}, got ${linkedProject.orgId}/${linkedProject.projectId}`)
}

run("vercel", ["pull", "--yes", "--environment=production", "--scope", TEAM_ID, ...tokenArgs], appDir, env)
run("vercel", ["build", "--prod", "--yes", "--scope", TEAM_ID, ...tokenArgs], appDir, env)

const deployArgs = [
  "deploy", "--prebuilt", "--prod", "--yes", "--scope", TEAM_ID,
  "--meta", `finnorCommitSha=${commitSha}`,
  "--meta", `finnorBuildId=${buildId}`,
  "--meta", `finnorVersion=${version}`,
  "--meta", `finnorEnvironment=${environment}`,
  "--meta", `finnorReleaseSource=${source}`,
  "--meta", "gitDirty=0",
  "--meta", "githubDeployment=1",
  "--meta", "githubCommitOrg=parammm390",
  "--meta", "githubCommitRepo=JARVIS",
  "--meta", "githubCommitRef=main",
  "--meta", `githubCommitSha=${commitSha}`,
  "--env", `FINNOR_COMMIT_SHA=${commitSha}`,
  "--env", `FINNOR_BUILD_ID=${buildId}`,
  "--env", `FINNOR_VERSION=${version}`,
  "--env", `FINNOR_ENVIRONMENT=${environment}`,
  "--env", `FINNOR_RELEASE_SOURCE=${source}`,
  ...tokenArgs,
]
const deployOutput = run("vercel", deployArgs, appDir, env)
const urls = [...deployOutput.matchAll(/https:\/\/[^\s)]+/g)].map((match) => match[0].replace(/[.,]+$/, ""))
const deploymentUrl = urls.at(-1)
if (!deploymentUrl) throw new Error("Vercel did not return a deployment URL")

const result = {
  app: appName,
  project: app.project,
  projectId: app.projectId,
  commitSha,
  buildId,
  version,
  environment,
  source,
  dirty: false,
  remoteMain,
  deploymentUrl,
}
if (outputFile) {
  writeFileSync(resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`)
}
console.log(`FINNOR_DEPLOYMENT_URL=${deploymentUrl}`)
console.log(JSON.stringify(result, null, 2))
