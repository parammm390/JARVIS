// Repository layer for the canonical business data platform (Phase 1,
// docs/jarvis-90-execution-blueprint.md §1). Every function here takes an already-open
// `db` handle — the caller opens the single withTenant() — so the entity write and its
// business_events row land in one transaction. This is the enforcement point for
// "plugins must stop writing arbitrary tables directly." Only 3 plugins (crm,
// quotation, accounting) are migrated to it this phase; the rest are tracked follow-up.

export * from "./events";
export * from "./contacts";
export * from "./leads";
export * from "./tasks";
export * from "./appointments";
export * from "./work-orders";
export * from "./price-book";
export * from "./quotes";
export * from "./payments";
export * from "./conversations";
export * from "./documents";
