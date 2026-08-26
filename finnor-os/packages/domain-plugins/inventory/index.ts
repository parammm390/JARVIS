// Inventory domain plugin — REAL, native: inventory_items is the stock ledger.

import type { DomainEnginePlugin, PureDomainEngine } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { withTenant, inventoryItems } from "@finnor/db";
import { recordBusinessEvent } from "@finnor/data-platform";
import { findInventoryItem } from "../shared/db-helpers";
import { eq, sql, lte } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const StockLevelSchema = z.object({ sku: opt(z.string()), name: opt(z.string()) });
export const ReorderCheckSchema = z.object({
  sku: opt(z.string()),
  name: opt(z.string()),
  // Advisory context from the B3 EWMA scan. It neither orders nor changes stock.
  reasoning: opt(z.string().max(500)),
  suggestedQuantity: opt(z.number().int().nonnegative().max(1_000_000)),
});
export const LogUsageSchema = z.object({
  sku: opt(z.string()),
  name: opt(z.string()),
  quantity: z.number().int().positive().max(1000),
  visitId: opt(z.string().uuid()),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  check_stock_level: StockLevelSchema,
  flag_reorder_needed: ReorderCheckSchema,
  log_stock_used_on_visit: LogUsageSchema,
};

/** Migrated canonical/internal consequential intelligence. The legacy execute seam
 * below remains only as the governed durable-runtime adapter. */
export const stockUsageDomainEngine: PureDomainEngine = {
  name: "inventory-stock-usage",
  version: "1.0.0",
  actionTypes: ["log_stock_used_on_visit"],
  query: () => ({ requiredFacts: ["inventory_item.quantity", "inventory_item.reorder_threshold"] }),
  decide: ({ payload }) => {
    const quantity = Number(payload.quantity);
    return { eligible: Number.isInteger(quantity) && quantity > 0, effectIntent: `Deduct ${quantity} unit(s) from the canonical inventory ledger`, requiredCapability: "action:log_stock_used_on_visit", risk: "medium", reasonCodes: Number.isInteger(quantity) && quantity > 0 ? ["CANONICAL_STOCK_DECREMENT"] : ["INVALID_QUANTITY"] };
  },
  simulate: ({ payload, canonicalState }) => {
    const before = Number(canonicalState?.quantity);
    const quantity = Number(payload.quantity);
    return { predicted: { quantityBefore: Number.isFinite(before) ? before : null, quantityAfter: Number.isFinite(before) ? before - quantity : null }, warnings: Number.isFinite(before) && before < quantity ? ["INSUFFICIENT_STOCK"] : [] };
  },
  explain: (_input, decision) => ({ summary: decision.effectIntent, reasonCodes: decision.reasonCodes }),
  compileEffect: ({ effectId, payload }, decision) => ({
    id: effectId, actionType: "log_stock_used_on_visit", effectIntent: decision.effectIntent, payload,
    targetRefs: typeof payload.visitId === "string" ? [{ kind: "entity", entityType: "service_visit", entityId: payload.visitId, field: "visitId", provenance: "pure_domain_engine" }] : [],
    requiredCapability: decision.requiredCapability, risk: decision.risk, exposure: null, proposalOnly: true,
  }),
  defineObservation: ({ observationId, effect }) => ({ id: observationId, effectId: effect.id, kind: "canonical_state", predicate: { actionType: effect.actionType, quantityDecremented: effect.payload.quantity }, requiredEvidence: ["inventory_read_back", "stock_usage_business_event"], acknowledgementSufficient: false, verificationFloor: "at_least_existing" }),
  reconcileDecision: ({ observation }) => observation.inventoryReadBack === true && observation.businessEventRecorded === true
    ? { status: "verified", reasonCodes: ["CANONICAL_STATE_AND_EVENT_OBSERVED"] }
    : observation.failed === true ? { status: "failed", reasonCodes: ["CANONICAL_WRITE_FAILED"] } : { status: "pending", reasonCodes: ["READ_BACK_REQUIRED"] },
  compileCompensationEffect: () => null,
};

export const inventoryPlugin: DomainEnginePlugin = {
  name: "inventory",
  actionTypes: Object.keys(SCHEMAS),
  intelligence: stockUsageDomainEngine,
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
    const what = String(p.sku ?? p.name ?? "all items");
    const summaries: Record<string, string> = {
      check_stock_level: `Check stock level for ${what}.`,
      flag_reorder_needed: p.reasoning
        ? `Review reorder suggestion for ${what}: ${p.reasoning}`
        : `Check whether ${what} is at or below its reorder threshold.`,
      log_stock_used_on_visit: `Deduct ${p.quantity} × ${what} from stock${p.visitId ? ` (visit ${String(p.visitId).slice(0, 8)})` : ""}.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async simulate(actionType, payload, policy) {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    if (actionType !== "log_stock_used_on_visit") {
      return { mode: "schema" as const, summary: `${actionType.replaceAll("_", " ")} is read-only; no stock mutation is predicted.`, predicted: { actionType, fieldChanges: [] } };
    }
    const item = await findInventoryItem(policy.tenantId, { sku: p.sku ? String(p.sku) : undefined, name: p.name ? String(p.name) : undefined });
    const quantity = Number(p.quantity);
    const after = item ? item.quantity - quantity : null;
    return {
      mode: "dry_run" as const,
      summary: item && after !== null && after >= 0 ? `Dry run: ${quantity} × ${item.name} would reduce stock from ${item.quantity} to ${after}; inventory was not changed.` : "Dry run: no stock deduction is predicted because the item is missing or quantity is unavailable.",
      predicted: { sku: item?.sku ?? p.sku ?? null, itemFound: Boolean(item), quantity, fieldChanges: item && after !== null && after >= 0 ? [{ field: "quantity", from: item.quantity, to: after }] : [], expectedResult: item && after !== null && after >= 0 ? { sku: item.sku, remaining: after, reorderNeeded: after <= item.reorderThreshold } : undefined },
    };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;

    if (draft.actionType === "check_stock_level") {
      if (!p.sku && !p.name) {
        const all = await withTenant(tenantId, (db) => db.select().from(inventoryItems));
        return {
          status: "success",
          output: { items: all.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, reorderThreshold: i.reorderThreshold })) },
          expected: { answered: true },
        };
      }
      const item = await findInventoryItem(tenantId, { sku: p.sku ? String(p.sku) : undefined, name: p.name ? String(p.name) : undefined });
      if (!item) {
        // A voice/text instruction that didn't name a real SKU still deserves a real
        // answer, not a hard failure — fall back to the full list rather than making
        // the caller repeat themselves with more precise wording.
        const all = await withTenant(tenantId, (db) => db.select().from(inventoryItems));
        return {
          status: "success",
          output: {
            note: `Didn't recognize "${p.sku ?? p.name}" as a specific item — here's everything in stock instead.`,
            items: all.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, reorderThreshold: i.reorderThreshold })),
          },
          expected: { answered: true },
        };
      }
      return { status: "success", output: { ...item }, expected: { answered: true } };
    }

    if (draft.actionType === "flag_reorder_needed") {
      if (!p.sku && !p.name) {
        // No specific item: report everything at or below threshold.
        const low = await withTenant(tenantId, (db) =>
          db.select().from(inventoryItems).where(lte(inventoryItems.quantity, sql`${inventoryItems.reorderThreshold}`)),
        );
        return {
          status: "success",
          output: { reorderNeeded: low.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, threshold: i.reorderThreshold })) },
          expected: { answered: true },
        };
      }
      const item = await findInventoryItem(tenantId, { sku: p.sku ? String(p.sku) : undefined, name: p.name ? String(p.name) : undefined });
      if (!item) return { status: "failure", output: {}, error: `No inventory item matches "${p.sku ?? p.name}".`, errorKind: "validation" };
      return {
        status: "success",
        output: { ...item, reorderNeeded: item.quantity <= item.reorderThreshold },
        expected: { answered: true },
      };
    }

    // log_stock_used_on_visit — atomic decrement, never below zero.
    const item = await findInventoryItem(tenantId, { sku: p.sku ? String(p.sku) : undefined, name: p.name ? String(p.name) : undefined });
    if (!item) return { status: "failure", output: {}, error: `No inventory item matches "${p.sku ?? p.name}".`, errorKind: "validation" };
    const qty = Number(p.quantity);
    if (item.quantity < qty) {
      return {
        status: "failure",
        output: { available: item.quantity },
        error: `Only ${item.quantity} × ${item.name} in stock — can't deduct ${qty}. Update the count or reorder first.`,
        errorKind: "validation",
      };
    }
    const updated = await withTenant(tenantId, async (db) => {
      const [row] = await db
        .update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} - ${qty}` })
        .where(eq(inventoryItems.id, item.id))
        .returning();
      await recordBusinessEvent(db, {
        tenantId,
        entityType: "inventory_item",
        entityId: row!.id,
        eventType: "stock_used_on_visit",
        payload: { quantity: qty, remaining: row!.quantity, visitId: p.visitId ?? null },
      });
      return row!;
    });
    return {
      status: "success",
      output: {
        sku: updated.sku,
        remaining: updated.quantity,
        reorderNeeded: updated.quantity <= updated.reorderThreshold,
      },
      expected: { deducted: qty },
    };
  },
};

export default inventoryPlugin;
