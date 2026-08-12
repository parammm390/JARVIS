import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminDb,
  businessEvents,
  calls,
  closePool,
  communicationsLog,
  conversations,
  households,
  jobs,
  tasks,
  withTenant,
} from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { POST } from "../../apps/api/app/api/webhooks/vapi/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

function reportRequest(callId: string, householdId: string, structuredData: Record<string, unknown>, transcript: string): Request {
  return new Request("http://localhost/api/webhooks/vapi", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        type: "end-of-call-report",
        transcript,
        startedAt: "2026-08-10T15:00:00.000Z",
        endedAt: "2026-08-10T15:04:00.000Z",
        endedReason: "customer-ended-call",
        analysis: { structuredData },
        call: {
          id: callId,
          customer: { number: "+15550009991" },
          phoneNumber: { number: "+15550009992" },
          metadata: {
            direction: "outbound",
            agentKey: "win-back",
            purpose: "winback",
            domainActionId: randomUUID(),
            householdId,
          },
        },
      },
    }),
  });
}

describe.skipIf(!available)("Vapi outbound customer safety", () => {
  let householdId = "";
  const callIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.VAPI_WEBHOOK_SECRET = "";
    process.env.VAPI_DEFAULT_TENANT_ID = SEED_TENANT_ID;
    await migrate(DB_URL);
    await seed(DB_URL);
    const [household] = await withTenant(SEED_TENANT_ID, (db) => db.insert(households).values({
      tenantId: SEED_TENANT_ID,
      address: "991 Safety Test Lane",
      contactInfo: { name: "Outbound Safety Test", phone: "+15550009991" },
      marketingConsent: true,
    }).returning({ id: households.id }));
    householdId = household!.id;
  });

  afterAll(async () => {
    if (callIds.length > 0) await adminDb().delete(jobs).where(inArray(jobs.idempotencyKey, callIds.map((id) => `vapi:${id}`)));
    await withTenant(SEED_TENANT_ID, async (db) => {
      const taskRows = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, SEED_TENANT_ID), eq(tasks.subjectId, householdId)));
      if (taskRows.length > 0) await db.delete(businessEvents).where(and(eq(businessEvents.tenantId, SEED_TENANT_ID), eq(businessEvents.entityType, "task"), inArray(businessEvents.entityId, taskRows.map((task) => task.id))));
      await db.delete(tasks).where(and(eq(tasks.tenantId, SEED_TENANT_ID), eq(tasks.subjectId, householdId)));
      await db.delete(businessEvents).where(and(eq(businessEvents.tenantId, SEED_TENANT_ID), eq(businessEvents.entityId, householdId)));
      await db.delete(communicationsLog).where(eq(communicationsLog.householdId, householdId));
      const conversationRows = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.tenantId, SEED_TENANT_ID), eq(conversations.householdId, householdId)));
      if (conversationRows.length > 0) {
        const callRows = await db.select({ id: calls.id }).from(calls).where(and(eq(calls.tenantId, SEED_TENANT_ID), eq(calls.conversationId, conversationRows[0]!.id)));
        if (callRows.length > 0) await db.delete(businessEvents).where(and(eq(businessEvents.tenantId, SEED_TENANT_ID), eq(businessEvents.entityType, "call"), inArray(businessEvents.entityId, callRows.map((call) => call.id))));
        await db.delete(calls).where(and(eq(calls.tenantId, SEED_TENANT_ID), eq(calls.conversationId, conversationRows[0]!.id)));
        await db.delete(conversations).where(eq(conversations.id, conversationRows[0]!.id));
      }
      await db.delete(households).where(eq(households.id, householdId));
    });
    await closePool();
  });

  it("persists a win-back outcome and follow-up task without enqueueing customer speech as an owner instruction", async () => {
    const callId = `outbound-safety-${randomUUID()}`;
    callIds.push(callId);
    const response = await POST(reportRequest(callId, householdId, {
      outcome: "interested",
      sentiment: "positive",
      appointmentRequested: true,
      preferredTimeText: "Tuesday afternoon",
      optOut: false,
      experienceSummary: "Happy with the water quality and interested in a filter check.",
    }, "Tuesday afternoon would be great."));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outbound: true, outcome: "interested" });

    const queued = await adminDb().select().from(jobs).where(eq(jobs.idempotencyKey, `vapi:${callId}`));
    expect(queued).toHaveLength(0);
    const state = await withTenant(SEED_TENANT_ID, async (db) => ({
      calls: await db.select().from(calls).where(and(eq(calls.tenantId, SEED_TENANT_ID), eq(calls.externalId, callId))),
      comms: await db.select().from(communicationsLog).where(eq(communicationsLog.householdId, householdId)),
      tasks: await db.select().from(tasks).where(and(eq(tasks.tenantId, SEED_TENANT_ID), eq(tasks.subjectId, householdId))),
      events: await db.select().from(businessEvents).where(and(eq(businessEvents.tenantId, SEED_TENANT_ID), eq(businessEvents.entityId, householdId), eq(businessEvents.eventType, "campaign_call_completed"))),
    }));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.direction).toBe("outbound");
    expect(state.comms.at(-1)?.content).toContain("outcome: interested");
    expect(state.tasks.some((task) => task.title.includes("Tuesday afternoon"))).toBe(true);
    expect(state.events).toHaveLength(1);
  });

  it("turns an explicit opt-out into durable consent revocation", async () => {
    const callId = `outbound-optout-${randomUUID()}`;
    callIds.push(callId);
    const response = await POST(reportRequest(callId, householdId, {
      outcome: "opted_out",
      sentiment: "negative",
      appointmentRequested: false,
      optOut: true,
      experienceSummary: "Asked not to receive marketing calls.",
    }, "Please do not call me again."));
    expect(await response.json()).toMatchObject({ outbound: true, outcome: "opted_out" });
    const [household] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(households).where(eq(households.id, householdId)));
    expect(household!.marketingConsent).toBe(false);
  });
});
