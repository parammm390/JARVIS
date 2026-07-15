// Canonical lead/opportunity records. Dual-write compromise (confirmed, see the plan):
// the crm plugin has always created a household eagerly on create_lead ("Leads are
// households" — packages/domain-plugins/crm/index.ts), and 4 other plugins plus
// tests/integration/native-business-layer.test.ts depend on that. createLead() adds a
// real `leads` row alongside that existing behavior rather than replacing it — full
// decoupling (deferring household creation until qualification) is future work.

import { households, leads, opportunities, type Db } from "@finnor/db";
import { and, eq, desc } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

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

  const [household] = await db
    .insert(households)
    .values({
      tenantId: params.tenantId,
      address: params.address ?? "(address pending)",
      contactInfo: { name: params.name, phone: params.phone, ...(params.email ? { email: params.email } : {}) },
    })
    .returning();

  const [lead] = await db
    .insert(leads)
    .values({
      tenantId: params.tenantId,
      householdId: household!.id,
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

  return { leadId: lead!.id, householdId: household!.id, alreadyExisted: false };
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
