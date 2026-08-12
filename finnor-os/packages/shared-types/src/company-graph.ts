/**
 * Upgrade 7: the deliberately small identity/relationship contract shared by
 * JARVIS runtime layers. These names identify existing canonical Postgres rows;
 * they are not an ontology and never authorize a tenant selector from a client.
 */
export const CANONICAL_ENTITY_TYPES = [
  "household",
  "contact",
  "user",
  "technician",
  "equipment",
  "service_visit",
  "maintenance_agreement",
  "lead",
  "opportunity",
  "quote",
  "proposal",
  "work_order",
  "appointment",
  "invoice",
  "payment",
  "conversation",
  "call",
  "message",
  "communication",
  "document",
  "task",
  "work",
  "domain_action",
  "workflow_run",
  "workflow_step",
  "business_operation",
  "business_operation_target",
  "decision_receipt",
  "business_event",
] as const;

export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

export interface CanonicalEntityRef {
  entityType: CanonicalEntityType;
  entityId: string;
}

export interface CanonicalRelationship {
  from: CanonicalEntityRef;
  relationship: string;
  to: CanonicalEntityRef;
  /** Exact table/column responsible for this edge. */
  source: { table: string; column: string };
}

export interface CanonicalEntityNode extends CanonicalEntityRef {
  label: string | null;
  status: string | null;
  occurredAt: string | null;
}

export interface CompanyContext {
  anchor: CanonicalEntityRef;
  household: {
    id: string;
    displayName: string | null;
    address: string;
  };
  nodes: CanonicalEntityNode[];
  relationships: CanonicalRelationship[];
  /** True when the fixed safety cap omitted additional related rows. */
  truncated: boolean;
  source: { kind: "canonical_postgres"; tables: string[] };
  asOf: string;
}

export interface AttachWorkEntityInput extends CanonicalEntityRef {
  relationship?: "about" | "target" | "result";
  source?: string;
}
