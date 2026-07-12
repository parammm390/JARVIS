// CRM domain plugin — REAL, native: Finnor's database is the CRM. Leads are households,
// interactions land in communications_log, statuses live on the workflow state machine.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, households, communicationsLog, serviceVisits } from "@finnor/db";
import { advanceWorkflowState, WORKFLOWS } from "../shared/workflow";
import { findHousehold, findTechnician } from "../shared/db-helpers";
import { sql } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const CreateLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  address: opt(z.string()),
  email: opt(z.string().email()),
  notes: opt(z.string().max(2000)),
});
export const UpdateLeadStatusSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  status: z.enum(WORKFLOWS.lead_to_install),
});
export const LogInteractionSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  channel: z.enum(["call", "sms", "email", "in_person"]).default("call"),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  content: z.string().min(1).max(5000),
});
export const AssignLeadSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  technicianId: opt(z.string().uuid()),
  technicianName: opt(z.string()),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_lead: CreateLeadSchema,
  update_lead_status: UpdateLeadStatusSchema,
  log_interaction: LogInteractionSchema,
  assign_lead_to_technician: AssignLeadSchema,
};

export const crmPlugin: DomainEnginePlugin = {
  name: "crm",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const summaries: Record<string, string> = {
      create_lead: `Create a new lead: ${p.name} (${p.phone})${p.address ? ` at ${p.address}` : ""}.`,
      update_lead_status: `Move ${p.phone ?? p.householdId} to status "${String(p.status).replaceAll("_", " ")}".`,
      log_interaction: `Log a ${p.direction} ${p.channel} interaction: "${String(p.content).slice(0, 120)}"`,
      assign_lead_to_technician: `Assign the lead ${p.phone ?? p.householdId} to ${p.technicianName ?? p.technicianId} for follow-up.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;

    if (draft.actionType === "create_lead") {
      const existing = await findHousehold(tenantId, { phone: String(p.phone) });
      if (existing) {
        return { status: "success", output: { householdId: existing.id, alreadyExisted: true }, expected: { created: true } };
      }
      const hh = await withTenant(tenantId, async (db) => {
        const [row] = await db
          .insert(households)
          .values({
            tenantId,
            address: String(p.address ?? "(address pending)"),
            contactInfo: { name: p.name, phone: p.phone, ...(p.email ? { email: p.email } : {}) },
          })
          .returning();
        return row!;
      });
      await advanceWorkflowState(tenantId, "lead_to_install", "household", hh.id, "lead", "create_lead");
      if (p.notes) {
        await withTenant(tenantId, (db) =>
          db.insert(communicationsLog).values({ householdId: hh.id, channel: "call", direction: "inbound", content: String(p.notes) }),
        );
      }
      return { status: "success", output: { householdId: hh.id, workflowState: "lead" }, expected: { created: true } };
    }

    const hh = await findHousehold(tenantId, {
      householdId: p.householdId ? String(p.householdId) : undefined,
      phone: p.phone ? String(p.phone) : undefined,
    });
    if (!hh) return { status: "failure", output: {}, error: "No customer found with that phone or id. Create the lead first." };

    if (draft.actionType === "update_lead_status") {
      await advanceWorkflowState(tenantId, "lead_to_install", "household", hh.id, String(p.status), "update_lead_status");
      return { status: "success", output: { householdId: hh.id, status: p.status }, expected: { updated: true } };
    }

    if (draft.actionType === "log_interaction") {
      await withTenant(tenantId, (db) =>
        db.insert(communicationsLog).values({
          householdId: hh.id,
          channel: String(p.channel),
          direction: String(p.direction) as "inbound" | "outbound",
          content: String(p.content),
        }),
      );
      return { status: "success", output: { householdId: hh.id, logged: true }, expected: { logged: true } };
    }

    // assign_lead_to_technician
    const tech = await findTechnician(tenantId, {
      technicianId: p.technicianId ? String(p.technicianId) : undefined,
      name: p.technicianName ? String(p.technicianName) : undefined,
    });
    if (!tech) return { status: "failure", output: {}, error: "No technician found by that name or id." };
    const visit = await withTenant(tenantId, async (db) => {
      const [row] = await db
        .insert(serviceVisits)
        .values({ householdId: hh.id, technicianId: tech.id, type: "lead_follow_up" })
        .returning();
      return row!;
    });
    return {
      status: "success",
      output: { visitId: visit.id, technician: tech.name, householdId: hh.id },
      expected: { assigned: true },
    };
  },
};

export default crmPlugin;
