// Chaos-testing hook — reads FINNOR_CHAOS_KILL_POINT (never set in production; test-only,
// same "env var gated, off by default" convention as AUTH_DEV_BYPASS). When the current
// kill point matches, the process sends itself an unmaskable SIGKILL — a real crash, not
// a graceful exit, so no finally/cleanup code runs. Used by scripts/chaos-test.ts to
// prove exactly-once (or an explicit reconciliation_case) across a real process death.

export type ChaosKillPoint = "pre_commit" | "post_commit_pre_ack" | "mid_multi_step";

export function maybeChaosKill(point: ChaosKillPoint): void {
  if (process.env.FINNOR_CHAOS_KILL_POINT === point) {
    process.kill(process.pid, "SIGKILL");
  }
}
