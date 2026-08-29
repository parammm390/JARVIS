// Canonical lead/opportunity records. Dual-write compromise (confirmed, see the plan):
// the crm plugin has always created a household eagerly on create_lead ("Leads are
// households" — packages/domain-plugins/crm/index.ts), and 4 other plugins plus
// tests/integration/native-business-layer.test.ts depend on that. createLead() adds a
// real `leads` row alongside that existing behavior rather than replacing it — full
// decoupling (deferring household creation until qualification) is future work.

import { leads, opportunities, type Db } from "@finnor/db";
import { and, eq, desc, isNull } from "drizzle-orm";
import { recordBusinessEvent } from "./events";
import { createCustomerHousehold } from "./contacts";

export interface Provenance {
  sourceSystem: string;
  externalId: string;
  createdBy?: string;
}

export interface CreateLeadParams {
  tenantId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  source?: string;
  provenance?: Provenance;
}

export interface CreateLeadResult {
  leadId: string;
  householdId: string;
  alreadyExisted: boolean;
}

export async function createLead(db: Db, params: CreateLeadParams): Promise<CreateLeadResult> {
  if (params.provenance) {
    const [existing] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, params.tenantId),
          eq(leads.sourceSystem, params.provenance.sourceSystem),
          eq(leads.externalId, params.provenance.externalId),
        ),
      );
    if (existing) {
      return { leadId: existing.id, householdId: existing.householdId!, alreadyExisted: true };
    }
  }

  const customer = await createCustomerHousehold(db, {
    tenantId: params.tenantId,
    name: params.name,
    phone: params.phone,
    email: params.email,
    // Lead intake commonly has no street address yet. Keep that absence
    // explicit and distinct from the generic call-capture placeholder used by
    // voice-created households, so later imports can converge deterministically.
    address: params.address ?? "(address pending — lead intake)",
    source: params.provenance?.sourceSystem ?? params.source ?? "crm",
    externalId: params.provenance?.externalId,
  });

  const [lead] = await db
    .insert(leads)
    .values({
      tenantId: params.tenantId,
      householdId: customer.householdId,
      name: params.name,
      phone: params.phone ?? null,
      email: params.email ?? null,
      address: params.address ?? null,
      notes: params.notes ?? null,
      source: params.source ?? null,
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
      createdBy: params.provenance?.createdBy ?? null,
    })
    .returning();

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "lead",
    entityId: lead!.id,
    eventType: "lead_created",
    source: params.provenance?.sourceSystem ?? "crm",
  });

  return { leadId: lead!.id, householdId: customer.householdId, alreadyExisted: false };
}

// Maps the existing WORKFLOWS.lead_to_install vocabulary (packages/domain-plugins/shared/
// workflow.ts) onto opportunities.pipelineStage — that state machine has no "lost" path
// today, so this only ever produces open/quote_sent/won; lostAt/lostReason remain
// available on the table for a future disqualify flow.
const STAGE_BY_STATUS: Record<string, "open" | "quote_sent" | "won"> = {
  water_test_scheduled: "open",
  test_completed: "open",
  quote_sent: "quote_sent",
  installed: "won",
  follow_up_sent: "won",
};

export type CanonicalLeadStatus = "new" | "contacted" | "qualified" | "disqualified" | "converted";

const LEAD_STATUS_BY_WORKFLOW: Record<string, CanonicalLeadStatus> = {
  lead: "new",
  water_test_scheduled: "contacted",
  test_completed: "qualified",
  quote_sent: "qualified",
  installed: "converted",
  follow_up_sent: "converted",
};

/** Keep the customer-facing workflow and the authoritative lead row in agreement. */
export function canonicalLeadStatusForWorkflow(workflowStatus: string): CanonicalLeadStatus {
  const status = LEAD_STATUS_BY_WORKFLOW[workflowStatus];
  if (!status) throw new Error(`Unsupported lead workflow status: ${workflowStatus}`);
  return status;
}

export interface UpdateLeadStatusParams {
  tenantId: string;
  leadId?: string;
  householdId?: string;
  status: CanonicalLeadStatus;
  disqualifyReason?: string;
  source?: string;
}

