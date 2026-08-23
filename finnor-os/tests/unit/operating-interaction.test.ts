import { describe, expect, it } from "vitest";
import { OperatingInteractionContextSchema, SubmitInstructionSchema } from "@finnor/policy-schema";
import {
  applyOperatingInteractionTargets,
  effectiveInteractionTargets,
  interactionAwareOperationalDecision,
} from "@finnor/orchestration";
import type { OperatingInteractionContext } from "@finnor/shared-types";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";

function context(overrides: Partial<OperatingInteractionContext> = {}): OperatingInteractionContext {
  return {
    version: 1,
    capturedAt: "2026-08-22T10:00:00.000Z",
    source: "text",
    selectedEntities: [],
    excludedEntities: [],
    surface: { id: "money", route: "/jarvis/money", spatialState: "list" },
    filters: [],
    ...overrides,
  };
}

describe("Phase 1 operating interaction contract", () => {
  it("accepts the same semantic context for text and voice intake", () => {
    const selected = [{ entityType: "household" as const, entityId: A }];
    for (const channel of ["text", "voice"] as const) {
      const parsed = SubmitInstructionSchema.parse({
        instruction: "Show me their open invoices",
        channel,
        activeContext: context({ source: channel, selectedEntities: selected }),
      });
      expect(parsed.activeContext?.selectedEntities).toEqual(selected);
    }
  });

  it("fails closed on unknown shape and oversized direct selections", () => {
    expect(OperatingInteractionContextSchema.safeParse({ ...context(), tenantId: A }).success).toBe(false);
    const selectedEntities = Array.from({ length: 51 }, (_, index) => ({ entityType: "invoice" as const, entityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    expect(OperatingInteractionContextSchema.safeParse(context({ selectedEntities })).success).toBe(false);
  });

  it("targets exactly three selected invoices and never a fourth", () => {
    const planned = applyOperatingInteractionTargets([{
      action_type: "call_overdue_invoices",
      payload: {},
      reasoning: "Call the requested invoices.",
    }], context({ selectedEntities: [A, B, C].map((entityId) => ({ entityType: "invoice", entityId })) }));
    expect(planned).toHaveLength(3);
    expect(planned.map((action) => (action.payload as Record<string, unknown>).invoiceId)).toEqual([A, B, C]);
    expect(planned.every((action) => action.action_type === "send_payment_reminder" && (action.payload as Record<string, unknown>).channel === "call")).toBe(true);
  });

  it("remaps downstream dependencies when one planned action expands to exact targets", () => {
    const planned = applyOperatingInteractionTargets([
      { action_type: "call_overdue_invoices", payload: {} },
      { action_type: "answer_business_question", payload: { question: "Summarize the outcome" }, depends_on: [0] },
    ], context({ selectedEntities: [A, B, C].map((entityId) => ({ entityType: "invoice", entityId })) }));
    expect(planned).toHaveLength(4);
    expect(planned[3]?.depends_on).toEqual([0, 1, 2]);
  });

  it("subtracts an explicit exclusion from the direct target set", () => {
    const ctx = context({
      selectedEntities: [A, B, C].map((entityId) => ({ entityType: "invoice", entityId })),
      excludedEntities: [{ entityType: "invoice", entityId: B }],
    });
    expect(effectiveInteractionTargets(ctx).map((ref) => ref.entityId)).toEqual([A, C]);
    expect(applyOperatingInteractionTargets([{ action_type: "record_payment", payload: {} }], ctx).map((action) => (action.payload as Record<string, unknown>).invoiceId)).toEqual([A, C]);
  });

  it("uses focused entity only when there is no additive selection", () => {
    expect(effectiveInteractionTargets(context({ focusedEntity: { entityType: "household", entityId: A } }))).toEqual([{ entityType: "household", entityId: A }]);
    expect(effectiveInteractionTargets(context({ focusedEntity: { entityType: "household", entityId: A }, selectedEntities: [{ entityType: "invoice", entityId: B }] }))).toEqual([{ entityType: "invoice", entityId: B }]);
  });

  it("grounds a pronoun business question on one focused customer", () => {
    const [action] = applyOperatingInteractionTargets(
      [{ action_type: "answer_business_question", payload: { question: "Show me their open invoices" } }],
      context({ focusedEntity: { entityType: "household", entityId: A } }),
    );
    expect(action?.payload).toEqual({ question: "Show me their open invoices", householdId: A });
  });

  it("keeps a large cohort compact and grounds its exact stored bounds", () => {
    const ctx = context({
      cohort: { kind: "work_query_execution", executionId: A, entityType: "household", queryIntent: "customer_cohort", count: 12_500 },
      filters: [{ field: "minDaysInactive", operator: "gte", value: 90 }],
      excludedEntities: [{ entityType: "household", entityId: B }],
    });
    const [action] = applyOperatingInteractionTargets([{ action_type: "bulk_notify_existing_customers", payload: { channel: "sms", discountPercent: 10 } }], ctx);
    expect(action?.payload).toMatchObject({ cohortExecutionId: A, cohortCount: 12_500, minDaysInactive: 90, excludedHouseholdIds: [B] });
    expect(JSON.stringify(action?.payload)).not.toContain("targetHouseholdIds");
  });

  it("routes a global fast read through the context-aware planner when an exact target exists", () => {
    const decision = interactionAwareOperationalDecision(
      { route: "fast_read", confidence: "high", request: { intent: "money_summary" } },
      context({ focusedEntity: { entityType: "household", entityId: A } }),
    );
    expect(decision).toEqual({ route: "planner", reason: "unsupported" });
  });

  it("does not confuse explicit selection with authority", () => {
    const [action] = applyOperatingInteractionTargets([{ action_type: "record_payment", payload: {} }], context({ selectedEntities: [{ entityType: "invoice", entityId: A }] }));
    expect(action?.payload).toEqual({ invoiceId: A });
    expect(action?.payload).not.toHaveProperty("authorized");
    expect(action?.payload).not.toHaveProperty("approved");
  });
});
