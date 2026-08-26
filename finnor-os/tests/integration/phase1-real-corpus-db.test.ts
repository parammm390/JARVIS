import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@finnor/db";
import { createDbIrAdmissibilityCompiler, createDefaultPluginRegistry } from "@finnor/orchestration";
import { migrate } from "../../packages/db/migrate";
import * as schema from "../../packages/db/schema";
import { REAL_FINNOR_FIXED_CLOCK, REAL_FINNOR_PHASE1_CORPUS, realCaseArtifact, type RealFinnorCase } from "../phase1/real-finnor-corpus";

const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const databaseName = `finnor_phase1_real_${randomUUID().replaceAll("-", "_")}`;
const databaseUrl = (() => { const url = new URL(SOURCE_URL); url.pathname = `/${databaseName}`; return url.toString(); })();
const accepted = REAL_FINNOR_PHASE1_CORPUS.filter((entry) => entry.category === "grounding_reference" && entry.actionType === "create_invoice" && entry.expected.compilerResult === "ADMIT").slice(0, 5);
const forged = REAL_FINNOR_PHASE1_CORPUS.filter((entry) => entry.category === "cross_tenant_forged" && entry.actionType === "create_invoice").slice(0, 5);

describe.sequential("Phase-1 real FINNOR corpus against canonical Postgres truth", () => {
  let admin: pg.Client;
  let client: pg.Client;
  let db: Db;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: SOURCE_URL, connectionTimeoutMillis: 2_000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    db = drizzle(client, { schema }) as Db;
    for (const testCase of [...accepted, ...forged]) await seedCase(client, testCase);
  }, 180_000);

  afterAll(async () => {
    await client?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin?.end();
  }, 30_000);

  it("admits grounded tenant-owned mutations and rejects the same family with forged cross-tenant targets", async () => {
    expect(accepted).toHaveLength(5);
    expect(forged).toHaveLength(5);
    for (const testCase of [...accepted, ...forged]) {
      const result = await createDbIrAdmissibilityCompiler({
        db,
        tenantId: testCase.trustedWorld.tenantId,
        plugins: createDefaultPluginRegistry(),
        now: () => new Date(REAL_FINNOR_FIXED_CLOCK),
      }).admit(realCaseArtifact(testCase));
      expect(result.admissible, testCase.id).toBe(testCase.expected.compilerResult === "ADMIT");
      if (!result.admissible && testCase.expected.compilerResult === "REJECT") {
        expect(result.issues.some(({ code }) => code === "TARGET_NOT_GROUNDED"), testCase.id).toBe(true);
      }
    }
  });
});

async function seedCase(client: pg.Client, testCase: RealFinnorCase): Promise<void> {
  await client.query("INSERT INTO finnor_os.tenants(id,client_key,name) VALUES ($1,$2,$3),($4,$5,$6)", [
    testCase.trustedWorld.tenantId,
    `real-${testCase.id}-primary`,
    `${testCase.id} primary`,
    testCase.trustedWorld.otherTenantId,
    `real-${testCase.id}-other`,
    `${testCase.id} other`,
  ]);
  for (const entity of testCase.trustedWorld.entities) {
    if (entity.entityType === "household") await client.query("INSERT INTO finnor_os.households(id,tenant_id,address) VALUES ($1,$2,$3)", [entity.entityId, entity.tenantId, `${testCase.id} service account`]);
    if (entity.entityType === "property") await client.query("INSERT INTO finnor_os.properties(id,tenant_id,household_id,address,kind,link_status) VALUES ($1,$2,NULL,$3,'residential','RESOLVED')", [entity.entityId, entity.tenantId, `${testCase.id} service property`]);
  }
}
