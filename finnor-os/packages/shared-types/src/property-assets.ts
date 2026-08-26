/**
 * Generic Phase-1 home-services identity kernel. These contracts add a service
 * location around the existing household and equipment identities; they do not
 * replace either legacy identity.
 */
export const PROPERTY_LINK_STATUSES = ["RESOLVED", "UNRESOLVED"] as const;
export type PropertyLinkStatus = (typeof PROPERTY_LINK_STATUSES)[number];

export const PROPERTY_KINDS = ["residential", "commercial", "service_location", "unknown"] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

/** Domain is classification only. It carries no domain-specific decision logic. */
export const ASSET_DOMAINS = ["WATER", "HVAC", "PLUMBING", "GENERIC", "UNRESOLVED"] as const;
export type AssetDomain = (typeof ASSET_DOMAINS)[number];

export interface PropertyRef {
  propertyId: string;
  householdId: string;
  linkStatus: PropertyLinkStatus;
}

export interface AssetRef {
  /** Existing equipment.id. No second canonical asset identity is introduced. */
  equipmentId: string;
  householdId: string;
  propertyId?: string;
  propertyLinkStatus: PropertyLinkStatus;
  domain: AssetDomain;
}

export interface AssetMeasurementValue {
  measurementType: string;
  value: number | string | boolean | Record<string, unknown>;
  unit?: string;
  observedAt: string;
}
