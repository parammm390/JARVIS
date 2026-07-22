// A4.T3 integration coverage: triageOpenDeadLetters() against real dead_letters rows —
// proves real clustering (counting OTHER open rows sharing an event family) and that
// suggestions are actually persisted, idempotently, on the row.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, deadLetters } from "@finnor/db";
import { eq } from "drizzle-orm";
import { triageOpenDeadLetters } from "@finnor/workflow-runtime";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f1";

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

async function insertDeadLetter(overrides: { errorKind: string; attempts: number; replayable: boolean; eventType: string }) {
  const [row] = await withTenant(TENANT_ID, (db) =>
    db
      .insert(deadLetters)
      .values({
        tenantId: TENANT_ID,
        envelope: { type: overrides.eventType, version: 1, tenantId: TENANT_ID, occurredAt: new Date().toISOString(), payload: {} },
        errorKind: overrides.errorKind as never,
        attempts: overrides.attempts,
        lastError: "test failure",
        replayable: overrides.replayable,
        status: "open",
      })
      .returning(),
  );
  return row!;
}

describe.skipIf(!available)("triageOpenDeadLetters (A4.T3)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "DLQ Triage Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("suggests replay for an isolated, low-attempt retryable failure, and discard for a validation one", async () => {
    const family = `triage.isolated.${randomUUID()}`;
    const retryableRow = await insertDeadLetter({ errorKind: "retryable", attempts: 1, replayable: true, eventType: family });
    const validationRow = await insertDeadLetter({ errorKind: "validation", attempts: 1, replayable: false, eventType: `triage.other.${randomUUID()}` });

    await triageOpenDeadLetters(TENANT_ID);

    const [afterRetryable] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.id, retryableRow.id)));
    const [afterValidation] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.id, validationRow.id)));
    expect(afterRetryable!.suggestedDisposition).toBe("replay");
    expect(afterValidation!.suggestedDisposition).toBe("discard");
  });

  it("escalates when 4 rows genuinely cluster in the same real event family", async () => {
    const family = `triage.cluster.${randomUUID()}`;
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => insertDeadLetter({ errorKind: "retryable", attempts: 1, replayable: true, eventType: family })),
    );

    await triageOpenDeadLetters(TENANT_ID);

    for (const r of rows) {
      const [after] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.id, r.id)));
      expect(after!.suggestedDisposition).toBe("escalate");
      expect(after!.suggestionReason).toMatch(/open dead letters share this event type/);
    }
  });

  it("is idempotent — re-running overwrites with the same current-best suggestion, not a stale one", async () => {
    const family = `triage.idempotent.${randomUUID()}`;
    const r = await insertDeadLetter({ errorKind: "retryable", attempts: 1, replayable: true, eventType: family });

    await triageOpenDeadLetters(TENANT_ID);
    const [first] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.id, r.id)));
    expect(first!.suggestedDisposition).toBe("replay");

    // Add 3 more siblings in the same family, then re-triage — the suggestion must
    // update to reflect the NOW-real cluster, proving this isn't a one-shot stamp.
    await Promise.all(Array.from({ length: 3 }, () => insertDeadLetter({ errorKind: "retryable", attempts: 1, replayable: true, eventType: family })));
    await triageOpenDeadLetters(TENANT_ID);
    const [second] = await withTenant(TENANT_ID, (db) => db.select().from(deadLetters).where(eq(deadLetters.id, r.id)));
    expect(second!.suggestedDisposition).toBe("escalate");
  });
});
