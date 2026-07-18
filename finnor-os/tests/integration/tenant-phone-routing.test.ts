// Phase 14 (docs/jarvis-99-phase-10-16-execution-plan.md, "PHASE 14"): the multi-tenant
// proof that resolveTenantFromCall actually routes correctly and no side effect leaks
// across tenants. Two tenants, each with a distinct registered Vapi line; synthetic
// tool-calls webhook bodies differing ONLY in call.phoneNumberId; every resulting row
// (voice_sessions, domain_actions transition) must land under its own tenant and never
// the other. VAPI_DEFAULT_TENANT_ID is deliberately unset for this suite — if
// resolveTenantFromCall ever silently fell back to it, both calls would collapse onto
// the same tenant and the leak assertions below would catch it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, tenants, domainActions, voiceSessions } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createPendingConfirmation, openVoiceSession } from "@finnor/voice-os";
import { getOrchestrator } from "../../apps/api/lib/orchestrator";
import { POST } from "../../apps/api/app/api/webhooks/vapi/route";
import type { DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

const TENANT_E2 = "00000000-0000-4000-8000-0000000000e2";
const TENANT_E3 = "00000000-0000-4000-8000-0000000000e3";

const T = {
  e2: { id: TENANT_E2, name: "Routing Test Tenant E2", ownerPhone: "+15551112000", vapiPhoneNumberId: "phone-e2", dialedNumber: "+15550002000" },
  e3: { id: TENANT_E3, name: "Routing Test Tenant E3", ownerPhone: "+15551113000", vapiPhoneNumberId: "phone-e3", dialedNumber: "+15550003000" },
};

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

async function draftAndGate(tenantId: string, label: string): Promise<DomainAction> {
  const orchestrator = getOrchestrator();
  const row = await withTenant(tenantId, async (db) => {
    const [r] = await db
      .insert(domainActions)
      .values({
        tenantId,
        actionType: "answer_customer_question",
        payload: { tenantId, question: `Routing test question for ${label}` },
        policyId: null,
        status: "draft",
      })
      .returning();
    return r!;
  });
  const action: DomainAction = {
    id: row.id,
    tenantId: row.tenantId,
    actionType: row.actionType,
    payload: row.payload as Record<string, unknown>,
    policyId: row.policyId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
  const policy = await orchestrator.loadPolicy(action);
  const gateResult = await orchestrator.executor.execute(action, policy);
  expect(gateResult.output.gated).toBe(true);
  return action;
}

function toolCallsRequest(callId: string, phoneNumberId: string, callerNumber: string): Request {
  const body = {
    message: {
      type: "tool-calls",
      call: { id: callId, phoneNumberId, customer: { number: callerNumber } },
      toolCallList: [{ id: "tc-1", function: { name: "finnor_confirm", arguments: { decision: "yes" } } }],
    },
  };
  return new Request("http://localhost/api/webhooks/vapi", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!available)("POST /api/webhooks/vapi — tenant-by-phone routing (Phase 14)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.VAPI_WEBHOOK_SECRET = "";
    delete process.env.VAPI_DEFAULT_TENANT_ID;
    await migrate(DB_URL);
    for (const t of [T.e2, T.e3]) {
      await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [t.id, t.name]);
      await withTenant(t.id, (db) => db.update(tenants).set({ ownerPhone: t.ownerPhone }).where(eq(tenants.id, t.id)));
      await getPool().query(
        `INSERT INTO tenant_phone_numbers (tenant_id, phone_number, vapi_phone_number_id)
         SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM tenant_phone_numbers WHERE vapi_phone_number_id = $3)`,
        [t.id, t.dialedNumber, t.vapiPhoneNumberId],
      );
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it("two calls differing only in call.phoneNumberId resolve, confirm, and record under the correct tenant only", async () => {
    const callE2 = `call-e2-${randomUUID()}`;
    const callE3 = `call-e3-${randomUUID()}`;

    const actionE2 = await draftAndGate(T.e2.id, "e2");
    const actionE3 = await draftAndGate(T.e3.id, "e3");

    const sessionE2 = await openVoiceSession(T.e2.id, callE2);
    const sessionE3 = await openVoiceSession(T.e3.id, callE3);
    await createPendingConfirmation({ tenantId: T.e2.id, voiceSessionId: sessionE2.id, domainActionId: actionE2.id, promptText: "e2 question" });
    await createPendingConfirmation({ tenantId: T.e3.id, voiceSessionId: sessionE3.id, domainActionId: actionE3.id, promptText: "e3 question" });

    const resE2 = await POST(toolCallsRequest(callE2, T.e2.vapiPhoneNumberId, T.e2.ownerPhone));
    expect(resE2.status).toBe(200);
    const bodyE2 = (await resE2.json()) as { results: Array<{ result: string }> };
    expect(bodyE2.results[0]!.result).not.toMatch(/can't verify this line/);
    expect(bodyE2.results[0]!.result).toMatch(/Approved and done/);

    const resE3 = await POST(toolCallsRequest(callE3, T.e3.vapiPhoneNumberId, T.e3.ownerPhone));
    expect(resE3.status).toBe(200);
    const bodyE3 = (await resE3.json()) as { results: Array<{ result: string }> };
    expect(bodyE3.results[0]!.result).not.toMatch(/can't verify this line/);
    expect(bodyE3.results[0]!.result).toMatch(/Approved and done/);

    const [rowE2] = await withTenant(T.e2.id, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionE2.id)));
    const [rowE3] = await withTenant(T.e3.id, (db) => db.select().from(domainActions).where(eq(domainActions.id, actionE3.id)));
    expect(rowE2!.status).toBe("completed");
    expect(rowE3!.status).toBe("completed");

    // Leak check, explicit tenant filter (never rely on RLS alone — the embedded local
    // dev role bypasses FORCE ROW LEVEL SECURITY, per Phase 11's documented gotcha):
    // E2's call session must not exist under tenant E3's id, and vice versa.
    const e2SessionUnderE3 = await withTenant(T.e3.id, (db) =>
      db.select().from(voiceSessions).where(and(eq(voiceSessions.tenantId, T.e3.id), eq(voiceSessions.callExternalId, callE2))),
    );
    const e3SessionUnderE2 = await withTenant(T.e2.id, (db) =>
      db.select().from(voiceSessions).where(and(eq(voiceSessions.tenantId, T.e2.id), eq(voiceSessions.callExternalId, callE3))),
    );
    expect(e2SessionUnderE3).toHaveLength(0);
    expect(e3SessionUnderE2).toHaveLength(0);
  });

  it("a caller number matching the WRONG tenant's owner phone never gains trust, even when phoneNumberId routes correctly", async () => {
    // Dialed E2's line (phoneNumberId routes to E2) but the caller's own number matches
    // E3's owner phone, not E2's — must not be silently trusted as E2's owner.
    const crossCallId = `call-cross-${randomUUID()}`;
    const res = await POST(toolCallsRequest(crossCallId, T.e2.vapiPhoneNumberId, T.e3.ownerPhone));
    const body = (await res.json()) as { results: Array<{ result: string }> };
    expect(body.results[0]!.result).toMatch(/can't verify this line/);
  });
});
