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
  applicationAccounts,
  authProfiles,
  businessEffects,
  businessOperations,
  communicationsLog,
  messages,
  inventoryItems,
  domainActions,
  domainPolicies,
  decisionReceipts,
  reconciliationCases,
  type Db,
} from "@finnor/db";
import { and, asc, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type {
  BusinessEffectBinding,
  BusinessEffectOperationClass,
  BusinessEffectSet,
  BusinessEffectStateSnapshot,
  BusinessEffectTarget,
  BusinessEffectVerification,
  DomainAction,
  DomainPolicy,
  DraftAction,
  ExecutionResult,
} from "@finnor/shared-types";
import { BUSINESS_EFFECT_SCHEMA_VERSION } from "@finnor/shared-types";
import { ACTION_HARDENING_SPEC_BY_ACTION, type ActionProfile } from "../../../scripts/release/action-hardening-spec";

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

// ---------------------------------------------------------------------------
// Universal Business Effect compiler. This deliberately extends the existing plan
// compiler: validated plugin drafts enter here after grounding and before authority.
// ---------------------------------------------------------------------------

const EFFECT_RESOURCE_KEYS: Record<string, string> = {
  householdId: "household", customerId: "household", targetId: "household",
  technicianId: "technician", visitId: "service_visit", serviceVisitId: "service_visit",
  workOrderId: "work_order", invoiceId: "invoice", paymentId: "payment", leadId: "lead",
  opportunityId: "opportunity", quoteId: "quote", proposalId: "proposal",
  appointmentId: "appointment", workId: "work", taskId: "task", documentId: "document",
  locationId: "location", delegationId: "delegation", internalEventId: "internal_event",
  objectiveLoopId: "objective_loop", communicationIdentityId: "communication_identity",
  applicationAccountId: "application_account", authProfileId: "auth_profile",
  agreementId: "maintenance_agreement", maintenanceAgreementId: "maintenance_agreement",
};

const EFFECT_RECIPIENT_KEYS: Record<string, string> = {
  contactPhone: "phone_endpoint",
  phone: "phone_endpoint",
  phoneNumber: "phone_endpoint",
  toNumber: "phone_endpoint",
  contactEmail: "email_endpoint",
  email: "email_endpoint",
  recipient: "recipient_endpoint",
};

const PROFILE_CLASS: Partial<Record<ActionProfile, BusinessEffectOperationClass>> = {
  INTERNAL_DRAFT: "internal_draft",
  INTERNAL_WRITE: "internal_write",
  OPERATIONAL_CHANGE: "operational_change",
  FINANCIAL_WRITE: "financial_write",
  EXTERNAL_SIDE_EFFECT: "external_side_effect",
  EXTERNAL_SPEND: "external_spend",
  BATCH_EXTERNAL: "batch_external",
  DURABLE_WORKFLOW: "durable_workflow",
};

const SECRET_KEY = /(?:secret|password|token|authorization|bearer|credential|api[_ -]?key|cookie|browser[_ -]?state|session[_ -]?(?:state|storage)|local[_ -]?storage|private[_ -]?key)/i;

function secretPath(value: unknown, path = "payload"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = secretPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY.test(key)) return childPath;
    const found = secretPath(child, childPath);
    if (found) return found;
  }
  return null;
}

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "tenantId" || key === "correlationId" || key === "idempotencyKey" || SECRET_KEY.test(key)) continue;
    result[key] = semanticValue(child);
  }
  return result;
}

