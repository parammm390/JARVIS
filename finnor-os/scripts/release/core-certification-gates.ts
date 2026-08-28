import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { gateResult, type CertificationGateResult, type CertificationStatus } from "./certification-model";
import type { CoreDiffResult } from "./core-diff-guard";

interface CommandSpec {
  command: string;
  args: string[];
  cwd: "repo" | "finnor-os";
  env?: Record<string, string>;
}

export const CORE_COMMAND_MATRIX: Record<string, CommandSpec[]> = {
  // Run the clean-source invariant before evidence-producing gates write their
  // deterministic reports. The source diff was independently captured before this
  // matrix starts, so later generated evidence cannot mask a dirty core tree.
  release_deployment_invariants: [
    { command: "npm", args: ["run", "release:verify"], cwd: "repo" },
  ],
  typecheck_build: [
    { command: "npm", args: ["run", "typecheck"], cwd: "finnor-os" },
    { command: "npm", args: ["run", "build"], cwd: "repo" },
  ],
  unit_integration: [
    { command: "npm", args: ["test"], cwd: "finnor-os" },
  ],
  migrations: [
    { command: "npm", args: ["run", "db:bundle"], cwd: "finnor-os" },
    { command: "git", args: ["diff", "--exit-code", "--", "finnor-os/packages/db/migrations-bundle.ts"], cwd: "repo" },
    { command: "npm", args: ["run", "db:migrate"], cwd: "finnor-os" },
    { command: "npm", args: ["run", "setup:langgraph"], cwd: "finnor-os" },
  ],
  tenant_rls_security: [
    { command: "npm", args: ["test", "--", "--run", "tests/integration/tenant-isolation.test.ts", "tests/integration/tenant-credential-isolation.test.ts", "tests/integration/authz.test.ts", "tests/unit/api-route-auth-boundary.test.ts", "tests/unit/secrets.test.ts"], cwd: "finnor-os" },
  ],
  action_contracts: [
    { command: "npm", args: ["run", "release:manifest"], cwd: "finnor-os" },
    { command: "npm", args: ["run", "release:contract"], cwd: "finnor-os" },
  ],
  policy_approval_boundaries: [
    { command: "npm", args: ["run", "policy:lint"], cwd: "finnor-os" },
    { command: "npm", args: ["test", "--", "--run", "tests/integration/policy-engine-v2.test.ts", "tests/integration/rbac-approval.test.ts", "tests/integration/employee-authority-runtime.test.ts", "tests/integration/receipt-policy-and-approver.test.ts"], cwd: "finnor-os" },
  ],
  workflow_runtime_recovery: [
    { command: "npm", args: ["test", "--", "--run", "tests/integration/workflow-runtime.test.ts", "tests/integration/langgraph-workflow-actions.test.ts", "tests/integration/compensation.test.ts", "tests/integration/chaos-matrix.test.ts", "tests/integration/poison-job-replay-drill.test.ts"], cwd: "finnor-os" },
  ],
  queue_idempotency: [
    { command: "npm", args: ["test", "--", "--run", "tests/integration/queue.test.ts", "tests/integration/intake-idempotency.test.ts", "tests/integration/external-operations-idempotency.test.ts", "tests/integration/inbox-dedup.test.ts", "tests/integration/outbox-dispatch.test.ts"], cwd: "finnor-os" },
  ],
  load_latency_reliability: [
    { command: "npm", args: ["run", "release:query-latency", "--", "--seed"], cwd: "finnor-os" },
    { command: "npm", args: ["run", "release:load"], cwd: "finnor-os" },
  ],
};

/**
 * The P3 load runner is a real staging exercise, not a local unit-test substitute.
 * Production release CI is allowed to certify the immutable source/build/migration
 * boundary without silently sending traffic to an unconfigured staging target. The
 * resulting gate remains explicit about the deferred staging evidence; the default
 * (non-production) matrix still runs the complete load contract and remains fail
 * closed when its required target/tokens are absent.
 */
export const PRODUCTION_RELEASE_PROFILE = "production" as const;

export interface CommandObservation {
  command: string;
  cwd: string;
  exitCode: number;
  status: CertificationStatus;
}

function blockedConfiguration(output: string): boolean {
  return /BLOCKED[-_ ]CONFIG|(?:environment variable|env(?:ironment)?|secret|credential|configuration|config)\b.{0,80}\b(?:required|missing|not set|unset)\b|\b(?:required|missing|unset)\b.{0,80}\b(?:environment variable|secret|credential|configuration)\b|must provide.{0,80}(?:credential|config|environment)|no .{0,40} credential/i.test(output);
}

function runCommand(repoRoot: string, spec: CommandSpec): CommandObservation {
  const cwd = spec.cwd === "repo" ? repoRoot : join(repoRoot, "finnor-os");
  const isTestCommand = spec.command === "npm" && spec.args.includes("test");
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    // Release metadata is intentionally production-shaped in the parent
    // certification process. Test children must still exercise their local
    // degradation paths (for example Redis fallback) rather than inheriting a
    // production environment and failing closed for the wrong reason.
    env: {
      ...process.env,
      ...spec.env,
      ...(isTestCommand ? { NODE_ENV: "test", FINNOR_ENVIRONMENT: "test" } : {}),
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 40 * 60_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? (result.error?.message ?? "");
  const exitCode = result.status ?? 1;
  return {
    command: `${spec.command} ${spec.args.join(" ")}`,
    cwd: spec.cwd,
    exitCode,
    status: exitCode === 0 ? "PASS" : blockedConfiguration(`${stdout}\n${stderr}`) ? "BLOCKED_CONFIG" : "FAIL",
  };
}

function observationsStatus(observations: CommandObservation[]): CertificationStatus {
  if (observations.some((item) => item.status === "FAIL")) return "FAIL";
  if (observations.some((item) => item.status === "BLOCKED_CONFIG")) return "BLOCKED_CONFIG";
  return "PASS";
}

export function sourceProvenanceGate(diff: CoreDiffResult): CertificationGateResult {
  return gateResult("source_provenance", diff.clean ? "PASS" : "FAIL", {
    canonicalCoreSha: diff.canonicalCoreSha,
    coreSourceTreeHash: diff.coreSourceTreeHash,
    changedSharedCorePaths: diff.changedSharedCorePaths,
    changedClientPathCount: diff.changedClientPaths.length,
    rule: "shared FINNOR core source must match the canonical core SHA",
  });
}

export function runCoreCommandGates(repoRoot: string): CertificationGateResult[] {
  return Object.entries(CORE_COMMAND_MATRIX).map(([gate, commands]) => {
    if (gate === "load_latency_reliability" && process.env.FINNOR_RELEASE_PROFILE === PRODUCTION_RELEASE_PROFILE) {
      const latency = runCommand(repoRoot, commands[0]!);
      const status = latency.status === "PASS" ? "PASS" : latency.status;
      return gateResult(gate, status, {
        profile: PRODUCTION_RELEASE_PROFILE,
        stagingLoad: {
          status: "BLOCKED_CONFIG",
          deferred: true,
          reason: "P3 staging load certification requires an isolated staging target and 25 authenticated JWTs; production release CI does not invent or reuse those credentials",
        },
        commands: [latency],
      });
    }
    const observations = commands.map((command) => runCommand(repoRoot, command));
    return gateResult(gate, observationsStatus(observations), { commands: observations });
  });
}
