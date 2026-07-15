import { workOrders, type Db } from "@finnor/db";
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