function collectEffectTargets(value: unknown, actionId: string, path = ""): BusinessEffectTarget[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectEffectTargets(item, actionId, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const targets: BusinessEffectTarget[] = [];
  const consumed = new Set<string>();
  if (typeof row.partyType === "string" && typeof row.partyId === "string" && UUID_RE.test(row.partyId)) {
    targets.push({ kind: "party", type: row.partyType, id: row.partyId, sourcePath: path || "party" });
    consumed.add("partyId");
  }
  if (typeof row.entityType === "string" && typeof row.entityId === "string" && UUID_RE.test(row.entityId)) {
    targets.push({ kind: "entity", type: row.entityType, id: row.entityId, sourcePath: path || "entity" });
    consumed.add("entityId");
  }
  for (const [key, child] of Object.entries(row)) {
    if (consumed.has(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    const type = EFFECT_RESOURCE_KEYS[key] ?? (key.endsWith("Ids") ? EFFECT_RESOURCE_KEYS[`${key.slice(0, -3)}Id`] : undefined);
    if (type) {
      const ids = Array.isArray(child) ? child : [child];
      for (const id of ids) if (typeof id === "string" && UUID_RE.test(id)) targets.push({ kind: "entity", type, id, sourcePath: childPath });
    } else if (EFFECT_RECIPIENT_KEYS[key] && typeof child === "string" && child.trim()) {
      targets.push({ kind: "resource", type: EFFECT_RECIPIENT_KEYS[key]!, id: child.trim(), sourcePath: childPath });
    } else {
      targets.push(...collectEffectTargets(child, actionId, childPath));
    }
  }
  if (!path && targets.length === 0) targets.push({ kind: "resource", type: "proposed_business_change", id: actionId, sourcePath: "domainActionId" });
  return [...new Map(targets.map((target) => [`${target.kind}:${target.type}:${target.id}`, target])).values()];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

async function safeState(db: Db, tenantId: string, target: Pick<BusinessEffectTarget, "kind" | "type" | "id">): Promise<Record<string, unknown> | null> {
  switch (target.type) {
    case "household": {
      const [row] = await db.select({ id: households.id, createdAt: households.createdAt }).from(households).where(and(eq(households.tenantId, tenantId), eq(households.id, target.id))).limit(1);
      return row ? { id: row.id, createdAt: iso(row.createdAt) } : null;
    }
    case "service_visit": {
      const [row] = await db.select({ id: serviceVisits.id, householdId: serviceVisits.householdId, technicianId: serviceVisits.technicianId, type: serviceVisits.type, scheduledAt: serviceVisits.scheduledAt, completedAt: serviceVisits.completedAt }).from(serviceVisits).where(and(eq(serviceVisits.tenantId, tenantId), eq(serviceVisits.id, target.id))).limit(1);
      return row ? { ...row, scheduledAt: iso(row.scheduledAt), completedAt: iso(row.completedAt) } : null;
    }
    case "appointment": {
      const [row] = await db.select({ id: appointments.id, subjectType: appointments.subjectType, subjectId: appointments.subjectId, technicianId: appointments.technicianId, status: appointments.status, scheduledAt: appointments.scheduledAt, durationMinutes: appointments.durationMinutes, holdExpiresAt: appointments.holdExpiresAt }).from(appointments).where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, target.id))).limit(1);
      return row ? { ...row, scheduledAt: iso(row.scheduledAt), holdExpiresAt: iso(row.holdExpiresAt) } : null;
    }
    case "invoice": {
      const [row] = await db.select({ id: invoices.id, householdId: invoices.householdId, amountUsd: invoices.amountUsd, status: invoices.status, dueDate: invoices.dueDate }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, target.id))).limit(1);
      return row ? { ...row, amountUsd: Number(row.amountUsd), dueDate: iso(row.dueDate) } : null;
    }
    case "task": {
      const [row] = await db.select({ id: tasks.id, subjectType: tasks.subjectType, subjectId: tasks.subjectId, title: tasks.title, dueAt: tasks.dueAt, assignedPartyType: tasks.assignedPartyType, assignedPartyId: tasks.assignedPartyId, status: tasks.status, priority: tasks.priority }).from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, target.id))).limit(1);
      return row ? { ...row, dueAt: iso(row.dueAt) } : null;
    }
    case "work": {
      const [row] = await db.select({ id: works.id, status: works.status, currentOwnerId: works.currentOwnerId, assignedTo: works.assignedTo, updatedAt: works.updatedAt }).from(works).where(and(eq(works.tenantId, tenantId), eq(works.id, target.id))).limit(1);
      return row ? { ...row, updatedAt: iso(row.updatedAt) } : null;
    }
    case "internal_event": {
      const [row] = await db.select({ id: internalEvents.id, title: internalEvents.title, startsAt: internalEvents.startsAt, endsAt: internalEvents.endsAt, status: internalEvents.status, revision: internalEvents.revision, locationId: internalEvents.locationId }).from(internalEvents).where(and(eq(internalEvents.tenantId, tenantId), eq(internalEvents.id, target.id))).limit(1);
      return row ? { ...row, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) } : null;
    }
    case "delegation": {
      const [row] = await db.select({ id: delegations.id, workId: delegations.workId, taskId: delegations.taskId, targetType: delegations.targetType, targetId: delegations.targetId, status: delegations.status, acknowledgementDeadline: delegations.acknowledgementDeadline, completionDeadline: delegations.completionDeadline }).from(delegations).where(and(eq(delegations.tenantId, tenantId), eq(delegations.id, target.id))).limit(1);
      return row ? { ...row, acknowledgementDeadline: iso(row.acknowledgementDeadline), completionDeadline: iso(row.completionDeadline) } : null;
    }
    case "lead": {
      const [row] = await db.select({ id: leads.id, householdId: leads.householdId, status: leads.status, archivedAt: leads.archivedAt }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, target.id))).limit(1);
      return row ? { ...row, archivedAt: iso(row.archivedAt) } : null;
    }
    case "work_order": {
      const [row] = await db.select({ id: workOrders.id, householdId: workOrders.householdId, quoteId: workOrders.quoteId, status: workOrders.status, technicianId: workOrders.technicianId, depositAmountUsd: workOrders.depositAmountUsd, scheduledAt: workOrders.scheduledAt }).from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, target.id))).limit(1);
      return row ? { ...row, depositAmountUsd: row.depositAmountUsd === null ? null : Number(row.depositAmountUsd), scheduledAt: iso(row.scheduledAt) } : null;
    }
    case "quote": {
      const [row] = await db.select({ id: quotes.id, householdId: quotes.householdId, status: quotes.status, totalUsd: quotes.totalUsd, validUntil: quotes.validUntil }).from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, target.id))).limit(1);
      return row ? { ...row, totalUsd: row.totalUsd === null ? null : Number(row.totalUsd), validUntil: iso(row.validUntil) } : null;
    }
    case "proposal": {
      const [row] = await db.select({ id: proposals.id, householdId: proposals.householdId, quoteId: proposals.quoteId, status: proposals.status, sentAt: proposals.sentAt }).from(proposals).where(and(eq(proposals.tenantId, tenantId), eq(proposals.id, target.id))).limit(1);
      return row ? { ...row, sentAt: iso(row.sentAt) } : null;
    }
    case "maintenance_agreement": {
      const [row] = await db.select({ id: maintenanceAgreements.id, householdId: maintenanceAgreements.householdId, cadence: maintenanceAgreements.cadence, status: maintenanceAgreements.status, renewalDate: maintenanceAgreements.renewalDate }).from(maintenanceAgreements).where(and(eq(maintenanceAgreements.tenantId, tenantId), eq(maintenanceAgreements.id, target.id))).limit(1);
      return row ? { ...row, renewalDate: iso(row.renewalDate) } : null;
    }
    case "communication_identity": {
      const [row] = await db.select({ id: communicationIdentities.id, provider: communicationIdentities.provider, channel: communicationIdentities.channel, status: communicationIdentities.status, authProfileId: communicationIdentities.authProfileId, updatedAt: communicationIdentities.updatedAt }).from(communicationIdentities).where(and(eq(communicationIdentities.tenantId, tenantId), eq(communicationIdentities.id, target.id))).limit(1);
      return row ? { ...row, updatedAt: iso(row.updatedAt) } : null;
    }
    case "application_account": {
      const [row] = await db.select({ id: applicationAccounts.id, application: applicationAccounts.application, provider: applicationAccounts.provider, status: applicationAccounts.status, updatedAt: applicationAccounts.updatedAt }).from(applicationAccounts).where(and(eq(applicationAccounts.tenantId, tenantId), eq(applicationAccounts.id, target.id))).limit(1);
      return row ? { ...row, updatedAt: iso(row.updatedAt) } : null;
    }
    case "auth_profile": {
      const [row] = await db.select({ id: authProfiles.id, authProfileRef: authProfiles.authProfileRef, applicationAccountId: authProfiles.applicationAccountId, status: authProfiles.status, connectionStatus: authProfiles.connectionStatus, connectionRevision: authProfiles.connectionRevision, updatedAt: authProfiles.updatedAt }).from(authProfiles).where(and(eq(authProfiles.tenantId, tenantId), eq(authProfiles.id, target.id))).limit(1);
      return row ? { ...row, updatedAt: iso(row.updatedAt) } : null;
    }
    case "inventory_item": {
      const [row] = await db.select({ id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name, quantity: inventoryItems.quantity, reorderThreshold: inventoryItems.reorderThreshold, unitCostUsd: inventoryItems.unitCostUsd }).from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.sku, target.id))).limit(1);
      return row ? { ...row, unitCostUsd: row.unitCostUsd === null ? null : Number(row.unitCostUsd) } : null;
    }
    default:
      return null;
  }
}

