// Phase 1.8: the authz test wall. Three things not already covered elsewhere:
// (1) every private route rejects a request with no credential at all — enumerated,
//     not just proven once for requireContext in isolation, so a future route that
//     forgets to call requireContext gets caught here;
// (2) the resources/[kind] route enforces tenant scoping for a kind beyond households
//     (tenant-isolation.test.ts already proves withTenant/RLS work for households and
//     domain_actions directly — this proves the ROUTE ITSELF passes the right
//     tenantId through, for "invoices");
// (3) the 3 "public tier" proxy paths (stats, setup/status, integrations/status) never
//     return household-level fields, since the jarvis proxy serves them via a shared
//     service token regardless of whether the browser caller is signed in.
// "role without can_approve -> 403 on confirm" is already covered by
// rbac-approval.test.ts and is not repeated here.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool, withTenant, tenants, invoices, households } from "@finnor/db";
import { eq } from "drizzle-orm";
import { GET as resourcesGET } from "../../apps/api/app/api/resources/[kind]/route";
import { GET as readModelGET } from "../../apps/api/app/api/read-models/[view]/route";
import { GET as pendingGET } from "../../apps/api/app/api/actions/pending/route";
import { GET as workflowRunsGET } from "../../apps/api/app/api/workflows/runs/route";
import { GET as commsGET } from "../../apps/api/app/api/comms/route";
import { GET as insightsGET } from "../../apps/api/app/api/insights/route";
import { GET as statsGET } from "../../apps/api/app/api/stats/route";
import { GET as setupStatusGET } from "../../apps/api/app/api/setup/status/route";
import { GET as integrationsStatusGET } from "../../apps/api/app/api/integrations/status/route";
import { GET as auditGET } from "../../apps/api/app/api/audit/route";
import { GET as eventsGET } from "../../apps/api/app/api/events/route";
import { POST as actionsPOST } from "../../apps/api/app/api/actions/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_B = "00000000-0000-4000-8000-0000000000f1";

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

// Deliberately no headers at all — not even the dev-bypass ones — so this is a true
// anonymous request regardless of AUTH_DEV_BYPASS's value in the environment.
function anonReq(url = "http://localhost/api/test"): Request {
  return new Request(url);
}

/** Runs fn with dev-bypass auth enabled as a real signed-in tenant context. */
async function asAuthed<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubEnv("AUTH_DEV_BYPASS", "1");
  vi.stubEnv("NODE_ENV", "test");
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe.skipIf(!available)("authz test wall (Phase 1.8)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
    await withTenant(SEED_TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Wall Test Tenant B" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  describe("anonymous requests are rejected on every private path", () => {
    it("resources/[kind]", async () => {
      const res = await resourcesGET(anonReq(), { params: { kind: "households" } });
      expect(res.status).toBe(401);
    });
    it("read-models/[view]", async () => {
      const res = await readModelGET(anonReq(), { params: { view: "pipeline-health" } });
      expect(res.status).toBe(401);
    });
    it("actions/pending", async () => {
      expect((await pendingGET(anonReq())).status).toBe(401);
    });
    it("workflows/runs", async () => {
      expect((await workflowRunsGET(anonReq())).status).toBe(401);
    });
    it("comms", async () => {
      expect((await commsGET(anonReq())).status).toBe(401);
    });
    it("insights", async () => {
      expect((await insightsGET(anonReq())).status).toBe(401);
    });
    it("stats", async () => {
      expect((await statsGET(anonReq())).status).toBe(401);
    });
    it("setup/status", async () => {
      expect((await setupStatusGET(anonReq())).status).toBe(401);
    });
    it("integrations/status", async () => {
      expect((await integrationsStatusGET(anonReq())).status).toBe(401);
    });
    it("audit", async () => {
      expect((await auditGET(anonReq("http://localhost/api/audit"))).status).toBe(401);
    });
    it("events", async () => {
      expect((await eventsGET(anonReq("http://localhost/api/events"))).status).toBe(401);
    });
    it("actions (POST)", async () => {
      const res = await actionsPOST(new Request("http://localhost/api/actions", { method: "POST", body: "{}" }));
      expect(res.status).toBe(401);
    });
  });

  it("resources/invoices: tenant B sees none of tenant A's invoices through the actual route", async () => {
    const [household] = await withTenant(SEED_TENANT_ID, (db) => db.select({ id: households.id }).from(households).where(eq(households.tenantId, SEED_TENANT_ID)).limit(1));
    await withTenant(SEED_TENANT_ID, (db) =>
      db.insert(invoices).values({ tenantId: SEED_TENANT_ID, householdId: household!.id, amountUsd: "100.00", status: "sent" }),
    );
    const reqAs = (tenantId: string) => new Request("http://localhost/api/resources/invoices", { headers: { "x-tenant-id": tenantId, "x-user-role": "owner" } });
    const savedDbUrl = process.env.DATABASE_URL;
    // The plain DATABASE_URL role bypasses FORCE ROW LEVEL SECURITY (superuser-
    // equivalent in local/CI) — same gotcha tenant-isolation.test.ts works around.
    // Swap to the restricted finnor_app role so RLS is actually exercised here too.
    process.env.DATABASE_URL = savedDbUrl!.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");
    await closePool();
    try {
      await asAuthed(async () => {
        const asA = await (await resourcesGET(reqAs(SEED_TENANT_ID), { params: { kind: "invoices" } })).json();
        const asB = await (await resourcesGET(reqAs(TENANT_B), { params: { kind: "invoices" } })).json();
        expect(asA.rows.length).toBeGreaterThan(0);
        expect(asB.rows).toHaveLength(0);
      });
    } finally {
      process.env.DATABASE_URL = savedDbUrl;
      await closePool();
    }
  });

  describe("the public-tier proxy paths never carry household-level fields", () => {
    const FORBIDDEN_KEYS = ["address", "contactInfo", "waterProfile"];

    function assertNoHouseholdFields(value: unknown, path = "$"): void {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => assertNoHouseholdFields(v, `${path}[${i}]`));
        return;
      }
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        expect(FORBIDDEN_KEYS, `found forbidden key "${key}" at ${path}`).not.toContain(key);
        assertNoHouseholdFields(v, `${path}.${key}`);
      }
    }

    it("stats", async () => {
      await asAuthed(async () => {
        const req = new Request("http://localhost/api/stats", { headers: { "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" } });
        assertNoHouseholdFields(await (await statsGET(req)).json());
      });
    });

    it("setup/status", async () => {
      await asAuthed(async () => {
        const req = new Request("http://localhost/api/setup/status", { headers: { "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" } });
        assertNoHouseholdFields(await (await setupStatusGET(req)).json());
      });
    });

    it("integrations/status", async () => {
      await asAuthed(async () => {
        const req = new Request("http://localhost/api/integrations/status", { headers: { "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" } });
        assertNoHouseholdFields(await (await integrationsStatusGET(req)).json());
      });
    });
  });
});
