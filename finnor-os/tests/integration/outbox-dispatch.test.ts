// Phase 2 (§2.3) outbox dispatch acceptance: exactly-once claiming under concurrency,
// terminal/exhausted-retryable failures land in dead_letters, and an unrecognized
// envelope version is rejected without ever being handed to the deliverer.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, outboxEvents, deadLetters } from "@finnor/db";
import { eq, inArray } from "drizzle-orm";
import { enqueueOutboxEvent, relayOutboxEvents, type OutboxDeliverer } from "@finnor/workflow-runtime";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000e8";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: SUPER_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

async function makeEvent(eventType: string, envelopeVersion = 1): Promise<string> {
  const { outboxEventId } = await withTenant(TENANT_ID, (db) =>
    enqueueOutboxEvent(db, { tenantId: TENANT_ID, eventType, payload: { probe: eventType } }),
  );
  if (envelopeVersion !== 1) {
    await withTenant(TENANT_ID, (db) => db.update(outboxEvents).set({ envelopeVersion }).where(eq(outboxEvents.id, outboxEventId)));
  }
  return outboxEventId;
}

describe.skipIf(!available)("outbox dispatch (§2.3)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = SUPER_URL;
    await migrate(SUPER_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Outbox Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(deadLetters).where(eq(deadLetters.tenantId, TENANT_ID));
      await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TENANT_ID));
    });
    await closePool();
  });

  it("delivers a pending event and marks it delivered", async () => {
    const id = await makeEvent("probe.delivered");
    const seen: string[] = [];
    const deliverer: OutboxDeliverer = { async deliver(eventType) { seen.push(eventType); } };
    const result = await relayOutboxEvents(TENANT_ID, deliverer);
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(seen).toContain("probe.delivered");
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, id)));
    expect(row!.status).toBe("delivered");
  });

  it("N concurrent relayers deliver each pending event exactly once (SKIP LOCKED proof)", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => makeEvent(`probe.concurrent.${i}`)));
    const deliveryCountByKey = new Map<string, number>();
    const deliverer: OutboxDeliverer = {
      async deliver(_eventType, _payload, opts) {
        deliveryCountByKey.set(opts.idempotencyKey, (deliveryCountByKey.get(opts.idempotencyKey) ?? 0) + 1);
        // Simulate real delivery latency so concurrent claims actually overlap in time.
        await new Promise((r) => setTimeout(r, 20));
      },
    };
    // 5 concurrent "workers" all racing to relay the same tenant's pending events.
    await Promise.all(Array.from({ length: 5 }, () => relayOutboxEvents(TENANT_ID, deliverer)));

    for (const id of ids) {
      expect(deliveryCountByKey.get(id)).toBe(1);
    }
    const rows = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(inArray(outboxEvents.id, ids)));
    expect(rows.every((r) => r.status === "delivered")).toBe(true);
  });

  it("a terminal error dead-letters immediately, without waiting for 3 attempts", async () => {
    const id = await makeEvent("probe.terminal");
    const deliverer: OutboxDeliverer = {
      async deliver() {
        const err = new Error("invalid payload shape") as Error & { kind: string };
        err.kind = "validation";
        throw err;
      },
    };
    await relayOutboxEvents(TENANT_ID, deliverer);
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, id)));
    expect(row!.status).toBe("failed");
    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, id)));
    expect(dl!.errorKind).toBe("validation");
    expect(dl!.replayable).toBe(false);
    expect(dl!.status).toBe("open");
  });

  it("a retryable error backs off and only dead-letters after exhausting attempts", async () => {
    const id = await makeEvent("probe.retryable");
    const deliverer: OutboxDeliverer = {
      async deliver() {
        throw new Error("provider timeout");
      },
    };
    // 1st attempt: retried (attempts=1 < MAX 3).
    await relayOutboxEvents(TENANT_ID, deliverer);
    let [row] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, id)));
    expect(row!.status).toBe("pending");
    expect(row!.nextAttemptAt).not.toBeNull();

    // Force the backoff window open so the next relay pass can reclaim it immediately.
    await withTenant(TENANT_ID, (db) => db.update(outboxEvents).set({ nextAttemptAt: null }).where(eq(outboxEvents.id, id)));
    await relayOutboxEvents(TENANT_ID, deliverer); // attempts=2
    await withTenant(TENANT_ID, (db) => db.update(outboxEvents).set({ nextAttemptAt: null }).where(eq(outboxEvents.id, id)));
    await relayOutboxEvents(TENANT_ID, deliverer); // attempts=3 -> exhausted -> dead-lettered

    [row] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, id)));
    expect(row!.status).toBe("failed");
    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, id)));
    expect(dl!.errorKind).toBe("retryable");
    expect(dl!.replayable).toBe(true);
  });

  it("an unrecognized envelope version is rejected into dead_letters without ever reaching the deliverer", async () => {
    const id = await makeEvent("probe.future-version", 999);
    let called = false;
    const deliverer: OutboxDeliverer = {
      async deliver() {
        called = true;
      },
    };
    await relayOutboxEvents(TENANT_ID, deliverer);
    expect(called).toBe(false);
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(outboxEvents).where(eq(outboxEvents.id, id)));
    expect(row!.status).toBe("failed");
    const [dl] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.relatedOutboxEventId, id)));
    expect(dl!.errorKind).toBe("terminal");
    expect(dl!.lastError).toMatch(/not recognized/);
  });
});
