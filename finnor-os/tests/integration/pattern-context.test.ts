// Retrieval-based pattern context acceptance (Phase 9): real DB, real aggregate
// queries, real proof that the data actually reaches the planner's outgoing prompt —
// a type addition to MemorySnapshot alone proves nothing (see finding #4 in the
// execution plan doc); test 4 below is the one that actually proves it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  getPool,
  closePool,
  withTenant,
  households,
  proposals,
  quotes,
  businessEvents,
  technicians,
  appointments,
} from "@finnor/db";
import { buildPatternContext, buildMemorySnapshot } from "@finnor/memory";
import { LLMPlanner, createDefaultPluginRegistry } from "@finnor/orchestration";
import type { LLMProvider } from "@finnor/orchestration";
import type { TenantContext } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000fb"; // dedicated, isolated from other fixtures

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

describe.skipIf(!available)("Pattern context (Phase 9)", () => {
  let householdId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Pattern Context Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);

    await withTenant(TENANT_ID, async (db) => {
      // Idempotent across repeated runs against the real, persistent dev DB —
      // technicianReliability is tenant-wide (not household-scoped), so without this
      // a second run would accumulate a duplicate technician/appointment set on top
      // of the first and break the exact-count assertions below.
      await db.delete(appointments).where(eq(appointments.tenantId, TENANT_ID));
      await db.delete(technicians).where(eq(technicians.tenantId, TENANT_ID));

      const [household] = await db
        .insert(households)
        .values({ tenantId: TENANT_ID, address: "1 Pattern Way" })
        .returning();
      householdId = household!.id;

      // 3 proposals/quotes: 2 accepted (known totalUsd each), 1 declined.
      const [quoteAccepted1] = await db.insert(quotes).values({ tenantId: TENANT_ID, householdId, status: "accepted", totalUsd: "1000" }).returning();
      const [quoteAccepted2] = await db.insert(quotes).values({ tenantId: TENANT_ID, householdId, status: "accepted", totalUsd: "2000" }).returning();
      const [quoteDeclined] = await db.insert(quotes).values({ tenantId: TENANT_ID, householdId, status: "declined", totalUsd: "500" }).returning();

      await db.insert(proposals).values({ householdId, quoteId: quoteAccepted1!.id, status: "accepted" });
      await db.insert(proposals).values({ householdId, quoteId: quoteAccepted2!.id, status: "accepted" });
      await db.insert(proposals).values({ householdId, quoteId: quoteDeclined!.id, status: "draft" }); // proposals.status never mirrors "declined" — the real signal is business_events

      await db.insert(businessEvents).values({ tenantId: TENANT_ID, entityType: "quote", entityId: quoteAccepted1!.id, eventType: "quote_accepted" });
      await db.insert(businessEvents).values({ tenantId: TENANT_ID, entityType: "quote", entityId: quoteAccepted2!.id, eventType: "quote_accepted" });
      await db.insert(businessEvents).values({ tenantId: TENANT_ID, entityType: "quote", entityId: quoteDeclined!.id, eventType: "quote_declined" });

      // 1 technician, 5 appointments, 1 no_show.
      const [tech] = await db.insert(technicians).values({ tenantId: TENANT_ID, name: "Pattern Tech" }).returning();
      const statuses = ["confirmed", "confirmed", "confirmed", "confirmed", "no_show"] as const;
      for (const status of statuses) {
        await db.insert(appointments).values({
          tenantId: TENANT_ID,
          subjectType: "household",
          subjectId: householdId,
          technicianId: tech!.id,
          status,
          scheduledAt: new Date(),
        });
      }
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("1. household proposal pattern: 3 sent, 2 accepted (correct mean totalUsd), 1 declined, 0 expired", async () => {
    const pattern = await buildPatternContext(TENANT_ID, householdId);
    expect(pattern.householdProposals).toEqual({
      totalSent: 3,
      accepted: 2,
      declined: 1,
      expired: 0,
      avgAcceptedTotalUsd: 1500, // (1000 + 2000) / 2
    });
  });

  it("2. technician reliability: 5 appointments, 1 no_show → noShowRate 0.2", async () => {
    const pattern = await buildPatternContext(TENANT_ID, householdId);
    expect(pattern.technicianReliability).toHaveLength(1);
    expect(pattern.technicianReliability[0]!.totalAppointments).toBe(5);
    expect(pattern.technicianReliability[0]!.noShowCount).toBe(1);
    expect(pattern.technicianReliability[0]!.noShowRate).toBe(0.2);
  });

  it("3. buildMemorySnapshot() with no householdId returns householdProposals:null but still populates technicianReliability", async () => {
    const snapshot = await buildMemorySnapshot({ tenantId: TENANT_ID });
    expect(snapshot.patterns).not.toBeNull();
    expect(snapshot.patterns!.householdProposals).toBeNull();
    expect(snapshot.patterns!.technicianReliability).toHaveLength(1);
    expect(snapshot.patterns!.technicianReliability[0]!.noShowRate).toBe(0.2);
    // Phase 12: scanSignals is additive — no findings seeded for this tenant, so it
    // defaults to [] rather than being absent from the shape.
    expect(snapshot.patterns!.scanSignals).toEqual([]);
  });

  it("4. the pattern genuinely reaches the planner's outgoing prompt — not just the type", async () => {
    const snapshot = await buildMemorySnapshot({ tenantId: TENANT_ID, householdId });
    expect(snapshot.patterns!.householdProposals!.accepted).toBe(2); // sanity: real seeded data, not a stub

    const captured: string[] = [];
    const capturingProvider: LLMProvider = {
      name: "capturing",
      async complete(opts) {
        captured.push(opts.user);
        return JSON.stringify({ actions: [] });
      },
    };
    const planner = new LLMPlanner(createDefaultPluginRegistry(), capturingProvider);
    const ctx: TenantContext = { tenantId: TENANT_ID, userId: "test-user", role: "owner" };
    await planner.plan("Send the proposal to this household.", ctx, snapshot);

    expect(captured).toHaveLength(1);
    const sentUser = captured[0]!;
    expect(sentUser).toContain("patterns");
    // The real seeded accepted-count (2) must appear in the string sent to the LLM —
    // a type-level MemorySnapshot.patterns field with no assertion like this proves
    // nothing about whether the planner's prompt actually carries it.
    const parsed = JSON.parse(sentUser) as { memory: { patterns: { householdProposals: { accepted: number } } } };
    expect(parsed.memory.patterns.householdProposals.accepted).toBe(2);
  });
});