function preconditionSnapshot(actionType: string, target: Pick<BusinessEffectTarget, "type">, values: Record<string, unknown>): Record<string, unknown> {
  if (actionType === "renew_maintenance_agreement" && target.type === "maintenance_agreement") {
    // The renewal scanner transitions active -> renewal_sent immediately after it
    // durably queues the gated reminder. That lifecycle marker is expected between
    // compile and approval; stable agreement identity, household, cadence, and renewal
    // date remain frozen. Execution separately rejects terminal renewed/lapsed states.
    const { status: _scannerLifecycle, ...stableAgreement } = values;
    return stableAgreement;
  }
  return values;
}

async function resolveBindings(db: Db, tenantId: string, payload: Record<string, unknown>, external: boolean): Promise<{ bindings: BusinessEffectBinding[]; targets: BusinessEffectTarget[] }> {
  const bindings: BusinessEffectBinding[] = [];
  const targets: BusinessEffectTarget[] = [];
  const identityRef = payload.communicationIdentityRef && typeof payload.communicationIdentityRef === "object" ? payload.communicationIdentityRef as Record<string, unknown> : {};
  const identityId = typeof payload.communicationIdentityId === "string" ? payload.communicationIdentityId : typeof identityRef.communicationIdentityId === "string" ? identityRef.communicationIdentityId : undefined;
  if (identityId && UUID_RE.test(identityId)) {
    const [identity] = await db.select({ id: communicationIdentities.id, provider: communicationIdentities.provider }).from(communicationIdentities).where(and(eq(communicationIdentities.tenantId, tenantId), eq(communicationIdentities.id, identityId))).limit(1);
    bindings.push({ selection: "fixed", communicationIdentityId: identityId, provider: identity?.provider ?? null });
    targets.push({ kind: "resource", type: "communication_identity", id: identityId, sourcePath: "communicationIdentityRef" });
  }
  const authProfileRef = typeof payload.authProfileRef === "string" ? payload.authProfileRef : undefined;
  const application = typeof payload.application === "string" ? payload.application : undefined;
  if (authProfileRef) {
    const [profile] = await db.select({ id: authProfiles.id, applicationAccountId: authProfiles.applicationAccountId, provider: applicationAccounts.provider, application: applicationAccounts.application })
      .from(authProfiles)
      .innerJoin(applicationAccounts, and(eq(applicationAccounts.tenantId, tenantId), eq(applicationAccounts.id, authProfiles.applicationAccountId)))
      .where(and(eq(authProfiles.tenantId, tenantId), eq(authProfiles.authProfileRef, authProfileRef), ...(application ? [eq(applicationAccounts.application, application)] : []))).limit(1);
    bindings.push({ selection: "fixed", authProfileRef, application: application ?? profile?.application, authProfileId: profile?.id, applicationAccountId: profile?.applicationAccountId, provider: profile?.provider ?? null });
    if (profile) {
      targets.push({ kind: "resource", type: "auth_profile", id: profile.id, sourcePath: "authProfileRef" });
      targets.push({ kind: "resource", type: "application_account", id: profile.applicationAccountId, sourcePath: "authProfileRef" });
    }
  }
  if (bindings.length === 0 && external) {
    const rawChannel = typeof payload.channel === "string" ? payload.channel : undefined;
    const channel = rawChannel === "text" ? "sms" : rawChannel === "call" || rawChannel === "phone" ? "voice" : rawChannel;
    if (channel && ["email", "sms", "voice", "chat", "calendar"].includes(channel)) {
      const identities = await db.select({ id: communicationIdentities.id, provider: communicationIdentities.provider }).from(communicationIdentities)
        .where(and(eq(communicationIdentities.tenantId, tenantId), eq(communicationIdentities.status, "active"), eq(communicationIdentities.channel, channel as "email" | "sms" | "voice" | "chat" | "calendar")))
        .orderBy(asc(communicationIdentities.identityKey)).limit(2);
      if (identities.length === 1) {
        bindings.push({ selection: "fixed", communicationIdentityId: identities[0]!.id, provider: identities[0]!.provider });
        targets.push({ kind: "resource", type: "communication_identity", id: identities[0]!.id, sourcePath: "resolvedBinding" });
      }
    }
  }
  if (bindings.length === 0 && external && application) {
    const profiles = await db.select({ id: authProfiles.id, ref: authProfiles.authProfileRef, applicationAccountId: authProfiles.applicationAccountId, provider: applicationAccounts.provider })
      .from(authProfiles).innerJoin(applicationAccounts, and(eq(applicationAccounts.tenantId, tenantId), eq(applicationAccounts.id, authProfiles.applicationAccountId)))
      .where(and(eq(authProfiles.tenantId, tenantId), eq(authProfiles.status, "active"), eq(applicationAccounts.application, application))).orderBy(asc(authProfiles.authProfileRef)).limit(2);
    if (profiles.length === 1) {
      const profile = profiles[0]!;
      bindings.push({ selection: "fixed", authProfileRef: profile.ref, application, authProfileId: profile.id, applicationAccountId: profile.applicationAccountId, provider: profile.provider });
      targets.push({ kind: "resource", type: "auth_profile", id: profile.id, sourcePath: "resolvedBinding" });
      targets.push({ kind: "resource", type: "application_account", id: profile.applicationAccountId, sourcePath: "resolvedBinding" });
    }
  }
  if (bindings.length === 0 && external) bindings.push({ selection: "policy_resolved", ...(application ? { application } : {}) });
  return { bindings, targets };
}

