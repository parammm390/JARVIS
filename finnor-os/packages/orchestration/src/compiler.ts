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

import {
  withTenant,
  households,
  invoices,
  quotes,
  leads,
  workOrders,
  maintenanceAgreements,
  technicians,
  proposals,
  serviceVisits,
  contacts,
  appointments,
  tasks,
  works,
  documents,
  tenantLocations,
  delegations,
  internalEvents,
  workObjectiveLoops,
  communicationIdentities,
  type Db,
} from "@finnor/db";
import { and, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately small and explicit — every case here is a field name this codebase's
// plugins actually use for a foreign reference. Anything not listed falls through to
// "unverifiable" rather than being guessed at. A switch over each table's own concrete
// (already-typed) column, not a generic lookup map, so this leans on the exact same
// query shape every other plugin in this repo already uses.
async function lookUpKnownId(db: Db, tenantId: string | undefined, field: string, value: string): Promise<"verified" | "not_found" | "unverifiable"> {
  const tenant = (condition: SQL) => (tenantId ? and(condition, eq(households.tenantId, tenantId)) : condition);
  const tenantFor = (condition: SQL, tableTenantId: AnyColumn) => (tenantId ? and(condition, eq(tableTenantId, tenantId)) : condition);
  switch (field) {
    case "householdId": {
      const [row] = await db.select({ id: households.id }).from(households).where(tenantFor(eq(households.id, value), households.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "invoiceId": {
      const [row] = await db.select({ id: invoices.id }).from(invoices).where(tenantFor(eq(invoices.id, value), invoices.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "quoteId": {
      const [row] = await db.select({ id: quotes.id }).from(quotes).where(tenantFor(eq(quotes.id, value), quotes.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "leadId": {
      const [row] = await db.select({ id: leads.id }).from(leads).where(tenantFor(eq(leads.id, value), leads.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "workOrderId": {
      const [row] = await db.select({ id: workOrders.id }).from(workOrders).where(tenantFor(eq(workOrders.id, value), workOrders.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "agreementId": {
      const [row] = await db
        .select({ id: maintenanceAgreements.id })
        .from(maintenanceAgreements)
        .innerJoin(households, eq(maintenanceAgreements.householdId, households.id))
        .where(tenant(eq(maintenanceAgreements.id, value)))
        .limit(1);
      return row ? "verified" : "not_found";
    }
    case "technicianId": {
      const [row] = await db.select({ id: technicians.id }).from(technicians).where(tenantFor(eq(technicians.id, value), technicians.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "proposalId": {
      const [row] = await db
        .select({ id: proposals.id })
        .from(proposals)
        .innerJoin(households, eq(proposals.householdId, households.id))
        .where(tenant(eq(proposals.id, value)))
        .limit(1);
      return row ? "verified" : "not_found";
    }
    case "visitId": {
      const [row] = await db.select({ id: serviceVisits.id }).from(serviceVisits).innerJoin(households, eq(serviceVisits.householdId, households.id)).where(tenant(eq(serviceVisits.id, value))).limit(1);
      return row ? "verified" : "not_found";
    }
    case "contactId": {
      const [row] = await db.select({ id: contacts.id }).from(contacts).where(tenantFor(eq(contacts.id, value), contacts.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "appointmentId": {
      const [row] = await db.select({ id: appointments.id }).from(appointments).where(tenantFor(eq(appointments.id, value), appointments.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "taskId": {
      const [row] = await db.select({ id: tasks.id }).from(tasks).where(tenantFor(eq(tasks.id, value), tasks.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "workId": {
      const [row] = await db.select({ id: works.id }).from(works).where(tenantFor(eq(works.id, value), works.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "documentId": {
      const [row] = await db.select({ id: documents.id }).from(documents).where(tenantFor(eq(documents.id, value), documents.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "locationId": {
      const [row] = await db.select({ id: tenantLocations.id }).from(tenantLocations).where(tenantFor(eq(tenantLocations.id, value), tenantLocations.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "delegationId": {
      const [row] = await db.select({ id: delegations.id }).from(delegations).where(tenantFor(eq(delegations.id, value), delegations.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "internalEventId": {
      const [row] = await db.select({ id: internalEvents.id }).from(internalEvents).where(tenantFor(eq(internalEvents.id, value), internalEvents.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "objectiveLoopId": {
      const [row] = await db.select({ id: workObjectiveLoops.id }).from(workObjectiveLoops).where(tenantFor(eq(workObjectiveLoops.id, value), workObjectiveLoops.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    case "communicationIdentityId": {
      const [row] = await db.select({ id: communicationIdentities.id }).from(communicationIdentities).where(tenantFor(eq(communicationIdentities.id, value), communicationIdentities.tenantId)).limit(1);
      return row ? "verified" : "not_found";
    }
    default:
      return "unverifiable";
  }
}

async function lookUpTypedRef(
  db: Db,
  tenantId: string | undefined,
  kind: "party" | "entity",
  type: string,
  value: string,
): Promise<"verified" | "not_found"> {
  const result = kind === "party"
    ? await db.execute<{ tenant_id: string | null }>(sql`
        SELECT finnor_os.party_ref_tenant(${type},${value}::uuid)::text tenant_id
      `)
    : await db.execute<{ tenant_id: string | null }>(sql`
        SELECT finnor_os.canonical_entity_tenant(${type},${value}::uuid)::text tenant_id
      `);
  const resolvedTenant = result.rows[0]?.tenant_id ?? null;
  return resolvedTenant && (!tenantId || resolvedTenant === tenantId) ? "verified" : "not_found";
}

interface GroundingCandidate {
  field: string;
  value: string;
  typed?: { kind: "party" | "entity"; type: string };
}

function collectGroundingCandidates(value: unknown, path = ""): GroundingCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectGroundingCandidates(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const candidates: GroundingCandidate[] = [];
  const consumed = new Set<string>();
  if (typeof row.partyType === "string" && typeof row.partyId === "string" && UUID_RE.test(row.partyId)) {
    candidates.push({ field: path ? `${path}.partyId` : "partyId", value: row.partyId, typed: { kind: "party", type: row.partyType } });
    consumed.add("partyId");
  }
  if (typeof row.entityType === "string" && typeof row.entityId === "string" && UUID_RE.test(row.entityId)) {
    candidates.push({ field: path ? `${path}.entityId` : "entityId", value: row.entityId, typed: { kind: "entity", type: row.entityType } });
    consumed.add("entityId");
  }
  for (const [key, child] of Object.entries(row)) {
    if (consumed.has(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (key.endsWith("Id") && typeof child === "string" && UUID_RE.test(child)) {
      candidates.push({ field: childPath, value: child });
    } else {
      candidates.push(...collectGroundingCandidates(child, childPath));
    }
  }
  return candidates;
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
export function groundEntitiesWithDb(db: Db, payload: Record<string, unknown>): Promise<GroundedField[]>;
export function groundEntitiesWithDb(db: Db, tenantId: string, payload: Record<string, unknown>): Promise<GroundedField[]>;
export async function groundEntitiesWithDb(db: Db, tenantOrPayload: string | Record<string, unknown>, maybePayload?: Record<string, unknown>): Promise<GroundedField[]> {
  const tenantId = typeof tenantOrPayload === "string" ? tenantOrPayload : undefined;
  const payload = typeof tenantOrPayload === "string" ? maybePayload! : tenantOrPayload;
  const candidates = collectGroundingCandidates(payload);
  if (candidates.length === 0) return [];
  const results: GroundedField[] = [];
  for (const candidate of candidates) {
    const key = candidate.field.split(".").at(-1)?.replace(/^.*\]/, "") ?? candidate.field;
    results.push({
      field: candidate.field,
      status: candidate.typed
        ? await lookUpTypedRef(db, tenantId, candidate.typed.kind, candidate.typed.type, candidate.value)
        : await lookUpKnownId(db, tenantId, key, candidate.value),
    });
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
  const groundedPayload = await withTenant(tenantId, (db) => groundEntitiesWithDb(db, tenantId, payload));
  return { groundedPayload, compiledGraph: buildCommandGraph(actionType, requiresConfirmation) };
}
