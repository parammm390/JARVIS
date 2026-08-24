import type { CanonicalEntityRef } from "./company-graph";

/**
 * The exact business context a person has made explicit on the operating canvas.
 * Tenant identity is intentionally absent: every receiver resolves these references
 * inside the authenticated tenant before Work, planning, or execution can use them.
 */
export interface OperatingInteractionContext {
  version: 1;
  capturedAt: string;
  source: "voice" | "text" | "console";
  activeWork?: { workId: string };
  focusedEntity?: CanonicalEntityRef;
  /** Direct selections are deliberately bounded. Large populations use cohort. */
  selectedEntities: CanonicalEntityRef[];
  excludedEntities: CanonicalEntityRef[];
  surface: {
    id: "home" | "customers" | "money" | "work" | "schedule" | "agents";
    route?: string;
    spatialState?: "canvas" | "detail" | "list" | "map" | "timeline";
  };
  filters: Array<{
    field: string;
    operator: "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "contains";
    value: string | number | boolean | string[];
  }>;
  timeContext?: {
    start?: string;
    end?: string;
    timezone?: string;
  };
  /** Durable, tenant-scoped query receipt. The server replaces all descriptive
   * fields with the stored execution's canonical request/result before use. */
  cohort?: {
    kind: "work_query_execution";
    executionId: string;
    entityType: "household";
    queryIntent: "customer_cohort";
    count: number;
  };
}

export const OPERATING_INTERACTION_PRECEDENCE = [
  "EXPLICIT_INTERACTION",
  "ACTIVE_WORK",
  "DETERMINISTIC_CONTEXT",
  "MEMORY",
  "NLP_INFERENCE",
] as const;

export type OperatingInteractionPrecedence = (typeof OPERATING_INTERACTION_PRECEDENCE)[number];