function amountExposure(payload: Record<string, unknown>): { amount: number; currency: string } | null {
  const amounts: number[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:amount|total|price|spend|budget|cost)(?:Usd)?$/i.test(key)) {
        const number = typeof child === "number" ? child : typeof child === "string" && child.trim() ? Number(child) : NaN;
        if (Number.isFinite(number) && number >= 0) amounts.push(number);
      }
      walk(child);
    }
  };
  walk(payload);
  if (amounts.length === 0) return null;
  const currency = typeof payload.currency === "string" ? payload.currency.toUpperCase() : "USD";
  return { amount: Math.max(...amounts), currency };
}

function expectedState(actionType: string, payload: Record<string, unknown>, before: BusinessEffectStateSnapshot[]): Record<string, unknown> | null {
  if (["create_invoice", "create_lead", "generate_quote", "create_task", "schedule_internal_event", "delegate_objective", "generate_compliance_summary"].includes(actionType)) return { exists: true };
  if (actionType === "reschedule_visit" && typeof payload.newTime === "string") return { scheduledAt: new Date(payload.newTime).toISOString() };
  if (actionType === "assign_technician_to_visit" && typeof payload.technicianId === "string") return { technicianId: payload.technicianId };
  if (actionType === "record_payment") return { status: "paid" };
  if (actionType === "update_task") return Object.fromEntries(["title", "dueAt", "status", "priority"].filter((key) => key in payload).map((key) => [key, payload[key]]));
  if (actionType === "assign_task" && payload.assigneeRef && typeof payload.assigneeRef === "object") {
    const assignee = payload.assigneeRef as Record<string, unknown>;
    return { assignedPartyType: assignee.partyType, assignedPartyId: assignee.partyId };
  }
  if (actionType === "handoff_work" && payload.targetEmployeeRef && typeof payload.targetEmployeeRef === "object") return { currentOwnerId: (payload.targetEmployeeRef as Record<string, unknown>).partyId };
  if (actionType === "cancel_delegation") return { status: "cancelled" };
  if (actionType === "reschedule_internal_event") return { startsAt: payload.startsAt, endsAt: payload.endsAt, status: "rescheduled" };
  if (actionType === "computer_task" && payload.authorizedEffect && typeof payload.authorizedEffect === "object") return { ...(payload.authorizedEffect as Record<string, unknown>).changes as Record<string, unknown> };
  if (actionType === "log_stock_used_on_visit") {
    const inventory = before.find((snapshot) => snapshot.target.type === "inventory_item");
    const quantity = Number(payload.quantity);
    if (inventory && typeof inventory.values.quantity === "number" && Number.isFinite(quantity)) return { quantity: inventory.values.quantity - quantity };
  }
  return null;
}

