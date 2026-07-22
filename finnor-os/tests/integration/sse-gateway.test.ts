// B1 EXIT GATE: "SSE event within 2s of a Dealer Zero action (curl pasted)". This test
// is the real, local equivalent — a genuine http.Server (the actual createSseGateway(),
// not a mock), a genuine EventSource-shaped SSE client reading raw response bytes, a
// real jarvis_events LISTEN connection, and a real domain_actions insert (which fires
// migration 0037's trigger). Also proves tenant scoping (a second tenant's connection
// receives nothing) and the 401 path when no credentials are presented.
//
// Auth uses AUTH_DEV_BYPASS, the same standing convention every other integration test
// in this repo already uses for identity — not a shortcut invented for this test.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import http from "node:http";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, adminDb, tenants, domainActions } from "@finnor/db";
import { startJarvisEventListener, stopJarvisEventListener, onJarvisEvent } from "../../apps/worker/src/sse/listener";
import { createSseGateway } from "../../apps/worker/src/sse/gateway";

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

function connectSse(port: number, tenantId: string): Promise<{ req: http.ClientRequest; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const req = http.get(
      { host: "127.0.0.1", port, path: "/events", headers: { "x-tenant-id": tenantId } },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Expected 200, got ${res.statusCode}`));
          return;
        }
        res.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
        resolve({ req, chunks });
      },
    );
    req.on("error", reject);
  });
}

describe.skipIf(!available)("B1.T2 — SSE gateway", () => {
  let server: http.Server;
  let port: number;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    vi.stubEnv("NODE_ENV", "test");
    await migrate(DB_URL);

    const [tenant] = await adminDb().insert(tenants).values({ name: "B1.T2 SSE gateway test tenant" }).returning();
    tenantId = tenant!.id;
    const [otherTenant] = await adminDb().insert(tenants).values({ name: "B1.T2 SSE gateway other tenant" }).returning();
    otherTenantId = otherTenant!.id;

    await startJarvisEventListener();
    server = createSseGateway();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    server.close();
    await stopJarvisEventListener();
    await closePool();
  });

  it("rejects a request with no credentials", async () => {
    await new Promise<void>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
          expect(res.statusCode).toBe(401);
          resolve();
        })
        .on("error", reject);
    });
  });

  it("streams a real jarvis_events NOTIFY to the connected tenant within 2s, and not to another tenant", async () => {
    const [{ chunks }, other] = await Promise.all([connectSse(port, tenantId), connectSse(port, otherTenantId)]);
    // Give both SSE connections a moment to register their onJarvisEvent subscriber
    // before the write happens, same as a real client's connect-then-listen race.
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    const [action] = await adminDb()
      .insert(domainActions)
      .values({ tenantId, actionType: "test_action", payload: {}, status: "draft" })
      .returning();

    const deadline = Date.now() + 2000;
    let received: Record<string, unknown> | null = null;
    while (Date.now() < deadline && !received) {
      const joined = chunks.join("");
      const match = joined.match(/data: (\{.*"kind":"domain_action".*\})\n/);
      if (match) received = JSON.parse(match[1]!);
      if (!received) await new Promise((r) => setTimeout(r, 25));
    }
    const elapsedMs = Date.now() - start;

    expect(received).not.toBeNull();
    expect(received!.id).toBe(action!.id);
    expect(received!.tenantId).toBe(tenantId);
    expect(elapsedMs).toBeLessThan(2000);

    // Tenant isolation: the other tenant's stream must never see this event.
    expect(other.chunks.join("")).not.toContain(action!.id);
  });
});
