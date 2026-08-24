import type { CanonicalEntityNode, CanonicalEntityRef, CanonicalRelationship } from "./company-graph";

/** The six coherent operating scenes. A scene is a projection lens, never a
 * separate source of truth or tenant selector. */
export const BUSINESS_SCENES = ["customer", "schedule", "money", "work", "inventory", "computer"] as const;
export type BusinessScene = (typeof BUSINESS_SCENES)[number];

export interface BusinessWorldObject extends CanonicalEntityNode {
  /** Exact canonical table that supplied this object's bounded display row. */
  provenance: { kind: "canonical_postgres"; table: string };
  /** Existing Work rows connected through canonical graph edges/FKs. */
  relatedWork: CanonicalEntityRef[];
  interactionEligible: boolean;
}

export interface BusinessWorldProjection {
  version: 1;
  scene: BusinessScene;
  objects: BusinessWorldObject[];
  relationships: CanonicalRelationship[];
  truncated: boolean;
  limits: { objects: number; relationships: number };
  source: { kind: "canonical_postgres"; tables: string[] };
  asOf: string;
}
