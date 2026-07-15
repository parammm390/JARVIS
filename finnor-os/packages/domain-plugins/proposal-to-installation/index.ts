// Vertical workflow 3 (Phase 4, docs/jarvis-90-execution-blueprint.md §4.3): signed
// proposal to installation. work_orders/procurement_orders/warehouse_stock (Phase 1)
// were 100% unused before this plugin — this is their first real caller. Covers
// deposit/payment, stock reservation (with a real procurement-exception fallback when
// stock is short), and dispatch (work order creation). Checklist/completion/handoff
// are exposed as a direct function (`completeInstallation`) rather than a full
// technician-facing checklist UI — that's a real, honestly-scoped simplification, not
// a claim that a checklist system exists.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, invoices, warehouses, warehouseStock, workOrders } from "@finnor/db";
import { submitCommand, enqueueStep } from "@finnor/workflow-runtime";
import { recordBusinessEvent } from "@finnor/data-platform";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const StartInstallationWorkflowSchema = z.object({
  quoteId: z.string().uuid(),
  householdId: z.string().uuid(),
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  depositAmountUsd: z.number().positive(),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  start_installation_workflow: StartInstallationWorkflowSchema,
};

export const proposalToInstallationPlugin: DomainEnginePlugin = {
  name: "proposal-to-installation",
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
    const p = StartInstallationWorkflowSchema.parse(payload);
    return {
      actionType,
      summary: `Start installation for household ${p.householdId.slice(0, 8)}: reserve ${p.quantity}× ${p.sku}, collect a $${p.depositAmountUsd} deposit, and dispatch.`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, _tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;
    const quoteId = String(p.quoteId);
    const householdId = String(p.householdId);
    const sku = String(p.sku);
    const quantity = Number(p.quantity);
    const depositAmountUsd = Number(p.depositAmountUsd);
    const idempotencyKey = `installation:${quoteId}`;

    // Deposit invoice — invoices is the pre-Phase-1 canonical table, no external call.
    const invoice = await withTenant(tenantId, async (db) => {
      const [row] = await db
        .insert(invoices)
        .values({ tenantId, householdId, amountUsd: depositAmountUsd.toFixed(2), status: "sent", memo: "Installation deposit" })
        .returning();
      return row!;
    });

    // Procurement exception check: does the default warehouse have enough stock right
    // now? If not, a receive_procurement step for the shortfall is inserted BEFORE the
    // reservation — a real fallback, not just a documented gap.
    const currentStock = await withTenant(tenantId, async (db) => {
      const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)));
      if (!wh) return 0;
      const [stock] = await db.select().from(warehouseStock).where(and(eq(warehouseStock.warehouseId, wh.id), eq(warehouseStock.sku, sku)));
      return stock?.quantity ?? 0;
    });
    const shortfall = Math.max(0, quantity - currentStock);

    const steps: Array<{ stepType: string; payload: Record<string, unknown> }> = [];
    if (shortfall > 0) {
      steps.push({ stepType: "receive_procurement", payload: { tenantId, sku, quantityOrdered: shortfall, idempotencyKey: `${idempotencyKey}:procure` } });
    }
    steps.push({ stepType: "reserve_stock", payload: { tenantId, sku, quantity, idempotencyKey: `${idempotencyKey}:reserve` } });
    steps.push({
      stepType: "record_deposit_payment",
      payload: { tenantId, invoiceId: invoice.id, amountUsd: depositAmountUsd, idempotencyKey: `${idempotencyKey}:deposit` },
    });
    steps.push({
      stepType: "create_work_order",
      payload: { tenantId, householdId, quoteId, workOrderType: "install", depositAmountUsd, idempotencyKey: `${idempotencyKey}:wo` },
    });

    const submitted = await withTenant(tenantId, (db) =>
      submitCommand(db, {
        tenantId,
        commandType: "start_installation_workflow",
        payload: { quoteId, householdId, invoiceId: invoice.id },
        workflowType: "signed_proposal_to_installation",
        idempotencyKey,
        steps,
      }),
    );

    if (!submitted.alreadyExisted) {
      await enqueueStep(tenantId, submitted.stepIds[0]!, steps[0]!.payload.idempotencyKey as string);
    }

    return {
      status: "success",
      output: {
        commandId: submitted.commandId,
        workflowRunId: submitted.workflowRunId,
        invoiceId: invoice.id,
        procurementNeeded: shortfall > 0,
      },
      expected: { started: true },
    };
  },
};

export default proposalToInstallationPlugin;

/** Checklist/completion/handoff (blueprint §4.3's tail end) — exposed directly rather
 *  than as a full technician-facing checklist UI/action type; a real, scoped
 *  simplification, not a claim that a checklist system exists. */
export async function completeInstallation(tenantId: string, workOrderId: string): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.update(workOrders).set({ status: "completed", completedAt: new Date() }).where(eq(workOrders.id, workOrderId));
    await recordBusinessEvent(db, { tenantId, entityType: "work_order", entityId: workOrderId, eventType: "installation_completed" });
  });
}
