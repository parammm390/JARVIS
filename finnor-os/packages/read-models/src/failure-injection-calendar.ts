/**
 * A7's durable drill schedule. This is intentionally a calendar, not an executor:
 * disruptive production work still needs the explicit runbook preconditions. Once a
 * drill is performed, its outcome is written to failure_injections and therefore is
 * visible through the existing tenant-scoped read model.
 */
export interface FailureInjectionCalendarEntry {
  kind: "restore_drill" | "secrets_boot" | "pooling_load" | "provider_egress_block" | "worker_kill";
  cadence: "monthly" | "weekly";
  safeSurface: "staging" | "production-with-explicit-approval";
  requiredEvidence: string;
}

export const FAILURE_INJECTION_CALENDAR_V2: readonly FailureInjectionCalendarEntry[] = [
  { kind: "restore_drill", cadence: "monthly", safeSurface: "staging", requiredEvidence: "fresh-target restore verdict with row/content verification" },
  { kind: "secrets_boot", cadence: "monthly", safeSurface: "staging", requiredEvidence: "deliberate refused boot followed by restored healthy boot" },
  { kind: "pooling_load", cadence: "monthly", safeSurface: "staging", requiredEvidence: "bounded concurrent RLS probe with p50/p95 and error rate" },
  { kind: "provider_egress_block", cadence: "weekly", safeSurface: "staging", requiredEvidence: "open -> alert -> recovery evidence against a safe provider" },
  { kind: "worker_kill", cadence: "monthly", safeSurface: "production-with-explicit-approval", requiredEvidence: "worker restart, heartbeat recovery, and no stranded work" },
];
