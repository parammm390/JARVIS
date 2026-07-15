// Typed plan compiler (Phase 6, docs/jarvis-90-execution-blueprint.md §6). A real
// staging step between the Planner's raw LLM output and the domain_actions row it
// becomes — today that gap is bridged only by prompt text ("a pending create_invoice
// has no real invoice id" is a warning in planner.ts's system prompt, not a structural
// guarantee). This module makes two of those guarantees real:
//
//  1. Entity grounding — any payload field that names an existing-row reference
//     (householdId, invoiceId, ...) is checked against the real table for this tenant.
//     Only a small, known set of id fields is checked — an unrecognized field name is
//     reported "unverifiable", never silently assumed fine.
//  2. Command graph tagging — whether this action_type, once approved, executes as a
//     single plugin.execute() call or drives the durable multi-step runtime
//     (@finnor/workflow-runtime). This is a structural TAG, not a fabricated step list:
//     the actual steps for a workflow action (e.g. whether workflow 3 needs a
//     receive_procurement step) depend on runtime state only known at execute() time,
//     and this module does not pretend to predict that.
//
// Explicitly NOT in scope: changing the Planner's own LLM call, or auto-executing a
// multi-step workflow without the existing confirmation gate.

import { withTenant, households, invoices, quotes, leads, workOrders, maintenanceAgreements, technicians, proposals, type Db } from "@finnor/db";
import { eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately small and explicit — every case here is a field name this codebase's
// plugins actually use for a foreign reference. Anything not listed falls through to
// "unverifiable" rather than being guessed at. A switch over each table's own concrete
// (already-typed) column, not a generic lookup map, so this leans on the exact same
// query shape every other plugin in this repo already uses.
async function lookUpKnownId(db: Db, field: string, value: string): Promise<"verified" | "not_found" | "unverifiable"> {
  switch (field) {
    case "householdId": {
      const [row] = await db.select({ id: households.id }).from(households).where(eq(households.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "invoiceId": {
      const [row] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "quoteId": {
      const [row] = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "leadId": {
      const [row] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "workOrderId": {
      const [row] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "agreementId": {
      const [row] = await db.select({ id: maintenanceAgreements.id }).from(maintenanceAgreements).where(eq(maintenanceAgreements.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "technicianId": {
      const [row] = await db.select({ id: technicians.id }).from(technicians).where(eq(technicians.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "proposalId": {
      const [row] = await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.id, value)).limit(1);
      return row ? "verified" : "not_found";
    }
    default:
      return "unverifiable";
  }
}

// The vertical-workflow action types (Phase 4/5) that submit a multi-step command
// graph through @finnor/workflow-runtime rather than executing as one plugin call.
const WORKFLOW_ACTION_TYPES = new Set([
  "start_water_test_workflow",
  "request_proposal_signature",
  "start_installation_workflow",
  "start_invoice_to_cash_workflow",
]);

export interface GroundedField {
  field: string;
  status: "verified" | "not_found" | "unverifiable";
}

export interface CommandGraph {
  kind: "workflow" | "single_action";
  commandType: string;
  requiresConfirmation: boolean;
  autoApprove: boolean;
}

export interface CompiledPlan {
  groundedPayload: GroundedField[];
  compiledGraph: CommandGraph;
}

/** Pure — no DB access. The "executable command graph" is a structural tag, not a
 *  fabricated step list (see module header). Safe to call from inside an existing
 *  transaction/insert batch with zero extra round trips. */
export function buildCommandGraph(actionType: string, requiresConfirmation: boolean): CommandGraph {
  return {
    kind: WORKFLOW_ACTION_TYPES.has(actionType) ? "workflow" : "single_action",
    commandType: actionType,
    requiresConfirmation,
    autoApprove: !requiresConfirmation,
  };
}

/**
 * Takes an already-open, tenant-scoped `db` handle — for callers (like the Planner)
 * that already hold one open transaction and must not open a second, nested one just
 * to ground entities. This is the one that actually runs the verification queries.
 */
export async function groundEntitiesWithDb(db: Db, payload: Record<string, unknown>): Promise<GroundedField[]> {
  const candidates = Object.entries(payload).filter(
    (entry): entry is [string, string] => entry[0].endsWith("Id") && typeof entry[1] === "string" && UUID_RE.test(entry[1]),
  );
  if (candidates.length === 0) return [];
  const results: GroundedField[] = [];
  for (const [field, value] of candidates) {
    results.push({ field, status: await lookUpKnownId(db, field, value) });
  }
  return results;
}

/** Convenience wrapper for callers with no transaction of their own already open
 *  (opens its own withTenant scope) — e.g. a one-off script or a future standalone
 *  caller. The Planner itself uses groundEntitiesWithDb + buildCommandGraph directly. */
export async function compileAction(
  tenantId: string,
  actionType: string,
  payload: Record<string, unknown>,
  requiresConfirmation: boolean,
): Promise<CompiledPlan> {
  const groundedPayload = await withTenant(tenantId, (db) => groundEntitiesWithDb(db, payload));
  return { groundedPayload, compiledGraph: buildCommandGraph(actionType, requiresConfirmation) };
}
