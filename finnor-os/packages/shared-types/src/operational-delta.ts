import type { CanonicalEntityRef } from "./company-graph";

export const OPERATIONAL_DELTA_PRIORITIES = ["low", "normal", "high"] as const;
export type OperationalDeltaPriority = (typeof OPERATIONAL_DELTA_PRIORITIES)[number];

/** Durable invalidation envelope. It deliberately excludes business row values,
 * provider handles, credentials, external payloads, and unrestricted metadata. */
export interface OperationalDelta {
  cursor: string;
  changeType: string;
  priority: OperationalDeltaPriority;
  entityRefs: CanonicalEntityRef[];
  workId: string | null;
  projectionTags: string[];
  occurredAt: string;
}

export type OperationalDeltaReadStatus = "ok" | "resync_required";

export interface OperationalDeltaPage {
  status: OperationalDeltaReadStatus;
  cursor: string;
  deltas: OperationalDelta[];
  hasMore: boolean;
  retentionDays: number;
}
