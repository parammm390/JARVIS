// Learning / feedback digest (§9 extension, Pillar 3 — honestly scoped as an
// observability loop, not self-improvement: this computes a report a human reads and
// acts on, e.g. by editing a domain_policies row. Nothing here changes the system's
// own future behavior. Deterministic aggregation only, no LLM call — this is a report,
// not a judgment.

import { withTenant, domainActions, actionLog, scanFindings } from "@finnor/db";
import { and, eq, gte, desc, isNotNull } from "drizzle-orm";

export interface ActionTypeStats {
  actionType: string;
  total: number;
  draft: number;
  pending: number;
  completed: number;
  failed: number;
  rejected: number;
  needsHumanReview: number;
  blockedIntegration: number;
  /** Rows that have left the confirmation queue one way or another (total minus draft/pending). */
  decided: number;
  /** failed / total — of everything drafted, what fraction ended in a real failure. */
  failureRate: number;
  /** rejected / decided — of everything a human actually looked at, what fraction they rejected. */
  rejectionRate: number;
}

/** Pure aggregation — no DB access, unit-testable with fabricated rows. */
export function summarizeActionOutcomes(rows: Array<{ actionType: string; status: string }>): ActionTypeStats[] {
  interface Bucket {
    total: number;
    draft: number;
    pending: number;
    completed: number;
    failed: number;
    rejected: number;
    needsHumanReview: number;
    blockedIntegration: number;
  }
  const byType = new Map<string, Bucket>();
  for (const r of rows) {
    const b: Bucket = byType.get(r.actionType) ?? {
      total: 0,
      draft: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      needsHumanReview: 0,
      blockedIntegration: 0,
    };
    b.total++;
    switch (r.status) {
      case "draft":
        b.draft++;
        break;
      case "pending":
        b.pending++;
        break;
      case "completed":
        b.completed++;
        break;
      case "failed":
        b.failed++;
        break;
      case "rejected":
        b.rejected++;
        break;
      case "needs_human_review":
        b.needsHumanReview++;
        break;
      case "blocked_integration_unavailable":
        b.blockedIntegration++;
        break;
      default:
        break; // approved/executing are transient — never the stored terminal status
    }
    byType.set(r.actionType, b);
  }
  return [...byType.entries()]
    .map(([actionType, b]) => {
      const decided = b.total - b.draft - b.pending;
      return {
        actionType,
        ...b,
        decided,
        failureRate: b.total > 0 ? b.failed / b.total : 0,
        rejectionRate: decided > 0 ? b.rejected / decided : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export interface CriticFinding {
  actionId: string;
  actionType: string;
  reason: string;
  createdAt: string;
}

export const MIN_SAMPLE = 5;
export const CONCERN_THRESHOLD = 0.3;

/** Pure, deterministic shortlist — no LLM call, no invented framing beyond the numbers. */
export function buildTopConcerns(stats: ActionTypeStats[], criticFindings: CriticFinding[], windowDays: number): string[] {
  const concerns: string[] = [];
  for (const s of stats) {
    if (s.total < MIN_SAMPLE) continue;
    if (s.failureRate >= CONCERN_THRESHOLD) {
      concerns.push(`${s.actionType}: failing ${(s.failureRate * 100).toFixed(0)}% of the time (${s.failed}/${s.total}) over the last ${windowDays} days.`);
    }
    if (s.decided >= MIN_SAMPLE && s.rejectionRate >= CONCERN_THRESHOLD) {
      concerns.push(
        `${s.actionType}: rejected by a human ${(s.rejectionRate * 100).toFixed(0)}% of the time (${s.rejected}/${s.decided} decided) — may be worth reviewing how it's being interpreted.`,
      );
    }
  }
  if (criticFindings.length > 0) {
    concerns.push(
      `The verification pass flagged ${criticFindings.length} action${criticFindings.length === 1 ? "" : "s"} for a possible misread in the last ${windowDays} days.`,
    );
  }
  return concerns;
}

export interface ScanFindingLag {
  avg: number | null;
  max: number | null;
  sampleSize: number;
}

// Pure, deterministic — no DB access, unit-testable with fabricated timestamps.
// This is real, honestly-sourced data on how long findings sit before the daily
// digest reads them, ahead of any decision to change scheduler intervals (Phase 12 —
// the roadmap requires measuring first, this IS that measurement).
export function computeScanFindingLag(rows: Array<{ createdAt: Date; digestedAt: Date | null }>): ScanFindingLag {
  const lagHours = rows
    .filter((r): r is { createdAt: Date; digestedAt: Date } => r.digestedAt !== null)
    .map((r) => (r.digestedAt.getTime() - r.createdAt.getTime()) / 3_600_000);
  if (lagHours.length === 0) return { avg: null, max: null, sampleSize: 0 };
  return {
    avg: lagHours.reduce((s, n) => s + n, 0) / lagHours.length,
    max: Math.max(...lagHours),
    sampleSize: lagHours.length,
  };
}

export interface LearningDigest {
  generatedAt: string;
  windowDays: number;
  actionTypeStats: ActionTypeStats[];
  criticFindings: CriticFinding[];
  topConcerns: string[];
  scanFindingLagHours: ScanFindingLag;
}

/** DB-touching entry point — the shared computation both the worker's learning_digest
 *  job and GET /api/insights call, so there's exactly one place this logic lives. */
export async function computeLearningDigest(tenantId: string, windowDays = 90): Promise<LearningDigest> {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
  const [actionRows, criticRows, scanFindingRows] = await withTenant(tenantId, (db) =>
    Promise.all([
      db
        .select({ actionType: domainActions.actionType, status: domainActions.status })
        .from(domainActions)
        .where(and(eq(domainActions.tenantId, tenantId), gte(domainActions.createdAt, since))),
      db
        .select({ domainActionId: actionLog.domainActionId, actionType: domainActions.actionType, output: actionLog.output, timestamp: actionLog.timestamp })
        .from(actionLog)
        .innerJoin(domainActions, eq(actionLog.domainActionId, domainActions.id))
        .where(and(eq(actionLog.tenantId, tenantId), eq(actionLog.step, "critic_review"), gte(actionLog.timestamp, since)))
        .orderBy(desc(actionLog.timestamp))
        .limit(100),
      db
        .select({ createdAt: scanFindings.createdAt, digestedAt: scanFindings.digestedAt })
        .from(scanFindings)
        .where(and(eq(scanFindings.tenantId, tenantId), gte(scanFindings.createdAt, since), isNotNull(scanFindings.digestedAt))),
    ]),
  );

  const actionTypeStats = summarizeActionOutcomes(actionRows);
  const criticFindings: CriticFinding[] = criticRows
    .filter((r) => (r.output as Record<string, unknown> | null)?.flagged === true)
    .map((r) => ({
      actionId: r.domainActionId,
      actionType: r.actionType,
      reason: String((r.output as Record<string, unknown>).reason ?? ""),
      createdAt: r.timestamp.toISOString(),
    }));

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    actionTypeStats,
    criticFindings,
    topConcerns: buildTopConcerns(actionTypeStats, criticFindings, windowDays),
    scanFindingLagHours: computeScanFindingLag(scanFindingRows),
  };
}