function approvalSummary(actionType: string, payload: Record<string, unknown>, targets: BusinessEffectTarget[], before: BusinessEffectStateSnapshot[], exposure: { amount: number; currency: string } | null, draftSummary: string): string {
  const target = targets[0] ? `${targets[0].type} ${targets[0].id}` : "the governed target";
  if (actionType === "schedule_water_test") {
    return `Schedule a water test at ${String(payload.address ?? "the approved address")} for ${String(payload.contactName ?? target)} (${String(payload.contactPhone ?? target)}) at ${String(payload.requestedAt ?? "the next available time")}.`;
  }
  if (actionType === "renew_maintenance_agreement") {
    return `Send the ${String(payload.cadence ?? "approved")} maintenance renewal to ${String(payload.householdLabel ?? target)} at ${String(payload.contactPhone ?? target)}.`;
  }
  if (["send_message", "send_customer_message", "send_follow_up"].includes(actionType)) {
    const body = String(payload.body ?? payload.message ?? "").slice(0, 500);
    return `Send the approved ${String(payload.channel ?? "message")} to ${target}${body ? `: “${body}”` : ""}.`;
  }
  if (actionType === "place_call") return `Place the approved call to ${target}: ${String(payload.objective ?? "").slice(0, 500)}.`;
  if (actionType === "notify_group") return `Notify exactly ${target} through ${String(payload.channel ?? "the approved channel")}: “${String(payload.body ?? "").slice(0, 500)}”.`;
  if (actionType === "reschedule_visit" || actionType === "reschedule_internal_event") {
    const prior = before[0]?.values ?? {};
    const from = prior.scheduledAt ?? prior.startsAt ?? "the recorded time";
    const to = payload.newTime ?? payload.startsAt;
    return `Reschedule ${target} from ${String(from)} to ${String(to)}.`;
  }
  if (actionType === "computer_task") {
    const effect = payload.authorizedEffect as Record<string, unknown> | undefined;
    return `In ${String(payload.application)}, perform only ${String(effect?.operation ?? actionType)} on ${target}.`;
  }
  return draftSummary || `${actionType.replaceAll("_", " ")} on ${targets.map((row) => `${row.type} ${row.id}`).join(", ") || target}${exposure ? ` with exposure ${exposure.amount} ${exposure.currency}` : ""}.`;
}

function observationKind(operationClass: BusinessEffectOperationClass, actionType: string): BusinessEffectSet["expected"]["observation"] {
  if (actionType === "computer_task") return "computer_state";
  if (operationClass === "durable_workflow") return "workflow_completion";
  if (["external_side_effect", "external_spend", "batch_external"].includes(operationClass)) return "provider_delivery";
  return "canonical_state";
}

function reversibility(operationClass: BusinessEffectOperationClass): BusinessEffectSet["reversibility"] {
  if (["external_side_effect", "external_spend", "batch_external", "financial_write"].includes(operationClass)) return { classification: "irreversible", compensationCapability: null };
  return { classification: "unknown_provider_dependent", compensationCapability: null };
}

export function isConsequentialAction(actionType: string, payload: Record<string, unknown>): boolean {
  if (actionType === "computer_task" && payload.mode === "READ_ONLY") return false;
  const profile = ACTION_HARDENING_SPEC_BY_ACTION.get(actionType)?.profile;
  return Boolean(profile && profile !== "READ_ONLY" && profile !== "META_NO_SIDE_EFFECT");
}

export class BusinessEffectBoundaryError extends Error {
  constructor(readonly code: "material_effect_change" | "stale_precondition" | "effect_missing" | "effect_in_progress", message: string) {
    super(message);
    this.name = "BusinessEffectBoundaryError";
  }
}

