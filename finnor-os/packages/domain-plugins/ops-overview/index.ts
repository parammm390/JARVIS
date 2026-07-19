// Ops overview — REAL, native: a single read-only action that answers the "what's
// going on right now" questions (leads, pending approvals, inventory, invoices,
// upcoming visits) by querying Finnor's own tables. No mutation, ungated by default —
// this is a dashboard read, not a business action, so nothing here needs a human gate.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { resolveProvider, testAdsConnections, testQuickBooksConnection } from "@finnor/tools";
import { withTenant, households, domainActions, inventoryItems, invoices, serviceVisits, communicationsLog, maintenanceAgreements } from "@finnor/db";
import { hybridRetrieve } from "@finnor/memory";
import { readConfidenceThreshold } from "../shared/plugin-interface";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

const ACTION = "get_business_overview";
const ASK_ACTION = "answer_business_question";

export const OverviewPayloadSchema = z.object({
  focus: z
    .enum(["all", "leads", "pending", "inventory", "invoices", "visits"])
    .nullish()
    .transform((v) => v ?? "all"),
});

export const AskPayloadSchema = z.object({
  question: z.string().min(2).max(500),
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

/**
 * Broader cross-domain snapshot for open-ended questions ("what's our revenue",
 * "how's the Petersons' history been", "what's trending") that don't map to any
 * narrow action_type. Every field here is a REAL query result — nothing invented.
 * Deliberately includes what we DON'T track (e.g. a per-payment timestamp) so the
 * LLM synthesis step can say "I don't have that specific figure" instead of
 * silently guessing or refusing outright.
 */
async function loadFinanceAndHistorySnapshot(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const allInvoices = await db.select().from(invoices);
    const paid = allInvoices.filter((i) => i.status === "paid");
    const overdue = allInvoices.filter((i) => i.status === "overdue");
    const sent = allInvoices.filter((i) => i.status === "sent");
    const recentComms = await db
      .select({ householdId: communicationsLog.householdId, channel: communicationsLog.channel, content: communicationsLog.content, timestamp: communicationsLog.timestamp })
      .from(communicationsLog)
      .orderBy(desc(communicationsLog.timestamp))
      .limit(15);
    const agreements = await db.select().from(maintenanceAgreements);
    return {
      dataAvailable: {
        note: "Invoices have a status and a due_date, but no per-payment timestamp is recorded yet — 'revenue today/this week' as a same-day figure is not something this system currently tracks. All-time totals by status ARE real.",
      },
      invoices: {
        paidCount: paid.length,
        paidTotalUsd: paid.reduce((s, i) => s + Number(i.amountUsd), 0),
        overdueCount: overdue.length,
        overdueTotalUsd: overdue.reduce((s, i) => s + Number(i.amountUsd), 0),
        sentCount: sent.length,
        sentTotalUsd: sent.reduce((s, i) => s + Number(i.amountUsd), 0),
      },
      maintenanceAgreements: {
        active: agreements.filter((a) => a.status === "active").length,
        renewalWindow: agreements.filter((a) => a.status === "renewal_window").length,
        lapsed: agreements.filter((a) => a.status === "lapsed").length,
      },
      recentCommunications: recentComms.map((c) => ({
        channel: c.channel,
        note: c.content.slice(0, 200),
        daysAgo: Math.round((Date.now() - c.timestamp.getTime()) / 86_400_000),
      })),
    };
  });
}

/** Sonnet if available (best grounding discipline), DeepSeek/Groq fallback via the
 *  same composite chain everything else uses — resolveProvider() with no arg. */
async function synthesizeAnswer(question: string, data: unknown): Promise<string> {
  const provider = resolveProvider();
  const text = await provider.complete({
    system:
      "You answer a water treatment dealer owner's business question using ONLY the JSON data given. " +
      "Treat every field except semanticSnippets as ground truth (real query results); semanticSnippets are " +
      "supporting context from past records, never a substitute for a ground-truth field when both cover the " +
      "same fact. Never state a number or fact not present in the data. If the specific thing asked isn't in " +
      "the data, say so plainly and offer the closest real figure that IS available. One or two short spoken " +
      "sentences, no preamble.",
    user: JSON.stringify({ question, data }),
  });
  return text.trim();
}

