// Workflow engine (§14): explicit state machines over workflow_states, with append-only
// transition history. Successful action executions advance the relevant machine —
// state lives in the database, never implicitly in application logic.

import { withTenant, workflowStates, households, serviceVisits } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";

export const WORKFLOWS = {
  lead_to_install: ["lead", "water_test_scheduled", "test_completed", "quote_sent", "installed", "follow_up_sent"],
  amc_renewal: ["agreement_active", "renewal_window", "renewal_sent", "renewed", "lapsed"],
} as const;

interface Transition {
  workflow: keyof typeof WORKFLOWS;
  subjectType: "household" | "maintenance_agreement";
  toState: string;
  /** How to find the subject id in the executed action's payload. */
  subject: (payload: Record<string, unknown>) => Promise<string | null> | string | null;
}

async function householdByPhone(tenantId: string, phone: string): Promise<string | null> {
  if (!phone) return null;
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select({ id: households.id })
      .from(households)
      .where(sql`${households.contactInfo} ->> 'phone' = ${phone}`),
  );
  return row?.id ?? null;
}

function transitionsFor(tenantId: string): Record<string, Transition> {
  return {
    schedule_water_test: {
      workflow: "lead_to_install",
      subjectType: "household",
      toState: "water_test_scheduled",
      subject: (p) =>
        p.householdId ? String(p.householdId) : householdByPhone(tenantId, String(p.contactPhone ?? "")),
    },
    log_visit_report: {
      workflow: "lead_to_install",
      subjectType: "household",
      toState: "test_completed", // overridden dynamically below by the visit's actual type
      subject: () => null, // resolved from visitId below — most real calls only carry that
    },
    send_proposal_to_recent_installs: {
      workflow: "lead_to_install",
      subjectType: "household",
      toState: "follow_up_sent",
      subject: () => null, // per-target advancement handled below (batch)
    },
    generate_quote: {
      workflow: "lead_to_install",
      subjectType: "household",
      toState: "quote_sent",
      subject: (p) => (p.householdId ? String(p.householdId) : null),
    },
    renew_maintenance_agreement: {
      workflow: "amc_renewal",
      subjectType: "maintenance_agreement",
      toState: "renewal_sent",
      subject: (p) => (p.agreementId ? String(p.agreementId) : null),
    },
  };
}

export async function advanceWorkflowState(
  tenantId: string,
  workflow: keyof typeof WORKFLOWS,
  subjectType: string,
  subjectId: string,
  toState: string,
  cause: string,
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    const [existing] = await db
      .select()
      .from(workflowStates)
      .where(
        and(
          eq(workflowStates.tenantId, tenantId),
          eq(workflowStates.workflow, workflow),
          eq(workflowStates.subjectId, subjectId),
        ),
      );
    const entry = { from: existing?.state ?? null, to: toState, cause, at: new Date().toISOString() };
    if (existing) {
      const history = Array.isArray(existing.history) ? existing.history : [];
      await db
        .update(workflowStates)
        .set({ state: toState, history: [...history, entry], updatedAt: new Date() })
        .where(eq(workflowStates.id, existing.id));
    } else {
      await db.insert(workflowStates).values({
        tenantId,
        workflow,
        subjectType,
        subjectId,
        state: toState,
        history: [entry],
      });
    }
  });
}

/** Called by the executor after a successful execution. Unknown action types no-op. */
export async function advanceWorkflowForAction(
  tenantId: string,
  actionType: string,
  payload: Record<string, unknown>,
): Promise<Array<{ workflow: string; subjectId: string; toState: string }>> {
  const advanced: Array<{ workflow: string; subjectId: string; toState: string }> = [];
  const t = transitionsFor(tenantId)[actionType];
  if (!t) return advanced;

  // log_visit_report: the real signal for which stage a visit completion means is the
  // visit's own type (a technician logging an install visit means "installed", a water
  // test visit means "test_completed") — and most real calls only carry visitId, not
  // householdId, so resolve both from the visit row instead of trusting the payload.
  if (actionType === "log_visit_report") {
    const visitId = payload.visitId ? String(payload.visitId) : null;
    let householdId = payload.householdId ? String(payload.householdId) : null;
    let toState = "test_completed";
    if (visitId) {
      const [visit] = await withTenant(tenantId, (db) => db.select().from(serviceVisits).where(eq(serviceVisits.id, visitId)));
      if (visit) {
        householdId = householdId ?? visit.householdId;
        if (visit.type.toLowerCase().includes("install")) toState = "installed";
      }
    }
    if (!householdId) return advanced;
    await advanceWorkflowState(tenantId, t.workflow, t.subjectType, householdId, toState, actionType);
    advanced.push({ workflow: t.workflow, subjectId: householdId, toState });
    return advanced;
  }

  // Batch actions advance every target household.
  if (actionType === "send_proposal_to_recent_installs" && Array.isArray(payload.targets)) {
    for (const target of payload.targets as Array<Record<string, unknown>>) {
      const id = target.householdId ? String(target.householdId) : null;
      if (!id) continue;
      await advanceWorkflowState(tenantId, t.workflow, t.subjectType, id, t.toState, actionType);
      advanced.push({ workflow: t.workflow, subjectId: id, toState: t.toState });
    }
    return advanced;
  }

  const subjectId = await t.subject(payload);
  if (!subjectId) return advanced;
  await advanceWorkflowState(tenantId, t.workflow, t.subjectType, subjectId, t.toState, actionType);
  advanced.push({ workflow: t.workflow, subjectId, toState: t.toState });
  return advanced;
}
