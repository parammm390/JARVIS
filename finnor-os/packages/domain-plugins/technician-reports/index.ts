// technician-reports: log_visit_report is real (writes the visit record after the gate);
// flag_visit_issue follows the §5 scaffold pattern until the dealer defines triage rules.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, serviceVisits, households, domainActions } from "@finnor/db";
import { recordBusinessEvent } from "@finnor/data-platform";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const VisitReportPayloadSchema = z.object({
  visitId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  householdId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  report: z.string().min(3).max(5000),
  markCompleted: z.boolean().default(true),
});

export const FlagIssuePayloadSchema = z.object({
  visitId: z.string().uuid().nullish().transform((v) => v ?? undefined),
  issue: z.string().min(3).max(2000),
});

export const technicianReportsPlugin: DomainEnginePlugin = {
  name: "technician-reports",
  actionTypes: ["log_visit_report", "flag_visit_issue"],
  payloadSchemas: { log_visit_report: VisitReportPayloadSchema, flag_visit_issue: FlagIssuePayloadSchema },
  canHandle: (t) => t === "log_visit_report" || t === "flag_visit_issue",

  validate(actionType, payload): ValidationResult {
    const schema = actionType === "log_visit_report" ? VisitReportPayloadSchema : FlagIssuePayloadSchema;
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    if (actionType === "log_visit_report") {
      const p = VisitReportPayloadSchema.parse(payload);
      return {
        actionType,
        summary: `Log this visit report${p.markCompleted ? " and mark the visit completed" : ""}: "${p.report.slice(0, 160)}${p.report.length > 160 ? "…" : ""}"`,
        payload: { ...p, tenantId: policy.tenantId },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    const p = FlagIssuePayloadSchema.parse(payload);
    return {
      actionType,
      summary: `Flag a visit issue for the owner's review: "${p.issue.slice(0, 160)}"`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    if (draft.actionType === "flag_visit_issue") {
      // Real: annotate the visit and surface a review card in the owner's queue.
      const tenantId = String(draft.payload.tenantId ?? "");
      const visitId = draft.payload.visitId ? String(draft.payload.visitId) : null;
      const issue = String(draft.payload.issue ?? "");
      if (visitId) {
        await withTenant(tenantId, async (db) => {
          const [v] = await db.select().from(serviceVisits).where(eq(serviceVisits.id, visitId));
          if (v) {
            await db
              .update(serviceVisits)
              .set({ notes: [v.notes, `[ISSUE] ${issue}`].filter(Boolean).join(" | ") })
              .where(eq(serviceVisits.id, visitId));
          }
        });
      }
      const review = await withTenant(tenantId, async (db) => {
        const [row] = await db
          .insert(domainActions)
          .values({
            tenantId,
            actionType: "flag_visit_issue",
            payload: { issue, visitId },
            status: "needs_human_review",
            summary: `Technician flagged an issue${visitId ? ` on visit ${visitId.slice(0, 8)}` : ""}: ${issue.slice(0, 160)}`,
          })
          .returning();
        await recordBusinessEvent(db, {
          tenantId,
          entityType: "service_visit",
          entityId: visitId ?? row!.id,
          eventType: "issue_flagged",
          payload: { issue, reviewCardId: row!.id },
        });
        return row!;
      });
      return { status: "success", output: { reviewCardId: review.id, flagged: true }, expected: { flagged: true } };
    }
    const tenantId = String(draft.payload.tenantId ?? "");
    const visitId = draft.payload.visitId ? String(draft.payload.visitId) : null;
    const report = String(draft.payload.report ?? "");
    const markCompleted = Boolean(draft.payload.markCompleted);
    if (!tenantId) return { status: "failure", output: {}, error: "Missing tenant context" };

    const updated = await withTenant(tenantId, async (db) => {
      if (visitId) {
        const [row] = await db
          .update(serviceVisits)
          .set({ notes: report, ...(markCompleted ? { completedAt: new Date() } : {}) })
          .where(eq(serviceVisits.id, visitId))
          .returning();
        if (row) {
          await recordBusinessEvent(db, {
            tenantId,
            entityType: "service_visit",
            entityId: row.id,
            eventType: "visit_report_logged",
            payload: { markCompleted },
          });
        }
        return row ?? null;
      }
      // No visit id: attach the report as a new ad-hoc visit on the household.
      const householdId = draft.payload.householdId ? String(draft.payload.householdId) : null;
      if (!householdId) return null;
      const [hh] = await db.select().from(households).where(eq(households.id, householdId));
      if (!hh) return null;
      const [row] = await db
        .insert(serviceVisits)
        .values({ householdId, type: "ad_hoc_report", notes: report, completedAt: markCompleted ? new Date() : null })
        .returning();
      await recordBusinessEvent(db, {
        tenantId,
        entityType: "service_visit",
        entityId: row!.id,
        eventType: "visit_report_logged",
        payload: { markCompleted, adHoc: true },
      });
      return row;
    });
    if (!updated) {
      return { status: "failure", output: {}, error: "Could not find the visit or household to attach this report to." };
    }
    return { status: "success", output: { visitId: updated.id }, expected: { logged: true } };
  },
};

export default technicianReportsPlugin;
