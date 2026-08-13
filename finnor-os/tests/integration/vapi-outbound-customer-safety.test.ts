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
  households,
  getPool,
  jobs,
  tasks,
  withTenant,
} from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { POST } from "../../apps/api/app/api/webhooks/vapi/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const PHONE_NUMBER_ID = "phone-outbound-safety-test";
const DIALED_NUMBER = "+15550009992";

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
          phoneNumberId: PHONE_NUMBER_ID,
          customer: { number: "+15550009991" },
          phoneNumber: { number: DIALED_NUMBER },
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
    await migrate(DB_URL);
    await seed(DB_URL);
    await getPool().query(
      `INSERT INTO tenant_phone_numbers (tenant_id, phone_number, vapi_phone_number_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (vapi_phone_number_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, phone_number = EXCLUDED.phone_number`,
      [SEED_TENANT_ID, DIALED_NUMBER, PHONE_NUMBER_ID],
    );
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
    // Business events are intentionally append-only. Every fixture uses fresh IDs,
    // so leave its canonical entities in place rather than orphaning audit history.
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
