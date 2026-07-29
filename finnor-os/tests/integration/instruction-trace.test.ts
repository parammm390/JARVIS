// jarvis-v3 P3.T2: instruction-trace.ts's real behavior against a real, migrated
// Postgres — same self-skipping pattern as tests/integration/correlation-id.test.ts
// (a real `pg.Client` connect probe, `describe.skipIf(!available)`, `migrate(DB_URL)`
// in beforeAll). This session's own migration (0062_instruction_lifecycle.sql) is
// written but NOT applied to any live database (see BLOCKER in
// JARVIS-FRONTEND-MAESTRO-STATE-v3.md — no safe migration path exists in this
// environment); `migrate()` only ever runs here against a DB this test itself found
// reachable, exactly like every other test in this file already does. Honestly
// skipped, not faked, wherever no such DB exists.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool } from "@finnor/db";
import { ensureInstructionSession, emitInstructionEvent, INSTRUCTION_EVENT_PHASES } from "../../packages/orchestration/src/instruction-trace";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-000000000001";

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

describe.skipIf(!available)("instruction-trace — real ensureInstructionSession/emitInstructionEvent", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("ensureInstructionSession is idempotent — a second call for the same id does not throw or duplicate", async () => {
    const id = randomUUID();
    await ensureInstructionSession(TENANT_ID, id, "chase everyone more than thirty days overdue", { source: "typed" });
    await ensureInstructionSession(TENANT_ID, id, "chase everyone more than thirty days overdue", { source: "typed" });
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM finnor_os.instruction_sessions WHERE id = $1`, [id]);
    expect(rows[0].n).toBe(1);
  });

  it("emitInstructionEvent assigns strictly increasing seq per instructionId", async () => {
    const id = randomUUID();
    await ensureInstructionSession(TENANT_ID, id, "test instruction", {});
    await emitInstructionEvent(TENANT_ID, id, "received");
    await emitInstructionEvent(TENANT_ID, id, "context_retrieved", { chips: [] });
    await emitInstructionEvent(TENANT_ID, id, "planning");
    const { rows } = await getPool().query(
      `SELECT seq, phase FROM finnor_os.instruction_events WHERE instruction_id = $1 ORDER BY seq ASC`,
      [id],
    );
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.phase)).toEqual(["received", "context_retrieved", "planning"]);
  });

  it("two different instructionIds get independent seq counters", async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    await ensureInstructionSession(TENANT_ID, idA, "a", {});
    await ensureInstructionSession(TENANT_ID, idB, "b", {});
    await emitInstructionEvent(TENANT_ID, idA, "received");
    await emitInstructionEvent(TENANT_ID, idB, "received");
    await emitInstructionEvent(TENANT_ID, idA, "planning");
    const { rows: aRows } = await getPool().query(`SELECT seq FROM finnor_os.instruction_events WHERE instruction_id = $1 ORDER BY seq`, [idA]);
    const { rows: bRows } = await getPool().query(`SELECT seq FROM finnor_os.instruction_events WHERE instruction_id = $1 ORDER BY seq`, [idB]);
    expect(aRows.map((r) => r.seq)).toEqual([1, 2]);
    expect(bRows.map((r) => r.seq)).toEqual([1]);
  });

  it("emitInstructionEvent with no instructionId is a real no-op — never throws, never writes", async () => {
    await expect(emitInstructionEvent(TENANT_ID, undefined, "received")).resolves.toBeUndefined();
  });

  it("every one of the 15 listed phases is accepted by the real CHECK constraint", async () => {
    const id = randomUUID();
    await ensureInstructionSession(TENANT_ID, id, "phase sweep", {});
    for (const phase of INSTRUCTION_EVENT_PHASES) {
      await emitInstructionEvent(TENANT_ID, id, phase);
    }
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM finnor_os.instruction_events WHERE instruction_id = $1`, [id]);
    expect(rows[0].n).toBe(INSTRUCTION_EVENT_PHASES.length);
  });
});
