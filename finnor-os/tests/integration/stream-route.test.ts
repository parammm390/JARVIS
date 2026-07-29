// jarvis-v3 P3.T9: GET /api/stream?instructionId= — same describe.skipIf(!available)
// + migrate() + direct-route-import pattern as dlq-routes.test.ts / instructions-
// routes.test.ts. Seeds instruction_events ending in a terminal phase so the
// route's own early-exit closes the stream immediately — no test waits out the
// real 120s ceiling or 25s heartbeat.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, withTenant, tenants } from "@finnor/db";
import { ensureInstructionSession, emitInstructionEvent } from "../../packages/orchestration/src/instruction-trace";
import { GET as getStream } from "../../apps/api/app/api/stream/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ec";

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

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, { headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner", ...headers } });
}

interface SseFrame {
  id: string | null;
  data: Record<string, unknown> | null;
}

async function readAllFrames(res: Response): Promise<SseFrame[]> {
  const body = res.body;
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: SseFrame[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim() || part.startsWith(":")) continue;
      let id: string | null = null;
      let data: Record<string, unknown> | null = null;
      for (const line of part.split("\n")) {
        if (line.startsWith("id: ")) id = line.slice(4);
        if (line.startsWith("data: ")) data = JSON.parse(line.slice(6));
      }
      frames.push({ id, data });
    }
  }
  return frames;
}

describe.skipIf(!available)("GET /api/stream?instructionId= (P3.T9)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Stream Route Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("400s when instructionId is missing", async () => {
    const res = await getStream(req("/api/stream"));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown instructionId", async () => {
    const res = await getStream(req(`/api/stream?instructionId=${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("200s with text/event-stream for a real instruction, and delivers real events in order", async () => {
    const id = randomUUID();
    await ensureInstructionSession(TENANT_ID, id, "chase everyone more than thirty days overdue", { source: "typed" });
    await emitInstructionEvent(TENANT_ID, id, "received");
    await emitInstructionEvent(TENANT_ID, id, "planning");
    await emitInstructionEvent(TENANT_ID, id, "completed", { actionId: "a1" }); // terminal — stream self-closes fast

    const res = await getStream(req(`/api/stream?instructionId=${id}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const frames = await readAllFrames(res);
    expect(frames.map((f) => f.data?.phase)).toEqual(["received", "planning", "completed"]);
    expect(frames.map((f) => f.id)).toEqual(["1", "2", "3"]);
  });

  it("Last-Event-ID resumes from that seq — no duplicate frames on reconnect", async () => {
    const id = randomUUID();
    await ensureInstructionSession(TENANT_ID, id, "resume check", {});
    await emitInstructionEvent(TENANT_ID, id, "received");
    await emitInstructionEvent(TENANT_ID, id, "context_retrieved", {});
    await emitInstructionEvent(TENANT_ID, id, "planning");
    await emitInstructionEvent(TENANT_ID, id, "failed", {}); // terminal — stream self-closes fast

    const res = await getStream(req(`/api/stream?instructionId=${id}`, { "last-event-id": "2" }));
    const frames = await readAllFrames(res);
    // Only seq 3 (planning) and seq 4 (failed) — seq 1/2 were already seen before
    // this reconnect, never redelivered.
    expect(frames.map((f) => f.data?.phase)).toEqual(["planning", "failed"]);
    expect(frames.map((f) => f.id)).toEqual(["3", "4"]);
  });
});
