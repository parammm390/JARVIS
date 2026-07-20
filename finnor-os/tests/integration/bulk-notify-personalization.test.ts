// bulk_notify_existing_customers, personalization + safety pass: proves each target's
// call gets ITS OWN equipment mentioned (never another household's), the discount
// number is exactly what the campaign set (never invented downstream), and the real
// per-tenant daily Vapi call cap (same one every other dial-out path enforces) stops
// a bulk campaign before it exceeds it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, households, equipment, apiRateLimits, adminDb, providerCircuitState } from "@finnor/db";
import { ToolRegistry } from "@finnor/tools";
import { findConsentedTargets, composeMessage, bulkNotifyPlugin } from "../../packages/domain-plugins/bulk-notify/index";
import type { DomainPolicy } from "@finnor/shared-types";

// A real permissive schema — ToolRegistry.call() genuinely runs
// tool.inputSchema.safeParse(input) before ever reaching run(), so a test double
// needs a real zod schema too, not a bare `undefined` stand-in.
const PASSTHROUGH_SCHEMA = z.object({}).passthrough();

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f5";

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

function fakePolicy(): DomainPolicy {
  return {
    id: "policy-1",
    tenantId: TENANT_ID,
    actionType: "bulk_notify_existing_customers",
    policy: {},
    requiresConfirmation: true,
    confirmationTemplate: null,
    version: 1,
  };
}

