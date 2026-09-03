const childProcess = require("node:child_process")
const { syncBuiltinESMExports } = require("node:module")

const originalExecFile = childProcess.execFile

function argValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function withAwsDefaults(args, region) {
  const next = [...args]
  if (!next.includes("--region")) next.push("--region", region)
  if (!next.includes("--no-cli-pager")) next.push("--no-cli-pager")
  return next
}

function execAws(args, region, timeout = 60_000, env = process.env) {
  return new Promise((resolve, reject) => {
    originalExecFile(
      "aws",
      withAwsDefaults(args, region),
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout,
        env: { ...env, AWS_PAGER: "" },
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout
          error.stderr = stderr
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

async function refreshAwsOidcCredentials(region) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim()
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim()
  const roleArn = process.env.AWS_ROLE_ARN?.trim()
  if (!requestUrl || !requestToken || !roleArn) {
    throw new Error("Human Black-Box worker restart requires fresh GitHub OIDC variables and AWS_ROLE_ARN")
  }

  const url = new URL(requestUrl)
  url.searchParams.set("audience", "sts.amazonaws.com")
  const oidcResponse = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  const oidcBody = await oidcResponse.json().catch(() => null)
  if (!oidcResponse.ok || typeof oidcBody?.value !== "string" || !oidcBody.value) {
    throw new Error(`GitHub OIDC token refresh failed: HTTP ${oidcResponse.status}`)
  }

  const unsignedEnv = { ...process.env }
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN"]) delete unsignedEnv[name]
  const sessionName = `finnor-human-bb-${Date.now()}`.slice(0, 64)
  const assumed = await execAws([
    "sts", "assume-role-with-web-identity",
    "--role-arn", roleArn,
    "--role-session-name", sessionName,
    "--web-identity-token", oidcBody.value,
    "--duration-seconds", "3600",
    "--output", "json",
  ], region, 60_000, unsignedEnv)
  const credentials = parseJson(assumed.stdout, "STS OIDC credential refresh").Credentials
  if (!credentials?.AccessKeyId || !credentials?.SecretAccessKey || !credentials?.SessionToken) {
    throw new Error("STS OIDC credential refresh returned incomplete credentials")
  }

  process.env.AWS_ACCESS_KEY_ID = credentials.AccessKeyId
  process.env.AWS_SECRET_ACCESS_KEY = credentials.SecretAccessKey
  process.env.AWS_SESSION_TOKEN = credentials.SessionToken
  if (credentials.Expiration) process.env.AWS_CREDENTIAL_EXPIRATION = credentials.Expiration
}

async function runAws(args, region, timeout = 60_000) {
  return execAws(args, region, timeout, process.env)
}

async function listRunningTasks(cluster, service, region) {
  const result = await runAws([
    "ecs", "list-tasks",
    "--cluster", cluster,
    "--service-name", service,
    "--desired-status", "RUNNING",
    "--output", "json",
  ], region)
  return parseJson(result.stdout, "ECS task list").taskArns ?? []
}

async function describeService(cluster, service, region) {
  const result = await runAws([
    "ecs", "describe-services",
    "--cluster", cluster,
    "--services", service,
    "--output", "json",
  ], region)
  return parseJson(result.stdout, "ECS service description").services?.[0] ?? null
}

function isForcedWorkerRestart(command, args) {
  return command === "aws"
    && Array.isArray(args)
    && args[0] === "ecs"
    && args[1] === "update-service"
    && args.includes("--force-new-deployment")
}

childProcess.execFile = function hardenedExecFile(command, args, options, callback) {
  if (!isForcedWorkerRestart(command, args)) {
    return originalExecFile(command, args, options, callback)
  }

  ;(async () => {
    const cluster = argValue(args, "--cluster")
    const service = argValue(args, "--service")
    const region = argValue(args, "--region") || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
    if (!cluster || !service) throw new Error("worker restart hardening could not resolve ECS cluster/service")

    // The release job can run long enough for its original one-hour STS session
    // to age out. Refresh from the job's GitHub OIDC identity immediately before
    // the late worker-restart certification instead of trusting old credentials.
    await refreshAwsOidcCredentials(region)

    const beforeTasks = await listRunningTasks(cluster, service, region)
    if (beforeTasks.length < 1) throw new Error("worker restart hardening found no running ECS task before forced deployment")

    const update = await runAws(args, region, 120_000)
    const deadline = Date.now() + 15 * 60 * 1000

    while (Date.now() < deadline) {
      const [serviceState, runningTasks] = await Promise.all([
        describeService(cluster, service, region),
        listRunningTasks(cluster, service, region),
      ])
      const primary = serviceState?.deployments?.find((deployment) => deployment.status === "PRIMARY")
      const stable = Boolean(
        serviceState
        && serviceState.desiredCount === serviceState.runningCount
        && serviceState.pendingCount === 0
        && serviceState.deployments?.length === 1
        && (primary?.rolloutState === undefined || primary?.rolloutState === "COMPLETED")
      )
      const turnedOver = Boolean(
        serviceState
        && runningTasks.length === serviceState.desiredCount
        && runningTasks.length > 0
        && runningTasks.every((arn) => !beforeTasks.includes(arn))
      )
      if (stable && turnedOver) return { stdout: update.stdout, stderr: update.stderr }
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }

    throw new Error("ECS forced worker restart did not stabilize on a replacement task within 15 minutes")
  })().then(
    ({ stdout, stderr }) => callback(null, stdout, stderr),
    (error) => callback(error, error?.stdout ?? "", error?.stderr ?? error?.message ?? String(error)),
  )

  return undefined
}

syncBuiltinESMExports()