async function compileBusinessEffectWithDb(params: {
  db: Db;
  action: DomainAction;
  draft: DraftAction;
  policy: DomainPolicy;
  approval: { requiresConfirmation: boolean; typedConfirmation: boolean };
  id?: string;
  compensationForEffectId?: string | null;
}): Promise<BusinessEffectSet> {
  const spec = ACTION_HARDENING_SPEC_BY_ACTION.get(params.action.actionType);
  const operationClass = spec && PROFILE_CLASS[spec.profile];
  if (!operationClass) throw new BusinessEffectBoundaryError("effect_missing", `Action ${params.action.actionType} has no consequential effect classification`);
  const forbidden = secretPath(params.draft.payload);
  if (forbidden) throw new BusinessEffectBoundaryError("effect_missing", `${forbidden} contains secret-shaped execution data; use a governed identity or authentication profile reference`);
  const payload = semanticValue(params.draft.payload) as Record<string, unknown>;
  const initialTargets = collectEffectTargets(payload, params.action.id);
  if (params.action.actionType === "log_stock_used_on_visit" && typeof payload.sku === "string") initialTargets.push({ kind: "entity", type: "inventory_item", id: payload.sku, sourcePath: "sku" });
  const resolved = await resolveBindings(params.db, params.action.tenantId, payload, Boolean(spec?.external));
  if (resolved.bindings.some((binding) => binding.selection === "fixed" && binding.authProfileRef && !binding.authProfileId)) {
    throw new BusinessEffectBoundaryError("effect_missing", "The requested governed authentication profile does not exist in this tenant");
  }
  const targets = [...new Map([...initialTargets, ...resolved.targets].map((target) => [`${target.kind}:${target.type}:${target.id}`, target])).values()];
  const observedAt = new Date().toISOString();
  const [canonicalPolicy] = params.policy.version > 0
    ? await params.db.select({ id: domainPolicies.id }).from(domainPolicies).where(and(
        eq(domainPolicies.id, params.policy.id),
        eq(domainPolicies.tenantId, params.action.tenantId),
        eq(domainPolicies.actionType, params.action.actionType),
      )).limit(1)
    : [];
  const policyId = canonicalPolicy?.id ?? null;
  const policyVersion = policyId ? params.policy.version : null;
  const before: BusinessEffectStateSnapshot[] = [];
  for (const target of targets) {
    const values = await safeState(params.db, params.action.tenantId, target);
    // Canonical entity tables such as inventory use business keys (for example a
    // SKU), not UUIDs. safeState already proves those rows exist under this
    // tenant. Fall back to the polymorphic UUID registry only when no canonical
    // state reader knows the entity type.
    if (target.kind === "party" || (target.kind === "entity" && !values)) {
      const grounded = await lookUpTypedRef(params.db, params.action.tenantId, target.kind, target.type, target.id).catch(() => "not_found" as const);
      if (grounded !== "verified") {
        throw new BusinessEffectBoundaryError("effect_missing", `${target.type} target does not exist in this tenant`);
      }
    } else if (["communication_identity", "auth_profile", "application_account"].includes(target.type) && !values) {
      throw new BusinessEffectBoundaryError("effect_missing", `${target.type} binding does not exist in this tenant`);
    }
    if (values) {
      const frozenValues = preconditionSnapshot(params.action.actionType, target, values);
      before.push({ target: { kind: target.kind, type: target.type, id: target.id }, values: frozenValues, versionHash: hash(frozenValues), observedAt });
    }
  }
  const exposure = amountExposure(payload);
  const expected = expectedState(params.action.actionType, payload, before);
  const scope = {
    actionType: params.action.actionType,
    operationClass,
    targets,
    bindings: resolved.bindings,
    delta: { operation: params.action.actionType, values: payload },
    exposure,
  };
  const scopeHash = hash(scope);
  const id = params.id ?? randomUUID();
  const semanticCore = {
    source: { domainActionId: params.action.id, actionType: params.action.actionType, workId: params.action.workId ?? null, objectiveStepId: params.action.objectiveStepId ?? null },
    ...scope,
    before: before.map((snapshot) => ({ target: snapshot.target, versionHash: snapshot.versionHash })),
    expected,
    policyId,
    policyVersion,
    compensationForEffectId: params.compensationForEffectId ?? null,
  };
  const semanticHash = hash(semanticCore);
  return {
    id,
    schemaVersion: BUSINESS_EFFECT_SCHEMA_VERSION,
    semanticHash,
    scopeHash,
    source: semanticCore.source,
    mode: "consequential",
    operation: { name: params.action.actionType, class: operationClass, external: Boolean(spec?.external) },
    targets,
    bindings: resolved.bindings,
    preconditions: before.map((snapshot) => ({ kind: snapshot.target.type === "communication_identity" || snapshot.target.type === "auth_profile" || snapshot.target.type === "application_account" ? "binding_version" : "state_version", target: snapshot.target, expectedHash: snapshot.versionHash, description: `${snapshot.target.type} must still match the compiled before-state` })),
    before,
    delta: scope.delta,
    expected: { observation: observationKind(operationClass, params.action.actionType), state: expected },
    exposure,
    authority: { capability: `action:${params.action.actionType}`, risk: spec?.profile === "INTERNAL_DRAFT" || spec?.profile === "INTERNAL_WRITE" ? "medium" : "high", policyId, policyVersion },
    approval: { required: params.approval.requiresConfirmation, typedConfirmation: params.approval.typedConfirmation, summary: approvalSummary(params.action.actionType, payload, targets, before, exposure, params.draft.summary) },
    reversibility: reversibility(operationClass),
    uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
    provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: observedAt, replacementForEffectId: null, compensationForEffectId: params.compensationForEffectId ?? null },
  };
}

export async function ensureBusinessEffect(params: {
  action: DomainAction;
  draft: DraftAction;
  policy: DomainPolicy;
  approval: { requiresConfirmation: boolean; typedConfirmation: boolean };
}): Promise<BusinessEffectSet | undefined> {
  if (!isConsequentialAction(params.action.actionType, params.draft.payload)) return undefined;
  return withTenant(params.action.tenantId, async (db) => {
    const [existing] = await db.select().from(businessEffects).where(and(eq(businessEffects.tenantId, params.action.tenantId), eq(businessEffects.domainActionId, params.action.id))).limit(1);
    const candidate = await compileBusinessEffectWithDb({ ...params, db, id: existing?.id });
    if (existing) {
      if (existing.scopeHash !== candidate.scopeHash) throw new BusinessEffectBoundaryError("material_effect_change", "Execution payload would materially change the frozen authorized Business Effect");
      const effect = existing.effect as BusinessEffectSet;
      params.draft.businessEffect = effect;
      params.action.businessEffectId = effect.id;
      return effect;
    }
    const [created] = await db.insert(businessEffects).values({
      id: candidate.id,
      tenantId: params.action.tenantId,
      domainActionId: params.action.id,
      version: candidate.schemaVersion,
      semanticHash: candidate.semanticHash,
      scopeHash: candidate.scopeHash,
      operationClass: candidate.operation.class,
      effect: candidate,
    }).onConflictDoNothing({ target: businessEffects.domainActionId }).returning();
    const row = created ?? (await db.select().from(businessEffects).where(and(eq(businessEffects.tenantId, params.action.tenantId), eq(businessEffects.domainActionId, params.action.id))).limit(1))[0];
    if (!row) throw new BusinessEffectBoundaryError("effect_missing", "Business Effect could not be persisted");
    if (row.scopeHash !== candidate.scopeHash) throw new BusinessEffectBoundaryError("material_effect_change", "DomainAction is already bound to a materially different Business Effect");
    const effect = row.effect as BusinessEffectSet;
    await db.update(domainActions).set({ businessEffectId: row.id }).where(and(eq(domainActions.tenantId, params.action.tenantId), eq(domainActions.id, params.action.id), sql`${domainActions.businessEffectId} IS NULL`));
    await db.update(businessOperations).set({ businessEffectId: row.id }).where(and(eq(businessOperations.tenantId, params.action.tenantId), eq(businessOperations.domainActionId, params.action.id), sql`${businessOperations.businessEffectId} IS NULL`));
    params.draft.businessEffect = effect;
    params.action.businessEffectId = effect.id;
    return effect;
  });
}

