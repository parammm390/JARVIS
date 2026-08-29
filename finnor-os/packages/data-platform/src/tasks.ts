import { tasks, type Db } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface CreateTaskParams {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  title: string;
  dueAt?: Date;
  assigneeType?: "user" | "technician";
  assigneeId?: string;
  priority?: "low" | "normal" | "high";
  assignedPartyType?: "employee" | "team";
  assignedPartyId?: string;
  workId?: string;
  sourceDomainActionId?: string;
  eventPayload?: Record<string, unknown>;
  eventSource?: string;
}

export async function createTask(db: Db, params: CreateTaskParams): Promise<{ taskId: string; task: typeof tasks.$inferSelect; alreadyExisted: boolean }> {
  if (params.sourceDomainActionId) {
    const [existing] = await db.select().from(tasks).where(and(
      eq(tasks.tenantId, params.tenantId), eq(tasks.sourceDomainActionId, params.sourceDomainActionId),
    )).limit(1);
    if (existing) return { taskId: existing.id, task: existing, alreadyExisted: true };
  }
  const [task] = await db
    .insert(tasks)
    .values({
      tenantId: params.tenantId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      title: params.title,
      dueAt: params.dueAt ?? null,
      assigneeType: params.assigneeType ?? null,
      assigneeId: params.assigneeId ?? null,
      assignedPartyType: params.assignedPartyType ?? null,
      assignedPartyId: params.assignedPartyId ?? null,
      workId: params.workId ?? null,
      sourceDomainActionId: params.sourceDomainActionId ?? null,
      priority: params.priority ?? "normal",
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "task",
    entityId: task!.id,
    eventType: "task_created",
    payload: params.eventPayload ?? {},
    source: params.eventSource,
  });
  return { taskId: task!.id, task: task!, alreadyExisted: false };
}

export async function updateTask(
  db: Db,
  params: {
    tenantId: string;
    taskId: string;
    patch: {
      title?: string;
      dueAt?: Date | null;
      status?: "open" | "done" | "cancelled";
      priority?: "low" | "normal" | "high";
      assigneeType?: "user" | "technician" | null;
      assigneeId?: string | null;
      assignedPartyType?: "employee" | "team" | null;
      assignedPartyId?: string | null;
    };
    eventType?: string;
    eventPayload?: Record<string, unknown>;
    eventSource?: string;
  },
): Promise<typeof tasks.$inferSelect | null> {
  await db.execute(sql`SELECT id FROM ${tasks} WHERE ${tasks.tenantId}=${params.tenantId} AND ${tasks.id}=${params.taskId}::uuid FOR UPDATE`);
  const [updated] = await db.update(tasks).set({ ...params.patch, updatedAt: new Date() }).where(and(
    eq(tasks.tenantId, params.tenantId), eq(tasks.id, params.taskId),
  )).returning();
  if (!updated) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "task",
    entityId: params.taskId,
    eventType: params.eventType ?? "task_updated",
    payload: { status: updated.status, ...(params.eventPayload ?? {}) },
    source: params.eventSource,
  });
  return updated;
}
