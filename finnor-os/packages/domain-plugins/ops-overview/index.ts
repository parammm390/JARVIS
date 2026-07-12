// Ops overview — REAL, native: a single read-only action that answers the "what's
// going on right now" questions (leads, pending approvals, inventory, invoices,
// upcoming visits) by querying Finnor's own tables. No mutation, ungated by default —
// this is a dashboard read, not a business action, so nothing here needs a human gate.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, households, domainActions, inventoryItems, invoices, serviceVisits } from "@finnor/db";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

const ACTION = "get_business_overview";

export const OverviewPayloadSchema = z.object({
  focus: z
    .enum(["all", "leads", "pending", "inventory", "invoices", "visits"])
    .nullish()
    .transform((v) => v ?? "all"),
});

async function loadOverview(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const [leadCount] = await db.select({ n: sql<number>`count(*)::int` }).from(households);

    const pendingActions = await db
      .select({ actionType: domainActions.actionType, status: domainActions.status })
      .from(domainActions)
      .where(sql`${domainActions.status} in ('pending', 'needs_human_review', 'blocked_integration_unavailable')`);

    const lowStock = await db
      .select({ name: inventoryItems.name, quantity: inventoryItems.quantity, threshold: inventoryItems.reorderThreshold })
      .from(inventoryItems)
      .where(lt(inventoryItems.quantity, inventoryItems.reorderThreshold));

    const overdueInvoices = await db
      .select({ id: invoices.id, amountUsd: invoices.amountUsd, householdId: invoices.householdId })
      .from(invoices)
      .where(and(eq(invoices.status, "overdue")));

    const unpaidSent = await db
      .select({ id: invoices.id, amountUsd: invoices.amountUsd })
      .from(invoices)
      .where(eq(invoices.status, "sent"));

    const upcomingVisits = await db
      .select({ id: serviceVisits.id, type: serviceVisits.type, scheduledAt: serviceVisits.scheduledAt })
      .from(serviceVisits)
      .where(and(gte(serviceVisits.scheduledAt, new Date()), isNull(serviceVisits.completedAt)));

    return {
      leads: { total: leadCount?.n ?? 0 },
      pending: {
        total: pendingActions.length,
        awaitingApproval: pendingActions.filter((a) => a.status === "pending").length,
        needsHumanReview: pendingActions.filter((a) => a.status === "needs_human_review").length,
        blockedIntegration: pendingActions.filter((a) => a.status === "blocked_integration_unavailable").length,
      },
      inventory: {
        lowStockCount: lowStock.length,
        lowStockItems: lowStock.slice(0, 5).map((i) => `${i.name} (${i.quantity}/${i.threshold})`),
      },
      invoices: {
        overdueCount: overdueInvoices.length,
        overdueTotalUsd: overdueInvoices.reduce((s, i) => s + Number(i.amountUsd), 0),
        unpaidSentCount: unpaidSent.length,
        unpaidSentTotalUsd: unpaidSent.reduce((s, i) => s + Number(i.amountUsd), 0),
      },
      visits: {
        upcomingCount: upcomingVisits.length,
        next: upcomingVisits
          .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
          .slice(0, 3)
          .map((v) => `${v.type} at ${v.scheduledAt?.toISOString().slice(0, 16).replace("T", " ")}`),
      },
    };
  });
}

function speak(o: Awaited<ReturnType<typeof loadOverview>>): string {
  const parts: string[] = [];
  parts.push(`${o.leads.total} lead${o.leads.total === 1 ? "" : "s"} on file.`);
  if (o.pending.total > 0) {
    parts.push(
      `${o.pending.awaitingApproval} waiting on your approval` +
        (o.pending.needsHumanReview ? `, ${o.pending.needsHumanReview} flagged for human review` : "") +
        (o.pending.blockedIntegration ? `, ${o.pending.blockedIntegration} blocked on an integration` : "") +
        ".",
    );
  } else {
    parts.push("Nothing pending right now.");
  }
  parts.push(
    o.inventory.lowStockCount > 0
      ? `${o.inventory.lowStockCount} item${o.inventory.lowStockCount === 1 ? "" : "s"} below reorder threshold: ${o.inventory.lowStockItems.join(", ")}.`
      : "Inventory looks fine, nothing below threshold.",
  );
  parts.push(
    o.invoices.overdueCount > 0
      ? `${o.invoices.overdueCount} overdue invoice${o.invoices.overdueCount === 1 ? "" : "s"} totaling $${o.invoices.overdueTotalUsd.toFixed(2)}.`
      : "No overdue invoices.",
  );
  if (o.invoices.unpaidSentCount > 0) {
    parts.push(`${o.invoices.unpaidSentCount} invoice${o.invoices.unpaidSentCount === 1 ? "" : "s"} sent and awaiting payment, $${o.invoices.unpaidSentTotalUsd.toFixed(2)} total.`);
  }
  parts.push(
    o.visits.upcomingCount > 0
      ? `${o.visits.upcomingCount} upcoming visit${o.visits.upcomingCount === 1 ? "" : "s"}. Next: ${o.visits.next.join("; ")}.`
      : "No upcoming visits scheduled.",
  );
  return parts.join(" ");
}

export const opsOverviewPlugin: DomainEnginePlugin = {
  name: "ops-overview",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: OverviewPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = OverviewPayloadSchema.safeParse(payload);
    return p.success ? { valid: true, errors: [] } : { valid: false, errors: p.error.issues.map((i) => i.message) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = OverviewPayloadSchema.parse(payload);
    return {
      actionType,
      summary: "Pull a live business overview (leads, pending approvals, inventory, invoices, upcoming visits).",
      payload: { ...p, tenantId: policy.tenantId },
      // Read-only — never needs a human gate regardless of policy default.
      requiresConfirmation: false,
    };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const overview = await loadOverview(tenantId);
    return {
      status: "success",
      output: { ...overview, spokenSummary: speak(overview) },
      expected: { answered: true },
    };
  },
};

export default opsOverviewPlugin;
