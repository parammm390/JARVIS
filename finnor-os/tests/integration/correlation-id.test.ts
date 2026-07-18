// Correlation-id tracing (Phase 16e): requireContext mints/forwards one and tags the
// Sentry scope; enqueueJob folds it into payload._correlationId; the worker reads it
// back at dispatch. This test proves the enqueueJob->payload round trip and
// requireContext's generation/forwarding — the manual cross-process trace (one
// handleInstruction call, grepped across api log + jobs.payload) is documented in the
// phase report since it isn't a thing an automated assertion can capture.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, enqueueJob } from "@finnor/db";
import { requireContext } from "../../apps/api/lib/auth";

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

describe.skipIf(!available)("correlation id — enqueueJob round trip + requireContext generation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("enqueueJob folds correlationId into payload._correlationId, retrievable from the jobs row", async () => {
    const key = `corr-test:${Date.now()}:${Math.random()}`;
    await enqueueJob("send_message", { tenantId: "00000000-0000-4000-8000-000000000001", hello: "world" }, key, "trace-abc-123");
    const { rows } = await getPool().query(`SELECT payload FROM jobs WHERE idempotency_key = $1`, [key]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload._correlationId).toBe("trace-abc-123");
    expect(rows[0].payload.hello).toBe("world"); // original payload keys survive alongside it
  });

  it("enqueueJob without a correlationId leaves payload unchanged (no stray _correlationId key)", async () => {
    const key = `corr-test-none:${Date.now()}:${Math.random()}`;
    await enqueueJob("send_message", { tenantId: "00000000-0000-4000-8000-000000000001", hello: "world" }, key);
    const { rows } = await getPool().query(`SELECT payload FROM jobs WHERE idempotency_key = $1`, [key]);
    expect(rows[0].payload._correlationId).toBeUndefined();
  });

  it("requireContext forwards an inbound x-correlation-id header verbatim", async () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-tenant-id": "00000000-0000-4000-8000-000000000001", "x-user-role": "owner", "x-correlation-id": "inbound-trace-xyz" },
    });
    const ctx = await requireContext(req);
    expect(ctx.correlationId).toBe("inbound-trace-xyz");
  });

  it("requireContext mints a fresh correlationId when no header is present", async () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-tenant-id": "00000000-0000-4000-8000-000000000001", "x-user-role": "owner" },
    });
    const ctx = await requireContext(req);
    expect(ctx.correlationId).toBeTruthy();
    expect(ctx.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