export async function verifyBusinessEffectPreconditions(tenantId: string, effect: BusinessEffectSet): Promise<void> {
  await withTenant(tenantId, async (db) => {
    for (const precondition of effect.preconditions) {
      if (!precondition.expectedHash) continue;
      const current = await safeState(db, tenantId, precondition.target);
      if (effect.operation.name === "renew_maintenance_agreement" && precondition.target.type === "maintenance_agreement"
          && current?.status !== "active" && current?.status !== "renewal_sent") {
        throw new BusinessEffectBoundaryError("stale_precondition", "maintenance agreement is no longer eligible for renewal outreach; recompile and renew authorization");
      }
      const compiled = effect.before.find((snapshot) => snapshot.target.kind === precondition.target.kind
        && snapshot.target.type === precondition.target.type && snapshot.target.id === precondition.target.id);
      const comparable = current && compiled
        ? Object.fromEntries(Object.keys(compiled.values).map((key) => [key, current[key]]))
        : current;
      if (!comparable || hash(comparable) !== precondition.expectedHash) {
        throw new BusinessEffectBoundaryError("stale_precondition", `${precondition.target.type} changed after effect compilation; recompile and renew authorization`);
      }
    }
  });
}

export async function markBusinessEffectAuthorized(tenantId: string, effectId: string): Promise<void> {
  await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "authorized", authorizedAt: new Date() }).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, effectId), eq(businessEffects.status, "compiled"))));
}

export async function markBusinessEffectExecuting(tenantId: string, effect: BusinessEffectSet): Promise<void> {
  await verifyBusinessEffectPreconditions(tenantId, effect);
  // A known, explicit failed attempt is safe to retry through the existing bounded
  // reflection policy. Unknown/reconciliation-required outcomes are intentionally
  // excluded so they can never be converted into a blind duplicate mutation.
  const permittedStatus = effect.operation.external
    // Same-effect external redelivery still enters the pre-existing operation ledger,
    // which returns the prior result instead of dispatching a second mutation.
    ? sql`${businessEffects.status} IN ('authorized','failed','partially_verified','verified')`
    : sql`${businessEffects.status} IN ('authorized','failed')`;
  const [claimed] = await withTenant(tenantId, (db) => db.update(businessEffects).set({ status: "executing", executionStartedAt: new Date() }).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, effect.id), permittedStatus)).returning({ id: businessEffects.id }));
  if (!claimed) {
    const [current] = await withTenant(tenantId, (db) => db.select({ status: businessEffects.status }).from(businessEffects).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, effect.id))).limit(1));
    if (current?.status === "executing") {
      throw new BusinessEffectBoundaryError("effect_in_progress", "The identical Business Effect is already executing; the duplicate attempt was suppressed");
    }
    throw new BusinessEffectBoundaryError("material_effect_change", "Business Effect is not in a state that permits execution; reconcile or obtain renewed authorization");
  }
}

function valuesMatch(expected: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => stable(current[key]) === stable(value));
}