describe.skipIf(!available)("bulk_notify_existing_customers — personalization + volume safety", () => {
  let softenerHouseholdId: string;
  let filtrationHouseholdId: string;
  let originalVapiBreakerState: (typeof providerCircuitState.$inferSelect) | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Bulk Notify Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);

    // provider_circuit_state is global (no tenant_id) and this suite's own execute()
    // tests genuinely exercise withCircuitBreaker("vapi", ...) for real — capture
    // whatever state it's in (it may be open from an unrelated prior test run) and
    // force it closed for this suite, then restore the real prior state in afterAll,
    // same convention reliability-alerts.test.ts already uses for the same table.
    [originalVapiBreakerState] = await adminDb().select().from(providerCircuitState).where(eq(providerCircuitState.provider, "vapi"));
    await adminDb()
      .insert(providerCircuitState)
      .values({ provider: "vapi", state: "closed", consecutiveFailures: 0 })
      .onConflictDoUpdate({ target: providerCircuitState.provider, set: { state: "closed", consecutiveFailures: 0, openedAt: null } });

    await withTenant(TENANT_ID, async (db) => {
      const [softener] = await db
        .insert(households)
        .values({
          tenantId: TENANT_ID,
          address: "1 Softener Way",
          contactInfo: { name: "Alex Softener", phone: "+15550001001" },
          marketingConsent: true,
        })
        .returning({ id: households.id });
      softenerHouseholdId = softener!.id;
      await db.insert(equipment).values({ householdId: softenerHouseholdId, type: "water softener", source: "finnor" });

      const [filtration] = await db
        .insert(households)
        .values({
          tenantId: TENANT_ID,
          address: "2 Filtration Ave",
          contactInfo: { name: "Blair Filtration", phone: "+15550001002" },
          marketingConsent: true,
        })
        .returning({ id: households.id });
      filtrationHouseholdId = filtration!.id;
      await db.insert(equipment).values({ householdId: filtrationHouseholdId, type: "whole-house filtration", source: "finnor" });
    });
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(equipment).where(eq(equipment.householdId, softenerHouseholdId));
      await db.delete(equipment).where(eq(equipment.householdId, filtrationHouseholdId));
      await db.delete(households).where(eq(households.tenantId, TENANT_ID));
    });
    await getPool().query(`DELETE FROM api_rate_limits WHERE bucket_key LIKE $1`, [`budget:${TENANT_ID}:%`]);
    if (originalVapiBreakerState) {
      await adminDb()
        .update(providerCircuitState)
        .set({ state: originalVapiBreakerState.state, consecutiveFailures: originalVapiBreakerState.consecutiveFailures, openedAt: originalVapiBreakerState.openedAt })
        .where(eq(providerCircuitState.provider, "vapi"));
    } else {
      await adminDb().delete(providerCircuitState).where(eq(providerCircuitState.provider, "vapi"));
    }
    await closePool();
  });

  it("findConsentedTargets attaches each household's OWN equipment, never mixed", async () => {
    const targets = await findConsentedTargets(TENANT_ID);
    const softener = targets.find((t) => t.householdId === softenerHouseholdId);
    const filtration = targets.find((t) => t.householdId === filtrationHouseholdId);
    expect(softener?.equipmentSummary).toBe("water softener");
    expect(filtration?.equipmentSummary).toBe("whole-house filtration");
  });

  it("composeMessage: a default message mentions the target's own equipment and the exact discount given, nothing invented", () => {
    const msg = composeMessage({ householdId: "x", label: "Alex", phone: "+1", equipmentSummary: "water softener" }, undefined, 15);
    expect(msg).toContain("Alex");
    expect(msg).toContain("water softener");
    expect(msg).toContain("15%");
    // A different target's message must never reference this one's equipment.
    const other = composeMessage({ householdId: "y", label: "Blair", phone: "+2", equipmentSummary: "whole-house filtration" }, undefined, 15);
    expect(other).not.toContain("water softener");
    expect(msg).not.toContain("whole-house filtration");
  });

  it("composeMessage: an owner-supplied script substitutes {name}/{equipment}/{discount} per target", () => {
    const msg = composeMessage(
      { householdId: "x", label: "Alex", phone: "+1", equipmentSummary: "water softener" },
      "Hi {name}, checking in on your {equipment} — {discount} off this month!",
      15,
    );
    expect(msg).toBe("Hi Alex, checking in on your water softener — 15% off this month!");
  });

  it("execute(): each target's real outbound call gets its OWN personalized instructions, never the other's equipment", async () => {
    const registry = new ToolRegistry();
    const placedCalls: { phoneNumber: string; instructions: string }[] = [];
    registry.register({
      name: "vapi_place_call",
      description: "test double",
      integration: "vapi",
      inputSchema: PASSTHROUGH_SCHEMA,
      async run(input: Record<string, unknown>) {
        placedCalls.push({ phoneNumber: String(input.phoneNumber), instructions: String(input.instructions) });
        return { id: "fake-call-id" };
      },
    });

    const draft = await bulkNotifyPlugin.draft(
      "bulk_notify_existing_customers",
      { channel: "call", discountPercent: 15, minMonthsInactive: 0 },
      fakePolicy(),
    );
    expect(draft.requiresConfirmation).toBe(true);
    const result = await bulkNotifyPlugin.execute(draft, registry);

    expect(result.status).toBe("success");
    expect(placedCalls).toHaveLength(2);
    const softenerCall = placedCalls.find((c) => c.phoneNumber === "+15550001001");
    const filtrationCall = placedCalls.find((c) => c.phoneNumber === "+15550001002");
    expect(softenerCall?.instructions).toContain("water softener");
    expect(softenerCall?.instructions).not.toContain("whole-house filtration");
    expect(filtrationCall?.instructions).toContain("whole-house filtration");
    expect(filtrationCall?.instructions).not.toContain("water softener");
    // The exact discount number appears — never a different or invented number.
    expect(softenerCall?.instructions).toContain("15%");
  });

  it("execute(): the real per-tenant daily Vapi call cap stops a campaign before exceeding it", async () => {
    // Pre-seed today's bucket to 199/200 so the FIRST claim in this test (200) is
    // still allowed, and the SECOND (201) is correctly refused — proving the bulk
    // path shares the exact same cap every other dial-out path enforces, not a
    // separate, forgettable one.
    const today = new Date().toISOString().slice(0, 10);
    await getPool().query(
      `INSERT INTO api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, 199)
       ON CONFLICT (bucket_key, window_started_at) DO UPDATE SET count = 199`,
      [`budget:${TENANT_ID}:vapi:call:${today}`, `${today}T00:00:00.000Z`],
    );

    const registry = new ToolRegistry();
    let calls = 0;
    registry.register({
      name: "vapi_place_call",
      description: "test double",
      integration: "vapi",
      inputSchema: PASSTHROUGH_SCHEMA,
      async run() {
        calls++;
        return { id: "fake-call-id" };
      },
    });

    const draft = await bulkNotifyPlugin.draft(
      "bulk_notify_existing_customers",
      { channel: "call", discountPercent: 15, minMonthsInactive: 0 },
      fakePolicy(),
    );
    const result = await bulkNotifyPlugin.execute(draft, registry);

    expect(calls).toBe(1); // the 200th call goes through
    expect(result.output.sent).toBe(1);
    expect(result.output.capped).toBe(1); // the 2nd target is correctly withheld, not silently dropped
  });
});