export const opsOverviewPlugin: DomainEnginePlugin = {
  name: "ops-overview",
  actionTypes: [ACTION, ASK_ACTION],
  payloadSchemas: { [ACTION]: OverviewPayloadSchema, [ASK_ACTION]: AskPayloadSchema },
  canHandle: (t) => t === ACTION || t === ASK_ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType === ACTION) {
      const p = OverviewPayloadSchema.safeParse(payload);
      return p.success ? { valid: true, errors: [] } : { valid: false, errors: p.error.issues.map((i) => i.message) };
    }
    if (actionType === ASK_ACTION) {
      const p = AskPayloadSchema.safeParse(payload);
      return p.success ? { valid: true, errors: [] } : { valid: false, errors: p.error.issues.map((i) => i.message) };
    }
    return { valid: false, errors: [`unhandled action ${actionType}`] };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    if (actionType === ASK_ACTION) {
      const p = AskPayloadSchema.parse(payload);
      return {
        actionType,
        summary: `Look up an answer to: "${p.question}"`,
        payload: { ...p, tenantId: policy.tenantId, retrievalConfidenceThreshold: readConfidenceThreshold(policy) },
        requiresConfirmation: false, // read-only
      };
    }
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
    if (draft.actionType === ASK_ACTION) {
      const question = String(draft.payload.question ?? "");
      // Integration health checks cost real OAuth round trips (Meta, Google, QBO) —
      // only pay that latency when the question is actually about integrations, not
      // on every grounded-QA call regardless of topic.
      const asksAboutIntegrations = /\b(integration|connected|quickbooks|meta ads|google ads|ads account|vapi|ghl|gohighlevel)\b/i.test(question);
      const [overview, finance, integrations] = await Promise.all([
        loadOverview(tenantId),
        loadFinanceAndHistorySnapshot(tenantId),
        asksAboutIntegrations
          ? Promise.all([testAdsConnections(), testQuickBooksConnection()]).then(([ads, qb]) => ({ meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks: qb }))
          : Promise.resolve(undefined),
      ]);
      // §5.3: structured facts (the real overview/finance query results above) come
      // first — retrieval order is law. Semantic memory (past receipts, transcripts,
      // reports) supplements, never substitutes, and every source cited flows straight
      // into this action's DecisionReceipt via output.citations (extracted in
      // packages/workflow-runtime/src/steps.ts).
      const structured = [
        { source: "business_overview", ref: "current", data: overview },
        { source: "finance_history_snapshot", ref: "current", data: finance },
        ...(integrations ? [{ source: "integrations_status", ref: "current", data: integrations }] : []),
      ];
      const confidenceThreshold = typeof draft.payload.retrievalConfidenceThreshold === "number" ? draft.payload.retrievalConfidenceThreshold : undefined;
      const retrieval = await hybridRetrieve({ tenantId, query: question, structured, confidenceThreshold });
      const data = { ...retrieval.facts, semanticSnippets: retrieval.semanticHits.map((h) => h.chunk) };
      try {
        const answer = await synthesizeAnswer(question, data);
        return { status: "success", output: { spokenSummary: answer, groundedOn: data, citations: retrieval.citations }, expected: { answered: true } };
      } catch (err) {
        // LLM synthesis failed — never silently drop the question. Fall back to the
        // deterministic overview narration so the caller still gets something real.
        return {
          status: "success",
          output: {
            spokenSummary: `I couldn't fully process that question, but here's the current picture: ${speak(overview)}`,
            error: (err as Error).message,
            citations: retrieval.citations,
          },
          expected: { answered: true },
        };
      }
    }
    const overview = await loadOverview(tenantId);
    // §5.3: this branch has no free-text question to retrieve against, but it's still
    // one of the four "answer actions" the receipt-citation contract covers — the live
    // overview itself is the structured fact; a generic query surfaces any relevant
    // recent memory (e.g. a noted recurring issue) as supporting citations too.
    const retrieval = await hybridRetrieve({
      tenantId,
      query: "business overview leads pending inventory invoices visits",
      structured: [{ source: "business_overview", ref: "current", data: overview }],
    });
    return {
      status: "success",
      output: { ...overview, spokenSummary: speak(overview), citations: retrieval.citations },
      expected: { answered: true },
    };
  },
};

export default opsOverviewPlugin;
