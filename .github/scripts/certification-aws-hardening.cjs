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

function runAws(args, region, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    originalExecFile(
      "aws",
      withAwsDefaults(args, region),
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout,
        env: { ...process.env, AWS_PAGER: "" },
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