export async function recordBusinessEffectOutcome(tenantId: string, effect: BusinessEffectSet, result: ExecutionResult): Promise<BusinessEffectVerification> {
  let verification: BusinessEffectVerification;
  let status: typeof businessEffects.$inferSelect.status;
  if (result.errorKind === "unknown_outcome") {
    verification = { state: "reconciliation_required", basis: "Provider outcome is unknown; consequential retry is prohibited until reconciliation", checkedAt: new Date().toISOString(), observed: result.output };
    status = "reconciliation_required";
  } else if (result.status !== "success") {
    verification = { state: "unverified", basis: result.error ?? "The effect did not produce a successful observable result", checkedAt: new Date().toISOString(), observed: result.output };
    status = "failed";
  } else if (result.output.verified === true) {
    verification = {
      state: "verified",
      basis: result.output.canonicalObserved === true
        ? "Canonical business-operation outcome state was observed for the exact EffectSet"
        : "Executor supplied bounded observable evidence",
      checkedAt: new Date().toISOString(),
      observed: result.output,
    };
    status = "verified";
  } else if (["send_message", "send_customer_message", "send_follow_up"].includes(effect.operation.name)) {
    // Provider acceptance is transport evidence, not business-outcome evidence.  The
    // customer communication plugins also project a successful send into Finnor's
    // canonical message history.  Observe that row (preferably by the exact action
    // provenance, with the legacy household log as a bounded fallback) before this
    // EffectSet can participate in objective completion.
    const householdId = typeof effect.delta.values.householdId === "string"
      ? effect.delta.values.householdId
      : effect.targets.find((target) => target.type === "household")?.id;
    const channel = typeof result.output.channel === "string" ? result.output.channel : null;
    const observed = await withTenant(tenantId, async (db) => {
      const [message] = await db.select({ id: messages.id, channel: messages.channel, sentAt: messages.sentAt })
        .from(messages)
        .where(and(
          eq(messages.tenantId, tenantId),
          eq(messages.direction, "outbound"),
          eq(messages.sourceSystem, `domain_action:${effect.source.domainActionId}`),
        ))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      if (message) return { canonicalMessageId: message.id, channel: message.channel, recordedAt: message.sentAt.toISOString() };
      if (!householdId) return null;
      const conditions = [
        eq(communicationsLog.tenantId, tenantId),
        eq(communicationsLog.householdId, householdId),
        eq(communicationsLog.direction, "outbound"),
        sql`${communicationsLog.timestamp} >= ${new Date(effect.provenance.compiledAt)}`,
      ];
      if (channel) conditions.push(eq(communicationsLog.channel, channel));
      const [legacy] = await db.select({ id: communicationsLog.id, channel: communicationsLog.channel, timestamp: communicationsLog.timestamp })
        .from(communicationsLog)
        .where(and(...conditions))
        .orderBy(desc(communicationsLog.timestamp))
        .limit(1);
      return legacy ? { canonicalCommunicationId: legacy.id, channel: legacy.channel, recordedAt: legacy.timestamp.toISOString() } : null;
    });
    verification = observed
      ? { state: "verified", basis: "Canonical outbound communication state was observed after execution", checkedAt: new Date().toISOString(), observed }
      : { state: "partially_verified", basis: "The provider accepted the delivery, but no canonical outbound communication state was observed", checkedAt: new Date().toISOString(), observed: result.output };
    status = observed ? "verified" : "partially_verified";
  } else if (effect.expected.state?.exists === true) {
    const observedTargets = collectEffectTargets(result.output, effect.source.domainActionId).filter((target) => target.type !== "proposed_business_change");
    let observed: Record<string, unknown> | null = null;
    for (const target of observedTargets) {
      observed = await withTenant(tenantId, (db) => safeState(db, tenantId, target));
      if (observed) break;
    }
    verification = { state: observed ? "verified" : "divergent", basis: observed ? "The created canonical record exists and is tenant-scoped" : "Execution reported success but no created canonical record could be observed", checkedAt: new Date().toISOString(), ...(observed ? { observed } : {}) };
    status = observed ? "verified" : "divergent";
  } else if (effect.expected.state && effect.expected.observation === "canonical_state") {
    // Effect target[0] is often the synthetic `proposed_business_change` resource.
    // Verification must observe the real canonical entity snapshot (inventory item,
    // invoice, visit, etc.), not depend on target ordering.
    const candidates = [
      ...effect.before.map((snapshot) => snapshot.target),
      ...effect.targets.filter((target) => target.type !== "proposed_business_change"),
    ];
    let current: Record<string, unknown> | null = null;
    for (const target of candidates) {
      current = await withTenant(tenantId, (db) => safeState(db, tenantId, target));
      if (current) break;
    }
    const matched = Boolean(current && valuesMatch(effect.expected.state!, current));
    verification = { state: matched ? "verified" : "divergent", basis: matched ? "Canonical state matches the EffectSet expected after-state" : "Canonical state does not match the EffectSet expected after-state", checkedAt: new Date().toISOString(), ...(current ? { observed: current } : {}) };
    status = matched ? "verified" : "divergent";
  } else if (effect.operation.external) {
    verification = { state: "partially_verified", basis: "A durable provider/canonical delivery result exists, but final external business state is not fully observable", checkedAt: new Date().toISOString(), observed: result.output };
    status = "partially_verified";
  } else {
    verification = { state: "unverified", basis: "Execution completed but this action has no deterministic after-state verifier", checkedAt: new Date().toISOString(), observed: result.output };
    status = "unverified";
  }
  await withTenant(tenantId, async (db) => {
    await db.update(businessEffects).set({ status, observedResult: result.output, verification, observedAt: new Date() }).where(and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, effect.id)));
    const [receipt] = await db.select({ id: decisionReceipts.id }).from(decisionReceipts)
      .where(and(eq(decisionReceipts.tenantId, tenantId), eq(decisionReceipts.domainActionId, effect.source.domainActionId)))
      .orderBy(desc(decisionReceipts.createdAt)).limit(1);
    if (receipt) await db.update(decisionReceipts).set({ businessEffectId: effect.id, executedEffectHash: effect.semanticHash, verification }).where(and(eq(decisionReceipts.tenantId, tenantId), eq(decisionReceipts.id, receipt.id)));
    if (verification.state === "reconciliation_required") {
      const [existing] = await db.select({ id: reconciliationCases.id }).from(reconciliationCases).where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.businessEffectId, effect.id), eq(reconciliationCases.status, "open"))).limit(1);
      if (!existing) await db.insert(reconciliationCases).values({ tenantId, businessEffectId: effect.id, caseType: "unknown_delivery", details: { domainActionId: effect.source.domainActionId, businessEffectHash: effect.semanticHash, basis: verification.basis } });
    }
  });
  return verification;
}
