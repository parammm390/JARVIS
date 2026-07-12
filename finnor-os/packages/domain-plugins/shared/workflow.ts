// Workflow engine (§14): explicit state machines over workflow_states, with append-only
// transition history. Successful action executions advance the relevant machine —
// state lives in the database, never implicitly in application logic.

import { withTenant, workflowStates, households } from "@finnor/db";
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
      toState: "test_completed",
      subject: (p) => (p.householdId ? String(p.householdId) : null),
    },
    send_proposal_to_recent_installs: {
      workflow: "lead_to_install",
      subjectType: "household",
      toState: "follow_up_sent",
      subject: () => null, // per-target advancement handled below (batch)
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