export interface UpdateLeadStatusResult {
  leadId: string;
  householdId: string | null;
  previousStatus: CanonicalLeadStatus;
  status: CanonicalLeadStatus;
  changed: boolean;
}

/**
 * Canonical mutation boundary for lead status. The lookup and update are both tenant
 * scoped, so a caller can never mutate a guessed/cross-tenant id. Replaying the same
 * state is a no-op and does not manufacture duplicate timeline events.
 */
export async function updateLeadStatus(
  db: Db,
  params: UpdateLeadStatusParams,
): Promise<UpdateLeadStatusResult | null> {
  if (!params.leadId && !params.householdId) {
    throw new Error("updateLeadStatus requires a resolved leadId or householdId");
  }
  const predicates = [eq(leads.tenantId, params.tenantId)];
  if (params.leadId) predicates.push(eq(leads.id, params.leadId));
  if (params.householdId) predicates.push(eq(leads.householdId, params.householdId));
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(...predicates))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  if (!lead) return null;

  const previousStatus = lead.status as CanonicalLeadStatus;
  const nextReason = params.status === "disqualified" ? params.disqualifyReason ?? lead.disqualifyReason : null;
  const changed = previousStatus !== params.status || lead.disqualifyReason !== nextReason;
  if (!changed) {
    return { leadId: lead.id, householdId: lead.householdId, previousStatus, status: params.status, changed: false };
  }

  const applied = await db
    .update(leads)
    .set({ status: params.status, disqualifyReason: nextReason })
    .where(and(
      eq(leads.tenantId, params.tenantId),
      eq(leads.id, lead.id),
      eq(leads.status, previousStatus),
      lead.disqualifyReason === null ? isNull(leads.disqualifyReason) : eq(leads.disqualifyReason, lead.disqualifyReason),
    ))
    .returning({ id: leads.id });
  if (applied.length === 0) {
    const [current] = await db
      .select({ status: leads.status, disqualifyReason: leads.disqualifyReason, householdId: leads.householdId })
      .from(leads)
      .where(and(eq(leads.tenantId, params.tenantId), eq(leads.id, lead.id)))
      .limit(1);
    if (!current) return null;
    return {
      leadId: lead.id,
      householdId: current.householdId,
      previousStatus,
      status: current.status as CanonicalLeadStatus,
      changed: false,
    };
  }
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "lead",
    entityId: lead.id,
    eventType: "lead_status_changed",
    payload: { from: previousStatus, to: params.status, ...(nextReason ? { disqualifyReason: nextReason } : {}) },
    source: params.source ?? "crm",
  });
  return { leadId: lead.id, householdId: lead.householdId, previousStatus, status: params.status, changed: true };
}

export interface ConvertLeadParams {
  tenantId: string;
  householdId: string;
  status: string;
}

export async function convertLeadToOpportunity(
  db: Db,
  params: ConvertLeadParams,
): Promise<{ opportunityId: string | null }> {
  if (params.status === "lead") return { opportunityId: null };
  const stage = STAGE_BY_STATUS[params.status] ?? "open";

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenantId, params.tenantId), eq(leads.householdId, params.householdId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);

  const [existingOpp] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.tenantId, params.tenantId), eq(opportunities.householdId, params.householdId)))
    .orderBy(desc(opportunities.createdAt))
    .limit(1);

  const wonAt = stage === "won" ? new Date() : undefined;

  if (existingOpp) {
    await db
      .update(opportunities)
      .set({ pipelineStage: stage, ...(wonAt ? { wonAt } : {}) })
      .where(eq(opportunities.id, existingOpp.id));
    await recordBusinessEvent(db, {
      tenantId: params.tenantId,
      entityType: "opportunity",
      entityId: existingOpp.id,
      eventType: "opportunity_stage_changed",
      payload: { stage },
      source: "crm",
    });
    return { opportunityId: existingOpp.id };
  }

  const [opp] = await db
    .insert(opportunities)
    .values({
      tenantId: params.tenantId,
      leadId: lead?.id ?? null,
      householdId: params.householdId,
      pipelineStage: stage,
      ...(wonAt ? { wonAt } : {}),
    })
    .returning();

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "opportunity",
    entityId: opp!.id,
    eventType: "opportunity_created",
    payload: { stage },
    source: "crm",
  });

  return { opportunityId: opp!.id };
}
