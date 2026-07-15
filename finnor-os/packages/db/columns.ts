// Shared column helpers for the canonical business data platform (Phase 1 of
// docs/jarvis-90-execution-blueprint.md). Money/provenance/archive conventions live
// here once so every new table follows the same rules instead of re-deriving them.

import { numeric, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Money columns are Postgres `numeric`. This Drizzle version's `numeric()` builder is
 * hardcoded to string in/out (no "number" mode) — callers still need Number()/String()
 * at arithmetic call sites, same as the existing invoices.amount_usd. This helper exists
 * to stop money columns from drifting to `text()` in the TS layer while the real Postgres
 * column is `numeric` (that drift is exactly what happened to inventory_items.unit_cost_usd
 * and invoices.amount_usd before this file existed — both fixed alongside it).
 */
export function money(name: string) {
  return numeric(name, { precision: 12, scale: 2 });
}

/**
 * Import provenance for tables that can originate from an external/synthetic import.
 * Pair with `UNIQUE (tenant_id, source_system, external_id)` in the migration — Postgres
 * treats NULL as distinct by default, so hand-created rows with no external_id never
 * collide with each other or with imported rows. Re-importing the same source row with
 * the same external_id upserts instead of duplicating.
 */
export function provenanceColumns() {
  return {
    sourceSystem: text("source_system"),
    externalId: text("external_id"),
    createdBy: text("created_by"),
  };
}

/** Archive-not-delete marker, applied to every new canonical entity table. */
export function archivable() {
  return {
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  };
}
