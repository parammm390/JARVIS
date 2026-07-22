// A4.T1 acceptance: OutcomeReflection.evaluate() must retry ONLY when a failure's
// errorKind is "retryable" — before this fix it retried once on EVERY non-success
// outcome regardless of kind, wasting a cycle on a guaranteed-terminal failure (a
// missing record, a bad auth token, a validation error) before ever looking at what
// actually went wrong. See packages/orchestration/src/reflection.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainActions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { OutcomeReflection } from "@finnor/orchestration";
import type { DomainAction, ExecutionResult } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

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

async function createAction(): Promise<DomainAction> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: SEED_TENANT_ID, actionType: "reflection_gate_test", payload: {}, status: "approved" })
      .returning();
    return {
      id: row!.id,
      tenantId: row!.tenantId,
      actionType: row!.actionType,
      payload: row!.payload as Record<string, unknown>,
      policyId: row!.policyId,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
    };
  });
}

async function statusOf(id: string): Promise<string> {
  const [row] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, id)));
  return row!.status;
}

describe.skipIf(!available)("OutcomeReflection retry gate keys off errorKind (A4.T1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("retries a retryable failure on the first attempt", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "failure", output: {}, error: "transient blip", errorKind: "retryable" };
    const outcome = await reflection.evaluate(action, result);
    expect(outcome.decision).toBe("retry");
    expect(await statusOf(action.id)).toBe("approved"); // unchanged — not escalated
  });

  it("retries a provider_down failure too (matches outbox.ts's own replayable judgment)", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "integration_unavailable", output: {}, error: "GHL is down", errorKind: "provider_down" };
    const outcome = await reflection.evaluate(action, result);
    expect(outcome.decision).toBe("retry");
  });

  it("escalates a validation failure immediately, without retrying", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "failure", output: {}, error: "No customer found matching that id.", errorKind: "validation" };
    const outcome = await reflection.evaluate(action, result);
    expect(outcome.decision).toBe("escalate");
    expect(await statusOf(action.id)).toBe("needs_human_review");
  });

  it("escalates a terminal failure immediately (no errorKind at all)", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "failure", output: {}, error: "unclassified failure" };
    const outcome = await reflection.evaluate(action, result);
    expect(outcome.decision).toBe("escalate");
    expect(await statusOf(action.id)).toBe("needs_human_review");
  });

  it("escalates a retryable failure on the SECOND attempt (never retries twice)", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "failure", output: {}, error: "still failing", errorKind: "retryable" };
    await reflection.evaluate(action, result); // first: retry
    const second = await reflection.evaluate(action, result); // second: must escalate regardless of kind
    expect(second.decision).toBe("escalate");
    expect(await statusOf(action.id)).toBe("needs_human_review");
  });

  it("still accepts a real success outcome", async () => {
    const action = await createAction();
    const reflection = new OutcomeReflection();
    const result: ExecutionResult = { status: "success", output: {} };
    const outcome = await reflection.evaluate(action, result);
    expect(outcome.decision).toBe("accept");
    expect(await statusOf(action.id)).toBe("approved");
  });
});
