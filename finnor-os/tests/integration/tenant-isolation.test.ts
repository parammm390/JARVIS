// Multi-tenancy acceptance (§32.2): tenant A's data is invisible to tenant B —
// asserted as an empty result / rejected write, enforced by RLS at the database layer.
// Also covers §32.4 (semantic memory round-trip + isolation) and §32.9 (RAG scoping).
// Uses the non-superuser finnor_app role so RLS is genuinely exercised.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool } from "@finnor/db";
import { writeSemantic, querySemantic, appendEpisode, readEpisodes, DeterministicLocalEmbedder } from "@finnor/memory";
import { withTenant, households, domainActions } from "@finnor/db";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
// Swap credentials for the RLS-subject role created by migration 0001 (local/CI only).
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");
const TENANT_B = "00000000-0000-4000-8000-000000000002";

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

describe.skipIf(!available)("tenant isolation via RLS (§32.2, §32.4, §32.9)", () => {
  beforeAll(async () => {
    await migrate(SUPER_URL);
    await seed(SUPER_URL);
    // Create tenant B under its own context.
    const c = new pg.Client({ connectionString: SUPER_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B]);
    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Other Dealer') ON CONFLICT (id) DO NOTHING`, [TENANT_B]);
    await c.query("COMMIT");
    await c.end();
    // All subsequent app-layer access goes through the non-superuser role.
    process.env.DATABASE_URL = APP_URL;
    await closePool();
  });

  afterAll(async () => {
    await closePool();
    process.env.DATABASE_URL = SUPER_URL;
  });

  it("the RLS-subject role really is subject to RLS", async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    const { rows } = await c.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    await c.end();
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("tenant B cannot read tenant A's households (empty result, not an error)", async () => {
    const asA = await withTenant(SEED_TENANT_ID, (db) => db.select().from(households));
    expect(asA.length).toBeGreaterThan(0);
    const asB = await withTenant(TENANT_B, (db) => db.select().from(households));
    expect(asB).toHaveLength(0);
  });

  it("tenant B cannot write a row claiming to belong to tenant A", async () => {
    await expect(
      withTenant(TENANT_B, (db) =>
        db.insert(domainActions).values({
          tenantId: SEED_TENANT_ID, // forged tenant id
          actionType: "schedule_water_test",
          payload: {},
          status: "draft",
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("semantic memory round-trips within a tenant and never leaks across (§32.4, §32.9)", async () => {
    const embedder = new DeterministicLocalEmbedder();
    await writeSemantic(
      SEED_TENANT_ID,
      "sop-water-test",
      ["Our water test SOP: always collect a raw water sample before the softener."],
      embedder,
    );
    const hitsA = await querySemantic(SEED_TENANT_ID, "water test SOP raw sample", 3, embedder);
    expect(hitsA.length).toBeGreaterThan(0);
    expect(hitsA[0]!.chunk).toContain("raw water sample");

    const hitsB = await querySemantic(TENANT_B, "water test SOP raw sample", 3, embedder);
    expect(hitsB).toHaveLength(0);
  });

  it("episodic memory is tenant-scoped too", async () => {
    const [action] = await withTenant(SEED_TENANT_ID, (db) =>
      db
        .insert(domainActions)
        .values({ tenantId: SEED_TENANT_ID, actionType: "schedule_water_test", payload: {}, status: "draft" })
        .returning(),
    );
    await appendEpisode(SEED_TENANT_ID, action!.id, "iso_test", {}, {});
    const mine = await readEpisodes(SEED_TENANT_ID, { domainActionId: action!.id });
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await readEpisodes(TENANT_B, { domainActionId: action!.id });
    expect(theirs).toHaveLength(0);
  });
});
