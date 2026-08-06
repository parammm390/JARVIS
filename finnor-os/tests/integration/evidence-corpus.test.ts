import { describe, expect, it, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, evidenceSourceVersions, researchRunHits, tenants, withTenant } from "@finnor/db";
import { appendEvidenceVersion, createEvidenceSource, finishResearchRun, searchEvidence, startResearchRun } from "@finnor/memory";
import { and, eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-0000000000ed";
const TENANT_B = "00000000-0000-4000-8000-0000000000ee";
const SOURCE_KEY = `evidence-test:${Date.now()}`;

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

describe.skipIf(!available)("evidence corpus", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_A, (db) => db.insert(tenants).values({ id: TENANT_A, name: "Evidence Test A" }).onConflictDoNothing());
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Evidence Test B" }).onConflictDoNothing());
  });

  afterAll(async () => {
    await closePool();
  });

  it("appends an immutable version, is retry-idempotent, and records citable research hits", async () => {
    const source = await createEvidenceSource(TENANT_A, {
      sourceKey: SOURCE_KEY,
      sourceType: "manual",
      title: "Evidence test source",
    });
    const content = "The service radius is twenty miles. The published policy is effective on August fourth 2026.";
    const first = await appendEvidenceVersion(TENANT_A, source.id, {
      content,
      asOf: new Date("2026-08-04T00:00:00Z"),
      entityRefs: [{ type: "policy", key: "service-radius" }],
      timeRefs: [{ kind: "effective", validFrom: "2026-08-04T00:00:00Z" }],
    });
    const retry = await appendEvidenceVersion(TENANT_A, source.id, { content });

    expect(retry).toEqual(first);
    const versions = await withTenant(TENANT_A, (db) =>
      db.select().from(evidenceSourceVersions).where(eq(evidenceSourceVersions.sourceId, source.id)),
    );
    expect(versions).toHaveLength(1);

    const runId = await startResearchRun(TENANT_A, { query: "published service radius policy", asOf: new Date("2026-08-04T00:00:00Z") });
    const result = await searchEvidence({ tenantId: TENANT_A, query: "published service radius policy", researchRunId: runId });
    expect(result.hits[0]!.citation).toMatchObject({
      source: SOURCE_KEY,
      version: 1,
      asOf: "2026-08-04T00:00:00.000Z",
    });
    expect(result.hits[0]!.citation.excerpt).toContain("service radius");
    await finishResearchRun(TENANT_A, runId, "completed");

    const recorded = await withTenant(TENANT_A, (db) =>
      db.select().from(researchRunHits).where(and(eq(researchRunHits.researchRunId, runId), eq(researchRunHits.tenantId, TENANT_A))),
    );
    expect(recorded).toHaveLength(1);
  });

  it("does not return tenant A's evidence in tenant B's scoped search", async () => {
    const result = await searchEvidence({ tenantId: TENANT_B, query: "published service radius policy", scope: "tenant" });
    expect(result.hits.some((hit) => hit.sourceKey === SOURCE_KEY)).toBe(false);
  });

  it("does not expose public-cache writes through the tenant service", async () => {
    await expect(
      createEvidenceSource(TENANT_A, { scope: "public", sourceKey: "https://public.example/source", sourceType: "web", title: "Public" }),
    ).rejects.toThrow(/privileged cache-ingestion/);
  });
});
