import { workOrders, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateWorkOrderParams {
  tenantId: string;
  householdId: string;
  type: "install" | "repair" | "warranty" | "other";
  quoteId?: string;
  technicianId?: string;
  depositAmountUsd?: number;
  scheduledAt?: Date;
}

export async function updateWorkOrderStatus(
  db: Db,
  params: {
    tenantId: string;
    workOrderId: string;
    status: "draft" | "scheduled" | "in_progress" | "completed" | "canceled";
    completedAt?: Date | null;
    eventType?: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<typeof workOrders.$inferSelect | null> {
  const [workOrder] = await db.update(workOrders).set({
    status: params.status,
    ...(params.completedAt !== undefined ? { completedAt: params.completedAt } : {}),
  }).where(and(eq(workOrders.tenantId, params.tenantId), eq(workOrders.id, params.workOrderId))).returning();
  if (!workOrder) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "work_order",
    entityId: params.workOrderId,
    eventType: params.eventType ?? "work_order_status_changed",
    payload: { status: params.status, ...(params.eventPayload ?? {}) },
  });
  return workOrder;
}

export async function createWorkOrder(db: Db, params: CreateWorkOrderParams): Promise<{ workOrderId: string }> {
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: params.tenantId,
      householdId: params.householdId,
      type: params.type,
      quoteId: params.quoteId ?? null,
      technicianId: params.technicianId ?? null,
      depositAmountUsd: params.depositAmountUsd != null ? params.depositAmountUsd.toFixed(2) : null,
      scheduledAt: params.scheduledAt ?? null,
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "work_order",
    entityId: wo!.id,
    eventType: "work_order_created",
  });
  return { workOrderId: wo!.id };
}
